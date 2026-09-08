// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { MENU_TRIGGER_CLASS } from "../../../features/column-menu/columnMenuDom";
import { FILTER_TRIGGER_CLASS } from "../../../features/filters/dedicatedFilterDom";
import {
  ACTION_CELL_CLASS,
  ACTION_CUSTOM_PANEL_CLASS,
  ACTION_TRIGGER_CLASS,
} from "../../../features/row-actions/rowActionDom";
import {
  ACTION_MENU_ITEM_CLASS,
  ACTION_MENU_PANEL_CLASS,
} from "../../../features/row-actions/rowActionDom";
import { Grid } from "../../../Grid";
import type { PooledCell, PooledRow } from "../../../internal/poolTypes";
import { syncPinnedRowCells } from "../../../rendering/helpers/populateRow";
import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import type {
  ActionCustomCellRenderer,
  ActionMenuCellRenderer,
  CellRendererRegistry,
  ColumnDef,
  RowActionClickContext,
  RowActionRenderContext,
  RowData,
} from "../../../types";
import { RowActionController } from "../RowActionController";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function actionTrigger(root: HTMLElement, rowIndex: number): HTMLButtonElement | null {
  const triggers = Array.from(root.querySelectorAll(`.${ACTION_TRIGGER_CLASS}`));
  for (const t of triggers) {
    if (t.getAttribute("data-row-index") === String(rowIndex)) {
      return t as HTMLButtonElement;
    }
  }
  return null;
}

function actionTriggerFor(
  root: HTMLElement,
  rowIndex: number,
  colId: string,
): HTMLButtonElement | null {
  const triggers = Array.from(root.querySelectorAll(`.${ACTION_TRIGGER_CLASS}`));
  for (const t of triggers) {
    if (
      t.getAttribute("data-row-index") === String(rowIndex) &&
      t.getAttribute("data-col-id") === colId
    ) {
      return t as HTMLButtonElement;
    }
  }
  return null;
}

function actionPanel(root: HTMLElement): HTMLElement | null {
  return root.querySelector(`.${ACTION_MENU_PANEL_CLASS}`) as HTMLElement | null;
}

function floatingHost(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-floating") as HTMLElement | null;
}

function actionItems(root: HTMLElement): HTMLButtonElement[] {
  const panel = actionPanel(root);
  if (!panel) return [];
  return Array.from(panel.querySelectorAll(`.${ACTION_MENU_ITEM_CLASS}`)) as HTMLButtonElement[];
}

function headerMenuTrigger(root: HTMLElement, field: string): HTMLElement | null {
  const cell = root.querySelector(`.lfg-header-cell[data-col-id="${field}"]`);
  return cell?.querySelector(`.${MENU_TRIGGER_CLASS}`) as HTMLElement | null;
}

function makeRenderer(overrides?: Partial<ActionMenuCellRenderer>): ActionMenuCellRenderer {
  return {
    kind: "actions",
    getActions: overrides?.getActions ?? (() => [
      { id: "edit", icon: "✏️", label: "Edit" },
      { id: "delete", icon: "🗑️", label: "Delete" },
    ]),
    onAction: overrides?.onAction ?? (() => {}),
  };
}

function makeCustomRenderer(
  render: (ctx: RowActionRenderContext) => void | (() => void),
): ActionCustomCellRenderer {
  return {
    kind: "actions",
    mode: "custom",
    render,
  };
}

function makeGrid(
  columns: ColumnDef[],
  rows?: RowData[],
  cellRenderers?: CellRendererRegistry,
  opts?: Record<string, unknown>,
) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "400px", width: "800px" });
  document.body.appendChild(container);

  const grid = new Grid({
    rows: rows ?? [
      { id: "r1", name: "Alice", actions: "" },
      { id: "r2", name: "Bob", actions: "" },
      { id: "r3", name: "Carol", actions: "" },
    ] as RowData[],
    columns,
    cellRenderers,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    getRowId: (r: RowData) => (r as { id: string }).id,
    ...opts,
  });
  grid.mount(container);
  return {
    grid,
    container,
    root: () => container.querySelector(".lfg-grid") as HTMLElement,
  };
}

