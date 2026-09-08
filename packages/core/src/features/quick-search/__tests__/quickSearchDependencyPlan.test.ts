import { describe, expect, it } from "vitest";

import type { RowStoreDirtyMetadata } from "../../../row-model/store/RowStore.types";
import type { ColumnDef } from "../../../types";
import { createNormalizer, defaultNormalizer, getNormalizerSignature } from "../normalizer";
import {
  buildQuickSearchDependencyPlan,
  doDirtyFieldsTouchQuickSearchPlan,
} from "../quickSearchDependencyPlan";
import { resolveSearchableFieldsFromConfig } from "../searchableFieldResolver";

function col(partial: Partial<ColumnDef> & { field: string }): ColumnDef {
  return { ...partial };
}

function dirty(
  fieldsByRow: Record<string, string[]>,
  opts?: { structural?: boolean },
): RowStoreDirtyMetadata {
  const dirtyFieldsByRowId = new Map<string, ReadonlySet<string>>();
  for (const [rowId, fields] of Object.entries(fieldsByRow)) {
    dirtyFieldsByRowId.set(rowId, new Set(fields));
  }
  return {
    structural: opts?.structural ?? false,
    updatedRowIds: new Set(Object.keys(fieldsByRow)),
    dirtyFieldsByRowId,
    updatedSourceIndexes: new Set(),
    dirtyFieldsBySourceIndex: new Map(),
  };
}

function emptyDirty(): RowStoreDirtyMetadata {
  return {
    structural: false,
    updatedRowIds: new Set(),
    dirtyFieldsByRowId: new Map(),
    updatedSourceIndexes: new Set(),
    dirtyFieldsBySourceIndex: new Map(),
  };
}

