// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { PooledRow } from "../../../internal/poolTypes";
import type { DisplayRowReader } from "../../../rendering/rowViewAccess";
import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import type { RowData } from "../../../types";
import { DRAG_START_THRESHOLD_PX } from "../../drag/DragSession";
import {
  computeRowDropIndex,
  ROW_DRAG_BLOCKED_CLASS,
  ROW_DRAG_ENABLED_CLASS,
  ROW_DRAG_HANDLE_CLASS,
  RowOrderController,
} from "../RowOrderController";
import { RowOrderStore } from "../RowOrderStore";
import type { RowOrderMoveRequest } from "../types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePoolRow(
  rowIndex: number,
  rowId: string,
  top: number,
  height = 40,
): PooledRow {
  const element = document.createElement("div");
  element.className = "lfg-row";
  element.setAttribute("data-row-id", rowId);
  element.setAttribute("data-row-index", String(rowIndex));
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + height,
    left: 0,
    right: 200,
    width: 200,
    height,
    x: 0,
    y: top,
    toJSON: () => "",
  } as DOMRect);
  return {
    element,
    cells: [],
    rowIndex,
    rowVersion: 0,
    rowId,
  };
}

function makeHandle(rowEl: HTMLElement): HTMLDivElement {
  const handle = document.createElement("div");
  handle.className = ROW_DRAG_HANDLE_CLASS;
  rowEl.appendChild(handle);
  return handle;
}

interface MountedController {
  root: HTMLDivElement;
  viewport: HTMLDivElement;
  controller: RowOrderController;
  store: RowOrderStore;
  pool: PooledRow[];
  rows: { id: string }[];
  cleanup: () => void;
}

function mountController(
  rowCount = 5,
  enabled = true,
): MountedController {
  const root = document.createElement("div");
  root.className = "lfg-grid";
  const viewport = document.createElement("div");
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
    top: 0, bottom: 400, left: 0, right: 200, width: 200, height: 400,
    x: 0, y: 0, toJSON: () => "",
  } as DOMRect);
  root.appendChild(viewport);
  document.body.appendChild(root);

  const rows = Array.from({ length: rowCount }, (_, i) => ({ id: `r${i}` }));
  const pool: PooledRow[] = rows.map((r, i) => {
    const pr = makePoolRow(i, r.id, i * 40, 40);
    root.appendChild(pr.element);
    makeHandle(pr.element);
    return pr;
  });

  const store = new RowOrderStore();
  const controller = new RowOrderController({
    getRowDragConfig: () => ({ enabled, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 }),
    getDisplayRows: () => createArrayDisplayRowReader(rows),
    getPool: () => pool,
    resolveRowId: (_, i) => rows[i]!.id,
    getSelectedRowCountForRowOrder: () => 0,
    isRowSelectedForRowOrder: () => false,
    getSelectedRowIdsForRowOrder: () => [],
    getViewport: () => viewport,
    requestSync: vi.fn(),
    store,
  });
  controller.attach(root);

  return {
    root,
    viewport,
    controller,
    store,
    pool,
    rows,
    cleanup: () => {
      controller.detach();
      document.body.removeChild(root);
    },
  };
}

function nudgeY(startY: number): number {
  return startY + DRAG_START_THRESHOLD_PX + 1;
}

// ─── computeRowDropIndex ─────────────────────────────────────────────────────

describe("computeRowDropIndex", () => {
  it("returns 0 when pool is empty", () => {
    expect(computeRowDropIndex([], 100)).toBe(0);
  });

  it("returns first visible rowIndex when pointer is above all midpoints", () => {
    const p0 = makePoolRow(3, "a", 120, 40); // midY = 140
    const p1 = makePoolRow(5, "b", 200, 40); // midY = 220
    expect(computeRowDropIndex([p0, p1], 100)).toBe(3);
  });

  it("returns lastVisibleRowIndex + 1 when pointer is below all midpoints", () => {
    const p0 = makePoolRow(0, "a", 0, 40);   // midY = 20
    const p1 = makePoolRow(1, "b", 40, 40);  // midY = 60
    expect(computeRowDropIndex([p0, p1], 200)).toBe(2);
  });

  it("returns correct index between two rows", () => {
    const p0 = makePoolRow(0, "a", 0, 40);   // midY = 20
    const p1 = makePoolRow(1, "b", 40, 40);  // midY = 60
    const p2 = makePoolRow(2, "c", 80, 40);  // midY = 100
    // pointer at 50 → above p1's midpoint (60) → insert before p1 = index 1
    expect(computeRowDropIndex([p0, p1, p2], 50)).toBe(1);
    // pointer at 70 → above p2's midpoint (100) → insert before p2 = index 2
    expect(computeRowDropIndex([p0, p1, p2], 70)).toBe(2);
  });

  it("skips pool rows with rowIndex < 0 (idle slots)", () => {
    const idle = makePoolRow(-1, "", 0, 40);
    const active = makePoolRow(2, "a", 40, 40); // midY = 60
    expect(computeRowDropIndex([idle, active], 50)).toBe(2);
    expect(computeRowDropIndex([idle, active], 70)).toBe(3); // after last visible
  });

  it("handles non-contiguous visible rows (virtualisation gap)", () => {
    // Visible: rows 0 and 10 (rows 1–9 scrolled off)
    const p0 = makePoolRow(0, "a", 0, 40);    // midY = 20
    const p10 = makePoolRow(10, "b", 40, 40); // midY = 60
    // pointer at 50 → before p10 (midY 60) → index 10
    expect(computeRowDropIndex([p0, p10], 50)).toBe(10);
    // pointer at 70 → past all → lastVisible+1 = 11
    expect(computeRowDropIndex([p0, p10], 70)).toBe(11);
  });
});

