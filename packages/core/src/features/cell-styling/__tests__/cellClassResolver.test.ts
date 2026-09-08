// Pure-resolver unit tests. No DOM access, no Grid mount required.

import { describe, expect, it, vi } from "vitest";

import type { Grid } from "../../../Grid";
import type { ColumnDef, RowData } from "../../../types";
import type {
  CellClassParams,
  CellClassRules,
} from "..";
import { resolveCellClasses } from "..";

/**
 * Build a minimal `CellClassParams` for tests. `grid` is typed as `Grid` but
 * the resolver never reads it — a sentinel object suffices.
 */
function makeParams(overrides?: Partial<CellClassParams>): CellClassParams {
  const column: ColumnDef = { field: "amount" };
  return {
    row: { id: "r1", amount: 42 } as RowData,
    rowIndex: 0,
    rowId: "r1",
    column,
    field: column.field,
    value: 42,
    grid: {} as Grid,
    ...overrides,
  };
}

describe("resolveCellClasses", () => {
  it("returns an empty list when nothing is provided", () => {
    expect(resolveCellClasses({ params: makeParams() })).toEqual([]);
  });

  // ── Static cellClass ───────────────────────────────────────────────

  it("accepts a single static cellClass string", () => {
    expect(
      resolveCellClasses({ cellClass: "money", params: makeParams() }),
    ).toEqual(["money"]);
  });

  it("splits whitespace inside a static cellClass string", () => {
    expect(
      resolveCellClasses({
        cellClass: "  money   right-align  ",
        params: makeParams(),
      }),
    ).toEqual(["money", "right-align"]);
  });

  it("accepts a static cellClass string array", () => {
    expect(
      resolveCellClasses({
        cellClass: ["a", "b c", "d"],
        params: makeParams(),
      }),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("drops empty / whitespace-only tokens from cellClass", () => {
    expect(
      resolveCellClasses({
        cellClass: ["", "   ", "real"],
        params: makeParams(),
      }),
    ).toEqual(["real"]);
  });

  // ── Functional getCellClass ────────────────────────────────────────

  it("uses getCellClass that returns a string", () => {
    expect(
      resolveCellClasses({
        getCellClass: () => "dynamic",
        params: makeParams(),
      }),
    ).toEqual(["dynamic"]);
  });

  it("uses getCellClass that returns an array", () => {
    expect(
      resolveCellClasses({
        getCellClass: () => ["x", "y z"],
        params: makeParams(),
      }),
    ).toEqual(["x", "y", "z"]);
  });

  it("ignores getCellClass when it returns null", () => {
    expect(
      resolveCellClasses({
        getCellClass: () => null,
        params: makeParams(),
      }),
    ).toEqual([]);
  });

  it("ignores getCellClass when it returns undefined", () => {
    expect(
      resolveCellClasses({
        getCellClass: () => undefined,
        params: makeParams(),
      }),
    ).toEqual([]);
  });

  it("ignores getCellClass when it returns false", () => {
    expect(
      resolveCellClasses({
        getCellClass: () => false,
        params: makeParams(),
      }),
    ).toEqual([]);
  });

  it("passes a `CellClassParams` to getCellClass", () => {
    const spy = vi.fn((p: CellClassParams) => `${p.field}-${String(p.value)}`);
    const params = makeParams({
      rowIndex: 7,
      rowId: "r-7",
      value: 100,
    });
    resolveCellClasses({ getCellClass: spy, params });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(params);
  });

  // ── cellClassRules ─────────────────────────────────────────────────

  it("adds class names from rules whose predicate returns true", () => {
    const rules: CellClassRules = {
      positive: (p) => (p.value as number) > 0,
      negative: (p) => (p.value as number) < 0,
      large: (p) => (p.value as number) > 1000,
    };
    expect(
      resolveCellClasses({
        cellClassRules: rules,
        params: makeParams({ value: 42 }),
      }),
    ).toEqual(["positive"]);
  });

  it("skips non-function rule entries (e.g. AG Grid string expressions)", () => {
    // Production `CellClassRules` is function-only; runtime still skips foreign
    // string expressions (AG Grid). Inject the string after typing the map so
    // the fixture stays type-correct without unsafe casts.
    const rules: CellClassRules = {
      positive: (p: CellClassParams) => (p.value as number) > 0,
    };
    Reflect.set(rules, "currency-cell", 'typeof x == "number"');
    expect(
      resolveCellClasses({
        cellClassRules: rules,
        params: makeParams({ value: 42 }),
      }),
    ).toEqual(["positive"]);
  });

  it("passes a `CellClassParams` to each rule predicate", () => {
    const a = vi.fn(() => true);
    const b = vi.fn(() => false);
    const params = makeParams({ rowIndex: 3, value: "hi" });
    resolveCellClasses({
      cellClassRules: { a, b },
      params,
    });
    expect(a).toHaveBeenCalledWith(params);
    expect(b).toHaveBeenCalledWith(params);
  });

  it("splits whitespace inside a rule key (treats multi-class keys as separate classes)", () => {
    expect(
      resolveCellClasses({
        cellClassRules: { "a b": () => true, c: () => true },
        params: makeParams(),
      }),
    ).toEqual(["a", "b", "c"]);
  });

  it("lets predicate errors propagate (does NOT swallow)", () => {
    const boom: CellClassRules = {
      ok: () => true,
      explode: () => {
        throw new Error("rule blew up");
      },
    };
    expect(() =>
      resolveCellClasses({ cellClassRules: boom, params: makeParams() }),
    ).toThrow(/rule blew up/);
  });

  it("lets getCellClass errors propagate (does NOT swallow)", () => {
    expect(() =>
      resolveCellClasses({
        getCellClass: () => {
          throw new Error("hook blew up");
        },
        params: makeParams(),
      }),
    ).toThrow(/hook blew up/);
  });

  // ── Composition order: cellClass → getCellClass → cellClassRules ───

  it("merges all three sources in the documented order", () => {
    expect(
      resolveCellClasses({
        cellClass: "static",
        getCellClass: () => "dynamic",
        cellClassRules: { ruled: () => true },
        params: makeParams(),
      }),
    ).toEqual(["static", "dynamic", "ruled"]);
  });

  // ── Dedupe & ordering ─────────────────────────────────────────────

  it("dedupes while preserving first-seen order across all sources", () => {
    expect(
      resolveCellClasses({
        cellClass: ["a", "b"],
        getCellClass: () => ["b", "c"], // 'b' already seen → skipped
        cellClassRules: {
          c: () => true, // 'c' already seen → skipped
          d: () => true,
        },
        params: makeParams(),
      }),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("dedupes whitespace-split tokens from a single string", () => {
    expect(
      resolveCellClasses({
        cellClass: "a b a c b",
        params: makeParams(),
      }),
    ).toEqual(["a", "b", "c"]);
  });

  it("dedupes across cellClass string and array entries", () => {
    expect(
      resolveCellClasses({
        cellClass: ["a b", "b c"],
        params: makeParams(),
      }),
    ).toEqual(["a", "b", "c"]);
  });

  // ── Robustness ────────────────────────────────────────────────────

  it("does NOT touch the DOM or mutate the params object", () => {
    const params = makeParams();
    const snapshot = JSON.parse(
      JSON.stringify({ ...params, grid: undefined, column: undefined }),
    );
    resolveCellClasses({
      cellClass: "a",
      getCellClass: () => "b",
      cellClassRules: { c: () => true },
      params,
    });
    // Params untouched (excluding grid + column which are object refs).
    expect({ ...params, grid: undefined, column: undefined }).toEqual(snapshot);
  });
});
