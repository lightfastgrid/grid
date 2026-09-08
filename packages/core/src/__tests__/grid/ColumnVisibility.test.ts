// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MENU_PANEL_CLASS,
  MENU_TRIGGER_CLASS,
} from "../../features/column-menu/columnMenuDom";
import { Grid } from "../../Grid";
import { CSS } from "../../rendering/const/css-classes";
import type { LightFastGridColDef, RowData } from "../../types";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function headerFields(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll(`.${CSS.HEADER_CELL}[data-col-id]`),
  ).map((el) => el.getAttribute("data-col-id") ?? "");
}

describe("column visibility (declarative only)", () => {
  it("visible: false hides header and body cells on initial render", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "500px" });
    document.body.appendChild(container);

    const grid = new Grid({
      columns: [
        { field: "a", width: 80 },
        { field: "b", width: 80, visible: false },
        { field: "c", width: 80 },
      ],
      rows: [{ a: 1, b: 2, c: 3 } as RowData],
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    expect(headerFields(root)).toEqual(["a", "c"]);
    expect(root.querySelectorAll(`.${CSS.CELL}[data-col-id="b"]`).length).toBe(
      0,
    );
    expect(root.querySelector(`.${CSS.HEADER_CELL}[data-col-id="b"]`)).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("visible undefined shows column by default", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      columns: [{ field: "only" }],
      rows: [{ only: "x" } as RowData],
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    expect(headerFields(root)).toEqual(["only"]);

    grid.destroy();
    container.remove();
  });

  it("setColumns from parent with visible: false hides; visible: true shows again", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "220px", width: "480px" });
    document.body.appendChild(container);

    const baseCols: LightFastGridColDef[] = [
      { field: "sku", width: 165 },
      { field: "qty", width: 60 },
    ];

    const grid = new Grid({
      columns: baseCols,
      rows: [{ sku: "z", qty: 2 } as RowData],
    });
    grid.mount(container);
    await flushRenders();

    let root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    expect(headerFields(root)).toEqual(["sku", "qty"]);

    grid.setColumns([
      { field: "sku", width: 165, visible: false },
      { field: "qty", width: 60 },
    ]);
    await flushRenders();

    root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    expect(headerFields(root)).toEqual(["qty"]);
    expect(root.querySelector(`.${CSS.HEADER_CELL}[data-col-id="sku"]`)).toBeNull();

    grid.setColumns([
      { field: "sku", width: 165, visible: true },
      { field: "qty", width: 60 },
    ]);
    await flushRenders();

    root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    expect(headerFields(root)).toEqual(["sku", "qty"]);

    grid.destroy();
    container.remove();
  });

  it("row selection checkbox column remains when all user data columns are hidden", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "320px" });
    document.body.appendChild(container);

    const grid = new Grid({
      columns: [{ field: "only", visible: false }],
      rows: [{ only: 1 } as RowData],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
        enableRowClickSelection: true,
      },
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    expect(root.querySelector(`.${CSS.HEADER_CELL}[data-col-id="only"]`)).toBeNull();
    expect(root.querySelector(`.${CSS.CELL}[data-col-id="only"]`)).toBeNull();
    expect(
      root.querySelectorAll('.lfg-header-cell[data-col-id="__lfg_selection__"]')
        .length,
    ).toBeGreaterThan(0);
    expect(
      root.querySelectorAll('.lfg-cell[data-col-id="__lfg_selection__"]').length,
    ).toBeGreaterThan(0);

    grid.destroy();
    container.remove();
  });
});

function makeGrid(
  columns: LightFastGridColDef[],
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
    root: () => container.querySelector(`.${CSS.GRID}`) as HTMLElement,
  };
}

function visibleHeaderFields(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll(`.${CSS.HEADER_CELL}[data-col-id]`),
  )
    .filter((el) => (el as HTMLElement).style.display !== "none")
    .map((el) => el.getAttribute("data-col-id") ?? "");
}

function openMenu(root: HTMLElement, field: string): void {
  const cell = root.querySelector(
    `.${CSS.HEADER_CELL}[data-col-id="${field}"]`,
  );
  const trigger = cell?.querySelector(`.${MENU_TRIGGER_CLASS}`) as HTMLButtonElement | null;
  trigger!.dispatchEvent(
    new MouseEvent("click", { bubbles: true, button: 0 }),
  );
}

