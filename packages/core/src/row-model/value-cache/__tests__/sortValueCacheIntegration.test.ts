import { describe, expect, it, vi } from "vitest";

import { createDisplayRowReader } from "../../../rendering/rowViewAccess";
import { GridState } from "../../../state/GridState";
import type { GridSnapshot, LightFastGridColDef, RowData } from "../../../types";

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

describe("sorting with RowValueCache integration", () => {
  it("repeated getSnapshot with same sort does not re-run valueGetter", () => {
    const getter = vi.fn(({ row }: { row: RowData }) => row.score);
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: getter },
    ];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);

    state.getSnapshot();
    const callsAfterFirst = getter.mock.calls.length;
    expect(callsAfterFirst).toBe(4);

    state.getSnapshot();
    expect(getter.mock.calls.length).toBe(callsAfterFirst);
  });

  it("changing unrelated state does not re-run valueGetter", () => {
    const getter = vi.fn(({ row }: { row: RowData }) => row.score);
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: getter },
    ];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);

    state.getSnapshot();
    const callsAfterFirst = getter.mock.calls.length;

    state.setRowSelection({ mode: "single" });
    state.setColumnWidth("score", 200);

    state.getSnapshot();
    expect(getter.mock.calls.length).toBe(callsAfterFirst);
  });

  it("changing sort direction on same field reuses extracted values", () => {
    const getter = vi.fn(({ row }: { row: RowData }) => row.score);
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: getter },
    ];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);

    const snapAsc = state.getSnapshot();
    expect(displayRows(snapAsc).map((r) => r.score)).toEqual([1, 2, 2, 3]);
    const callsAfterAsc = getter.mock.calls.length;
    expect(callsAfterAsc).toBe(4);

    state.setSortModel([{ field: "score", sort: "desc" }]);
    const snapDesc = state.getSnapshot();
    expect(displayRows(snapDesc).map((r) => r.score)).toEqual([3, 2, 2, 1]);
    // Same rows + same revision + same field + same valueGetter → cache hit
    expect(getter.mock.calls.length).toBe(callsAfterAsc);
  });

  it("multi-column sort builds/reuses each field cache correctly", () => {
    const scoreGetter = vi.fn(({ row }: { row: RowData }) => row.score);
    const nameGetter = vi.fn(({ row }: { row: RowData }) => row.name);
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: scoreGetter },
      { field: "name", sortable: true, valueGetter: nameGetter },
    ];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([
      { field: "name", sort: "asc" },
      { field: "score", sort: "desc" },
    ]);

    const snap = state.getSnapshot();
    expect(displayRows(snap).map((r) => `${r.name}:${r.score}`)).toEqual([
      "alice:3",
      "alice:2",
      "bob:2",
      "bob:1",
    ]);
    expect(scoreGetter).toHaveBeenCalledTimes(4);
    expect(nameGetter).toHaveBeenCalledTimes(4);

    // Second snapshot: both cached
    state.getSnapshot();
    expect(scoreGetter).toHaveBeenCalledTimes(4);
    expect(nameGetter).toHaveBeenCalledTimes(4);
  });

  it("setRows invalidates value cache and re-runs valueGetter", () => {
    const getter = vi.fn(({ row }: { row: RowData }) => row.score);
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: getter },
    ];
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);

    state.getSnapshot();
    const callsAfterFirst = getter.mock.calls.length;

    state.setRows([{ score: 9 }, { score: 0 }]);
    state.getSnapshot();
    expect(getter.mock.calls.length).toBe(callsAfterFirst + 2);
  });

  it("custom sortComparator behavior unchanged", () => {
    const reverseChar = (a: unknown, b: unknown): number => {
      const sa = String(a);
      const sb = String(b);
      return sa[sa.length - 1]!.localeCompare(sb[sb.length - 1]!);
    };
    const cols: LightFastGridColDef[] = [
      { field: "name", sortable: true, sortComparator: reverseChar },
    ];
    const rows: RowData[] = [
      { name: "xyz" },
      { name: "abc" },
      { name: "qqb" },
    ];
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "name", sort: "asc" }]);

    const snap = state.getSnapshot();
    expect(displayRows(snap).map((r) => r.name)).toEqual(["qqb", "abc", "xyz"]);
  });

  it("null/undefined ordering unchanged", () => {
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true },
    ];
    const rows: RowData[] = [
      { score: 2 },
      { score: null },
      { score: 1 },
      { score: undefined },
      { score: 3 },
    ];
    const state = new GridState({ columns: cols, rows });

    state.setSortModel([{ field: "score", sort: "asc" }]);
    const asc = state.getSnapshot();
    expect(displayRows(asc).map((r) => r.score)).toEqual([1, 2, 3, null, undefined]);

    state.setSortModel([{ field: "score", sort: "desc" }]);
    const desc = state.getSnapshot();
    expect(displayRows(desc).map((r) => r.score)).toEqual([3, 2, 1, null, undefined]);
  });

  it("stable tie-break by source index remains", () => {
    const cols: LightFastGridColDef[] = [
      { field: "name", sortable: true },
    ];
    const rows: RowData[] = [
      { id: "r0", name: "same" },
      { id: "r1", name: "same" },
      { id: "r2", name: "same" },
    ];
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "name", sort: "asc" }]);

    const snap = state.getSnapshot();
    expect(displayRows(snap).map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
  });
});

