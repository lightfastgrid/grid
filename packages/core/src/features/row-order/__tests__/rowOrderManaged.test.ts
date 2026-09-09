// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { DRAG_START_THRESHOLD_PX } from "../../drag/DragSession";
import { Grid } from "../../../Grid";
import type { PooledRow } from "../../../internal/poolTypes";
import type { DisplayRowReader } from "../../../rendering/rowViewAccess";
import { GridState } from "../../../state/GridState";
import type {
  LightFastGridRowOrderChangedEvent,
  RowData,
  RowOrderChangeSource,
} from "../../../types";
import {
  mapDisplayInsertionIndexToSourceIndex,
  ROW_DRAG_HANDLE_CLASS,
} from "../RowOrderController";
import { RowOrderStore } from "../RowOrderStore";
import type { RowOrderMoveRequest } from "../types";

function createMappedDisplayRowReader(
  pageRows: RowData[],
  sourceIndexes: readonly number[],
): DisplayRowReader {
  return {
    get rowCount() {
      return pageRows.length;
    },
    getSourceIndex(displayIndex: number): number {
      if (displayIndex < 0 || displayIndex >= pageRows.length) return -1;
      return sourceIndexes[displayIndex] ?? -1;
    },
    getRowData(displayIndex: number): RowData | undefined {
      return displayIndex >= 0 && displayIndex < pageRows.length
        ? pageRows[displayIndex]
        : undefined;
    },
    getRow(displayIndex: number) {
      if (displayIndex < 0 || displayIndex >= pageRows.length) return null;
      const row = pageRows[displayIndex];
      if (row === undefined) return null;
      return {
        displayIndex,
        sourceIndex: sourceIndexes[displayIndex] ?? -1,
        row,
      };
    },
  };
}

// ─── GridState.moveRowsByIds ──────────────────────────────────────────────────

