/**
 * Focused tests for worker sort → pair-cache integration.
 *
 * Verifies that `GridState.recordWorkerSortOrder()` populates the
 * `SortOrderPairCache` so subsequent ASC↔DESC toggles resolve from
 * cache via `GridState.tryResolveCachedSortOrder()`.
 */

import { describe, expect, it } from "vitest";

import { executeWorkerSortPayload } from "../../execution/operations/sort/sortWorkerAlgorithm";
import { resolveWorkerSortEligibility } from "../../execution/operations/sort/sortWorkerEligibility";
import { buildWorkerSortPayload } from "../../execution/operations/sort/sortWorkerPayload";
import { createDisplayRowReader } from "../../rendering/rowViewAccess";
import type { RowOrder } from "../../row-model/rowOrder";
import { createIndexedRowOrder } from "../../row-model/rowOrder";
import type { ColumnDef, GridSnapshot, RowData, SortModel } from "../../types";
import { GridState } from "../GridState";

// ── Helpers ───────────────────────────────────────────────────────────

const cols: ColumnDef[] = [
  { field: "score", sortable: true } as ColumnDef,
  { field: "name", sortable: true } as ColumnDef,
];

function makeRows(): RowData[] {
  return [
    { score: 3, name: "alice" },
    { score: 1, name: "bob" },
    { score: 2, name: "carol" },
    { score: 4, name: "dave" },
  ];
}

/** Simulate worker sort: eligibility → payload → algorithm → RowOrder. */
function simulateWorkerSort(
  rows: RowData[],
  sortModel: SortModel,
  columns: ColumnDef[],
): { indexes: Uint32Array; rowOrder: RowOrder } {
  const eligibility = resolveWorkerSortEligibility(sortModel, columns);
  const payload = buildWorkerSortPayload(rows, eligibility)!;
  const result = executeWorkerSortPayload(payload);
  return {
    indexes: result.indexes,
    rowOrder: createIndexedRowOrder(result.indexes),
  };
}

