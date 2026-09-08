import { describe, expect, it, vi } from "vitest";

import { createDisplayRowReader } from "../../rendering/rowViewAccess";
import { GridState } from "../../state/GridState";
import type { GridSnapshot, LightFastGridColDef, RowData } from "../../types";
import { applySortModelToRowOrder } from "../../utils/sortModel";
import { createIndexedRowOrder } from "../rowOrder";
import type { SortOrderPairCache } from "../SortOrderCache";
import {
  countNonNull,
  createSortOrderPairCache,
  querySortOrderPairCache,
  reverseGroupOrder,
} from "../SortOrderCache";

/** Map display-order rows from a snapshot's RowView. */
function displayRows(snap: GridSnapshot): RowData[] {
  const reader = createDisplayRowReader(snap.rowView);
  return Array.from({ length: reader.rowCount }, (_, i) => reader.getRowData(i)!);
}

// ── Unit tests ────────────────────────────────────────────────────────

describe("countNonNull", () => {
  it("counts all as non-null when no nulls exist", () => {
    expect(countNonNull(new Uint8Array([0, 0, 0]), new Uint32Array([0, 1, 2]))).toBe(3);
  });

  it("counts zero when all are null", () => {
    expect(countNonNull(new Uint8Array([1, 1, 1]), new Uint32Array([0, 1, 2]))).toBe(0);
  });

  it("counts non-null prefix in sorted order", () => {
    expect(countNonNull(new Uint8Array([0, 1, 0, 1]), new Uint32Array([2, 0, 1, 3]))).toBe(2);
  });
});