describe("row action cells", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("action column renders trigger buttons", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions", columnMenu: false, sortable: false, resizable: false, reorderable: false },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    expect(actionTrigger(root(), 0)).toBeTruthy();
    expect(actionTrigger(root(), 1)).toBeTruthy();
    expect(actionTrigger(root(), 2)).toBeTruthy();
    const first = actionTrigger(root(), 0)!;
    expect(first.tagName).toBe("BUTTON");
    expect(first.type).toBe("button");
    expect(first.tabIndex).toBe(-1);
    expect(first.getAttribute("role")).toBeNull();
    expect(first.getAttribute("aria-label")).toBe("Row actions");

    grid.destroy();
    container.remove();
  });

  it("normal columns still render text", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    const nameCell = root().querySelector('.lfg-cell[data-col-id="name"]') as HTMLElement;
    expect(nameCell).toBeTruthy();
    expect(nameCell.textContent).toBe("Alice");

    grid.destroy();
    container.remove();
  });

  it("clicking trigger opens dropdown with configured items", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    const trigger = actionTrigger(root(), 0)!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    const items = actionItems(root());
    const panel = actionPanel(root())!;
    expect(panel.getAttribute("role")).toBe("menu");
    expect(panel.getAttribute("aria-label")).toBe("Row actions");
    expect(panel.hasAttribute("aria-modal")).toBe(false);
    expect(panel.id).toMatch(/^lfg-popup-row-action-\d+$/);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    expect(items.length).toBe(2);
    expect(items[0]!.textContent).toContain("Edit");
    expect(items[1]!.textContent).toContain("Delete");
    expect(document.activeElement).toBe(items[0]);

    items[0]!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));
    expect(actionPanel(root())).toBeNull();
    expect(document.activeElement).toBe(trigger);

    grid.destroy();
    container.remove();
  });

  it("clicking item calls onAction with correct context", async () => {
    const onAction = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeRenderer({ onAction }) },
    );
    await flushRenders();

    const trigger = actionTrigger(root(), 1)!;
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    const items = actionItems(root());
    items[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(onAction).toHaveBeenCalledTimes(1);
    const ctx: RowActionClickContext = onAction.mock.calls[0]![0];
    expect(ctx.actionId).toBe("edit");
    expect(ctx.action.id).toBe("edit");
    expect(ctx.rowId).toBe("r2");
    expect(ctx.rowIndex).toBe(1);
    expect((ctx.row as { name: string }).name).toBe("Bob");
    expect(ctx.column.field).toBe("actions");
    expect(typeof ctx.close).toBe("function");
    expect(typeof ctx.grid.getRows).toBe("function");

    grid.destroy();
    container.remove();
  });

  it("hidden actions are not rendered", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      {
        rowActions: makeRenderer({
          getActions: () => [
            { id: "edit", label: "Edit" },
            { id: "secret", label: "Secret", hidden: true },
          ],
        }),
      },
    );
    await flushRenders();

    const trigger = actionTrigger(root(), 0)!;
    trigger.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );

    const items = actionItems(root());
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toContain("Edit");

    grid.destroy();
    container.remove();
  });

  it("disabled actions do not call onAction", async () => {
    const onAction = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      {
        rowActions: makeRenderer({
          getActions: () => [
            { id: "edit", label: "Edit", disabled: true },
          ],
          onAction,
        }),
      },
    );
    await flushRenders();

    const trigger = actionTrigger(root(), 0)!;
    trigger.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );

    const items = actionItems(root());
    expect(items.length).toBe(1);
    expect(items[0]!.hasAttribute("disabled")).toBe(true);

    items[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(onAction).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });

  it("outside click closes dropdown", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    const trigger = actionTrigger(root(), 0)!;
    trigger.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    expect(actionPanel(root())).toBeTruthy();

    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(actionPanel(root())).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("Escape closes dropdown", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    actionTrigger(root(), 0)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    expect(actionPanel(root())).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(actionPanel(root())).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("scroll closes dropdown", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    actionTrigger(root(), 0)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    expect(actionPanel(root())).toBeTruthy();

    // FloatingController listens on scroll container (viewport)
    const viewport = root().querySelector(".lfg-viewport") as HTMLElement;
    viewport.dispatchEvent(new Event("scroll"));
    expect(actionPanel(root())).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("opening another row action closes the previous dropdown", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    actionTrigger(root(), 0)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    expect(actionPanel(root())).toBeTruthy();

    const trigger = actionTrigger(root(), 1)!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );

    // Should only have one panel open
    const panels = root().querySelectorAll(`.${ACTION_MENU_PANEL_CLASS}`);
    expect(panels.length).toBe(1);

    grid.destroy();
    container.remove();
  });

  it("custom mode calls render with host, row, rowIndex, rowId, column, grid, and close", async () => {
    const render = vi.fn((ctx: RowActionRenderContext) => {
      const el = document.createElement("button");
      el.textContent = "Custom action";
      el.addEventListener("click", ctx.close);
      ctx.host.appendChild(el);
    });

    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeCustomRenderer(render) },
    );
    await flushRenders();

    const trigger = actionTrigger(root(), 1)!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );

    expect(render).toHaveBeenCalledTimes(1);
    const ctx = render.mock.calls[0]![0];
    expect(ctx.host.classList.contains(ACTION_CUSTOM_PANEL_CLASS)).toBe(true);
    expect(ctx.host.parentElement).toBe(floatingHost(root()));
    expect(ctx.host.getAttribute("role")).toBe("dialog");
    expect(ctx.host.getAttribute("aria-modal")).toBe("false");
    expect(ctx.host.getAttribute("aria-label")).toBe("Row actions");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(ctx.host.id);
    expect(ctx.row).toEqual({ id: "r2", name: "Bob", actions: "" });
    expect(ctx.rowIndex).toBe(1);
    expect(ctx.rowId).toBe("r2");
    expect(ctx.column.field).toBe("actions");
    expect(ctx.grid.getRows()).toHaveLength(3);
    expect(typeof ctx.close).toBe("function");
    expect(floatingHost(root())!.textContent).toContain("Custom action");
    expect(document.activeElement).toBe(
      ctx.host.querySelector("button"),
    );

    grid.destroy();
    container.remove();
  });

  it("custom mode does not call getActions", async () => {
    const getActions = vi.fn();
    const render = vi.fn((ctx: RowActionRenderContext) => {
      ctx.host.appendChild(document.createElement("div"));
    });

    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      {
        rowActions: {
          kind: "actions",
          mode: "custom",
          getActions,
          render,
        } as unknown as ActionCustomCellRenderer,
      },
    );
    await flushRenders();

    actionTrigger(root(), 0)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );

    expect(render).toHaveBeenCalledTimes(1);
    expect(getActions).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });

  it("custom cleanup runs on close", async () => {
    const cleanup = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      {
        rowActions: makeCustomRenderer((ctx) => {
          ctx.host.appendChild(document.createElement("div"));
          return cleanup;
        }),
      },
    );
    await flushRenders();

    actionTrigger(root(), 0)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    expect(cleanup).not.toHaveBeenCalled();

    actionTrigger(root(), 0)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);

    grid.destroy();
    container.remove();
  });

  it("abandons failed custom popup ownership and permits a clean retry", () => {
    const root = document.createElement("div");
    const viewport = document.createElement("div");
    const trigger = document.createElement("button");
    const row = { id: "r1", actions: "" } as RowData;
    const error = new Error("custom render failed");
    const render = vi.fn((ctx: RowActionRenderContext) => {
      if (render.mock.calls.length === 1) throw error;
      const button = document.createElement("button");
      button.textContent = "Recovered action";
      ctx.host.appendChild(button);
    });
    const controller = new RowActionController({
      gridRoot: root,
      viewport,
      getColumns: () => [
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      getDisplayRows: () => createArrayDisplayRowReader([row]),
      resolveRowId: () => "r1",
      getCellRenderers: () => ({
        rowActions: makeCustomRenderer(render),
      }),
      getRowActionGridApi: () => ({ getRows: () => [row] }),
    });

    root.append(viewport, trigger);
    document.body.appendChild(root);
    trigger.className = ACTION_TRIGGER_CLASS;
    trigger.setAttribute("data-row-id", "r1");
    trigger.setAttribute("data-row-index", "0");
    trigger.setAttribute("data-col-id", "actions");
    trigger.setAttribute("data-actions-key", "rowActions");
    controller.attach(root);

    expect(() =>
      controller.requestOpenAtDisplayIndex(0, "actions", trigger, trigger),
    ).toThrow(error);
    expect(controller.isOpen()).toBe(false);

    expect(
      controller.requestOpenAtDisplayIndex(0, "actions", trigger, trigger),
    ).toBe(true);
    expect(controller.isOpen()).toBe(true);
    expect(document.activeElement?.textContent).toBe("Recovered action");

    controller.detach();
    root.remove();
  });

  it("opening another action closes the previous custom dropdown", async () => {
    const cleanup = vi.fn();
    const render = vi.fn((ctx: RowActionRenderContext) => {
      const el = document.createElement("div");
      el.textContent = `Custom ${ctx.rowId}`;
      ctx.host.appendChild(el);
      return cleanup;
    });

    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeCustomRenderer(render) },
    );
    await flushRenders();

    actionTrigger(root(), 0)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    expect(floatingHost(root())!.textContent).toContain("Custom r1");

    actionTrigger(root(), 1)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(2);
    expect(floatingHost(root())!.textContent).toContain("Custom r2");

    grid.destroy();
    container.remove();
  });

  it("two action columns on the same row can open independently by composite key", async () => {
    const cleanupA = vi.fn();
    const cleanupB = vi.fn();

    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actionsA", cellKind: "actions", actionsKey: "rowActionsA" },
        { field: "actionsB", cellKind: "actions", actionsKey: "rowActionsB" },
      ],
      [
        { id: "r1", name: "Alice", actionsA: "", actionsB: "" },
      ] as RowData[],
      {
        rowActionsA: makeCustomRenderer((ctx) => {
          const el = document.createElement("div");
          el.textContent = "Custom A";
          ctx.host.appendChild(el);
          return cleanupA;
        }),
        rowActionsB: makeCustomRenderer((ctx) => {
          const el = document.createElement("div");
          el.textContent = "Custom B";
          ctx.host.appendChild(el);
          return cleanupB;
        }),
      },
    );
    await flushRenders();

    actionTriggerFor(root(), 0, "actionsA")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    expect(floatingHost(root())!.textContent).toContain("Custom A");

    actionTriggerFor(root(), 0, "actionsB")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );

    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupB).not.toHaveBeenCalled();
    expect(floatingHost(root())!.textContent).toContain("Custom B");

    grid.destroy();
    container.remove();
  });

  it("clicking the same action trigger toggles close", async () => {
    const render = vi.fn((ctx: RowActionRenderContext) => {
      const el = document.createElement("div");
      el.textContent = "Custom action";
      ctx.host.appendChild(el);
    });

    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeCustomRenderer(render) },
    );
    await flushRenders();

    actionTrigger(root(), 0)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    expect(floatingHost(root())!.textContent).toContain("Custom action");

    actionTrigger(root(), 0)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );

    expect(floatingHost(root())!.textContent).toBe("");
    expect(render).toHaveBeenCalledTimes(1);

    grid.destroy();
    container.remove();
  });

  it("recycled cells do not leave stale action buttons when switching to normal column", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    // Verify action trigger exists
    expect(actionTrigger(root(), 0)).toBeTruthy();

    // Now switch columns to have no action column
    grid.setColumns([
      { field: "name" },
      { field: "other" },
    ]);
    await flushRenders();

    // The cell that was an action column should now be a normal cell
    const triggers = root().querySelectorAll(`.${ACTION_TRIGGER_CLASS}`);
    expect(triggers.length).toBe(0);

    // Should not have stale lfg-action-cell class
    const actionCells = root().querySelectorAll(".lfg-action-cell");
    expect(actionCells.length).toBe(0);

    grid.destroy();
    container.remove();
  });

  it("pinned action column creates pinned header but hides column menu trigger", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions", pinned: "left", columnMenu: false },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    // Pinned header should exist for the actions column
    const pinnedHeader = root().querySelector(".lfg-pinned-header-row");
    expect(pinnedHeader).toBeTruthy();
    const headerCell = pinnedHeader?.querySelector('.lfg-header-cell[data-col-id="actions"]');
    expect(headerCell).toBeTruthy();

    // Column menu trigger should NOT be present (columnMenu: false)
    expect(headerMenuTrigger(root(), "actions")).toBeNull();

    // Normal column still has header menu
    expect(headerMenuTrigger(root(), "name")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("action columns never inherit dedicated filters from defaultColDef", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "actions", cellKind: "actions", actionsKey: "rowActions", pinned: "left" },
        { field: "name" },
      ],
      undefined,
      { rowActions: makeRenderer() },
      {
        defaultColDef: { filter: true },
        columnMenu: { filter: { placement: "dedicatedMenu" } },
      },
    );
    await flushRenders();

    const actionHeader = root().querySelector('.lfg-header-cell[data-col-id="actions"]');
    const nameHeader = root().querySelector('.lfg-header-cell[data-col-id="name"]');
    expect(actionHeader?.querySelector(`.${FILTER_TRIGGER_CLASS}`)).toBeNull();
    expect(nameHeader?.querySelector(`.${FILTER_TRIGGER_CLASS}`)).toBeTruthy();
    expect(grid.getColumnFilterConfig("actions")).toBeNull();
    expect(grid.getColumnFilterConfig("name")).not.toBeNull();

    grid.destroy();
    container.remove();
  });

  it("columnMenu: false still hides the header menu trigger", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions", columnMenu: false },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    // Normal column should have a header menu trigger
    expect(headerMenuTrigger(root(), "name")).toBeTruthy();
    // Action column with columnMenu: false should not
    expect(headerMenuTrigger(root(), "actions")).toBeNull();

    grid.destroy();
    container.remove();
  });
});