describe("GridState.moveRowsByIds", () => {
  function makeState(rowCount = 5): {
    state: GridState;
    rows: Array<{ id: string }>;
    resolve: (row: unknown, i: number) => string;
  } {
    const rows = Array.from({ length: rowCount }, (_, i) => ({ id: `r${i}` }));
    const state = new GridState({ rows });
    const resolve = (_: unknown, i: number): string => rows[i]!.id;
    return { state, rows, resolve };
  }

  function makeNamedState(ids: string[]): {
    state: GridState;
    rows: Array<{ id: string }>;
    resolve: (row: unknown, i: number) => string;
  } {
    const rows = ids.map((id) => ({ id }));
    const state = new GridState({ rows });
    const resolve = (_: unknown, i: number): string => rows[i]!.id;
    return { state, rows, resolve };
  }

  it("returns null when rows is empty", () => {
    const state = new GridState({ rows: [] });
    expect(state.moveRowsByIds("r0", ["r0"], 1, (_, i) => String(i))).toBeNull();
  });

  it("returns null when no row ids match", () => {
    const { state, resolve } = makeState(3);
    expect(state.moveRowsByIds("x", ["x", "y"], 1, resolve)).toBeNull();
  });



  it("moves multiple rows as block", () => {
    const { state, resolve } = makeState(5);
    // Move r0 and r2 to index 4
    const result = state.moveRowsByIds("r0", ["r0", "r2"], 4, resolve);
    expect(result?.changed).toBe(true);
    expect(result?.rowIds).toEqual(["r0", "r2"]);
    expect(state.getRows().map((r) => (r as { id: string }).id)).toEqual([
      "r1", "r3", "r0", "r2", "r4",
    ]);
  });

  it("adjusts insertionIndex once: [a,b,c,d,e] move [a,c] to slot 4 → [b,d,a,c,e]", () => {
    const { state, resolve } = makeNamedState(["a", "b", "c", "d", "e"]);
    const result = state.moveRowsByIds("a", ["a", "c"], 4, resolve);
    expect(result?.changed).toBe(true);
    expect(state.getRows().map((r) => (r as { id: string }).id)).toEqual([
      "b", "d", "a", "c", "e",
    ]);
    expect(result?.toIndex).toBe(2);
  });

  it("adjusts insertionIndex once (reverse): [a,b,c,d,e] move [d,e] before b → [a,d,e,b,c]", () => {
    const { state, resolve } = makeNamedState(["a", "b", "c", "d", "e"]);
    const result = state.moveRowsByIds("d", ["d", "e"], 1, resolve);
    expect(result?.changed).toBe(true);
    expect(state.getRows().map((r) => (r as { id: string }).id)).toEqual([
      "a", "d", "e", "b", "c",
    ]);
    expect(result?.toIndex).toBe(1);
  });

  it("preserves object references of moved rows", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const state = new GridState({ rows });
    const resolve = (_: unknown, i: number): string => rows[i]!.id;
    const result = state.moveRowsByIds("a", ["a", "c"], 3, resolve);
    expect(result?.rows[0]).toBe(rows[0]);
    expect(result?.rows[1]).toBe(rows[2]);
  });

  it("returns fromIndices for all moving rows", () => {
    const { state, resolve } = makeState(5);
    const result = state.moveRowsByIds("r1", ["r1", "r3"], 5, resolve);
    expect(result?.fromIndices).toEqual([1, 3]);
  });

  it("returns changed:false for no-op", () => {
    const { state, rows, resolve } = makeState(3);
    const result = state.moveRowsByIds("r1", ["r1"], 1, resolve);
    expect(result?.changed).toBe(false);
    expect(state.getRows()).toEqual(rows);
  });

  it("bumps dataRevision on actual move", () => {
    const { state, resolve } = makeState(3);
    const revBefore = state.getSnapshot().dataRevision!;
    state.moveRowsByIds("r0", ["r0"], 2, resolve);
    expect(state.getSnapshot().dataRevision!).toBeGreaterThan(revBefore);
  });

  it("does not bump revision on no-op", () => {
    const { state, resolve } = makeState(3);
    const revBefore = state.getSnapshot().dataRevision!;
    state.moveRowsByIds("r1", ["r1"], 1, resolve);
    expect(state.getSnapshot().dataRevision!).toBe(revBefore);
  });
});

function commitRowOrder(
  grid: Grid,
  rowId: string,
  toIndex: number,
  source: RowOrderChangeSource = "drag",
): LightFastGridRowOrderChangedEvent | null {
  const action = (grid as unknown as {
    ctx: {
      actions: {
        commitRowOrder?: (
          id: string,
          ids: string[],
          index: number,
          source: RowOrderChangeSource,
        ) => LightFastGridRowOrderChangedEvent | null;
      };
    };
  }).ctx.actions.commitRowOrder;
  return action?.(rowId, [rowId], toIndex, source) ?? null;
}

function currentPageIds(grid: Grid): string[] {
  const pagination = grid.getPaginationState();
  return (grid.getRows() as Array<{ id: string }>)
    .slice(pagination.startRow - 1, pagination.endRow)
    .map((row) => row.id);
}

