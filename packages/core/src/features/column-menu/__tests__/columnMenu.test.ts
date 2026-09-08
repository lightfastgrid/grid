// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { SELECTION_COLUMN_FIELD } from "../../../internal/selectionColumn";
import { buildHeaderSlotRow } from "../../../rendering/helpers/dom/buildHeaderRow";
import { syncHeaderRowSlots } from "../../../rendering/helpers/syncHeaderRowSlots";
import type { ColumnDef, ColumnMenuSectionActionContext, FilterModel, RowData, RowSelectionConfig } from "../../../types";
import { assembleHeaderControlResolver } from "../../assembleHeaderControls";
import {
  FILTER_PANEL_CLASS,
  FILTER_TRIGGER_CLASS,
} from "../../filters/dedicatedFilterDom";
import {
  MENU_ITEM_CLASS,
  MENU_PANEL_CLASS,
  MENU_SEPARATOR_CLASS,
  MENU_TRIGGER_CLASS,
} from "../columnMenuDom";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function headerCell(root: HTMLElement, field: string): HTMLElement | null {
  return root.querySelector(
    `.lfg-header-cell[data-col-id="${field}"]`,
  ) as HTMLElement | null;
}

function menuTrigger(root: HTMLElement, field: string): HTMLButtonElement | null {
  const cell = headerCell(root, field);
  return cell?.querySelector(`.${MENU_TRIGGER_CLASS}`) as HTMLButtonElement | null;
}

function openMenu(root: HTMLElement, field: string): void {
  menuTrigger(root, field)!.dispatchEvent(
    new MouseEvent("click", { bubbles: true, button: 0 }),
  );
}

function menuPanel(root: HTMLElement): HTMLElement | null {
  return root.querySelector(`.${MENU_PANEL_CLASS}`) as HTMLElement | null;
}

function menuItems(root: HTMLElement): HTMLButtonElement[] {
  const panel = menuPanel(root);
  if (!panel) return [];
  return Array.from(panel.querySelectorAll(`.${MENU_ITEM_CLASS}`)) as HTMLButtonElement[];
}

function menuItemByAction(root: HTMLElement, actionId: string): HTMLButtonElement | null {
  const panel = menuPanel(root);
  if (!panel) return null;
  return panel.querySelector(`[data-menu-action="${actionId}"]`) as HTMLButtonElement | null;
}

function clickMenuItem(root: HTMLElement, actionId: string): void {
  const item = menuItemByAction(root, actionId);
  if (item) {
    item.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  }
}

function makeGrid(
  columns: ColumnDef[],
  rows?: RowData[],
  opts?: Record<string, unknown>,
) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "400px", width: "800px" });
  document.body.appendChild(container);

  const grid = new Grid({
    rows: rows ?? [Object.fromEntries(columns.map((c) => [c.field, 1]))] as RowData[],
    columns,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    ...opts,
  });
  grid.mount(container);
  return {
    grid,
    container,
    root: () => container.querySelector(".lfg-grid") as HTMLElement,
  };
}

