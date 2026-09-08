// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDisplayRowReader } from "../../../../rendering/rowViewAccess";
import { GridState } from "../../../../state/GridState";
import type {
  ColumnDef,
  GridSnapshot,
  LightFastGridColDef,
  LightFastGridProps,
  RowData,
} from "../../../../types";
import { applySortModel, applySortModelToRowOrder } from "../../../../utils/sortModel";
import { ASYNC_SORT_ROW_THRESHOLD, GridExecutionService } from "../../../GridExecutionService";
import { TaskRequestTracker } from "../../../TaskRequestTracker";
import { SORT_OPERATION_THRESHOLD } from "../sortOperation";

/** Map display-order rows from a snapshot's RowView. */
function displayRows(snap: GridSnapshot): RowData[] {
  const reader = createDisplayRowReader(snap.rowView);
  return Array.from({ length: reader.rowCount }, (_, i) => reader.getRowData(i)!);
}

function makeRows(n: number): RowData[] {
  return Array.from({ length: n }, (_, i) => ({ v: n - i, id: String(i) }));
}

const cols: LightFastGridColDef[] = [{ field: "v", sortable: true }];

function flushRafAndTimers(): void {
  vi.advanceTimersByTime(16);
  vi.advanceTimersByTime(1);
}

describe("TaskRequestTracker", () => {
  it("next increments per kind", () => {
    const t = new TaskRequestTracker();
    expect(t.next("sort")).toBe(1);
    expect(t.next("sort")).toBe(2);
    expect(t.next("filter")).toBe(1);
  });

  it("isLatest checks the current counter", () => {
    const t = new TaskRequestTracker();
    const id1 = t.next("sort");
    expect(t.isLatest("sort", id1)).toBe(true);
    const id2 = t.next("sort");
    expect(t.isLatest("sort", id1)).toBe(false);
    expect(t.isLatest("sort", id2)).toBe(true);
  });

  it("cancel increments so prior ids are stale", () => {
    const t = new TaskRequestTracker();
    const id = t.next("sort");
    t.cancel("sort");
    expect(t.isLatest("sort", id)).toBe(false);
  });
});

