// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PooledCell } from "../../../internal/poolTypes";
import type { DisplayRowReader } from "../../../rendering/rowViewAccess";
import type {
  CellShellConfig,
  CellShellOverlayRenderContext,
  CellShellOverlayRenderer,
  ColumnDef,
  LightFastGridCellShellActionEvent,
  RowData,
} from "../../../types";
import { CellShellActionController } from "../CellShellActionController";
import { bindCellShell } from "../CellShellManager";
import { CellShellOverlayController } from "../CellShellOverlayController";

const ROWS: RowData[] = [{ id: "r1", col: "hello" }];

function reader(rows: RowData[]): DisplayRowReader {
  return {
    get rowCount() {
      return rows.length;
    },
    getRowData: (i) => rows[i],
    getSourceIndex: (i) => i,
    getRow: (i) => {
      const row = rows[i];
      return row ? { displayIndex: i, sourceIndex: i, row } : null;
    },
  };
}

function buildTree(
  config: CellShellConfig,
  column?: ColumnDef,
): {
  root: HTMLElement;
  cell: PooledCell;
  shellRoot: HTMLElement;
  column: ColumnDef;
} {
  const col: ColumnDef = column ?? { field: "col", cellShell: config };
  const root = document.createElement("div");

  const rowEl = document.createElement("div");
  rowEl.className = "lfg-row";
  rowEl.setAttribute("data-row-id", "r1");
  rowEl.setAttribute("data-row-index", "0");

  const cellEl = document.createElement("div");
  cellEl.className = "lfg-cell";
  cellEl.setAttribute("data-col-id", "col");

  const cell: PooledCell = { element: cellEl, value: "" };
  bindCellShell(
    cell,
    {
      row: ROWS[0]!,
      rowId: "r1",
      rowIndex: 0,
      column: col,
      field: "col",
      value: "hello",
      formattedValue: "hello",
    },
    config,
  );

  rowEl.appendChild(cellEl);
  root.appendChild(rowEl);

  // FloatingController needs a positioned parent in the DOM.
  root.style.position = "relative";
  document.body.appendChild(root);

  return { root, cell, shellRoot: cell.shellRoot!, column: col };
}

function makeOverlayController(
  root: HTMLElement,
  column: ColumnDef,
  registry: Record<string, CellShellOverlayRenderer>,
): CellShellOverlayController {
  const viewport = root;
  const controller = new CellShellOverlayController({
    getColumns: () => [column],
    getDisplayRows: () => reader(ROWS),
    resolveRowId: (row) => (row as { id: string }).id,
    getCellShellOverlays: () => registry,
  });
  controller.attach(root, viewport);
  return controller;
}

function makeActionController(
  root: HTMLElement,
  onCellShellAction: (e: LightFastGridCellShellActionEvent) => void,
): CellShellActionController {
  const controller = new CellShellActionController({
    getColumns: () => [{ field: "col" }],
    getDisplayRows: () => reader(ROWS),
    resolveRowId: (row) => (row as { id: string }).id,
    onCellShellAction,
  });
  controller.attach(root);
  return controller;
}

function spyRenderer(): CellShellOverlayRenderer & {
  calls: CellShellOverlayRenderContext[];
  cleanup: ReturnType<typeof vi.fn>;
} {
  const cleanup = vi.fn();
  const calls: CellShellOverlayRenderContext[] = [];
  return {
    kind: "cell-shell-overlay",
    render(ctx) {
      calls.push(ctx);
      const el = document.createElement("div");
      el.className = "test-overlay-content";
      el.textContent = `Overlay: ${ctx.overlayKey}`;
      ctx.host.appendChild(el);
      return () => cleanup();
    },
    calls,
    cleanup,
  };
}

function clickLeft(el: Element): MouseEvent {
  const ev = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  el.dispatchEvent(ev);
  return ev;
}

function pointerOver(el: Element, relatedTarget?: Element | null): void {
  el.dispatchEvent(
    new PointerEvent("pointerover", {
      bubbles: true,
      pointerType: "mouse",
      relatedTarget: relatedTarget ?? null,
    }),
  );
}