describe("buildQuickSearchDependencyPlan", () => {
  // ── Basic field resolution ──────────────────────────────────────────

  it("includes raw searchable fields", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" }), col({ field: "city" })],
      true,
    );
    expect(plan.exactDirtyFieldWatchSet).toEqual(new Set(["name", "city"]));
    expect(plan.descriptors).toHaveLength(2);
  });

  it("includes projection fields in exact watch set", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "balance", quickFilterTextField: "balanceSearch" })],
      true,
    );
    expect(plan.exactDirtyFieldWatchSet).toEqual(
      new Set(["balance", "balanceSearch"]),
    );
  });

  it("excludes hidden columns by default", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" }), col({ field: "secret", visible: false })],
      true,
    );
    expect(plan.exactDirtyFieldWatchSet).toEqual(new Set(["name"]));
  });

  it("includes hidden columns when configured", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" }), col({ field: "secret", visible: false })],
      { includeHiddenColumns: true },
    );
    expect(plan.exactDirtyFieldWatchSet).toEqual(new Set(["name", "secret"]));
  });

  it("excludes searchable: false columns", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" }), col({ field: "actions", searchable: false })],
      true,
    );
    expect(plan.exactDirtyFieldWatchSet).toEqual(new Set(["name"]));
  });

  // ── Disabled quick filter ───────────────────────────────────────────

  it("disabled quick filter (false) uses default normalizer signature", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" })],
      false,
    );
    expect(plan.descriptors).toHaveLength(0);
    expect(plan.exactDirtyFieldWatchSet.size).toBe(0);
    expect(plan.dirtyFieldRootWatchSet.size).toBe(0);
    expect(plan.workerSafe).toBe(false);
    expect(plan.dependsOnAllRowFields).toBe(false);
    expect(plan.fieldsSignature).toBe("sf|disabled");
    expect(plan.normalizerSignature).toBe(
      getNormalizerSignature(defaultNormalizer),
    );
  });

  it("disabled quick filter ({ enabled: false }) uses default normalizer signature", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" })],
      { enabled: false },
    );
    expect(plan.descriptors).toHaveLength(0);
    expect(plan.workerSafe).toBe(false);
    expect(plan.normalizerSignature).toBe(
      getNormalizerSignature(defaultNormalizer),
    );
  });

  it("disabled plan with custom normalizer retains the custom signature", () => {
    const custom = createNormalizer({ version: "custom-v3" });
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" })],
      false,
      custom,
    );
    expect(plan.descriptors).toHaveLength(0);
    expect(plan.workerSafe).toBe(false);
    expect(plan.fieldsSignature).toBe("sf|disabled");
    expect(plan.normalizerSignature).toBe("custom-v3");
  });

  // ── Dot-path prefix watch set ───────────────────────────────────────

  it("builds every-level parent prefixes for dot-path fields", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "user.profile.name" })],
      true,
    );
    expect(plan.dirtyFieldRootWatchSet).toEqual(
      new Set(["user", "user.profile"]),
    );
  });

  it("flat fields produce no root prefixes", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" })],
      true,
    );
    expect(plan.dirtyFieldRootWatchSet.size).toBe(0);
  });

  it("single-dot field produces one prefix", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "user.name" })],
      true,
    );
    expect(plan.dirtyFieldRootWatchSet).toEqual(new Set(["user"]));
  });

  it("projection dot-path also contributes prefixes", () => {
    const plan = buildQuickSearchDependencyPlan(
      [
        col({
          field: "data.value",
          quickFilterTextField: "data.search.text",
        }),
      ],
      true,
    );
    expect(plan.dirtyFieldRootWatchSet).toEqual(
      new Set(["data", "data.search"]),
    );
  });

  // ── workerSafe ──────────────────────────────────────────────────────

  it("workerSafe is true when all descriptors are worker-eligible and no custom parser/matcher", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" }), col({ field: "city" })],
      true,
    );
    expect(plan.workerSafe).toBe(true);
    expect(plan.dependsOnAllRowFields).toBe(false);
  });

  it("custom parser makes workerSafe false", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" })],
      { parser: (t) => t.split(",") },
    );
    expect(plan.workerSafe).toBe(false);
    expect(plan.dependsOnAllRowFields).toBe(false);
  });

  it("custom matcher makes workerSafe false", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" })],
      { matcher: () => true },
    );
    expect(plan.workerSafe).toBe(false);
    expect(plan.dependsOnAllRowFields).toBe(false);
  });

  it("valueGetter without projection makes workerSafe false and dependsOnAllRowFields true", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "oct", valueGetter: () => "High" })],
      true,
    );
    expect(plan.workerSafe).toBe(false);
    expect(plan.dependsOnAllRowFields).toBe(true);
  });

  it("getQuickFilterText without projection makes workerSafe false and dependsOnAllRowFields true", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name", getQuickFilterText: () => "custom" })],
      true,
    );
    expect(plan.workerSafe).toBe(false);
    expect(plan.dependsOnAllRowFields).toBe(true);
  });

  it("projection field restores worker eligibility and keeps field-selective dependency", () => {
    const plan = buildQuickSearchDependencyPlan(
      [
        col({
          field: "oct",
          valueGetter: () => "High",
          quickFilterTextField: "octText",
        }),
      ],
      true,
    );
    expect(plan.workerSafe).toBe(true);
    expect(plan.dependsOnAllRowFields).toBe(false);
  });

  it("custom parser alone does not enable dependsOnAllRowFields", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" }), col({ field: "city" })],
      { parser: (t) => t.split(" ") },
    );
    expect(plan.dependsOnAllRowFields).toBe(false);
    expect(plan.workerSafe).toBe(false);
  });

  // ── Signatures ──────────────────────────────────────────────────────

  it("fieldsSignature matches resolver signature", () => {
    const columns = [
      col({ field: "name" }),
      col({ field: "balance", quickFilterTextField: "balanceSearch" }),
    ];
    const plan = buildQuickSearchDependencyPlan(columns, true);
    const resolution = resolveSearchableFieldsFromConfig(columns, true);
    expect(plan.fieldsSignature).toBe(resolution.signature);
  });

  it("normalizerSignature matches default normalizer", () => {
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" })],
      true,
    );
    expect(plan.normalizerSignature).toBe(
      getNormalizerSignature(defaultNormalizer),
    );
  });

  it("normalizerSignature uses provided normalizer", () => {
    const custom = createNormalizer({ version: "custom-v2" });
    const plan = buildQuickSearchDependencyPlan(
      [col({ field: "name" })],
      true,
      custom,
    );
    expect(plan.normalizerSignature).toBe("custom-v2");
  });

  it("signatures are stable across identical calls", () => {
    const columns = [col({ field: "name" }), col({ field: "city" })];
    const a = buildQuickSearchDependencyPlan(columns, true);
    const b = buildQuickSearchDependencyPlan(columns, true);
    expect(a.fieldsSignature).toBe(b.fieldsSignature);
    expect(a.normalizerSignature).toBe(b.normalizerSignature);
  });
});

