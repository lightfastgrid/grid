// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createSelectionColumnDef, isSelectionColumn } from "../../../internal/selectionColumn";
import type { ColumnDef } from "../../../types";
import {
  buildColumnPreviewCSS,
  collectVisibleUserHeaderEntries,
  ColumnOrderController,
  computeGlobalDropIndexFromVisible,
  DRAG_START_THRESHOLD_PX,
  getMovingIndices,
  isNoopPreview,
  pickUserDropIndex,
  previewOrderForDrop,
} from "../ColumnOrderController";
import { ColumnOrderStore } from "../ColumnOrderStore";

function mockCellRect(el: HTMLElement, left: number, width: number): void {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left,
    width,
    top: 0,
    height: 24,
    right: left + width,
    bottom: 24,
    x: left,
    y: 0,
    toJSON: () => "",
  } as DOMRect);
}

/**
 * Mounts a minimal header DOM for unit tests.
 * Returns cells (one per column) and handles (drag handle element, or null
 * for selection columns and reorderable:false columns).
 */
function mountHeader(columns: ColumnDef[]): {
  root: HTMLDivElement;
  headerRow: HTMLDivElement;
  cells: HTMLDivElement[];
  handles: (HTMLDivElement | null)[];
  cleanup: () => void;
} {
  const root = document.createElement("div");
  root.className = "lfg-grid";
  const surface = document.createElement("div");
  surface.className = "lfg-grid-surface";
  const headerRow = document.createElement("div");
  headerRow.className = "lfg-header-row";
  surface.appendChild(headerRow);
  root.appendChild(surface);
  const cells: HTMLDivElement[] = [];
  const handles: (HTMLDivElement | null)[] = [];
  let x = 0;
  const w = 80;
  for (const col of columns) {
    const cell = document.createElement("div");
    cell.className = "lfg-header-cell";
    cell.setAttribute("data-col-id", col.field);
    headerRow.appendChild(cell);
    cells.push(cell);
    mockCellRect(cell, x, w);
    x += w;
    // Mirror the syncHeaderRowSlots logic: only reorderable user columns get a handle.
    if (!isSelectionColumn(col) && col.reorderable !== false) {
      const handle = document.createElement("div");
      handle.className = "lfg-column-drag-handle";
      handle.setAttribute("data-col-id", col.field);
      cell.appendChild(handle);
      handles.push(handle);
    } else {
      handles.push(null);
    }
  }
  document.body.appendChild(root);
  return {
    root,
    headerRow,
    cells,
    handles,
    cleanup: () => {
      document.body.removeChild(root);
    },
  };
}

async function flushRaf(times = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}

/** Horizontal nudge so pointer delta exceeds {@link DRAG_START_THRESHOLD_PX}. */
function nudgeX(clientX: number): number {
  return clientX + DRAG_START_THRESHOLD_PX + 1;
}