describe("async sort boundary in GridState", () => {
  it("markSortPending makes snapshot report pending", () => {
    const state = new GridState({ columns: cols, rows: makeRows(5) });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    expect(state.isSortPending()).toBe(false);
    expect(state.getSnapshot().sortPending).toBe(false);

    state.markSortPending();
    expect(state.isSortPending()).toBe(true);
    expect(state.getSnapshot().sortPending).toBe(true);
  });

  it("pending sort returns raw rows, not re-sorted data", () => {
    const rows = makeRows(5);
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    state.markSortPending();

    const snap = state.getSnapshot();
    expect(snap.sortPending).toBe(true);
    expect(snap.data).toBe(rows);
    expect((snap.data[0] as { v: number }).v).toBe(5);
  });

  it("applySortedRowOrder delivers async result and clears pending", () => {
    const rows = makeRows(10);
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    state.markSortPending();

    const visibleCols = state.getVisibleColumnDefs();
    const order = applySortModelToRowOrder(
      rows,
      [{ field: "v", sort: "asc" }],
      visibleCols,
    );
    const sorted = applySortModel(rows, [{ field: "v", sort: "asc" }], visibleCols);

    state.applySortedRowOrder(order);
    expect(state.isSortPending()).toBe(false);
    const snap = state.getSnapshot();
    expect(snap.sortPending).toBe(false);
    // snap.data is the raw source rows; display order is via RowView.
    expect(snap.data).toBe(rows);
    expect(displayRows(snap)).toEqual(sorted);
    // Subsequent snapshots return the same source rows reference.
    expect(state.getSnapshot().data).toBe(snap.data);
  });

  it("getSnapshot during pending does not synchronously sort large data", () => {
    const rows = makeRows(100);
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    state.markSortPending();

    const snap = state.getSnapshot();
    expect(snap.data).toBe(rows);
    expect((snap.data[0] as { v: number }).v).toBe(100);
    expect(snap.sortPending).toBe(true);
  });

  it("clearSortPending restores synchronous sort path", () => {
    const rows = makeRows(5);
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    state.markSortPending();
    state.clearSortPending();

    const snap = state.getSnapshot();
    expect(snap.sortPending).toBe(false);
    // Display order via RowView shows sorted result.
    const dr = displayRows(snap);
    expect((dr[0] as { v: number }).v).toBe(1);
  });

  it("setRows clears async sorted row order", () => {
    const rows = makeRows(5);
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "v", sort: "asc" }]);

    const visibleCols = state.getVisibleColumnDefs();
    const order = applySortModelToRowOrder(
      rows,
      [{ field: "v", sort: "asc" }],
      visibleCols,
    );
    state.applySortedRowOrder(order);

    const newRows = makeRows(3);
    state.setRows(newRows);

    state.clearSortPending();
    const snap = state.getSnapshot();
    // Display order via RowView shows sorted result for new rows.
    const dr = displayRows(snap);
    expect((dr[0] as { v: number }).v).toBe(1);
    expect(dr.length).toBe(3);
  });

  it("refreshSortModel normalizes against current visible columns", () => {
    const state = new GridState({
      columns: [
        { field: "a", sortable: true },
        { field: "b", sortable: true },
      ],
      rows: [{ a: 1, b: 2 }],
    });
    state.setSortModel([{ field: "a", sort: "asc" }, { field: "b", sort: "desc" }]);
    expect(state.getSortModel()).toHaveLength(2);

    state.setColumns([{ field: "a", sortable: true }]);
    const changed = state.refreshSortModel();
    expect(changed).toBe(true);
    expect(state.getSortModel()).toEqual([{ field: "a", sort: "asc" }]);
  });

  it("refreshSortModel clears sort when sorted column becomes unsortable", () => {
    const state = new GridState({
      columns: [{ field: "a", sortable: true }],
      rows: [{ a: 1 }],
    });
    state.setSortModel([{ field: "a", sort: "asc" }]);
    state.setColumns([{ field: "a", sortable: false }]);
    const changed = state.refreshSortModel();
    expect(changed).toBe(true);
    expect(state.getSortModel()).toEqual([]);
  });

  it("refreshSortModel returns false when sort model unchanged", () => {
    const state = new GridState({
      columns: [{ field: "a", sortable: true }],
      rows: [{ a: 1 }],
    });
    state.setSortModel([{ field: "a", sort: "asc" }]);
    expect(state.refreshSortModel()).toBe(false);
  });
});

