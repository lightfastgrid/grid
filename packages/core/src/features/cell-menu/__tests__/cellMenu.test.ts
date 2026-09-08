// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import type {
  CellMenuActionContext,
  CellMenuContext,
  CellMenuItem,
  CellMenuOptions,
  CellMenuTriggerButtonConfig,
  ColumnDef,
  RowData,
} from "../../../types";
import { BUILT_IN_FEATURE_FACTORIES } from "../../registry";
import { CellMenuController } from "../CellMenuController";
import {
  CELL_MENU_TRIGGER_CLASS,
  CELL_MENU_TRIGGER_VISIBLE_CLASS,
} from "../cellMenuDom";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────

function makeColumns(): ColumnDef[] {
  return [
    { field: "id" },
    { field: "name" },
  ];
}

function makeData(): RowData[] {
  return [
    { id: "1", name: "Alice" },
    { id: "2", name: "Bob" },
  ];
}

function makeActions(): CellMenuItem[] {
  return [
    { id: "copy", label: "Copy" },
    { id: "delete", label: "Delete" },
  ];
}

interface ControllerHarness {
  root: HTMLElement;
  controller: CellMenuController;
  onAction: ReturnType<typeof vi.fn>;
  getActions: ReturnType<typeof vi.fn>;
  getCellMenuOptions: () => CellMenuOptions | undefined;
  cellMenuOptions: CellMenuOptions;
}

function createHarness(overrides?: Partial<CellMenuOptions>): ControllerHarness {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  root.appendChild(viewport);

  const onAction = vi.fn();
  const getActions = vi.fn().mockReturnValue(makeActions());

  const cellMenuOptions: CellMenuOptions = {
    enabled: true,
    trigger: "contextmenu",
    getActions,
    onAction,
    ...overrides,
  };

  const controller = new CellMenuController({
    gridRoot: root,
    viewport,
    getColumns: makeColumns,
    getDisplayRows: () => createArrayDisplayRowReader(makeData()),
    resolveRowId: (row) => String((row as Record<string, unknown>).id),
    getCellMenuOptions: () => cellMenuOptions,
    getCellMenuGridApi: () => ({ getRows: () => makeData().slice() }),
  });

  controller.attach(root);

  return { root, controller, onAction, getActions, getCellMenuOptions: () => cellMenuOptions, cellMenuOptions };
}

/**
 * Build a fake body row with cells mirroring the real grid DOM structure.
 * Row element has `.lfg-row`, data-row-id, data-row-index.
 * Each cell has `.lfg-cell` and data-col-id.
 */
function buildRow(
  rowId: string,
  rowIndex: number,
  fields: string[],
): HTMLElement {
  const row = document.createElement("div");
  row.className = "lfg-row";
  row.setAttribute("role", "row");
  row.setAttribute("data-row-id", rowId);
  row.setAttribute("data-row-index", String(rowIndex));

  for (const field of fields) {
    const cell = document.createElement("div");
    cell.className = "lfg-cell";
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("data-col-id", field);
    cell.textContent = `${field}-value`;
    row.appendChild(cell);
  }

  return row;
}

function buildHeaderRow(fields: string[]): HTMLElement {
  const header = document.createElement("div");
  header.className = "lfg-header";

  const headerRow = document.createElement("div");
  headerRow.className = "lfg-header-row";

  for (const field of fields) {
    const cell = document.createElement("div");
    cell.className = "lfg-header-cell";
    cell.setAttribute("data-col-id", field);
    cell.textContent = field;
    headerRow.appendChild(cell);
  }

  header.appendChild(headerRow);
  return header;
}

function fireContextMenu(target: HTMLElement): MouseEvent {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

// ── Config plumbing tests ──────────────────────────────────────

describe("cell menu config plumbing", () => {
  it("GridConfig receives cellMenu from props", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    const cellMenu: CellMenuOptions = {
      enabled: true,
      trigger: "contextmenu",
      getActions: () => [{ id: "copy", label: "Copy" }],
      onAction: () => {},
    };

    const grid = new Grid({
      rows: [{ id: "1", name: "Alice" }] as RowData[],
      columns: [{ field: "id" }, { field: "name" }],
      cellMenu,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    // Verify config is accessible through the grid (it was passed to GridContext)
    // We test this indirectly: the grid mounted without errors and cellMenu was accepted
    expect(grid).toBeDefined();

    grid.destroy();
    container.remove();
  });

  it("setCellMenu updates cellMenu without remounting grid", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "1", name: "Alice" }] as RowData[],
      columns: [{ field: "id" }, { field: "name" }],
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    // Update cellMenu through its dedicated adaptor setter.
    const newCellMenu: CellMenuOptions = {
      enabled: true,
      trigger: "button",
      getActions: () => [{ id: "delete", label: "Delete" }],
      onAction: () => {},
    };
    grid.setCellMenu(newCellMenu);

    // Grid is still alive
    expect(grid).toBeDefined();

    grid.destroy();
    container.remove();
  });
});

describe("cell menu feature registry", () => {
  it("built-in feature registry includes cell-menu", () => {
    const names = BUILT_IN_FEATURE_FACTORIES.map((f) => f.name);
    expect(names).toContain("cell-menu");
  });
});

// ── CellMenuController attach/detach tests ─────────────────────

describe("CellMenuController", () => {
  it("attach and detach do not throw", () => {
    const root = document.createElement("div");
    const viewport = document.createElement("div");
    const gridRoot = document.createElement("div");

    const controller = new CellMenuController({
      gridRoot,
      viewport,
      getColumns: () => [],
      getDisplayRows: () => createArrayDisplayRowReader([]),
      resolveRowId: (_row, index) => String(index),
      getCellMenuOptions: () => undefined,
      getCellMenuGridApi: () => ({ getRows: () => [] }),
    });

    expect(() => { controller.attach(root); }).not.toThrow();
    expect(() => { controller.detach(); }).not.toThrow();
  });

  it("double detach does not throw", () => {
    const root = document.createElement("div");
    const viewport = document.createElement("div");
    const gridRoot = document.createElement("div");

    const controller = new CellMenuController({
      gridRoot,
      viewport,
      getColumns: () => [],
      getDisplayRows: () => createArrayDisplayRowReader([]),
      resolveRowId: (_row, index) => String(index),
      getCellMenuOptions: () => undefined,
      getCellMenuGridApi: () => ({ getRows: () => [] }),
    });

    controller.attach(root);
    controller.detach();
    expect(() => { controller.detach(); }).not.toThrow();
  });
});

// ── Contextmenu event delegation ───────────────────────────────

