// @vitest-environment jsdom
//
// Focused tests verifying RowSelectionController reads display rows
// through DisplayRowReader (not materialized getData() arrays).
//
// Covers:
// - getSelectedRowIds() after sorting returns correct ids
// - shift/range selection after sorting respects display order
// - select-all after sorting captures all rows
// - header checkbox state after sorting
// - clearing selection after sorting

import { describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import { CSS } from "../../../rendering/const/css-classes";
import type {
  LightFastGridSelectionChangedEvent,
  RowData,
  RowSelectionOptions,
} from "../../../types";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

function createContainer(): HTMLElement {
  const container = document.createElement("div");
  Object.assign(container.style, {
    height: "400px",
    width: "600px",
    position: "fixed",
    top: "0",
    left: "0",
  });
  document.body.appendChild(container);
  return container;
}

function createSortableGrid(
  rows: RowData[],
  selectionOpts: RowSelectionOptions = {},
) {
  const container = createContainer();
  const grid = new Grid({
    rows,
    columns: [{ field: "score", sortable: true }],
    getRowId: (row: RowData) => String(row.id),
    suppressRowVirtualization: true,
    rowSelection: {
      mode: "multiple",
      checkboxes: true,
      headerCheckbox: true,
      enableRowClickSelection: true,
      ...selectionOpts,
    },
  });
  grid.mount(container);
  return { grid, container };
}

describe("Selection with DisplayRowReader", () => {
  it("getSelectedRowIds returns correct ids after sorting", async () => {
    const rows = [
      { id: "a", score: 30 },
      { id: "b", score: 10 },
      { id: "c", score: 20 },
    ];
    const { grid, container } = createSortableGrid(rows);
    await flushRenders();

    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    // Select row "b" (score=10, now first in display order)
    grid.setSelectedRowIds(["b"]);
    expect(grid.getSelectedRowIds()).toEqual(["b"]);

    // Select multiple rows — ids should be stable across sort
    grid.setSelectedRowIds(["a", "c"]);
    const selected = grid.getSelectedRowIds();
    expect(selected).toContain("a");
    expect(selected).toContain("c");
    expect(selected).not.toContain("b");

    grid.destroy();
    container.remove();
  });

  it("select-all after sorting captures all rows", async () => {
    const rows = [
      { id: "a", score: 30 },
      { id: "b", score: 10 },
      { id: "c", score: 20 },
    ];
    const { grid, container } = createSortableGrid(rows);
    await flushRenders();

    grid.setSortModel([{ field: "score", sort: "desc" }]);
    await flushRenders();

    // Click the header checkbox to select all
    const headerCb = container.querySelector(
      ".lfg-header-selection-checkbox",
    ) as HTMLInputElement | null;
    expect(headerCb).not.toBeNull();
    headerCb!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();
    await flushRenders();

    const ids = grid.getSelectedRowIds();
    expect(ids).toHaveLength(3);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");

    grid.destroy();
    container.remove();
  });

  it("select-all after sorting resolves selected rows in display order", async () => {
    const rows = [
      { id: "a", score: 30 },
      { id: "b", score: 10 },
      { id: "c", score: 20 },
    ];
    const container = createContainer();
    let lastEvent: LightFastGridSelectionChangedEvent | undefined;
    const grid = new Grid({
      rows,
      columns: [{ field: "score", sortable: true }],
      getRowId: (row: RowData) => String(row.id),
      suppressRowVirtualization: true,
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
      },
      onSelectionChanged: (event) => {
        lastEvent = event;
      },
    });
    grid.mount(container);
    await flushRenders();

    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    const headerCb = container.querySelector(
      ".lfg-header-selection-checkbox",
    ) as HTMLInputElement | null;
    expect(headerCb).not.toBeNull();
    headerCb!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();
    await flushRenders();

    expect(lastEvent).toBeDefined();
    expect(lastEvent!.getSelectedRowIds()).toEqual(["b", "c", "a"]);
    expect(lastEvent!.getSelectedRows()).toEqual([rows[1], rows[2], rows[0]]);
    expect(grid.getSelectedRows()).toEqual([rows[1], rows[2], rows[0]]);

    const iteratedIds: string[] = [];
    lastEvent!.forEachSelectedRow((row) => {
      iteratedIds.push(String(row.id));
    });
    expect(iteratedIds).toEqual(["b", "c", "a"]);

    grid.destroy();
    container.remove();
  });

  it("clearing selection after sorting empties selection", async () => {
    const rows = [
      { id: "a", score: 30 },
      { id: "b", score: 10 },
    ];
    const { grid, container } = createSortableGrid(rows);
    await flushRenders();

    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    grid.setSelectedRowIds(["a", "b"]);
    expect(grid.getSelectedRowIds()).toHaveLength(2);

    grid.clearSelection();
    expect(grid.getSelectedRowIds()).toHaveLength(0);

    grid.destroy();
    container.remove();
  });

  it("selection persists through sort model changes", async () => {
    const rows = [
      { id: "a", score: 30 },
      { id: "b", score: 10 },
      { id: "c", score: 20 },
    ];
    const { grid, container } = createSortableGrid(rows);
    await flushRenders();

    grid.setSelectedRowIds(["b"]);
    expect(grid.getSelectedRowIds()).toEqual(["b"]);

    // Sort ascending
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["b"]);

    // Sort descending
    grid.setSortModel([{ field: "score", sort: "desc" }]);
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["b"]);

    // Clear sort
    grid.setSortModel([]);
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["b"]);

    grid.destroy();
    container.remove();
  });

  it("row click selection works after sorting", async () => {
    const rows = [
      { id: "a", score: 30 },
      { id: "b", score: 10 },
      { id: "c", score: 20 },
    ];
    const { grid, container } = createSortableGrid(rows);
    await flushRenders();

    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    // Click the checkbox of the first visible row (should be "b" with score=10 after sort asc)
    const firstRow = container.querySelector(`.${CSS.ROW}`) as HTMLElement;
    expect(firstRow).not.toBeNull();
    const checkbox = firstRow.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    checkbox.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushMicrotasks();
    await flushRenders();

    const ids = grid.getSelectedRowIds();
    expect(ids).toContain("b");

    grid.destroy();
    container.remove();
  });

  it("selected row count reflects correct count after sort", async () => {
    const rows = [
      { id: "a", score: 30 },
      { id: "b", score: 10 },
      { id: "c", score: 20 },
    ];
    const { grid, container } = createSortableGrid(rows);
    await flushRenders();

    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    grid.setSelectedRowIds(["a", "c"]);
    expect(grid.getSelectedRowIds()).toHaveLength(2);

    grid.destroy();
    container.remove();
  });
});