describe("Grid managed row reorder commit", () => {
  it("emits authoritative callback after commit", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const movedRow = rows[0];
    const onRowOrderChanged = vi.fn();
    const grid = new Grid({
      rows,
      columns: [{ field: "id" }],
      getRowId: (row) => String((row as { id: string }).id),
      onRowOrderChanged,
    });

    const event = commitRowOrder(grid, "a", 3);
    expect(event).not.toBeNull();
    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    const cbEvent = onRowOrderChanged.mock.calls[0][0] as LightFastGridRowOrderChangedEvent;
    expect(cbEvent).toBe(event);
    expect(cbEvent.rowId).toBe("a");
    expect(cbEvent.row).toBe(movedRow);
    expect(cbEvent.fromIndex).toBe(0);
    expect(cbEvent.toIndex).toBe(2);
    expect(cbEvent.source).toBe("drag");
    expect("rowOrderIds" in cbEvent).toBe(false);
    expect(cbEvent.getRowOrderIds()).toEqual(["b", "c", "a"]);
    expect(cbEvent.getRows().map((r) => (r as { id: string }).id)).toEqual(["b", "c", "a"]);
    const firstRows = cbEvent.getRows();
    firstRows.pop();
    expect(cbEvent.getRows().length).toBe(3);
  });

  it("returns null and emits nothing when move is unchanged", () => {
    const onRowOrderChanged = vi.fn();
    const grid = new Grid({
      rows: [{ id: "a" }, { id: "b" }],
      columns: [{ field: "id" }],
      getRowId: (row) => String((row as { id: string }).id),
      onRowOrderChanged,
    });
    const event = commitRowOrder(grid, "a", 0);
    expect(event).toBeNull();
    expect(onRowOrderChanged).not.toHaveBeenCalled();
  });

  it("does not eagerly materialize full id order for large datasets", () => {
    const rows = Array.from({ length: 100_000 }, (_, i) => ({ id: `r${i}` }));
    const getRowId = vi.fn((row: Record<string, unknown>) => String(row.id));
    const onRowOrderChanged = vi.fn();
    const grid = new Grid({
      rows,
      columns: [{ field: "id" }],
      getRowId,
      onRowOrderChanged,
    });

    const callsBefore = getRowId.mock.calls.length;
    const event = commitRowOrder(grid, "r0", 5)!;
    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    // getRowOrderIds() must not have been called yet (lazy)
    const callsAfterCommit = getRowId.mock.calls.length - callsBefore;
    expect(callsAfterCommit).toBeLessThan(100_000 * 3); // commit work only, not full order

    const ids = event.getRowOrderIds();
    expect(ids.length).toBe(100_000);
    expect(getRowId.mock.calls.length - callsBefore).toBeGreaterThan(callsAfterCommit);
  });
});

type CommitInterceptorOpts = {
  managed: boolean;
  isBlocked: boolean;
  rows: Array<{ id: string; value: number }>;
  commitRowOrder: (
    rowId: string,
    rowIds: string[],
    insertionIndex: number,
    source: RowOrderChangeSource,
  ) => LightFastGridRowOrderChangedEvent | null;
  onRowOrderChanged: (e: LightFastGridRowOrderChangedEvent) => void;
};

function buildTestableInterceptor(opts: CommitInterceptorOpts): {
  handle: (e: RowOrderMoveRequest) => void;
  store: RowOrderStore;
} {
  const store = new RowOrderStore();
  store.syncRowIds(opts.rows.map((r) => r.id));
  const resolveRowId = (row: { id: string }) => row.id;

  const handle = (e: RowOrderMoveRequest): void => {
    if (opts.managed !== false) {
      if (opts.isBlocked) {
        console.warn(
          "[LightFastGrid] Managed row reorder blocked: sort is " +
            "active. Disable sort before reordering rows, or set " +
            "rowDrag.managed=false to handle reorder yourself.",
        );
        store.clear();
        return;
      }
      opts.commitRowOrder(e.rowId, e.rowIds, e.insertionIndex, e.source);
      store.clear();
      return;
    }

    const row = opts.rows.find((candidate) => candidate.id === e.rowId);
    if (!row) return;
    const storeOrder = store.getOrder();
    const finalToIndex = storeOrder.indexOf(e.rowIds[0]!);
    opts.onRowOrderChanged({
      rowId: e.rowId,
      rowIds: e.rowIds,
      row,
      rows: e.rowIds.map((id) => opts.rows.find((r) => r.id === id)).filter(Boolean) as typeof opts.rows,
      fromIndex: e.fromIndex,
      fromIndices: e.fromIndices,
      toIndex: finalToIndex >= 0 ? finalToIndex : e.insertionIndex,
      source: e.source,
      getRowOrderIds: () => {
        const order = store.getOrder();
        if (order.length > 0) return order;
        return opts.rows.map(resolveRowId);
      },
      getRows: () => store.applyOrder(opts.rows, resolveRowId).slice(),
    });
  };

  return { handle, store };
}

