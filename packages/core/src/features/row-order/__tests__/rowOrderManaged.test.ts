// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { GridState } from "../../../state/GridState";
import type {
  LightFastGridRowOrderChangedEvent,
  RowOrderChangeSource,
} from "../../../types";
import { RowOrderStore } from "../RowOrderStore";
import type { RowOrderMoveRequest } from "../types";

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
): LightFastGridRowOrderChangedEvent | null {
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
  return action?.(rowId, [rowId], toIndex, "drag") ?? null;
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
          "[LightFastGrid] Managed row reorder blocked: sort or filter is " +
            "active. Disable sort/filter before reordering rows, or set " +
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
      expect.stringContaining("sort or filter is active"),
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