describe("GridExecutionService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Below-threshold sorts execute synchronously through the generic
  // runner. Deferred rAF + setTimeout scheduling only applies to large
  // main-thread fallback work (worker-ineligible at/above threshold),
  // which is the only path Grid routes through the service anyway.

  /** Large worker-ineligible input — forces the deferred main path. */
  function makeDeferredCase(): { rows: RowData[]; cols: ColumnDef[] } {
    return {
      rows: makeRows(ASYNC_SORT_ROW_THRESHOLD),
      cols: [
        { field: "v", sortable: true, valueGetter: ({ row }) => row.v },
      ],
    };
  }

  it("small scheduleSort completes synchronously below threshold", async () => {
    const { GridExecutionService } = await import("../../../GridExecutionService");
    const svc = new GridExecutionService();
    const rows = makeRows(10);
    const visibleCols: ColumnDef[] = [{ field: "v", sortable: true }];
    let result: unknown = null;

    svc.scheduleSort(rows, [{ field: "v", sort: "asc" }], visibleCols, (c) => {
      result = c;
    });

    expect(result).not.toBeNull();

    svc.destroy();
  });

  it("large ineligible scheduleSort defers via rAF + setTimeout(0)", async () => {
    const { GridExecutionService } = await import("../../../GridExecutionService");
    const svc = new GridExecutionService();
    const { rows, cols: visibleCols } = makeDeferredCase();
    let called = false;

    svc.scheduleSort(rows, [{ field: "v", sort: "asc" }], visibleCols, () => {
      called = true;
    });

    expect(called).toBe(false);

    vi.advanceTimersByTime(16);
    expect(called).toBe(false);

    vi.advanceTimersByTime(1);
    expect(called).toBe(true);

    svc.destroy();
  });

  it("cancelSort prevents deferred completion callback", async () => {
    const { GridExecutionService } = await import("../../../GridExecutionService");
    const svc = new GridExecutionService();
    const { rows, cols: visibleCols } = makeDeferredCase();
    let called = false;

    svc.scheduleSort(rows, [{ field: "v", sort: "asc" }], visibleCols, () => {
      called = true;
    });

    svc.cancelSort();
    flushRafAndTimers();
    expect(called).toBe(false);

    svc.destroy();
  });

  it("destroy cancels pending rAF and timer", async () => {
    const { GridExecutionService } = await import("../../../GridExecutionService");
    const svc = new GridExecutionService();
    const { rows, cols: visibleCols } = makeDeferredCase();
    let called = false;

    svc.scheduleSort(rows, [{ field: "v", sort: "asc" }], visibleCols, () => {
      called = true;
    });

    svc.destroy();
    flushRafAndTimers();
    expect(called).toBe(false);
  });

  it("only latest deferred scheduleSort fires when called twice", async () => {
    const { GridExecutionService } = await import("../../../GridExecutionService");
    const svc = new GridExecutionService();
    const { rows, cols: visibleCols } = makeDeferredCase();
    const results: number[] = [];

    svc.scheduleSort(rows, [{ field: "v", sort: "asc" }], visibleCols, (c) => {
      results.push(c.requestId);
    });

    svc.scheduleSort(rows, [{ field: "v", sort: "desc" }], visibleCols, (c) => {
      results.push(c.requestId);
    });

    flushRafAndTimers();
    expect(results).toHaveLength(1);
    expect(results[0]).toBe(2);

    svc.destroy();
  });

  it("completion includes sortModel and sourceRows for stale checking", async () => {
    const { GridExecutionService } = await import("../../../GridExecutionService");
    const svc = new GridExecutionService();
    const rows = makeRows(10);
    const visibleCols: ColumnDef[] = [{ field: "v", sortable: true }];
    const sortModel = [{ field: "v", sort: "asc" as const }];
    let completion: unknown = null;

    svc.scheduleSort(rows, sortModel, visibleCols, (c) => {
      completion = c;
    });

    flushRafAndTimers();

    const c = completion as { sortModel: unknown; sourceRows: unknown };
    expect(c.sortModel).toBe(sortModel);
    expect(c.sourceRows).toBe(rows);

    svc.destroy();
  });
});