// ─── Drag starts only from handle ───────────────────────────────────────────

describe("RowOrderController – drag start gating", () => {
  it("does not start drag when pointer is on row body (not handle)", () => {
    const { root, pool, cleanup } = mountController();
    const rowEl = pool[1]!.element;

    // Dispatch from the row body directly (not a handle)
    rowEl.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 50,
        clientY: 60,
      }),
    );

    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 50,
        clientY: nudgeY(60),
      }),
    );
    // No drag-active class = drag was not initiated
    expect(root.classList.contains("lfg-row-dragging")).toBe(false);
    cleanup();
  });

  it("starts drag when pointer is on drag handle", () => {
    const { root, pool, cleanup } = mountController();
    const handle = pool[1]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;

    root.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 10,
        clientY: 60,
      }),
    );
    // Simulate the browser delivering the event with the handle as target
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 10,
        clientY: 60,
      }),
    );

    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(60),
      }),
    );
    expect(root.classList.contains("lfg-row-dragging")).toBe(true);
    cleanup();
  });

  it("does not start drag when rowDrag is disabled", () => {
    const { root, pool, cleanup } = mountController(5, false);
    const handle = pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;

    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(10),
      }),
    );
    expect(root.classList.contains("lfg-row-dragging")).toBe(false);
    cleanup();
  });

  it("does not add lfg-row-drag-enabled class when disabled", () => {
    const { root, cleanup } = mountController(5, false);
    expect(root.classList.contains(ROW_DRAG_ENABLED_CLASS)).toBe(false);
    cleanup();
  });

  it("adds lfg-row-drag-enabled class when enabled", () => {
    const { root, cleanup } = mountController(5, true);
    expect(root.classList.contains(ROW_DRAG_ENABLED_CLASS)).toBe(true);
    cleanup();
  });
});

// ─── syncConfig ──────────────────────────────────────────────────────────────

