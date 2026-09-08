// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import type {
  CellRendererRegistry,
  ColumnDef,
  RowData,
} from "../../../types";
import { ACTION_MENU_PANEL_CLASS,ACTION_TRIGGER_CLASS } from "../../row-actions/rowActionDom";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
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
      { id: "r1", name: "Alice", status: "active", actions: "" },
      { id: "r2", name: "Bob", status: "inactive", actions: "" },
      { id: "r3", name: "Carol", status: "active", actions: "" },
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

function makeRenderer(): CellRendererRegistry {
  return {
    rowActions: {
      kind: "actions" as const,
      getActions: () => [
        { id: "edit", label: "Edit" },
        { id: "delete", label: "Delete" },
      ],
      onAction: () => {},
    },
  };
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

function headerCell(root: HTMLElement, field: string): HTMLElement | null {
  return root.querySelector(
    `.lfg-header-cell[data-col-id="${field}"]`,
  ) as HTMLElement | null;
}

function bodyCell(root: HTMLElement, field: string, rowId: string): HTMLElement | null {
  const row = root.querySelector(`[data-row-id="${rowId}"]`) as HTMLElement | null;
  if (!row) return null;
  return row.querySelector(`.lfg-cell[data-col-id="${field}"]`) as HTMLElement | null;
}

function click(el: HTMLElement, init: MouseEventInit = {}): void {
  el.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }),
  );
}

// ── Row action UI should not trigger row selection ──

describe("row action click does not trigger row selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clicking .lfg-action-trigger does not select the row", async () => {
    const onSelection = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      makeRenderer(),
      {
        rowSelection: { mode: "multiple", checkboxes: true, enableRowClickSelection: true },
        onSelectionChanged: onSelection,
      },
    );
    await flushRenders();

    const trigger = actionTrigger(root(), 0)!;
    expect(trigger).toBeTruthy();

    click(trigger);
    await flushRenders();

    // Row should NOT be selected
    expect(onSelection).not.toHaveBeenCalled();
    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("clicking row action menu item does not select the row", async () => {
    const onSelection = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      undefined,
      makeRenderer(),
      {
        rowSelection: { mode: "multiple", checkboxes: true, enableRowClickSelection: true },
        onSelectionChanged: onSelection,
      },
    );
    await flushRenders();

    // Open the menu
    const trigger = actionTrigger(root(), 0)!;
    click(trigger);

    // Find the menu item and click it
    const panel = root().querySelector(`.${ACTION_MENU_PANEL_CLASS}`) as HTMLElement;
    expect(panel).toBeTruthy();
    const menuItem = panel.querySelector("button") as HTMLButtonElement;
    expect(menuItem).toBeTruthy();

    click(menuItem);
    await flushRenders();

    // Row should NOT be selected
    expect(onSelection).not.toHaveBeenCalled();
    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });
});

// ── suppressRowClickSelection ──

describe("suppressRowClickSelection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("column with suppressRowClickSelection does not row-select when clicking body cell", async () => {
    const onSelection = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "status", suppressRowClickSelection: true },
      ],
      undefined,
      undefined,
      {
        rowSelection: { mode: "multiple", enableRowClickSelection: true },
        onSelectionChanged: onSelection,
      },
    );
    await flushRenders();

    // Click a cell in the suppressed column
    const cell = bodyCell(root(), "status", "r1");
    expect(cell).toBeTruthy();
    click(cell!);
    await flushRenders();

    expect(onSelection).not.toHaveBeenCalled();
    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("clicking a normal column still selects the row", async () => {
    const onSelection = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "status", suppressRowClickSelection: true },
      ],
      undefined,
      undefined,
      {
        rowSelection: { mode: "multiple", enableRowClickSelection: true },
        onSelectionChanged: onSelection,
      },
    );
    await flushRenders();

    // Click a cell in the normal column
    const cell = bodyCell(root(), "name", "r1");
    expect(cell).toBeTruthy();
    click(cell!);
    await flushRenders();

    expect(onSelection).toHaveBeenCalled();
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.destroy();
    container.remove();
  });

  it("checkbox selection still works even if column suppresses row click selection", async () => {
    const onSelection = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        { field: "name", suppressRowClickSelection: true },
        { field: "status", suppressRowClickSelection: true },
      ],
      undefined,
      undefined,
      {
        rowSelection: { mode: "multiple", checkboxes: true, enableRowClickSelection: true },
        onSelectionChanged: onSelection,
      },
    );
    await flushRenders();

    // Find the checkbox for the first row
    const rowEl = root().querySelector('[data-row-id="r1"]') as HTMLElement;
    expect(rowEl).toBeTruthy();
    const checkbox = rowEl.querySelector(".lfg-row-selection-checkbox") as HTMLInputElement;
    expect(checkbox).toBeTruthy();

    click(checkbox);
    await flushRenders();

    // Checkbox click should still select
    expect(onSelection).toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });
});