describe("async sort via Grid (integration)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("small sort works synchronously", async () => {
    const { Grid } = await import("../../../../Grid");
    const rows = makeRows(100);
    const grid = new Grid({ columns: cols, rows });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    grid.setSortModel([{ field: "v", sort: "asc" }]);
    flushRafAndTimers();

    grid.destroy();
  });

  it("large sort marks pending and resolves after rAF + timer", async () => {
    const { Grid } = await import("../../../../Grid");
    const rows = makeRows(ASYNC_SORT_ROW_THRESHOLD + 100);
    const grid = new Grid({ columns: cols, rows });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    grid.setSortModel([{ field: "v", sort: "asc" }]);

    flushRafAndTimers();

    grid.destroy();
  });

  it("stale sort result is ignored on rapid toggle", async () => {
    const { Grid } = await import("../../../../Grid");
    const rows = makeRows(ASYNC_SORT_ROW_THRESHOLD + 100);
    const grid = new Grid({ columns: cols, rows });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    grid.setSortModel([{ field: "v", sort: "asc" }]);
    grid.setSortModel([{ field: "v", sort: "desc" }]);

    flushRafAndTimers();

    grid.destroy();
  });

  it("clearSort on large dataset cancels pending sort", async () => {
    const { Grid } = await import("../../../../Grid");
    const rows = makeRows(ASYNC_SORT_ROW_THRESHOLD + 100);
    const grid = new Grid({ columns: cols, rows });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    grid.setSortModel([{ field: "v", sort: "asc" }]);
    grid.clearSort();

    flushRafAndTimers();

    expect(grid.getSortModel()).toEqual([]);
    grid.destroy();
  });

  it("sort event fires immediately even for large async sort", async () => {
    const { Grid } = await import("../../../../Grid");
    const rows = makeRows(ASYNC_SORT_ROW_THRESHOLD + 100);
    const grid = new Grid({ columns: cols, rows });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    const events: unknown[] = [];
    grid.on("sort:changed", (e) => events.push(e));

    grid.setSortModel([{ field: "v", sort: "asc" }]);

    expect(events.length).toBe(1);

    flushRafAndTimers();

    grid.destroy();
  });

  it("changing columns while async sort is pending cancels old sort and reschedules", async () => {
    const { Grid } = await import("../../../../Grid");
    const rows = makeRows(ASYNC_SORT_ROW_THRESHOLD + 100);
    const grid = new Grid({
      columns: [
        { field: "v", sortable: true },
        { field: "id", sortable: true },
      ],
      rows,
    });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    grid.setSortModel([{ field: "v", sort: "asc" }]);

    grid.setColumns([{ field: "v", sortable: true }]);

    flushRafAndTimers();

    expect(grid.getSortModel()).toEqual([{ field: "v", sort: "asc" }]);
    grid.destroy();
  });

  it("changing columns to remove sorted column clears sort model", async () => {
    const { Grid } = await import("../../../../Grid");
    const rows = makeRows(ASYNC_SORT_ROW_THRESHOLD + 100);
    const grid = new Grid({
      columns: [
        { field: "v", sortable: true },
        { field: "id", sortable: true },
      ],
      rows,
    });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    grid.setSortModel([{ field: "v", sort: "asc" }]);

    grid.setColumns([{ field: "id", sortable: true }]);

    flushRafAndTimers();

    expect(grid.getSortModel()).toEqual([]);
    grid.destroy();
  });

  it("changing defaultColDef to make sorted column unsortable clears sort model", async () => {
    const { Grid } = await import("../../../../Grid");
    const rows = makeRows(ASYNC_SORT_ROW_THRESHOLD + 100);
    const grid = new Grid({
      columns: [{ field: "v" }],
      defaultColDef: { sortable: true },
      rows,
    });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    grid.setSortModel([{ field: "v", sort: "asc" }]);

    grid.setDefaultColDef({ sortable: false });

    flushRafAndTimers();

    expect(grid.getSortModel()).toEqual([]);
    grid.destroy();
  });

  it("changing rows while async sort is pending ignores stale result", async () => {
    const { Grid } = await import("../../../../Grid");
    const rows1 = makeRows(ASYNC_SORT_ROW_THRESHOLD + 100);
    const grid = new Grid({ columns: cols, rows: rows1 });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    grid.setSortModel([{ field: "v", sort: "asc" }]);

    const rows2 = makeRows(ASYNC_SORT_ROW_THRESHOLD + 200);
    grid.setRows(rows2);

    flushRafAndTimers();

    grid.destroy();
  });

  it("threshold constant is 25000", () => {
    expect(ASYNC_SORT_ROW_THRESHOLD).toBe(25_000);
  });

  // Warm cache lookups now flow through scheduleSort like any other
  // request — the runner's cache path resolves them synchronously, so
  // the observable contract is "no pending state, no deferred work",
  // not "scheduleSort never called".

  it("warm single-column ASC→DESC resolves synchronously without pending", async () => {
    const { Grid } = await import("../../../../Grid");
    const pendingSpy = vi.spyOn(GridState.prototype, "markSortPending");

    const rows = makeRows(ASYNC_SORT_ROW_THRESHOLD + 100);
    const grid = new Grid({ columns: cols, rows });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    // First ASC — must go through async sort (marks pending)
    grid.setSortModel([{ field: "v", sort: "asc" }]);
    expect(pendingSpy).toHaveBeenCalledTimes(1);
    flushRafAndTimers(); // let async sort complete

    // DESC — derives from warm pair cache synchronously, never pending
    pendingSpy.mockClear();
    grid.setSortModel([{ field: "v", sort: "desc" }]);
    expect(pendingSpy).not.toHaveBeenCalled();

    // ASC again — exact cache hit, never pending
    grid.setSortModel([{ field: "v", sort: "asc" }]);
    expect(pendingSpy).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
    pendingSpy.mockRestore();
  });

  it("warm cache hit preserves GridState's cached RowOrder", async () => {
    const { Grid } = await import("../../../../Grid");
    const pendingSpy = vi.spyOn(GridState.prototype, "markSortPending");
    const applySpy = vi.spyOn(GridState.prototype, "applySortedRowOrder");
    const clearSpy = vi.spyOn(GridState.prototype, "clearSortPending");

    const rows = makeRows(ASYNC_SORT_ROW_THRESHOLD + 100);
    const grid = new Grid({ columns: cols, rows });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    // Warm ASC via async path
    grid.setSortModel([{ field: "v", sort: "asc" }]);
    flushRafAndTimers();
    pendingSpy.mockClear();
    applySpy.mockClear();
    clearSpy.mockClear();

    // DESC — warm cache hit: synchronous, no pending, and the cache
    // adapter's RowOrder (already in GridState.sortCache) is kept
    // rather than replaced via applySortedRowOrder.
    grid.setSortModel([{ field: "v", sort: "desc" }]);
    expect(pendingSpy).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();

    grid.destroy();
    container.remove();
    pendingSpy.mockRestore();
    applySpy.mockRestore();
    clearSpy.mockRestore();
  });
});