function clickMenuItem(root: HTMLElement, actionId: string): void {
  const panel = root.querySelector(`.${MENU_PANEL_CLASS}`) as HTMLElement | null;
  if (!panel) return;
  const item = panel.querySelector(`[data-menu-action="${actionId}"]`) as HTMLElement | null;
  if (item) {
    item.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  }
}

describe("grid.hideColumns / showColumns", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hideColumns hides header and body cells", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "b" },
    ]);
    await flushRenders();
    expect(visibleHeaderFields(root())).toContain("b");

    grid.hideColumns(["b"]);
    await flushRenders();
    expect(visibleHeaderFields(root())).not.toContain("b");

    grid.destroy();
    container.remove();
  });

  it("showColumns shows a hidden column", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "b", visible: false },
    ]);
    await flushRenders();
    expect(visibleHeaderFields(root())).not.toContain("b");

    grid.showColumns(["b"]);
    await flushRenders();
    expect(visibleHeaderFields(root())).toContain("b");

    grid.destroy();
    container.remove();
  });

  it("hideColumns then showColumns shows the column again", async () => {
    const { grid, container, root } = makeGrid([
      { field: "name" },
      { field: "country" },
    ]);
    await flushRenders();

    grid.hideColumns(["name"]);
    await flushRenders();
    expect(visibleHeaderFields(root())).not.toContain("name");

    grid.showColumns(["name"]);
    await flushRenders();
    expect(visibleHeaderFields(root())).toContain("name");
    expect(root().querySelector(`.${CSS.CELL}[data-col-id="name"]`)).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("hideColumns then showColumns works with defaultColDef.visible true", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "name" }, { field: "country" }],
      undefined,
      { defaultColDef: { visible: true } },
    );
    await flushRenders();

    grid.hideColumns(["name"]);
    await flushRenders();
    expect(visibleHeaderFields(root())).not.toContain("name");

    grid.showColumns(["name"]);
    await flushRenders();
    expect(visibleHeaderFields(root())).toContain("name");

    grid.destroy();
    container.remove();
  });

  it("showColumns explicitly shows when defaultColDef.visible is false", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "name" }, { field: "country", visible: true }],
      undefined,
      { defaultColDef: { visible: false } },
    );
    await flushRenders();
    expect(visibleHeaderFields(root())).not.toContain("name");

    grid.showColumns(["name"]);
    await flushRenders();

    expect(visibleHeaderFields(root())).toContain("name");
    expect(grid.getColumnVisibilityState()).toContainEqual({
      field: "name",
      visible: true,
    });

    grid.destroy();
    container.remove();
  });

  it("hideColumns then showColumns works when defaultColDef.visible is false", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "name", visible: true }, { field: "country", visible: true }],
      undefined,
      { defaultColDef: { visible: false } },
    );
    await flushRenders();

    grid.hideColumns(["name"]);
    await flushRenders();
    expect(visibleHeaderFields(root())).not.toContain("name");

    grid.showColumns(["name"]);
    await flushRenders();
    expect(visibleHeaderFields(root())).toContain("name");

    grid.destroy();
    container.remove();
  });

  it("showColumns survives parent column re-application", async () => {
    const { grid, container, root } = makeGrid([
      { field: "name", visible: false },
      { field: "country" },
    ]);
    await flushRenders();
    expect(visibleHeaderFields(root())).not.toContain("name");

    grid.showColumns(["name"]);
    await flushRenders();
    expect(visibleHeaderFields(root())).toContain("name");

    grid.setColumns([
      { field: "name", visible: false },
      { field: "country" },
    ]);
    await flushRenders();

    expect(visibleHeaderFields(root())).toContain("name");

    grid.destroy();
    container.remove();
  });

  it("showColumns restores hidden column to its prior order when columnOrder is enabled", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "actions" }, { field: "name" }, { field: "language" }],
      undefined,
      { columnOrder: { enabled: true } },
    );
    await flushRenders();
    expect(visibleHeaderFields(root())).toEqual(["actions", "name", "language"]);

    grid.hideColumns(["name"]);
    await flushRenders();
    expect(visibleHeaderFields(root())).toEqual(["actions", "language"]);

    grid.showColumns(["name"]);
    await flushRenders();
    expect(visibleHeaderFields(root())).toEqual(["actions", "name", "language"]);

    grid.destroy();
    container.remove();
  });

  it("setColumnVisible true explicitly shows when defaultColDef.visible is false", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "name" }, { field: "country", visible: true }],
      undefined,
      { defaultColDef: { visible: false } },
    );
    await flushRenders();
    expect(visibleHeaderFields(root())).not.toContain("name");

    grid.setColumnVisible("name", true);
    await flushRenders();

    expect(visibleHeaderFields(root())).toContain("name");
    expect(grid.getColumnVisibilityState()).toContainEqual({
      field: "name",
      visible: true,
    });

    grid.destroy();
    container.remove();
  });

  it("setColumnVisibilityState visible true explicitly shows when defaultColDef.visible is false", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "name" }, { field: "country", visible: true }],
      undefined,
      { defaultColDef: { visible: false } },
    );
    await flushRenders();
    expect(visibleHeaderFields(root())).not.toContain("name");

    grid.setColumnVisibilityState([{ field: "name", visible: true }]);
    await flushRenders();

    expect(visibleHeaderFields(root())).toContain("name");
    expect(grid.getColumnVisibilityState()).toContainEqual({
      field: "name",
      visible: true,
    });

    grid.destroy();
    container.remove();
  });

  it("showColumns emits one event and schedules one render", async () => {
    const spy = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "name", visible: false }, { field: "country" }],
      undefined,
      { onColumnVisibilityChanged: spy },
    );
    await flushRenders();
    const renderSpy = vi.spyOn(
      grid as unknown as { scheduleRender: () => void },
      "scheduleRender",
    );

    grid.showColumns(["name"]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].changedColumns).toEqual([
      { field: "name", visible: true, previousVisible: false },
    ]);
    expect(renderSpy).toHaveBeenCalledTimes(1);
    renderSpy.mockRestore();

    grid.destroy();
    container.remove();
  });

  it("setColumnVisible emits onColumnVisibilityChanged with source api", async () => {
    const spy = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      { onColumnVisibilityChanged: spy },
    );
    await flushRenders();

    grid.setColumnVisible("a", false);
    expect(spy).toHaveBeenCalledTimes(1);
    const e = spy.mock.calls[0]![0];
    expect(e.source).toBe("api");
    expect(e.changedColumns).toHaveLength(1);
    expect(e.changedColumns[0].field).toBe("a");
    expect(e.changedColumns[0].visible).toBe(false);
    expect(e.changedColumns[0].previousVisible).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("custom source ui is preserved in event", async () => {
    const spy = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      { onColumnVisibilityChanged: spy },
    );
    await flushRenders();

    grid.setColumnVisible("a", false, "ui");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].source).toBe("ui");

    grid.destroy();
    container.remove();
  });
});

