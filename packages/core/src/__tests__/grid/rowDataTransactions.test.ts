// @vitest-environment jsdom

/**
 * Grid integration tests for row-data transactions.
 *
 * Pure engine behavior is covered in
 * `row-model/transactions/__tests__`. This file covers Grid
 * orchestration: commits, events, sort/pagination interplay,
 * selection/pin cleanup, async batching, and the immutable-rows path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GridExecutionService } from "../../execution/GridExecutionService";
import type { EditCommitChange } from "../../features/editing/editingTypes";
import { Grid } from "../../Grid";
import { CSS } from "../../rendering/const/css-classes";
import { createDisplayRowReader } from "../../rendering/rowViewAccess";
import type { GridState } from "../../state/GridState";
import type { LightFastGridProps, RowData } from "../../types";

/** Typed access to Grid private fields for test spying. */
interface GridTestInternals {
  state: GridState;
  execution: GridExecutionService;
  commitCellEdit(change: EditCommitChange): void;
}

const cols = [{ field: "v", sortable: true }];

function makeRows(ids: string[]): RowData[] {
  return ids.map((id, i) => ({ id, v: i }));
}

function createGrid(props: Partial<LightFastGridProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const grid = new Grid({
    columns: cols,
    rows: makeRows(["a", "b", "c"]),
    getRowId: (row) => row.id,
    suppressRowVirtualization: true,
    ...props,
  });
  grid.mount(container);
  return { grid, container };
}

function destroyGrid(grid: Grid, container: HTMLElement): void {
  grid.destroy();
  container.remove();
}

/**
 * Flush the rAF-scheduled render. Needed before selection APIs — the
 * selection capability attaches on the first rendered frame.
 */
async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Display-order row ids from the grid's current snapshot. */
function displayIds(grid: Grid): string[] {
  const snap = (grid as unknown as GridTestInternals).state.getSnapshot();
  const reader = createDisplayRowReader(snap.rowView);
  return Array.from({ length: reader.rowCount }, (_, i) =>
    String(reader.getRowData(i)!.id),
  );
}