// ── Phase 2: selective cache/sort invalidation ──────────────────────

const resolveId = (row: RowData): string | null => {
  const id = row.id;
  return id === null || id === undefined || id === "" ? null : String(id);
};

describe("Phase 2: update-only transaction cache invalidation", () => {
  it("update-only txn on untouched sort field preserves sort order without recompute", () => {
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true },
      { field: "name", sortable: true },
    ];
    const state = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state.setSortModel([{ field: "score", sort: "asc" }]);

    // Initial sort.
    const snap1 = state.getSnapshot();
    expect(displayRows(snap1).map((r) => r.score)).toEqual([1, 2, 2, 3]);

    // Update "name" only — does not touch sort field "score".
    state.applyStoreTransaction(
      { update: [{ id: "r0", score: 3, name: "updated" }] },
      resolveId,
    );

    const snap2 = state.getSnapshot();
    const rows2 = displayRows(snap2);
    // Sort order unchanged — same sorted sequence.
    expect(rows2.map((r) => r.score)).toEqual([1, 2, 2, 3]);
    // Updated row present with new name.
    expect(rows2.find((r) => r.id === "r0")?.name).toBe("updated");
  });

  it("update-only txn on dirty sort field recomputes sort", () => {
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true },
      { field: "name", sortable: true },
    ];
    const state = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state.setSortModel([{ field: "score", sort: "asc" }]);

    const snap1 = state.getSnapshot();
    expect(displayRows(snap1).map((r) => r.score)).toEqual([1, 2, 2, 3]);

    // Update score — the sort field is dirty.
    state.applyStoreTransaction(
      { update: [{ id: "r0", score: 0, name: "alice" }] },
      resolveId,
    );

    const snap2 = state.getSnapshot();
    expect(displayRows(snap2).map((r) => r.score)).toEqual([0, 1, 2, 2]);
  });

  it("update-only txn with valueGetter sort recomputes sort conservatively", () => {
    const getter = vi.fn(({ row }: { row: RowData }) => row.score);
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: getter },
    ];
    const state = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state.setSortModel([{ field: "score", sort: "asc" }]);

    state.getSnapshot();
    const callsAfterSort = getter.mock.calls.length;

    // Update name — unrelated to sort field, but sort uses valueGetter
    // so we can't statically prove it's safe. Conservative: recompute.
    state.applyStoreTransaction(
      { update: [{ id: "r0", score: 3, name: "updated" }] },
      resolveId,
    );

    state.getSnapshot();
    expect(getter.mock.calls.length).toBeGreaterThan(callsAfterSort);
  });

  it("structural transaction still fully invalidates", () => {
    const getter = vi.fn(({ row }: { row: RowData }) => row.score);
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: getter },
    ];
    const state = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state.setSortModel([{ field: "score", sort: "asc" }]);

    state.getSnapshot();
    const callsAfterSort = getter.mock.calls.length;

    // Add a row — structural transaction.
    state.applyStoreTransaction(
      { add: [{ id: "r4", score: 0 }] },
      resolveId,
    );

    state.getSnapshot();
    // Full re-sort: valueGetter called for all rows.
    expect(getter.mock.calls.length).toBeGreaterThan(callsAfterSort);
  });

  it("value cache invalidates only dirty fields", () => {
    const scoreGetter = vi.fn(({ row }: { row: RowData }) => row.score);
    const nameGetter = vi.fn(({ row }: { row: RowData }) => row.name);
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: scoreGetter },
      { field: "name", sortable: true, valueGetter: nameGetter },
    ];
    const state = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state.setSortModel([
      { field: "score", sort: "asc" },
      { field: "name", sort: "asc" },
    ]);

    state.getSnapshot();
    const scoreCalls1 = scoreGetter.mock.calls.length;
    const nameCalls1 = nameGetter.mock.calls.length;

    // Update only "name" field.
    state.applyStoreTransaction(
      { update: [{ id: "r0", score: 3, name: "updated" }] },
      resolveId,
    );

    state.getSnapshot();
    // Both valueGetters re-invoked because both sort on valueGetter
    // columns, which are conservatively invalidated when any field changes.
    // This is the correct conservative behavior for Phase 2.
    expect(scoreGetter.mock.calls.length).toBeGreaterThan(scoreCalls1);
    expect(nameGetter.mock.calls.length).toBeGreaterThan(nameCalls1);
  });

  it("update-only txn with no active sort does not call full onRowsChanged", () => {
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true },
    ];
    const state = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    // No sort active.

    const snap1 = state.getSnapshot();
    const ids1 = displayRows(snap1).map((r) => r.id);

    state.applyStoreTransaction(
      { update: [{ id: "r0", score: 99, name: "alice" }] },
      resolveId,
    );

    const snap2 = state.getSnapshot();
    const ids2 = displayRows(snap2).map((r) => r.id);
    // Order unchanged (identity order).
    expect(ids2).toEqual(ids1);
    // Updated row has new value.
    expect(displayRows(snap2).find((r) => r.id === "r0")?.score).toBe(99);
  });

  it("update-only txn on non-sort field with plain field sort preserves cache", () => {
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true },
      { field: "name", sortable: true },
    ];
    const state = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state.setSortModel([{ field: "score", sort: "asc" }]);

    const snap1 = state.getSnapshot();
    const order1 = displayRows(snap1).map((r) => r.id);

    // Update "name" — sort is on "score" (plain field, no valueGetter).
    state.applyStoreTransaction(
      { update: [{ id: "r0", score: 3, name: "changed" }] },
      resolveId,
    );

    const snap2 = state.getSnapshot();
    const order2 = displayRows(snap2).map((r) => r.id);
    expect(order2).toEqual(order1);
  });
});

