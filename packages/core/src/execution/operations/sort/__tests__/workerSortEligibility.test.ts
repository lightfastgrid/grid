import { describe, expect, it } from "vitest";

import type { ColumnDef, SortModel } from "../../../../types";
import { resolveWorkerSortEligibility } from "../sortWorkerEligibility";

function col(field: string, overrides?: Partial<ColumnDef>): ColumnDef {
  return { field, sortable: true, ...overrides } as ColumnDef;
}

describe("resolveWorkerSortEligibility", () => {
  // ── Ineligible cases ────────────────────────────────────────────────

  it("empty sort model is not eligible", () => {
    const result = resolveWorkerSortEligibility([], [col("score")]);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("empty-sort");
    expect(result.entries).toEqual([]);
  });

  it("unknown field with nothing remaining gives no-resolvable-columns", () => {
    const model: SortModel = [{ field: "missing", sort: "asc" }];
    const result = resolveWorkerSortEligibility(model, [col("score")]);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("no-resolvable-columns");
    expect(result.entries).toEqual([]);
  });

  it("valueGetter makes request ineligible", () => {
    const columns = [col("score", { valueGetter: () => 42 })];
    const model: SortModel = [{ field: "score", sort: "asc" }];
    const result = resolveWorkerSortEligibility(model, columns);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("value-getter");
    expect(result.entries).toEqual([]);
  });

  it("sortComparator makes request ineligible", () => {
    const columns = [col("score", { sortComparator: (a, b) => (a as number) - (b as number) })];
    const model: SortModel = [{ field: "score", sort: "asc" }];
    const result = resolveWorkerSortEligibility(model, columns);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("custom-comparator");
    expect(result.entries).toEqual([]);
  });

  it("mixed model with one serializable and one valueGetter is ineligible", () => {
    const columns = [
      col("name"),
      col("computed", { valueGetter: () => "x" }),
    ];
    const model: SortModel = [
      { field: "name", sort: "asc" },
      { field: "computed", sort: "desc" },
    ];
    const result = resolveWorkerSortEligibility(model, columns);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("value-getter");
  });

  it("mixed model with one serializable and one sortComparator is ineligible", () => {
    const columns = [
      col("name"),
      col("score", { sortComparator: (a, b) => (a as number) - (b as number) }),
    ];
    const model: SortModel = [
      { field: "name", sort: "asc" },
      { field: "score", sort: "desc" },
    ];
    const result = resolveWorkerSortEligibility(model, columns);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("custom-comparator");
  });

  // ── Eligible cases ──────────────────────────────────────────────────

  it("single normal field is eligible", () => {
    const result = resolveWorkerSortEligibility(
      [{ field: "score", sort: "asc" }],
      [col("score")],
    );
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.entries).toEqual([
      { field: "score", dir: 1, pathParts: null },
    ]);
  });

  it("single desc field sets dir to -1", () => {
    const result = resolveWorkerSortEligibility(
      [{ field: "score", sort: "desc" }],
      [col("score")],
    );
    expect(result.eligible).toBe(true);
    expect(result.entries[0]!.dir).toBe(-1);
  });

  it("dot-path field is eligible and sets pathParts", () => {
    const result = resolveWorkerSortEligibility(
      [{ field: "address.city", sort: "asc" }],
      [col("address.city")],
    );
    expect(result.eligible).toBe(true);
    expect(result.entries).toEqual([
      { field: "address.city", dir: 1, pathParts: ["address", "city"] },
    ]);
  });

  it("deeply nested dot-path splits all segments", () => {
    const result = resolveWorkerSortEligibility(
      [{ field: "a.b.c.d", sort: "desc" }],
      [col("a.b.c.d")],
    );
    expect(result.eligible).toBe(true);
    expect(result.entries[0]!.pathParts).toEqual(["a", "b", "c", "d"]);
  });

  it("multi-column built-in sort is eligible and preserves order", () => {
    const columns = [col("name"), col("score"), col("age")];
    const model: SortModel = [
      { field: "score", sort: "desc" },
      { field: "name", sort: "asc" },
      { field: "age", sort: "asc" },
    ];
    const result = resolveWorkerSortEligibility(model, columns);
    expect(result.eligible).toBe(true);
    expect(result.entries).toEqual([
      { field: "score", dir: -1, pathParts: null },
      { field: "name", dir: 1, pathParts: null },
      { field: "age", dir: 1, pathParts: null },
    ]);
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  it("unknown field is silently skipped; remaining entries are eligible", () => {
    const columns = [col("score")];
    const model: SortModel = [
      { field: "missing", sort: "asc" },
      { field: "score", sort: "desc" },
    ];
    const result = resolveWorkerSortEligibility(model, columns);
    expect(result.eligible).toBe(true);
    expect(result.entries).toEqual([
      { field: "score", dir: -1, pathParts: null },
    ]);
  });

  it("all unknown fields gives no-resolvable-columns", () => {
    const model: SortModel = [
      { field: "x", sort: "asc" },
      { field: "y", sort: "desc" },
    ];
    const result = resolveWorkerSortEligibility(model, [col("z")]);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("no-resolvable-columns");
  });

  it("valueGetter on first column short-circuits before processing second", () => {
    const columns = [
      col("computed", { valueGetter: () => 1 }),
      col("name"),
    ];
    const model: SortModel = [
      { field: "computed", sort: "asc" },
      { field: "name", sort: "asc" },
    ];
    const result = resolveWorkerSortEligibility(model, columns);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("value-getter");
    expect(result.entries).toEqual([]);
  });

  it("eligible entries are empty array when ineligible", () => {
    const columns = [col("score", { sortComparator: () => 0 })];
    const model: SortModel = [{ field: "score", sort: "asc" }];
    const result = resolveWorkerSortEligibility(model, columns);
    expect(result.entries).toEqual([]);
  });
});
