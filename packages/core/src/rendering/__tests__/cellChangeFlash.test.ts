// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditCommitChange } from "../../features/editing/editingTypes";
import { Grid } from "../../Grid";
import { ROW_DRAG_CELL_CLASS } from "../../internal/rowDragColumn";
import { GridState } from "../../state/GridState";
import type { LightFastGridProps, RowData } from "../../types";
import { CSS } from "../const/css-classes";
import type { DomGridRenderer } from "../DomGridRenderer";
import { createDisplayRowReader } from "../rowViewAccess";

const THEME_CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../themes/default.css"),
  "utf8",
);

function createGrid(props: Partial<LightFastGridProps> = {}) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "400px", width: "600px" });
  document.body.appendChild(container);
  const grid = new Grid({
    columns: [
      { field: "name", sortable: true, filter: "text" },
      { field: "score", sortable: true },
    ],
    rows: [
      { id: "a", name: "Alice", score: 10 },
      { id: "b", name: "Bob", score: 20 },
      { id: "c", name: "Carol", score: 30 },
    ],
    getRowId: (row) => row.id,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    ...props,
  });
  grid.mount(container);
  return { grid, container };
}

function destroyGrid(grid: Grid, container: HTMLElement): void {
  grid.destroy();
  container.remove();
}

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function getRenderer(grid: Grid): DomGridRenderer {
  return (grid as unknown as { renderer: DomGridRenderer }).renderer;
}

function findCell(
  container: HTMLElement,
  rowId: string,
  field: string,
): HTMLElement | null {
  const cells = container.querySelectorAll(`.${CSS.CELL}[data-col-id="${field}"]`);
  for (const cell of cells) {
    const row = cell.closest("[data-row-id]");
    if (row?.getAttribute("data-row-id") === rowId) {
      return cell as HTMLElement;
    }
  }
  return null;
}

function isFlashing(el: HTMLElement | null | undefined): boolean {
  return !!el?.classList.contains(CSS.CELL_CHANGE_FLASH);
}

function flashGen(el: HTMLElement): "a" | "b" | null {
  if (el.classList.contains(CSS.CELL_CHANGE_FLASH_B)) return "b";
  if (el.classList.contains(CSS.CELL_CHANGE_FLASH_A)) return "a";
  return null;
}

function dispatchFlashAnimationEnd(el: HTMLElement, name: string): void {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: name });
  el.dispatchEvent(event);
}

function stateOf(grid: Grid): GridState {
  const candidate: unknown = Reflect.get(grid, "state");
  if (!(candidate instanceof GridState)) {
    throw new Error("Grid.state is not a GridState instance");
  }
  return candidate;
}

function displayIds(grid: Grid): string[] {
  const reader = createDisplayRowReader(stateOf(grid).getSnapshot().rowView);
  return Array.from({ length: reader.rowCount }, (_, i) =>
    String(reader.getRowData(i)?.id),
  );
}

async function waitPendingFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function settleRowModel(grid: Grid): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (!stateOf(grid).isRowModelExecutionPending()) {
      await flushRenders();
      return;
    }
    await waitPendingFrame();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error("row-model execution did not settle");
}