describe("column menu trigger and dropdown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("trigger renders for normal user columns", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "b" },
    ]);
    await flushRenders();

    expect(menuTrigger(root(), "a")).toBeTruthy();
    expect(menuTrigger(root(), "b")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("trigger has aria-label and does not use aria-hidden", async () => {
    const { grid, container, root } = makeGrid([
      { field: "price", headerName: "Price" },
    ]);
    await flushRenders();

    const trigger = menuTrigger(root(), "price")!;
    expect(trigger.getAttribute("aria-label")).toBe("Column menu for Price");
    expect(trigger.hasAttribute("aria-hidden")).toBe(false);
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("trigger does not render for internal selection column", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
      [{ id: "r1", a: 1 }] as RowData[],
      {
        getRowId: (r: RowData) => (r as { id: string }).id,
        rowSelection: { mode: "multiple", checkboxes: true },
      },
    );
    await flushRenders();

    expect(menuTrigger(root(), SELECTION_COLUMN_FIELD)).toBeNull();
    expect(menuTrigger(root(), "a")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("column with columnMenu: false does not render trigger", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "actions", columnMenu: false, sortable: false, resizable: false, reorderable: false },
    ]);
    await flushRenders();

    expect(menuTrigger(root(), "a")).toBeTruthy();
    expect(menuTrigger(root(), "actions")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("pinned column with columnMenu: false does not render trigger", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "left-action", columnMenu: false, pinned: "left" },
      { field: "right-action", columnMenu: false, pinned: "right" },
    ]);
    await flushRenders();

    expect(menuTrigger(root(), "a")).toBeTruthy();
    expect(menuTrigger(root(), "left-action")).toBeNull();
    expect(menuTrigger(root(), "right-action")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("global columnMenu.enabled: false hides all triggers", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      { columnMenu: { enabled: false } },
    );
    await flushRenders();

    expect(menuTrigger(root(), "a")).toBeNull();
    expect(menuTrigger(root(), "b")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("reused selection header slot removes stale trigger", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
      [{ id: "r1", a: 1 }] as RowData[],
      {
        getRowId: (r: RowData) => (r as { id: string }).id,
        rowSelection: { mode: "multiple", checkboxes: true },
      },
    );
    await flushRenders();

    const selCell = headerCell(root(), SELECTION_COLUMN_FIELD);
    expect(selCell).toBeTruthy();
    expect(selCell!.querySelector(`.${MENU_TRIGGER_CLASS}`)).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("recycled selection and normal header slot does not keep stale chrome", () => {
    const row = buildHeaderSlotRow(1);
    const rowSelection: RowSelectionConfig = {
      mode: "multiple",
      checkboxes: true,
      headerCheckbox: true,
      enableRowClickSelection: true,
      selectAllScope: "page",
      checkboxColumn: { width: 44, pinned: false },
    };
    const selectionColumn: ColumnDef = {
      field: SELECTION_COLUMN_FIELD,
      internal: "selection",
      columnMenu: false,
      reorderable: false,
      resizable: false,
    };
    const normalColumn: ColumnDef = {
      field: "name",
      filterable: true,
      headerActions: [{ id: "inspect", rendererKey: "inspect", icon: "I" }],
    };

    const resolver = assembleHeaderControlResolver({
      filter: { placement: "dedicatedMenu" },
    });
    syncHeaderRowSlots(row, [selectionColumn], 0, 1, () => 0, rowSelection, undefined, resolver);
    const cell = row.children[0] as HTMLElement;
    expect(cell.querySelector(".lfg-header-selection-checkbox")).toBeTruthy();
    expect(cell.querySelector(`.${MENU_TRIGGER_CLASS}`)).toBeNull();
    expect(cell.querySelector(`.${FILTER_TRIGGER_CLASS}`)).toBeNull();
    expect(cell.querySelector(".lfg-column-drag-handle")).toBeNull();

    syncHeaderRowSlots(row, [normalColumn], 0, 1, () => 0, rowSelection, undefined, resolver);
    expect(cell.querySelector(".lfg-header-selection-checkbox")).toBeNull();
    expect(cell.querySelector(".lfg-header-label")?.textContent).toBe("name");
    expect(cell.querySelector(".lfg-column-drag-handle")).toBeTruthy();
    expect(cell.querySelector('[data-header-action-id="inspect"]')).toBeTruthy();
    expect(cell.querySelector(`.${MENU_TRIGGER_CLASS}`)).toBeTruthy();
    expect(cell.querySelector(`.${FILTER_TRIGGER_CLASS}`)).toBeTruthy();

    syncHeaderRowSlots(row, [selectionColumn], 0, 1, () => 0, rowSelection, undefined, resolver);
    expect(cell.querySelector(".lfg-header-selection-checkbox")).toBeTruthy();
    expect(cell.querySelector(".lfg-header-label")?.textContent).toBe("");
    expect(cell.querySelector(".lfg-column-drag-handle")).toBeNull();
    expect(cell.querySelector('[data-header-action-id="inspect"]')).toBeNull();
    expect(cell.querySelector(`.${MENU_TRIGGER_CLASS}`)).toBeNull();
    expect(cell.querySelector(`.${FILTER_TRIGGER_CLASS}`)).toBeNull();
  });

  it("clicking trigger opens dropdown", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "b" },
    ]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    const panel = menuPanel(root())!;
    const trigger = menuTrigger(root(), "a")!;
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-label")).toBe("Column menu for a");
    expect(panel.getAttribute("aria-modal")).toBe("false");
    expect(panel.id).toMatch(/^lfg-popup-column-menu-\d+$/);
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    expect(trigger.classList.contains("lfg-popup-trigger-open")).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("dropdown is inside .lfg-floating, not inside .lfg-header-cell", async () => {
    const { grid, container, root } = makeGrid([{ field: "a" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    const panel = menuPanel(root())!;
    expect(panel.closest(".lfg-floating")).toBeTruthy();
    expect(panel.closest(".lfg-header-cell")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("dropdown has expected class and data-col-id", async () => {
    const { grid, container, root } = makeGrid([{ field: "price" }]);
    await flushRenders();

    openMenu(root(), "price");
    await flushRenders();

    const panel = menuPanel(root())!;
    expect(panel).toBeTruthy();
    expect(panel.getAttribute("data-col-id")).toBe("price");

    grid.destroy();
    container.remove();
  });

  it("only one dropdown exists after opening multiple columns", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "b" },
    ]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    openMenu(root(), "b");
    await flushRenders();

    const panels = root().querySelectorAll(`.${MENU_PANEL_CLASS}`);
    expect(panels).toHaveLength(1);
    expect((panels[0] as HTMLElement).getAttribute("data-col-id")).toBe("b");

    grid.destroy();
    container.remove();
  });

  it("clicking same trigger again closes dropdown", async () => {
    const { grid, container, root } = makeGrid([{ field: "a" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    expect(menuPanel(root())).toBeTruthy();

    openMenu(root(), "a");
    await flushRenders();
    expect(menuPanel(root())).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("switching columns then clicking same trigger closes dropdown", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "b" },
    ]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    expect(menuPanel(root())).toBeTruthy();

    openMenu(root(), "b");
    await flushRenders();
    expect(menuPanel(root())!.getAttribute("data-col-id")).toBe("b");

    openMenu(root(), "b");
    await flushRenders();
    expect(menuPanel(root())).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("outside pointerdown closes dropdown", async () => {
    const { grid, container, root } = makeGrid([{ field: "a" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    expect(menuPanel(root())).toBeTruthy();

    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    await flushRenders();
    expect(menuPanel(root())).toBeNull();
    const trigger = menuTrigger(root(), "a")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("Escape closes dropdown", async () => {
    const { grid, container, root } = makeGrid([{ field: "a" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    expect(menuPanel(root())).toBeTruthy();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushRenders();
    expect(menuPanel(root())).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("clicking trigger does not sort column", async () => {
    const onSortChanged = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a", sortable: true }],
      undefined,
      { onSortChanged },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(onSortChanged).not.toHaveBeenCalled();
    expect(grid.getSortModel()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("clicking trigger does not select column", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      {
        columnSelection: {
          enabled: true,
          enableHeaderClickSelection: true,
          mode: "multiple",
        },
      },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("destroy removes dropdown and floating layer", async () => {
    const { grid, container, root } = makeGrid([{ field: "a" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    expect(menuPanel(root())).toBeTruthy();

    grid.destroy();

    expect(container.querySelector(`.${MENU_PANEL_CLASS}`)).toBeNull();
    expect(container.querySelector(".lfg-floating-layer")).toBeNull();

    container.remove();
  });

  it("no per-header-cell event listeners added", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "b" },
      { field: "c" },
    ]);
    await flushRenders();

    const cellA = headerCell(root(), "a")!;
    const cellB = headerCell(root(), "b")!;
    const addSpyA = vi.spyOn(cellA, "addEventListener");
    const addSpyB = vi.spyOn(cellB, "addEventListener");

    openMenu(root(), "a");
    await flushRenders();

    expect(addSpyA).not.toHaveBeenCalled();
    expect(addSpyB).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });
});

describe("column menu sort actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("menu contains sort items for sortable column", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();
    expect(menuItemByAction(root(), "sort-desc")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("menu hides sort items when sortable: false", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: false }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(menuItemByAction(root(), "sort-asc")).toBeNull();
    expect(menuItemByAction(root(), "sort-desc")).toBeNull();
    expect(menuItemByAction(root(), "sort-clear")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("sort ascending action sets ascending sort", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    clickMenuItem(root(), "sort-asc");
    await flushRenders();

    expect(grid.getSortModel()).toEqual([{ field: "a", sort: "asc" }]);

    grid.destroy();
    container.remove();
  });

  it("sort descending action sets descending sort", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    clickMenuItem(root(), "sort-desc");
    await flushRenders();

    expect(grid.getSortModel()).toEqual([{ field: "a", sort: "desc" }]);

    grid.destroy();
    container.remove();
  });

  it("clear sort removes sort for that column", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    grid.setSortModel([{ field: "a", sort: "asc" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    clickMenuItem(root(), "sort-clear");
    await flushRenders();

    expect(grid.getSortModel()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("clear sort is hidden when column is not sorted", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(menuItemByAction(root(), "sort-clear")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("sort ascending is disabled when already ascending", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    grid.setSortModel([{ field: "a", sort: "asc" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    const item = menuItemByAction(root(), "sort-asc")!;
    expect(item.hasAttribute("disabled")).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("sort descending is disabled when already descending", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    grid.setSortModel([{ field: "a", sort: "desc" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    const item = menuItemByAction(root(), "sort-desc")!;
    expect(item.hasAttribute("disabled")).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("disabled sort action does not fire", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    grid.setSortModel([{ field: "a", sort: "asc" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    clickMenuItem(root(), "sort-asc");
    await flushRenders();

    expect(grid.getSortModel()).toEqual([{ field: "a", sort: "asc" }]);
    // menu should still be open since disabled action does not close
    expect(menuPanel(root())).toBeTruthy();

    grid.destroy();
    container.remove();
  });
});

describe("column menu pin actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("menu contains pin items for pinnable column", async () => {
    const { grid, container, root } = makeGrid([{ field: "a" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(menuItemByAction(root(), "pin-left")).toBeTruthy();
    expect(menuItemByAction(root(), "pin-right")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("pin actions hidden when pinnable: false", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", pinnable: false }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(menuItemByAction(root(), "pin-left")).toBeNull();
    expect(menuItemByAction(root(), "pin-right")).toBeNull();
    expect(menuItemByAction(root(), "unpin")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("pin left action pins column left", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    clickMenuItem(root(), "pin-left");
    await flushRenders();

    expect(onColumnPinChanged).toHaveBeenCalledWith(
      expect.objectContaining({ field: "a", pinned: "left" }),
    );

    grid.destroy();
    container.remove();
  });

  it("pin right action pins column right", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    clickMenuItem(root(), "pin-right");
    await flushRenders();

    expect(onColumnPinChanged).toHaveBeenCalledWith(
      expect.objectContaining({ field: "a", pinned: "right" }),
    );

    grid.destroy();
    container.remove();
  });

  it("unpin action unpins column", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a", pinned: "left" }, { field: "b" }],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    clickMenuItem(root(), "unpin");
    await flushRenders();

    expect(onColumnPinChanged).toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });

  it("unpin is hidden when column is not pinned", async () => {
    const { grid, container, root } = makeGrid([{ field: "a" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(menuItemByAction(root(), "unpin")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("pin left is disabled when already pinned left", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a", pinned: "left" },
      { field: "b" },
    ]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    const item = menuItemByAction(root(), "pin-left")!;
    expect(item.hasAttribute("disabled")).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("pin right is disabled when already pinned right", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a", pinned: "right" },
      { field: "b" },
    ]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    const item = menuItemByAction(root(), "pin-right")!;
    expect(item.hasAttribute("disabled")).toBe(true);

    grid.destroy();
    container.remove();
  });
});

describe("column menu UX behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("action click closes menu", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    expect(menuPanel(root())).toBeTruthy();

    clickMenuItem(root(), "sort-asc");
    await flushRenders();

    expect(menuPanel(root())).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("menu item click does not trigger header sort toggle", async () => {
    const onSortChanged = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a", sortable: true }],
      undefined,
      { onSortChanged },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    clickMenuItem(root(), "sort-asc");
    await flushRenders();

    // Should be called exactly once (from the menu action), not twice
    expect(grid.getSortModel()).toEqual([{ field: "a", sort: "asc" }]);

    grid.destroy();
    container.remove();
  });

  it("menu item click does not select column", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", sortable: true }, { field: "b" }],
      undefined,
      {
        columnSelection: {
          enabled: true,
          enableHeaderClickSelection: true,
          mode: "multiple",
        },
      },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    clickMenuItem(root(), "sort-asc");
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("opening another column menu replaces previous content", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a", sortable: true },
      { field: "b", sortable: false },
    ]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();

    openMenu(root(), "b");
    await flushRenders();
    const panel = menuPanel(root())!;
    expect(panel.getAttribute("data-col-id")).toBe("b");
    expect(menuItemByAction(root(), "sort-asc")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("uses a non-modal dialog for mixed command and form content", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    const panel = menuPanel(root())!;
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("false");

    const items = menuItems(root());
    for (const item of items) {
      expect(item.hasAttribute("role")).toBe(false);
    }

    grid.destroy();
    container.remove();
  });

  it("sort and pin sections separated by separator", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    const panel = menuPanel(root())!;
    const separators = panel.querySelectorAll(`.${MENU_SEPARATOR_CLASS}`);
    expect(separators.length).toBeGreaterThanOrEqual(1);

    grid.destroy();
    container.remove();
  });

  it("no separator when only one section visible", async () => {
    // sort/pin disabled on the column; sizing disabled via menu options;
    // only visibility remains — no separator should render.
    const { grid, container, root } = makeGrid(
      [{ field: "a", sortable: false, pinnable: false }],
      undefined,
      {
        columnMenu: { visibility: true, sizing: false },
        columnOrder: false,
      },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    const panel = menuPanel(root())!;
    const separators = panel.querySelectorAll(`.${MENU_SEPARATOR_CLASS}`);
    expect(separators.length).toBe(0);

    grid.destroy();
    container.remove();
  });

  it("disabled menu item does not close menu", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    grid.setSortModel([{ field: "a", sort: "asc" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    expect(menuPanel(root())).toBeTruthy();

    clickMenuItem(root(), "sort-asc");
    await flushRenders();

    expect(menuPanel(root())).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("menu item click does not bubble to grid root", async () => {
    const rootClickSpy = vi.fn();
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    root().addEventListener("click", rootClickSpy);

    openMenu(root(), "a");
    await flushRenders();

    rootClickSpy.mockClear();

    clickMenuItem(root(), "sort-asc");
    await flushRenders();

    expect(rootClickSpy).not.toHaveBeenCalled();

    root().removeEventListener("click", rootClickSpy);
    grid.destroy();
    container.remove();
  });
});

describe("column menu trigger lane", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("header cell contains menu trigger for sortable columns", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    const cell = headerCell(root(), "a")!;
    expect(cell.querySelector(`.${MENU_TRIGGER_CLASS}`)).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("no sort handle element in header cell", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    const cell = headerCell(root(), "a")!;
    expect(cell.querySelector(".lfg-sort-handle")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("menu trigger click opens menu and does not sort", async () => {
    const { grid, container, root } = makeGrid([{ field: "a", sortable: true }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(grid.getSortModel()).toEqual([]);
    expect(menuPanel(root())).toBeTruthy();

    grid.destroy();
    container.remove();
  });
});

describe("column menu sort preserves multi-column model", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sort ascending from menu appends a column to a multi-column sort model", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a", sortable: true },
      { field: "b", sortable: true },
      { field: "c", sortable: true },
    ]);
    await flushRenders();

    grid.setSortModel([
      { field: "a", sort: "asc" },
      { field: "b", sort: "desc" },
    ]);
    await flushRenders();

    openMenu(root(), "c");
    await flushRenders();
    clickMenuItem(root(), "sort-asc");
    await flushRenders();

    expect(grid.getSortModel()).toEqual([
      { field: "a", sort: "asc" },
      { field: "b", sort: "desc" },
      { field: "c", sort: "asc" },
    ]);

    grid.destroy();
    container.remove();
  });

  it("sort descending from menu updates that column and keeps other sort rules", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a", sortable: true },
      { field: "b", sortable: true },
    ]);
    await flushRenders();

    grid.setSortModel([
      { field: "a", sort: "asc" },
      { field: "b", sort: "desc" },
    ]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    clickMenuItem(root(), "sort-desc");
    await flushRenders();

    expect(grid.getSortModel()).toEqual([
      { field: "b", sort: "desc" },
      { field: "a", sort: "desc" },
    ]);

    grid.destroy();
    container.remove();
  });

  it("clear sort from menu clears only that column", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a", sortable: true },
      { field: "b", sortable: true },
    ]);
    await flushRenders();

    grid.setSortModel([
      { field: "a", sort: "asc" },
      { field: "b", sort: "desc" },
    ]);
    await flushRenders();

    openMenu(root(), "b");
    await flushRenders();
    clickMenuItem(root(), "sort-clear");
    await flushRenders();

    expect(grid.getSortModel()).toEqual([{ field: "a", sort: "asc" }]);

    grid.destroy();
    container.remove();
  });

  it("clear sort on only sorted column yields empty model", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a", sortable: true },
      { field: "b", sortable: true },
    ]);
    await flushRenders();

    grid.setSortModel([{ field: "a", sort: "asc" }]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    clickMenuItem(root(), "sort-clear");
    await flushRenders();

    expect(grid.getSortModel()).toEqual([]);

    grid.destroy();
    container.remove();
  });
});

describe("columnMenu.sections", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("callback receives field, column, columns, defaultSections, and grid api", async () => {
    const spy = vi.fn((ctx: ColumnMenuSectionActionContext) => ctx.defaultSections);
    const { grid, container, root } = makeGrid(
      [{ field: "a", sortable: true }, { field: "b" }],
      undefined,
      {
        columnMenu: {
          sort: true,
          pinning: true,
          visibility: true,
          sections: spy,
        },
      },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(spy).toHaveBeenCalledTimes(1);
    const ctx = spy.mock.calls[0]![0]!;
    expect(ctx.field).toBe("a");
    expect(ctx.column.field).toBe("a");
    expect(ctx.columns.length).toBeGreaterThanOrEqual(2);
    expect(ctx.defaultSections.length).toBeGreaterThan(0);
    expect(typeof ctx.grid.setSortModel).toBe("function");
    expect(typeof ctx.grid.pinColumn).toBe("function");
    expect(typeof ctx.grid.hideColumns).toBe("function");
    expect(typeof ctx.grid.getSortModel).toBe("function");

    grid.destroy();
    container.remove();
  });

  it("parent can extend default sections with custom items", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", sortable: true }],
      undefined,
      {
        columnMenu: {
          sort: true,
          pinning: true,
          visibility: true,
          sections: () => [
            {
              id: "custom",
              position: "bottom",
              items: [
                {
                  id: "custom-action",
                  label: "Custom Action",
                  action: () => {},
                },
              ],
            },
          ],
        },
      },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();
    expect(menuItemByAction(root(), "custom-action")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("parent can replace defaults by returning only custom sections", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", sortable: true }],
      undefined,
      {
        columnMenu: {
          sort: false,
          pinning: false,
          visibility: false,
          sections: () => [
            {
              id: "only",
              items: [
                { id: "my-item", label: "My Item", action: () => {} },
              ],
            },
          ],
        },
      },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(menuItemByAction(root(), "sort-asc")).toBeNull();
    expect(menuItemByAction(root(), "pin-left")).toBeNull();
    expect(menuItemByAction(root(), "my-item")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("custom action runs and can use grid api", async () => {
    const actionSpy = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a", sortable: true }],
      undefined,
      {
        columnMenu: {
          sections: () => [
            {
              id: "custom",
              items: [
                {
                  id: "custom-sort",
                  label: "Sort via API",
                  action: ({
                    grid,
                    field,
                  }: ColumnMenuSectionActionContext) => {
                    grid.setSortModel([{ field, sort: "desc" }]);
                    actionSpy();
                  },
                },
              ],
            },
          ],
        },
      },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    clickMenuItem(root(), "custom-sort");
    await flushRenders();

    expect(actionSpy).toHaveBeenCalled();
    expect(grid.getSortModel()).toEqual([{ field: "a", sort: "desc" }]);

    grid.destroy();
    container.remove();
  });

  it("without columnMenu.sections, default menu still renders", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a", sortable: true },
    ]);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();
    expect(menuItemByAction(root(), "pin-left")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("selectedColumnIds is passed to callback", async () => {
    const spy = vi.fn((ctx: ColumnMenuSectionActionContext) => ctx.defaultSections);
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      {
        columnSelection: {
          enabled: true,
          enableHeaderClickSelection: true,
          mode: "multiple",
        },
        columnMenu: { sections: spy },
      },
    );
    await flushRenders();

    const cellA = headerCell(root(), "a")!;
    cellA.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    expect(spy).toHaveBeenCalled();
    const ctx = spy.mock.calls[0]![0]!;
    expect(ctx.selectedColumnIds).toContain("a");

    grid.destroy();
    container.remove();
  });
});

describe("multi-column pin from column menu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pin-right on selected columns pins all selected and fires one event", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        { field: "a", pinned: "left" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ],
      undefined,
      {
        columnSelection: {
          enabled: true,
          enableHeaderClickSelection: true,
          mode: "multiple",
        },
        onColumnPinChanged,
      },
    );
    await flushRenders();

    // Select columns b and c via header clicks
    headerCell(root(), "b")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();
    headerCell(root(), "c")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, metaKey: true }),
    );
    await flushRenders();

    // Open menu on column b (which is selected)
    openMenu(root(), "b");
    await flushRenders();

    // Click pin-right
    clickMenuItem(root(), "pin-right");
    await flushRenders();

    // Verify: one event fired with both columns changed
    expect(onColumnPinChanged).toHaveBeenCalledTimes(1);
    const event = onColumnPinChanged.mock.calls[0]![0]!;
    expect(event.changedColumns).toBeDefined();
    expect(event.changedColumns!.length).toBe(2);

    const changedFields = event.changedColumns!.map((c: { field: string }) => c.field).sort();
    expect(changedFields).toEqual(["b", "c"]);

    // Verify: a is still pinned left, b and c are now pinned right
    const pinState = grid.getColumnPinState();
    const pinMap = Object.fromEntries(pinState.map((p) => [p.field, p.pinned]));
    expect(pinMap["a"]).toBe("left");
    expect(pinMap["b"]).toBe("right");
    expect(pinMap["c"]).toBe("right");

    grid.destroy();
    container.remove();
  });
});

describe("column menu render-only section", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens menu when filter section has render but no visible items", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: true } },
    );
    await flushRenders();

    openMenu(root(), "a");

    const panel = menuPanel(root());
    expect(panel).toBeTruthy();
    expect(panel!.querySelector(".lfg-filter-form")).toBeTruthy();

    grid.destroy();
    container.remove();
  });
});

describe("filter active indicator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds lfg-header-filtered class when column has active filter", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }, { field: "b", filterable: true }],
      [{ a: "hello", b: "world" }] as RowData[],
      { columnMenu: { filter: true } },
    );
    await flushRenders();

    expect(headerCell(root(), "a")!.classList.contains("lfg-header-filtered")).toBe(false);

    const model: FilterModel = {
      a: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "h" }] },
    };
    grid.setFilterModel(model);
    await flushRenders();

    expect(headerCell(root(), "a")!.classList.contains("lfg-header-filtered")).toBe(true);
    expect(headerCell(root(), "b")!.classList.contains("lfg-header-filtered")).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("removes lfg-header-filtered class when filter is cleared", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: true } },
    );
    await flushRenders();

    grid.setFilterModel({
      a: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "h" }] },
    });
    await flushRenders();
    expect(headerCell(root(), "a")!.classList.contains("lfg-header-filtered")).toBe(true);

    grid.clearFilters();
    await flushRenders();
    expect(headerCell(root(), "a")!.classList.contains("lfg-header-filtered")).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("applies custom activeIcon via CSS variable", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: { activeIcon: "F" } } },
    );
    await flushRenders();

    grid.setFilterModel({
      a: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "h" }] },
    });
    await flushRenders();

    expect(root().style.getPropertyValue("--lfg-filter-active-icon")).toBe('"F"');

    grid.destroy();
    container.remove();
  });

  it("applies lfg-header-filtered to pinned-left and pinned-right header cells", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "left", filterable: true, pinned: "left" },
        { field: "center", filterable: true },
        { field: "right", filterable: true, pinned: "right" },
      ],
      [{ left: "a", center: "b", right: "c" }] as RowData[],
      { columnMenu: { filter: true } },
    );
    await flushRenders();

    grid.setFilterModel({
      left: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "a" }] },
      right: { type: "text", operator: "and", conditions: [{ operator: "equals", value: "c" }] },
    });
    await flushRenders();

    expect(headerCell(root(), "left")!.classList.contains("lfg-header-filtered")).toBe(true);
    expect(headerCell(root(), "right")!.classList.contains("lfg-header-filtered")).toBe(true);
    expect(headerCell(root(), "center")!.classList.contains("lfg-header-filtered")).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("asc sort + filter gives both lfg-header-sorted-asc and lfg-header-filtered", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true, sortable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: true } },
    );
    await flushRenders();

    grid.setSortModel([{ field: "a", sort: "asc" }]);
    grid.setFilterModel({
      a: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "h" }] },
    });
    await flushRenders();

    const cell = headerCell(root(), "a")!;
    expect(cell.classList.contains("lfg-header-sorted-asc")).toBe(true);
    expect(cell.classList.contains("lfg-header-sorted-desc")).toBe(false);
    expect(cell.classList.contains("lfg-header-filtered")).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("desc sort + filter gives both lfg-header-sorted-desc and lfg-header-filtered", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true, sortable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: true } },
    );
    await flushRenders();

    grid.setSortModel([{ field: "a", sort: "desc" }]);
    grid.setFilterModel({
      a: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "h" }] },
    });
    await flushRenders();

    const cell = headerCell(root(), "a")!;
    expect(cell.classList.contains("lfg-header-sorted-desc")).toBe(true);
    expect(cell.classList.contains("lfg-header-sorted-asc")).toBe(false);
    expect(cell.classList.contains("lfg-header-filtered")).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("applies custom combined sort+filter icon CSS variable", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true, sortable: true }],
      [{ a: "hello" }] as RowData[],
      {
        columnMenu: {
          filter: true,
          headerIcons: { sortAscFiltered: "↑F", sortDescFiltered: "↓F" },
        },
      },
    );
    await flushRenders();

    grid.setSortModel([{ field: "a", sort: "desc" }]);
    grid.setFilterModel({
      a: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "h" }] },
    });
    await flushRenders();

    expect(root().style.getPropertyValue("--lfg-sort-asc-filtered-icon")).toBe('"↑F"');
    expect(root().style.getPropertyValue("--lfg-sort-desc-filtered-icon")).toBe('"↓F"');

    grid.destroy();
    container.remove();
  });
});