describe("grid.setColumnVisibilityState", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("batch hides specified columns and shows omitted fields", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "b" },
      { field: "c" },
    ]);
    await flushRenders();

    grid.setColumnVisibilityState([{ field: "a", visible: false }]);
    await flushRenders();

    const fields = visibleHeaderFields(root());
    expect(fields).not.toContain("a");
    expect(fields).toContain("b");
    expect(fields).toContain("c");

    grid.destroy();
    container.remove();
  });

  it("batch emits one event with changedColumns", async () => {
    const spy = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a" }, { field: "b" }, { field: "c" }],
      undefined,
      { onColumnVisibilityChanged: spy },
    );
    await flushRenders();

    grid.setColumnVisibilityState([
      { field: "a", visible: false },
      { field: "c", visible: false },
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    const e = spy.mock.calls[0]![0];
    expect(e.changedColumns).toHaveLength(2);
    expect(e.changedColumns[0]!.field).toBe("a");
    expect(e.changedColumns[1]!.field).toBe("c");

    grid.destroy();
    container.remove();
  });
});

describe("grid.getColumnVisibilityState", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns visibility for all user columns", async () => {
    const { grid, container } = makeGrid([
      { field: "a" },
      { field: "b", visible: false },
    ]);
    await flushRenders();

    const state = grid.getColumnVisibilityState();
    expect(state).toEqual([
      { field: "a", visible: true },
      { field: "b", visible: false },
    ]);

    grid.destroy();
    container.remove();
  });
});

describe("grid.showAllColumns", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes all hidden columns visible", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a", visible: false },
      { field: "b", visible: false },
      { field: "c" },
    ]);
    await flushRenders();

    grid.showAllColumns();
    await flushRenders();

    const fields = visibleHeaderFields(root());
    expect(fields).toContain("a");
    expect(fields).toContain("b");
    expect(fields).toContain("c");

    grid.destroy();
    container.remove();
  });
});