describe("Grid.applyTransaction", () => {
  it("updates rows and emits row-data events", () => {
    const onRowDataUpdated = vi.fn();
    const { grid, container } = createGrid({ onRowDataUpdated });
    const busEvents: unknown[] = [];
    grid.on("row-data:updated", (e) => busEvents.push(e));

    const result = grid.applyTransaction({
      add: [{ id: "d", v: 3 }],
      update: [{ id: "b", v: 99 }],
      removeIds: ["a"],
    });

    expect(result.addCount).toBe(1);
    expect(result.updateCount).toBe(1);
    expect(result.removeCount).toBe(1);
    expect(displayIds(grid)).toEqual(["b", "c", "d"]);

    expect(onRowDataUpdated).toHaveBeenCalledOnce();
    expect(onRowDataUpdated.mock.calls[0]![0]).toEqual({
      source: "transaction",
      addCount: 1,
      updateCount: 1,
      removeCount: 1,
      skippedCount: 0,
      rowCount: 3,
    });
    expect(busEvents).toHaveLength(1);

    destroyGrid(grid, container);
  });

  it("all-skipped transaction changes nothing and emits no event", () => {
    const onRowDataUpdated = vi.fn();
    const { grid, container } = createGrid({ onRowDataUpdated });

    const result = grid.applyTransaction({
      update: [{ id: "missing" }],
      removeIds: ["also-missing"],
    });

    expect(result.skippedCount).toBe(2);
    expect(displayIds(grid)).toEqual(["a", "b", "c"]);
    expect(onRowDataUpdated).not.toHaveBeenCalled();

    destroyGrid(grid, container);
  });

  it("exposes current rows so repeated remove-first operations target transaction state", () => {
    const { grid, container } = createGrid();

    grid.applyTransaction({ add: [{ id: "d", v: -1 }], addIndex: 0 });

    const addedFirst = grid.getRows()[0];
    expect(addedFirst?.id).toBe("d");
    grid.applyTransaction({ removeIds: [String(addedFirst!.id)] });
    expect(displayIds(grid)).toEqual(["a", "b", "c"]);

    const nextFirst = grid.getRows()[0];
    expect(nextFirst?.id).toBe("a");
    grid.applyTransaction({ removeIds: [String(nextFirst!.id)] });
    expect(displayIds(grid)).toEqual(["b", "c"]);

    destroyGrid(grid, container);
  });

  it("sorting recomputes after a transaction", () => {
    const { grid, container } = createGrid({
      rows: [
        { id: "a", v: 1 },
        { id: "b", v: 3 },
      ],
    });
    grid.setSortModel([{ field: "v", sort: "asc" }]);

    grid.applyTransaction({ add: [{ id: "mid", v: 2 }] });

    // New row sorts into the middle through the existing sort path.
    expect(displayIds(grid)).toEqual(["a", "mid", "b"]);

    destroyGrid(grid, container);
  });

  it("cell edit of non-filtered field with active filter does not schedule filter work", () => {
    const rows: RowData[] = [
      { id: "a", name: "Alice", v: 1 },
      { id: "b", name: "Bob", v: 2 },
      { id: "c", name: "Charlie", v: 3 },
    ];
    const { grid, container } = createGrid({
      columns: [
        { field: "name", filter: "text" },
        { field: "v", editable: true },
      ],
      rows,
    });
    const scheduleSpy = vi.spyOn(
      (grid as unknown as GridTestInternals).execution,
      "scheduleFilter",
    );

    grid.setFilterModel({
      name: {
        type: "text",
        operator: "and",
        conditions: [{ operator: "contains", value: "li" }],
      },
    });
    const callsAfterFilter = scheduleSpy.mock.calls.length;
    expect(displayIds(grid)).toEqual(["a", "c"]);

    (grid as unknown as GridTestInternals).commitCellEdit({
      rowId: "a",
      rowIndex: 0,
      sourceIndex: 0,
      field: "v",
      topLevelField: "v",
      oldValue: 1,
      newValue: 10,
      updatedRow: { id: "a", name: "Alice", v: 10 },
    });

    expect(scheduleSpy).toHaveBeenCalledTimes(callsAfterFilter);
    expect(displayIds(grid)).toEqual(["a", "c"]);
    expect(grid.getRows()[0]!.v).toBe(10);

    scheduleSpy.mockRestore();
    destroyGrid(grid, container);
  });

  it("pagination clamps after removals", () => {
    const { grid, container } = createGrid({
      rows: makeRows(
        Array.from({ length: 12 }, (_, i) => `r${i}`),
      ),
      pagination: true,
      paginationPageSize: 5,
    });
    grid.lastPage();
    expect(grid.getPaginationState().pageIndex).toBe(2);

    grid.applyTransaction({ removeIds: ["r9", "r10", "r11"] });

    // 9 rows remain → 2 pages → pageIndex clamps from 2 to 1.
    const state = grid.getPaginationState();
    expect(state.totalRows).toBe(9);
    expect(state.pageCount).toBe(2);
    expect(state.pageIndex).toBe(1);

    destroyGrid(grid, container);
  });

  it("removes deleted ids from selection, keeps the rest", async () => {
    const onSelectionChanged = vi.fn();
    const { grid, container } = createGrid({
      rowSelection: "multiple",
      onSelectionChanged,
    });
    await flushRenders(); // selection capability attaches on first render
    grid.setSelectedRowIds(["a", "b"]);
    await Promise.resolve(); // selection events dispatch async
    onSelectionChanged.mockClear();

    grid.applyTransaction({ removeIds: ["b"] });
    await Promise.resolve();

    expect(grid.getSelectedRowIds()).toEqual(["a"]);
    expect(onSelectionChanged).toHaveBeenCalledOnce();

    // Removing an unselected row leaves selection untouched — no event.
    onSelectionChanged.mockClear();
    grid.applyTransaction({ removeIds: ["c"] });
    await Promise.resolve();
    expect(grid.getSelectedRowIds()).toEqual(["a"]);
    expect(onSelectionChanged).not.toHaveBeenCalled();

    destroyGrid(grid, container);
  });

  it("removes deleted ids from row pinning, keeps the rest", () => {
    const onRowPinChanged = vi.fn();
    const { grid, container } = createGrid({ onRowPinChanged });
    grid.pinRow("a", "top");
    grid.pinRow("b", "bottom");
    onRowPinChanged.mockClear();

    grid.applyTransaction({ removeIds: ["a"] });

    expect(grid.getRowPinState()).toEqual([{ rowId: "b", pinned: "bottom" }]);
    expect(onRowPinChanged).toHaveBeenCalledOnce();

    // Removing an unpinned row emits no pin event.
    onRowPinChanged.mockClear();
    grid.applyTransaction({ removeIds: ["c"] });
    expect(onRowPinChanged).not.toHaveBeenCalled();

    destroyGrid(grid, container);
  });
});