describe("reverseGroupOrder", () => {
  it("reverses groups preserving internal tie order", () => {
    // ASC: [r1(1), r2(2), r3(2), r0(3)]
    const src = new Uint32Array([1, 2, 3, 0]);
    const values = [3, 1, 2, 2]; // by source index
    const out = reverseGroupOrder(src, 4, values);
    // Groups: [r1(1)], [r2(2),r3(2)], [r0(3)] → reversed: [r0(3)], [r2(2),r3(2)], [r1(1)]
    expect(Array.from(out)).toEqual([0, 2, 3, 1]);
  });

  it("preserves null segment unchanged", () => {
    const src = new Uint32Array([2, 0, 1, 3]); // non-null:[2,0] null:[1,3]
    const values = [2, null, 1, null];
    const out = reverseGroupOrder(src, 2, values);
    expect(Array.from(out)).toEqual([0, 2, 1, 3]);
  });

  it("does not mutate source", () => {
    const src = new Uint32Array([1, 2, 0]);
    const copy = Array.from(src);
    reverseGroupOrder(src, 3, [3, 1, 2]);
    expect(Array.from(src)).toEqual(copy);
  });

  it("handles all-equal values (single group)", () => {
    const src = new Uint32Array([0, 1, 2]);
    const out = reverseGroupOrder(src, 3, [1, 1, 1]);
    // Single group — order preserved
    expect(Array.from(out)).toEqual([0, 1, 2]);
  });

  it("treats mixed types equal under defaultCompare as one group (number/string)", () => {
    // Values: r0=1(number), r1="1"(string), r2=2
    // ASC order: [r0(1), r1("1"), r2(2)] — 1 and "1" compare equal via localeCompare
    const src = new Uint32Array([0, 1, 2]);
    const values = [1, "1", 2]; // by source index
    const out = reverseGroupOrder(src, 3, values);
    // Groups: [r0(1), r1("1")], [r2(2)] → reversed: [r2(2)], [r0(1), r1("1")]
    // Internal order of the equal group preserved
    expect(Array.from(out)).toEqual([2, 0, 1]);
  });

  it("treats mixed types equal under defaultCompare as one group (boolean/string)", () => {
    // Values: r0=true, r1="true", r2=false, r3="false"
    // ASC: false < "false" < true < "true" only if !== is used.
    // Under defaultCompare: false=="false" (both String → "false"),
    //   true=="true" (both String → "true"). So two groups.
    // Simulating an ASC order where false-group comes first:
    const src = new Uint32Array([2, 3, 0, 1]);
    const values = [true, "true", false, "false"]; // by source index
    const out = reverseGroupOrder(src, 4, values);
    // Groups: [r2(false), r3("false")], [r0(true), r1("true")]
    // Reversed: [r0(true), r1("true")], [r2(false), r3("false")]
    expect(Array.from(out)).toEqual([0, 1, 2, 3]);
  });

  it("mixed-type equal values with null segment unchanged", () => {
    // Values: r0=1, r1="1", r2=null, r3=2
    // ASC order (non-null): [r0(1), r1("1"), r3(2)] then null: [r2]
    const src = new Uint32Array([0, 1, 3, 2]);
    const values = [1, "1", null, 2]; // by source index
    const out = reverseGroupOrder(src, 3, values);
    // Groups: [r0(1), r1("1")], [r3(2)] → reversed: [r3(2)], [r0(1), r1("1")]
    // Null segment unchanged
    expect(Array.from(out)).toEqual([3, 0, 1, 2]);
  });

  it("NaN values form a single equal group", () => {
    // Values: r0=NaN, r1=NaN, r2=1, r3=2
    // ASC order: [r2(1), r3(2), r0(NaN), r1(NaN)]
    // NaN sorts after real numbers under defaultCompare. NaN == NaN so
    // they form one group. The non-null prefix has 4 entries.
    const src = new Uint32Array([2, 3, 0, 1]);
    const values = [NaN, NaN, 1, 2]; // by source index
    const out = reverseGroupOrder(src, 4, values);
    // Groups: [r2(1)], [r3(2)], [r0(NaN), r1(NaN)]
    // Reversed: [r0(NaN), r1(NaN)], [r3(2)], [r2(1)]
    // Internal NaN group order preserved (r0 before r1)
    expect(Array.from(out)).toEqual([0, 1, 3, 2]);
  });

  it("NaN mixed with normal numbers and null segment", () => {
    // Values: r0=NaN, r1=3, r2=NaN, r3=null
    // ASC (non-null): [r1(3), r0(NaN), r2(NaN)] then null: [r3]
    // NaN sorts after real numbers, so NaN group follows 3-group.
    const src = new Uint32Array([1, 0, 2, 3]);
    const values = [NaN, 3, NaN, null]; // by source index
    const out = reverseGroupOrder(src, 3, values);
    // Groups: [r1(3)], [r0(NaN), r2(NaN)] → reversed: [r0(NaN), r2(NaN)], [r1(3)]
    // Null segment unchanged
    expect(Array.from(out)).toEqual([0, 2, 1, 3]);
  });
});