/** Map display-order rows from a snapshot's RowView. */
function displayRows(snap: GridSnapshot): RowData[] {
  const reader = createDisplayRowReader(snap.rowView);
  return Array.from({ length: reader.rowCount }, (_, i) => reader.getRowData(i)!);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Worker sort → pair-cache integration", () => {
  it("single-column ASC worker result allows DESC toggle from cache", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    // 1. Set sort model to ASC and simulate worker sort.
    const ascModel: SortModel = [{ field: "score", sort: "asc" }];
    state.setSortModel(ascModel);
    state.markSortPending();

    const { indexes, rowOrder } = simulateWorkerSort(rows, ascModel, cols);
    state.applySortedRowOrder(rowOrder);
    state.recordWorkerSortOrder(indexes, rowOrder);

    // Verify ASC order.
    const ascSnap = state.getSnapshot();
    expect(displayRows(ascSnap).map((r) => r.score)).toEqual([1, 2, 3, 4]);

    // 2. Toggle to DESC — should resolve from pair cache.
    const descModel: SortModel = [{ field: "score", sort: "desc" }];
    state.setSortModel(descModel);

    const cachedOrder = state.tryResolveCachedSortOrder();
    expect(cachedOrder).not.toBeNull();

    // Verify DESC order from cache.
    const descSnap = state.getSnapshot();
    expect(displayRows(descSnap).map((r) => r.score)).toEqual([4, 3, 2, 1]);
  });

  it("single-column DESC worker result allows ASC toggle from cache", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    const descModel: SortModel = [{ field: "score", sort: "desc" }];
    state.setSortModel(descModel);
    state.markSortPending();

    const { indexes, rowOrder } = simulateWorkerSort(rows, descModel, cols);
    state.applySortedRowOrder(rowOrder);
    state.recordWorkerSortOrder(indexes, rowOrder);

    expect(displayRows(state.getSnapshot()).map((r) => r.score)).toEqual([4, 3, 2, 1]);

    // Toggle to ASC.
    const ascModel: SortModel = [{ field: "score", sort: "asc" }];
    state.setSortModel(ascModel);

    const cachedOrder = state.tryResolveCachedSortOrder();
    expect(cachedOrder).not.toBeNull();
    expect(displayRows(state.getSnapshot()).map((r) => r.score)).toEqual([1, 2, 3, 4]);
  });

  it("multi-column worker sort does not populate pair cache", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    const multiModel: SortModel = [
      { field: "name", sort: "asc" },
      { field: "score", sort: "desc" },
    ];
    state.setSortModel(multiModel);
    state.markSortPending();

    const { indexes, rowOrder } = simulateWorkerSort(rows, multiModel, cols);
    state.applySortedRowOrder(rowOrder);
    state.recordWorkerSortOrder(indexes, rowOrder);

    // Toggle to single-column — should not find pair cache.
    state.setSortModel([{ field: "name", sort: "desc" }]);
    const cachedOrder = state.tryResolveCachedSortOrder();
    // No pair cache for multi-column sort.
    expect(cachedOrder).toBeNull();
  });

  it("worker result with null values correctly counts non-null for pair cache", () => {
    const rows: RowData[] = [
      { score: 3 },
      { score: null },
      { score: 1 },
      { score: undefined },
    ];
    const state = new GridState({ columns: cols, rows });

    const ascModel: SortModel = [{ field: "score", sort: "asc" }];
    state.setSortModel(ascModel);
    state.markSortPending();

    const { indexes, rowOrder } = simulateWorkerSort(rows, ascModel, cols);
    state.applySortedRowOrder(rowOrder);
    state.recordWorkerSortOrder(indexes, rowOrder);

    // ASC: non-null first (1, 3), then null/undefined last.
    const ascScores = displayRows(state.getSnapshot()).map((r) => r.score);
    expect(ascScores[0]).toBe(1);
    expect(ascScores[1]).toBe(3);

    // Toggle to DESC — pair cache should still work.
    state.setSortModel([{ field: "score", sort: "desc" }]);
    const cachedOrder = state.tryResolveCachedSortOrder();
    expect(cachedOrder).not.toBeNull();

    const descScores = displayRows(state.getSnapshot()).map((r) => r.score);
    expect(descScores[0]).toBe(3);
    expect(descScores[1]).toBe(1);
    // null/undefined still last in desc.
    expect(descScores[2] === null || descScores[2] === undefined).toBe(true);
    expect(descScores[3] === null || descScores[3] === undefined).toBe(true);
  });

  it("ineligible main-thread path still uses existing pair cache behavior", () => {
    // A small dataset with valueGetter goes through main-thread sort,
    // which populates the pair cache internally via SortExecutionContext.
    const vgCols: ColumnDef[] = [
      {
        field: "score",
        sortable: true,
        valueGetter: ({ row }: { row: RowData }) => row.score,
      } as ColumnDef,
    ];
    const rows: RowData[] = [{ score: 3 }, { score: 1 }, { score: 2 }];
    const state = new GridState({ columns: vgCols, rows });

    // Sync sort (small dataset, goes through computeSortedRowOrder).
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const ascSnap = state.getSnapshot();
    expect(displayRows(ascSnap).map((r) => r.score)).toEqual([1, 2, 3]);

    // Toggle — sync sort via RowModelRuntime's computeSortedRowOrder
    // populates pair cache for the main-thread path.
    state.setSortModel([{ field: "score", sort: "desc" }]);
    const descSnap = state.getSnapshot();
    expect(displayRows(descSnap).map((r) => r.score)).toEqual([3, 2, 1]);
  });

  it("setRows after worker cache recording invalidates the pair cache", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });

    const ascModel: SortModel = [{ field: "score", sort: "asc" }];
    state.setSortModel(ascModel);
    state.markSortPending();

    const { indexes, rowOrder } = simulateWorkerSort(rows, ascModel, cols);
    state.applySortedRowOrder(rowOrder);
    state.recordWorkerSortOrder(indexes, rowOrder);

    // Change rows — pair cache should be invalidated.
    state.setRows([{ score: 99 }, { score: 0 }]);
    state.setSortModel([{ field: "score", sort: "desc" }]);

    const cachedOrder = state.tryResolveCachedSortOrder();
    // Pair cache was invalidated by setRows — no hit.
    expect(cachedOrder).toBeNull();
  });
});