describe("ColumnOrder", () => {
  describe("pickUserDropIndex", () => {
    it("returns insertion slot after last cell when past last midpoint", () => {
      const a = document.createElement("div");
      const b = document.createElement("div");
      mockCellRect(a, 100, 100);
      mockCellRect(b, 200, 100);
      expect(pickUserDropIndex(120, [a, b])).toBe(0);
      expect(pickUserDropIndex(180, [a, b])).toBe(1);
      expect(pickUserDropIndex(290, [a, b])).toBe(2);
    });
  });

  describe("previewOrderForDrop / isNoopPreview", () => {
    it("non-contiguous movers: preview after last matches block move to end", () => {
      const order = ["a", "b", "c", "d", "e", "f"];
      const moving = new Set(["b", "d"]);
      expect(previewOrderForDrop(order, moving, order.length)).toEqual([
        "a",
        "c",
        "e",
        "f",
        "b",
        "d",
      ]);
    });

    it("contiguous B+C: drop before C is a true no-op", () => {
      const order = ["a", "b", "c", "d"];
      const moving = new Set(["b", "c"]);
      expect(isNoopPreview(order, moving, 2)).toBe(true);
    });

    it("getMovingIndices returns indices of moving fields only", () => {
      const mk = (id: string) => {
        const el = document.createElement("div");
        el.setAttribute("data-col-id", id);
        return el;
      };
      const cells = [mk("a"), mk("b"), mk("c"), mk("d")];
      expect(getMovingIndices(cells, new Set(["b", "d"]))).toEqual([1, 3]);
    });
  });

  describe("ColumnOrderController", () => {
    it("does nothing when columnOrder is disabled", () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const requestColumnTransformSync = vi.fn();
      const onColumnOrderChanged = vi.fn();
      const addSpy = vi.spyOn(document, "addEventListener");

      const cols = [createSelectionColumnDef(), { field: "a" }, { field: "b" }];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: false }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync,
        onColumnOrderChanged,
        store,
      });
      ctrl.attach(root);

      // Dispatch on handle — drag should still not start because config is disabled.
      handles[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 1,
          clientX: 140,
        }),
      );

      expect(addSpy).not.toHaveBeenCalledWith("pointermove", expect.any(Function));

      ctrl.detach();
      addSpy.mockRestore();
      cleanup();
    });

    it("cell body pointerdown does not start drag even for reorderable column", () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const cols = [createSelectionColumnDef(), { field: "a" }, { field: "b" }];
      const { root, headerRow, cells, cleanup } = mountHeader(cols);
      const addSpy = vi.spyOn(document, "addEventListener");
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      // Dispatch directly on the cell body (not on the handle) — must NOT start drag.
      cells[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 5000,
          clientX: 120,
          clientY: 0,
        }),
      );

      expect(addSpy).not.toHaveBeenCalledWith("pointermove", expect.any(Function));

      ctrl.detach();
      addSpy.mockRestore();
      cleanup();
    });

    it("pointerdown on drag handle CAN start drag after threshold", () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const cols = [createSelectionColumnDef(), { field: "a" }, { field: "b" }];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const addSpy = vi.spyOn(document, "addEventListener");
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 5001,
          clientX: 120,
          clientY: 0,
        }),
      );

      expect(addSpy).toHaveBeenCalledWith("pointermove", expect.any(Function));

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 5001 }),
      );
      ctrl.detach();
      addSpy.mockRestore();
      cleanup();
    });

    it("reorderable:false column has no drag handle in mountHeader", () => {
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b", reorderable: false },
      ];
      const { handles, cleanup } = mountHeader(cols);
      expect(handles[0]).toBeNull(); // selection column
      expect(handles[1]).not.toBeNull(); // a — reorderable
      expect(handles[2]).toBeNull(); // b — reorderable:false
      cleanup();
    });

    it("selection column has no drag handle in mountHeader", () => {
      const cols = [createSelectionColumnDef(), { field: "a" }];
      const { handles, cleanup } = mountHeader(cols);
      expect(handles[0]).toBeNull(); // selection column
      expect(handles[1]).not.toBeNull(); // a
      cleanup();
    });

    it("ignores pointerdown when column has reorderable false", () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b", reorderable: false },
      ];
      const { root, headerRow, cells, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);
      const addSpy = vi.spyOn(document, "addEventListener");

      // No handle for reorderable:false — dispatch on cell body (also blocked).
      cells[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerId: 101,
          clientX: 200,
        }),
      );

      expect(addSpy).not.toHaveBeenCalledWith("pointermove", expect.any(Function));

      ctrl.detach();
      addSpy.mockRestore();
      cleanup();
    });

    it("does not start drag when effective reorderable is false from merged defaults", () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const cols = [
        createSelectionColumnDef(),
        { field: "a", reorderable: true },
        { field: "b", reorderable: false },
      ];
      const { root, headerRow, cells, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);
      const addSpy = vi.spyOn(document, "addEventListener");

      // reorderable:false — cell body (no handle).
      cells[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerId: 102,
          clientX: 200,
        }),
      );
      expect(addSpy).not.toHaveBeenCalledWith("pointermove", expect.any(Function));

      // reorderable:true — handle, should register pointermove.
      handles[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 103,
          clientX: 120,
        }),
      );
      expect(addSpy).toHaveBeenCalledWith("pointermove", expect.any(Function));

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 103 }),
      );
      ctrl.detach();
      addSpy.mockRestore();
      cleanup();
    });

    it("multi selected drag excludes columns with reorderable false", () => {
      const store = new ColumnOrderStore();
      store.syncColumns([
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ]);
      const moveManySpy = vi.spyOn(store, "moveMany");
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c", reorderable: false },
        { field: "d" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => ["b", "c"],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 104,
          clientX: 200,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 104,
          clientX: nudgeX(200),
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 104,
          clientX: 360,
          clientY: 0,
        }),
      );

      expect(moveManySpy).toHaveBeenCalledTimes(1);
      expect(moveManySpy.mock.calls[0]?.[0]).toEqual(["b"]);

      ctrl.detach();
      cleanup();
    });

    it("ignores pointerdown on selection header cell", () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const requestColumnTransformSync = vi.fn();
      const cols = [createSelectionColumnDef(), { field: "a" }, { field: "b" }];
      const { root, headerRow, cells, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync,
        store,
      });
      ctrl.attach(root);

      const addSpy = vi.spyOn(document, "addEventListener");

      // Selection column has no handle; dispatch on cell body.
      cells[0]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerId: 2,
          clientX: 40,
        }),
      );

      expect(addSpy).not.toHaveBeenCalledWith("pointermove", expect.any(Function));

      ctrl.detach();
      addSpy.mockRestore();
      cleanup();
    });

    it("ignores pointerdown on resize handle", () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const cols = [createSelectionColumnDef(), { field: "a" }];
      const { root, headerRow, cells, cleanup } = mountHeader(cols);
      const resizeHandle = document.createElement("div");
      resizeHandle.className = "lfg-resize-handle";
      cells[1]?.appendChild(resizeHandle);
      mockCellRect(cells[1]!, 80, 80);

      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      const addSpy = vi.spyOn(document, "addEventListener");
      resizeHandle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerId: 3,
          clientX: 155,
        }),
      );
      expect(addSpy).not.toHaveBeenCalledWith("pointermove", expect.any(Function));

      ctrl.detach();
      addSpy.mockRestore();
      cleanup();
    });

    it("pointerdown + pointerup without exceeding drag threshold does not reorder", () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }, { field: "c" }]);
      const requestColumnTransformSync = vi.fn();
      const onColumnOrderChanged = vi.fn();
      const moveManySpy = vi.spyOn(store, "moveMany");
      const moveSpy = vi.spyOn(store, "move");
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync,
        onColumnOrderChanged,
        store,
      });
      ctrl.attach(root);

      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 2001,
          clientX: 200,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 2001,
          clientX: 200,
          clientY: 0,
        }),
      );

      expect(requestColumnTransformSync).not.toHaveBeenCalled();
      expect(onColumnOrderChanged).not.toHaveBeenCalled();
      expect(moveSpy).not.toHaveBeenCalled();
      expect(moveManySpy).not.toHaveBeenCalled();
      expect(root.classList.contains("lfg-column-order-dragging")).toBe(false);
      expect(handles[2]?.classList.contains("lfg-column-drag-source")).toBe(false);

      ctrl.detach();
      cleanup();
    });

    it("pointermove below drag threshold does not apply drag classes or preview", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }, { field: "c" }]);
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 2002,
          clientX: 200,
          clientY: 0,
        }),
      );
      const below = DRAG_START_THRESHOLD_PX - 1;
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 2002,
          clientX: 200 + below,
          clientY: 0,
        }),
      );
      await flushRaf(2);

      expect(root.classList.contains("lfg-column-order-dragging")).toBe(false);
      expect(handles[2]?.classList.contains("lfg-column-drag-source")).toBe(false);
      expect(root.querySelector(".lfg-column-drop-indicator")).toBeNull();

      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 2002,
          clientX: 200 + below,
          clientY: 0,
        }),
      );

      ctrl.detach();
      cleanup();
    });

    it("pointermove updates preview classes but does not call requestColumnTransformSync", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }, { field: "c" }]);
      const requestColumnTransformSync = vi.fn();
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ];
      const { root, headerRow, cells, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync,
        store,
      });
      ctrl.attach(root);

      // b: then move pointer past last column midpoint → drop after c (non-no-op).
      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 4,
          clientX: 200,
          clientY: 0,
        }),
      );

      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 4,
          clientX: 300,
          clientY: 0,
        }),
      );

      await flushRaf(2);

      // Drop after last user column → indicator at trailing edge (not lfg-column-drop-before).
      expect(cells[3]?.classList.contains("lfg-column-shift-left")).toBe(true);
      expect(cells[3]?.classList.contains("lfg-column-drop-before")).toBe(false);
      // The header cell for "b" (cells[2]) should have drag-source class.
      expect(cells[2]?.classList.contains("lfg-column-drag-source")).toBe(true);
      expect(root.querySelector(".lfg-column-drop-indicator")).toBeTruthy();
      expect(requestColumnTransformSync).not.toHaveBeenCalled();

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 4 }),
      );
      ctrl.detach();
      cleanup();
    });

    it("drag preview reuses the drop indicator across pointer moves", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }, { field: "c" }]);
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 405,
          clientX: 200,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 405,
          clientX: 300,
          clientY: 0,
        }),
      );
      await flushRaf(2);

      const firstIndicator = root.querySelector(
        ".lfg-column-drop-indicator",
      ) as HTMLDivElement | null;
      expect(firstIndicator).toBeTruthy();
      expect(firstIndicator?.style.display).toBe("block");

      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 405,
          clientX: 90,
          clientY: 0,
        }),
      );
      await flushRaf(2);

      const secondIndicator = root.querySelector(
        ".lfg-column-drop-indicator",
      ) as HTMLDivElement | null;
      expect(secondIndicator).toBe(firstIndicator);
      expect(secondIndicator?.style.display).toBe("block");

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 405 }),
      );
      ctrl.detach();
      cleanup();
    });

    it("pointerup commits once and emits drag payload after real move", () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }, { field: "c" }]);
      const requestColumnTransformSync = vi.fn();
      const onColumnOrderChanged = vi.fn();
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);

      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync,
        onColumnOrderChanged,
        store,
      });
      ctrl.attach(root);

      // user cells: a,b,c at indices 1,2,3 in `cells` — rects 0,80,160,240 width 80
      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 5,
          clientX: 200,
          clientY: 0,
        }),
      );

      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 5,
          clientX: nudgeX(200),
          clientY: 0,
        }),
      );

      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 5,
          clientX: 45,
          clientY: 0,
        }),
      );

      expect(requestColumnTransformSync).toHaveBeenCalledTimes(1);
      expect(onColumnOrderChanged).toHaveBeenCalledTimes(1);

      expect(root.classList.contains("lfg-column-order-dragging")).toBe(false);
      expect(root.querySelector(".lfg-column-drop-indicator")).toBeNull();
      for (const el of Array.from(
        headerRow.querySelectorAll<HTMLElement>(".lfg-header-cell"),
      )) {
        expect(el.classList.contains("lfg-column-drag-source")).toBe(false);
        expect(el.classList.contains("lfg-column-shift-left")).toBe(false);
        expect(el.classList.contains("lfg-column-shift-right")).toBe(false);
        expect(el.classList.contains("lfg-column-drop-before")).toBe(false);
      }

      const payload = onColumnOrderChanged.mock.calls[0]?.[0];
      expect(payload?.source).toBe("drag");
      expect(payload?.movedColumnId).toBe("b");
      expect(payload?.fromIndex).toBe(1);
      expect(payload?.toIndex).toBe(0);
      expect(payload?.columnOrder).toEqual(["b", "a", "c"]);

      ctrl.detach();
      cleanup();
    });

    it("pointercancel clears drag preview classes and indicator", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }, { field: "c" }]);
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 6,
          clientX: 200,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 6,
          clientX: 300,
          clientY: 0,
        }),
      );
      await flushRaf(2);

      expect(root.querySelector(".lfg-column-drop-indicator")).toBeTruthy();

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 6 }),
      );

      expect(root.classList.contains("lfg-column-order-dragging")).toBe(false);
      expect(root.querySelector(".lfg-column-drop-indicator")).toBeNull();
      for (const el of Array.from(
        headerRow.querySelectorAll<HTMLElement>(".lfg-header-cell"),
      )) {
        expect(el.classList.contains("lfg-column-drag-source")).toBe(false);
        expect(el.classList.contains("lfg-column-shift-left")).toBe(false);
      }

      ctrl.detach();
      cleanup();
    });

    it("detach during drag clears preview and removes document listeners", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }, { field: "c" }]);
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      const rmSpy = vi.spyOn(document, "removeEventListener");

      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 7,
          clientX: 200,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 7,
          clientX: nudgeX(200),
          clientY: 0,
        }),
      );
      await flushRaf(1);

      expect(root.classList.contains("lfg-column-order-dragging")).toBe(true);

      ctrl.detach();

      expect(rmSpy).toHaveBeenCalledWith("pointermove", expect.any(Function));
      expect(rmSpy).toHaveBeenCalledWith("pointerup", expect.any(Function));
      expect(rmSpy).toHaveBeenCalledWith("pointercancel", expect.any(Function));
      expect(root.classList.contains("lfg-column-order-dragging")).toBe(false);
      expect(root.querySelector(".lfg-column-drop-indicator")).toBeNull();
      rmSpy.mockRestore();

      cleanup();
    });

    it("dragging unselected column uses store.move (delegates moveMany with one field)", () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }, { field: "c" }]);
      const moveManySpy = vi.spyOn(store, "moveMany");
      const moveSpy = vi.spyOn(store, "move");
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => ["b"],
        requestColumnTransformSync: vi.fn(),
        onColumnOrderChanged: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 10,
          clientX: 120,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 10,
          clientX: nudgeX(120),
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 10,
          clientX: 280,
          clientY: 0,
        }),
      );

      expect(moveSpy).toHaveBeenCalledTimes(1);
      expect(moveManySpy).toHaveBeenCalledTimes(1);
      expect(moveManySpy.mock.calls[0]?.[0]).toEqual(["a"]);
      ctrl.detach();
      cleanup();
    });

    it("multi selected drag calls moveMany ordered by columns not selection ids", () => {
      const store = new ColumnOrderStore();
      store.syncColumns([
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ]);
      const moveManySpy = vi.spyOn(store, "moveMany");
      const onColumnOrderChanged = vi.fn();
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => ["d", "b"],
        requestColumnTransformSync: vi.fn(),
        onColumnOrderChanged,
        store,
      });
      ctrl.attach(root);

      handles[4]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 11,
          clientX: 360,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 11,
          clientX: nudgeX(360),
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 11,
          clientX: 500,
          clientY: 0,
        }),
      );

      expect(moveManySpy).toHaveBeenCalledTimes(1);
      expect(moveManySpy.mock.calls[0]?.[0]).toEqual(["b", "d"]);
      expect(onColumnOrderChanged).toHaveBeenCalledTimes(1);
      const payload = onColumnOrderChanged.mock.calls[0]?.[0];
      expect(payload?.movedColumnIds).toEqual(["b", "d"]);
      expect(payload?.fromIndices).toEqual([1, 3]);
      expect(payload?.movedColumnId).toBe("d");
      ctrl.detach();
      cleanup();
    });

    it("pointermove with multi selection does not call requestColumnTransformSync", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ]);
      const requestColumnTransformSync = vi.fn();
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ];
      const { root, headerRow, cells, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => ["b", "c"],
        requestColumnTransformSync,
        store,
      });
      ctrl.attach(root);

      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 12,
          clientX: 200,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 12,
          clientX: 260,
          clientY: 0,
        }),
      );
      await flushRaf(2);

      // Header cells for "b" and "c" should have drag-source class.
      expect(cells[2]?.classList.contains("lfg-column-drag-source")).toBe(true);
      expect(cells[3]?.classList.contains("lfg-column-drag-source")).toBe(true);
      expect(requestColumnTransformSync).not.toHaveBeenCalled();

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 12 }),
      );
      ctrl.detach();
      cleanup();
    });

    it("non-contiguous B and D: only movers get drag-source; gap column shifts when moving block right", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
        { field: "e" },
        { field: "f" },
      ]);
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
        { field: "e" },
        { field: "f" },
      ];
      const { root, headerRow, cells, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => ["b", "d"],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 50,
          clientX: 200,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 50,
          clientX: 440,
          clientY: 0,
        }),
      );
      await flushRaf(2);

      expect(cells[2]?.classList.contains("lfg-column-drag-source")).toBe(true);
      expect(cells[4]?.classList.contains("lfg-column-drag-source")).toBe(true);
      expect(cells[3]?.classList.contains("lfg-column-drag-source")).toBe(false);
      expect(cells[3]?.classList.contains("lfg-column-shift-left")).toBe(true);

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 50 }),
      );
      ctrl.detach();
      cleanup();
    });

    it("non-contiguous B and D: preview toward before C keeps visible indicator (not false in-span no-op)", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ]);
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => ["b", "d"],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 51,
          clientX: 200,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 51,
          clientX: 190,
          clientY: 0,
        }),
      );
      await flushRaf(2);

      const ind = root.querySelector(
        ".lfg-column-drop-indicator",
      ) as HTMLElement | null;
      expect(ind).toBeTruthy();
      expect(ind?.style.display).not.toBe("none");

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 51 }),
      );
      ctrl.detach();
      cleanup();
    });

    it("contiguous B and C: drop before C preview is no-op and hides indicator", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ]);
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => ["b", "c"],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 52,
          clientX: 200,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 52,
          clientX: 190,
          clientY: 0,
        }),
      );
      await flushRaf(2);

      const ind = root.querySelector(
        ".lfg-column-drop-indicator",
      ) as HTMLElement | null;
      expect(ind === null || ind.style.display === "none").toBe(true);

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 52 }),
      );
      ctrl.detach();
      cleanup();
    });
  });

  describe("collectVisibleUserHeaderEntries / computeGlobalDropIndexFromVisible (virtualized DOM order)", () => {
    const globalFields = [
      "totalWinnings",
      "winningTrends",
      "jan",
      "feb",
      "mar",
    ];

    function mountShuffledRingBufferLikeHeader(): {
      row: HTMLDivElement;
      cleanup: () => void;
    } {
      const row = document.createElement("div");
      row.className = "lfg-header-row";
      const mk = (field: string, left: number) => {
        const cell = document.createElement("div");
        cell.className = "lfg-header-cell";
        cell.setAttribute("data-col-id", field);
        mockCellRect(cell, left, 80);
        return cell;
      };
      // Visual left-to-right: winningTrends (100), jan (200), feb (300)
      // DOM order mimics ring buffer: feb, jan, winningTrends
      row.appendChild(mk("feb", 300));
      row.appendChild(mk("jan", 200));
      row.appendChild(mk("winningTrends", 100));
      document.body.appendChild(row);
      return {
        row,
        cleanup: () => document.body.removeChild(row),
      };
    }

    it("sorts visible cells by visual left, not DOM order", () => {
      const { row, cleanup } = mountShuffledRingBufferLikeHeader();
      const vis = collectVisibleUserHeaderEntries(row, globalFields);
      expect(vis.map((v) => v.field)).toEqual([
        "winningTrends",
        "jan",
        "feb",
      ]);
      cleanup();
    });

    it("pointer before winningTrends midpoint maps to global insertion index 1", () => {
      const { row, cleanup } = mountShuffledRingBufferLikeHeader();
      const vis = collectVisibleUserHeaderEntries(row, globalFields);
      expect(computeGlobalDropIndexFromVisible(120, vis)).toBe(1);
      cleanup();
    });

    it("moving jan one slot left commits as insertion before winningTrends", () => {
      const store = new ColumnOrderStore();
      const userCols: ColumnDef[] = globalFields.map((f) => ({ field: f }));
      store.syncColumns(userCols);
      const { row, cleanup } = mountShuffledRingBufferLikeHeader();
      const vis = collectVisibleUserHeaderEntries(row, globalFields);
      const toIdx = computeGlobalDropIndexFromVisible(120, vis);
      expect(toIdx).toBe(1);
      const r = store.move("jan", toIdx, userCols);
      expect(r?.order).toEqual([
        "totalWinnings",
        "jan",
        "winningTrends",
        "feb",
        "mar",
      ]);
      cleanup();
    });

    it("pointer after last visible cell returns last visible global index + 1", () => {
      const { row, cleanup } = mountShuffledRingBufferLikeHeader();
      const vis = collectVisibleUserHeaderEntries(row, globalFields);
      expect(computeGlobalDropIndexFromVisible(900, vis)).toBe(4);
      cleanup();
    });

    it("pointer before first visible left edge returns first visible global index", () => {
      const { row, cleanup } = mountShuffledRingBufferLikeHeader();
      const vis = collectVisibleUserHeaderEntries(row, globalFields);
      expect(computeGlobalDropIndexFromVisible(50, vis)).toBe(1);
      cleanup();
    });

    it("contiguous B+C drag to end returns userCols.length as insertion slot", () => {
      const store = new ColumnOrderStore();
      const userCols: ColumnDef[] = [
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ];
      store.syncColumns(userCols);
      const row = document.createElement("div");
      row.className = "lfg-header-row";
      const positions = [
        { field: "a", left: 0 },
        { field: "b", left: 80 },
        { field: "c", left: 160 },
        { field: "d", left: 240 },
      ];
      for (const pos of positions) {
        const cell = document.createElement("div");
        cell.className = "lfg-header-cell";
        cell.setAttribute("data-col-id", pos.field);
        mockCellRect(cell, pos.left, 80);
        row.appendChild(cell);
      }
      document.body.appendChild(row);
      const fields = userCols.map((c) => c.field);
      const vis = collectVisibleUserHeaderEntries(row, fields);
      // Pointer far past last cell → should return userCols.length (4)
      const dropIdx = computeGlobalDropIndexFromVisible(999, vis);
      expect(dropIdx).toBe(fields.length);
      // Store.moveMany with ["b","c"] at slot 4 should place them at end
      const result = store.moveMany(["b", "c"], dropIdx, userCols);
      expect(result?.order).toEqual(["a", "d", "b", "c"]);
      document.body.removeChild(row);
    });

    it("computeDropIndex uses fresh visible entries after window changes (simulated mid-list start)", () => {
      // Simulate a viewport that shows only "mar","apr","may" from a longer list
      const allFields = ["jan", "feb", "mar", "apr", "may", "jun"];
      const row = document.createElement("div");
      row.className = "lfg-header-row";
      // Only mid-list columns are in the DOM (horizontal virtualization)
      const visibleSlice = [
        { field: "mar", left: 0 },
        { field: "apr", left: 80 },
        { field: "may", left: 160 },
      ];
      for (const pos of visibleSlice) {
        const cell = document.createElement("div");
        cell.className = "lfg-header-cell";
        cell.setAttribute("data-col-id", pos.field);
        mockCellRect(cell, pos.left, 80);
        row.appendChild(cell);
      }
      document.body.appendChild(row);

      const vis = collectVisibleUserHeaderEntries(row, allFields);
      // mar=globalIndex 2, apr=3, may=4
      expect(vis.map((v) => v.field)).toEqual(["mar", "apr", "may"]);

      // Drop before first visible → returns first visible globalIndex (2)
      expect(computeGlobalDropIndexFromVisible(-100, vis)).toBe(2);
      // Drop after last visible → returns last visible globalIndex + 1 (5)
      expect(computeGlobalDropIndexFromVisible(999, vis)).toBe(5);
      // Drop before apr midpoint (80+40=120) → returns apr globalIndex (3)
      expect(computeGlobalDropIndexFromVisible(100, vis)).toBe(3);

      document.body.removeChild(row);
    });
  });

  describe("auto-scroll during column drag", () => {
    function makeViewport(left: number, right: number): HTMLElement {
      const vp = document.createElement("div");
      vi.spyOn(vp, "getBoundingClientRect").mockReturnValue({
        left,
        right,
        width: right - left,
        top: 0,
        bottom: 200,
        height: 200,
        x: left,
        y: 0,
        toJSON: () => "",
      } as DOMRect);
      return vp;
    }

    it("auto-scroll starts rAF loop when pointer is near right edge after drag threshold", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }, { field: "c" }]);
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const viewport = makeViewport(0, 400);

      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getViewport: () => viewport,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      // Start drag on handle
      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 900,
          clientX: 200,
          clientY: 0,
        }),
      );
      // Move past threshold with pointer near right edge (400 - 380 = 20 < 80)
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 900,
          clientX: nudgeX(200),
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 900,
          clientX: 380,
          clientY: 0,
        }),
      );

      // After flushRaf, auto-scroll loop should have set scrollLeft
      await flushRaf(3);

      expect(viewport.scrollLeft).toBeGreaterThan(0);

      document.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 900, clientX: 380 }),
      );
      ctrl.detach();
      cleanup();
    });

    it("auto-scroll stops on pointerup", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const cols = [createSelectionColumnDef(), { field: "a" }, { field: "b" }];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const viewport = makeViewport(0, 400);

      const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");

      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getViewport: () => viewport,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 901,
          clientX: 120,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 901,
          clientX: nudgeX(120),
          clientY: 0,
        }),
      );
      await flushRaf(1);
      expect(root.classList.contains("lfg-column-order-dragging")).toBe(true);

      document.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 901, clientX: 120 }),
      );

      // cancelAnimationFrame must have been called to stop auto-scroll
      expect(cancelSpy).toHaveBeenCalled();
      expect(root.classList.contains("lfg-column-order-dragging")).toBe(false);

      cancelSpy.mockRestore();
      ctrl.detach();
      cleanup();
    });

    it("auto-scroll stops on pointercancel", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const cols = [createSelectionColumnDef(), { field: "a" }, { field: "b" }];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const viewport = makeViewport(0, 400);

      const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");

      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getViewport: () => viewport,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 902,
          clientX: 120,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 902,
          clientX: nudgeX(120),
          clientY: 0,
        }),
      );
      await flushRaf(1);

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 902 }),
      );

      expect(cancelSpy).toHaveBeenCalled();
      expect(root.classList.contains("lfg-column-order-dragging")).toBe(false);

      cancelSpy.mockRestore();
      ctrl.detach();
      cleanup();
    });

    it("auto-scroll stops on detach", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const cols = [createSelectionColumnDef(), { field: "a" }, { field: "b" }];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const viewport = makeViewport(0, 400);

      const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");

      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getViewport: () => viewport,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 903,
          clientX: 120,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 903,
          clientX: nudgeX(120),
          clientY: 0,
        }),
      );
      await flushRaf(1);
      expect(root.classList.contains("lfg-column-order-dragging")).toBe(true);

      ctrl.detach();

      expect(cancelSpy).toHaveBeenCalled();
      expect(root.classList.contains("lfg-column-order-dragging")).toBe(false);

      cancelSpy.mockRestore();
      cleanup();
    });

    it("no auto-scroll when getViewport is not provided", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const cols = [createSelectionColumnDef(), { field: "a" }, { field: "b" }];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);

      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        // getViewport intentionally omitted
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 904,
          clientX: 120,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 904,
          clientX: nudgeX(120),
          clientY: 0,
        }),
      );
      await flushRaf(2);

      // Should not throw; drag still works normally
      expect(root.classList.contains("lfg-column-order-dragging")).toBe(true);

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 904 }),
      );
      ctrl.detach();
      cleanup();
    });
  });

  describe("body cell preview stylesheet (buildColumnPreviewCSS + style element lifecycle)", () => {
    it("buildColumnPreviewCSS: moving fields get opacity rule for both header and body cells", () => {
      const css = buildColumnPreviewCSS(new Set(["a", "b"]), new Map());
      expect(css).toContain('.lfg-grid .lfg-header-cell[data-col-id="a"]');
      expect(css).toContain('.lfg-grid .lfg-cell[data-col-id="a"]');
      expect(css).toContain("opacity:");
      expect(css).toContain('.lfg-grid .lfg-header-cell[data-col-id="b"]');
      expect(css).toContain('.lfg-grid .lfg-cell[data-col-id="b"]');
    });

    it("buildColumnPreviewCSS: shifted fields do not move header or body cells", () => {
      const shifts = new Map<string, "left" | "right">([
        ["c", "left"],
        ["d", "right"],
      ]);
      const css = buildColumnPreviewCSS(new Set(["a"]), shifts);
      expect(css).not.toContain("transform:");
      expect(css).not.toContain("translateX");
      expect(css).not.toContain('.lfg-grid .lfg-header-cell[data-col-id="c"]');
      expect(css).not.toContain('.lfg-grid .lfg-cell[data-col-id="c"]');
      expect(css).not.toContain('.lfg-grid .lfg-header-cell[data-col-id="d"]');
      expect(css).not.toContain('.lfg-grid .lfg-cell[data-col-id="d"]');
    });

    it("buildColumnPreviewCSS: drop target does not add inset box-shadow (indicator owns the seam)", () => {
      const before = buildColumnPreviewCSS(new Set(["a"]), new Map(), "c", "before");
      const after = buildColumnPreviewCSS(new Set(["a"]), new Map(), "c", "after");
      expect(before).not.toContain("box-shadow");
      expect(before).not.toContain("inset 4px");
      expect(after).not.toContain("box-shadow");
      expect(after).not.toContain("inset -4px");
      // Moving-source opacity still present.
      expect(before).toContain("opacity:");
      expect(before).toContain('.lfg-grid .lfg-cell[data-col-id="a"]');
    });

    it("buildColumnPreviewCSS: null dropField produces no box-shadow rule", () => {
      const css = buildColumnPreviewCSS(new Set(["a"]), new Map(), null, null);
      expect(css).not.toContain("box-shadow");
    });

    it("buildColumnPreviewCSS: empty sets produce empty string", () => {
      expect(buildColumnPreviewCSS(new Set(), new Map())).toBe("");
    });

    it("preview <style> element is injected into document.head when drag starts", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const cols = [createSelectionColumnDef(), { field: "a" }, { field: "b" }];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 2100,
          clientX: 120,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 2100,
          clientX: nudgeX(120),
          clientY: 0,
        }),
      );

      // Style element present immediately after beginRealDrag (synchronous).
      const styleEl = document.head.querySelector(
        "style[data-lfg-col-order-preview]",
      );
      expect(styleEl).toBeTruthy();
      expect(styleEl?.textContent).toContain('data-col-id="a"');

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 2100 }),
      );
      ctrl.detach();
      cleanup();
    });

    it("preview <style> element is removed on pointercancel", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const cols = [createSelectionColumnDef(), { field: "a" }, { field: "b" }];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 2101,
          clientX: 120,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 2101,
          clientX: nudgeX(120),
          clientY: 0,
        }),
      );

      expect(
        document.head.querySelector("style[data-lfg-col-order-preview]"),
      ).toBeTruthy();

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 2101 }),
      );

      expect(
        document.head.querySelector("style[data-lfg-col-order-preview]"),
      ).toBeNull();

      ctrl.detach();
      cleanup();
    });

    it("preview <style> element is removed on pointerup", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }]);
      const cols = [createSelectionColumnDef(), { field: "a" }, { field: "b" }];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      handles[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 2102,
          clientX: 120,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 2102,
          clientX: nudgeX(120),
          clientY: 0,
        }),
      );

      expect(
        document.head.querySelector("style[data-lfg-col-order-preview]"),
      ).toBeTruthy();

      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 2102,
          clientX: 280,
        }),
      );

      expect(
        document.head.querySelector("style[data-lfg-col-order-preview]"),
      ).toBeNull();

      ctrl.detach();
      cleanup();
    });

    it("preview <style> is updated on pointermove: shifts appear in CSS text", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }, { field: "c" }]);
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      // Drag "b" (handles[2]) far right so "c" needs to shift left.
      handles[2]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 2103,
          clientX: 160,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 2103,
          clientX: 300,
          clientY: 0,
        }),
      );
      await flushRaf(2);

      const styleEl = document.head.querySelector(
        "style[data-lfg-col-order-preview]",
      );
      expect(styleEl).toBeTruthy();
      // Moving field "b" should have opacity rule.
      expect(styleEl?.textContent).toContain('data-col-id="b"');
      expect(styleEl?.textContent).toContain("opacity:");

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 2103 }),
      );
      ctrl.detach();
      cleanup();
    });

    it("generated CSS keeps source opacity without a body drop-line box-shadow during drag", async () => {
      const store = new ColumnOrderStore();
      store.syncColumns([{ field: "a" }, { field: "b" }, { field: "c" }]);
      const cols = [
        createSelectionColumnDef(),
        { field: "a" },
        { field: "b" },
        { field: "c" },
      ];
      const { root, headerRow, handles, cleanup } = mountHeader(cols);
      const ctrl = new ColumnOrderController({
        getColumnOrderConfig: () => ({ enabled: true }),
        getColumns: () => cols,
        getHeaderRowEl: () => headerRow,
        getSelectedColumnIdsForColumnOrder: () => [],
        requestColumnTransformSync: vi.fn(),
        store,
      });
      ctrl.attach(root);

      // Cells with selection col: sel=0, a=80, b=160, c=240 (width=80 each).
      // Drag "a" (handles[1]) to clientX=260: before "c" midpoint (280) → drop before "c" (non-noop).
      handles[1]?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 2104,
          clientX: 120,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 2104,
          // 260 < c's midpoint (280) → before "c" (globalIndex 2); non-noop for dragging "a"
          clientX: 260,
          clientY: 0,
        }),
      );
      await flushRaf(2);

      const styleEl = document.head.querySelector(
        "style[data-lfg-col-order-preview]",
      );
      expect(styleEl).toBeTruthy();
      const css = styleEl?.textContent ?? "";
      // Source opacity still applies to body cells; seam is the DOM indicator.
      expect(css).toContain(".lfg-cell");
      expect(css).toContain("opacity:");
      expect(css).not.toContain("box-shadow");

      document.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 2104 }),
      );
      ctrl.detach();
      cleanup();
    });
  });
});
