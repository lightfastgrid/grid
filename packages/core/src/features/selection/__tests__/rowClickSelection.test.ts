// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import type { CellRendererRegistry, RowData } from "../../../types";
import {
  ACTION_MENU_PANEL_CLASS,
  ACTION_TRIGGER_CLASS,
} from "../../row-actions/rowActionDom";

/* ── helpers ─────────────────────────────────────────────── */

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function rowById(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector(`[data-row-id="${id}"]`) as HTMLElement | null;
}

/**
 * Find a specific cell inside any row lane (center, pinned-left, pinned-right)
 * for the given rowId and column field.
 */
function bodyCellInRow(
  container: HTMLElement,
  rowId: string,
  field: string,
): HTMLElement | null {
  const rows = Array.from(container.querySelectorAll(`[data-row-id="${rowId}"]`));
  for (const row of rows) {
    const cell = row.querySelector(`.lfg-cell[data-col-id="${field}"]`) as HTMLElement | null;
    if (cell) return cell;
  }
  return null;
}

function click(el: HTMLElement, init: MouseEventInit = {}): void {
  el.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    }),
  );
}

function checkboxInRow(container: HTMLElement, rowId: string): HTMLInputElement | null {
  const row = rowById(container, rowId);
  if (!row) return null;
  return row.querySelector(".lfg-row-selection-checkbox") as HTMLInputElement | null;
}

const ROWS: RowData[] = [
  { id: "r1", name: "Alice", status: "active" },
  { id: "r2", name: "Bob", status: "inactive" },
  { id: "r3", name: "Carol", status: "active" },
];

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

/* ── enableRowClickSelection: true + checkboxes ──────────── */

describe("enableRowClickSelection: true with checkboxes", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("clicking a normal center cell selects the row", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: ROWS,
      columns: [{ field: "name" }, { field: "status" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
        enableRowClickSelection: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const cell = bodyCellInRow(container, "r1", "name");
    expect(cell).toBeTruthy();
    click(cell!);
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.destroy();
    container.remove();
  });

  it("clicking a normal pinned-left cell selects the row", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: ROWS,
      columns: [
        { field: "name", pinned: "left" },
        { field: "status" },
      ],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
        enableRowClickSelection: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    // Pinned cell is inside .lfg-pinned-row
    const pinnedRow = container.querySelector(
      '.lfg-pinned-row[data-row-id="r2"]',
    ) as HTMLElement | null;
    const cell = pinnedRow?.querySelector(
      '.lfg-cell[data-col-id="name"]',
    ) as HTMLElement | null;
    expect(cell).toBeTruthy();
    click(cell!);
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual(["r2"]);

    grid.destroy();
    container.remove();
  });

  it("clicking a normal pinned-right cell selects the row", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: ROWS,
      columns: [
        { field: "name" },
        { field: "status", pinned: "right" },
      ],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
        enableRowClickSelection: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    // Right-pinned cell is inside .lfg-pinned-right-row
    const rightPinnedRow = container.querySelector(
      '.lfg-pinned-right-row[data-row-id="r3"]',
    ) as HTMLElement | null;
    const cell = rightPinnedRow?.querySelector(
      '.lfg-cell[data-col-id="status"]',
    ) as HTMLElement | null;
    expect(cell).toBeTruthy();
    click(cell!);
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual(["r3"]);

    grid.destroy();
    container.remove();
  });
});

/* ── enableRowClickSelection: false ──────────────────────── */