describe("querySortOrderPairCache", () => {
  const rows: RowData[] = [{ v: 3 }, { v: 1 }, { v: 2 }];
  const values = [3, 1, 2];

  function makeCache(): SortOrderPairCache {
    const indexes = new Uint32Array([1, 2, 0]);
    return createSortOrderPairCache(
      "v", "asc", rows, 1, undefined,
      indexes, 3, createIndexedRowOrder(indexes),
    );
  }

  it("returns exact hit for cached direction with stable RowOrder", () => {
    const cache = makeCache();
    const result = querySortOrderPairCache(cache, "v", "asc", rows, 1, undefined, values);
    expect(result.hit).toBe("exact");
    if (result.hit === "exact") {
      expect(result.rowOrder.kind).toBe("indexed");
      if (result.rowOrder.kind === "indexed") {
        expect(Array.from(result.rowOrder.indexes)).toEqual([1, 2, 0]);
      }
    }
  });

  it("derives opposite direction and caches it", () => {
    const cache = makeCache();
    const result = querySortOrderPairCache(cache, "v", "desc", rows, 1, undefined, values);
    expect(result.hit).toBe("derived");
    if (result.hit === "derived") {
      expect(result.rowOrder.kind).toBe("indexed");
      if (result.rowOrder.kind === "indexed") {
        expect(Array.from(result.rowOrder.indexes)).toEqual([0, 2, 1]);
      }
    }
    // Second query for desc is now an exact hit
    const result2 = querySortOrderPairCache(cache, "v", "desc", rows, 1, undefined, values);
    expect(result2.hit).toBe("exact");
  });

  it("returns none for different field", () => {
    expect(querySortOrderPairCache(makeCache(), "x", "asc", rows, 1, undefined, values).hit).toBe("none");
  });

  it("returns none for different rows", () => {
    const other = [{ v: 3 }];
    expect(querySortOrderPairCache(makeCache(), "v", "asc", other, 1, undefined, values).hit).toBe("none");
  });

  it("returns none for different epoch", () => {
    expect(querySortOrderPairCache(makeCache(), "v", "asc", rows, 2, undefined, values).hit).toBe("none");
  });

  it("returns none for different valueGetter", () => {
    const getter = () => 0;
    expect(querySortOrderPairCache(makeCache(), "v", "asc", rows, 1, getter, values).hit).toBe("none");
  });

  it("returns none for null cache", () => {
    expect(querySortOrderPairCache(null, "v", "asc", rows, 1, undefined, values).hit).toBe("none");
  });

  it("returns none when values are null (can't derive)", () => {
    const cache = makeCache();
    expect(querySortOrderPairCache(cache, "v", "desc", rows, 1, undefined, null).hit).toBe("none");
  });
});

// ── GridState integration tests ───────────────────────────────────────

function makeRows(): RowData[] {
  return [
    { id: "r0", score: 3, name: "alice" },
    { id: "r1", score: 1, name: "bob" },
    { id: "r2", score: 2, name: "alice" },
    { id: "r3", score: 2, name: "bob" },
  ];
}