describe("Grid async transactions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches queued transactions into one flush after the wait", () => {
    const onAsyncTransactionsFlushed = vi.fn();
    const { grid, container } = createGrid({ onAsyncTransactionsFlushed });
    const batchSpy = vi.spyOn(
      (grid as unknown as GridTestInternals).state,
      "applyStoreTransactionBatch",
    );

    grid.applyTransactionAsync({ add: [{ id: "d" }] });
    grid.applyTransactionAsync({ removeIds: ["a"] });

    // Nothing applied before the wait elapses.
    expect(displayIds(grid)).toEqual(["a", "b", "c"]);
    expect(onAsyncTransactionsFlushed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(displayIds(grid)).toEqual(["b", "c", "d"]);
    // One commit for the whole batch — single applyStoreTransactionBatch call.
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(onAsyncTransactionsFlushed).toHaveBeenCalledOnce();
    expect(
      onAsyncTransactionsFlushed.mock.calls[0]![0].results,
    ).toHaveLength(2);

    destroyGrid(grid, container);
  });

  it("invokes callbacks in transaction order with individual results", () => {
    const { grid, container } = createGrid();
    const order: string[] = [];

    grid.applyTransactionAsync({ add: [{ id: "d" }] }, (result) => {
      order.push(`first:${result.addCount}`);
    });
    grid.applyTransactionAsync({ removeIds: ["d"] }, (result) => {
      order.push(`second:${result.removeCount}`);
    });

    vi.advanceTimersByTime(50);

    // Second transaction sees the first one's rows (d added then removed).
    expect(order).toEqual(["first:1", "second:1"]);
    expect(displayIds(grid)).toEqual(["a", "b", "c"]);

    destroyGrid(grid, container);
  });

  it("flushAsyncTransactions drains immediately and cancels the timer", () => {
    const onAsyncTransactionsFlushed = vi.fn();
    const { grid, container } = createGrid({ onAsyncTransactionsFlushed });

    grid.applyTransactionAsync({ add: [{ id: "d" }] });
    const results = grid.flushAsyncTransactions();

    expect(results).toHaveLength(1);
    expect(displayIds(grid)).toEqual(["a", "b", "c", "d"]);
    expect(onAsyncTransactionsFlushed).toHaveBeenCalledOnce();

    // The pending timer must not double-flush.
    vi.advanceTimersByTime(100);
    expect(onAsyncTransactionsFlushed).toHaveBeenCalledOnce();
    expect(grid.flushAsyncTransactions()).toEqual([]);

    destroyGrid(grid, container);
  });

  it("setAsyncTransactionWaitMillis affects future flushes, not a queued one", () => {
    const { grid, container } = createGrid(); // default 50ms

    // Queue with the default delay, then shorten it — the already
    // queued timer keeps its original timing.
    grid.applyTransactionAsync({ add: [{ id: "d" }] });
    grid.setAsyncTransactionWaitMillis(10);
    vi.advanceTimersByTime(10);
    expect(displayIds(grid)).toEqual(["a", "b", "c"]); // still pending
    vi.advanceTimersByTime(40);
    expect(displayIds(grid)).toEqual(["a", "b", "c", "d"]);

    // The next queue start uses the updated delay. This is the same
    // setter the React adapter calls when the prop changes.
    grid.applyTransactionAsync({ removeIds: ["d"] });
    vi.advanceTimersByTime(10);
    expect(displayIds(grid)).toEqual(["a", "b", "c"]);

    // Normalization: undefined resets to the 50ms default, negative
    // values clamp to 0.
    grid.setAsyncTransactionWaitMillis(undefined);
    grid.applyTransactionAsync({ add: [{ id: "e" }] });
    vi.advanceTimersByTime(49);
    expect(displayIds(grid)).toEqual(["a", "b", "c"]);
    vi.advanceTimersByTime(1);
    expect(displayIds(grid)).toEqual(["a", "b", "c", "e"]);

    grid.setAsyncTransactionWaitMillis(-5);
    grid.applyTransactionAsync({ removeIds: ["e"] });
    vi.advanceTimersByTime(0);
    expect(displayIds(grid)).toEqual(["a", "b", "c"]);

    destroyGrid(grid, container);
  });

  it("respects a custom asyncTransactionWaitMillis", () => {
    const { grid, container } = createGrid({ asyncTransactionWaitMillis: 10 });

    grid.applyTransactionAsync({ add: [{ id: "d" }] });
    vi.advanceTimersByTime(9);
    expect(displayIds(grid)).toEqual(["a", "b", "c"]);
    vi.advanceTimersByTime(1);
    expect(displayIds(grid)).toEqual(["a", "b", "c", "d"]);

    destroyGrid(grid, container);
  });
});