describe("dedicated filter trigger (filter.placement)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function filterTrigger(root: HTMLElement, field: string): HTMLButtonElement | null {
    const cell = headerCell(root, field);
    return cell?.querySelector(`.${FILTER_TRIGGER_CLASS}`) as HTMLButtonElement | null;
  }

  it("mainMenu renders filter form in main menu and no dedicated filter trigger", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: { placement: "mainMenu" } } },
    );
    await flushRenders();

    expect(filterTrigger(root(), "a")).toBeNull();

    openMenu(root(), "a");
    const panel = menuPanel(root());
    expect(panel).toBeTruthy();
    expect(panel!.querySelector(".lfg-filter-form")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("dedicatedMenu renders dedicated trigger and main menu does not show filter form", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true, sortable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { sort: true, filter: { placement: "dedicatedMenu" } } },
    );
    await flushRenders();

    expect(filterTrigger(root(), "a")).toBeTruthy();
    expect(filterTrigger(root(), "a")!.getAttribute("aria-label")).toBe("Filter a");
    expect(filterTrigger(root(), "a")!.getAttribute("aria-haspopup")).toBe("dialog");

    openMenu(root(), "a");
    const panel = menuPanel(root());
    expect(panel).toBeTruthy();
    expect(panel!.querySelector(".lfg-filter-form")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("both renders dedicated trigger and filter form in main menu", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: { placement: "both" } } },
    );
    await flushRenders();

    expect(filterTrigger(root(), "a")).toBeTruthy();

    openMenu(root(), "a");
    const panel = menuPanel(root());
    expect(panel).toBeTruthy();
    expect(panel!.querySelector(".lfg-filter-form")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("enabled: false renders neither filter trigger nor filter form", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { enabled: false, filter: { placement: "both" } } },
    );
    await flushRenders();

    expect(filterTrigger(root(), "a")).toBeNull();
    expect(menuTrigger(root(), "a")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("filter: false renders neither filter trigger nor filter form", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: false } },
    );
    await flushRenders();

    expect(filterTrigger(root(), "a")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("dedicated trigger opens filter-only panel for the correct column", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }, { field: "b", filterable: true }],
      [{ a: "hello", b: "world" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu" } } },
    );
    await flushRenders();

    const trigger = filterTrigger(root(), "b")!;
    expect(trigger).toBeTruthy();

    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await flushRenders();

    const filterPanel = root().querySelector(`.${FILTER_PANEL_CLASS}`);
    expect(filterPanel).toBeTruthy();
    expect(filterPanel!.getAttribute("data-col-id")).toBe("b");
    expect(filterPanel!.querySelector(".lfg-filter-form")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("pinned left and right filterable headers get the dedicated trigger", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "left", filterable: true, pinned: "left" },
        { field: "center", filterable: true },
        { field: "right", filterable: true, pinned: "right" },
      ],
      [{ left: "a", center: "b", right: "c" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu" } } },
    );
    await flushRenders();

    expect(filterTrigger(root(), "left")).toBeTruthy();
    expect(filterTrigger(root(), "center")).toBeTruthy();
    expect(filterTrigger(root(), "right")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("runtime change from mainMenu to dedicatedMenu shows working trigger", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: { placement: "mainMenu" } } },
    );
    await flushRenders();

    expect(filterTrigger(root(), "a")).toBeNull();

    grid.setColumnMenu({ filter: { placement: "dedicatedMenu" } });
    await flushRenders();

    const trigger = filterTrigger(root(), "a");
    expect(trigger).toBeTruthy();

    trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await flushRenders();

    const panel = root().querySelector(`.${FILTER_PANEL_CLASS}`);
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute("data-col-id")).toBe("a");

    grid.destroy();
    container.remove();
  });

  it("runtime change away from dedicatedMenu removes the trigger", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu" } } },
    );
    await flushRenders();

    expect(filterTrigger(root(), "a")).toBeTruthy();

    grid.setColumnMenu({ filter: { placement: "mainMenu" } });
    await flushRenders();

    expect(filterTrigger(root(), "a")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("dedicated trigger has aria-expanded false initially, true while open, false after close", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu" } } },
    );
    await flushRenders();

    expect(filterTrigger(root(), "a")!.getAttribute("aria-expanded")).toBe("false");

    filterTrigger(root(), "a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(filterTrigger(root(), "a")!.getAttribute("aria-expanded")).toBe("true");

    filterTrigger(root(), "a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(filterTrigger(root(), "a")!.getAttribute("aria-expanded")).toBe("false");

    grid.destroy();
    container.remove();
  });

  it("switching from column A trigger to column B resets A aria-expanded and opens B panel", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "a", filterable: true },
        { field: "b", filterable: true },
      ],
      [{ a: "hello", b: "world" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu" } } },
    );
    await flushRenders();

    filterTrigger(root(), "a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(filterTrigger(root(), "a")!.getAttribute("aria-expanded")).toBe("true");
    expect(root().querySelector(`.${FILTER_PANEL_CLASS}[data-col-id="a"]`)).toBeTruthy();

    filterTrigger(root(), "b")!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(filterTrigger(root(), "a")!.getAttribute("aria-expanded")).toBe("false");
    expect(filterTrigger(root(), "b")!.getAttribute("aria-expanded")).toBe("true");
    expect(root().querySelector(`.${FILTER_PANEL_CLASS}[data-col-id="a"]`)).toBeNull();
    expect(root().querySelector(`.${FILTER_PANEL_CLASS}[data-col-id="b"]`)).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("handles selector-unsafe column field ids for aria-expanded", async () => {
    const weirdField = 'a"b]c';

    function findTriggerByAttr(root: HTMLElement, field: string): HTMLButtonElement | null {
      const all = root.querySelectorAll(`.${FILTER_TRIGGER_CLASS}`);
      for (let i = 0; i < all.length; i++) {
        if (all[i]!.getAttribute("data-col-id") === field) return all[i] as HTMLButtonElement;
      }
      return null;
    }

    function findPanelByAttr(root: HTMLElement, field: string): HTMLElement | null {
      const all = root.querySelectorAll(`.${FILTER_PANEL_CLASS}`);
      for (let i = 0; i < all.length; i++) {
        if (all[i]!.getAttribute("data-col-id") === field) return all[i] as HTMLElement;
      }
      return null;
    }

    const { grid, container, root } = makeGrid(
      [{ field: weirdField, filterable: true }],
      [{ [weirdField]: "hello" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu" } } },
    );
    await flushRenders();

    const trigger = findTriggerByAttr(root(), weirdField);
    expect(trigger).toBeTruthy();
    expect(trigger!.getAttribute("aria-expanded")).toBe("false");

    trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(findTriggerByAttr(root(), weirdField)!.getAttribute("aria-expanded")).toBe("true");
    expect(findPanelByAttr(root(), weirdField)).toBeTruthy();

    findTriggerByAttr(root(), weirdField)!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(findTriggerByAttr(root(), weirdField)!.getAttribute("aria-expanded")).toBe("false");
    expect(findPanelByAttr(root(), weirdField)).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("runtime placement change away from dedicatedMenu closes open filter panel", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu" } } },
    );
    await flushRenders();

    filterTrigger(root(), "a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(root().querySelector(`.${FILTER_PANEL_CLASS}`)).toBeTruthy();

    grid.setColumnMenu({ filter: { placement: "mainMenu" } });
    await flushRenders();

    expect(root().querySelector(`.${FILTER_PANEL_CLASS}`)).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("runtime placement change away from dedicatedMenu closes pinned filter panel and clears trigger state", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "left", filterable: true, pinned: "left" },
        { field: "center", filterable: true },
      ],
      [{ left: "hello", center: "world" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu" } } },
    );
    await flushRenders();

    const trigger = filterTrigger(root(), "left");
    expect(trigger).toBeTruthy();
    expect(trigger!.getAttribute("aria-expanded")).toBe("false");

    trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await flushRenders();

    expect(root().querySelector(`.${FILTER_PANEL_CLASS}[data-col-id="left"]`)).toBeTruthy();
    expect(trigger!.getAttribute("aria-expanded")).toBe("true");

    grid.setColumnMenu({ filter: { placement: "mainMenu" } });
    await flushRenders();

    expect(root().querySelector(`.${FILTER_PANEL_CLASS}`)).toBeNull();
    expect(filterTrigger(root(), "left")).toBeNull();
    expect(headerCell(root(), "left")?.querySelector('[aria-expanded="true"]')).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("dedicatedMenu + headerIcons.filtered sets --lfg-filter-active-icon", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu" }, headerIcons: { filtered: "F" } } },
    );
    await flushRenders();

    grid.setFilterModel({
      a: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "h" }] },
    });
    await flushRenders();

    expect(root().style.getPropertyValue("--lfg-filter-active-icon")).toBe('"F"');
    expect(root().style.getPropertyValue("--lfg-filter-trigger-mask")).toBe("none");
    expect(root().style.getPropertyValue("--lfg-filter-trigger-icon-paint")).toBe(
      "transparent",
    );

    grid.destroy();
    container.remove();
  });

  it("dedicatedMenu + filter.activeIcon sets --lfg-filter-active-icon", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu", activeIcon: "F" } } },
    );
    await flushRenders();

    grid.setFilterModel({
      a: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "h" }] },
    });
    await flushRenders();

    expect(root().style.getPropertyValue("--lfg-filter-active-icon")).toBe('"F"');
    expect(root().style.getPropertyValue("--lfg-filter-trigger-mask")).toBe("none");
    expect(root().style.getPropertyValue("--lfg-filter-trigger-icon-paint")).toBe(
      "transparent",
    );

    grid.destroy();
    container.remove();
  });

  it("dedicatedMenu adds lfg-header-filter-active but not lfg-header-filtered", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu" } } },
    );
    await flushRenders();

    grid.setFilterModel({
      a: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "h" }] },
    });
    await flushRenders();

    const cell = headerCell(root(), "a")!;
    expect(cell.classList.contains("lfg-header-filter-active")).toBe(true);
    expect(cell.classList.contains("lfg-header-filtered")).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("outside click resets aria-expanded on active trigger", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu" } } },
    );
    await flushRenders();

    filterTrigger(root(), "a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(filterTrigger(root(), "a")!.getAttribute("aria-expanded")).toBe("true");

    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await flushRenders();

    expect(filterTrigger(root(), "a")!.getAttribute("aria-expanded")).toBe("false");

    grid.destroy();
    container.remove();
  });

  it("boolean filter column with valueFormatter does not throw", async () => {
    const formatter = vi.fn(({ value }: { value: unknown; row: unknown }) => {
      return value === true ? "Yes" : "No";
    });
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true, filter: "boolean", valueFormatter: formatter as never }],
      [{ a: true }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu" } } },
    );
    await flushRenders();

    filterTrigger(root(), "a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await flushRenders();

    expect(root().querySelector(`.${FILTER_PANEL_CLASS}`)).toBeTruthy();
    if (formatter.mock.calls.length > 0) {
      const rowArg = formatter.mock.calls[0]![0].row;
      expect(rowArg).not.toBeNull();
      expect(rowArg).not.toBeUndefined();
      expect(typeof rowArg).toBe("object");
    }

    grid.destroy();
    container.remove();
  });

  it("mainMenu still applies sortAscFiltered and sortDescFiltered variables", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true, sortable: true }],
      [{ a: "hello" }] as RowData[],
      {
        columnMenu: {
          filter: { placement: "mainMenu" },
          headerIcons: { sortAscFiltered: "↑F", sortDescFiltered: "↓F" },
        },
      },
    );
    await flushRenders();

    grid.setSortModel([{ field: "a", sort: "asc" }]);
    grid.setFilterModel({
      a: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "h" }] },
    });
    await flushRenders();

    expect(root().style.getPropertyValue("--lfg-sort-asc-filtered-icon")).toBe('"↑F"');
    expect(root().style.getPropertyValue("--lfg-sort-desc-filtered-icon")).toBe('"↓F"');

    grid.destroy();
    container.remove();
  });
});