// ── Row lookup fast-path / fallback ──

describe("row action row lookup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normal click uses row index fast path and passes correct row context", async () => {
    const onAction = vi.fn();
    const rows = [
      { id: "r1", name: "Alice", actions: "" },
      { id: "r2", name: "Bob", actions: "" },
      { id: "r3", name: "Carol", actions: "" },
    ] as RowData[];

    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      rows,
      { rowActions: makeRenderer({ onAction }) },
    );
    await flushRenders();

    const trigger = actionTrigger(root(), 1)!;
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    const items = actionItems(root());
    items[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(onAction).toHaveBeenCalledTimes(1);
    const ctx: RowActionClickContext = onAction.mock.calls[0]![0];
    expect(ctx.rowId).toBe("r2");
    expect(ctx.rowIndex).toBe(1);
    expect((ctx.row as { name: string }).name).toBe("Bob");

    grid.destroy();
    container.remove();
  });

  it("stale data-row-index falls back to id scan and finds the correct row", async () => {
    const onAction = vi.fn();
    const rows = [
      { id: "r1", name: "Alice", actions: "" },
      { id: "r2", name: "Bob", actions: "" },
      { id: "r3", name: "Carol", actions: "" },
    ] as RowData[];

    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      rows,
      { rowActions: makeRenderer({ onAction }) },
    );
    await flushRenders();

    // Grab the trigger for row index 1 (Bob, id=r2)
    const trigger = actionTrigger(root(), 1)!;
    expect(trigger.getAttribute("data-row-id")).toBe("r2");
    expect(trigger.getAttribute("data-row-index")).toBe("1");

    // Simulate a stale index: reorder data so Bob moves to index 0,
    // then let the render update currentData, but tamper the DOM attribute
    // to keep the old index value the trigger was stamped with.
    grid.setRows([
      { id: "r2", name: "Bob", actions: "" },
      { id: "r3", name: "Carol", actions: "" },
    ] as RowData[]);
    await flushRenders();

    // After re-render the trigger DOM may have been recycled.
    // Re-grab Bob's trigger (now at index 0) and force a stale data-row-index.
    const bobTrigger = root().querySelector(
      `.${ACTION_TRIGGER_CLASS}[data-row-id="r2"]`,
    ) as HTMLButtonElement;
    expect(bobTrigger).toBeTruthy();
    bobTrigger.setAttribute("data-row-index", "5"); // stale / out of range

    bobTrigger.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    const items = actionItems(root());
    expect(items.length).toBeGreaterThan(0);
    items[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(onAction).toHaveBeenCalledTimes(1);
    const ctx: RowActionClickContext = onAction.mock.calls[0]![0];
    // Should resolve to Bob via id fallback at his current index
    expect(ctx.rowId).toBe("r2");
    expect(ctx.rowIndex).toBe(0);
    expect((ctx.row as { name: string }).name).toBe("Bob");

    grid.destroy();
    container.remove();
  });

  it("stale data-row-index pointing at wrong row falls back to id scan", async () => {
    const onAction = vi.fn();
    const rows = [
      { id: "r1", name: "Alice", actions: "" },
      { id: "r2", name: "Bob", actions: "" },
      { id: "r3", name: "Carol", actions: "" },
    ] as RowData[];

    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      rows,
      { rowActions: makeRenderer({ onAction }) },
    );
    await flushRenders();

    // Grab Bob's trigger and make its index point at Carol's slot
    const bobTrigger = root().querySelector(
      `.${ACTION_TRIGGER_CLASS}[data-row-id="r2"]`,
    ) as HTMLButtonElement;
    expect(bobTrigger).toBeTruthy();
    bobTrigger.setAttribute("data-row-index", "2"); // points at Carol, not Bob

    bobTrigger.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    const items = actionItems(root());
    expect(items.length).toBeGreaterThan(0);
    items[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(onAction).toHaveBeenCalledTimes(1);
    const ctx: RowActionClickContext = onAction.mock.calls[0]![0];
    // Fast path should reject index 2 (Carol) because id doesn't match,
    // fallback scan should find Bob at index 1
    expect(ctx.rowId).toBe("r2");
    expect(ctx.rowIndex).toBe(1);
    expect((ctx.row as { name: string }).name).toBe("Bob");

    grid.destroy();
    container.remove();
  });

  it("both index and id fail — no menu opens", async () => {
    const onAction = vi.fn();
    const rows = [
      { id: "r1", name: "Alice", actions: "" },
      { id: "r2", name: "Bob", actions: "" },
    ] as RowData[];

    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      rows,
      { rowActions: makeRenderer({ onAction }) },
    );
    await flushRenders();

    // Grab trigger and tamper both attributes to ensure nothing matches
    const trigger = actionTrigger(root(), 0)!;
    trigger.setAttribute("data-row-id", "nonexistent");
    trigger.setAttribute("data-row-index", "999");

    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    // No panel should open and onAction should not be called
    expect(actionPanel(root())).toBeNull();
    expect(onAction).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });
});