describe("Grid.setRowsImmutable", () => {
  it("applies an id-based diff and emits with source immutableRows", () => {
    const onRowDataUpdated = vi.fn();
    const { grid, container } = createGrid({ onRowDataUpdated });

    const next = [
      { id: "a", v: 0 }, // updated (new object)
      { id: "c", v: 2 }, // updated (new object)
      { id: "d", v: 3 }, // added; "b" removed
    ];
    const result = grid.setRowsImmutable(next);

    expect(result.addCount).toBe(1);
    expect(result.updateCount).toBe(2);
    expect(result.removeCount).toBe(1);
    expect(displayIds(grid)).toEqual(["a", "c", "d"]);
    expect(onRowDataUpdated).toHaveBeenCalledOnce();
    expect(onRowDataUpdated.mock.calls[0]![0]).toMatchObject({
      source: "immutableRows",
      rowCount: 3,
    });

    destroyGrid(grid, container);
  });

  it("cleans up selection and pins for diff-removed rows", async () => {
    const { grid, container } = createGrid({ rowSelection: "multiple" });
    await flushRenders(); // selection capability attaches on first render
    grid.setSelectedRowIds(["a", "b"]);
    grid.pinRow("b", "top");
    await Promise.resolve();

    grid.setRowsImmutable([{ id: "a", v: 0 }, { id: "c", v: 2 }]);
    await Promise.resolve();

    expect(grid.getSelectedRowIds()).toEqual(["a"]);
    expect(grid.getRowPinState()).toEqual([]);

    destroyGrid(grid, container);
  });

  it("same rows reference is a no-op", () => {
    const onRowDataUpdated = vi.fn();
    const rows = makeRows(["a", "b"]);
    const { grid, container } = createGrid({ rows, onRowDataUpdated });

    const result = grid.setRowsImmutable(rows);
    expect(result.addCount + result.updateCount + result.removeCount).toBe(0);
    expect(onRowDataUpdated).not.toHaveBeenCalled();

    destroyGrid(grid, container);
  });

  it("without getRowId warns once and falls back to setRows", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { grid, container } = createGrid({ getRowId: undefined });

    const next = makeRows(["x", "y"]);
    const result = grid.setRowsImmutable(next);

    // Data is not lost — rows replaced via setRows.
    expect(displayIds(grid)).toEqual(["x", "y"]);
    expect(result.rows).toBe(next);
    expect(result.addCount).toBe(0);
    expect(
      warnSpy.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("setRowsImmutable"),
      ),
    ).toHaveLength(1);

    // Second call does not warn again.
    grid.setRowsImmutable(makeRows(["z"]));
    expect(
      warnSpy.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("setRowsImmutable"),
      ),
    ).toHaveLength(1);

    warnSpy.mockRestore();
    destroyGrid(grid, container);
  });
});

// ── RowStore Phase 1 integration tests ────────────────────────────────