describe("cell menu contextmenu event delegation", () => {
  it("opens menu on right-click of eligible body cell", () => {
    const { root, getActions } = createHarness();
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    const event = fireContextMenu(cell as HTMLElement);

    expect(event.defaultPrevented).toBe(true);
    expect(getActions).toHaveBeenCalledTimes(1);

    // Verify context passed to getActions
    const ctx: CellMenuContext = getActions.mock.calls[0]![0];
    expect(ctx.field).toBe("name");
    expect(ctx.rowId).toBe("1");
    expect(ctx.rowIndex).toBe(0);
    expect(ctx.value).toBe("Alice");
    expect(ctx.column.field).toBe("name");
    const panel = root.querySelector(".lfg-cell-menu-panel") as HTMLElement;
    expect(panel.getAttribute("role")).toBe("menu");
    expect(panel.getAttribute("aria-label")).toBe("name cell menu");
    expect(panel.hasAttribute("aria-modal")).toBe(false);
    expect(root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`)).toBeNull();
  });

  it("does NOT open menu when cellMenu is disabled", () => {
    const { root, getActions } = createHarness({ enabled: false });
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    const event = fireContextMenu(cell as HTMLElement);

    expect(event.defaultPrevented).toBe(false);
    expect(getActions).not.toHaveBeenCalled();
  });

  it("does NOT open menu when trigger is button-only", () => {
    const { root, getActions } = createHarness({ trigger: "button" });
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    const event = fireContextMenu(cell as HTMLElement);

    expect(event.defaultPrevented).toBe(false);
    expect(getActions).not.toHaveBeenCalled();
  });

  it("opens menu when trigger is contextmenu-and-button", () => {
    const { root, getActions } = createHarness({ trigger: "contextmenu-and-button" });
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell as HTMLElement);

    expect(getActions).toHaveBeenCalledTimes(1);
  });

  it("ignores right-click on header cells", () => {
    const { root, getActions } = createHarness();
    const header = buildHeaderRow(["id", "name"]);
    root.appendChild(header);

    // Also add a body cell so we have `.lfg-cell` that is inside the header.
    // The header cell class is different, but let's put a `.lfg-cell` inside header to test.
    const fakeCellInHeader = document.createElement("div");
    fakeCellInHeader.className = "lfg-cell";
    fakeCellInHeader.setAttribute("data-col-id", "name");

    const fakeRow = document.createElement("div");
    fakeRow.className = "lfg-row";
    fakeRow.setAttribute("data-row-id", "1");
    fakeRow.setAttribute("data-row-index", "0");
    fakeRow.appendChild(fakeCellInHeader);
    header.appendChild(fakeRow);

    fireContextMenu(fakeCellInHeader);
    expect(getActions).not.toHaveBeenCalled();
  });

  it("ignores right-click on selection column cells", () => {
    const selectionCol: ColumnDef = { field: "__selection", internal: "selection" };
    const nameCol: ColumnDef = { field: "name" };

    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);

    const getActions = vi.fn().mockReturnValue(makeActions());
    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: () => [selectionCol, nameCol],
      getDisplayRows: () => createArrayDisplayRowReader(makeData()),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "contextmenu",
        getActions,
        onAction: vi.fn(),
      }),
      getCellMenuGridApi: () => ({ getRows: () => makeData().slice() }),
    });
    controller.attach(root);

    const row = buildRow("1", 0, ["__selection", "name"]);
    root.appendChild(row);

    const selCell = row.querySelector('[data-col-id="__selection"]')!;
    fireContextMenu(selCell as HTMLElement);
    expect(getActions).not.toHaveBeenCalled();

    controller.detach();
  });

  it("ignores right-click on action-kind column cells", () => {
    const actionsCol: ColumnDef = { field: "actions", cellKind: "actions" };
    const nameCol: ColumnDef = { field: "name" };

    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);

    const getActions = vi.fn().mockReturnValue(makeActions());
    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: () => [actionsCol, nameCol],
      getDisplayRows: () => createArrayDisplayRowReader(makeData()),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "contextmenu",
        getActions,
        onAction: vi.fn(),
      }),
      getCellMenuGridApi: () => ({ getRows: () => makeData().slice() }),
    });
    controller.attach(root);

    const row = buildRow("1", 0, ["actions", "name"]);
    root.appendChild(row);

    const actCell = row.querySelector('[data-col-id="actions"]')!;
    fireContextMenu(actCell as HTMLElement);
    expect(getActions).not.toHaveBeenCalled();

    controller.detach();
  });

  it("does NOT open menu when getActions returns empty array", () => {
    const { root, getActions } = createHarness();
    getActions.mockReturnValue([]);

    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    const event = fireContextMenu(cell as HTMLElement);

    // getActions is called, but menu doesn't open — no preventDefault
    expect(getActions).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it("does NOT open menu when all actions are hidden", () => {
    const { root, getActions } = createHarness();
    getActions.mockReturnValue([
      { id: "copy", label: "Copy", hidden: true },
      { id: "delete", label: "Delete", hidden: true },
    ]);

    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    const event = fireContextMenu(cell as HTMLElement);

    expect(event.defaultPrevented).toBe(false);
  });

  it("filters hidden actions before rendering", () => {
    const { root, getActions } = createHarness();
    getActions.mockReturnValue([
      { id: "copy", label: "Copy" },
      { id: "secret", label: "Secret", hidden: true },
      { id: "delete", label: "Delete" },
    ]);

    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell as HTMLElement);

    // Menu should be rendered — check that panel exists with 2 visible items
    const panel = root.querySelector(".lfg-cell-menu-panel");
    expect(panel).not.toBeNull();

    const items = panel!.querySelectorAll(".lfg-cell-menu-item");
    expect(items.length).toBe(2);
  });

  it("renders menu panel with correct CSS classes", () => {
    const { root } = createHarness();
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell as HTMLElement);

    const panel = root.querySelector(".lfg-cell-menu-panel");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("role")).toBe("menu");

    const items = panel!.querySelectorAll(".lfg-cell-menu-item");
    expect(items.length).toBe(2);
    expect(items[0]!.getAttribute("data-menu-action")).toBe("copy");
    expect(items[1]!.getAttribute("data-menu-action")).toBe("delete");
  });

  it("calls onAction with correct context when menu item clicked", () => {
    const { root, onAction } = createHarness();
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell as HTMLElement);

    const copyBtn = root.querySelector('[data-menu-action="copy"]') as HTMLElement;
    expect(copyBtn).not.toBeNull();

    copyBtn.click();

    expect(onAction).toHaveBeenCalledTimes(1);
    const actionCtx: CellMenuActionContext = onAction.mock.calls[0]![0];
    expect(actionCtx.actionId).toBe("copy");
    expect(actionCtx.action.id).toBe("copy");
    expect(actionCtx.field).toBe("name");
    expect(actionCtx.rowId).toBe("1");
    expect(actionCtx.value).toBe("Alice");
    expect(typeof actionCtx.close).toBe("function");
  });

  it("uses valueGetter when defined on column", () => {
    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);

    const getActions = vi.fn().mockReturnValue(makeActions());
    const valueGetter = vi.fn().mockReturnValue("computed-value");

    const columns: ColumnDef[] = [
      { field: "id" },
      { field: "name", valueGetter },
    ];

    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: () => columns,
      getDisplayRows: () => createArrayDisplayRowReader(makeData()),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "contextmenu",
        getActions,
        onAction: vi.fn(),
      }),
      getCellMenuGridApi: () => ({ getRows: () => makeData().slice() }),
    });
    controller.attach(root);

    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell as HTMLElement);

    const ctx: CellMenuContext = getActions.mock.calls[0]![0];
    expect(ctx.value).toBe("computed-value");
    expect(valueGetter).toHaveBeenCalled();

    controller.detach();
  });

  it("resolves row by id fallback when index is stale", () => {
    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);

    const getActions = vi.fn().mockReturnValue(makeActions());
    // Data is [Alice, Bob] but row element says index=0, id="2" (stale — Bob moved to index 0)
    const data: RowData[] = [
      { id: "2", name: "Bob" },
      { id: "1", name: "Alice" },
    ];

    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: makeColumns,
      getDisplayRows: () => createArrayDisplayRowReader(data),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "contextmenu",
        getActions,
        onAction: vi.fn(),
      }),
      getCellMenuGridApi: () => ({ getRows: () => data }),
    });
    controller.attach(root);

    // Row element has stale index=1, but id="2" which is now at index 0
    const row = buildRow("2", 1, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell as HTMLElement);

    expect(getActions).toHaveBeenCalledTimes(1);
    const ctx: CellMenuContext = getActions.mock.calls[0]![0];
    expect(ctx.rowId).toBe("2");
    expect(ctx.rowIndex).toBe(0); // Resolved to actual index via id scan
    expect(ctx.row).toBe(data[0]); // The Bob row

    controller.detach();
  });

  it("does not open menu after detach", () => {
    const { root, controller, getActions } = createHarness();
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    controller.detach();

    const cell = row.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell as HTMLElement);

    expect(getActions).not.toHaveBeenCalled();
  });

  it("ignores right-click outside any cell", () => {
    const { root, getActions } = createHarness();
    // Click directly on root, not on a cell
    fireContextMenu(root);
    expect(getActions).not.toHaveBeenCalled();
  });

  it("ignores right-click on cell without data-col-id", () => {
    const { root, getActions } = createHarness();
    const row = document.createElement("div");
    row.className = "lfg-row";
    row.setAttribute("data-row-id", "1");
    row.setAttribute("data-row-index", "0");

    const cell = document.createElement("div");
    cell.className = "lfg-cell";
    // No data-col-id attribute
    row.appendChild(cell);
    root.appendChild(row);

    fireContextMenu(cell);
    expect(getActions).not.toHaveBeenCalled();
  });

  it("passes grid API in context", () => {
    const { root, getActions } = createHarness();
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell as HTMLElement);

    const ctx: CellMenuContext = getActions.mock.calls[0]![0];
    expect(ctx.grid).toBeDefined();
    expect(typeof ctx.grid.getRows).toBe("function");
  });
});

// ── Pinned columns & virtualization ────────────────────────────

/**
 * Build a pinned-left row mirroring real grid DOM: `lfg-pinned-row` class,
 * data-row-id, data-row-index, cells with `.lfg-cell` + data-col-id + data-pinned="left".
 */
function buildPinnedLeftRow(
  rowId: string,
  rowIndex: number,
  fields: string[],
): HTMLElement {
  const row = document.createElement("div");
  row.className = "lfg-pinned-row";
  row.setAttribute("role", "row");
  row.setAttribute("data-row-id", rowId);
  row.setAttribute("data-row-index", String(rowIndex));

  for (const field of fields) {
    const cell = document.createElement("div");
    cell.className = "lfg-cell";
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("data-col-id", field);
    cell.setAttribute("data-pinned", "left");
    cell.textContent = `${field}-value`;
    row.appendChild(cell);
  }

  return row;
}

/**
 * Build a pinned-right row: `lfg-pinned-right-row` class.
 */
function buildPinnedRightRow(
  rowId: string,
  rowIndex: number,
  fields: string[],
): HTMLElement {
  const row = document.createElement("div");
  row.className = "lfg-pinned-right-row";
  row.setAttribute("role", "row");
  row.setAttribute("data-row-id", rowId);
  row.setAttribute("data-row-index", String(rowIndex));

  for (const field of fields) {
    const cell = document.createElement("div");
    cell.className = "lfg-cell";
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("data-col-id", field);
    cell.setAttribute("data-pinned", "right");
    cell.textContent = `${field}-value`;
    row.appendChild(cell);
  }

  return row;
}

describe("cell menu — pinned columns", () => {
  it("opens from pinned-left cell", () => {
    const columns: ColumnDef[] = [
      { field: "id", pinned: "left" },
      { field: "name" },
    ];

    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);

    const getActions = vi.fn().mockReturnValue(makeActions());
    const onAction = vi.fn();

    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: () => columns,
      getDisplayRows: () => createArrayDisplayRowReader(makeData()),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "contextmenu",
        getActions,
        onAction,
      }),
      getCellMenuGridApi: () => ({ getRows: () => makeData().slice() }),
    });
    controller.attach(root);

    // Pinned-left body container inside layer
    const layer = document.createElement("div");
    layer.className = "lfg-pinned-left-layer";
    const body = document.createElement("div");
    body.className = "lfg-pinned-body";
    layer.appendChild(body);
    root.appendChild(layer);

    const pinnedRow = buildPinnedLeftRow("1", 0, ["id"]);
    body.appendChild(pinnedRow);

    const cell = pinnedRow.querySelector('[data-col-id="id"]')!;
    const event = fireContextMenu(cell as HTMLElement);

    expect(event.defaultPrevented).toBe(true);
    expect(getActions).toHaveBeenCalledTimes(1);

    const ctx: CellMenuContext = getActions.mock.calls[0]![0];
    expect(ctx.field).toBe("id");
    expect(ctx.rowId).toBe("1");
    expect(ctx.rowIndex).toBe(0);
    expect(ctx.value).toBe("1");

    controller.detach();
  });

  it("opens from pinned-right cell", () => {
    const columns: ColumnDef[] = [
      { field: "id" },
      { field: "name", pinned: "right" },
    ];

    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);

    const getActions = vi.fn().mockReturnValue(makeActions());

    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: () => columns,
      getDisplayRows: () => createArrayDisplayRowReader(makeData()),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "contextmenu",
        getActions,
        onAction: vi.fn(),
      }),
      getCellMenuGridApi: () => ({ getRows: () => makeData().slice() }),
    });
    controller.attach(root);

    const layer = document.createElement("div");
    layer.className = "lfg-pinned-right-layer";
    const body = document.createElement("div");
    body.className = "lfg-pinned-right-body";
    layer.appendChild(body);
    root.appendChild(layer);

    const pinnedRow = buildPinnedRightRow("2", 1, ["name"]);
    body.appendChild(pinnedRow);

    const cell = pinnedRow.querySelector('[data-col-id="name"]')!;
    const event = fireContextMenu(cell as HTMLElement);

    expect(event.defaultPrevented).toBe(true);
    expect(getActions).toHaveBeenCalledTimes(1);

    const ctx: CellMenuContext = getActions.mock.calls[0]![0];
    expect(ctx.field).toBe("name");
    expect(ctx.rowId).toBe("2");
    expect(ctx.rowIndex).toBe(1);
    expect(ctx.value).toBe("Bob");

    controller.detach();
  });

  it("opens from center cell after horizontal scroll (different column slot)", () => {
    // Simulate a virtualized center cell that has been rebound to a new column
    // after horizontal scrolling — the data-col-id is updated by rebindCells.
    const columns: ColumnDef[] = [
      { field: "id" },
      { field: "name" },
      { field: "email" },
    ];
    const data: RowData[] = [
      { id: "1", name: "Alice", email: "alice@test.com" },
    ];

    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);

    const getActions = vi.fn().mockReturnValue(makeActions());

    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: () => columns,
      getDisplayRows: () => createArrayDisplayRowReader(data),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "contextmenu",
        getActions,
        onAction: vi.fn(),
      }),
      getCellMenuGridApi: () => ({ getRows: () => data }),
    });
    controller.attach(root);

    // After horizontal scroll, the slot now shows "email" column
    const row = buildRow("1", 0, ["email"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="email"]')!;
    fireContextMenu(cell as HTMLElement);

    expect(getActions).toHaveBeenCalledTimes(1);
    const ctx: CellMenuContext = getActions.mock.calls[0]![0];
    expect(ctx.field).toBe("email");
    expect(ctx.value).toBe("alice@test.com");

    controller.detach();
  });
});

describe("cell menu — virtualization safety", () => {
  it("scroll closes open cell menu (FloatingController closeOnScroll)", () => {
    const { root, controller } = createHarness();
    const viewport = root.querySelector("div")!; // viewport is first child

    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell as HTMLElement);

    // Menu should be open — panel exists
    expect(root.querySelector(".lfg-cell-menu-panel")).not.toBeNull();

    // Simulate scroll on viewport — FloatingController listens for scroll events
    viewport.dispatchEvent(new Event("scroll", { bubbles: false }));

    // After scroll, menu should be closed
    expect(root.querySelector(".lfg-cell-menu-panel")).toBeNull();

    controller.detach();
  });

  it("recycled stale data-row-index fallback finds correct row", () => {
    // After sort, the DOM row element has stale index but matching id.
    // The controller should fall back to id-scan.
    const data: RowData[] = [
      { id: "B", name: "Bob" },
      { id: "A", name: "Alice" },
    ];

    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);

    const getActions = vi.fn().mockReturnValue(makeActions());

    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: makeColumns,
      getDisplayRows: () => createArrayDisplayRowReader(data),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "contextmenu",
        getActions,
        onAction: vi.fn(),
      }),
      getCellMenuGridApi: () => ({ getRows: () => data }),
    });
    controller.attach(root);

    // Row element says index=0 id="A", but data[0] is Bob (id="B").
    // Should fallback-scan and find Alice at index 1.
    const row = buildRow("A", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell as HTMLElement);

    expect(getActions).toHaveBeenCalledTimes(1);
    const ctx: CellMenuContext = getActions.mock.calls[0]![0];
    expect(ctx.rowId).toBe("A");
    expect(ctx.rowIndex).toBe(1);
    expect(ctx.row).toBe(data[1]);

    controller.detach();
  });

  it("stale row-id that no longer exists in data does nothing", () => {
    const data: RowData[] = [
      { id: "1", name: "Alice" },
    ];

    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);

    const getActions = vi.fn().mockReturnValue(makeActions());

    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: makeColumns,
      getDisplayRows: () => createArrayDisplayRowReader(data),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "contextmenu",
        getActions,
        onAction: vi.fn(),
      }),
      getCellMenuGridApi: () => ({ getRows: () => data }),
    });
    controller.attach(root);

    // Row element references a row-id that was deleted from data
    const row = buildRow("deleted-id", 5, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    const event = fireContextMenu(cell as HTMLElement);

    // Should not open — row not found
    expect(event.defaultPrevented).toBe(false);
    expect(getActions).not.toHaveBeenCalled();

    controller.detach();
  });

  it("opening another cell menu replaces previous (single floating host)", () => {
    const { root, getActions } = createHarness();

    const row1 = buildRow("1", 0, ["id", "name"]);
    const row2 = buildRow("2", 1, ["id", "name"]);
    root.appendChild(row1);
    root.appendChild(row2);

    // Open menu on first cell
    const cell1 = row1.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell1 as HTMLElement);

    expect(root.querySelector(".lfg-cell-menu-panel")).not.toBeNull();
    expect(getActions).toHaveBeenCalledTimes(1);

    // Open menu on second cell — should replace
    const cell2 = row2.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell2 as HTMLElement);

    expect(getActions).toHaveBeenCalledTimes(2);

    // Only one panel should exist
    const panels = root.querySelectorAll(".lfg-cell-menu-panel");
    expect(panels.length).toBe(1);

    // The second context should reference row 2
    const ctx2: CellMenuContext = getActions.mock.calls[1]![0];
    expect(ctx2.rowId).toBe("2");
    expect(ctx2.value).toBe("Bob");
  });

  it("no persistent state depends on DOM after close", () => {
    const { root, controller } = createHarness();
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell as HTMLElement);

    // Menu is open
    expect(root.querySelector(".lfg-cell-menu-panel")).not.toBeNull();

    // Simulate cell recycling: remove the row from DOM (virtualization pool reuse)
    row.remove();

    // Detach controller — should not throw even though anchor cell is gone
    expect(() => { controller.detach(); }).not.toThrow();
  });
});

// ── Overlay trigger button ─────────────────────────────────────

function createButtonHarness(overrides?: Partial<CellMenuOptions>): ControllerHarness {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  root.appendChild(viewport);

  // Give root dimensions so getBoundingClientRect works for positioning.
  Object.defineProperty(root, "getBoundingClientRect", {
    value: () => ({ top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600 }),
  });

  const onAction = vi.fn();
  const getActions = vi.fn().mockReturnValue(makeActions());

  const cellMenuOptions: CellMenuOptions = {
    enabled: true,
    trigger: "button",
    getActions,
    onAction,
    ...overrides,
  };

  const controller = new CellMenuController({
    gridRoot: root,
    viewport,
    getColumns: makeColumns,
    getDisplayRows: () => createArrayDisplayRowReader(makeData()),
    resolveRowId: (row) => String((row as Record<string, unknown>).id),
    getCellMenuOptions: () => cellMenuOptions,
    getCellMenuGridApi: () => ({ getRows: () => makeData().slice() }),
  });

  controller.attach(root);

  return { root, controller, onAction, getActions, getCellMenuOptions: () => cellMenuOptions, cellMenuOptions };
}

function firePointerMove(target: HTMLElement): void {
  const event = new PointerEvent("pointermove", { bubbles: true });
  target.dispatchEvent(event);
}

function firePointerLeave(target: HTMLElement): void {
  const event = new PointerEvent("pointerleave", { bubbles: true });
  target.dispatchEvent(event);
}

/** Flush a single rAF (used for trigger button positioning). */
async function flushRaf(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

describe("cell menu — overlay trigger button", () => {
  it("trigger button is NOT rendered for trigger 'contextmenu'", () => {
    const { root, controller } = createHarness(); // default trigger is "contextmenu"
    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`);
    expect(btn).toBeNull();
    controller.detach();
  });

  it("one overlay button exists for trigger 'button'", () => {
    const { root, controller } = createButtonHarness({ trigger: "button" });
    const buttons = root.querySelectorAll(`.${CELL_MENU_TRIGGER_CLASS}`);
    expect(buttons.length).toBe(1);
    expect(buttons[0]!.getAttribute("aria-haspopup")).toBe("menu");
    expect(buttons[0]!.getAttribute("aria-expanded")).toBe("false");
    expect(buttons[0]!.hasAttribute("aria-controls")).toBe(false);
    expect((buttons[0] as HTMLElement).tabIndex).toBe(-1);
    controller.detach();
  });

  it("one overlay button exists for trigger 'contextmenu-and-button'", () => {
    const { root, controller } = createButtonHarness({ trigger: "contextmenu-and-button" });
    const buttons = root.querySelectorAll(`.${CELL_MENU_TRIGGER_CLASS}`);
    expect(buttons.length).toBe(1);
    controller.detach();
  });

  it("hovering eligible cell shows the button", async () => {
    const { root, controller } = createButtonHarness();
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    // Give the cell a rect for positioning.
    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    firePointerMove(cell);
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(true);

    controller.detach();
  });

  it("resolves the visible trigger only for its exact logical cell", async () => {
    const { root, controller } = createButtonHarness();
    document.body.appendChild(root);
    const firstRow = buildRow("1", 0, ["id", "name"]);
    const secondRow = buildRow("2", 1, ["id", "name"]);
    root.append(firstRow, secondRow);
    const firstCell = firstRow.querySelector<HTMLElement>(
      '[data-col-id="name"]',
    )!;
    const secondCell = secondRow.querySelector<HTMLElement>(
      '[data-col-id="name"]',
    )!;

    firePointerMove(firstCell);
    await flushRaf();

    const trigger = root.querySelector<HTMLElement>(
      `.${CELL_MENU_TRIGGER_CLASS}`,
    )!;
    expect(controller.resolveVisibleTrigger(0, "name", firstCell)).toBe(
      trigger,
    );
    expect(controller.resolveVisibleTrigger(1, "name", secondCell)).toBeNull();
    expect(controller.resolveVisibleTrigger(0, "id", firstCell)).toBeNull();

    firePointerLeave(root);
    expect(controller.resolveVisibleTrigger(0, "name", firstCell)).toBeNull();
    controller.detach();
    root.remove();
  });

  it("keyboard Escape restores and preserves the visible overlay trigger", async () => {
    const { root, controller } = createButtonHarness();
    document.body.appendChild(root);
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);
    const cell = row.querySelector<HTMLElement>('[data-col-id="name"]')!;
    firePointerMove(cell);
    await flushRaf();

    const trigger = root.querySelector<HTMLButtonElement>(
      `.${CELL_MENU_TRIGGER_CLASS}`,
    )!;
    trigger.tabIndex = 0;
    trigger.focus();
    trigger.click();
    const item = root.querySelector<HTMLButtonElement>(
      ".lfg-cell-menu-item",
    )!;
    expect(document.activeElement).toBe(item);

    item.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));

    expect(document.activeElement).toBe(trigger);
    expect(trigger.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(
      true,
    );
    expect(controller.resolveVisibleTrigger(0, "name", cell)).toBe(trigger);
    controller.detach();
    root.remove();
  });

  it("hovering ineligible cell (selection column) hides the button", async () => {
    const selectionCol: ColumnDef = { field: "__sel", internal: "selection" };
    const nameCol: ColumnDef = { field: "name" };

    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);

    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: () => [selectionCol, nameCol],
      getDisplayRows: () => createArrayDisplayRowReader(makeData()),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "button",
        getActions: () => makeActions(),
        onAction: vi.fn(),
      }),
      getCellMenuGridApi: () => ({ getRows: () => makeData().slice() }),
    });
    controller.attach(root);

    const row = buildRow("1", 0, ["__sel", "name"]);
    root.appendChild(row);

    // First hover an eligible cell to make button visible.
    const nameCell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(nameCell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });
    Object.defineProperty(root, "getBoundingClientRect", {
      value: () => ({ top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600 }),
    });
    firePointerMove(nameCell);
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(true);

    // Now hover ineligible selection cell — button should hide.
    const selCell = row.querySelector('[data-col-id="__sel"]') as HTMLElement;
    firePointerMove(selCell);

    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(false);

    controller.detach();
  });

  it("clicking button opens descriptor menu with correct context", async () => {
    const { root, controller, getActions, onAction } = createButtonHarness();
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    // Hover to show button and set active cell.
    firePointerMove(cell);
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    btn.click();

    expect(getActions).toHaveBeenCalledTimes(1);
    const ctx: CellMenuContext = getActions.mock.calls[0]![0];
    expect(ctx.field).toBe("name");
    expect(ctx.rowId).toBe("1");
    expect(ctx.value).toBe("Alice");

    // Verify menu panel is rendered
    const panel = root.querySelector(".lfg-cell-menu-panel");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("role")).toBe("menu");
    expect(panel!.getAttribute("aria-label")).toBe("name cell menu");
    expect(panel!.hasAttribute("aria-modal")).toBe(false);
    expect(panel!.id).toMatch(/^lfg-popup-cell-menu-\d+$/);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-controls")).toBe(panel!.id);

    // Click a menu item
    const copyBtn = root.querySelector('[data-menu-action="copy"]') as HTMLElement;
    copyBtn.click();

    expect(onAction).toHaveBeenCalledTimes(1);
    const actionCtx: CellMenuActionContext = onAction.mock.calls[0]![0];
    expect(actionCtx.actionId).toBe("copy");
    actionCtx.close();
    expect(root.querySelector(".lfg-cell-menu-panel")).toBeNull();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.hasAttribute("aria-controls")).toBe(false);

    controller.detach();
  });

  it("button click does not select row (stopPropagation on pointerdown)", async () => {
    const { root, controller } = createButtonHarness();
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    firePointerMove(cell);
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;

    // Listen for pointerdown on the root — it should NOT fire (stopped).
    const rootPointerDown = vi.fn();
    root.addEventListener("pointerdown", rootPointerDown);

    const pointerEvent = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    btn.dispatchEvent(pointerEvent);

    expect(pointerEvent.defaultPrevented).toBe(true);
    expect(rootPointerDown).not.toHaveBeenCalled();

    root.removeEventListener("pointerdown", rootPointerDown);
    controller.detach();
  });

  it("button works for pinned-left, center, and pinned-right cells", async () => {
    const columns: ColumnDef[] = [
      { field: "id", pinned: "left" },
      { field: "name" },
      { field: "email", pinned: "right" },
    ];
    const data: RowData[] = [
      { id: "1", name: "Alice", email: "alice@test.com" },
    ];

    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);
    Object.defineProperty(root, "getBoundingClientRect", {
      value: () => ({ top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600 }),
    });

    const getActions = vi.fn().mockReturnValue(makeActions());
    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: () => columns,
      getDisplayRows: () => createArrayDisplayRowReader(data),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "button",
        getActions,
        onAction: vi.fn(),
      }),
      getCellMenuGridApi: () => ({ getRows: () => data }),
    });
    controller.attach(root);

    const mockRect = () => ({ top: 40, left: 50, bottom: 72, right: 250, width: 200, height: 32 });

    // Pinned-left
    const pinnedLeftRow = buildPinnedLeftRow("1", 0, ["id"]);
    root.appendChild(pinnedLeftRow);
    const leftCell = pinnedLeftRow.querySelector('[data-col-id="id"]') as HTMLElement;
    Object.defineProperty(leftCell, "getBoundingClientRect", { value: mockRect });
    firePointerMove(leftCell);
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(true);
    btn.click();
    expect(getActions).toHaveBeenCalledTimes(1);
    expect(getActions.mock.calls[0]![0].field).toBe("id");

    // Close menu by detach/re-attach (reset state).
    controller.detach();
    getActions.mockClear();
    controller.attach(root);

    // Center
    const centerRow = buildRow("1", 0, ["name"]);
    root.appendChild(centerRow);
    const centerCell = centerRow.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(centerCell, "getBoundingClientRect", { value: mockRect });
    firePointerMove(centerCell);
    await flushRaf();

    const btn2 = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    btn2.click();
    expect(getActions).toHaveBeenCalledTimes(1);
    expect(getActions.mock.calls[0]![0].field).toBe("name");

    controller.detach();
    getActions.mockClear();
    controller.attach(root);

    // Pinned-right
    const pinnedRightRow = buildPinnedRightRow("1", 0, ["email"]);
    root.appendChild(pinnedRightRow);
    const rightCell = pinnedRightRow.querySelector('[data-col-id="email"]') as HTMLElement;
    Object.defineProperty(rightCell, "getBoundingClientRect", { value: mockRect });
    firePointerMove(rightCell);
    await flushRaf();

    const btn3 = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    btn3.click();
    expect(getActions).toHaveBeenCalledTimes(1);
    expect(getActions.mock.calls[0]![0].field).toBe("email");

    controller.detach();
  });

  it("button class/icon/ariaLabel config applies", () => {
    const config: CellMenuTriggerButtonConfig = {
      icon: "☰",
      ariaLabel: "Menu",
      className: "my-custom-trigger",
      placement: "left-center",
    };

    const { root, controller } = createButtonHarness({ triggerButton: config });

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe("☰");
    expect(btn.getAttribute("aria-label")).toBe("Menu");
    expect(btn.classList.contains("my-custom-trigger")).toBe(true);

    controller.detach();
  });

  it("default icon and ariaLabel are applied when no config", () => {
    const { root, controller } = createButtonHarness();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    expect(btn.textContent).toBe("⋮");
    expect(btn.getAttribute("aria-label")).toBe("Open cell menu");

    controller.detach();
  });

  it("no per-cell buttons are created", () => {
    const { root, controller } = createButtonHarness();
    // Add multiple rows
    root.appendChild(buildRow("1", 0, ["id", "name"]));
    root.appendChild(buildRow("2", 1, ["id", "name"]));
    root.appendChild(buildRow("3", 2, ["id", "name"]));

    // Only one trigger button should exist in the entire grid root.
    const buttons = root.querySelectorAll(`.${CELL_MENU_TRIGGER_CLASS}`);
    expect(buttons.length).toBe(1);

    controller.detach();
  });

  it("pointer leave hides the button", async () => {
    const { root, controller } = createButtonHarness();
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    firePointerMove(cell);
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(true);

    // Pointer leaves grid root.
    firePointerLeave(root);

    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(false);

    controller.detach();
  });

  it("detach removes trigger button from DOM", () => {
    const { root, controller } = createButtonHarness();
    expect(root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`)).not.toBeNull();

    controller.detach();

    expect(root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`)).toBeNull();
  });
});