describe("selection column protection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("internal selection column cannot be hidden via API", async () => {
    const spy = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a" }],
      undefined,
      {
        rowSelection: {
          mode: "multiple",
          checkboxes: true,
          headerCheckbox: true,
          enableRowClickSelection: true,
        },
        onColumnVisibilityChanged: spy,
      },
    );
    await flushRenders();

    grid.setColumnVisible("__lfg_selection__", false);
    expect(spy).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });

  it("internal selection column is ignored by bulk hide/show APIs", async () => {
    const spy = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a" }],
      undefined,
      {
        rowSelection: "multiple",
        onColumnVisibilityChanged: spy,
      },
    );
    await flushRenders();

    grid.hideColumns(["__lfg_selection__"]);
    grid.showColumns(["__lfg_selection__"]);
    await flushRenders();

    expect(spy).not.toHaveBeenCalled();
    expect(grid.getColumnVisibilityState().map((s) => s.field)).not.toContain(
      "__lfg_selection__",
    );

    grid.destroy();
    container.remove();
  });
});

describe("visibility + sort interaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hiding a sorted column removes it from sort model and emits sort changed", async () => {
    const sortSpy = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a", sortable: true }, { field: "b", sortable: true }],
      undefined,
      { onSortChanged: sortSpy },
    );
    await flushRenders();

    grid.setSortModel([{ field: "a", sort: "asc" }, { field: "b", sort: "desc" }]);
    sortSpy.mockClear();

    grid.hideColumns(["a"]);

    expect(grid.getSortModel()).toEqual([{ field: "b", sort: "desc" }]);
    expect(sortSpy).toHaveBeenCalledTimes(1);

    grid.destroy();
    container.remove();
  });
});

describe("column menu Hide column", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Hide column menu item hides clicked column and closes dropdown", async () => {
    const spy = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      { onColumnVisibilityChanged: spy },
    );
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    expect(root().querySelector(`.${MENU_PANEL_CLASS}`)).toBeTruthy();

    clickMenuItem(root(), "hide-column");
    await flushRenders();

    expect(root().querySelector(`.${MENU_PANEL_CLASS}`)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].changedColumns[0].field).toBe("a");
    expect(spy.mock.calls[0]![0].source).toBe("ui");
    expect(visibleHeaderFields(root())).not.toContain("a");

    grid.destroy();
    container.remove();
  });
});

function selectColumnByClick(
  root: HTMLElement,
  field: string,
  additive = false,
): void {
  const cell = root.querySelector(
    `.${CSS.HEADER_CELL}[data-col-id="${field}"]`,
  ) as HTMLElement;
  cell.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  cell.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      button: 0,
      ctrlKey: additive,
      metaKey: additive,
    }),
  );
}

function menuItemLabel(root: HTMLElement, actionId: string): string | null {
  const panel = root.querySelector(`.${MENU_PANEL_CLASS}`) as HTMLElement | null;
  if (!panel) return null;
  const btn = panel.querySelector(`[data-menu-action="${actionId}"]`) as HTMLElement | null;
  if (!btn) return null;
  // Icons are SVG (glyph text cleared); assert the visible label span only.
  const label = btn.querySelector(".lfg-column-menu-label");
  if (label !== null) {
    return label.textContent;
  }
  return btn.textContent;
}