describe("enableRowClickSelection: false", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("clicking a normal cell does NOT select the row", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: ROWS,
      columns: [{ field: "name" }, { field: "status" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        enableRowClickSelection: false,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const cell = bodyCellInRow(container, "r1", "name");
    expect(cell).toBeTruthy();
    click(cell!);
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("checkbox click still selects when enableRowClickSelection is false", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: ROWS,
      columns: [{ field: "name" }, { field: "status" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        enableRowClickSelection: false,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const cb = checkboxInRow(container, "r1");
    expect(cb).toBeTruthy();
    click(cb!);
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.destroy();
    container.remove();
  });
});

/* ── enableRowClickSelection omitted (default behavior) ──── */

describe("enableRowClickSelection omitted (default contract)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("with checkboxes: clicking a normal cell does NOT select (default is false)", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    // enableRowClickSelection NOT set; checkboxes true → default false
    const grid = new Grid({
      rows: ROWS,
      columns: [{ field: "name" }, { field: "status" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const cell = bodyCellInRow(container, "r1", "name");
    expect(cell).toBeTruthy();
    click(cell!);
    await flushRenders();

    // Documented default: checkboxes on → body click selection off
    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("without checkboxes: clicking a normal cell selects (default is true)", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    // enableRowClickSelection NOT set; checkboxes false → default true
    const grid = new Grid({
      rows: ROWS,
      columns: [{ field: "name" }, { field: "status" }],
      rowSelection: {
        mode: "multiple",
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const cell = bodyCellInRow(container, "r1", "name");
    expect(cell).toBeTruthy();
    click(cell!);
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.destroy();
    container.remove();
  });
});

/* ── suppressRowClickSelection per-column ────────────────── */

describe("suppressRowClickSelection per-column", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("column with suppressRowClickSelection: true does not select row", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: ROWS,
      columns: [
        { field: "name" },
        { field: "status", suppressRowClickSelection: true },
      ],
      rowSelection: {
        mode: "multiple",
        enableRowClickSelection: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const cell = bodyCellInRow(container, "r1", "status");
    expect(cell).toBeTruthy();
    click(cell!);
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("normal column without suppressRowClickSelection still selects row", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: ROWS,
      columns: [
        { field: "name" },
        { field: "status", suppressRowClickSelection: true },
      ],
      rowSelection: {
        mode: "multiple",
        enableRowClickSelection: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const cell = bodyCellInRow(container, "r1", "name");
    expect(cell).toBeTruthy();
    click(cell!);
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.destroy();
    container.remove();
  });
});

/* ── action column / row action UI isolation ─────────────── */

describe("row action UI does not trigger row selection", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("clicking action trigger does not select the row", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    const onSelection = vi.fn();
    const grid = new Grid({
      rows: ROWS,
      columns: [
        { field: "name" },
        {
          field: "actions",
          cellKind: "actions",
          actionsKey: "rowActions",
          suppressRowClickSelection: true,
          columnSelectable: false,
        },
      ],
      cellRenderers: makeRenderer(),
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        enableRowClickSelection: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
      onSelectionChanged: onSelection,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const trigger = actionTrigger(root, 0)!;
    expect(trigger).toBeTruthy();

    click(trigger);
    await flushRenders();

    expect(onSelection).not.toHaveBeenCalled();
    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("clicking row action dropdown menu item does not select the row", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    const onSelection = vi.fn();
    const grid = new Grid({
      rows: ROWS,
      columns: [
        { field: "name" },
        {
          field: "actions",
          cellKind: "actions",
          actionsKey: "rowActions",
          suppressRowClickSelection: true,
          columnSelectable: false,
        },
      ],
      cellRenderers: makeRenderer(),
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        enableRowClickSelection: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
      onSelectionChanged: onSelection,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    // Open the menu
    const trigger = actionTrigger(root, 0)!;
    click(trigger);

    const panel = root.querySelector(`.${ACTION_MENU_PANEL_CLASS}`) as HTMLElement;
    expect(panel).toBeTruthy();
    const menuItem = panel.querySelector("button") as HTMLButtonElement;
    expect(menuItem).toBeTruthy();

    click(menuItem);
    await flushRenders();

    expect(onSelection).not.toHaveBeenCalled();
    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });
});

/* ── checkbox column isolation ───────────────────────────── */

describe("checkbox column body-click isolation", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("checkbox column has suppressRowClickSelection: true by default", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);

    const onSelection = vi.fn();
    const grid = new Grid({
      rows: ROWS,
      columns: [{ field: "name" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        enableRowClickSelection: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
      onSelectionChanged: onSelection,
    });
    grid.mount(container);
    await flushRenders();

    // Find the selection column cell (not the checkbox input, the cell itself)
    const selCell = bodyCellInRow(container, "r1", "__lfg_selection__");
    // The cell might be in a pinned row, try there too
    const pinnedRow = container.querySelector(
      '.lfg-pinned-row[data-row-id="r1"]',
    ) as HTMLElement | null;
    const pinnedSelCell = pinnedRow?.querySelector(
      '.lfg-cell[data-col-id="__lfg_selection__"]',
    ) as HTMLElement | null;

    const cell = selCell ?? pinnedSelCell;
    expect(cell).toBeTruthy();

    // Clicking the cell area (not the checkbox) should NOT select via body-click path
    // because the selection column has suppressRowClickSelection: true
    click(cell!);
    await flushRenders();

    // The checkbox click path may or may not fire depending on click target;
    // but body-click row selection should NOT fire
    // (the checkbox path only fires for .lfg-row-selection-checkbox)
    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });
});