describe("sort order pair cache via GridState", () => {
  it("ASC full sort caches ASC", () => {
    const cols: LightFastGridColDef[] = [{ field: "score", sortable: true }];
    const state = new GridState({ columns: cols, rows: makeRows() });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const snap = state.getSnapshot();
    expect(displayRows(snap).map((r) => r.id)).toEqual(["r1", "r2", "r3", "r0"]);
  });

  it("DESC after ASC derives once (valueGetter not re-called)", () => {
    const getter = vi.fn(({ row }: { row: RowData }) => row.score);
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: getter },
    ];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();
    const callsAfterAsc = getter.mock.calls.length;

    state.setSortModel([{ field: "score", sort: "desc" }]);
    const desc = state.getSnapshot();
    expect(displayRows(desc).map((r) => r.id)).toEqual(["r0", "r2", "r3", "r1"]);
    expect(getter.mock.calls.length).toBe(callsAfterAsc);
  });

  it("ASC after DESC→ASC returns exact cached ASC without reversal or sort", () => {
    const getter = vi.fn(({ row }: { row: RowData }) => row.score);
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: getter },
    ];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    // 1. ASC full sort
    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();
    const callsAfterAsc = getter.mock.calls.length;

    // 2. DESC derived
    state.setSortModel([{ field: "score", sort: "desc" }]);
    state.getSnapshot();

    // 3. ASC again — exact cache hit, no work
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const asc2 = state.getSnapshot();
    expect(displayRows(asc2).map((r) => r.id)).toEqual(["r1", "r2", "r3", "r0"]);
    expect(getter.mock.calls.length).toBe(callsAfterAsc);
  });

  it("DESC after ASC→DESC returns exact cached DESC without reversal", () => {
    const getter = vi.fn(({ row }: { row: RowData }) => row.score);
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: getter },
    ];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();
    state.setSortModel([{ field: "score", sort: "desc" }]);
    state.getSnapshot();
    const callsAfterDesc = getter.mock.calls.length;

    // Toggle back to DESC — exact hit
    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();
    state.setSortModel([{ field: "score", sort: "desc" }]);
    const desc2 = state.getSnapshot();
    expect(displayRows(desc2).map((r) => r.id)).toEqual(["r0", "r2", "r3", "r1"]);
    expect(getter.mock.calls.length).toBe(callsAfterDesc);
  });

  it("duplicate values preserve stable tie order by row id", () => {
    const cols: LightFastGridColDef[] = [{ field: "score", sortable: true }];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    expect(displayRows(state.getSnapshot()).map((r) => r.id)).toEqual(["r1", "r2", "r3", "r0"]);

    state.setSortModel([{ field: "score", sort: "desc" }]);
    // r2 before r3 (stable tie order by source index)
    expect(displayRows(state.getSnapshot()).map((r) => r.id)).toEqual(["r0", "r2", "r3", "r1"]);

    state.setSortModel([{ field: "score", sort: "asc" }]);
    expect(displayRows(state.getSnapshot()).map((r) => r.id)).toEqual(["r1", "r2", "r3", "r0"]);
  });

  it("null/undefined remain last in both directions", () => {
    const cols: LightFastGridColDef[] = [{ field: "score", sortable: true }];
    const rows: RowData[] = [
      { id: "r0", score: 2 },
      { id: "r1", score: null },
      { id: "r2", score: 1 },
      { id: "r3", score: undefined },
      { id: "r4", score: 3 },
    ];
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    expect(displayRows(state.getSnapshot()).map((r) => r.score)).toEqual([1, 2, 3, null, undefined]);

    state.setSortModel([{ field: "score", sort: "desc" }]);
    expect(displayRows(state.getSnapshot()).map((r) => r.score)).toEqual([3, 2, 1, null, undefined]);

    // Back to asc — exact hit
    state.setSortModel([{ field: "score", sort: "asc" }]);
    expect(displayRows(state.getSnapshot()).map((r) => r.score)).toEqual([1, 2, 3, null, undefined]);
  });

  it("cached indexes are not mutated", () => {
    const cols: LightFastGridColDef[] = [{ field: "score", sortable: true }];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    const ascIds = displayRows(state.getSnapshot()).map((r) => r.id);

    state.setSortModel([{ field: "score", sort: "desc" }]);
    state.getSnapshot();

    state.setSortModel([{ field: "score", sort: "asc" }]);
    expect(displayRows(state.getSnapshot()).map((r) => r.id)).toEqual(ascIds);
  });

  it("rows reference change disables reuse", () => {
    const getter = vi.fn(({ row }: { row: RowData }) => row.score);
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: getter },
    ];
    const state = new GridState({ columns: cols, rows: makeRows() });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();
    const calls1 = getter.mock.calls.length;

    state.setRows(makeRows());
    state.setSortModel([{ field: "score", sort: "desc" }]);
    state.getSnapshot();
    expect(getter.mock.calls.length).toBeGreaterThan(calls1);
  });

  it("valueGetter reference change disables reuse", () => {
    const getter1 = vi.fn(({ row }: { row: RowData }) => row.score);
    const getter2 = vi.fn(({ row }: { row: RowData }) => row.score);
    const rows = makeRows();

    const state = new GridState({
      columns: [{ field: "score", sortable: true, valueGetter: getter1 }],
      rows,
    });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();

    state.setColumns([{ field: "score", sortable: true, valueGetter: getter2 }]);
    state.setSortModel([{ field: "score", sort: "desc" }]);
    state.getSnapshot();
    expect(getter2.mock.calls.length).toBe(4);
  });

  it("custom sortComparator falls back to full sort (no pair cache)", () => {
    const cmp = vi.fn((a: unknown, b: unknown) => Number(a) - Number(b));
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, sortComparator: cmp },
    ];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();
    const calls1 = cmp.mock.calls.length;

    state.setSortModel([{ field: "score", sort: "desc" }]);
    const desc = state.getSnapshot();
    expect(cmp.mock.calls.length).toBeGreaterThan(calls1);
    expect(displayRows(desc).map((r) => r.id)).toEqual(["r0", "r2", "r3", "r1"]);
  });

  it("multi-column sort does not use pair cache", () => {
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true },
      { field: "name", sortable: true },
    ];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    const asc = state.getSnapshot();
    const ascIds = displayRows(asc).map((r) => r.id);
    expect(ascIds).toEqual(["r1", "r2", "r3", "r0"]);

    state.setSortModel([
      { field: "score", sort: "desc" },
      { field: "name", sort: "asc" },
    ]);
    const multi = state.getSnapshot();
    const multiIds = displayRows(multi).map((r) => r.id);
    // Multi-column has different tie ordering than group-reverse
    expect(multiIds).toEqual(["r0", "r2", "r3", "r1"]);
    expect(multiIds).not.toEqual(
      [...ascIds].reverse(),
    );
  });

  it("all-equal values produce correct pair cache results", () => {
    const cols: LightFastGridColDef[] = [{ field: "score", sortable: true }];
    const rows: RowData[] = [
      { id: "r0", score: 1 },
      { id: "r1", score: 1 },
      { id: "r2", score: 1 },
    ];
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    expect(displayRows(state.getSnapshot()).map((r) => r.id)).toEqual(["r0", "r1", "r2"]);

    state.setSortModel([{ field: "score", sort: "desc" }]);
    expect(displayRows(state.getSnapshot()).map((r) => r.id)).toEqual(["r0", "r1", "r2"]);

    state.setSortModel([{ field: "score", sort: "asc" }]);
    expect(displayRows(state.getSnapshot()).map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
  });

  // ── Stable RowOrder reference + RowView generation tests ────────────

  it("exact ASC cache hit returns the same RowOrder reference", () => {
    const cols: LightFastGridColDef[] = [{ field: "score", sortable: true }];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot(); // warm pair cache with ASC
    state.setSortModel([{ field: "score", sort: "desc" }]);
    state.getSnapshot(); // warm pair cache with DESC

    // Now toggle back to ASC — exact hit
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const snap1 = state.getSnapshot();
    const snap2 = state.getSnapshot();
    // Same RowOrder reference on repeated snapshots
    expect(snap2.rowView).toBe(snap1.rowView);
  });

  it("RowView generation stays stable on repeated snapshots for same direction", () => {
    const cols: LightFastGridColDef[] = [{ field: "score", sortable: true }];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    const snap1 = state.getSnapshot();
    const snap2 = state.getSnapshot();
    // Same direction, same inputs → same generation
    expect(snap2.rowView.generation).toBe(snap1.rowView.generation);
    expect(snap2.rowView).toBe(snap1.rowView);

    // Warm DESC
    state.setSortModel([{ field: "score", sort: "desc" }]);
    const descGen = state.getSnapshot().rowView.generation;
    expect(descGen).not.toBe(snap1.rowView.generation);

    // Toggle direction changes RowView (different display order)
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const ascAgainGen = state.getSnapshot().rowView.generation;
    expect(ascAgainGen).not.toBe(descGen);
  });

  it("snapshot.data is always the raw source-rows reference through cache lifecycle", () => {
    const cols: LightFastGridColDef[] = [{ field: "score", sortable: true }];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    const asc1 = state.getSnapshot();
    expect(asc1.data).toBe(rows);
    expect(displayRows(asc1).map((r) => r.score)).toEqual([1, 2, 2, 3]);

    state.setSortModel([{ field: "score", sort: "desc" }]);
    const desc = state.getSnapshot();
    expect(desc.data).toBe(rows);
    expect(displayRows(desc).map((r) => r.score)).toEqual([3, 2, 2, 1]);

    state.setSortModel([{ field: "score", sort: "asc" }]);
    const asc2 = state.getSnapshot();
    expect(asc2.data).toBe(rows);
    expect(displayRows(asc2).map((r) => r.score)).toEqual([1, 2, 2, 3]);

    // Repeated snapshots for the same direction return the same source rows
    const asc3 = state.getSnapshot();
    expect(asc3.data).toBe(asc2.data);
  });

  // ── RowView stability tests (replacing materialized bridge cache tests) ──

  it("exact cached hit produces stable RowView reference", () => {
    const cols: LightFastGridColDef[] = [{ field: "score", sortable: true }];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    // Warm both directions
    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();

    state.setSortModel([{ field: "score", sort: "desc" }]);
    state.getSnapshot();

    // Toggle back to ASC — exact pair-cache hit
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const asc = state.getSnapshot();
    expect(displayRows(asc).map((r) => r.score)).toEqual([1, 2, 2, 3]);
    // snapshot.data is always the source rows reference
    expect(asc.data).toBe(rows);
  });

  it("rows reference change produces new snapshot.data", () => {
    const cols: LightFastGridColDef[] = [{ field: "score", sortable: true }];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    const asc1 = state.getSnapshot();
    expect(asc1.data).toBe(rows);

    const newRows = makeRows();
    state.setRows(newRows);
    const asc2 = state.getSnapshot();
    // Different rows reference → different data reference
    expect(asc2.data).not.toBe(asc1.data);
    expect(asc2.data).toBe(newRows);
    expect(displayRows(asc2).map((r) => r.score)).toEqual([1, 2, 2, 3]);
  });

  // ── tryResolveCachedSortOrder tests ─────────────────────────────────

  it("tryResolveCachedSortOrder returns RowOrder on warm cache", () => {
    const cols: LightFastGridColDef[] = [{ field: "score", sortable: true }];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    // Warm ASC
    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();

    // Switch to DESC — tryResolve should find it derivable
    state.setSortModel([{ field: "score", sort: "desc" }]);
    const resolved = state.tryResolveCachedSortOrder();
    expect(resolved).not.toBeNull();
    expect(resolved!.kind).toBe("indexed");
  });

  it("tryResolveCachedSortOrder returns null for multi-column sort", () => {
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true },
      { field: "name", sortable: true },
    ];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();

    state.setSortModel([
      { field: "score", sort: "desc" },
      { field: "name", sort: "asc" },
    ]);
    expect(state.tryResolveCachedSortOrder()).toBeNull();
  });

  it("tryResolveCachedSortOrder returns null for custom comparator", () => {
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, sortComparator: (a, b) => Number(a) - Number(b) },
    ];
    const state = new GridState({ columns: cols, rows: makeRows() });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();

    state.setSortModel([{ field: "score", sort: "desc" }]);
    expect(state.tryResolveCachedSortOrder()).toBeNull();
  });

  it("tryResolveCachedSortOrder returns null for cold cache", () => {
    const cols: LightFastGridColDef[] = [{ field: "score", sortable: true }];
    const state = new GridState({ columns: cols, rows: makeRows() });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    // No getSnapshot() — pair cache is cold
    expect(state.tryResolveCachedSortOrder()).toBeNull();
  });

  // ── Mixed-type equality: derived sort matches full sort ────────────

  it("derived DESC matches full DESC for mixed number/string equal values", () => {
    const cols: LightFastGridColDef[] = [{ field: "v", sortable: true }];
    const rows: RowData[] = [
      { id: "r0", v: 1 },
      { id: "r1", v: "1" },
      { id: "r2", v: 2 },
    ];
    const state = new GridState({ columns: cols, rows });

    // Full DESC (no cache) for reference
    const fullDescOrder = applySortModelToRowOrder(
      rows,
      [{ field: "v", sort: "desc" }],
      [{ field: "v", sortable: true }],
    );
    const fullDescIds = fullDescOrder.kind === "indexed"
      ? Array.from(fullDescOrder.indexes).map((i) => rows[i]!.id)
      : rows.map((r) => r.id);

    // Warm ASC via GridState
    state.setSortModel([{ field: "v", sort: "asc" }]);
    state.getSnapshot();

    // Derive DESC from warm ASC cache
    state.setSortModel([{ field: "v", sort: "desc" }]);
    const derivedDescIds = displayRows(state.getSnapshot()).map((r) => r.id);

    expect(derivedDescIds).toEqual(fullDescIds);
  });

  it("derived DESC matches full DESC for mixed boolean/string equal values", () => {
    const cols: LightFastGridColDef[] = [{ field: "v", sortable: true }];
    const rows: RowData[] = [
      { id: "r0", v: true },
      { id: "r1", v: "true" },
      { id: "r2", v: false },
      { id: "r3", v: "false" },
    ];
    const state = new GridState({ columns: cols, rows });

    // Full DESC for reference
    const fullDescOrder = applySortModelToRowOrder(
      rows,
      [{ field: "v", sort: "desc" }],
      [{ field: "v", sortable: true }],
    );
    const fullDescIds = fullDescOrder.kind === "indexed"
      ? Array.from(fullDescOrder.indexes).map((i) => rows[i]!.id)
      : rows.map((r) => r.id);

    // Warm ASC
    state.setSortModel([{ field: "v", sort: "asc" }]);
    state.getSnapshot();

    // Derive DESC
    state.setSortModel([{ field: "v", sort: "desc" }]);
    const derivedDescIds = displayRows(state.getSnapshot()).map((r) => r.id);

    expect(derivedDescIds).toEqual(fullDescIds);
  });

  it("derived ASC matches full ASC for mixed equal values (DESC first)", () => {
    const cols: LightFastGridColDef[] = [{ field: "v", sortable: true }];
    const rows: RowData[] = [
      { id: "r0", v: 1 },
      { id: "r1", v: "1" },
      { id: "r2", v: 2 },
      { id: "r3", v: null },
    ];
    const state = new GridState({ columns: cols, rows });

    // Full ASC for reference
    const fullAscOrder = applySortModelToRowOrder(
      rows,
      [{ field: "v", sort: "asc" }],
      [{ field: "v", sortable: true }],
    );
    const fullAscIds = fullAscOrder.kind === "indexed"
      ? Array.from(fullAscOrder.indexes).map((i) => rows[i]!.id)
      : rows.map((r) => r.id);

    // Warm DESC first
    state.setSortModel([{ field: "v", sort: "desc" }]);
    state.getSnapshot();

    // Derive ASC
    state.setSortModel([{ field: "v", sort: "asc" }]);
    const derivedAscIds = displayRows(state.getSnapshot()).map((r) => r.id);

    expect(derivedAscIds).toEqual(fullAscIds);
  });

  it("derived DESC matches full DESC for NaN values with null/undefined last", () => {
    const cols: LightFastGridColDef[] = [{ field: "v", sortable: true }];
    const rows: RowData[] = [
      { id: "r0", v: NaN },
      { id: "r1", v: 2 },
      { id: "r2", v: NaN },
      { id: "r3", v: null },
      { id: "r4", v: 1 },
      { id: "r5", v: undefined },
    ];
    const state = new GridState({ columns: cols, rows });

    // Full DESC for reference (no cache)
    const fullDescOrder = applySortModelToRowOrder(
      rows,
      [{ field: "v", sort: "desc" }],
      [{ field: "v", sortable: true }],
    );
    const fullDescIds = fullDescOrder.kind === "indexed"
      ? Array.from(fullDescOrder.indexes).map((i) => rows[i]!.id)
      : rows.map((r) => r.id);

    // Warm ASC via GridState
    state.setSortModel([{ field: "v", sort: "asc" }]);
    state.getSnapshot();

    // Derive DESC from warm ASC cache
    state.setSortModel([{ field: "v", sort: "desc" }]);
    const derivedDesc = state.getSnapshot();
    const derivedDescIds = displayRows(derivedDesc).map((r) => r.id);

    expect(derivedDescIds).toEqual(fullDescIds);
    // null/undefined must remain last
    const dr = displayRows(derivedDesc);
    const lastTwo = dr.slice(-2).map((r) => r.v);
    expect(lastTwo).toEqual([null, undefined]);
  });
});