describe("rowOrderFeature commit interception", () => {
  const rows = [
    { id: "a", value: 1 },
    { id: "b", value: 2 },
    { id: "c", value: 3 },
  ];
  const move: RowOrderMoveRequest = {
    rowId: "a",
    rowIds: ["a"],
    fromIndex: 0,
    fromIndices: [0],
    insertionIndex: 2,
    source: "drag",
  };

  it("managed mode commits and does not forward preview event", () => {
    const commitRowOrder = vi.fn(() => null);
    const onRowOrderChanged = vi.fn();
    const { handle } = buildTestableInterceptor({
      managed: true,
      isBlocked: false,
      rows,
      commitRowOrder,
      onRowOrderChanged,
    });

    handle(move);
    expect(commitRowOrder).toHaveBeenCalledWith("a", ["a"], 2, "drag");
    expect(onRowOrderChanged).not.toHaveBeenCalled();
  });

  it("managed row reorder is blocked when sort is active", () => {
    const commitRowOrder = vi.fn(() => null);
    const onRowOrderChanged = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handle } = buildTestableInterceptor({
      managed: true,
      isBlocked: true,
      rows,
      commitRowOrder,
      onRowOrderChanged,
    });

    handle(move);
    expect(commitRowOrder).not.toHaveBeenCalled();
    expect(onRowOrderChanged).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("sort is active"),
    );
    warnSpy.mockRestore();
  });

  it("unmanaged mode emits lightweight proposed event with lazy getters", () => {
    const commitRowOrder = vi.fn(() => null);
    const onRowOrderChanged = vi.fn();
    const { handle, store } = buildTestableInterceptor({
      managed: false,
      isBlocked: false,
      rows,
      commitRowOrder,
      onRowOrderChanged,
    });

    store.move("a", 2);
    handle(move);

    expect(commitRowOrder).not.toHaveBeenCalled();
    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    const event = onRowOrderChanged.mock.calls[0][0] as LightFastGridRowOrderChangedEvent;
    expect(event.row).toBe(rows[0]);
    expect("rowOrderIds" in event).toBe(false);
    expect(event.getRowOrderIds()).toEqual(["b", "c", "a"]);
    expect(event.getRows().map((r) => (r as { id: string }).id)).toEqual(["b", "c", "a"]);
  });
});

describe("managed commit receives insertionIndex (no double adjustment)", () => {
  it("managed commit passes insertionIndex 4 to GridState, which adjusts once to toIndex 2", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const onRowOrderChanged = vi.fn();
    const grid = new Grid({
      rows,
      columns: [{ field: "id" }],
      getRowId: (row) => String((row as { id: string }).id),
      onRowOrderChanged,
    });

    const action = (grid as unknown as {
      ctx: {
        actions: {
          commitRowOrder?: (
            id: string,
            ids: string[],
            index: number,
            source: "drag",
          ) => LightFastGridRowOrderChangedEvent | null;
        };
      };
    }).ctx.actions.commitRowOrder;

    // insertionIndex = 4 (original drop slot before row "e")
    const event = action?.("a", ["a", "c"], 4, "drag");
    expect(event).not.toBeNull();
    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    const cbEvent = onRowOrderChanged.mock.calls[0][0] as LightFastGridRowOrderChangedEvent;
    expect(cbEvent.toIndex).toBe(2);
    expect(grid.getRowCount()).toBe(5);
    expect(cbEvent.getRowOrderIds()).toEqual(["b", "d", "a", "c", "e"]);
  });

  it("reverse direction: move [d,e] before b (insertionIndex 1) → [a,d,e,b,c]", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const onRowOrderChanged = vi.fn();
    const grid = new Grid({
      rows,
      columns: [{ field: "id" }],
      getRowId: (row) => String((row as { id: string }).id),
      onRowOrderChanged,
    });

    const action = (grid as unknown as {
      ctx: {
        actions: {
          commitRowOrder?: (
            id: string,
            ids: string[],
            index: number,
            source: "drag",
          ) => LightFastGridRowOrderChangedEvent | null;
        };
      };
    }).ctx.actions.commitRowOrder;

    const event = action?.("d", ["d", "e"], 1, "drag");
    expect(event).not.toBeNull();
    const cbEvent = onRowOrderChanged.mock.calls[0][0] as LightFastGridRowOrderChangedEvent;
    expect(cbEvent.toIndex).toBe(1);
    expect(cbEvent.getRowOrderIds()).toEqual(["a", "d", "e", "b", "c"]);
  });

  it("managed commit interceptor passes insertionIndex, not adjusted store toIndex", () => {
    const commitRowOrder = vi.fn(() => null);
    const onRowOrderChanged = vi.fn();
    const { handle } = buildTestableInterceptor({
      managed: true,
      isBlocked: false,
      rows: [
        { id: "a", value: 1 },
        { id: "b", value: 2 },
        { id: "c", value: 3 },
        { id: "d", value: 4 },
        { id: "e", value: 5 },
      ],
      commitRowOrder,
      onRowOrderChanged,
    });

    const multiMove: RowOrderMoveRequest = {
      rowId: "a",
      rowIds: ["a", "c"],
      fromIndex: 0,
      fromIndices: [0, 2],
      insertionIndex: 4,
      source: "drag",
    };

    handle(multiMove);
    expect(commitRowOrder).toHaveBeenCalledWith("a", ["a", "c"], 4, "drag");
    expect(onRowOrderChanged).not.toHaveBeenCalled();
  });
});