// ── columnSelectable ──

describe("columnSelectable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("column with columnSelectable: false cannot be selected by header click", async () => {
    const onColSelection = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        { field: "name" },
        { field: "status", columnSelectable: false },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions", columnSelectable: false },
      ],
      undefined,
      makeRenderer(),
      {
        columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
        onColumnSelectionChanged: onColSelection,
      },
    );
    await flushRenders();

    // Click the non-selectable column header
    const header = headerCell(root(), "status");
    expect(header).toBeTruthy();
    click(header!);
    await flushRenders();

    expect(onColSelection).not.toHaveBeenCalled();
    expect(grid.getSelectedColumnIds()).toEqual([]);

    // Click the normal column header — should work
    const nameHeader = headerCell(root(), "name");
    expect(nameHeader).toBeTruthy();
    click(nameHeader!);
    await flushRenders();

    expect(onColSelection).toHaveBeenCalled();
    expect(grid.getSelectedColumnIds()).toEqual(["name"]);

    grid.destroy();
    container.remove();
  });

  it("shift-range column selection excludes columnSelectable: false columns", async () => {
    const { grid, container, root } = makeGrid(
      [
        { field: "a" },
        { field: "b", columnSelectable: false },
        { field: "c" },
        { field: "d" },
      ],
      undefined,
      undefined,
      {
        columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
      },
    );
    await flushRenders();

    // Click column "a" as anchor
    click(headerCell(root(), "a")!);
    await flushRenders();
    expect(grid.getSelectedColumnIds()).toEqual(["a"]);

    // Shift-click column "d" for range
    click(headerCell(root(), "d")!, { shiftKey: true });
    await flushRenders();

    const selected = grid.getSelectedColumnIds();
    // "b" should not be selected because columnSelectable: false
    expect(selected).toContain("a");
    expect(selected).not.toContain("b");
    expect(selected).toContain("c");
    expect(selected).toContain("d");

    grid.destroy();
    container.remove();
  });
});

// ── Playground schema uses both flags ──

describe("playground schema action column flags", () => {
  it("action column JSON uses both suppressRowClickSelection and columnSelectable", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const candidates = [
      join(process.cwd(), "..", "..", "apps", "playgroundReact", "src", "gridDemo", "schemas", "ag-grid-100000x22-with-columns.json"),
      join(process.cwd(), "apps", "playgroundReact", "src", "gridDemo", "schemas", "ag-grid-100000x22-with-columns.json"),
    ];
    const schemaPath = candidates.find((p) => existsSync(p));
    expect(schemaPath).toBeDefined();

    const schema = JSON.parse(readFileSync(schemaPath!, "utf8"));
    const actionCol = schema.flatColumns.find(
      (c: Record<string, unknown>) => c.field === "actions",
    );
    expect(actionCol).toBeDefined();
    expect(actionCol.suppressRowClickSelection).toBe(true);
    expect(actionCol.columnSelectable).toBe(false);
  });
});
