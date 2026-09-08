// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { HeaderAddonSyncContext, HeaderLaneRefs } from "../../../features/types";
import type { ColumnDef, PooledRow } from "../../../types";
import { normalizeRowSelection } from "../../../utils/rowSelectionConfig";
import { createArrayDisplayRowReader } from "../../rowViewAccess";
import {
  VirtualWindowSync,
  type WindowSyncContext,
} from "../VirtualWindowSync";

function makePool(slotCount: number, rowCount: number): PooledRow[] {
  const pool: PooledRow[] = [];
  for (let r = 0; r < rowCount; r++) {
    const element = document.createElement("div");
    element.className = "lfg-row";
    const cells = [];
    for (let c = 0; c < slotCount; c++) {
      const cell = document.createElement("div");
      cell.className = "lfg-cell";
      element.appendChild(cell);
      cells.push({ element: cell, value: "" });
    }
    pool.push({
      element,
      cells,
      rowIndex: -1,
      rowVersion: 0,
      rowId: "",
      layoutTranslateY: 0,
    });
  }
  return pool;
}

function makeCtx(overrides: Partial<WindowSyncContext> = {}): WindowSyncContext {
  const viewport = document.createElement("div");
  Object.defineProperty(viewport, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(viewport, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(viewport, "scrollTop", { value: 0, configurable: true, writable: true });
  Object.defineProperty(viewport, "scrollLeft", { value: 0, configurable: true, writable: true });

  const root = document.createElement("div");
  const headerRowEl = document.createElement("div");
  headerRowEl.className = "lfg-header-row";
  for (let i = 0; i < 2; i++) {
    const cell = document.createElement("div");
    cell.className = "lfg-header-cell";
    headerRowEl.appendChild(cell);
  }

  const columns: ColumnDef[] = [
    { field: "a", headerName: "A", width: 100 },
    { field: "b", headerName: "B", width: 100 },
  ];
  const pool = makePool(2, 4);

  const laneRefs: HeaderLaneRefs = {
    center: {
      container: document.createElement("div"),
      leafRow: headerRowEl,
    },
    left: null,
    right: null,
  };

  return {
    viewport,
    root,
    pool,
    headerRowEl,
    pinnedHeaderRowEl: null,
    pinnedRightHeaderRowEl: null,
    columns,
    displayRows: createArrayDisplayRowReader([]),
    columnSlotCount: 2,
    dataRevision: 1,
    rowSelection: normalizeRowSelection(undefined),
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    resizeOverride: null,
    resizeLayoutCtrl: {
      isLayoutOnly: () => false,
      updateLayoutKey: () => {},
      resetLayoutKey: () => {},
    },
    pinnedLeftCount: 0,
    pinnedLeftColumns: [],
    centerColumns: columns,
    centerSlotCount: 2,
    pinnedRightCount: 0,
    pinnedRightColumns: [],
    headerLaneRefs: laneRefs,
    ...overrides,
  };
}

describe("VirtualWindowSync syncHeaderAddons callback", () => {
  it("invokes syncHeaderAddons after header slot sync with layout bag", () => {
    const sync = new VirtualWindowSync();
    const spy = vi.fn();
    const ctx = makeCtx({ syncHeaderAddons: spy });

    sync.sync(ctx);

    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0]![0] as HeaderAddonSyncContext;
    expect(arg.centerWindow).toEqual({ startCol: 0, endCol: 1 });
    expect(arg.lanes.center.columns).toEqual(ctx.centerColumns);
    expect(arg.lanes.center.prefixEdges.length).toBe(3);
    expect(arg.lanes.center.containerOffsetX).toBe(0);
    expect(arg.lanes.left).toBeNull();
    expect(arg.lanes.right).toBeNull();
    expect(arg.headerLaneRefs).toBe(ctx.headerLaneRefs);
    expect(typeof arg.layoutVersion).toBe("number");
  });

  it("sets center containerOffsetX from left-lane prefix edge total", () => {
    const sync = new VirtualWindowSync();
    const spy = vi.fn();
    const leftCols: ColumnDef[] = [
      { field: "sel", headerName: "", width: 44, pinned: "left" },
    ];
    const centerCols: ColumnDef[] = [
      { field: "a", headerName: "A", width: 100 },
      { field: "b", headerName: "B", width: 100 },
    ];
    const leftLeaf = document.createElement("div");
    const centerLeaf = document.createElement("div");
    const ctx = makeCtx({
      syncHeaderAddons: spy,
      pinnedLeftCount: 1,
      pinnedLeftColumns: leftCols,
      centerColumns: centerCols,
      columns: [...leftCols, ...centerCols],
      headerLaneRefs: {
        center: {
          container: document.createElement("div"),
          leafRow: centerLeaf,
        },
        left: {
          container: document.createElement("div"),
          leafRow: leftLeaf,
        },
        right: null,
      },
      pinnedHeaderRowEl: leftLeaf,
      headerRowEl: centerLeaf,
    });

    sync.sync(ctx);

    const arg = spy.mock.calls[0]![0] as HeaderAddonSyncContext;
    expect(arg.lanes.left?.containerOffsetX).toBe(0);
    expect(arg.lanes.center.containerOffsetX).toBe(44);
    expect(arg.lanes.right).toBeNull();
  });

  it("does not call syncHeaderAddons when callback is absent", () => {
    const sync = new VirtualWindowSync();
    const ctx = makeCtx({ syncHeaderAddons: undefined });
    expect(() => sync.sync(ctx)).not.toThrow();
  });

  it("does not call syncHeaderAddons when headerLaneRefs is absent", () => {
    const sync = new VirtualWindowSync();
    const spy = vi.fn();
    const ctx = makeCtx({
      syncHeaderAddons: spy,
      headerLaneRefs: null,
    });
    sync.sync(ctx);
    expect(spy).not.toHaveBeenCalled();
  });
});