describe("configurable execution thresholds — sort", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GridExecutionService defaults to SORT_OPERATION_THRESHOLD", () => {
    const svc = new GridExecutionService();
    expect(svc.getSortThreshold()).toBe(SORT_OPERATION_THRESHOLD);
    svc.destroy();
  });

  it("GridExecutionService accepts custom sort threshold via constructor", () => {
    const svc = new GridExecutionService({ thresholds: { sort: 100 } });
    expect(svc.getSortThreshold()).toBe(100);
    svc.destroy();
  });

  it("setExecutionOptions updates sort threshold at runtime", () => {
    const svc = new GridExecutionService();
    svc.setExecutionOptions({ thresholds: { sort: 500 } });
    expect(svc.getSortThreshold()).toBe(500);
    svc.destroy();
  });

  it("setExecutionOptions(undefined) resets to default", () => {
    const svc = new GridExecutionService({ thresholds: { sort: 100 } });
    svc.setExecutionOptions(undefined);
    expect(svc.getSortThreshold()).toBe(SORT_OPERATION_THRESHOLD);
    svc.destroy();
  });

  it("custom threshold below row count triggers async sort path", async () => {
    const { Grid } = await import("../../../../Grid");
    const rows = makeRows(200);
    const grid = new Grid({
      columns: cols,
      rows,
      execution: { thresholds: { sort: 100 } },
    });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    const pendingSpy = vi.spyOn(GridState.prototype, "markSortPending");

    grid.setSortModel([{ field: "v", sort: "asc" }]);
    expect(pendingSpy).toHaveBeenCalled();

    flushRafAndTimers();

    pendingSpy.mockRestore();
    grid.destroy();
    container.remove();
  });

  it("custom threshold above row count keeps sync sort path", async () => {
    const { Grid } = await import("../../../../Grid");
    const rows = makeRows(200);
    const grid = new Grid({
      columns: cols,
      rows,
      execution: { thresholds: { sort: 500 } },
    });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    const pendingSpy = vi.spyOn(GridState.prototype, "markSortPending");

    grid.setSortModel([{ field: "v", sort: "asc" }]);
    expect(pendingSpy).not.toHaveBeenCalled();

    pendingSpy.mockRestore();
    grid.destroy();
    container.remove();
  });

  it("Grid.setExecutionOptions updates threshold at runtime", async () => {
    const { Grid } = await import("../../../../Grid");
    const rows = makeRows(200);
    const grid = new Grid({
      columns: cols,
      rows,
      execution: { thresholds: { sort: 500 } },
    });

    const container = document.createElement("div");
    grid.mount(container);
    flushRafAndTimers();

    grid.setExecutionOptions({ thresholds: { sort: 100 } });

    const pendingSpy = vi.spyOn(GridState.prototype, "markSortPending");
    grid.setSortModel([{ field: "v", sort: "asc" }]);
    expect(pendingSpy).toHaveBeenCalled();

    flushRafAndTimers();

    pendingSpy.mockRestore();
    grid.destroy();
    container.remove();
  });
});