describe("cell menu — popup role and trigger semantics", () => {
  it("custom-panel trigger advertises aria-haspopup=dialog and panel role=dialog", async () => {
    const { root, controller } = createButtonHarness({
      renderPanel: (host) => {
        host.textContent = "custom";
      },
    });
    document.body.appendChild(root);
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);
    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    firePointerMove(cell);
    await flushRaf();

    const trigger = root.querySelector<HTMLButtonElement>(
      `.${CELL_MENU_TRIGGER_CLASS}`,
    )!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");

    trigger.click();
    const panel = root.querySelector(".lfg-cell-menu-panel")!;
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);

    controller.detach();
    root.remove();
  });

  it("descriptor-only trigger and panel use menu semantics while open", async () => {
    const { root, controller } = createButtonHarness();
    document.body.appendChild(root);
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);
    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    firePointerMove(cell);
    await flushRaf();

    const trigger = root.querySelector<HTMLButtonElement>(
      `.${CELL_MENU_TRIGGER_CLASS}`,
    )!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");

    trigger.click();
    const panel = root.querySelector(".lfg-cell-menu-panel")!;
    expect(panel.getAttribute("role")).toBe("menu");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);

    controller.detach();
    root.remove();
  });

  it("updates overlay trigger aria-haspopup when renderPanel changes at runtime", async () => {
    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);
    Object.defineProperty(root, "getBoundingClientRect", {
      value: () => ({ top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600 }),
    });

    const cellMenuOptions: CellMenuOptions = {
      enabled: true,
      trigger: "button",
      getActions: vi.fn().mockReturnValue(makeActions()),
      onAction: vi.fn(),
    };

    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: makeColumns,
      getDisplayRows: () => createArrayDisplayRowReader(makeData()),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => cellMenuOptions,
      getCellMenuGridApi: () => ({ getRows: () => makeData().slice() }),
    });
    controller.attach(root);
    document.body.appendChild(root);

    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);
    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    firePointerMove(cell);
    await flushRaf();

    const trigger = root.querySelector<HTMLButtonElement>(
      `.${CELL_MENU_TRIGGER_CLASS}`,
    )!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");

    cellMenuOptions.renderPanel = (host) => {
      host.textContent = "custom";
    };
    firePointerLeave(root);
    firePointerMove(cell);
    await flushRaf();
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");

    trigger.click();
    expect(root.querySelector(".lfg-cell-menu-panel")!.getAttribute("role")).toBe(
      "dialog",
    );

    controller.detach();
    root.remove();
  });
});