describe("managed row reorder with pagination", () => {
  function makePagedGrid(onRowOrderChanged = vi.fn()) {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, v: i }));
    const grid = new Grid({
      rows,
      columns: [{ field: "v" }],
      pagination: true,
      paginationPageSize: 5,
      rowDrag: { enabled: true, managed: true },
      getRowId: (row) => String((row as { id: string }).id),
      onRowOrderChanged,
    });
    grid.setPageIndex(1);
    return { grid, rows, onRowOrderChanged };
  }

  it("page 2 drop-before commit keeps the row on page 2 and reports source indexes", () => {
    const { grid, rows, onRowOrderChanged } = makePagedGrid();
    const pageRows = rows.slice(5, 10);
    const reader = createMappedDisplayRowReader(pageRows, [5, 6, 7, 8, 9]);
    const insertionIndex = mapDisplayInsertionIndexToSourceIndex(reader, 3);
    expect(insertionIndex).toBe(8);

    const event = commitRowOrder(grid, "r6", insertionIndex);
    expect(event).not.toBeNull();
    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    const cbEvent = onRowOrderChanged.mock.calls[0][0] as LightFastGridRowOrderChangedEvent;
    expect(cbEvent.fromIndex).toBe(6);
    expect(cbEvent.fromIndices).toEqual([6]);
    expect(cbEvent.toIndex).toBe(7);
    expect(cbEvent.getRowOrderIds()).toEqual([
      "r0", "r1", "r2", "r3", "r4", "r5", "r7", "r6", "r8", "r9",
    ]);
    expect(grid.getPaginationState().pageIndex).toBe(1);
    expect(currentPageIds(grid)).toEqual(["r5", "r7", "r6", "r8", "r9"]);
    expect(currentPageIds(grid)).toContain("r6");
    grid.destroy();
  });

  it("page 2 drop-after commit uses the source insertion and stays on page 2", () => {
    const { grid, rows, onRowOrderChanged } = makePagedGrid();
    const pageRows = rows.slice(5, 10);
    const reader = createMappedDisplayRowReader(pageRows, [5, 6, 7, 8, 9]);
    const insertionIndex = mapDisplayInsertionIndexToSourceIndex(reader, 4);
    expect(insertionIndex).toBe(9);

    const event = commitRowOrder(grid, "r6", insertionIndex);
    expect(event).not.toBeNull();
    expect(onRowOrderChanged.mock.calls[0][0].fromIndex).toBe(6);
    expect(onRowOrderChanged.mock.calls[0][0].toIndex).toBe(8);
    expect(currentPageIds(grid)).toEqual(["r5", "r7", "r8", "r6", "r9"]);
    grid.destroy();
  });

  it("managed keyboard commit on page 2 uses source coordinates", () => {
    const { grid, onRowOrderChanged } = makePagedGrid();
    const event = commitRowOrder(grid, "r6", 8, "keyboard");
    expect(event).not.toBeNull();
    expect(event!.source).toBe("keyboard");
    expect(event!.fromIndex).toBe(6);
    expect(event!.fromIndices).toEqual([6]);
    expect(event!.toIndex).toBe(7);
    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    expect(currentPageIds(grid)).toContain("r6");
    grid.destroy();
  });

  it("a page-local insertionIndex would incorrectly move the row onto page 1", () => {
    const { grid } = makePagedGrid();
    commitRowOrder(grid, "r6", 3);
    expect(currentPageIds(grid)).not.toContain("r6");
    expect((grid.getRows() as Array<{ id: string }>).map((row) => row.id)[3]).toBe("r6");
    grid.destroy();
  });
});