// ── Unit-level tests for syncPinnedRowCells with action columns ──

function makePoolCell(): PooledCell {
  const el = document.createElement("div");
  el.className = "lfg-cell";
  return { element: el, value: "" };
}

function makePoolRow(opts?: { pinnedCells?: PooledCell[]; rightPinnedCells?: PooledCell[] }): PooledRow {
  const row: PooledRow = {
    element: document.createElement("div"),
    cells: [],
    rowIndex: -1,
    rowVersion: 0,
    rowId: null,
  };
  if (opts?.pinnedCells) {
    row.pinnedElement = document.createElement("div");
    row.pinnedCells = opts.pinnedCells;
  }
  if (opts?.rightPinnedCells) {
    row.rightPinnedElement = document.createElement("div");
    row.rightPinnedCells = opts.rightPinnedCells;
  }
  return row;
}

describe("syncPinnedRowCells – action columns", () => {
  it("publishes renderer-matched popup type and clears stale recycled ownership", () => {
    const cell = makePoolCell();
    const poolRow = makePoolRow({ pinnedCells: [cell] });
    const col: ColumnDef = {
      field: "actions",
      cellKind: "actions",
      actionsKey: "rowActions",
      pinned: "left",
    };
    const menuRegistry: CellRendererRegistry = {
      rowActions: makeRenderer(),
    };

    syncPinnedRowCells(
      poolRow,
      { id: "r1" } as RowData,
      [col],
      0,
      (row) => (row as { id: string }).id,
      undefined,
      undefined,
      "left",
      undefined,
      undefined,
      undefined,
      menuRegistry,
    );

    const trigger = cell.element.querySelector(
      `.${ACTION_TRIGGER_CLASS}`,
    ) as HTMLButtonElement;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const setAttribute = vi.spyOn(trigger, "setAttribute");
    const removeAttribute = vi.spyOn(trigger, "removeAttribute");
    syncPinnedRowCells(
      poolRow,
      { id: "r1" } as RowData,
      [col],
      0,
      (row) => (row as { id: string }).id,
      undefined,
      undefined,
      "left",
      undefined,
      undefined,
      undefined,
      menuRegistry,
    );
    expect(
      setAttribute.mock.calls.filter(([name]) =>
        name === "aria-haspopup" ||
        name === "aria-expanded" ||
        name === "aria-controls"
      ),
    ).toEqual([]);
    expect(
      removeAttribute.mock.calls.filter(([name]) =>
        name === "aria-haspopup" ||
        name === "aria-expanded" ||
        name === "aria-controls"
      ),
    ).toEqual([]);
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", "lfg-popup-row-action-1");

    const customRegistry: CellRendererRegistry = {
      rowActions: makeCustomRenderer(vi.fn()),
    };
    syncPinnedRowCells(
      poolRow,
      { id: "r2" } as RowData,
      [col],
      1,
      (row) => (row as { id: string }).id,
      undefined,
      undefined,
      "left",
      undefined,
      undefined,
      undefined,
      customRegistry,
    );

    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);
  });

  it("pinned left action column renders trigger on first bind", () => {
    const cell = makePoolCell();
    const poolRow = makePoolRow({ pinnedCells: [cell] });

    const col: ColumnDef = {
      field: "actions",
      cellKind: "actions",
      actionsKey: "rowActions",
      pinned: "left",
    };

    syncPinnedRowCells(
      poolRow,
      { id: "r1", name: "Alice" } as RowData,
      [col],
      0,
      (r) => (r as { id: string }).id,
      undefined,
      undefined,
      "left",
    );

    const trigger = cell.element.querySelector(`.${ACTION_TRIGGER_CLASS}`) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    expect(trigger!.getAttribute("data-row-id")).toBe("r1");
    expect(trigger!.getAttribute("data-row-index")).toBe("0");
    expect(trigger!.getAttribute("data-col-id")).toBe("actions");
    expect(trigger!.getAttribute("data-actions-key")).toBe("rowActions");
    expect(cell.element.classList.contains(ACTION_CELL_CLASS)).toBe(true);
    expect(cell.element.getAttribute("data-pinned")).toBe("left");
  });

  it("pinned right action column renders trigger on first bind", () => {
    const cell = makePoolCell();
    const poolRow = makePoolRow({ rightPinnedCells: [cell] });

    const col: ColumnDef = {
      field: "actions",
      cellKind: "actions",
      actionsKey: "rowActions",
      pinned: "right",
    };

    syncPinnedRowCells(
      poolRow,
      { id: "r2", name: "Bob" } as RowData,
      [col],
      1,
      (r) => (r as { id: string }).id,
      undefined,
      undefined,
      "right",
    );

    const trigger = cell.element.querySelector(`.${ACTION_TRIGGER_CLASS}`) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    expect(trigger!.getAttribute("data-row-id")).toBe("r2");
    expect(trigger!.getAttribute("data-row-index")).toBe("1");
    expect(trigger!.getAttribute("data-col-id")).toBe("actions");
    expect(cell.element.getAttribute("data-pinned")).toBe("right");
  });

  it("subsequent bind reuses trigger and updates data attributes", () => {
    const cell = makePoolCell();
    const poolRow = makePoolRow({ pinnedCells: [cell] });

    const col: ColumnDef = {
      field: "actions",
      cellKind: "actions",
      actionsKey: "rowActions",
      pinned: "left",
    };

    // First bind
    syncPinnedRowCells(
      poolRow, { id: "r1" } as RowData, [col], 0,
      (r) => (r as { id: string }).id,
      undefined, undefined, "left",
    );

    const trigger1 = cell.element.querySelector(`.${ACTION_TRIGGER_CLASS}`)!;
    expect(trigger1).toBeTruthy();

    // Second bind with different row
    syncPinnedRowCells(
      poolRow, { id: "r5" } as RowData, [col], 4,
      (r) => (r as { id: string }).id,
      undefined, undefined, "left",
    );

    // Should reuse the same trigger element (not create a new one)
    const trigger2 = cell.element.querySelector(`.${ACTION_TRIGGER_CLASS}`)!;
    expect(trigger2).toBe(trigger1);
    expect(trigger2.getAttribute("data-row-id")).toBe("r5");
    expect(trigger2.getAttribute("data-row-index")).toBe("4");
  });

  it("regression: data-col-id already set but no trigger → creates trigger", () => {
    const cell = makePoolCell();
    // Simulate a cell that already has data-col-id set (e.g. from a prior render pass)
    // but has no trigger button inside it
    cell.element.setAttribute("data-col-id", "actions");
    const poolRow = makePoolRow({ pinnedCells: [cell] });

    const col: ColumnDef = {
      field: "actions",
      cellKind: "actions",
      actionsKey: "rowActions",
      pinned: "left",
    };

    syncPinnedRowCells(
      poolRow,
      { id: "r1" } as RowData,
      [col],
      0,
      (r) => (r as { id: string }).id,
      undefined,
      undefined,
      "left",
    );

    const trigger = cell.element.querySelector(`.${ACTION_TRIGGER_CLASS}`) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    expect(trigger!.getAttribute("data-row-id")).toBe("r1");
    expect(trigger!.getAttribute("data-col-id")).toBe("actions");
    expect(trigger!.getAttribute("data-actions-key")).toBe("rowActions");
  });
});