describe("column menu hide with column selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no selected columns: label is Hide column and hides clicked column", async () => {
    const spy = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }, { field: "c" }],
      undefined,
      {
        columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
        onColumnVisibilityChanged: spy,
      },
    );
    await flushRenders();

    openMenu(root(), "b");
    await flushRenders();
    expect(menuItemLabel(root(), "hide-column")).toBe("Hide column");

    clickMenuItem(root(), "hide-column");
    await flushRenders();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].changedColumns).toHaveLength(1);
    expect(spy.mock.calls[0]![0].changedColumns[0]!.field).toBe("b");
    expect(visibleHeaderFields(root())).not.toContain("b");

    grid.destroy();
    container.remove();
  });

  it("multiple selected columns and clicked is selected: label is Hide selected columns", async () => {
    const spy = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }, { field: "c" }],
      undefined,
      {
        columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
        onColumnVisibilityChanged: spy,
      },
    );
    await flushRenders();

    selectColumnByClick(root(), "a");
    selectColumnByClick(root(), "b", true);
    await flushRenders();
    expect(grid.getSelectedColumnIds()).toEqual(
      expect.arrayContaining(["a", "b"]),
    );

    openMenu(root(), "a");
    await flushRenders();
    expect(menuItemLabel(root(), "hide-column")).toBe("Hide selected columns");

    clickMenuItem(root(), "hide-column");
    await flushRenders();

    expect(spy).toHaveBeenCalledTimes(1);
    const changed = spy.mock.calls[0]![0].changedColumns;
    const changedFields = changed.map((c: { field: string }) => c.field);
    expect(changedFields).toContain("a");
    expect(changedFields).toContain("b");
    expect(changedFields).not.toContain("c");
    expect(visibleHeaderFields(root())).not.toContain("a");
    expect(visibleHeaderFields(root())).not.toContain("b");
    expect(visibleHeaderFields(root())).toContain("c");

    grid.destroy();
    container.remove();
  });

  it("multiple selected but clicked not selected: label is Hide column, hides only clicked", async () => {
    const spy = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }, { field: "c" }],
      undefined,
      {
        columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
        onColumnVisibilityChanged: spy,
      },
    );
    await flushRenders();

    selectColumnByClick(root(), "a");
    selectColumnByClick(root(), "b", true);
    await flushRenders();

    openMenu(root(), "c");
    await flushRenders();
    expect(menuItemLabel(root(), "hide-column")).toBe("Hide column");

    clickMenuItem(root(), "hide-column");
    await flushRenders();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].changedColumns).toHaveLength(1);
    expect(spy.mock.calls[0]![0].changedColumns[0]!.field).toBe("c");

    grid.destroy();
    container.remove();
  });

  it("internal selection column is never included in multi-hide", async () => {
    const spy = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      {
        rowSelection: "multiple",
        columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
        onColumnVisibilityChanged: spy,
      },
    );
    await flushRenders();

    selectColumnByClick(root(), "a");
    selectColumnByClick(root(), "b", true);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();

    clickMenuItem(root(), "hide-column");
    await flushRenders();

    expect(spy).toHaveBeenCalledTimes(1);
    const changed = spy.mock.calls[0]![0].changedColumns;
    const changedFields = changed.map((c: { field: string }) => c.field);
    expect(changedFields).not.toContain("__lfg_selection__");

    grid.destroy();
    container.remove();
  });

  it("hidden selected fields are ignored in multi-hide", async () => {
    const spy = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b", visible: false }, { field: "c" }],
      undefined,
      {
        columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
        onColumnVisibilityChanged: spy,
      },
    );
    await flushRenders();

    selectColumnByClick(root(), "a");
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    expect(menuItemLabel(root(), "hide-column")).toBe("Hide column");

    grid.destroy();
    container.remove();
  });

  it("batch hide emits one visibility event", async () => {
    const spy = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }, { field: "c" }],
      undefined,
      {
        columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
        onColumnVisibilityChanged: spy,
      },
    );
    await flushRenders();

    selectColumnByClick(root(), "a");
    selectColumnByClick(root(), "b", true);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    clickMenuItem(root(), "hide-column");
    await flushRenders();

    expect(spy).toHaveBeenCalledTimes(1);

    grid.destroy();
    container.remove();
  });

  it("menu closes after hide selected columns action", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }, { field: "c" }],
      undefined,
      {
        columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
      },
    );
    await flushRenders();

    selectColumnByClick(root(), "a");
    selectColumnByClick(root(), "b", true);
    await flushRenders();

    openMenu(root(), "a");
    await flushRenders();
    expect(root().querySelector(`.${MENU_PANEL_CLASS}`)).toBeTruthy();

    clickMenuItem(root(), "hide-column");
    await flushRenders();
    expect(root().querySelector(`.${MENU_PANEL_CLASS}`)).toBeNull();

    grid.destroy();
    container.remove();
  });
});

describe("no per-header-cell listeners", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("visibility APIs do not add per-cell listeners", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "b" },
    ]);
    await flushRenders();

    const cell = root().querySelector(
      `.${CSS.HEADER_CELL}[data-col-id="a"]`,
    ) as HTMLElement;
    const spy = vi.spyOn(cell, "addEventListener");

    grid.hideColumns(["b"]);
    await flushRenders();

    grid.showColumns(["b"]);
    await flushRenders();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();

    grid.destroy();
    container.remove();
  });
});