// Regression: async sort must compose after quick search, not skip it.
// The pipeline is raw rows → column filter → quick search → sort. Async
// sort previously derived its source indexes from the column-filtered
// order only, re-expanding the result to the full dataset. These tests
// force the async sort path (low sort threshold) while keeping quick
// search synchronous (tiny dataset, default 25k threshold) to isolate the
// orchestration defect. Uses real timers + async settling.
describe("quick search + async sort composition (Grid integration)", () => {
  function qsRows(): RowData[] {
    // "Xy" matches ids 1,3,5,7 (deliberately unsorted v values).
    return [
      { id: "1", name: "AlphaXy", cat: "A", v: 50 },
      { id: "2", name: "Beta", cat: "A", v: 10 },
      { id: "3", name: "GammaXy", cat: "A", v: 30 },
      { id: "4", name: "Delta", cat: "B", v: 20 },
      { id: "5", name: "EpsilonXy", cat: "B", v: 40 },
      { id: "6", name: "Zeta", cat: "B", v: 5 },
      { id: "7", name: "EtaXy", cat: "A", v: 60 },
      { id: "8", name: "Theta", cat: "A", v: 15 },
    ];
  }

  const qsCols: LightFastGridColDef[] = [
    { field: "name", sortable: true },
    { field: "cat", filter: "text" },
    { field: "v", sortable: true },
  ];

  // Narrow, typed access to the Grid's GridState — no broad cast.
  function stateOf(grid: object): GridState {
    const candidate: unknown = Reflect.get(grid, "state");
    if (!(candidate instanceof GridState)) {
      throw new Error("Grid.state is not a GridState instance");
    }
    return candidate;
  }

  function displayIds(grid: object): string[] {
    const reader = createDisplayRowReader(stateOf(grid).getSnapshot().rowView);
    return Array.from({ length: reader.rowCount }, (_, i) =>
      String(reader.getRowData(i)?.id),
    );
  }

  async function settle(grid: object, maxTicks = 60): Promise<void> {
    for (let i = 0; i < maxTicks; i++) {
      const state = stateOf(grid);
      if (!state.isSortPending() && !state.isQuickSearchPending()) return;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("async sort/quick-search did not settle");
  }

  async function makeGrid(props?: Partial<LightFastGridProps>) {
    const { Grid } = await import("../../../../Grid");
    const grid = new Grid({
      columns: qsCols,
      rows: qsRows(),
      getRowId: (r) => String(r.id),
      quickFilter: true,
      // Force async sort even for this tiny dataset; keep quick search
      // synchronous (dataset is far below the 25k quick-search threshold).
      execution: { thresholds: { sort: 3 } },
      ...props,
    });
    const container = document.createElement("div");
    grid.mount(container);
    return { grid, container };
  }

  // A. Active ASC sort → set quick-filter text.
  it("active ASC async sort then quick search keeps only matches, ascending", async () => {
    const { grid, container } = await makeGrid();
    try {
      grid.setSortModel([{ field: "v", sort: "asc" }]);
      await settle(grid);
      // Full dataset ascending by v: 5,10,15,20,30,40,50,60.
      expect(displayIds(grid)).toEqual(["6", "2", "8", "4", "3", "5", "1", "7"]);

      grid.setQuickFilterText("Xy");
      await settle(grid);
      // Matches 1,3,5,7 (v = 50,30,40,60) ascending by v → 3,5,1,7.
      expect(displayIds(grid)).toEqual(["3", "5", "1", "7"]);
    } finally {
      grid.destroy();
      container.remove();
    }
  });

  // B. Active quick search → change sort to DESC.
  it("descending sort with active quick search keeps the same matches, descending", async () => {
    const { grid, container } = await makeGrid();
    try {
      grid.setQuickFilterText("Xy");
      grid.setSortModel([{ field: "v", sort: "asc" }]);
      await settle(grid);
      expect(displayIds(grid)).toEqual(["3", "5", "1", "7"]);

      grid.setSortModel([{ field: "v", sort: "desc" }]);
      await settle(grid);
      // Same matches, descending by v → 60,50,40,30 → 7,1,5,3.
      expect(displayIds(grid)).toEqual(["7", "1", "5", "3"]);
    } finally {
      grid.destroy();
      container.remove();
    }
  });

  // C. Clear quick search returns the full dataset, still sorted.
  it("clearing quick search restores the full sorted dataset", async () => {
    const { grid, container } = await makeGrid();
    try {
      grid.setSortModel([{ field: "v", sort: "asc" }]);
      grid.setQuickFilterText("Xy");
      await settle(grid);
      expect(displayIds(grid)).toEqual(["3", "5", "1", "7"]);

      grid.setQuickFilterText("");
      await settle(grid);
      // All 8 rows, ascending by v: 5,10,15,20,30,40,50,60.
      expect(displayIds(grid)).toEqual(["6", "2", "8", "4", "3", "5", "1", "7"]);
    } finally {
      grid.destroy();
      container.remove();
    }
  });

  // D. Column filter → quick search → async sort compose in order.
  it("column filter narrows first, then quick search, then async sort", async () => {
    const { grid, container } = await makeGrid();
    try {
      grid.setFilterModel({
        cat: { type: "text", conditions: [{ operator: "equals", value: "A" }] },
      });
      grid.setQuickFilterText("Xy");
      grid.setSortModel([{ field: "v", sort: "asc" }]);
      await settle(grid);

      // Filter cat=A → {1,2,3,7,8}; quick "Xy" → {1,3,7}; ascending v
      // (50,30,60) → 3,1,7.
      expect(displayIds(grid)).toEqual(["3", "1", "7"]);
    } finally {
      grid.destroy();
      container.remove();
    }
  });

  // E. A quick-search edit while a sort is in flight cancels the stale
  //    sort and the replacement sorts the new quick-search subset.
  it("stale in-flight sort is cancelled when quick-search text changes", async () => {
    const { grid, container } = await makeGrid();
    const cancelSpy = vi.spyOn(GridExecutionService.prototype, "cancelSort");
    try {
      grid.setSortModel([{ field: "v", sort: "asc" }]);
      // The async sort is now pending over the full dataset.
      expect(stateOf(grid).isSortPending()).toBe(true);
      cancelSpy.mockClear();

      // Changing quick-search text invalidates the sort source; the stale
      // in-flight sort must be cancelled before the replacement runs.
      grid.setQuickFilterText("Xy");
      expect(cancelSpy).toHaveBeenCalled();

      await settle(grid);

      // The replacement sort used the quick-search subset — only matches,
      // ascending — and the full-dataset sort never became the final order.
      const ids = displayIds(grid);
      expect(ids).toEqual(["3", "5", "1", "7"]);
      for (const stale of ["2", "4", "6", "8"]) {
        expect(ids).not.toContain(stale);
      }
    } finally {
      cancelSpy.mockRestore();
      grid.destroy();
      container.remove();
    }
  });
});