// ── Phase 2b: COW rebase and sort scheduling ────────────────────────

describe("Phase 2b: cache rebase after COW", () => {
  it("update-only on non-sort field after replaceAll preserves sort cache", () => {
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true },
      { field: "name", sortable: true },
    ];
    const state = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state.setSortModel([{ field: "score", sort: "asc" }]);

    // Initial sort — builds sort cache.
    const snap1 = state.getSnapshot();
    expect(displayRows(snap1).map((r) => r.score)).toEqual([1, 2, 2, 3]);

    // First update after constructor/replaceAll triggers COW clone.
    // Dirty field "name" does not touch sort field "score" (plain).
    state.applyStoreTransaction(
      { update: [{ id: "r0", score: 3, name: "updated" }] },
      resolveId,
    );
    expect(state.needsSortSchedule).toBe(false);

    // Sort cache was rebased to the COW'd array — snapshot reuses it.
    const snap2 = state.getSnapshot();
    expect(displayRows(snap2).map((r) => r.score)).toEqual([1, 2, 2, 3]);
    expect(displayRows(snap2).find((r) => r.id === "r0")?.name).toBe("updated");
  });

  it("update-only on non-sort field signals no sort scheduling needed", () => {
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true },
      { field: "name", sortable: true },
    ];
    const state = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();

    // Update "name" — sort is on "score" (plain field).
    state.applyStoreTransaction(
      { update: [{ id: "r0", score: 3, name: "changed" }] },
      resolveId,
    );

    expect(state.needsSortSchedule).toBe(false);

    // Structural always needs sort scheduling.
    state.applyStoreTransaction(
      { add: [{ id: "r4", score: 5 }] },
      resolveId,
    );
    expect(state.needsSortSchedule).toBe(true);
  });

  it("second update on already-owned array also preserves caches", () => {
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true },
      { field: "name", sortable: true },
    ];
    const state = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    state.getSnapshot();

    // First update triggers COW clone.
    state.applyStoreTransaction(
      { update: [{ id: "r0", score: 3, name: "first" }] },
      resolveId,
    );
    expect(state.needsSortSchedule).toBe(false);
    const snap1 = state.getSnapshot();
    expect(displayRows(snap1).map((r) => r.score)).toEqual([1, 2, 2, 3]);

    // Second update — array already owned, no new clone.
    state.applyStoreTransaction(
      { update: [{ id: "r1", score: 1, name: "second" }] },
      resolveId,
    );
    expect(state.needsSortSchedule).toBe(false);
    const snap2 = state.getSnapshot();
    expect(displayRows(snap2).map((r) => r.score)).toEqual([1, 2, 2, 3]);
    expect(displayRows(snap2).find((r) => r.id === "r1")?.name).toBe("second");
  });

  it("dirty sort field, valueGetter sort, comparator sort, structural all invalidate", () => {
    const cols: LightFastGridColDef[] = [
      { field: "score", sortable: true },
      { field: "name", sortable: true },
    ];

    // 1. Dirty sort field → recompute
    const state1 = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state1.setSortModel([{ field: "score", sort: "asc" }]);
    state1.getSnapshot();
    state1.applyStoreTransaction(
      { update: [{ id: "r0", score: 0, name: "alice" }] },
      resolveId,
    );
    expect(state1.needsSortSchedule).toBe(true);
    expect(displayRows(state1.getSnapshot()).map((r) => r.score)).toEqual([0, 1, 2, 2]);

    // 2. valueGetter sort → conservative recompute
    const vgCols: LightFastGridColDef[] = [
      { field: "score", sortable: true, valueGetter: ({ row }) => row.score },
    ];
    const state2 = new GridState({
      columns: vgCols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state2.setSortModel([{ field: "score", sort: "asc" }]);
    state2.getSnapshot();
    state2.applyStoreTransaction(
      { update: [{ id: "r0", score: 3, name: "updated" }] },
      resolveId,
    );
    expect(state2.needsSortSchedule).toBe(true);

    // 3. sortComparator sort → conservative recompute
    const cmpCols: LightFastGridColDef[] = [
      { field: "score", sortable: true, sortComparator: (a, b) => Number(a) - Number(b) },
    ];
    const state3 = new GridState({
      columns: cmpCols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state3.setSortModel([{ field: "score", sort: "asc" }]);
    state3.getSnapshot();
    state3.applyStoreTransaction(
      { update: [{ id: "r0", score: 3, name: "updated" }] },
      resolveId,
    );
    expect(state3.needsSortSchedule).toBe(true);

    // 4. Structural (add) → full invalidation
    const state4 = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state4.setSortModel([{ field: "score", sort: "asc" }]);
    state4.getSnapshot();
    state4.applyStoreTransaction(
      { add: [{ id: "r4", score: 0 }] },
      resolveId,
    );
    expect(state4.needsSortSchedule).toBe(true);

    // 5. Structural (remove) → full invalidation
    const state5 = new GridState({
      columns: cols,
      rows: makeRows(),
      getRowId: (row) => row.id,
    });
    state5.setSortModel([{ field: "score", sort: "asc" }]);
    state5.getSnapshot();
    state5.applyStoreTransaction(
      { remove: [{ id: "r0" }] },
      resolveId,
    );
    expect(state5.needsSortSchedule).toBe(true);
  });
});