describe("RowOrderController – syncConfig", () => {
  function makeController(initialEnabled: boolean): {
    root: HTMLDivElement;
    controller: RowOrderController;
    getEnabled: { value: boolean };
    cleanup: () => void;
  } {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const store = new RowOrderStore();
    const cfg = { value: initialEnabled };
    const controller = new RowOrderController({
      getRowDragConfig: () => ({ enabled: cfg.value, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 }),
      getDisplayRows: () => createArrayDisplayRowReader([]),
      getPool: () => [],
      resolveRowId: (_, i) => String(i),
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      requestSync: vi.fn(),
      store,
    });
    controller.attach(root);
    return {
      root,
      controller,
      getEnabled: cfg,
      cleanup: () => {
        controller.detach();
        document.body.removeChild(root);
      },
    };
  }

  it("does not have lfg-row-drag-enabled when disabled at attach", () => {
    const { root, cleanup } = makeController(false);
    expect(root.classList.contains(ROW_DRAG_ENABLED_CLASS)).toBe(false);
    cleanup();
  });

  it("has lfg-row-drag-enabled when enabled at attach", () => {
    const { root, cleanup } = makeController(true);
    expect(root.classList.contains(ROW_DRAG_ENABLED_CLASS)).toBe(true);
    cleanup();
  });

  it("adds lfg-row-drag-enabled when syncConfig called after enabling", () => {
    const { root, controller, getEnabled, cleanup } = makeController(false);
    expect(root.classList.contains(ROW_DRAG_ENABLED_CLASS)).toBe(false);
    getEnabled.value = true;
    controller.syncConfig();
    expect(root.classList.contains(ROW_DRAG_ENABLED_CLASS)).toBe(true);
    cleanup();
  });

  it("removes lfg-row-drag-enabled when syncConfig called after disabling", () => {
    const { root, controller, getEnabled, cleanup } = makeController(true);
    expect(root.classList.contains(ROW_DRAG_ENABLED_CLASS)).toBe(true);
    getEnabled.value = false;
    controller.syncConfig();
    expect(root.classList.contains(ROW_DRAG_ENABLED_CLASS)).toBe(false);
    cleanup();
  });

  it("cancels active drag when syncConfig disables row drag mid-drag", () => {
    const root = document.createElement("div");
    root.className = "lfg-grid";
    document.body.appendChild(root);
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const pool: PooledRow[] = rows.map((r, i) => {
      const pr = makePoolRow(i, r.id, i * 40, 40);
      root.appendChild(pr.element);
      makeHandle(pr.element);
      return pr;
    });
    const store = new RowOrderStore();
    const cfg = { value: true };
    const controller = new RowOrderController({
      getRowDragConfig: () => ({ enabled: cfg.value, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 }),
      getDisplayRows: () => createArrayDisplayRowReader(rows),
      getPool: () => pool,
      resolveRowId: (_, i) => rows[i]!.id,
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      requestSync: vi.fn(),
      store,
    });
    controller.attach(root);
    const cleanup = (): void => {
      controller.detach();
      document.body.removeChild(root);
    };
    const handle = pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;

    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(10),
      }),
    );
    expect(root.classList.contains("lfg-row-dragging")).toBe(true);

    cfg.value = false;
    controller.syncConfig();

    expect(root.classList.contains("lfg-row-dragging")).toBe(false);
    expect(root.classList.contains(ROW_DRAG_ENABLED_CLASS)).toBe(false);
    cleanup();
  });

  it("handle elements remain in DOM when disabled (only visibility changes via CSS class)", () => {
    const { pool, cleanup } = mountController(3, false);
    for (const pr of pool) {
      const handle = pr.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`);
      expect(handle).not.toBeNull();
    }
    cleanup();
  });
});

// ─── Drag preview classes ────────────────────────────────────────────────────

describe("RowOrderController – drag preview", () => {
  function startDrag(
    mounted: MountedController,
    poolRowIndex: number,
  ): { handle: HTMLElement; rowEl: HTMLElement } {
    const pr = mounted.pool[poolRowIndex]!;
    const handle = pr.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;
    const rowEl = pr.element;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 10,
        clientY: rowEl.getBoundingClientRect().top + 10,
      }),
    );
    return { handle, rowEl };
  }

  it("marks drag source row with lfg-row-drag-source after threshold", () => {
    const mounted = mountController(5);
    const { rowEl } = startDrag(mounted, 1);
    const startY = mounted.pool[1]!.element.getBoundingClientRect().top + 10;

    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(startY),
      }),
    );
    expect(rowEl.classList.contains("lfg-row-drag-source")).toBe(true);
    mounted.cleanup();
  });

  it("pointercancel clears all preview classes", () => {
    const mounted = mountController(5);
    const { rowEl } = startDrag(mounted, 1);
    const startY = mounted.pool[1]!.element.getBoundingClientRect().top + 10;

    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(startY),
      }),
    );
    expect(rowEl.classList.contains("lfg-row-drag-source")).toBe(true);

    document.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 1 }),
    );
    expect(rowEl.classList.contains("lfg-row-drag-source")).toBe(false);
    expect(mounted.root.classList.contains("lfg-row-dragging")).toBe(false);
    mounted.cleanup();
  });

  it("detach clears all preview classes", () => {
    const mounted = mountController(5);
    const { rowEl } = startDrag(mounted, 1);
    const startY = mounted.pool[1]!.element.getBoundingClientRect().top + 10;

    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(startY),
      }),
    );
    expect(rowEl.classList.contains("lfg-row-drag-source")).toBe(true);

    mounted.controller.detach();
    expect(rowEl.classList.contains("lfg-row-drag-source")).toBe(false);
    expect(mounted.root.classList.contains(ROW_DRAG_ENABLED_CLASS)).toBe(false);
    document.body.removeChild(mounted.root);
  });

  it("shows drop-before on the row at the drop target index", () => {
    const mounted = mountController(5);
    // Drag row 0 (top=0, midY=20). Move pointer to y=90 → above row 2 (midY=100).
    startDrag(mounted, 0);

    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(0), // exceed threshold
      }),
    );
    // Now move to row 2's zone
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: 90, // above row2 midY=100 → drop before row 2
      }),
    );
    expect(mounted.pool[2]!.element.classList.contains("lfg-row-drop-before")).toBe(true);
    mounted.cleanup();
  });

  it("mounts a surface rail with end caps at the drop seam", () => {
    const mounted = mountController(5);
    startDrag(mounted, 0);

    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(0),
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: 90,
      }),
    );

    const indicator = mounted.root.querySelector(
      ".lfg-row-drop-indicator",
    ) as HTMLElement | null;
    expect(indicator).not.toBeNull();
    expect(indicator!.dataset.active).toBe("true");
    expect(indicator!.dataset.placement).toBe("before");
    expect(indicator!.style.display).toBe("block");
    expect(
      indicator!.querySelector(".lfg-row-drop-indicator-cap-start"),
    ).not.toBeNull();
    expect(
      indicator!.querySelector(".lfg-row-drop-indicator-beam"),
    ).not.toBeNull();
    expect(
      indicator!.querySelector(".lfg-row-drop-indicator-cap-end"),
    ).not.toBeNull();
    expect(
      indicator!.querySelector(".lfg-row-drop-indicator-badge"),
    ).toBeNull();

    document.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 1 }),
    );
    expect(mounted.root.querySelector(".lfg-row-drop-indicator")).toBeNull();
    mounted.cleanup();
  });

  it("mirrors drop-before onto pinned-left and pinned-right row lanes", () => {
    const mounted = mountController(5);
    for (const pr of mounted.pool) {
      const left = document.createElement("div");
      left.className = "lfg-pinned-row";
      left.setAttribute("data-row-id", pr.rowId!);
      mounted.root.appendChild(left);
      pr.pinnedElement = left;

      const right = document.createElement("div");
      right.className = "lfg-pinned-right-row";
      right.setAttribute("data-row-id", pr.rowId!);
      mounted.root.appendChild(right);
      pr.rightPinnedElement = right;
    }

    startDrag(mounted, 0);
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(0),
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: 90,
      }),
    );

    expect(mounted.pool[2]!.element.classList.contains("lfg-row-drop-before")).toBe(true);
    expect(
      mounted.pool[2]!.pinnedElement!.classList.contains("lfg-row-drop-before"),
    ).toBe(true);
    expect(
      mounted.pool[2]!.rightPinnedElement!.classList.contains("lfg-row-drop-before"),
    ).toBe(true);
    mounted.cleanup();
  });

  it("shows drop-after on the last visible row when pointer is past all rows", () => {
    const mounted = mountController(5);
    startDrag(mounted, 0);

    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(0),
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: 999, // past all rows (last midY=180)
      }),
    );
    // pool[4] is the last row (index 4, top=160, midY=180). dropIndex=5 → not in pool → isAfter on row 4
    expect(mounted.pool[4]!.element.classList.contains("lfg-row-drop-after")).toBe(true);
    mounted.cleanup();
  });
});

// ─── pointerup commits once ──────────────────────────────────────────────────

describe("RowOrderController – commit on pointerup", () => {
  it("calls onRowOrderChanged exactly once on pointerup", () => {
    const onRowOrderChanged = vi.fn();
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const pool: PooledRow[] = rows.map((r, i) => {
      const pr = makePoolRow(i, r.id, i * 40, 40);
      document.body.appendChild(pr.element);
      makeHandle(pr.element);
      return pr;
    });
    const root = document.createElement("div");
    root.className = "lfg-grid";
    pool.forEach((pr) => root.appendChild(pr.element));
    document.body.appendChild(root);

    const store = new RowOrderStore();
    const controller = new RowOrderController({
      getRowDragConfig: () => ({ enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 }),
      getDisplayRows: () => createArrayDisplayRowReader(rows),
      getPool: () => pool,
      resolveRowId: (_, i) => rows[i]!.id,
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      requestSync: vi.fn(),
      onRowOrderChanged,
      store,
    });
    controller.attach(root);

    const handle = pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(10),
      }),
    );
    // Move to drop position (row 2, midY=100 → pointer at 90 → before row 2)
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: 90,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 1,
        clientX: 10,
        clientY: 90,
      }),
    );

    expect(onRowOrderChanged).toHaveBeenCalledTimes(1);
    const evt = onRowOrderChanged.mock.calls[0][0];
    expect(evt.rowId).toBe("a");
    expect(evt.fromIndex).toBe(0);
    expect(evt.insertionIndex).toBe(2);
    expect(evt.source).toBe("drag");
    expect("rowOrderIds" in evt).toBe(false);

    controller.detach();
    document.body.removeChild(root);
  });

  it("does not call onRowOrderChanged on pointercancel", () => {
    const onRowOrderChanged = vi.fn();
    const rows = [{ id: "a" }, { id: "b" }];
    const pool: PooledRow[] = rows.map((r, i) => {
      const pr = makePoolRow(i, r.id, i * 40, 40);
      document.body.appendChild(pr.element);
      makeHandle(pr.element);
      return pr;
    });
    const root = document.createElement("div");
    pool.forEach((pr) => root.appendChild(pr.element));
    document.body.appendChild(root);

    const store = new RowOrderStore();
    const controller = new RowOrderController({
      getRowDragConfig: () => ({ enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 }),
      getDisplayRows: () => createArrayDisplayRowReader(rows),
      getPool: () => pool,
      resolveRowId: (_, i) => rows[i]!.id,
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      requestSync: vi.fn(),
      onRowOrderChanged,
      store,
    });
    controller.attach(root);

    const handle = pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(10),
      }),
    );
    document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));

    expect(onRowOrderChanged).not.toHaveBeenCalled();
    controller.detach();
    document.body.removeChild(root);
  });
});

// ─── Auto-scroll ─────────────────────────────────────────────────────────────

describe("RowOrderController – auto-scroll", () => {
  async function flushRaf(n = 3): Promise<void> {
    for (let i = 0; i < n; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  it("scrolls viewport when pointer is near the bottom edge during drag", async () => {
    const { viewport, pool, cleanup } = mountController(5);
    viewport.scrollTop = 0;

    const handle = pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    // Exceed threshold
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: nudgeY(10),
      }),
    );
    // Move to near bottom edge (viewport bottom=400, zone=80 → near bottom at 390)
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 10,
        clientY: 390,
      }),
    );

    await flushRaf(3);
    expect(viewport.scrollTop).toBeGreaterThan(0);
    cleanup();
  });
});

// ─── Multi-row drag ──────────────────────────────────────────────────────────

describe("RowOrderController – multi-row drag", () => {
  function mountMultiRowController(
    rowCount = 5,
    selectedIds: string[] = [],
  ): MountedController & { selectedIds: string[] } {
    const root = document.createElement("div");
    root.className = "lfg-grid";
    const viewport = document.createElement("div");
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 400, left: 0, right: 200, width: 200, height: 400,
      x: 0, y: 0, toJSON: () => "",
    } as DOMRect);
    root.appendChild(viewport);
    document.body.appendChild(root);

    const rows = Array.from({ length: rowCount }, (_, i) => ({ id: `r${i}` }));
    const pool: PooledRow[] = rows.map((r, i) => {
      const pr = makePoolRow(i, r.id, i * 40, 40);
      root.appendChild(pr.element);
      makeHandle(pr.element);
      return pr;
    });

    const store = new RowOrderStore();
    const sel = [...selectedIds];
    const controller = new RowOrderController({
      getRowDragConfig: () => ({ enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 }),
      getDisplayRows: () => createArrayDisplayRowReader(rows),
      getPool: () => pool,
      resolveRowId: (_, i) => rows[i]!.id,
      getSelectedRowCountForRowOrder: () => sel.length,
      isRowSelectedForRowOrder: (id) => sel.includes(id),
      getSelectedRowIdsForRowOrder: () => sel,
      getViewport: () => viewport,
      requestSync: vi.fn(),
      store,
    });
    controller.attach(root);

    return {
      root,
      viewport,
      controller,
      store,
      pool,
      rows,
      selectedIds: sel,
      cleanup: () => {
        controller.detach();
        document.body.removeChild(root);
      },
    };
  }

  it("dragging an unselected row moves only that row", () => {
    const onRowOrderChanged = vi.fn();
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const pool: PooledRow[] = rows.map((r, i) => {
      const pr = makePoolRow(i, r.id, i * 40, 40);
      document.body.appendChild(pr.element);
      makeHandle(pr.element);
      return pr;
    });
    const root = document.createElement("div");
    pool.forEach((pr) => root.appendChild(pr.element));
    document.body.appendChild(root);
    const store = new RowOrderStore();
    const controller = new RowOrderController({
      getRowDragConfig: () => ({ enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 }),
      getDisplayRows: () => createArrayDisplayRowReader(rows),
      getPool: () => pool,
      resolveRowId: (_, i) => rows[i]!.id,
      getSelectedRowCountForRowOrder: () => 1,
      isRowSelectedForRowOrder: (id) => id === "b",
      getSelectedRowIdsForRowOrder: () => ["b"], // b is selected, dragging a (unselected)
      getViewport: () => null,
      requestSync: vi.fn(),
      onRowOrderChanged,
      store,
    });
    controller.attach(root);

    const handle = pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 10, clientY: nudgeY(10) }));
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 10, clientY: 90 }));

    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    const evt = onRowOrderChanged.mock.calls[0][0];
    expect(evt.rowId).toBe("a");
    expect(evt.rowIds).toEqual(["a"]);

    controller.detach();
    document.body.removeChild(root);
  });

  it("dragging a selected row with multiple selected moves all selected rows", () => {
    const onRowOrderChanged = vi.fn();
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const pool: PooledRow[] = rows.map((r, i) => {
      const pr = makePoolRow(i, r.id, i * 40, 40);
      document.body.appendChild(pr.element);
      makeHandle(pr.element);
      return pr;
    });
    const root = document.createElement("div");
    pool.forEach((pr) => root.appendChild(pr.element));
    document.body.appendChild(root);
    const store = new RowOrderStore();
    const controller = new RowOrderController({
      getRowDragConfig: () => ({ enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 }),
      getDisplayRows: () => createArrayDisplayRowReader(rows),
      getPool: () => pool,
      resolveRowId: (_, i) => rows[i]!.id,
      getSelectedRowCountForRowOrder: () => 2,
      isRowSelectedForRowOrder: (id) => ["a", "c"].includes(id),
      getSelectedRowIdsForRowOrder: () => ["a", "c"], // two selected
      getViewport: () => null,
      requestSync: vi.fn(),
      onRowOrderChanged,
      store,
    });
    controller.attach(root);

    // Drag from handle on row "a" (which is selected)
    const handle = pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 10, clientY: nudgeY(10) }));
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 10, clientY: 170 })); // past row c

    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    const evt = onRowOrderChanged.mock.calls[0][0];
    expect(evt.rowId).toBe("a");
    expect(evt.rowIds).toEqual(["a", "c"]); // both selected rows in data order

    controller.detach();
    document.body.removeChild(root);
  });

  it("applies lfg-row-drag-source to all visible moving rows during drag", () => {
    const mounted = mountMultiRowController(4, ["r0", "r2"]);

    // Drag r0 (selected), so r0 and r2 should both get drag-source class
    const handle = mounted.pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 10, clientY: nudgeY(10) }));

    expect(mounted.pool[0]!.element.classList.contains("lfg-row-drag-source")).toBe(true);
    expect(mounted.pool[2]!.element.classList.contains("lfg-row-drag-source")).toBe(true);
    // Non-moving rows should not have drag-source
    expect(mounted.pool[1]!.element.classList.contains("lfg-row-drag-source")).toBe(false);
    expect(mounted.pool[3]!.element.classList.contains("lfg-row-drag-source")).toBe(false);

    mounted.cleanup();
  });

  it("pointercancel clears drag-source from all moving rows", () => {
    const mounted = mountMultiRowController(4, ["r0", "r2"]);
    const handle = mounted.pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 10, clientY: nudgeY(10) }));
    document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));

    expect(mounted.pool[0]!.element.classList.contains("lfg-row-drag-source")).toBe(false);
    expect(mounted.pool[2]!.element.classList.contains("lfg-row-drag-source")).toBe(false);
    mounted.cleanup();
  });

  it("emits insertionIndex (original drop slot), not store-adjusted toIndex", () => {
    const onRowOrderChanged = vi.fn();
    // 5 rows: a(0,top=0), b(40), c(80), d(120), e(160) — midYs: 20,60,100,140,180
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const pool: PooledRow[] = rows.map((r, i) => {
      const pr = makePoolRow(i, r.id, i * 40, 40);
      document.body.appendChild(pr.element);
      makeHandle(pr.element);
      return pr;
    });
    const root = document.createElement("div");
    pool.forEach((pr) => root.appendChild(pr.element));
    document.body.appendChild(root);
    const store = new RowOrderStore();
    const controller = new RowOrderController({
      getRowDragConfig: () => ({ enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 }),
      getDisplayRows: () => createArrayDisplayRowReader(rows),
      getPool: () => pool,
      resolveRowId: (_, i) => rows[i]!.id,
      getSelectedRowCountForRowOrder: () => 2,
      isRowSelectedForRowOrder: (id) => ["a", "c"].includes(id),
      getSelectedRowIdsForRowOrder: () => ["a", "c"],
      getViewport: () => null,
      requestSync: vi.fn(),
      onRowOrderChanged,
      store,
    });
    controller.attach(root);

    // Drag row "a" (selected along with "c") to just before row "e" (midY=180, pointer at 170)
    // computeRowDropIndex should return 4 (before e)
    const handle = pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 10, clientY: nudgeY(10) }));
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 10, clientY: 170 }));

    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    const evt = onRowOrderChanged.mock.calls[0][0];
    expect(evt.insertionIndex).toBe(4);
    expect(evt).not.toHaveProperty("toIndex");

    controller.detach();
    document.body.removeChild(root);
  });
});

// ─── Deferred row scan ──────────────────────────────────────────────────────

describe("RowOrderController – deferred row scan", () => {
  function makeDeps(overrides: Partial<{
    rows: { id: string }[];
    pool: PooledRow[];
    root: HTMLDivElement;
    sel: string[];
    maxCount: number;
    maxRatio: number;
    getDisplayRows: () => DisplayRowReader;
    resolveRowId: (r: unknown, i: number) => string;
    getSelectedRowCountForRowOrder: () => number;
    isRowSelectedForRowOrder: (id: string) => boolean;
    getSelectedRowIdsForRowOrder: () => string[];
    onRowOrderChanged: (e: RowOrderMoveRequest) => void;
  }> = {}) {
    const rows = overrides.rows ?? [{ id: "a" }, { id: "b" }, { id: "c" }];
    const root = overrides.root ?? document.createElement("div");
    if (!root.parentElement) document.body.appendChild(root);
    const pool = overrides.pool ?? rows.map((r, i) => {
      const pr = makePoolRow(i, r.id, i * 40, 40);
      root.appendChild(pr.element);
      makeHandle(pr.element);
      return pr;
    });
    const sel = overrides.sel ?? [];
    const store = new RowOrderStore();
    const getDisplayRows = overrides.getDisplayRows ?? vi.fn(() => createArrayDisplayRowReader(rows));
    const resolveRowId = overrides.resolveRowId ?? vi.fn((_: unknown, i: number) => rows[i]!.id);
    const getSelectedRowCountForRowOrder = overrides.getSelectedRowCountForRowOrder ?? vi.fn(() => sel.length);
    const isRowSelectedForRowOrder = overrides.isRowSelectedForRowOrder ?? vi.fn((id: string) => sel.includes(id));
    const getSelectedRowIdsForRowOrder = overrides.getSelectedRowIdsForRowOrder ?? vi.fn(() => sel);
    const controller = new RowOrderController({
      getRowDragConfig: () => ({
        enabled: true,
        managed: true,
        maxMultiRowDragCount: overrides.maxCount ?? 1000,
        maxMultiRowDragRatio: overrides.maxRatio ?? 0.5,
      }),
      getDisplayRows,
      getPool: () => pool,
      resolveRowId: resolveRowId as (r: RowData, i: number) => string,
      getSelectedRowCountForRowOrder,
      isRowSelectedForRowOrder,
      getSelectedRowIdsForRowOrder,
      getViewport: () => null,
      requestSync: vi.fn(),
      onRowOrderChanged: overrides.onRowOrderChanged,
      store,
    });
    controller.attach(root);
    const handle = pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;

    return {
      root,
      pool,
      rows,
      store,
      controller,
      handle,
      getDisplayRows,
      resolveRowId,
      getSelectedRowCountForRowOrder,
      isRowSelectedForRowOrder,
      getSelectedRowIdsForRowOrder,
      cleanup: () => {
        controller.detach();
        if (root.parentElement) root.parentElement.removeChild(root);
      },
    };
  }

  it("pointerdown does NOT call getDisplayRows, resolveRowId, or selection methods", () => {
    const d = makeDeps({ sel: ["a"] });

    d.handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10,
    }));

    expect(d.getDisplayRows).not.toHaveBeenCalled();
    expect(d.resolveRowId).not.toHaveBeenCalled();
    expect(d.getSelectedRowCountForRowOrder).not.toHaveBeenCalled();
    expect(d.isRowSelectedForRowOrder).not.toHaveBeenCalled();
    expect(d.getSelectedRowIdsForRowOrder).not.toHaveBeenCalled();

    d.cleanup();
  });

  it("crossing drag threshold calls resolveRowId exactly once per row", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}` }));
    const d = makeDeps({ rows, sel: ["r0", "r5"] });

    d.handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10,
    }));
    expect(d.resolveRowId).not.toHaveBeenCalled();

    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: nudgeY(10),
    }));
    expect(d.resolveRowId).toHaveBeenCalledTimes(100);

    d.cleanup();
  });

  it("pointerdown then pointerup without threshold does no row scan and no warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = makeDeps({ sel: ["a", "b", "c"], maxCount: 1 });

    d.handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10,
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, clientX: 10, clientY: 10,
    }));

    expect(d.getDisplayRows).not.toHaveBeenCalled();
    expect(d.resolveRowId).not.toHaveBeenCalled();
    const warnCalls = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("Multi-row drag"),
    );
    expect(warnCalls.length).toBe(0);

    warnSpy.mockRestore();
    d.cleanup();
  });

  it("guardrail warning fires only after threshold crossing, not on pointerdown", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = makeDeps({ sel: ["a", "b", "c"], maxCount: 1 });

    d.handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10,
    }));
    const warnCallsBefore = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("Multi-row drag"),
    );
    expect(warnCallsBefore.length).toBe(0);

    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: nudgeY(10),
    }));
    const warnCallsAfter = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("Multi-row drag"),
    );
    expect(warnCallsAfter.length).toBe(1);

    warnSpy.mockRestore();
    d.cleanup();
  });

  it("guardrail warning fires once per controller across multiple drags", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = makeDeps({ sel: ["a", "b", "c"], maxCount: 2, maxRatio: 0.9 });

    // First drag: pointerdown → threshold → pointerup
    d.handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: nudgeY(10),
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, clientX: 10, clientY: nudgeY(10),
    }));

    // Second drag
    d.handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 2, button: 0, clientX: 10, clientY: 10,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 2, clientX: 10, clientY: nudgeY(10),
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 2, clientX: 10, clientY: nudgeY(10),
    }));

    const warnCalls = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("Multi-row drag reduced"),
    );
    expect(warnCalls.length).toBe(1);

    warnSpy.mockRestore();
    d.cleanup();
  });

  it("does not call getSelectedRowIdsForRowOrder when guardrail blocks", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getSelectedRowIdsForRowOrder = vi.fn(() => ["a", "b", "c"]);
    const d = makeDeps({
      sel: ["a", "b", "c"],
      maxCount: 1,
      maxRatio: 0.9,
      getSelectedRowIdsForRowOrder,
    });

    d.handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: nudgeY(10),
    }));

    expect(getSelectedRowIdsForRowOrder).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    d.cleanup();
  });

  it("cancels drag cleanly if rowId not found during prepareDragRows", () => {
    const onRowOrderChanged = vi.fn();
    const rows = [{ id: "x" }, { id: "y" }];
    const root = document.createElement("div");
    document.body.appendChild(root);
    const pool = rows.map((r, i) => {
      const pr = makePoolRow(i, r.id, i * 40, 40);
      root.appendChild(pr.element);
      makeHandle(pr.element);
      return pr;
    });
    // Override data-row-id to "missing" so resolveRowId won't find it
    pool[0]!.element.setAttribute("data-row-id", "missing");
    const store = new RowOrderStore();
    const controller = new RowOrderController({
      getRowDragConfig: () => ({
        enabled: true,
        managed: true,
        maxMultiRowDragCount: 1000,
        maxMultiRowDragRatio: 0.5,
      }),
      getDisplayRows: () => createArrayDisplayRowReader(rows),
      getPool: () => pool,
      resolveRowId: (_, i) => rows[i]!.id,
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      getViewport: () => null,
      requestSync: vi.fn(),
      onRowOrderChanged,
      store,
    });
    controller.attach(root);

    const handle = pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`) as HTMLElement;
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: nudgeY(10),
    }));

    expect(root.classList.contains("lfg-row-dragging")).toBe(false);
    expect(onRowOrderChanged).not.toHaveBeenCalled();

    controller.detach();
    document.body.removeChild(root);
  });

  it("normal single-row drag still works end-to-end", () => {
    const onRowOrderChanged = vi.fn();
    const d = makeDeps({ onRowOrderChanged });

    d.handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: nudgeY(10),
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, clientX: 10, clientY: 90,
    }));

    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    const evt = onRowOrderChanged.mock.calls[0][0];
    expect(evt.rowId).toBe("a");
    expect(evt.fromIndex).toBe(0);
    expect(evt.source).toBe("drag");

    d.cleanup();
  });

  it("normal multi-row drag still works end-to-end", () => {
    const onRowOrderChanged = vi.fn();
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const d = makeDeps({ rows, sel: ["a", "c"], onRowOrderChanged });

    d.handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: nudgeY(10),
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, clientX: 10, clientY: 170,
    }));

    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    expect(onRowOrderChanged.mock.calls[0][0].rowIds).toEqual(["a", "c"]);

    d.cleanup();
  });

  it("falls back to single-row when maxMultiRowDragCount exceeded", () => {
    const onRowOrderChanged = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = makeDeps({
      sel: ["a", "b", "c"],
      maxCount: 2,
      maxRatio: 0.9,
      onRowOrderChanged,
    });

    d.handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: nudgeY(10),
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, clientX: 10, clientY: 130,
    }));

    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    expect(onRowOrderChanged.mock.calls[0][0].rowIds).toEqual(["a"]);

    warnSpy.mockRestore();
    d.cleanup();
  });

  it("falls back to single-row when maxMultiRowDragRatio exceeded", () => {
    const onRowOrderChanged = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const d = makeDeps({
      rows,
      sel: ["a", "b", "c"], // 3/4 = 0.75 > 0.5
      onRowOrderChanged,
    });

    d.handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: nudgeY(10),
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, clientX: 10, clientY: 130,
    }));

    expect(onRowOrderChanged).toHaveBeenCalledOnce();
    expect(onRowOrderChanged.mock.calls[0][0].rowIds).toEqual(["a"]);

    warnSpy.mockRestore();
    d.cleanup();
  });
});

// ─── isReorderBlocked ───────────────────────────────────────────────────────

describe("RowOrderController blocked state", () => {
  function mountBlockedController(blocked: boolean) {
    const root = document.createElement("div");
    root.className = "lfg-grid";
    const viewport = document.createElement("div");
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 400, left: 0, right: 200, width: 200, height: 400,
      x: 0, y: 0, toJSON: () => "",
    } as DOMRect);
    root.appendChild(viewport);
    document.body.appendChild(root);

    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` }));
    const pool: PooledRow[] = rows.map((r, i) => {
      const pr = makePoolRow(i, r.id, i * 40, 40);
      root.appendChild(pr.element);
      makeHandle(pr.element);
      return pr;
    });

    let isBlocked = blocked;
    const store = new RowOrderStore();
    const onRowOrderChanged = vi.fn();
    const controller = new RowOrderController({
      getRowDragConfig: () => ({ enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 }),
      isReorderBlocked: () => isBlocked,
      getDisplayRows: () => createArrayDisplayRowReader(rows),
      getPool: () => pool,
      resolveRowId: (_, i) => rows[i]!.id,
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      getViewport: () => viewport,
      requestSync: vi.fn(),
      onRowOrderChanged,
      store,
    });
    controller.attach(root);

    return {
      root,
      controller,
      pool,
      onRowOrderChanged,
      setBlocked: (v: boolean) => { isBlocked = v; },
      cleanup: () => {
        controller.detach();
        document.body.removeChild(root);
      },
    };
  }

  it("syncConfig adds lfg-row-drag-blocked and removes lfg-row-drag-enabled when blocked", () => {
    const d = mountBlockedController(true);
    expect(d.root.classList.contains(ROW_DRAG_BLOCKED_CLASS)).toBe(true);
    expect(d.root.classList.contains(ROW_DRAG_ENABLED_CLASS)).toBe(false);
    d.cleanup();
  });

  it("syncConfig restores lfg-row-drag-enabled when unblocked", () => {
    const d = mountBlockedController(true);
    expect(d.root.classList.contains(ROW_DRAG_BLOCKED_CLASS)).toBe(true);

    d.setBlocked(false);
    d.controller.syncConfig();
    expect(d.root.classList.contains(ROW_DRAG_ENABLED_CLASS)).toBe(true);
    expect(d.root.classList.contains(ROW_DRAG_BLOCKED_CLASS)).toBe(false);
    d.cleanup();
  });

  it("pointerdown on drag handle does not start drag when blocked", () => {
    const d = mountBlockedController(true);
    const handle = d.pool[2]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`)!;

    handle.dispatchEvent(new PointerEvent("pointerdown", {
      pointerId: 1, clientX: 10, clientY: 90, button: 0, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: nudgeY(90),
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, clientX: 10, clientY: 130,
    }));

    expect(d.onRowOrderChanged).not.toHaveBeenCalled();
    expect(d.root.classList.contains("lfg-row-dragging")).toBe(false);
    d.cleanup();
  });

  it("no row order commit fires while blocked", () => {
    const d = mountBlockedController(true);
    const handle = d.pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`)!;

    handle.dispatchEvent(new PointerEvent("pointerdown", {
      pointerId: 1, clientX: 10, clientY: 10, button: 0, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: nudgeY(10),
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, clientX: 10, clientY: 170,
    }));

    expect(d.onRowOrderChanged).not.toHaveBeenCalled();
    d.cleanup();
  });

  it("drag works normally after unblocking", () => {
    const d = mountBlockedController(true);

    d.setBlocked(false);
    d.controller.syncConfig();

    const handle = d.pool[0]!.element.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`)!;
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      pointerId: 1, clientX: 10, clientY: 10, button: 0, bubbles: true,
    }));
    document.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: 1, clientX: 10, clientY: nudgeY(10),
    }));
    document.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 1, clientX: 10, clientY: 130,
    }));

    expect(d.onRowOrderChanged).toHaveBeenCalledOnce();
    d.cleanup();
  });
});

describe("RowOrderController keyboard command", () => {
  it("180: accepts adjacent managed movement in O(1) and defers row reads", async () => {
    const rows: RowData[] = [{ id: "r0" }, { id: "r1" }, { id: "r2" }];
    const getDisplayRows = vi.fn(() => createArrayDisplayRowReader(rows));
    const requestSync = vi.fn();
    const onRowOrderChanged = vi.fn();
    const controller = new RowOrderController({
      getRowDragConfig: () => ({
        enabled: true,
        managed: true,
        maxMultiRowDragCount: 1000,
        maxMultiRowDragRatio: 0.5,
      }),
      getDisplayRows,
      getPool: () => [],
      resolveRowId: (row) => String(row.id),
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      requestSync,
      onRowOrderChanged,
      store: new RowOrderStore(),
    });

    expect(controller.moveRowFromCommand(1, 2)).toBe(true);
    expect(controller.moveRowFromCommand(1, 1)).toBe(false);
    expect(getDisplayRows).not.toHaveBeenCalled();
    expect(requestSync).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(getDisplayRows).toHaveBeenCalledOnce();
    expect(requestSync).toHaveBeenCalledOnce();
    expect(onRowOrderChanged).toHaveBeenCalledWith({
      rowId: "r1",
      rowIds: ["r1"],
      fromIndex: 1,
      fromIndices: [1],
      insertionIndex: 3,
      source: "keyboard",
    });
  });

  it("180: unmanaged row movement stays outside keyboard ownership", () => {
    const getDisplayRows = vi.fn(() => createArrayDisplayRowReader([]));
    const controller = new RowOrderController({
      getRowDragConfig: () => ({
        enabled: true,
        managed: false,
        maxMultiRowDragCount: 1000,
        maxMultiRowDragRatio: 0.5,
      }),
      getDisplayRows,
      getPool: () => [],
      resolveRowId: () => "row",
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      requestSync: vi.fn(),
      store: new RowOrderStore(),
    });

    expect(controller.moveRowFromCommand(0, 1)).toBe(false);
    expect(getDisplayRows).not.toHaveBeenCalled();
  });
});