describe("RowStore initial indexing", () => {
  it("update-only transaction works against constructor-provided rows", () => {
    const onRowDataUpdated = vi.fn();
    const { grid, container } = createGrid({ onRowDataUpdated });

    const result = grid.applyTransaction({
      update: [{ id: "b", v: 99 }],
    });

    expect(result.updateCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(onRowDataUpdated).toHaveBeenCalledOnce();

    const updatedRow = grid.getRows().find((r) => r.id === "b");
    expect(updatedRow?.v).toBe(99);
    expect(displayIds(grid)).toEqual(["a", "b", "c"]);

    destroyGrid(grid, container);
  });
});

describe("setRowsImmutable reorder / skipped-id preservation", () => {
  it("reorder of same row objects updates state and DOM", async () => {
    const rows = makeRows(["a", "b", "c"]);
    const container = document.createElement("div");
    Object.assign(container.style, {
      height: "400px",
      width: "600px",
      position: "fixed",
      top: "0",
      left: "0",
    });
    document.body.appendChild(container);
    const grid = new Grid({
      columns: cols,
      rows,
      getRowId: (row) => row.id,
      suppressRowVirtualization: true,
    });
    grid.mount(container);

    await flushRenders();

    const reordered = [rows[2]!, rows[0]!, rows[1]!];
    grid.setRowsImmutable(reordered);

    // State-level check.
    expect(displayIds(grid)).toEqual(["c", "a", "b"]);

    // DOM-level check: flush rAF render and read cell text.
    await flushRenders();
    const domRows = container.querySelectorAll(`.${CSS.ROW}`);
    const domCellTexts: string[] = [];
    domRows.forEach((row) => {
      const cell = row.querySelector(`.${CSS.CELL}`);
      if (cell instanceof HTMLElement) domCellTexts.push(cell.textContent || "");
    });
    expect(domCellTexts).toEqual(["2", "0", "1"]);

    grid.destroy();
    container.remove();
  });

  it("rows with unresolvable ids are preserved in grid data", () => {
    const { grid, container } = createGrid({
      rows: [{ id: "a", v: 0 }, { v: 1 }, { id: "c", v: 2 }],
      getRowId: (row) => row.id ?? null,
    });

    const next = [{ id: "c", v: 2 }, { v: 1 }, { id: "a", v: 0 }];
    grid.setRowsImmutable(next);

    const ids = grid.getRows().map((r) => r.id ?? "none");
    expect(ids).toEqual(["c", "none", "a"]);

    destroyGrid(grid, container);
  });
});

describe("sort scheduling after transactions", () => {
  it("update-only on non-sort field does not re-schedule sort", () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "v", sortable: true },
        { field: "name", sortable: true },
      ],
      rows: [
        { id: "a", v: 0, name: "alice" },
        { id: "b", v: 1, name: "bob" },
        { id: "c", v: 2, name: "carol" },
      ],
    });
    grid.setSortModel([{ field: "v", sort: "asc" }]);

    const internals = grid as unknown as GridTestInternals;
    const scheduleSortSpy = vi.spyOn(internals.execution, "scheduleSort");
    scheduleSortSpy.mockClear();

    // Update "name" only — sort is on "v" (plain field).
    grid.applyTransaction({
      update: [{ id: "a", v: 0, name: "updated" }],
    });

    // Sort should NOT be re-scheduled because dirty field "name"
    // does not touch sort field "v".
    expect(scheduleSortSpy).not.toHaveBeenCalled();

    // Data is still correct.
    expect(displayIds(grid)).toEqual(["a", "b", "c"]);

    scheduleSortSpy.mockRestore();
    destroyGrid(grid, container);
  });

  it("large-row grid update on non-sort field does not schedule async sort", () => {
    vi.useFakeTimers();
    try {
      const THRESHOLD = 25_001;
      const rows: RowData[] = Array.from({ length: THRESHOLD }, (_, i) => ({
        id: String(i),
        v: i,
        name: `r${i}`,
      }));

      const { grid, container } = createGrid({
        columns: [
          { field: "v", sortable: true },
          { field: "name", sortable: true },
        ],
        rows,
      });
      grid.setSortModel([{ field: "v", sort: "asc" }]);

      // Flush the deferred async sort (rAF + setTimeout) so sortCache /
      // asyncSortedRowOrder is populated before the transaction.
      vi.runAllTimers();

      const internals = grid as unknown as GridTestInternals;
      const scheduleSortSpy = vi.spyOn(internals.execution, "scheduleSort");

      grid.applyTransaction({
        update: [{ id: "0", v: 0, name: "changed" }],
      });

      expect(scheduleSortSpy).not.toHaveBeenCalled();

      scheduleSortSpy.mockRestore();
      destroyGrid(grid, container);
    } finally {
      vi.useRealTimers();
    }
  });

  it("update on dirty sort field still triggers sort recompute", () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "v", sortable: true },
        { field: "name", sortable: true },
      ],
      rows: [
        { id: "a", v: 0, name: "alice" },
        { id: "b", v: 1, name: "bob" },
        { id: "c", v: 2, name: "carol" },
      ],
    });
    grid.setSortModel([{ field: "v", sort: "asc" }]);

    // Update "v" — the sort field.
    grid.applyTransaction({
      update: [{ id: "a", v: 99, name: "alice" }],
    });

    // Sort recomputed — "a" moves to the end.
    expect(displayIds(grid)).toEqual(["b", "c", "a"]);

    destroyGrid(grid, container);
  });
});