// ── Overlay trigger scroll behavior ────────────────────────────

function fireScroll(target: HTMLElement): void {
  target.dispatchEvent(new Event("scroll", { bubbles: false }));
}

describe("cell menu — overlay trigger scroll behavior", () => {
  it("visible overlay hides on vertical scroll", async () => {
    const { root, controller } = createButtonHarness();
    const viewport = root.querySelector("div")!; // viewport is first child

    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);
    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    firePointerMove(cell);
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(true);

    // Vertical scroll on viewport.
    fireScroll(viewport);

    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(false);

    controller.detach();
  });

  it("visible overlay hides on horizontal scroll", async () => {
    const { root, controller } = createButtonHarness();
    const viewport = root.querySelector("div")!;

    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);
    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    firePointerMove(cell);
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(true);

    // Horizontal scroll (same scroll event on viewport).
    fireScroll(viewport);

    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(false);

    controller.detach();
  });

  it("scroll clears active cell state", async () => {
    const { root, controller } = createButtonHarness();
    const viewport = root.querySelector("div")!;

    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);
    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    firePointerMove(cell);
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(true);

    fireScroll(viewport);

    // Button click after scroll should NOT open menu — activeCell was cleared.
    btn.click();

    // No menu panel rendered.
    expect(root.querySelector(".lfg-cell-menu-panel")).toBeNull();

    controller.detach();
  });

  it("pending positioning RAF is canceled on scroll", async () => {
    const { root, controller } = createButtonHarness();
    const viewport = root.querySelector("div")!;

    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);
    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    // Trigger pointermove to schedule a positioning RAF — but don't flush it.
    firePointerMove(cell);

    // Scroll before RAF fires — should cancel the pending positioning.
    fireScroll(viewport);

    // Now flush the RAF — button should NOT become visible because the RAF was canceled.
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(false);

    controller.detach();
  });

  it("after scroll, moving pointer over eligible cell shows overlay again", async () => {
    const { root, controller } = createButtonHarness();
    const viewport = root.querySelector("div")!;

    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);
    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    // Show overlay.
    firePointerMove(cell);
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(true);

    // Scroll hides it.
    fireScroll(viewport);
    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(false);

    // Move pointer to a different eligible cell after scroll.
    const cell2 = row.querySelector('[data-col-id="id"]') as HTMLElement;
    Object.defineProperty(cell2, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 0, bottom: 72, right: 100, width: 100, height: 32 }),
    });
    firePointerMove(cell2);
    await flushRaf();

    // Overlay should be visible again, anchored to the new cell.
    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(true);

    controller.detach();
  });

  it("open floating cell menu still closes on scroll", async () => {
    const { root, controller, getActions } = createButtonHarness();
    const viewport = root.querySelector("div")!;

    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);
    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    // Show overlay, then click to open menu.
    firePointerMove(cell);
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    btn.click();

    expect(getActions).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".lfg-cell-menu-panel")).not.toBeNull();
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    // Scroll should close the floating menu (via FloatingController)
    // AND hide the overlay trigger.
    fireScroll(viewport);

    expect(root.querySelector(".lfg-cell-menu-panel")).toBeNull();
    expect(btn.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS)).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.hasAttribute("aria-controls")).toBe(false);

    controller.detach();
  });
});