describe("filter selection cell-shell previews", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function filterTrigger(root: HTMLElement, field: string): HTMLButtonElement | null {
    const cell = headerCell(root, field);
    return cell?.querySelector(`.${FILTER_TRIGGER_CLASS}`) as HTMLButtonElement | null;
  }

  it("main menu renders cell-shell previews for filter selection values", async () => {
    const { grid, container, root } = makeGrid(
      [
        {
          field: "status",
          filterable: true,
          cellShell: { kind: "badge", icon: "S", tone: { map: { Active: "success" } } },
        },
      ],
      [{ status: "Active" }, { status: "Inactive" }, { status: "Active" }] as RowData[],
      { columnMenu: { filter: { placement: "mainMenu", selectionList: { enabled: true } } } },
    );
    await flushRenders();

    openMenu(root(), "status");
    await flushRenders();

    const list = menuPanel(root())!.querySelector(".lfg-filter-selection-list")!;
    const preview = list.querySelector(".lfg-cell-shell-preview");
    expect(preview).toBeTruthy();
    expect(preview!.classList.contains("lfg-cell-shell-badge")).toBe(true);
    expect(preview!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Active");
    expect(preview!.querySelector(".lfg-cell-shell-icon")!.textContent).toBe("S");

    grid.destroy();
    container.remove();
  });

  it("main menu renders progress selection previews from formatted display values", async () => {
    const { grid, container, root } = makeGrid(
      [
        {
          field: "jan",
          filter: "text",
          filterable: true,
          cellShell: { kind: "progress" },
          valueGetter: ({ row }: { row: RowData }) => Math.round((Number(row.jan) / 100000) * 100),
          valueFormatter: ({ value }: { value: unknown }) => `${String(value)}%`,
        },
      ],
      [{ jan: 38031 }, { jan: 30000 }] as RowData[],
      { columnMenu: { filter: { placement: "mainMenu", selectionList: { enabled: true } } } },
    );
    await flushRenders();

    openMenu(root(), "jan");
    await flushRenders();

    const list = menuPanel(root())!.querySelector(".lfg-filter-selection-list")!;
    const preview = list.querySelector(".lfg-cell-shell-progress") as HTMLElement | null;
    expect(preview).toBeTruthy();
    expect(preview!.getAttribute("data-value")).toBe("38");
    expect(preview!.style.getPropertyValue("--lfg-cell-shell-progress-ratio")).toBe("0.38");
    expect(preview!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("38%");
    expect(list.textContent).toContain("30%");
    expect(list.textContent).not.toContain("38031");

    grid.destroy();
    container.remove();
  });

  it("filter selection values fall back to plain labels without cellShell", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "status", filterable: true }],
      [{ status: "Active" }, { status: "Inactive" }] as RowData[],
      { columnMenu: { filter: { placement: "mainMenu", selectionList: { enabled: true } } } },
    );
    await flushRenders();

    openMenu(root(), "status");
    await flushRenders();

    const list = menuPanel(root())!.querySelector(".lfg-filter-selection-list")!;
    expect(list.querySelector(".lfg-cell-shell-preview")).toBeNull();
    expect(list.textContent).toContain("Active");

    grid.destroy();
    container.remove();
  });

  it("interactive cell-shell selection values fall back to text without buttons", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "status", filterable: true, cellShell: { kind: "button", actionKey: "edit" } }],
      [{ status: "Active" }, { status: "Inactive" }] as RowData[],
      { columnMenu: { filter: { placement: "mainMenu", selectionList: { enabled: true } } } },
    );
    await flushRenders();

    openMenu(root(), "status");
    await flushRenders();

    const list = menuPanel(root())!.querySelector(".lfg-filter-selection-list")!;
    expect(list.querySelector(".lfg-cell-shell-preview")).toBeNull();
    expect(list.querySelector("button")).toBeNull();
    expect(list.textContent).toContain("Active");

    grid.destroy();
    container.remove();
  });

  it("dedicated menu renders cell-shell previews for filter selection values", async () => {
    const { grid, container, root } = makeGrid(
      [
        {
          field: "status",
          filterable: true,
          cellShell: { kind: "iconText", icon: "A" },
        },
      ],
      [{ status: "Active" }, { status: "Inactive" }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu", selectionList: { enabled: true } } } },
    );
    await flushRenders();

    filterTrigger(root(), "status")!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await flushRenders();

    const list = root().querySelector(`.${FILTER_PANEL_CLASS} .lfg-filter-selection-list`)!;
    const preview = list.querySelector(".lfg-cell-shell-preview");
    expect(preview).toBeTruthy();
    expect(preview!.classList.contains("lfg-cell-shell-icon-text")).toBe(true);
    expect(preview!.querySelector(".lfg-cell-shell-icon")!.textContent).toBe("A");

    grid.destroy();
    container.remove();
  });

  it("dedicated menu renders formatted progress selection previews and search", async () => {
    const { grid, container, root } = makeGrid(
      [
        {
          field: "jan",
          filter: "text",
          filterable: true,
          cellShell: { kind: "progress" },
          valueGetter: ({ row }: { row: RowData }) => Math.round((Number(row.jan) / 100000) * 100),
          valueFormatter: ({ value }: { value: unknown }) => `${String(value)}%`,
        },
      ],
      [{ jan: 38031 }, { jan: 30000 }, { jan: 50000 }] as RowData[],
      { columnMenu: { filter: { placement: "dedicatedMenu", selectionList: { enabled: true } } } },
    );
    await flushRenders();

    filterTrigger(root(), "jan")!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await flushRenders();

    const panel = root().querySelector(`.${FILTER_PANEL_CLASS}`)!;
    const list = panel.querySelector(".lfg-filter-selection-list")!;
    const preview = list.querySelector(".lfg-cell-shell-progress") as HTMLElement | null;
    expect(preview).toBeTruthy();
    expect(preview!.getAttribute("data-value")).toBe("38");
    expect(preview!.style.getPropertyValue("--lfg-cell-shell-progress-ratio")).toBe("0.38");
    expect(preview!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("38%");
    expect(list.textContent).toContain("50%");
    expect(list.textContent).not.toContain("38031");

    const searchInput = panel.querySelector(".lfg-filter-selection-search") as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    searchInput.value = "30%";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    await flushRenders();

    expect(list.textContent).toContain("30%");
    expect(list.textContent).not.toContain("38%");
    expect(list.textContent).not.toContain("50%");

    grid.destroy();
    container.remove();
  });
});

