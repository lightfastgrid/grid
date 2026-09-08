// @vitest-environment jsdom
//
// Focused tests for DomGridRenderer's RowView → DisplayRowReader pipeline.
//
// All renderer paths — center body row binding, row-pin partitioning,
// visible-row feature controllers, styling, autosize, selection, row-order
// drag, and overlays — resolve rows through DisplayRowReader. Original
// user-supplied rows live in `currentSourceRows` (from
// `snapshot.rowView.rows`) and are used only for public/source-row APIs
// (cellMenu/rowAction `grid.getRows()`). The renderer has no dependency
// on `snapshot.data`.
//
// Verifies:
// - sorted rows render correctly via center body binding through RowView
// - row styling updates apply correctly on sorted grids (styling-only
//   fast path uses getDisplayRow → currentDisplayRows)
// - display order in DOM matches expected sort order
// - data-row-index attributes remain display index after sort
// - valueGetter receives display index as rowIndex
// - cellMenu grid.getRows() returns source rows after sort
// - row-pinned top rows render from display order after sort
// - cell styling receives display row data after sorting

import { describe, expect, it } from "vitest";

import { Grid } from "../../Grid";
import { GridState } from "../../state/GridState";
import type { RowData } from "../../types";
import { CSS } from "../const/css-classes";
import { createDisplayRowReader } from "../rowViewAccess";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
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

function getRenderedRowTexts(container: HTMLElement): string[] {
  const rows = container.querySelectorAll(`.${CSS.ROW}`);
  const texts: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cell = rows[i]!.querySelector(`.${CSS.CELL}`);
    if (cell) texts.push(cell.textContent || "");
  }
  return texts;
}

