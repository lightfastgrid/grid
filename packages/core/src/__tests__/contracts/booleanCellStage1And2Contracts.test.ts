/**
 * Boolean Cell V1 — Stage 1 and Stage 2 contract and boundary guards.
 *
 * Source-level guards live here (rather than in a feature `__tests__`) because
 * they assert cross-feature ownership rules: exactly one eligibility
 * implementation, no removed experimental option anywhere in shipping code,
 * while later stages retain their own explicit boundary guards.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolveCellEditEligibility } from "../../internal/cellEditEligibility";
import { isFieldPathSafe } from "../../internal/fieldPathSafety";
import type { CellEditEligibilityContext, ColumnDef } from "../../types";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../..");
const REPO = join(here, "../../../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

const SOURCE_FILES = walk(SRC);

function col(overrides: Partial<ColumnDef> = {}): ColumnDef {
  return { field: "f", ...overrides };
}

function eligibilityCtx(overrides: Partial<Parameters<typeof resolveCellEditEligibility>[0]> = {}) {
  return {
    row: { f: 1 },
    rowIndex: 0,
    column: col({ editable: true }),
    field: "f",
    value: 1,
    ...overrides,
  };
}

// ── Test 41: exactly one eligibility implementation ────────────────────

describe("neutral eligibility ownership (Test 41)", () => {
  it("only the neutral internal module implements the eligibility rules", () => {
    const implementers = SOURCE_FILES.filter((f) => {
      if (f.includes("__tests__")) return false;
      const src = readFileSync(f, "utf8");
      // A real implementation contains the rule strings, not just a re-export.
      return (
        src.includes("Column has valueGetter") &&
        src.includes("Unsafe field path") &&
        src.includes("Editable callback threw")
      );
    }).map((f) => relative(SRC, f));

    expect(implementers).toEqual(["internal/cellEditEligibility.ts"]);
  });

  it("the editing feature re-exports rather than re-implements", () => {
    const src = readFileSync(join(SRC, "features/editing/eligibility.ts"), "utf8");
    expect(src).toMatch(/from "\.\.\/\.\.\/internal\/cellEditEligibility"/);
    expect(src).not.toContain("Column has valueGetter");
  });

  it("field-path safety has a single neutral implementation", () => {
    const implementers = SOURCE_FILES.filter((f) => {
      if (f.includes("__tests__")) return false;
      return readFileSync(f, "utf8").includes('"__proto__", "constructor", "prototype"');
    }).map((f) => relative(SRC, f));

    expect(implementers).toEqual(["internal/fieldPathSafety.ts"]);
  });
});

// ── Tests 42-46: preserved eligibility behavior ────────────────────────

describe("eligibility behavior is preserved after extraction", () => {
  // Test 42
  it("excludes internal, action, and valueGetter columns", () => {
    expect(
      resolveCellEditEligibility(
        eligibilityCtx({ column: col({ editable: true, internal: "selection" }) }),
      ),
    ).toEqual({ editable: false, reason: "Internal column" });

    expect(
      resolveCellEditEligibility(
        eligibilityCtx({ column: col({ editable: true, cellKind: "actions" }) }),
      ),
    ).toEqual({ editable: false, reason: "Action column" });

    expect(
      resolveCellEditEligibility(
        eligibilityCtx({ column: col({ editable: true, valueGetter: () => 1 }) }),
      ),
    ).toEqual({ editable: false, reason: "Column has valueGetter" });
  });

  // Test 43
  it("excludes unsafe field paths using the shared helper", () => {
    for (const field of ["__proto__", "a.constructor", "a..b", ""]) {
      expect(isFieldPathSafe(field)).toBe(false);
      expect(
        resolveCellEditEligibility(eligibilityCtx({ field })).editable,
      ).toBe(false);
    }
    expect(isFieldPathSafe("a.b.c")).toBe(true);
    expect(
      resolveCellEditEligibility(eligibilityCtx({ field: "a.b.c" })).editable,
    ).toBe(true);
  });

  // Test 44
  it("handles editable undefined/false/true exactly as before", () => {
    expect(
      resolveCellEditEligibility(eligibilityCtx({ column: col() })),
    ).toEqual({ editable: false, reason: "Not editable" });
    expect(
      resolveCellEditEligibility(eligibilityCtx({ column: col({ editable: false }) })),
    ).toEqual({ editable: false, reason: "Not editable" });
    expect(
      resolveCellEditEligibility(eligibilityCtx({ column: col({ editable: true }) })),
    ).toEqual({ editable: true });
  });

  // Test 45
  it("passes the documented arguments to the editable callback", () => {
    let received: CellEditEligibilityContext | null = null;
    const column = col({
      editable: (c) => {
        received = c;
        return true;
      },
    });
    const row = { f: 7 };
    resolveCellEditEligibility({
      row,
      rowIndex: 3,
      column,
      field: "f",
      value: 7,
    });
    expect(received).not.toBeNull();
    expect(received!).toMatchObject({ rowIndex: 3, field: "f", value: 7 });
    expect(received!.row).toBe(row);
    expect(received!.column).toBe(column);
  });

  // Test 46
  it("a throwing editable callback yields not-editable without propagating", () => {
    const column = col({
      editable: () => {
        throw new Error("boom");
      },
    });
    expect(() =>
      resolveCellEditEligibility(eligibilityCtx({ column })),
    ).not.toThrow();
    expect(resolveCellEditEligibility(eligibilityCtx({ column }))).toEqual({
      editable: false,
      reason: "Editable callback threw",
    });
  });

  it("a false-returning callback yields not-editable", () => {
    expect(
      resolveCellEditEligibility(
        eligibilityCtx({ column: col({ editable: () => false }) }),
      ),
    ).toEqual({ editable: false, reason: "Callback returned false" });
  });
});

// ── Test 23: the removed experimental option is gone everywhere ────────

describe("the removed experimental option is fully gone (Test 23)", () => {
  // Built at runtime so this guard file never contains the literal itself.
  const NEEDLE = ["click", "To", "Toggle"].join("");

  it("does not appear in any core source or test file", () => {
    const hits = SOURCE_FILES.filter((f) =>
      readFileSync(f, "utf8").includes(NEEDLE),
    ).map((f) => relative(SRC, f));
    expect(hits).toEqual([]);
  });

});

// ── Test 127: final internal ownership boundary ────────────────────────

describe("final boolean interaction ownership boundary (Test 127)", () => {
  it("keeps boolean mutation and classification off public Grid/package APIs", () => {
    const publicFiles = [
      join(SRC, "Grid.ts"),
      join(SRC, "index.ts"),
      join(SRC, "types.ts"),
      join(REPO, "packages/react/src/index.ts"),
      join(REPO, "packages/react/src/LightFastGrid.tsx"),
    ];
    const internalNames = ["toggleBooleanCell", "getBooleanCellKeyboardMode"];

    const hits = publicFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return internalNames
        .filter((name) => source.includes(name))
        .map((name) => `${relative(REPO, file)}:${name}`);
    });
    expect(hits).toEqual([]);
  });

  it("limits the checkbox input selector to its neutral definition and editing owner", () => {
    const hits = SOURCE_FILES.filter((f) => {
      if (f.includes("__tests__") || f.includes("CellShellManager.ts")) return false;
      const src = readFileSync(f, "utf8");
      return src.includes("CELL_SHELL_CHECKBOX_INPUT_SELECTOR");
    }).map((f) => relative(SRC, f));
    expect(hits).toEqual([
      "features/cell-shells/cellShellActionDom.ts",
      "features/cell-shells/index.ts",
      "features/editing/EditingController.ts",
    ]);
  });
});