describe("floating-filter trigger opens advanced filter with selection list", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("floating-filter trigger under default/mainMenu placement renders condition UI and selection list", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", filterable: true }],
      [{ a: "hello" }, { a: "world" }] as RowData[],
      {
        floatingFilters: true,
        columnMenu: {
          filter: {
            placement: "mainMenu",
            selectionList: { enabled: true },
          },
        },
      },
    );
    await flushRenders();

    const floatingTrigger = root().querySelector(
      `.lfg-floating-filter-cell .${FILTER_TRIGGER_CLASS}`,
    ) as HTMLButtonElement | null;
    expect(floatingTrigger).toBeTruthy();

    floatingTrigger!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    const panel = root().querySelector(`.${FILTER_PANEL_CLASS}`);
    expect(panel).toBeTruthy();
    expect(
      panel!.querySelector(".lfg-filter-form"),
    ).toBeTruthy();
    expect(
      panel!.querySelector(".lfg-filter-selection-list"),
    ).toBeTruthy();

    grid.destroy();
    container.remove();
  });
});

describe("Accessibility V2 keyboard column menu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("172, 174-175: opens from the retained header trigger and restores its invoker", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a", sortable: true },
      { field: "b", sortable: true },
    ]);
    await flushRenders();
    const surface = root().querySelector<HTMLElement>(".lfg-grid-surface")!;
    const header = headerCell(root(), "a")!;
    const trigger = menuTrigger(root(), "a")!;
    header.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );

    const open = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    surface.dispatchEvent(open);
    expect(open.defaultPrevented).toBe(true);
    await Promise.resolve();

    const panel = menuPanel(root())!;
    const firstItem = panel.querySelector<HTMLButtonElement>(
      `.${MENU_ITEM_CLASS}:not([disabled])`,
    )!;
    expect(document.activeElement).toBe(firstItem);
    firstItem.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(menuPanel(root())).toBeNull();
    expect(document.activeElement).toBe(trigger);

    surface.focus();
    surface.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
    const reopenedItems = menuItems(root()).filter((item) => !item.disabled);
    const lastItem = reopenedItems[reopenedItems.length - 1]!;
    lastItem.focus();
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    lastItem.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(menuPanel(root())).toBeNull();
    expect(document.activeElement).toBe(trigger);

    grid.destroy();
    container.remove();
  });
});
