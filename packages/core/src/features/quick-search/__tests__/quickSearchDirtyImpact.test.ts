import { describe, expect, it } from "vitest";

import type { RowStoreDirtyMetadata } from "../../../row-model/store/RowStore.types";
import type { ColumnDef } from "../../../types";
import { buildQuickSearchDependencyPlan } from "../quickSearchDependencyPlan";
import { analyzeQuickSearchDirtyImpact } from "../quickSearchDirtyImpact";

function col(partial: Partial<ColumnDef> & { field: string }): ColumnDef {
  return { ...partial };
}

function dirty(opts: {
  structural?: boolean;
  rowIds?: string[];
  indexes?: number[];
  fieldsByIndex?: Record<number, string[] | undefined>;
}): RowStoreDirtyMetadata {
  const dirtyFieldsBySourceIndex = new Map<number, ReadonlySet<string>>();
  for (const [index, fields] of Object.entries(opts.fieldsByIndex ?? {})) {
    if (fields === undefined) continue;
    dirtyFieldsBySourceIndex.set(Number(index), new Set(fields));
  }
  return {
    structural: opts.structural ?? false,
    updatedRowIds: new Set(opts.rowIds ?? []),
    dirtyFieldsByRowId: new Map(),
    updatedSourceIndexes: new Set(opts.indexes ?? []),
    dirtyFieldsBySourceIndex,
  };
}