describe("doDirtyFieldsTouchQuickSearchPlan", () => {
  const plan = buildQuickSearchDependencyPlan(
    [
      col({ field: "name" }),
      col({ field: "user.profile.name" }),
      col({ field: "balance", quickFilterTextField: "balanceSearch" }),
    ],
    true,
  );

  // ── Exact matches ───────────────────────────────────────────────────

  it("exact field match returns true", () => {
    expect(doDirtyFieldsTouchQuickSearchPlan(plan, dirty({ r1: ["name"] }))).toBe(true);
  });

  it("exact projection field match returns true", () => {
    expect(
      doDirtyFieldsTouchQuickSearchPlan(plan, dirty({ r1: ["balanceSearch"] })),
    ).toBe(true);
  });

  // ── Every-level parent prefix matches ───────────────────────────────

  it("immediate parent prefix matches", () => {
    expect(
      doDirtyFieldsTouchQuickSearchPlan(plan, dirty({ r1: ["user.profile"] })),
    ).toBe(true);
  });

  it("root parent prefix matches", () => {
    expect(
      doDirtyFieldsTouchQuickSearchPlan(plan, dirty({ r1: ["user"] })),
    ).toBe(true);
  });

  // ── Sibling does not match ──────────────────────────────────────────

  it("sibling nested path does not match", () => {
    expect(
      doDirtyFieldsTouchQuickSearchPlan(plan, dirty({ r1: ["user.age"] })),
    ).toBe(false);
  });

  it("sibling at deeper level does not match", () => {
    expect(
      doDirtyFieldsTouchQuickSearchPlan(plan, dirty({ r1: ["user.profile.age"] })),
    ).toBe(false);
  });

  // ── Unrelated fields ────────────────────────────────────────────────

  it("unrelated fields do not match", () => {
    expect(
      doDirtyFieldsTouchQuickSearchPlan(plan, dirty({ r1: ["email"] })),
    ).toBe(false);
  });

  // ── Structural ──────────────────────────────────────────────────────

  it("structural metadata returns true", () => {
    expect(
      doDirtyFieldsTouchQuickSearchPlan(plan, dirty({}, { structural: true })),
    ).toBe(true);
  });

  // ── No updated rows ─────────────────────────────────────────────────

  it("empty dirty metadata returns false", () => {
    expect(doDirtyFieldsTouchQuickSearchPlan(plan, emptyDirty())).toBe(false);
  });

  // ── Conservative partial metadata ────────────────────────────────────

  it("updated row with missing map entry returns true conservatively", () => {
    const d: RowStoreDirtyMetadata = {
      structural: false,
      updatedRowIds: new Set(["r1"]),
      dirtyFieldsByRowId: new Map(),
      dirtyFieldsBySourceIndex: new Map(),
      updatedSourceIndexes: new Set(),
    };
    expect(doDirtyFieldsTouchQuickSearchPlan(plan, d)).toBe(true);
  });

  it("updated row mapped to empty field set is skipped (proved no change)", () => {
    const d: RowStoreDirtyMetadata = {
      structural: false,
      updatedRowIds: new Set(["r1"]),
      dirtyFieldsByRowId: new Map([["r1", new Set<string>()]]),
      dirtyFieldsBySourceIndex: new Map(),
      updatedSourceIndexes: new Set(),
    };
    expect(doDirtyFieldsTouchQuickSearchPlan(plan, d)).toBe(false);
  });

  it("dependsOnAllRowFields treats cross-field valueGetter dependency as touched", () => {
    const allRowPlan = buildQuickSearchDependencyPlan(
      [
        col({
          field: "fullName",
          valueGetter: ({ row }: { row: Record<string, unknown> }) =>
            `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`,
        }),
      ],
      true,
    );
    expect(allRowPlan.dependsOnAllRowFields).toBe(true);
    expect(
      doDirtyFieldsTouchQuickSearchPlan(allRowPlan, dirty({ r1: ["firstName"] })),
    ).toBe(true);
    expect(
      doDirtyFieldsTouchQuickSearchPlan(allRowPlan, dirty({ r1: ["lastName"] })),
    ).toBe(true);
  });

  it("two updated rows with metadata missing for one returns true", () => {
    const d: RowStoreDirtyMetadata = {
      structural: false,
      updatedRowIds: new Set(["r1", "r2"]),
      dirtyFieldsByRowId: new Map([["r1", new Set(["email"])]]),
      dirtyFieldsBySourceIndex: new Map(),
      updatedSourceIndexes: new Set(),
    };
    expect(doDirtyFieldsTouchQuickSearchPlan(plan, d)).toBe(true);
  });

  it("updatedSourceIndexes present with no row IDs or map returns true", () => {
    const d: RowStoreDirtyMetadata = {
      structural: false,
      updatedRowIds: new Set(),
      dirtyFieldsByRowId: new Map(),
      dirtyFieldsBySourceIndex: new Map(),
      updatedSourceIndexes: new Set([5]),
    };
    expect(doDirtyFieldsTouchQuickSearchPlan(plan, d)).toBe(true);
  });

  it("complete unrelated metadata for every updated row returns false", () => {
    const d: RowStoreDirtyMetadata = {
      structural: false,
      updatedRowIds: new Set(["r1", "r2"]),
      dirtyFieldsByRowId: new Map([
        ["r1", new Set(["email"])],
        ["r2", new Set(["phone"])],
      ]),
      dirtyFieldsBySourceIndex: new Map(),
      updatedSourceIndexes: new Set(),
    };
    expect(doDirtyFieldsTouchQuickSearchPlan(plan, d)).toBe(false);
  });

  it("complete metadata with one matching field returns true", () => {
    const d: RowStoreDirtyMetadata = {
      structural: false,
      updatedRowIds: new Set(["r1", "r2"]),
      dirtyFieldsByRowId: new Map([
        ["r1", new Set(["email"])],
        ["r2", new Set(["name"])],
      ]),
      dirtyFieldsBySourceIndex: new Map(),
      updatedSourceIndexes: new Set(),
    };
    expect(doDirtyFieldsTouchQuickSearchPlan(plan, d)).toBe(true);
  });

  // ── Watch-set reference stability ───────────────────────────────────

  it("matcher reuses plan watch-set references without mutation", () => {
    const frozenPlan = buildQuickSearchDependencyPlan(
      [col({ field: "name" }), col({ field: "city" })],
      true,
    );
    const descriptorsBefore = frozenPlan.descriptors;
    const exactBefore = frozenPlan.exactDirtyFieldWatchSet;
    const rootBefore = frozenPlan.dirtyFieldRootWatchSet;

    doDirtyFieldsTouchQuickSearchPlan(frozenPlan, dirty({ r1: ["name"] }));
    doDirtyFieldsTouchQuickSearchPlan(frozenPlan, dirty({ r1: ["other"] }));

    expect(frozenPlan.descriptors).toBe(descriptorsBefore);
    expect(frozenPlan.exactDirtyFieldWatchSet).toBe(exactBefore);
    expect(frozenPlan.dirtyFieldRootWatchSet).toBe(rootBefore);
  });
});