function pointerOut(el: Element, relatedTarget?: Element | null): void {
  el.dispatchEvent(
    new PointerEvent("pointerout", {
      bubbles: true,
      pointerType: "mouse",
      relatedTarget: relatedTarget ?? null,
    }),
  );
}

describe("CellShellOverlayController", () => {
  // ── overlay attrs gating ──────────────────────────────────────────

  it("button with overlay writes data-overlay-key and data-overlay-trigger", () => {
    const { shellRoot } = buildTree({
      kind: "button",
      overlay: { key: "details" },
      text: { literal: "Open" },
    });
    expect(shellRoot.getAttribute("data-overlay-key")).toBe("details");
    expect(shellRoot.getAttribute("data-overlay-trigger")).toBe("click");
  });

  it("iconButton with overlay writes overlay attrs", () => {
    const { shellRoot } = buildTree({
      kind: "iconButton",
      overlay: { key: "info", trigger: "click" },
      icon: "ℹ",
    });
    expect(shellRoot.getAttribute("data-overlay-key")).toBe("info");
  });

  it("link with overlay writes overlay attrs", () => {
    const { shellRoot } = buildTree({
      kind: "link",
      overlay: { key: "preview" },
      text: { literal: "Preview" },
    });
    expect(shellRoot.getAttribute("data-overlay-key")).toBe("preview");
  });

  it("badge with overlay does NOT write overlay attrs", () => {
    const { shellRoot } = buildTree({
      kind: "badge",
      overlay: { key: "nope" },
    });
    expect(shellRoot.hasAttribute("data-overlay-key")).toBe(false);
    expect(shellRoot.hasAttribute("data-overlay-trigger")).toBe(false);
  });

  it("progress with overlay does NOT write overlay attrs", () => {
    const { shellRoot } = buildTree({
      kind: "progress",
      overlay: { key: "nope" },
    });
    expect(shellRoot.hasAttribute("data-overlay-key")).toBe(false);
  });

  it("rebinding from button+overlay to badge+same overlay removes stale attrs", () => {
    const cell: PooledCell = {
      element: document.createElement("div"),
      value: "",
    };
    const params = {
      row: ROWS[0]!,
      rowId: "r1",
      rowIndex: 0,
      column: { field: "col" } as ColumnDef,
      field: "col",
      value: "hello",
      formattedValue: "hello",
    };
    bindCellShell(cell, params, {
      kind: "button",
      overlay: { key: "details" },
      text: { literal: "Open" },
    });
    expect(cell.shellRoot!.getAttribute("data-overlay-key")).toBe("details");

    bindCellShell(cell, params, {
      kind: "badge",
      overlay: { key: "details" },
    });
    expect(cell.shellRoot!.hasAttribute("data-overlay-key")).toBe(false);
    expect(cell.shellRoot!.hasAttribute("data-overlay-trigger")).toBe(false);
  });

  it("hover trigger writes data-overlay-trigger='hover'", () => {
    const { shellRoot } = buildTree({
      kind: "button",
      overlay: { key: "info", trigger: "hover" },
      text: { literal: "Hover me" },
    });
    expect(shellRoot.getAttribute("data-overlay-trigger")).toBe("hover");
  });

  // ── click opens overlay ───────────────────────────────────────────

  it("click opens overlay with correct context", () => {
    const config: CellShellConfig = {
      kind: "button",
      overlay: { key: "details" },
      text: { literal: "Open" },
    };
    const { root, shellRoot, column } = buildTree(config);
    const renderer = spyRenderer();
    const controller = makeOverlayController(root, column, {
      details: renderer,
    });

    clickLeft(shellRoot);

    expect(renderer.calls).toHaveLength(1);
    const ctx = renderer.calls[0]!;
    expect(ctx.overlayKey).toBe("details");
    expect(ctx.rowId).toBe("r1");
    expect(ctx.rowIndex).toBe(0);
    expect(ctx.field).toBe("col");
    expect(ctx.column).toBe(column);
    expect(ctx.row).toBe(ROWS[0]);
    expect(ctx.value).toBe("hello");
    expect(ctx.formattedValue).toBe("hello");
    expect(ctx.anchor).toBe(shellRoot);
    expect(ctx.originalEvent).toBeInstanceOf(MouseEvent);
    expect(typeof ctx.close).toBe("function");

    controller.detach();
  });

  // ── clicking another trigger closes previous overlay ──────────────

  it("clicking another overlay trigger closes previous overlay", () => {
    const config: CellShellConfig = {
      kind: "button",
      overlay: { key: "details" },
      text: { literal: "Open" },
    };
    const col: ColumnDef = { field: "col", cellShell: config };
    const root = document.createElement("div");
    root.style.position = "relative";

    // Row 1
    const row1El = document.createElement("div");
    row1El.className = "lfg-row";
    row1El.setAttribute("data-row-id", "r1");
    row1El.setAttribute("data-row-index", "0");
    const cell1El = document.createElement("div");
    cell1El.className = "lfg-cell";
    cell1El.setAttribute("data-col-id", "col");
    const cell1: PooledCell = { element: cell1El, value: "" };
    bindCellShell(
      cell1,
      {
        row: ROWS[0]!,
        rowId: "r1",
        rowIndex: 0,
        column: col,
        field: "col",
        value: "hello",
        formattedValue: "hello",
      },
      config,
    );
    row1El.appendChild(cell1El);
    root.appendChild(row1El);

    // Row 2
    const rows2: RowData[] = [
      { id: "r1", col: "hello" },
      { id: "r2", col: "world" },
    ];
    const row2El = document.createElement("div");
    row2El.className = "lfg-row";
    row2El.setAttribute("data-row-id", "r2");
    row2El.setAttribute("data-row-index", "1");
    const cell2El = document.createElement("div");
    cell2El.className = "lfg-cell";
    cell2El.setAttribute("data-col-id", "col");
    const cell2: PooledCell = { element: cell2El, value: "" };
    bindCellShell(
      cell2,
      {
        row: rows2[1]!,
        rowId: "r2",
        rowIndex: 1,
        column: col,
        field: "col",
        value: "world",
        formattedValue: "world",
      },
      config,
    );
    row2El.appendChild(cell2El);
    root.appendChild(row2El);
    document.body.appendChild(root);

    const renderer = spyRenderer();
    const controller = new CellShellOverlayController({
      getColumns: () => [col],
      getDisplayRows: () => reader(rows2),
      resolveRowId: (row) => (row as { id: string }).id,
      getCellShellOverlays: () => ({ details: renderer }),
    });
    controller.attach(root, root);

    clickLeft(cell1.shellRoot!);
    expect(renderer.calls).toHaveLength(1);
    expect(controller.isOpen()).toBe(true);

    // Click another overlay trigger — previous should be cleaned up
    clickLeft(cell2.shellRoot!);
    expect(renderer.calls).toHaveLength(2);
    expect(renderer.cleanup).toHaveBeenCalledTimes(1);
    expect(controller.isOpen()).toBe(true);

    controller.detach();
  });

  // ── scroll closes overlay ─────────────────────────────────────────

  it("scroll closes overlay when closeOnScroll is default (true)", () => {
    const config: CellShellConfig = {
      kind: "button",
      overlay: { key: "details" },
      text: { literal: "Open" },
    };
    const { root, shellRoot, column } = buildTree(config);
    const renderer = spyRenderer();
    const controller = makeOverlayController(root, column, {
      details: renderer,
    });

    clickLeft(shellRoot);
    expect(controller.isOpen()).toBe(true);

    // Simulate scroll on the viewport (root is used as viewport in test)
    root.dispatchEvent(new Event("scroll"));
    expect(controller.isOpen()).toBe(false);
    expect(renderer.cleanup).toHaveBeenCalledTimes(1);

    controller.detach();
  });

  it("closeOnScroll: false keeps overlay open on scroll", () => {
    const config: CellShellConfig = {
      kind: "button",
      overlay: { key: "details", closeOnScroll: false },
      text: { literal: "Open" },
    };
    const { root, shellRoot, column } = buildTree(config);
    const renderer = spyRenderer();
    const controller = makeOverlayController(root, column, {
      details: renderer,
    });

    clickLeft(shellRoot);
    expect(controller.isOpen()).toBe(true);

    root.dispatchEvent(new Event("scroll"));
    // closeOnScroll: false → overlay stays open (reposition via RAF)
    expect(controller.isOpen()).toBe(true);

    controller.detach();
  });

  // ── selection safety ──────────────────────────────────────────────

  it("overlay trigger click does not reach later root listeners (selection)", () => {
    const config: CellShellConfig = {
      kind: "button",
      overlay: { key: "details" },
      text: { literal: "Open" },
    };
    const { root, shellRoot, column } = buildTree(config);
    const renderer = spyRenderer();
    // Overlay controller registered first (no actionKey on shell)
    makeOverlayController(root, column, { details: renderer });
    // Selection stand-in
    const selectionSpy = vi.fn();
    root.addEventListener("click", selectionSpy);

    clickLeft(shellRoot);

    expect(renderer.calls).toHaveLength(1);
    expect(selectionSpy).not.toHaveBeenCalled();
  });

  // ── actionKey + overlay: overlay opens first, then action fires ─────

  it("actionKey + overlay: overlay opens first, then action callback fires", () => {
    const config: CellShellConfig = {
      kind: "button",
      actionKey: "edit",
      overlay: { key: "details" },
      text: { literal: "Edit" },
    };
    const col: ColumnDef = { field: "col", cellShell: config };
    const { root, shellRoot } = buildTree(config, col);
    const renderer = spyRenderer();
    const callOrder: string[] = [];

    // Overlay controller is registered FIRST (mirrors registry order)
    makeOverlayController(root, col, { details: renderer });

    // Action controller is registered SECOND
    const actionSpy = vi.fn(() => callOrder.push("action"));
    makeActionController(root, actionSpy);

    // Override renderer to track order
    const origRender = renderer.render.bind(renderer);
    renderer.render = (ctx) => {
      callOrder.push("overlay");
      return origRender(ctx);
    };

    clickLeft(shellRoot);

    // Overlay fires first (registered first), then action fires
    expect(callOrder).toEqual(["overlay", "action"]);
    expect(renderer.calls).toHaveLength(1);
    expect(actionSpy).toHaveBeenCalledTimes(1);
  });

  // ── no per-cell listeners ─────────────────────────────────────────

  it("creates no per-cell listeners when shells are built", () => {
    const cellEl = document.createElement("div");
    const addSpy = vi.spyOn(cellEl, "addEventListener");
    const cell: PooledCell = { element: cellEl, value: "" };

    bindCellShell(
      cell,
      {
        row: ROWS[0]!,
        rowId: "r1",
        rowIndex: 0,
        column: { field: "col" },
        field: "col",
        value: "hello",
        formattedValue: "hello",
      },
      {
        kind: "button",
        overlay: { key: "details" },
        text: { literal: "Open" },
      },
    );

    expect(addSpy).not.toHaveBeenCalled();
  });

  // ── close() API ───────────────────────────────────────────────────

  it("close() programmatically closes an open overlay", () => {
    const config: CellShellConfig = {
      kind: "button",
      overlay: { key: "details" },
      text: { literal: "Open" },
    };
    const { root, shellRoot, column } = buildTree(config);
    const renderer = spyRenderer();
    const controller = makeOverlayController(root, column, {
      details: renderer,
    });

    clickLeft(shellRoot);
    expect(controller.isOpen()).toBe(true);

    // Use the close() from the render context
    renderer.calls[0]!.close();
    expect(controller.isOpen()).toBe(false);
    expect(renderer.cleanup).toHaveBeenCalledTimes(1);

    controller.detach();
  });

  // ── no overlay opened when registry has no matching key ───────────

  it("does not open overlay when registry has no matching key", () => {
    const config: CellShellConfig = {
      kind: "button",
      overlay: { key: "missing" },
      text: { literal: "Open" },
    };
    const { root, shellRoot, column } = buildTree(config);
    const renderer = spyRenderer();
    // Registry has "details" but shell references "missing"
    const controller = makeOverlayController(root, column, {
      details: renderer,
    });

    clickLeft(shellRoot);

    expect(renderer.calls).toHaveLength(0);
    expect(controller.isOpen()).toBe(false);

    controller.detach();
  });

  // ── detach removes listener ───────────────────────────────────────

  it("detach removes the delegated listener", () => {
    const config: CellShellConfig = {
      kind: "button",
      overlay: { key: "details" },
      text: { literal: "Open" },
    };
    const { root, shellRoot, column } = buildTree(config);
    const renderer = spyRenderer();
    const controller = makeOverlayController(root, column, {
      details: renderer,
    });

    controller.detach();
    clickLeft(shellRoot);

    expect(renderer.calls).toHaveLength(0);
  });

  // ── click does not open hover-trigger overlay ─────────────────────

  it("click does not open a hover-trigger overlay", () => {
    const config: CellShellConfig = {
      kind: "button",
      overlay: { key: "details", trigger: "hover" },
      text: { literal: "Hover me" },
    };
    const { root, shellRoot, column } = buildTree(config);
    const renderer = spyRenderer();
    const controller = makeOverlayController(root, column, {
      details: renderer,
    });

    clickLeft(shellRoot);
    expect(renderer.calls).toHaveLength(0);
    expect(controller.isOpen()).toBe(false);

    controller.detach();
  });

  // ── Hover-trigger tests ───────────────────────────────────────────

  describe("hover trigger", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not open immediately before open delay", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover" },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      expect(controller.isOpen()).toBe(false);
      expect(renderer.calls).toHaveLength(0);

      // Advance partway but not to default 120ms
      vi.advanceTimersByTime(100);
      expect(controller.isOpen()).toBe(false);

      controller.detach();
    });

    it("opens after open delay with correct context", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover" },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      vi.advanceTimersByTime(120);

      expect(controller.isOpen()).toBe(true);
      expect(renderer.calls).toHaveLength(1);
      const ctx = renderer.calls[0]!;
      expect(ctx.overlayKey).toBe("details");
      expect(ctx.rowId).toBe("r1");
      expect(ctx.field).toBe("col");
      expect(ctx.value).toBe("hello");

      controller.detach();
    });

    it("respects custom hoverOpenDelayMs", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover", hoverOpenDelayMs: 300 },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      vi.advanceTimersByTime(200);
      expect(controller.isOpen()).toBe(false);

      vi.advanceTimersByTime(100);
      expect(controller.isOpen()).toBe(true);

      controller.detach();
    });

    it("pointerout schedules close after close delay", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover" },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      vi.advanceTimersByTime(120);
      expect(controller.isOpen()).toBe(true);

      pointerOut(shellRoot);
      // Still open during close delay (default 180ms)
      vi.advanceTimersByTime(100);
      expect(controller.isOpen()).toBe(true);

      vi.advanceTimersByTime(80);
      expect(controller.isOpen()).toBe(false);
      expect(renderer.cleanup).toHaveBeenCalledTimes(1);

      controller.detach();
    });

    it("re-enter before close delay prevents close", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover" },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      vi.advanceTimersByTime(120);
      expect(controller.isOpen()).toBe(true);

      pointerOut(shellRoot);
      vi.advanceTimersByTime(100);
      expect(controller.isOpen()).toBe(true);

      // Re-enter the anchor
      pointerOver(shellRoot);
      // Wait past remaining close delay
      vi.advanceTimersByTime(200);
      expect(controller.isOpen()).toBe(true);
      expect(renderer.cleanup).not.toHaveBeenCalled();

      controller.detach();
    });

    it("moving from anchor to overlay host keeps overlay open", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover" },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      vi.advanceTimersByTime(120);
      expect(controller.isOpen()).toBe(true);

      // The overlay host is inside the floating layer
      const overlayHost = root.querySelector(".lfg-floating")!;
      expect(overlayHost).toBeTruthy();

      // pointerout from anchor with relatedTarget = overlay host
      pointerOut(shellRoot, overlayHost as Element);
      // No close timer should fire because relatedTarget is the overlay host
      vi.advanceTimersByTime(500);
      expect(controller.isOpen()).toBe(true);

      controller.detach();
    });

    it("scroll closes hover overlay when closeOnScroll is default true", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover" },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      vi.advanceTimersByTime(120);
      expect(controller.isOpen()).toBe(true);

      root.dispatchEvent(new Event("scroll"));
      expect(controller.isOpen()).toBe(false);
      expect(renderer.cleanup).toHaveBeenCalledTimes(1);

      controller.detach();
    });

    it("closeOnScroll false keeps hover overlay open on scroll", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover", closeOnScroll: false },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      vi.advanceTimersByTime(120);
      expect(controller.isOpen()).toBe(true);

      root.dispatchEvent(new Event("scroll"));
      expect(controller.isOpen()).toBe(true);

      controller.detach();
    });

    it("touch pointer is ignored", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover" },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      shellRoot.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "touch",
        }),
      );
      vi.advanceTimersByTime(500);
      expect(controller.isOpen()).toBe(false);

      controller.detach();
    });

    it("pointerout before open delay cancels open", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover" },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      vi.advanceTimersByTime(50);
      pointerOut(shellRoot);
      vi.advanceTimersByTime(200);

      expect(controller.isOpen()).toBe(false);
      expect(renderer.calls).toHaveLength(0);

      controller.detach();
    });

    it("click overlays still work unchanged alongside hover config", () => {
      const clickConfig: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "click" },
        text: { literal: "Click" },
      };
      const { root, shellRoot, column } = buildTree(clickConfig);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      clickLeft(shellRoot);
      expect(controller.isOpen()).toBe(true);
      expect(renderer.calls).toHaveLength(1);

      controller.detach();
    });

    it("scroll during open delay cancels hover open", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover" },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      vi.advanceTimersByTime(50);
      root.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(200);

      expect(controller.isOpen()).toBe(false);
      expect(renderer.calls).toHaveLength(0);

      controller.detach();
    });

    it("does not open if cell is recycled during open delay", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover" },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      vi.advanceTimersByTime(50);

      // Simulate cell recycling: row id changes
      const rowEl = shellRoot.closest("[data-row-id]")!;
      rowEl.setAttribute("data-row-id", "r999");

      vi.advanceTimersByTime(200);
      expect(controller.isOpen()).toBe(false);
      expect(renderer.calls).toHaveLength(0);

      controller.detach();
    });

    it("hover overlay context has PointerEvent as originalEvent", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover" },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      vi.advanceTimersByTime(120);

      expect(renderer.calls).toHaveLength(1);
      expect(renderer.calls[0]!.originalEvent).toBeInstanceOf(PointerEvent);

      controller.detach();
    });

    it("scroll with closeOnScroll false clears pending open timer but keeps active overlay", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover", closeOnScroll: false },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      // Open the hover overlay
      pointerOver(shellRoot);
      vi.advanceTimersByTime(120);
      expect(controller.isOpen()).toBe(true);

      // Scroll — overlay stays open (closeOnScroll: false)
      root.dispatchEvent(new Event("scroll"));
      expect(controller.isOpen()).toBe(true);

      // But a new hover-over on a different shell won't reuse stale snapshot
      // (pending timers and snapshot were cleared)
      // Verify by hovering the same shell again — it should schedule a fresh open timer
      pointerOut(shellRoot);
      vi.advanceTimersByTime(180);
      expect(controller.isOpen()).toBe(false);

      controller.detach();
    });

    it("scroll during open delay cancels pending open even with closeOnScroll false", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover", closeOnScroll: false },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      vi.advanceTimersByTime(50);
      root.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(200);

      expect(controller.isOpen()).toBe(false);
      expect(renderer.calls).toHaveLength(0);

      controller.detach();
    });

    it("detach clears hover timers", () => {
      const config: CellShellConfig = {
        kind: "button",
        overlay: { key: "details", trigger: "hover" },
        text: { literal: "Hover" },
      };
      const { root, shellRoot, column } = buildTree(config);
      const renderer = spyRenderer();
      const controller = makeOverlayController(root, column, {
        details: renderer,
      });

      pointerOver(shellRoot);
      controller.detach();
      vi.advanceTimersByTime(500);

      expect(renderer.calls).toHaveLength(0);
    });
  });
});