describe("mounted paginated managed row drag", () => {
  async function flushRenders(): Promise<void> {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  function mockPoolRowGeometry(grid: Grid, rowHeight = 40): PooledRow[] {
    const pool = (
      grid as unknown as { renderer: { poolManager: { pool: PooledRow[] } } }
    ).renderer.poolManager.pool;
    const active = pool.filter((pr) => pr.rowIndex >= 0);
    expect(active).toHaveLength(5);
    for (const pr of active) {
      const top = pr.rowIndex * rowHeight;
      vi.spyOn(pr.element, "getBoundingClientRect").mockReturnValue({
        top,
        bottom: top + rowHeight,
        left: 0,
        right: 200,
        width: 200,
        height: rowHeight,
        x: 0,
        y: top,
        toJSON: () => "",
      } as DOMRect);
    }
    return pool;
  }

  it("page-two pointer drag commits through the production Grid path", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, v: i }));
    const onRowOrderChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "600px" });
    document.body.appendChild(container);
    const grid = new Grid({
      rows,
      columns: [{ field: "v" }],
      pagination: true,
      paginationPageSize: 5,
      rowDrag: { enabled: true, managed: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (row) => String((row as { id: string }).id),
      onRowOrderChanged,
    });
    try {
      grid.mount(container);
      await flushRenders();
      grid.setPageIndex(1);
      await flushRenders();
      mockPoolRowGeometry(grid);

      const handle = container.querySelector(
        `.lfg-pinned-row[data-row-id="r6"] .${ROW_DRAG_HANDLE_CLASS}`,
      ) as HTMLElement | null;
      expect(handle).toBeTruthy();

      handle!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          button: 0,
          clientX: 10,
          clientY: 50,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: 10,
          clientY: 50 + DRAG_START_THRESHOLD_PX + 1,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 1,
          clientX: 10,
          clientY: 130,
        }),
      );
      await flushRenders();

      expect(onRowOrderChanged).toHaveBeenCalledOnce();
      const event = onRowOrderChanged.mock.calls[0][0] as LightFastGridRowOrderChangedEvent;
      expect(event.fromIndex).toBe(6);
      expect(event.fromIndices).toEqual([6]);
      expect(event.toIndex).toBe(7);
      expect(event.source).toBe("drag");
      expect((grid.getRows() as Array<{ id: string }>).map((row) => row.id)).toEqual([
        "r0", "r1", "r2", "r3", "r4", "r5", "r7", "r6", "r8", "r9",
      ]);
      expect(grid.getPaginationState().pageIndex).toBe(1);
      expect(currentPageIds(grid)).toEqual(["r5", "r7", "r6", "r8", "r9"]);
      expect(currentPageIds(grid)).toContain("r6");
    } finally {
      grid.destroy();
      container.remove();
    }
  });
});