describe("cell change flash", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is disabled by default", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(findCell(container, "a", "name")!.textContent).toBe("Alicia");
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);

    destroyGrid(grid, container);
  });

  it("enables via defaultColDef and honors per-column false", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", cellChangeFlash: false },
        { field: "score" },
      ],
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 99 }],
    });
    await flushRenders();

    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);
    expect(isFlashing(findCell(container, "a", "score"))).toBe(true);

    destroyGrid(grid, container);
  });

  it("keeps flash when setRows echoes accepted transaction rows before the scheduled render", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    const dataUpdated = vi.fn();
    grid.on("data:updated", dataUpdated);
    const result = grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    dataUpdated.mockClear();
    grid.setRows(result.rows);
    expect(dataUpdated).toHaveBeenCalledWith({ rowCount: 3 });
    await flushRenders();

    expect(isFlashing(findCell(container, "a", "name"))).toBe(true);
    expect(isFlashing(findCell(container, "a", "score"))).toBe(false);

    destroyGrid(grid, container);
  });

  it("keeps flash when setRows echoes an equivalent accepted slice", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    const dataUpdated = vi.fn();
    grid.on("data:updated", dataUpdated);
    const result = grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    const echoed = result.rows.slice();
    dataUpdated.mockClear();
    grid.setRows(echoed);
    expect(dataUpdated).toHaveBeenCalledWith({ rowCount: 3 });
    expect(
      (grid as unknown as { state: { getRows(): RowData[] } }).state.getRows(),
    ).toBe(echoed);
    await flushRenders();

    expect(isFlashing(findCell(container, "a", "name"))).toBe(true);
    expect(isFlashing(findCell(container, "a", "score"))).toBe(false);

    destroyGrid(grid, container);
  });

  it("keeps flash when an async flush result is echoed through setRows", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    let accepted: RowData[] = [];
    grid.applyTransactionAsync(
      { update: [{ id: "a", name: "Alicia", score: 10 }] },
      (result) => {
        accepted = result.rows;
      },
    );
    grid.flushAsyncTransactions();
    grid.setRows(accepted);
    await flushRenders();

    expect(isFlashing(findCell(container, "a", "name"))).toBe(true);

    destroyGrid(grid, container);
  });

  it("keeps flash when a multi-entry async flush result is echoed through setRows", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    grid.applyTransactionAsync({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    grid.applyTransactionAsync({
      update: [{ id: "b", name: "Bobby", score: 20 }],
    });
    const flushed = grid.flushAsyncTransactions();
    const last = flushed[flushed.length - 1];
    expect(last).toBeDefined();
    grid.setRows(last!.rows);
    await flushRenders();

    expect(isFlashing(findCell(container, "a", "name"))).toBe(true);
    expect(isFlashing(findCell(container, "b", "name"))).toBe(true);

    destroyGrid(grid, container);
  });

  it("keeps flash when setRowsImmutable echoes an equivalent accepted sequence", async () => {
    const onRowDataUpdated = vi.fn();
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
      onRowDataUpdated,
    });
    await flushRenders();

    const result = grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    onRowDataUpdated.mockClear();
    const echoed = grid.setRowsImmutable(result.rows.slice());
    expect(echoed.updateCount).toBe(0);
    expect(echoed.skippedCount).toBe(0);
    expect(onRowDataUpdated).toHaveBeenCalledOnce();
    expect(onRowDataUpdated.mock.calls[0]![0]).toMatchObject({
      source: "immutableRows",
      skippedCount: 0,
    });
    await flushRenders();

    expect(isFlashing(findCell(container, "a", "name"))).toBe(true);

    destroyGrid(grid, container);
  });

  it("drops flash when setRows installs a new object snapshot", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    const result = grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    grid.setRows(result.rows.map((row) => ({ ...row })));
    await flushRenders();

    expect(findCell(container, "a", "name")!.textContent).toBe("Alicia");
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);

    destroyGrid(grid, container);
  });

  it("clears pending flash when setRows reorders the same row objects", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    const result = grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    const rows = result.rows;
    grid.setRows([rows[1]!, rows[0]!, rows[2]!]);
    await flushRenders();

    expect(findCell(container, "a", "name")!.textContent).toBe("Alicia");
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);

    destroyGrid(grid, container);
  });

  it("flashes status and units while a cellChangeFlash false customer still updates", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "customer", cellChangeFlash: false },
        { field: "status" },
        { field: "units" },
      ],
      rows: [
        { id: "a", customer: "Acme", status: "Processing", units: 10 },
      ],
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "a", customer: "Acme · live", status: "Ready", units: 17 }],
    });
    await flushRenders();

    expect(findCell(container, "a", "customer")!.textContent).toBe("Acme · live");
    expect(findCell(container, "a", "status")!.textContent).toBe("Ready");
    expect(findCell(container, "a", "units")!.textContent).toBe("17");
    expect(isFlashing(findCell(container, "a", "customer"))).toBe(false);
    expect(isFlashing(findCell(container, "a", "status"))).toBe(true);
    expect(isFlashing(findCell(container, "a", "units"))).toBe(true);

    destroyGrid(grid, container);
  });

  it("flashes the updated cell after a successful synchronous transaction", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);

    const r = getRenderer(grid);
    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    const name = findCell(container, "a", "name")!;
    expect(name.textContent).toBe("Alicia");
    expect(isFlashing(name)).toBe(true);
    expect(isFlashing(findCell(container, "a", "score"))).toBe(false);
    expect(isFlashing(findCell(container, "b", "name"))).toBe(false);

    destroyGrid(grid, container);
  });

  it("flashes once after an async transaction batch", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    grid.applyTransactionAsync({
      update: [{ id: "a", name: "A1", score: 10 }],
    });
    grid.applyTransactionAsync({
      update: [{ id: "a", name: "A2", score: 10 }],
    });
    grid.flushAsyncTransactions();
    await flushRenders();

    const name = findCell(container, "a", "name")!;
    expect(name.textContent).toBe("A2");
    expect(isFlashing(name)).toBe(true);
    expect(flashGen(name)).toBe("a");

    destroyGrid(grid, container);
  });

  it("does not flash no-op updates, unrelated fields, adds, removes, or skipped ids", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    grid.applyTransaction({ update: [{ id: "a", name: "Alice", score: 10 }] });
    await flushRenders();
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);

    grid.applyTransaction({ update: [{ id: "a", name: "Alice", score: 11 }] });
    await flushRenders();
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);
    expect(isFlashing(findCell(container, "a", "score"))).toBe(true);

    grid.applyTransaction({ add: [{ id: "d", name: "Dave", score: 40 }] });
    await flushRenders();
    expect(isFlashing(findCell(container, "d", "name"))).toBe(false);

    grid.applyTransaction({ remove: [{ id: "d" }] });
    await flushRenders();
    expect(findCell(container, "d", "name")).toBeNull();

    const nameBeforeSkip = findCell(container, "a", "name")!;
    const flashingBeforeSkip = isFlashing(nameBeforeSkip);
    grid.applyTransaction({ update: [{ id: "missing", name: "Nope", score: 0 }] });
    await flushRenders();
    expect(isFlashing(findCell(container, "a", "name"))).toBe(flashingBeforeSkip);

    destroyGrid(grid, container);
  });

  it("does not flash cell editing commits", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", editable: true, cellChangeFlash: true },
        { field: "score", cellChangeFlash: true },
      ],
    });
    await flushRenders();

    (grid as unknown as { commitCellEdit(change: EditCommitChange): void }).commitCellEdit({
      rowId: "a",
      rowIndex: 0,
      sourceIndex: 0,
      field: "name",
      topLevelField: "name",
      oldValue: "Alice",
      newValue: "Edited",
      updatedRow: { id: "a", name: "Edited", score: 10 },
    });
    await flushRenders();

    expect(findCell(container, "a", "name")!.textContent).toBe("Edited");
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);

    destroyGrid(grid, container);
  });

  it("does not flash setRows or setRowsImmutable replacements", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    grid.setRows([
      { id: "a", name: "Alicia", score: 10 },
      { id: "b", name: "Bob", score: 20 },
      { id: "c", name: "Carol", score: 30 },
    ]);
    await flushRenders();
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);

    grid.setRowsImmutable([
      { id: "a", name: "Alicia-2", score: 10 },
      { id: "b", name: "Bob", score: 20 },
      { id: "c", name: "Carol", score: 30 },
    ]);
    await flushRenders();
    expect(findCell(container, "a", "name")!.textContent).toBe("Alicia-2");
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);

    destroyGrid(grid, container);
  });

  it("restarts the flash on rapid repeated updates", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    grid.applyTransaction({ update: [{ id: "a", name: "A1", score: 10 }] });
    await flushRenders();
    expect(flashGen(findCell(container, "a", "name")!)).toBe("a");

    grid.applyTransaction({ update: [{ id: "a", name: "A2", score: 10 }] });
    await flushRenders();
    expect(flashGen(findCell(container, "a", "name")!)).toBe("b");

    grid.applyTransaction({ update: [{ id: "a", name: "A3", score: 10 }] });
    await flushRenders();
    expect(flashGen(findCell(container, "a", "name")!)).toBe("a");

    destroyGrid(grid, container);
  });

  it("does not replay an offscreen update after scrolling into view", async () => {
    const rows: RowData[] = Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      defaultColDef: { cellChangeFlash: true },
      suppressRowVirtualization: false,
    });
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "70", name: "late", score: 70 }],
    });
    await flushRenders();
    expect(container.querySelectorAll(`.${CSS.CELL_CHANGE_FLASH}`)).toHaveLength(0);

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollTop = 70 * 40;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();
    await flushRenders();

    const late = findCell(container, "70", "name");
    expect(late?.textContent).toBe("late");
    expect(isFlashing(late)).toBe(false);

    destroyGrid(grid, container);
  });

  it("clears flash when a pooled row is recycled onto another row", async () => {
    const rows: RowData[] = Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      defaultColDef: { cellChangeFlash: true },
      suppressRowVirtualization: false,
    });
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "0", name: "first", score: 0 }],
    });
    await flushRenders();
    expect(isFlashing(findCell(container, "0", "name"))).toBe(true);

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollTop = 60 * 40;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();
    await flushRenders();

    expect(findCell(container, "0", "name")).toBeNull();
    expect(container.querySelectorAll(`.${CSS.CELL_CHANGE_FLASH}`)).toHaveLength(0);

    destroyGrid(grid, container);
  });

  it("flashes the current pagination page only and does not replay later", async () => {
    const rows: RowData[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      defaultColDef: { cellChangeFlash: true },
      pagination: true,
      paginationPageSize: 5,
    });
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "0", name: "page-0", score: 0 }],
    });
    await flushRenders();
    expect(isFlashing(findCell(container, "0", "name"))).toBe(true);

    grid.applyTransaction({
      update: [{ id: "10", name: "page-2", score: 10 }],
    });
    await flushRenders();
    expect(findCell(container, "10", "name")).toBeNull();
    expect(isFlashing(findCell(container, "0", "name"))).toBe(true);

    grid.setPageIndex(2);
    await flushRenders();
    expect(findCell(container, "10", "name")!.textContent).toBe("page-2");
    expect(isFlashing(findCell(container, "10", "name"))).toBe(false);

    destroyGrid(grid, container);
  });

  it("flashes on the full-render path when sort invalidates dirty-patch", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    const r = getRenderer(grid);
    const fullBefore = r._fullRenderCount;
    grid.applyTransaction({
      update: [{ id: "a", name: "Alice", score: 11 }],
    });
    await flushRenders();

    expect(r._fullRenderCount).toBeGreaterThan(fullBefore);
    expect(isFlashing(findCell(container, "a", "score"))).toBe(true);

    destroyGrid(grid, container);
  });

  it("flashes on the full-render path when an active filter is invalidated", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true, filter: true },
    });
    await flushRenders();
    grid.setFilterModel({
      name: {
        type: "text",
        operator: "and",
        conditions: [{ operator: "contains", value: "A" }],
      },
    });
    await flushRenders();

    const r = getRenderer(grid);
    const fullBefore = r._fullRenderCount;
    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._fullRenderCount).toBeGreaterThan(fullBefore);
    expect(isFlashing(findCell(container, "a", "name"))).toBe(true);

    destroyGrid(grid, container);
  });

  it("flashes after a Quick Search invalidation", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();
    grid.setQuickFilterText("Ali");
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(isFlashing(findCell(container, "a", "name"))).toBe(true);

    destroyGrid(grid, container);
  });

  it("flashes left- and right-pinned cells", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", pinned: "left", cellChangeFlash: true },
        { field: "score", cellChangeFlash: true },
        { field: "extra", pinned: "right", cellChangeFlash: true },
      ],
      rows: [
        { id: "a", name: "Alice", score: 10, extra: "x" },
        { id: "b", name: "Bob", score: 20, extra: "y" },
      ],
    });
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10, extra: "X" }],
    });
    await flushRenders();

    expect(isFlashing(findCell(container, "a", "name"))).toBe(true);
    expect(isFlashing(findCell(container, "a", "extra"))).toBe(true);
    expect(isFlashing(findCell(container, "a", "score"))).toBe(false);

    destroyGrid(grid, container);
  });

  it("flashes row-pinned lanes including pinned-column sub-lanes", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", pinned: "left", cellChangeFlash: true },
        { field: "score", cellChangeFlash: true },
        { field: "extra", pinned: "right", cellChangeFlash: true },
      ],
      rows: [
        { id: "a", name: "Alice", score: 10, extra: "x" },
        { id: "b", name: "Bob", score: 20, extra: "y" },
        { id: "c", name: "Carol", score: 30, extra: "z" },
      ],
    });
    grid.pinRow("a", "top");
    grid.pinRow("c", "bottom");
    await flushRenders();

    grid.applyTransaction({
      update: [
        { id: "a", name: "Alicia", score: 11, extra: "X" },
        { id: "c", name: "Carlos", score: 31, extra: "Z" },
      ],
    });
    await flushRenders();

    const topLeft = container.querySelector(
      `.lfg-row-pinned-top-left-layer [data-row-id="a"] .${CSS.CELL}[data-col-id="name"]`,
    ) as HTMLElement | null;
    const topCenter = container.querySelector(
      `.lfg-row-pinned-top-layer [data-row-id="a"] .${CSS.CELL}[data-col-id="score"]`,
    ) as HTMLElement | null;
    const bottomRight = container.querySelector(
      `.lfg-row-pinned-bottom-right-layer [data-row-id="c"] .${CSS.CELL}[data-col-id="extra"]`,
    ) as HTMLElement | null;

    expect(isFlashing(topLeft)).toBe(true);
    expect(isFlashing(topCenter)).toBe(true);
    expect(isFlashing(bottomRight)).toBe(true);

    destroyGrid(grid, container);
  });

  it("never flashes action, selection, or row-drag cells", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", cellChangeFlash: true },
        {
          field: "actions",
          cellKind: "actions",
          actionsKey: "rowActions",
          cellChangeFlash: true,
        },
      ],
      defaultColDef: { cellChangeFlash: true },
      rowSelection: { mode: "multiple", checkboxes: true },
      rowDrag: { enabled: true, managed: true },
      cellRenderers: {
        rowActions: {
          kind: "actions",
          getActions: () => [{ id: "edit", label: "Edit" }],
          onAction: () => {},
        },
      },
    });
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(isFlashing(findCell(container, "a", "name"))).toBe(true);
    const action = findCell(container, "a", "actions");
    expect(action).toBeTruthy();
    expect(isFlashing(action)).toBe(false);
    const drag = container.querySelector(`.${ROW_DRAG_CELL_CLASS}`);
    expect(drag).toBeTruthy();
    expect(isFlashing(drag as HTMLElement)).toBe(false);
    const selection = container.querySelector(".lfg-row-selection-checkbox")
      ?.closest(`.${CSS.CELL}`) as HTMLElement | null;
    expect(selection).toBeTruthy();
    expect(isFlashing(selection)).toBe(false);

    destroyGrid(grid, container);
  });

  it("preserves user cell classes and selection/focus classes while flashing", async () => {
    const { grid, container } = createGrid({
      columns: [
        {
          field: "name",
          cellChangeFlash: true,
          cellClass: "user-mark",
        },
        { field: "score", cellChangeFlash: true },
      ],
      rowSelection: { mode: "single" },
    });
    await flushRenders();

    grid.setSelectedRowIds(["a"]);
    grid.setFocusedCell({ rowId: "a", field: "name" });
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    const name = findCell(container, "a", "name")!;
    expect(isFlashing(name)).toBe(true);
    expect(name.classList.contains("user-mark")).toBe(true);
    expect(name.classList.contains("lfg-cell-focused")).toBe(true);
    expect(
      name.closest("[data-row-id='a']")?.classList.contains("lfg-row-selected"),
    ).toBe(true);

    destroyGrid(grid, container);
  });

  it("picks up runtime defaultColDef replacement", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "a", name: "A1", score: 10 }],
    });
    await flushRenders();
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);

    grid.setDefaultColDef({ cellChangeFlash: true });
    await flushRenders();
    grid.applyTransaction({
      update: [{ id: "a", name: "A2", score: 10 }],
    });
    await flushRenders();
    expect(isFlashing(findCell(container, "a", "name"))).toBe(true);

    grid.setDefaultColDef({ cellChangeFlash: false });
    await flushRenders();
    dispatchFlashAnimationEnd(findCell(container, "a", "name")!, "lfg-cell-change-flash-a");
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);
    grid.applyTransaction({
      update: [{ id: "a", name: "A3", score: 10 }],
    });
    await flushRenders();
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);

    destroyGrid(grid, container);
  });

  it("cleans animation classes from the delegated animationend handler", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    const name = findCell(container, "a", "name")!;
    expect(isFlashing(name)).toBe(true);
    dispatchFlashAnimationEnd(name, "lfg-cell-change-flash-a");
    expect(isFlashing(name)).toBe(false);
    expect(name.classList.contains(CSS.CELL)).toBe(true);

    destroyGrid(grid, container);
  });

  it("removes the grid and flash listener on destroy", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();
    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();
    expect(container.querySelector(`.${CSS.GRID}`)).toBeTruthy();

    grid.destroy();
    expect(container.querySelector(`.${CSS.GRID}`)).toBeNull();
    expect(container.querySelectorAll(`.${CSS.CELL_CHANGE_FLASH}`)).toHaveLength(0);
    container.remove();
  });

  it("ignores stale generation completions and descendant animation events", async () => {
    const { grid, container } = createGrid({
      defaultColDef: { cellChangeFlash: true },
    });
    await flushRenders();

    grid.applyTransaction({ update: [{ id: "a", name: "A1", score: 10 }] });
    await flushRenders();
    const name = findCell(container, "a", "name")!;
    expect(flashGen(name)).toBe("a");

    grid.applyTransaction({ update: [{ id: "a", name: "A2", score: 10 }] });
    await flushRenders();
    expect(flashGen(name)).toBe("b");

    dispatchFlashAnimationEnd(name, "lfg-cell-change-flash-a");
    expect(flashGen(name)).toBe("b");
    expect(isFlashing(name)).toBe(true);

    const child = name.querySelector(`.${CSS.CELL_VALUE}`) as HTMLElement;
    expect(child).toBeTruthy();
    dispatchFlashAnimationEnd(child, "lfg-cell-change-flash-b");
    expect(flashGen(name)).toBe("b");

    dispatchFlashAnimationEnd(name, "unrelated-animation");
    expect(flashGen(name)).toBe("b");

    dispatchFlashAnimationEnd(name, "lfg-cell-change-flash-b");
    expect(isFlashing(name)).toBe(false);

    grid.applyTransaction({ update: [{ id: "a", name: "A3", score: 10 }] });
    await flushRenders();
    expect(flashGen(name)).toBe("a");
    dispatchFlashAnimationEnd(name, "lfg-cell-change-flash-b");
    expect(flashGen(name)).toBe("a");
    dispatchFlashAnimationEnd(name, "lfg-cell-change-flash-a");
    expect(isFlashing(name)).toBe(false);

    destroyGrid(grid, container);
  });

  it("does not flash during an async sort pending render, then flashes the moved row", async () => {
    const { grid, container } = createGrid({
      rows: [
        { id: "a", name: "Alice", score: 10 },
        { id: "b", name: "Bob", score: 20 },
        { id: "c", name: "Carol", score: 30 },
        { id: "d", name: "Dave", score: 40 },
      ],
      defaultColDef: { cellChangeFlash: true },
      execution: { thresholds: { sort: 3 } },
    });
    await flushRenders();
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await settleRowModel(grid);
    expect(displayIds(grid)).toEqual(["a", "b", "c", "d"]);

    grid.applyTransaction({ update: [{ id: "a", name: "Alice", score: 35 }] });
    expect(stateOf(grid).isSortPending()).toBe(true);
    await waitPendingFrame();
    expect(stateOf(grid).isSortPending()).toBe(true);
    expect(displayIds(grid)).toEqual(["a", "b", "c", "d"]);
    expect(isFlashing(findCell(container, "a", "score"))).toBe(false);
    expect(findCell(container, "a", "score")!.textContent).toBe("35");

    await settleRowModel(grid);
    expect(displayIds(grid)).toEqual(["b", "c", "a", "d"]);
    expect(isFlashing(findCell(container, "a", "score"))).toBe(true);
    expect(isFlashing(findCell(container, "b", "score"))).toBe(false);

    destroyGrid(grid, container);
  });

  it("keeps flash metadata through an async filter pending render", async () => {
    const { grid, container } = createGrid({
      rows: [
        { id: "a", name: "Alice", score: 10 },
        { id: "b", name: "Bob", score: 20 },
        { id: "c", name: "Carol", score: 30 },
        { id: "d", name: "Dave", score: 40 },
      ],
      defaultColDef: { cellChangeFlash: true, filter: true },
      execution: { thresholds: { filter: 3 } },
    });
    await flushRenders();
    grid.setFilterModel({
      name: {
        type: "text",
        operator: "and",
        conditions: [{ operator: "contains", value: "A" }],
      },
    });
    expect(stateOf(grid).isFilterPending()).toBe(true);
    grid.applyTransaction({ update: [{ id: "a", name: "Alicia", score: 10 }] });
    await waitPendingFrame();
    expect(stateOf(grid).isRowModelExecutionPending()).toBe(true);
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);

    await settleRowModel(grid);
    expect(isFlashing(findCell(container, "a", "name"))).toBe(true);

    destroyGrid(grid, container);
  });

  it("keeps flash metadata through an async Quick Search pending render", async () => {
    const rows: RowData[] = Array.from({ length: 600 }, (_, i) => ({
      id: String(i),
      name: i === 0 ? "Alice" : `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      defaultColDef: { cellChangeFlash: true },
      quickFilter: true,
      suppressRowVirtualization: false,
      execution: { thresholds: { quickSearch: 3 } },
    });
    await flushRenders();
    grid.setQuickFilterText("Ali");
    expect(stateOf(grid).isQuickSearchPending()).toBe(true);
    grid.applyTransaction({ update: [{ id: "0", name: "Alicia", score: 0 }] });
    expect(stateOf(grid).isRowModelExecutionPending()).toBe(true);
    expect(isFlashing(findCell(container, "0", "name"))).toBe(false);

    await settleRowModel(grid);
    expect(isFlashing(findCell(container, "0", "name"))).toBe(true);

    destroyGrid(grid, container);
  });

  it("unions multiple updates before async settlement", async () => {
    const { grid, container } = createGrid({
      rows: [
        { id: "a", name: "Alice", score: 10 },
        { id: "b", name: "Bob", score: 20 },
        { id: "c", name: "Carol", score: 30 },
        { id: "d", name: "Dave", score: 40 },
      ],
      defaultColDef: { cellChangeFlash: true },
      execution: { thresholds: { sort: 3 } },
    });
    await flushRenders();
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await settleRowModel(grid);

    grid.applyTransaction({ update: [{ id: "a", name: "Alicia", score: 10 }] });
    grid.applyTransaction({ update: [{ id: "a", name: "Alicia", score: 11 }] });
    expect(stateOf(grid).isSortPending()).toBe(true);
    await waitPendingFrame();
    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);
    expect(isFlashing(findCell(container, "a", "score"))).toBe(false);

    await settleRowModel(grid);
    expect(isFlashing(findCell(container, "a", "name"))).toBe(true);
    expect(isFlashing(findCell(container, "a", "score"))).toBe(true);

    destroyGrid(grid, container);
  });

  it("does not let a cancelled async sort replay a superseded transaction flash", async () => {
    const { grid, container } = createGrid({
      rows: [
        { id: "a", name: "Alice", score: 10 },
        { id: "b", name: "Bob", score: 20 },
        { id: "c", name: "Carol", score: 30 },
        { id: "d", name: "Dave", score: 40 },
      ],
      defaultColDef: { cellChangeFlash: true },
      execution: { thresholds: { sort: 3 } },
    });
    await flushRenders();
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await settleRowModel(grid);

    grid.applyTransaction({ update: [{ id: "a", name: "Alice", score: 35 }] });
    expect(stateOf(grid).isSortPending()).toBe(true);
    await waitPendingFrame();
    expect(isFlashing(findCell(container, "a", "score"))).toBe(false);

    grid.setRows([
      { id: "a", name: "Alice", score: 35 },
      { id: "b", name: "Bob", score: 20 },
      { id: "c", name: "Carol", score: 30 },
      { id: "d", name: "Dave", score: 40 },
    ]);
    grid.applyTransaction({ update: [{ id: "b", name: "Bobby", score: 20 }] });
    await settleRowModel(grid);

    expect(isFlashing(findCell(container, "a", "name"))).toBe(false);
    expect(isFlashing(findCell(container, "a", "score"))).toBe(false);
    expect(isFlashing(findCell(container, "b", "name"))).toBe(true);

    destroyGrid(grid, container);
  });

  it("does not replay an offscreen async-sort update after scrolling into view", async () => {
    const rows: RowData[] = Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      defaultColDef: { cellChangeFlash: true },
      suppressRowVirtualization: false,
      execution: { thresholds: { sort: 3 } },
    });
    await flushRenders();
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await settleRowModel(grid);

    grid.applyTransaction({
      update: [{ id: "70", name: "late", score: 70 }],
    });
    await settleRowModel(grid);
    expect(container.querySelectorAll(`.${CSS.CELL_CHANGE_FLASH}`)).toHaveLength(0);

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollTop = 70 * 40;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();
    await flushRenders();

    const late = findCell(container, "70", "name");
    expect(late?.textContent).toBe("late");
    expect(isFlashing(late)).toBe(false);

    destroyGrid(grid, container);
  });

  it("documents the reduced-motion CSS contract", () => {
    expect(THEME_CSS).toContain("--lfg-cell-change-flash-bg");
    expect(THEME_CSS).toContain("--lfg-cell-change-flash-duration: 900ms");
    expect(THEME_CSS).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*lfg-cell-change-flash::after[\s\S]*animation:\s*none[\s\S]*opacity:\s*0/,
    );
  });
});