// ── DisplayRowReader / sorted RowView integration ────────────

describe("cell menu — DisplayRowReader sorted display order", () => {
  it("context resolves sorted display row and display index after sort", () => {
    // Simulate sorted display order: data is [Alice(id=1), Bob(id=2)]
    // but DisplayRowReader presents them as [Bob, Alice] (sorted).
    const sourceRows: RowData[] = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ];
    // Sorted display order: Bob at display 0, Alice at display 1.
    const sortedDisplayRows: RowData[] = [sourceRows[1]!, sourceRows[0]!];

    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);

    const getActions = vi.fn().mockReturnValue(makeActions());
    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: makeColumns,
      getDisplayRows: () => createArrayDisplayRowReader(sortedDisplayRows),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "contextmenu",
        getActions,
        onAction: vi.fn(),
      }),
      getCellMenuGridApi: () => ({ getRows: () => sourceRows }),
    });
    controller.attach(root);

    // DOM row says display index 0, id "2" (Bob — first in sorted order).
    const row = buildRow("2", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    fireContextMenu(cell as HTMLElement);

    expect(getActions).toHaveBeenCalledTimes(1);
    const ctx: CellMenuContext = getActions.mock.calls[0]![0];
    // rowIndex should be the DISPLAY index (0), not the source index (1).
    expect(ctx.rowIndex).toBe(0);
    expect(ctx.rowId).toBe("2");
    expect(ctx.row).toBe(sourceRows[1]); // Bob
    expect(ctx.value).toBe("Bob");

    controller.detach();
  });

  it("stale DOM row-id mismatch returns null context (no menu opens)", () => {
    const data: RowData[] = [
      { id: "1", name: "Alice" },
    ];

    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);

    const getActions = vi.fn().mockReturnValue(makeActions());
    const controller = new CellMenuController({
      gridRoot: root,
      viewport,
      getColumns: makeColumns,
      getDisplayRows: () => createArrayDisplayRowReader(data),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getCellMenuOptions: () => ({
        enabled: true,
        trigger: "contextmenu",
        getActions,
        onAction: vi.fn(),
      }),
      getCellMenuGridApi: () => ({ getRows: () => data }),
    });
    controller.attach(root);

    // DOM row has id "deleted-row" that doesn't exist in data at all.
    const row = buildRow("deleted-row", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]')!;
    const event = fireContextMenu(cell as HTMLElement);

    // Should not open menu — row not found in display rows.
    expect(event.defaultPrevented).toBe(false);
    expect(getActions).not.toHaveBeenCalled();

    controller.detach();
  });
});