describe("async batch result.rows isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("earlier callback result.rows is not mutated by later transactions", () => {
    const { grid, container } = createGrid();
    const snapshots: RowData[][] = [];

    grid.applyTransactionAsync(
      { update: [{ id: "a", v: 10 }] },
      (result) => snapshots.push(result.rows.slice()),
    );
    grid.applyTransactionAsync(
      { update: [{ id: "a", v: 20 }] },
      (result) => snapshots.push(result.rows.slice()),
    );

    vi.advanceTimersByTime(50);

    expect(snapshots).toHaveLength(2);
    const firstA = snapshots[0]!.find((r) => r.id === "a");
    const secondA = snapshots[1]!.find((r) => r.id === "a");
    expect(firstA?.v).toBe(10);
    expect(secondA?.v).toBe(20);

    destroyGrid(grid, container);
  });
});

describe("row selection versus row replacement", () => {
  it("plain setRows preserves explicit selected IDs that no longer resolve", async () => {
    const onSelectionChanged = vi.fn();
    const { grid, container } = createGrid({
      rowSelection: "multiple",
      onSelectionChanged,
    });
    await flushRenders();
    grid.setSelectedRowIds(["a", "b"]);
    await Promise.resolve();
    onSelectionChanged.mockClear();

    grid.setRows(makeRows(["a", "c"]));
    await Promise.resolve();

    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(["a", "b"]));
    expect(grid.getSelectedRows().map((row) => row.id)).toEqual(["a"]);
    expect(onSelectionChanged).not.toHaveBeenCalled();

    grid.setRows(makeRows(["a", "b", "c"]));
    await Promise.resolve();
    expect(new Set(grid.getSelectedRows().map((row) => String(row.id)))).toEqual(
      new Set(["a", "b"]),
    );
    expect(onSelectionChanged).not.toHaveBeenCalled();

    destroyGrid(grid, container);
  });

  it("bulk all model follows the matching universe after a plain setRows add", async () => {
    const onSelectionChanged = vi.fn();
    const { grid, container } = createGrid({
      rowSelection: "multiple",
      onSelectionChanged,
    });
    await flushRenders();
    grid.setSelectedRowIds(["a", "b", "c"]);
    await Promise.resolve();
    const afterSelectCalls = onSelectionChanged.mock.calls;
    const afterSelect = afterSelectCalls[afterSelectCalls.length - 1]?.[0] as {
      selectionType: string;
    };
    expect(afterSelect.selectionType).toBe("all");
    onSelectionChanged.mockClear();

    grid.setRows(makeRows(["a", "b", "c", "d"]));
    await flushRenders();

    expect(new Set(grid.getSelectedRowIds())).toEqual(
      new Set(["a", "b", "c", "d"]),
    );
    expect(grid.getSelectedRows()).toHaveLength(4);
    expect(onSelectionChanged).not.toHaveBeenCalled();

    destroyGrid(grid, container);
  });

  it("transaction removal of an explicit selected ID emits an API selection update", async () => {
    const onSelectionChanged = vi.fn();
    const { grid, container } = createGrid({
      rowSelection: "multiple",
      onSelectionChanged,
    });
    await flushRenders();
    grid.setSelectedRowIds(["a", "b"]);
    await Promise.resolve();
    onSelectionChanged.mockClear();

    grid.applyTransaction({ removeIds: ["b"] });
    await Promise.resolve();

    expect(grid.getSelectedRowIds()).toEqual(["a"]);
    expect(onSelectionChanged).toHaveBeenCalledOnce();
    expect(onSelectionChanged.mock.calls[0]![0]).toMatchObject({
      source: "api",
      selectedCount: 1,
    });

    destroyGrid(grid, container);
  });

  it("setRowsImmutable removal of an explicit selected ID emits an API selection update", async () => {
    const onSelectionChanged = vi.fn();
    const { grid, container } = createGrid({
      rowSelection: "multiple",
      onSelectionChanged,
    });
    await flushRenders();
    grid.setSelectedRowIds(["a", "b"]);
    await Promise.resolve();
    onSelectionChanged.mockClear();

    grid.setRowsImmutable([{ id: "a", v: 0 }, { id: "c", v: 2 }]);
    await Promise.resolve();

    expect(grid.getSelectedRowIds()).toEqual(["a"]);
    expect(grid.getSelectedRows().map((row) => row.id)).toEqual(["a"]);
    expect(onSelectionChanged).toHaveBeenCalledOnce();
    expect(onSelectionChanged.mock.calls[0]![0]).toMatchObject({
      source: "api",
    });

    destroyGrid(grid, container);
  });
});