describe("analyzeQuickSearchDirtyImpact", () => {
  const plan = buildQuickSearchDependencyPlan(
    [
      col({ field: "name" }),
      col({ field: "city" }),
      col({ field: "age", searchable: false }),
      col({ field: "user.profile.name" }),
    ],
    true,
  );

  it("retains only searchable-matching source indexes", () => {
    const impact = analyzeQuickSearchDirtyImpact(
      plan,
      dirty({
        rowIds: ["1", "2", "3"],
        indexes: [0, 1, 2],
        fieldsByIndex: {
          0: ["age"],
          1: ["name"],
          2: ["age"],
        },
      }),
    );
    expect(impact.touched).toBe(true);
    expect([...impact.sourceIndexes]).toEqual([1]);
    expect(impact.sourceIndexCoverageComplete).toBe(true);
  });

  it("includes indexes conservatively when field metadata is missing", () => {
    const impact = analyzeQuickSearchDirtyImpact(
      plan,
      dirty({
        rowIds: ["1"],
        indexes: [5],
        fieldsByIndex: {},
      }),
    );
    expect(impact.touched).toBe(true);
    expect([...impact.sourceIndexes]).toEqual([5]);
  });

  it("skips indexes with empty field sets (proved no top-level change)", () => {
    const impact = analyzeQuickSearchDirtyImpact(
      plan,
      dirty({
        rowIds: ["1"],
        indexes: [0],
        fieldsByIndex: { 0: [] },
      }),
    );
    expect(impact.touched).toBe(false);
    expect(impact.sourceIndexes.size).toBe(0);
  });

  it("reports incomplete coverage when row IDs outnumber source indexes", () => {
    const impact = analyzeQuickSearchDirtyImpact(
      plan,
      dirty({
        rowIds: ["a", "b"],
        indexes: [0],
        fieldsByIndex: { 0: ["age"] },
      }),
    );
    expect(impact.touched).toBe(true);
    expect(impact.sourceIndexCoverageComplete).toBe(false);
    expect(impact.sourceIndexes.size).toBe(0);
  });

  it("matches dot-path parent replacements via root watch set", () => {
    const impact = analyzeQuickSearchDirtyImpact(
      plan,
      dirty({
        rowIds: ["1"],
        indexes: [0],
        fieldsByIndex: { 0: ["user"] },
      }),
    );
    expect(impact.touched).toBe(true);
    expect([...impact.sourceIndexes]).toEqual([0]);
  });

  it("unrelated fields alone do not touch", () => {
    const impact = analyzeQuickSearchDirtyImpact(
      plan,
      dirty({
        rowIds: ["1"],
        indexes: [0],
        fieldsByIndex: { 0: ["age"] },
      }),
    );
    expect(impact.touched).toBe(false);
    expect(impact.sourceIndexes.size).toBe(0);
  });

  it("filters unrelated indexes for partially-skipped structural metadata", () => {
    // Mimics applyStructural when add/remove were requested but skipped:
    // source indexes remain valid and fields are keyed by index.
    const impact = analyzeQuickSearchDirtyImpact(
      plan,
      dirty({
        rowIds: ["1", "2", "3"],
        indexes: [0, 1, 2],
        fieldsByIndex: {
          0: ["age"],
          1: ["name"],
          2: ["age"],
        },
      }),
    );
    expect(impact.touched).toBe(true);
    expect([...impact.sourceIndexes]).toEqual([1]);
    expect(impact.sourceIndexCoverageComplete).toBe(true);
  });

  it("valueGetter without projection treats any non-empty dirty fields as touched", () => {
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

    const first = analyzeQuickSearchDirtyImpact(
      allRowPlan,
      dirty({
        rowIds: ["1"],
        indexes: [0],
        fieldsByIndex: { 0: ["firstName"] },
      }),
    );
    expect(first.touched).toBe(true);
    expect([...first.sourceIndexes]).toEqual([0]);

    const last = analyzeQuickSearchDirtyImpact(
      allRowPlan,
      dirty({
        rowIds: ["1"],
        indexes: [0],
        fieldsByIndex: { 0: ["lastName"] },
      }),
    );
    expect(last.touched).toBe(true);
    expect([...last.sourceIndexes]).toEqual([0]);
  });

  it("getQuickFilterText without projection treats cross-field edits as touched", () => {
    const allRowPlan = buildQuickSearchDependencyPlan(
      [
        col({
          field: "label",
          getQuickFilterText: ({ row }: { row: Record<string, unknown> }) =>
            String(row.other ?? ""),
        }),
      ],
      true,
    );
    const impact = analyzeQuickSearchDirtyImpact(
      allRowPlan,
      dirty({
        rowIds: ["1"],
        indexes: [0],
        fieldsByIndex: { 0: ["other"] },
      }),
    );
    expect(impact.touched).toBe(true);
    expect([...impact.sourceIndexes]).toEqual([0]);
  });

  it("valueFormatter without projection treats cross-field edits as touched", () => {
    const allRowPlan = buildQuickSearchDependencyPlan(
      [
        col({
          field: "display",
          valueFormatter: ({ row }: { row: Record<string, unknown> }) =>
            String(row.raw ?? ""),
        }),
      ],
      true,
    );
    const impact = analyzeQuickSearchDirtyImpact(
      allRowPlan,
      dirty({
        rowIds: ["1"],
        indexes: [0],
        fieldsByIndex: { 0: ["raw"] },
      }),
    );
    expect(impact.touched).toBe(true);
    expect([...impact.sourceIndexes]).toEqual([0]);
  });

  it("callback plus projection field remains field-selective", () => {
    const selective = buildQuickSearchDependencyPlan(
      [
        col({
          field: "fullName",
          valueGetter: ({ row }: { row: Record<string, unknown> }) =>
            `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`,
          quickFilterTextField: "fullNameSearch",
        }),
      ],
      true,
    );
    expect(selective.dependsOnAllRowFields).toBe(false);

    const unrelated = analyzeQuickSearchDirtyImpact(
      selective,
      dirty({
        rowIds: ["1"],
        indexes: [0],
        fieldsByIndex: { 0: ["firstName"] },
      }),
    );
    expect(unrelated.touched).toBe(false);
    expect(unrelated.sourceIndexes.size).toBe(0);

    const projection = analyzeQuickSearchDirtyImpact(
      selective,
      dirty({
        rowIds: ["1"],
        indexes: [0],
        fieldsByIndex: { 0: ["fullNameSearch"] },
      }),
    );
    expect(projection.touched).toBe(true);
    expect([...projection.sourceIndexes]).toEqual([0]);
  });

  it("dependsOnAllRowFields still skips empty field sets", () => {
    const allRowPlan = buildQuickSearchDependencyPlan(
      [col({ field: "oct", valueGetter: () => "High" })],
      true,
    );
    const impact = analyzeQuickSearchDirtyImpact(
      allRowPlan,
      dirty({
        rowIds: ["1"],
        indexes: [0],
        fieldsByIndex: { 0: [] },
      }),
    );
    expect(impact.touched).toBe(false);
    expect(impact.sourceIndexes.size).toBe(0);
  });

  it("dependsOnAllRowFields still includes missing metadata conservatively", () => {
    const allRowPlan = buildQuickSearchDependencyPlan(
      [col({ field: "oct", valueGetter: () => "High" })],
      true,
    );
    const impact = analyzeQuickSearchDirtyImpact(
      allRowPlan,
      dirty({
        rowIds: ["1"],
        indexes: [4],
        fieldsByIndex: {},
      }),
    );
    expect(impact.touched).toBe(true);
    expect([...impact.sourceIndexes]).toEqual([4]);
  });

  it("large mixed batch with arbitrary callbacks retains every genuinely changed index", () => {
    const allRowPlan = buildQuickSearchDependencyPlan(
      [
        col({
          field: "fullName",
          valueGetter: ({ row }: { row: Record<string, unknown> }) =>
            `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`,
        }),
        col({ field: "age", searchable: false }),
      ],
      true,
    );
    const fieldsByIndex: Record<number, string[]> = {};
    for (let i = 0; i < 100; i++) {
      fieldsByIndex[i] = i % 2 === 0 ? ["firstName"] : ["notes"];
    }
    const impact = analyzeQuickSearchDirtyImpact(
      allRowPlan,
      dirty({
        rowIds: Array.from({ length: 100 }, (_, i) => String(i)),
        indexes: Array.from({ length: 100 }, (_, i) => i),
        fieldsByIndex,
      }),
    );
    expect(impact.touched).toBe(true);
    expect(impact.sourceIndexes.size).toBe(100);
  });

  it("custom parser alone does not retain unrelated dirty indexes", () => {
    const parserPlan = buildQuickSearchDependencyPlan(
      [col({ field: "name" })],
      { parser: (t) => t.split(" ") },
    );
    expect(parserPlan.dependsOnAllRowFields).toBe(false);
    const impact = analyzeQuickSearchDirtyImpact(
      parserPlan,
      dirty({
        rowIds: ["1"],
        indexes: [0],
        fieldsByIndex: { 0: ["age"] },
      }),
    );
    expect(impact.touched).toBe(false);
    expect(impact.sourceIndexes.size).toBe(0);
  });
});