describe("DomGridRenderer RowView bridge", () => {
  it("sorted grid renders rows in correct display order", async () => {
    const container = createContainer();
    const rows: RowData[] = [
      { score: 3 },
      { score: 1 },
      { score: 2 },
    ];
    const grid = new Grid({
      rows,
      columns: [{ field: "score", sortable: true }],
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    const texts = getRenderedRowTexts(container);
    expect(texts).toEqual(["1", "2", "3"]);

    grid.destroy();
    container.remove();
  });

  it("row styling update on sorted grid applies classes to correct rows", async () => {
    const container = createContainer();
    const rows: RowData[] = [
      { score: 3 },
      { score: 1 },
      { score: 2 },
    ];
    const grid = new Grid({
      rows,
      columns: [{ field: "score", sortable: true }],
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    // Apply row styling — this triggers the styling-only fast path
    // which reads through getDisplayRow → currentDisplayRows (RowView).
    grid.setRowStyling({
      getRowClass: ({ row }) =>
        (row.score as number) > 2 ? "high-score" : null,
    });
    await flushRenders();

    const domRows = container.querySelectorAll(`.${CSS.ROW}`);
    // Sorted asc: score 1, 2, 3. Only score=3 (last row) gets "high-score".
    const classLists = Array.from(domRows).map((r) =>
      r.classList.contains("high-score"),
    );
    // First two rows: false, last row: true
    expect(classLists[classLists.length - 1]).toBe(true);
    const nonHighRows = classLists.slice(0, -1);
    expect(nonHighRows.every((v) => v === false)).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("sort model change updates RowView and display order", async () => {
    const container = createContainer();
    const rows: RowData[] = [
      { score: 3 },
      { score: 1 },
    ];
    const grid = new Grid({
      rows,
      columns: [{ field: "score", sortable: true }],
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    expect(getRenderedRowTexts(container)).toEqual(["1", "3"]);

    grid.setSortModel([{ field: "score", sort: "desc" }]);
    await flushRenders();

    expect(getRenderedRowTexts(container)).toEqual(["3", "1"]);

    grid.destroy();
    container.remove();
  });

  it("data-row-index attributes still reflect display index after sort", async () => {
    const container = createContainer();
    const rows: RowData[] = [
      { score: 3 },
      { score: 1 },
      { score: 2 },
    ];
    const grid = new Grid({
      rows,
      columns: [{ field: "score", sortable: true }],
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    const domRows = container.querySelectorAll(`.${CSS.ROW}`);
    const indices = Array.from(domRows).map((r) =>
      r.getAttribute("data-row-index"),
    );
    // Display indices must be sequential regardless of sort
    expect(indices).toEqual(["0", "1", "2"]);

    grid.destroy();
    container.remove();
  });

  it("valueGetter receives display index as rowIndex in center body cells", async () => {
    const container = createContainer();
    const rows: RowData[] = [
      { score: 30 },
      { score: 10 },
      { score: 20 },
    ];
    // Track rowIndex values received by the valueGetter during rendering.
    const receivedIndices: number[] = [];
    const grid = new Grid({
      rows,
      columns: [
        { field: "score", sortable: true },
        {
          field: "rank",
          valueGetter: ({ rowIndex }) => {
            receivedIndices.push(rowIndex);
            return `#${rowIndex}`;
          },
        },
      ],
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    // After sort asc, display order is score 10, 20, 30.
    // The "rank" column's valueGetter should receive display indices
    // 0, 1, 2 — not source indices 1, 2, 0.
    expect(receivedIndices).toContain(0);
    expect(receivedIndices).toContain(1);
    expect(receivedIndices).toContain(2);

    // Verify the rendered rank cells show display-index-based values.
    const domRows = container.querySelectorAll(`.${CSS.ROW}`);
    const rankTexts: string[] = [];
    for (let i = 0; i < domRows.length; i++) {
      const cells = domRows[i]!.querySelectorAll(`.${CSS.CELL}`);
      // rank column is the second cell
      if (cells[1]) rankTexts.push(cells[1].textContent);
    }
    expect(rankTexts).toEqual(["#0", "#1", "#2"]);

    grid.destroy();
    container.remove();
  });

  it("unsorted grid renders correctly without RowView (array fallback)", async () => {
    // When no sort is active, the snapshot may still produce a RowView
    // (identity order). This test verifies the fallback path works when
    // the grid has no sort model.
    const container = createContainer();
    const rows: RowData[] = [
      { name: "Alice" },
      { name: "Bob" },
      { name: "Carol" },
    ];
    const grid = new Grid({
      rows,
      columns: [{ field: "name" }],
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const texts = getRenderedRowTexts(container);
    expect(texts).toEqual(["Alice", "Bob", "Carol"]);

    grid.destroy();
    container.remove();
  });

  it("cellMenu grid.getRows() returns source rows (not display rows) after sort", async () => {
    const container = createContainer();
    const rows: RowData[] = [
      { score: 3 },
      { score: 1 },
      { score: 2 },
    ];
    let capturedRows: RowData[] | null = null;
    const grid = new Grid({
      rows,
      columns: [{ field: "score", sortable: true }],
      suppressRowVirtualization: true,
      cellMenu: {
        enabled: true,
        getActions: (ctx) => {
          capturedRows = ctx.grid.getRows();
          return [{ id: "test", label: "Test" }];
        },
      },
    });
    grid.mount(container);
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    // Trigger cell menu via right-click on the first rendered cell
    const firstCell = container.querySelector(`.${CSS.CELL}`);
    expect(firstCell).not.toBeNull();
    firstCell!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );

    // getActions was called — captured grid.getRows() must be source order.
    expect(capturedRows).not.toBeNull();
    expect(capturedRows!.map((r) => r.score)).toEqual([3, 1, 2]);

    grid.destroy();
    container.remove();
  });

  it("cellMenu grid.getRows() shallow-copies source rows through DomGridRenderer", async () => {
    const container = createContainer();
    const rows: RowData[] = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ];
    let firstCapture: RowData[] | null = null;
    let secondCapture: RowData[] | null = null;
    let openCount = 0;
    const grid = new Grid({
      rows,
      columns: [{ field: "name" }],
      suppressRowVirtualization: true,
      cellMenu: {
        enabled: true,
        getActions: (ctx) => {
          const captured = ctx.grid.getRows();
          if (openCount === 0) {
            firstCapture = captured;
            captured.reverse();
          } else {
            secondCapture = captured;
          }
          openCount += 1;
          return [{ id: "test", label: "Test" }];
        },
      },
    });
    grid.mount(container);
    await flushRenders();

    const cell = container.querySelector(`.${CSS.CELL}`);
    expect(cell).not.toBeNull();
    cell!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );

    expect(firstCapture).not.toBeNull();
    expect(firstCapture).not.toBe(rows);
    expect(firstCapture!.map((row) => row.name)).toEqual(["Bob", "Alice"]);
    expect(firstCapture![0]).toBe(rows[1]);
    expect(rows.map((row) => row.name)).toEqual(["Alice", "Bob"]);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushRenders();

    cell!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );

    expect(secondCapture).not.toBeNull();
    expect(secondCapture).not.toBe(firstCapture);
    expect(secondCapture!.map((row) => row.name)).toEqual(["Alice", "Bob"]);
    expect(secondCapture![0]).toBe(rows[0]);

    grid.destroy();
    container.remove();
  });

  it("source rows are preserved in original order after multiple sort changes", async () => {
    const container = createContainer();
    const rows: RowData[] = [
      { score: 3 },
      { score: 1 },
      { score: 2 },
    ];
    let capturedRows: RowData[] | null = null;
    const grid = new Grid({
      rows,
      columns: [{ field: "score", sortable: true }],
      suppressRowVirtualization: true,
      cellMenu: {
        enabled: true,
        getActions: (ctx) => {
          capturedRows = ctx.grid.getRows();
          return [{ id: "test", label: "Test" }];
        },
      },
    });
    grid.mount(container);

    // Sort ascending
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();
    expect(getRenderedRowTexts(container)).toEqual(["1", "2", "3"]);

    // Sort descending
    grid.setSortModel([{ field: "score", sort: "desc" }]);
    await flushRenders();
    expect(getRenderedRowTexts(container)).toEqual(["3", "2", "1"]);

    // Clear sort — display reverts to source order
    grid.setSortModel([]);
    await flushRenders();
    expect(getRenderedRowTexts(container)).toEqual(["3", "1", "2"]);

    // Trigger cell menu — captured getRows() must be source order
    const firstCell = container.querySelector(`.${CSS.CELL}`);
    firstCell!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );
    expect(capturedRows).not.toBeNull();
    expect(capturedRows!.map((r) => r.score)).toEqual([3, 1, 2]);

    grid.destroy();
    container.remove();
  });

  it("row-pinned top rows render from display order after sort", async () => {
    const container = createContainer();
    const rows: RowData[] = [
      { id: "a", score: 30 },
      { id: "b", score: 10 },
      { id: "c", score: 20 },
    ];
    const grid = new Grid({
      rows,
      columns: [{ field: "score", sortable: true }],
      getRowId: (row: RowData) => row.id as string,
      suppressRowVirtualization: true,
      rowPinning: { top: ["b"], bottom: [] },
    });
    grid.mount(container);
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    // Row "b" (score=10) is pinned to top — should show its display data.
    const topLayer = container.querySelector(".lfg-row-pinned-top-layer");
    expect(topLayer).not.toBeNull();
    const pinnedCells = topLayer!.querySelectorAll(`.${CSS.CELL}`);
    const pinnedTexts = Array.from(pinnedCells).map((c) => c.textContent);
    expect(pinnedTexts).toContain("10");

    // Center rows should NOT contain row "b"
    const centerRows = container.querySelectorAll(
      `.${CSS.SCROLL_CONTAINER} > .${CSS.ROW}:not([style*="display: none"])`,
    );
    const centerTexts: string[] = [];
    for (const row of Array.from(centerRows)) {
      const cell = row.querySelector(`.${CSS.CELL}`);
      if (cell?.textContent) centerTexts.push(cell.textContent);
    }
    // After sort asc and removing pinned "b" (score=10): center should have 20, 30
    expect(centerTexts).not.toContain("10");

    grid.destroy();
    container.remove();
  });

  it("cell styling receives display row data after sorting", async () => {
    const container = createContainer();
    const rows: RowData[] = [
      { score: 3 },
      { score: 1 },
      { score: 2 },
    ];
    const grid = new Grid({
      rows,
      columns: [
        {
          field: "score",
          sortable: true,
          getCellClass: (p: { row: RowData }) =>
            (p.row.score as number) === 1 ? "lowest" : null,
        },
      ],
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    // After sort asc, first rendered row is score=1 and should have "lowest" class.
    const domRows = container.querySelectorAll(`.${CSS.ROW}`);
    const firstCell = domRows[0]?.querySelector(`.${CSS.CELL}`);
    expect(firstCell?.classList.contains("lowest")).toBe(true);

    // Last row (score=3) should not have "lowest"
    const lastCell = domRows[domRows.length - 1]?.querySelector(`.${CSS.CELL}`);
    expect(lastCell?.classList.contains("lowest")).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("DisplayRowReader provides display-order access while RowView.rows holds source order", () => {
    // Use GridState directly to get a snapshot with RowView, then build
    // a DisplayRowReader from it — no private renderer access needed.
    const rows: RowData[] = [
      { score: 3 },
      { score: 1 },
      { score: 2 },
    ];
    const state = new GridState({
      rows,
      columns: [{ field: "score", sortable: true }],
    });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const snap = state.getSnapshot();

    // RowView.rows is the source array — original insertion order.
    expect(snap.rowView.rows).toBe(rows);
    expect(snap.rowView.rows.map((r) => r.score)).toEqual([3, 1, 2]);

    // DisplayRowReader built from RowView provides display-order access.
    const reader = createDisplayRowReader(snap.rowView);
    expect(reader.rowCount).toBe(3);
    // Display order after sort asc: score 1, 2, 3
    expect(reader.getRowData(0)?.score).toBe(1);
    expect(reader.getRowData(1)?.score).toBe(2);
    expect(reader.getRowData(2)?.score).toBe(3);
    // Source index mapping: display[0]=score1 is source[1]
    expect(reader.getSourceIndex(0)).toBe(1);
    expect(reader.getSourceIndex(1)).toBe(2);
    expect(reader.getSourceIndex(2)).toBe(0);

    // snapshot.data is the raw source-rows reference (no materialization).
    expect(snap.data).toBe(rows);
    expect(snap.data.map((r) => r.score)).toEqual([3, 1, 2]);
  });
});
