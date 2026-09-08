// Focused tests for GridState's RowOrder-based sort cache.
//
// Verifies:
// - identity row order is returned for empty sort (raw rows reference preserved)
// - active sort caches RowOrder, not RowData[]
// - unrelated state changes (selection, drag, widths, etc.) do not recompute
//   the sort order
// - setRows / setSortModel invalidate the cache
// - applySortedRowOrder accepts an indexed RowOrder and materializes lazily
// - stale async completions are ignored at the Grid level
// - snapshot.data is always the raw source-rows reference
// - display order is accessible via RowView / DisplayRowReader

import { describe, expect, it } from "vitest";

import { createDisplayRowReader } from "../../rendering/rowViewAccess";
import {
  createIndexedRowOrder,
  type RowOrder,
} from "../../row-model/rowOrder";
import type { GridSnapshot, LightFastGridColDef, RowData } from "../../types";
import { applySortModelToRowOrder } from "../../utils/sortModel";
import { GridState } from "../GridState";

const cols: LightFastGridColDef[] = [
  { field: "score", sortable: true },
  { field: "name", sortable: true },
];

function makeRows(): RowData[] {
  return [
    { id: "r0", score: 3, name: "alice" },
    { id: "r1", score: 1, name: "bob" },
    { id: "r2", score: 2, name: "alice" },
    { id: "r3", score: 2, name: "bob" },
  ];
}

/** Map display-order rows from a snapshot's RowView. */
function displayRows(snap: GridSnapshot): RowData[] {
  const reader = createDisplayRowReader(snap.rowView);
  return Array.from({ length: reader.rowCount }, (_, i) => reader.getRowData(i)!);
}

describe("GridState sort cache (RowOrder)", () => {
  it("empty sort returns the raw rows reference in snap.data", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    expect(state.getSnapshot().data).toBe(rows);
  });

  it("active sort: snap.data is raw rows, display order via RowView", () => {
    const rows = makeRows();
    const before = rows.map((r) => r.score);
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const snap = state.getSnapshot();
    // snap.data is always the raw source-rows reference
    expect(snap.data).toBe(rows);
    // Display order is via RowView
    expect(displayRows(snap).map((r) => r.score)).toEqual([1, 2, 2, 3]);
    // Raw rows are not mutated
    expect(rows.map((r) => r.score)).toEqual(before);
  });

  it("multi-column mixed asc/desc display order via RowView", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([
      { field: "name", sort: "asc" },
      { field: "score", sort: "desc" },
    ]);
    const snap = state.getSnapshot();
    // alice(3), alice(2), bob(2), bob(1)
    expect(displayRows(snap).map((r) => `${r.name}:${r.score}`)).toEqual([
      "alice:3",
      "alice:2",
      "bob:2",
      "bob:1",
    ]);
    // snap.data is always the raw source-rows reference
    expect(snap.data).toBe(rows);
  });

  it("snap.data is stable across snapshots when inputs unchanged", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const first = state.getSnapshot().data;
    const second = state.getSnapshot().data;
    // Both are the same raw rows reference
    expect(second).toBe(first);
    expect(first).toBe(rows);
  });

  it("unrelated state changes do NOT invalidate sort order", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const firstView = state.getSnapshot().rowView;

    state.setRowSelection({ mode: "single" });
    state.setColumnSelection({ mode: "single" });
    state.setRowDrag({ enabled: true });
    state.setColumnWidth("score", 200);

    const afterView = state.getSnapshot().rowView;
    // RowView is stable (same reference) — sort order not recomputed
    expect(afterView).toBe(firstView);
    expect(displayRows(state.getSnapshot()).map((r) => r.score)).toEqual([1, 2, 2, 3]);
  });

  it("setRows invalidates the cache and produces new sort order", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();

    const nextRows: RowData[] = [
      { id: "x0", score: 9, name: "z" },
      { id: "x1", score: 0, name: "a" },
    ];
    state.setRows(nextRows);
    const after = state.getSnapshot();
    expect(after.data).toBe(nextRows);
    expect(displayRows(after).map((r) => r.score)).toEqual([0, 9]);
  });

  it("setSortModel invalidates the sort order", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const firstView = state.getSnapshot().rowView;

    state.setSortModel([{ field: "score", sort: "desc" }]);
    const afterView = state.getSnapshot().rowView;
    expect(afterView).not.toBe(firstView);
    expect(displayRows(state.getSnapshot()).map((r) => r.score)).toEqual([3, 2, 2, 1]);
  });

  it("clearing the sort model returns the raw rows reference", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot(); // warm cache
    state.setSortModel([]);
    expect(state.getSnapshot().data).toBe(rows);
  });

  it("applySortedRowOrder applies an indexed RowOrder produced offline", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.markSortPending();

    const visibleCols = state.getVisibleColumnDefs();
    const order: RowOrder = applySortModelToRowOrder(
      rows,
      [{ field: "score", sort: "asc" }],
      visibleCols,
    );
    expect(order.kind).toBe("indexed");

    state.applySortedRowOrder(order);
    expect(state.isSortPending()).toBe(false);
    const snap = state.getSnapshot();
    expect(snap.sortPending).toBe(false);
    expect(snap.data).toBe(rows);
    expect(displayRows(snap).map((r) => r.score)).toEqual([1, 2, 2, 3]);
  });

  it("sorted snapshot.data is the raw rows reference, display order via RowView", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const snap = state.getSnapshot();
    // snap.data is the raw source-rows reference
    expect(snap.data).toBe(rows);
    // Display order accessible via RowView
    expect(displayRows(snap).map((r) => r.id)).toEqual(["r1", "r2", "r3", "r0"]);
  });

  it("explicitly applying an identity-equivalent indexed order still works", () => {
    // Simulate a degenerate case where an "indexed" order is identity-like.
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.markSortPending();

    const identityIndexes = new Uint32Array([0, 1, 2, 3]);
    state.applySortedRowOrder(createIndexedRowOrder(identityIndexes));
    const snap = state.getSnapshot();
    expect(snap.data).toBe(rows);
    expect(displayRows(snap).map((r) => r.id)).toEqual(["r0", "r1", "r2", "r3"]);
  });

  it("setSortModel discards a pending async RowOrder applied under the previous model", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.markSortPending();
    const ascOrder = applySortModelToRowOrder(
      rows,
      [{ field: "score", sort: "asc" }],
      state.getVisibleColumnDefs(),
    );
    state.applySortedRowOrder(ascOrder);

    // Change sort model BEFORE any getSnapshot() call would promote ascOrder.
    state.setSortModel([{ field: "score", sort: "desc" }]);

    const snap = state.getSnapshot();
    // Must reflect the new desc model, NOT the stale asc order.
    expect(displayRows(snap).map((r) => r.score)).toEqual([3, 2, 2, 1]);
  });
});