describe("actionTrigger customization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("default trigger renders ⋯ icon and Row actions aria-label", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    const trigger = actionTrigger(root(), 0)!;
    expect(trigger.textContent).toBe("⋯");
    expect(trigger.getAttribute("aria-label")).toBe("Row actions");
    expect(trigger.tabIndex).toBe(-1);
    expect(trigger.getAttribute("role")).toBeNull();
    expect(trigger.className).toBe(ACTION_TRIGGER_CLASS);

    grid.destroy();
    container.remove();
  });

  it("custom icon renders from actionTrigger.icon", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions", actionTrigger: { icon: "⚙" } },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    const trigger = actionTrigger(root(), 0)!;
    expect(trigger.textContent).toBe("⚙");

    grid.destroy();
    container.remove();
  });

  it("custom aria-label is applied", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions", actionTrigger: { ariaLabel: "Open row tools" } },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    const trigger = actionTrigger(root(), 0)!;
    expect(trigger.getAttribute("aria-label")).toBe("Open row tools");

    grid.destroy();
    container.remove();
  });

  it("blank custom aria-label falls back to the non-empty default", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        {
          field: "actions",
          cellKind: "actions",
          actionsKey: "rowActions",
          actionTrigger: { ariaLabel: "   " },
        },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    expect(actionTrigger(root(), 0)?.getAttribute("aria-label")).toBe(
      "Row actions",
    );

    grid.destroy();
    container.remove();
  });

  it("custom class is appended while lfg-action-trigger remains present", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions", actionTrigger: { className: "orders-row-tools-trigger" } },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    const trigger = actionTrigger(root(), 0)!;
    expect(trigger.classList.contains(ACTION_TRIGGER_CLASS)).toBe(true);
    expect(trigger.classList.contains("orders-row-tools-trigger")).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("recycled same-field action cell updates icon/class/aria-label", () => {
    const cell = makePoolCell();
    const poolRow = makePoolRow({ pinnedCells: [cell] });

    const col1: ColumnDef = {
      field: "actions",
      cellKind: "actions",
      actionsKey: "rowActions",
      pinned: "left",
      actionTrigger: { icon: "⚙", ariaLabel: "Tools", className: "custom-a" },
    };

    // First bind
    syncPinnedRowCells(
      poolRow, { id: "r1" } as RowData, [col1], 0,
      (r) => (r as { id: string }).id,
      undefined, undefined, "left",
    );

    let trigger = cell.element.querySelector(`.${ACTION_TRIGGER_CLASS}`) as HTMLButtonElement;
    expect(trigger.textContent).toBe("⚙");
    expect(trigger.getAttribute("aria-label")).toBe("Tools");
    expect(trigger.classList.contains("custom-a")).toBe(true);
    expect(trigger.tabIndex).toBe(-1);

    const setAttribute = vi.spyOn(trigger, "setAttribute");
    syncPinnedRowCells(
      poolRow, { id: "r1" } as RowData, [col1], 0,
      (r) => (r as { id: string }).id,
      undefined, undefined, "left",
    );
    expect(
      setAttribute.mock.calls.filter(([name]) =>
        name === "aria-label" || name === "role" || name === "tabindex"
      ),
    ).toEqual([]);

    // Second bind with different customization
    const col2: ColumnDef = {
      ...col1,
      actionTrigger: { icon: "☰", ariaLabel: "Menu", className: "custom-b" },
    };

    syncPinnedRowCells(
      poolRow, { id: "r2" } as RowData, [col2], 1,
      (r) => (r as { id: string }).id,
      undefined, undefined, "left",
    );

    trigger = cell.element.querySelector(`.${ACTION_TRIGGER_CLASS}`) as HTMLButtonElement;
    expect(trigger.textContent).toBe("☰");
    expect(trigger.getAttribute("aria-label")).toBe("Menu");
    expect(trigger.tabIndex).toBe(-1);
    expect(trigger.classList.contains("custom-b")).toBe(true);
    // Stale class from previous bind must not remain
    expect(trigger.classList.contains("custom-a")).toBe(false);
  });

  it("pinned action cells use the same trigger customization", () => {
    const cell = makePoolCell();
    const poolRow = makePoolRow({ pinnedCells: [cell] });

    const col: ColumnDef = {
      field: "actions",
      cellKind: "actions",
      actionsKey: "rowActions",
      pinned: "left",
      actionTrigger: { icon: "⋮", ariaLabel: "Row menu", className: "pinned-trigger" },
    };

    syncPinnedRowCells(
      poolRow, { id: "r1" } as RowData, [col], 0,
      (r) => (r as { id: string }).id,
      undefined, undefined, "left",
    );

    const trigger = cell.element.querySelector(`.${ACTION_TRIGGER_CLASS}`) as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toBe("⋮");
    expect(trigger.getAttribute("aria-label")).toBe("Row menu");
    expect(trigger.tabIndex).toBe(-1);
    expect(trigger.classList.contains(ACTION_TRIGGER_CLASS)).toBe(true);
    expect(trigger.classList.contains("pinned-trigger")).toBe(true);
  });

  it("default dropdown placement is bottom-end", async () => {
    const { FloatingController } = await import("../../../features/floating/FloatingController");
    const openSpy = vi.spyOn(FloatingController.prototype, "open");

    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    actionTrigger(root(), 0)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );

    // Find the row-action open call (skip any column-menu calls)
    const rowActionCall = openSpy.mock.calls.find(
      (call) => call[0].placement === "bottom-end",
    );
    expect(rowActionCall).toBeTruthy();

    openSpy.mockRestore();
    grid.destroy();
    container.remove();
  });

  it("custom placement is passed to FloatingController.open()", async () => {
    const { FloatingController } = await import("../../../features/floating/FloatingController");
    const openSpy = vi.spyOn(FloatingController.prototype, "open");

    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions", actionTrigger: { placement: "top-start" } },
      ],
      undefined,
      { rowActions: makeRenderer() },
    );
    await flushRenders();

    actionTrigger(root(), 0)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );

    const rowActionCall = openSpy.mock.calls.find(
      (call) => call[0].placement === "top-start",
    );
    expect(rowActionCall).toBeTruthy();

    openSpy.mockRestore();
    grid.destroy();
    container.remove();
  });
});