describe("cell menu session-bound close and focus restoration", () => {
  it("stale close callback does not close a newer menu", async () => {
    const capturedCloses: Array<() => void> = [];
    const { root, controller } = createButtonHarness({
      renderPanel: (_host, ctx) => {
        capturedCloses.push(ctx.close);
      },
    });
    document.body.appendChild(root);
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    firePointerMove(cell);
    await flushRaf();
    (root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement).click();
    expect(root.querySelector(".lfg-cell-menu-panel")).not.toBeNull();
    expect(capturedCloses).toHaveLength(1);

    firePointerMove(cell);
    await flushRaf();
    (root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement).click();
    expect(root.querySelector(".lfg-cell-menu-panel")).not.toBeNull();
    expect(capturedCloses).toHaveLength(2);

    capturedCloses[0]?.();
    expect(root.querySelector(".lfg-cell-menu-panel")).not.toBeNull();

    controller.detach();
    root.remove();
  });

  it("application close restores focus to the invoker trigger", async () => {
    const onAction = vi.fn((ctx: CellMenuActionContext) => {
      ctx.close();
    });
    const { root, controller } = createButtonHarness({ onAction });
    document.body.appendChild(root);
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    Object.defineProperty(cell, "getBoundingClientRect", {
      value: () => ({ top: 40, left: 100, bottom: 72, right: 300, width: 200, height: 32 }),
    });

    firePointerMove(cell);
    await flushRaf();

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLButtonElement;
    btn.tabIndex = 0;
    btn.focus();
    btn.click();

    const copyBtn = root.querySelector('[data-menu-action="copy"]') as HTMLElement;
    copyBtn.click();

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".lfg-cell-menu-panel")).toBeNull();
    expect(document.activeElement).toBe(btn);

    controller.detach();
    root.remove();
  });

  it("application close restores focus to the invoker cell", () => {
    const onAction = vi.fn((ctx: CellMenuActionContext) => {
      ctx.close();
    });
    const { root, controller } = createHarness({ onAction });
    document.body.appendChild(root);
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    cell.tabIndex = 0;
    cell.focus();
    fireContextMenu(cell);

    const copyBtn = root.querySelector('[data-menu-action="copy"]') as HTMLElement;
    copyBtn.click();

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".lfg-cell-menu-panel")).toBeNull();
    expect(document.activeElement).toBe(cell);

    controller.detach();
    root.remove();
  });

  it("custom-panel Close button close restores focus to the invoker cell", () => {
    const { root, controller } = createHarness({
      renderPanel: (host, ctx) => {
        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.textContent = "Close panel";
        closeBtn.addEventListener("click", ctx.close);
        host.appendChild(closeBtn);
      },
    });
    document.body.appendChild(root);
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    cell.tabIndex = 0;
    cell.focus();
    fireContextMenu(cell);

    const closeBtn = Array.from(
      root.querySelectorAll(".lfg-cell-menu-panel button"),
    ).find((button) => button.textContent === "Close panel") as HTMLButtonElement;
    closeBtn.click();

    expect(root.querySelector(".lfg-cell-menu-panel")).toBeNull();
    expect(document.activeElement).toBe(cell);

    controller.detach();
    root.remove();
  });

  it("stale close does not restore focus while a newer menu stays open", async () => {
    const capturedCloses: Array<() => void> = [];
    const { root, controller } = createHarness({
      renderPanel: (_host, ctx) => {
        capturedCloses.push(ctx.close);
      },
    });
    document.body.appendChild(root);
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    const cell = row.querySelector('[data-col-id="name"]') as HTMLElement;
    fireContextMenu(cell);
    expect(capturedCloses).toHaveLength(1);

    fireContextMenu(cell);
    expect(capturedCloses).toHaveLength(2);
    expect(root.querySelector(".lfg-cell-menu-panel")).not.toBeNull();

    const currentItem = root.querySelector(
      '.lfg-cell-menu-panel [data-menu-action="copy"]',
    ) as HTMLButtonElement;
    currentItem.tabIndex = 0;
    currentItem.focus();
    expect(document.activeElement).toBe(currentItem);

    capturedCloses[0]!();
    expect(root.querySelector(".lfg-cell-menu-panel")).not.toBeNull();
    expect(document.activeElement).toBe(currentItem);

    controller.detach();
    root.remove();
  });
});

describe("cell menu trigger button className tokens", () => {
  it("applies multiple whitespace-separated trigger classes", () => {
    const { root, controller } = createButtonHarness({
      triggerButton: { className: "  foo   bar  " },
    });

    const btn = root.querySelector(`.${CELL_MENU_TRIGGER_CLASS}`) as HTMLElement;
    expect(btn.classList.contains("foo")).toBe(true);
    expect(btn.classList.contains("bar")).toBe(true);

    controller.detach();
  });
});
