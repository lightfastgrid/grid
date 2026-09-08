// @vitest-environment jsdom

/**
 * Focused cell + keyboard navigation — Grid integration tests.
 *
 * Pure store/navigation tests are colocated with the feature in
 * `features/focus/__tests__`. This file covers the mounted behavior:
 * click-to-focus, keyboard navigation on the grid root, identity
 * survival across sort/pagination/row updates, visuals, and aria.
 */

import { describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import type {
  LightFastGridFocusedCellChangedEvent,
  LightFastGridProps,
  RowData,
} from "../../../types";

// Fresh defs per grid: column visibility APIs write `visible` onto the
// user def objects, so a shared module-level array would leak hidden
// state from one test grid into the next.
function makeCols() {
  return [
    { field: "name", sortable: true },
    { field: "v", sortable: true },
  ];
}

function makeRows(n: number): RowData[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    name: `row ${i}`,
    v: i,
  }));
}

async function flushRenders(): Promise<void> {
  for (const viewport of document.querySelectorAll(".lfg-viewport")) {
    viewport.dispatchEvent(new Event("scrollend"));
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function createGrid(props: Partial<LightFastGridProps> = {}) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "400px", width: "600px" });
  document.body.appendChild(container);

  const events: LightFastGridFocusedCellChangedEvent[] = [];
  const grid = new Grid({
    columns: makeCols(),
    rows: makeRows(25),
    getRowId: (row) => row.id,
    suppressRowVirtualization: true,
    onFocusedCellChanged: (e) => events.push(e),
    ...props,
  });
  grid.mount(container);
  await flushRenders();
  const root = container.querySelector<HTMLElement>(".lfg-grid")!;
  return { grid, container, root, events };
}

/**
 * `aria-activedescendant` is owned by the accessibility plugin on the neutral
 * grid surface (F16A), not the outer root. Keyboard/pointer listeners stay
 * delegated on the root.
 */
function activeDescendant(container: HTMLElement): string | null {
  return container
    .querySelector<HTMLElement>(".lfg-grid-surface")!
    .getAttribute("aria-activedescendant");
}

function cellEl(
  container: HTMLElement,
  rowId: string,
  field: string,
): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    `[data-row-id="${rowId}"] .lfg-cell[data-col-id="${field}"]`,
  );
  expect(el).not.toBeNull();
  return el!;
}

function clickCell(container: HTMLElement, rowId: string, field: string): void {
  cellEl(container, rowId, field).dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
  );
}

/** Dispatch a keydown on the composite grid surface; returns defaultPrevented. */
function pressKey(
  root: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  const surface = root.querySelector<HTMLElement>(".lfg-grid-surface")!;
  surface.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("focused cell: click-to-focus", () => {
  it("clicking a body cell focuses it and emits one event", async () => {
    const { grid, container, events } = await createGrid();

    clickCell(container, "r2", "v");

    expect(grid.getFocusedCell()).toEqual({
      rowId: "r2",
      field: "v",
      rowIndex: 2,
      sourceIndex: 2,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      focusedCell: { rowId: "r2", field: "v" },
      previousCell: null,
      source: "click",
    });

    // Visuals + aria.
    const el = cellEl(container, "r2", "v");
    expect(el.classList.contains("lfg-cell-focused")).toBe(true);
    expect(el.id).not.toBe("");
    expect(activeDescendant(container)).toBe(el.id);

    // Clicking the same cell again does not emit.
    clickCell(container, "r2", "v");
    expect(events).toHaveLength(1);

    // Focus class moves to the new cell.
    clickCell(container, "r3", "name");
    expect(events).toHaveLength(2);
    expect(el.classList.contains("lfg-cell-focused")).toBe(false);
    expect(
      cellEl(container, "r3", "name").classList.contains("lfg-cell-focused"),
    ).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("interactive targets do not steal focus", async () => {
    const { grid, container, events } = await createGrid({
      rowSelection: { mode: "multiple", checkboxes: true, headerCheckbox: true },
      rowDrag: { enabled: true, managed: true },
    });

    // Row selection checkbox.
    const checkbox = container.querySelector<HTMLElement>(
      ".lfg-row-selection-checkbox",
    );
    expect(checkbox).not.toBeNull();
    checkbox!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );

    // Row drag handle.
    const dragHandle = container.querySelector<HTMLElement>(
      ".lfg-row-drag-handle",
    );
    if (dragHandle) {
      dragHandle.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    }

    expect(grid.getFocusedCell()).toBeNull();
    expect(events).toHaveLength(0);

    grid.destroy();
    container.remove();
  });
});

describe("focused cell: keyboard navigation", () => {
  it("arrow keys move focus and remain owned at logical boundaries", async () => {
    const { grid, container, root } = await createGrid();
    clickCell(container, "r1", "name");

    expect(pressKey(root, "ArrowDown")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r2", field: "name" });

    expect(pressKey(root, "ArrowRight")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r2", field: "v" });

    expect(pressKey(root, "ArrowUp")).toBe(true);
    expect(pressKey(root, "ArrowLeft")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r1", field: "name" });

    // Clamped at the left boundary: retain focus and suppress native scrolling.
    expect(pressKey(root, "ArrowLeft")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r1", field: "name" });

    grid.destroy();
    container.remove();
  });

  it("Home/End move within the row; Ctrl/Cmd+Home/End jump to corners", async () => {
    const { grid, container, root } = await createGrid();
    clickCell(container, "r5", "v");

    expect(pressKey(root, "Home")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r5", field: "name" });

    expect(pressKey(root, "End")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r5", field: "v" });

    expect(pressKey(root, "Home", { ctrlKey: true })).toBe(true);
    const firstTargetId = activeDescendant(container);
    expect(firstTargetId).not.toBeNull();
    expect(document.getElementById(firstTargetId!)?.getAttribute("role")).toBe(
      "columnheader",
    );

    expect(pressKey(root, "End", { metaKey: true })).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r24", field: "v" });

    grid.destroy();
    container.remove();
  });

  it("PageUp/PageDown move by page size and clamp", async () => {
    const { grid, container, root } = await createGrid();
    clickCell(container, "r0", "name");

    // jsdom viewport height is 0 → fallback page size of 10.
    expect(pressKey(root, "PageDown")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r10" });
    expect(pressKey(root, "PageDown")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r20" });
    expect(pressKey(root, "PageDown")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r24" }); // clamped

    expect(pressKey(root, "PageDown")).toBe(true); // owned at the end

    expect(pressKey(root, "PageUp")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r14" });

    grid.destroy();
    container.remove();
  });

  it("initial arrow key focuses the first visible cell", async () => {
    const { grid, root, container, events } = await createGrid();
    expect(grid.getFocusedCell()).toBeNull();

    expect(pressKey(root, "ArrowDown")).toBe(true);
    expect(grid.getFocusedCell()).toEqual({
      rowId: "r0",
      field: "name",
      rowIndex: 0,
      sourceIndex: 0,
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("keyboard");

    grid.destroy();
    container.remove();
  });

  it("starts on the first leaf header when there are columns but no rows", async () => {
    const { grid, root, container, events } = await createGrid({ rows: [] });
    expect(pressKey(root, "ArrowDown")).toBe(true);
    expect(grid.getFocusedCell()).toBeNull();
    expect(events).toHaveLength(0);
    const targetId = activeDescendant(container);
    expect(targetId).not.toBeNull();
    expect(document.getElementById(targetId!)?.getAttribute("role")).toBe(
      "columnheader",
    );
    grid.destroy();
    container.remove();
  });
});

describe("focused cell: row model changes", () => {
  it("focus survives sorting by rowId + field with refreshed indexes", async () => {
    const { grid, container, events } = await createGrid();
    clickCell(container, "r0", "v");
    expect(events).toHaveLength(1);

    grid.setSortModel([{ field: "v", sort: "desc" }]); // r0 moves to the end
    await flushRenders();

    expect(grid.getFocusedCell()).toEqual({
      rowId: "r0",
      field: "v",
      rowIndex: 24,
      sourceIndex: 0,
    });
    // No event for an identity-preserving reposition.
    expect(events).toHaveLength(1);
    // Visuals follow the row to its new position.
    expect(
      cellEl(container, "r0", "v").classList.contains("lfg-cell-focused"),
    ).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("focus clears with one event when the focused row is removed", async () => {
    const { grid, container, events } = await createGrid();
    clickCell(container, "r1", "name");

    grid.applyTransaction({ removeIds: ["r1"] });
    await flushRenders();

    expect(grid.getFocusedCell()).toBeNull();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      focusedCell: null,
      previousCell: { rowId: "r1", field: "name" },
    });

    grid.destroy();
    container.remove();
  });

  it("focus clears when the focused column is hidden", async () => {
    const { grid, container, events } = await createGrid();
    clickCell(container, "r1", "v");

    grid.hideColumns(["v"]);
    await flushRenders();

    expect(grid.getFocusedCell()).toBeNull();
    expect(events).toHaveLength(2);
    expect(events[1]!.focusedCell).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("pagination does not reuse a page-local row index as identity", async () => {
    const { grid, container, events } = await createGrid({
      pagination: true,
      paginationPageSize: 5,
    });
    clickCell(container, "r2", "name");
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r2", rowIndex: 2 });

    grid.nextPage();
    await flushRenders();

    // r2 is not on page 2 — focus must clear, not jump to the row that
    // now occupies display index 2 (r7).
    expect(grid.getFocusedCell()).toBeNull();
    expect(events).toHaveLength(2);
    expect(events[1]!.previousCell).toMatchObject({ rowId: "r2" });

    grid.destroy();
    container.remove();
  });
});

describe("focused cell: horizontal scrolling with column virtualization", () => {
  /** 12 fixed-width columns — far columns sit outside any narrow view. */
  function makeWideCols() {
    return Array.from({ length: 12 }, (_, i) => ({
      field: `c${i}`,
      width: 150,
    }));
  }

  it("moving focus to an off-screen column scrolls the viewport", async () => {
    const { grid, container } = await createGrid({ columns: makeWideCols() });
    const viewport = container.querySelector<HTMLElement>(".lfg-viewport")!;
    expect(viewport.scrollLeft).toBe(0);

    grid.setFocusedCell({ rowIndex: 0, field: "c0" });

    // jsdom viewport clientWidth is 0 — every column's right edge is
    // beyond the visible window, so each rightward move must scroll.
    grid.moveFocusedCell("right");
    expect(grid.getFocusedCell()).toMatchObject({ field: "c1" });
    expect(viewport.scrollLeft).toBeGreaterThan(0);

    const before = viewport.scrollLeft;
    grid.setFocusedCell({ rowIndex: 0, field: "c9" });
    expect(grid.getFocusedCell()).toMatchObject({ field: "c9", rowId: "r0" });
    expect(viewport.scrollLeft).toBeGreaterThan(before);
    // Right edge of c9 = 10 columns × 150px (clientWidth 0).
    expect(viewport.scrollLeft).toBe(10 * 150);

    // Scrolling back left when focusing an earlier column.
    grid.setFocusedCell({ rowIndex: 0, field: "c0" });
    expect(viewport.scrollLeft).toBe(0);

    grid.destroy();
    container.remove();
  });

  it("scrolls a center field past left-pinned columns to its real position", async () => {
    // c0 is pinned left; c1..c11 are center columns (all 150px wide).
    const columns = makeWideCols().map((col, i) =>
      i === 0 ? { ...col, pinned: "left" as const } : col,
    );
    const { grid, container } = await createGrid({ columns });
    const viewport = container.querySelector<HTMLElement>(".lfg-viewport")!;

    grid.setFocusedCell({ rowIndex: 0, field: "c9" });
    expect(grid.getFocusedCell()).toMatchObject({ field: "c9", rowId: "r0" });

    // c9's real content position is leftPinnedWidth (150) + its center
    // offset. With jsdom clientWidth 0 the target's right edge becomes
    // scrollLeft: 10 columns × 150px = 1500, which INCLUDES the 150px
    // left-pinned lane. The old center-only math under-scrolled to 1350.
    expect(viewport.scrollLeft).toBe(10 * 150);
    expect(viewport.scrollLeft).toBeGreaterThan(9 * 150);

    grid.destroy();
    container.remove();
  });

  it("re-applies focused class + aria after scroll sync under column virtualization", async () => {
    // Virtualization ON (default). Give the viewport a real width so the
    // horizontal window renders a bounded slice; c9 starts off-screen.
    const { grid, container } = await createGrid({
      columns: makeWideCols(),
    });
    const viewport = container.querySelector<HTMLElement>(".lfg-viewport")!;
    Object.defineProperty(viewport, "clientWidth", {
      configurable: true,
      value: 450,
    });
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 300,
    });
    // Re-render so the pool resizes to the now-nonzero viewport width.
    grid.setColumns(makeWideCols());
    await flushRenders();

    // c9 is outside the initial horizontal window.
    expect(
      container.querySelector('[data-row-id="r0"] .lfg-cell[data-col-id="c9"]'),
    ).toBeNull();

    grid.setFocusedCell({ rowIndex: 0, field: "c9" });
    expect(viewport.scrollLeft).toBeGreaterThan(0);

    // A real browser fires `scroll` asynchronously when scrollLeft is set
    // programmatically; jsdom does not, so simulate it. The renderer's
    // scroll-sync renders the now-visible column window and re-applies
    // focus visuals via syncFocusState.
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    // After scroll sync the target column is now rendered; focus visuals
    // and aria were re-applied onto the recycled cell.
    const el = cellEl(container, "r0", "c9");
    expect(el.classList.contains("lfg-cell-focused")).toBe(true);
    expect(activeDescendant(container)).toBe(el.id);

    grid.destroy();
    container.remove();
  });
});

describe("focused cell: pinned rows (visual navigation)", () => {
  // 6 rows; r1 pinned top, r4 pinned bottom.
  // Visual order: [r1] top, [r0, r2, r3, r5] center, [r4] bottom.
  async function pinnedRowGrid() {
    return createGrid({
      rows: makeRows(6),
      rowPinning: { top: ["r1"], bottom: ["r4"] },
    });
  }

  it("ArrowUp from the first center row moves into the top-pinned row", async () => {
    const { grid, container } = await pinnedRowGrid();
    grid.setFocusedCell({ rowId: "r0", field: "name" }); // first center row
    grid.moveFocusedCell("up");
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r1", field: "name" });
    grid.destroy();
    container.remove();
  });

  it("ArrowDown from the top-pinned row moves into the first center row", async () => {
    const { grid, container } = await pinnedRowGrid();
    grid.setFocusedCell({ rowId: "r1", field: "name" });
    grid.moveFocusedCell("down");
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r0", field: "name" });
    grid.destroy();
    container.remove();
  });

  it("ArrowDown from the last center row moves into the bottom-pinned row", async () => {
    const { grid, container } = await pinnedRowGrid();
    grid.setFocusedCell({ rowId: "r5", field: "name" }); // last center row
    grid.moveFocusedCell("down");
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r4", field: "name" });
    grid.destroy();
    container.remove();
  });

  it("ArrowUp from the bottom-pinned row moves into the last center row", async () => {
    const { grid, container } = await pinnedRowGrid();
    grid.setFocusedCell({ rowId: "r4", field: "name" });
    grid.moveFocusedCell("up");
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r5", field: "name" });
    grid.destroy();
    container.remove();
  });

  it("applies the focused class + aria in the row-pinned top lane", async () => {
    const { grid, container } = await pinnedRowGrid();
    grid.setFocusedCell({ rowId: "r1", field: "name" });
    await flushRenders();

    const el = cellEl(container, "r1", "name");
    expect(el.closest(".lfg-row-pinned-top-layer")).not.toBeNull();
    expect(el.classList.contains("lfg-cell-focused")).toBe(true);
    expect(activeDescendant(container)).toBe(el.id);
    grid.destroy();
    container.remove();
  });

  it("applies the focused class + aria in the row-pinned bottom lane", async () => {
    const { grid, container } = await pinnedRowGrid();
    grid.setFocusedCell({ rowId: "r4", field: "v" });
    await flushRenders();

    const el = cellEl(container, "r4", "v");
    expect(el.closest(".lfg-row-pinned-bottom-layer")).not.toBeNull();
    expect(el.classList.contains("lfg-cell-focused")).toBe(true);
    expect(activeDescendant(container)).toBe(el.id);
    grid.destroy();
    container.remove();
  });

  it("clicking a cell in the top/bottom pinned lanes focuses it", async () => {
    const { grid, container } = await pinnedRowGrid();
    await flushRenders();

    clickCell(container, "r1", "name"); // top-pinned lane
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r1", field: "name" });

    clickCell(container, "r4", "v"); // bottom-pinned lane
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r4", field: "v" });

    grid.destroy();
    container.remove();
  });

  // 30 rows so the center body is taller than the mocked viewport and
  // genuinely scrollable; r0 pinned top, r29 pinned bottom.
  async function scrollablePinnedGrid() {
    const result = await createGrid({
      rows: makeRows(30),
      rowPinning: { top: ["r0"], bottom: ["r29"] },
    });
    const viewport = result.container.querySelector<HTMLElement>(
      ".lfg-viewport",
    )!;
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 200,
    });
    return { ...result, viewport };
  }

  it("ArrowDown into the bottom-pinned row does not scroll the body", async () => {
    const { grid, container, viewport } = await scrollablePinnedGrid();

    // Last center row is r28 (display indexes: r0 top, r1..r28 center).
    grid.setFocusedCell({ rowId: "r28", field: "name" });
    const beforeTop = viewport.scrollTop;

    grid.moveFocusedCell("down"); // → bottom-pinned r29
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r29" });
    // Pinned row is always visible — body scroll must not jump to its
    // (large) display index.
    expect(viewport.scrollTop).toBe(beforeTop);

    grid.destroy();
    container.remove();
  });

  it("ArrowUp into the top-pinned row does not scroll the body", async () => {
    const { grid, container, viewport } = await scrollablePinnedGrid();

    grid.setFocusedCell({ rowId: "r1", field: "name" }); // first center row
    viewport.scrollTop = 300; // body scrolled away from the top
    grid.moveFocusedCell("up"); // → top-pinned r0

    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r0" });
    // Without the pinned-row guard this would scroll the body back to 0.
    expect(viewport.scrollTop).toBe(300);

    grid.destroy();
    container.remove();
  });
});

describe("focused cell: pinned columns (visual navigation)", () => {
  // Visual column order: L (left) → a → b → R (right).
  function pinnedCols() {
    return [
      { field: "L", pinned: "left" as const },
      { field: "a" },
      { field: "b" },
      { field: "R", pinned: "right" as const },
    ];
  }

  it("ArrowLeft/ArrowRight traverse pinned columns in visual order", async () => {
    const { grid, container } = await createGrid({ columns: pinnedCols() });

    grid.setFocusedCell({ rowIndex: 0, field: "a" });
    grid.moveFocusedCell("left");
    expect(grid.getFocusedCell()).toMatchObject({ field: "L" }); // left-pinned

    grid.setFocusedCell({ rowIndex: 0, field: "b" });
    grid.moveFocusedCell("right");
    expect(grid.getFocusedCell()).toMatchObject({ field: "R" }); // right-pinned

    grid.destroy();
    container.remove();
  });

  it("moving into a pinned column does not horizontal-scroll", async () => {
    const { grid, container } = await createGrid({ columns: pinnedCols() });
    const viewport = container.querySelector<HTMLElement>(".lfg-viewport")!;

    grid.setFocusedCell({ rowIndex: 0, field: "a" });
    viewport.scrollLeft = 0;
    grid.moveFocusedCell("left"); // → L (left-pinned)
    expect(grid.getFocusedCell()).toMatchObject({ field: "L" });
    expect(viewport.scrollLeft).toBe(0);

    grid.moveFocusedCell("end"); // → R (right-pinned)
    expect(grid.getFocusedCell()).toMatchObject({ field: "R" });
    expect(viewport.scrollLeft).toBe(0);

    grid.destroy();
    container.remove();
  });

  it("moving into an off-screen center column still scrolls", async () => {
    // L pinned, then many center columns, then R pinned.
    const columns = [
      { field: "L", pinned: "left" as const },
      ...Array.from({ length: 10 }, (_, i) => ({ field: `c${i}`, width: 150 })),
      { field: "R", pinned: "right" as const },
    ];
    const { grid, container } = await createGrid({ columns });
    const viewport = container.querySelector<HTMLElement>(".lfg-viewport")!;

    grid.setFocusedCell({ rowIndex: 0, field: "c9" });
    expect(grid.getFocusedCell()).toMatchObject({ field: "c9" });
    expect(viewport.scrollLeft).toBeGreaterThan(0);

    grid.destroy();
    container.remove();
  });

  it("applies the focused class in the left-pinned lane on a normal row", async () => {
    const { grid, container } = await createGrid({ columns: pinnedCols() });
    grid.setFocusedCell({ rowId: "r0", field: "L" });
    await flushRenders();

    const el = cellEl(container, "r0", "L");
    expect(el.classList.contains("lfg-cell-focused")).toBe(true);
    expect(activeDescendant(container)).toBe(el.id);
    grid.destroy();
    container.remove();
  });

  it("applies the focused class in the right-pinned lane on a normal row (click + visual)", async () => {
    const { grid, container } = await createGrid({ columns: pinnedCols() });
    await flushRenders();

    clickCell(container, "r0", "R"); // right-pinned lane cell
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r0", field: "R" });
    await flushRenders();

    const el = cellEl(container, "r0", "R");
    expect(el.classList.contains("lfg-cell-focused")).toBe(true);
    expect(activeDescendant(container)).toBe(el.id);
    grid.destroy();
    container.remove();
  });

  it("applies focus visuals in row-pinned left and right sub-lanes", async () => {
    // Pinned rows + pinned columns: a focused cell lands in a row-pin
    // top/bottom lane AND a left/right column sub-lane.
    const columns = [
      { field: "L", pinned: "left" as const },
      { field: "a" },
      { field: "R", pinned: "right" as const },
    ];
    const { grid, container } = await createGrid({
      columns,
      rows: makeRows(6),
      rowPinning: { top: ["r1"], bottom: ["r4"] },
    });

    // Left-pinned column on the top-pinned row → top-left sub-lane.
    grid.setFocusedCell({ rowId: "r1", field: "L" });
    await flushRenders();
    const topLeft = cellEl(container, "r1", "L");
    expect(topLeft.closest(".lfg-row-pinned-top-left-layer")).not.toBeNull();
    expect(topLeft.classList.contains("lfg-cell-focused")).toBe(true);
    expect(activeDescendant(container)).toBe(topLeft.id);

    // Right-pinned column on the bottom-pinned row → bottom-right sub-lane.
    grid.setFocusedCell({ rowId: "r4", field: "R" });
    await flushRenders();
    const bottomRight = cellEl(container, "r4", "R");
    expect(bottomRight.classList.contains("lfg-cell-focused")).toBe(true);
    expect(activeDescendant(container)).toBe(bottomRight.id);

    grid.destroy();
    container.remove();
  });
});

describe("focused cell: runtime API", () => {
  it("setFocusedCell / clearFocusedCell / moveFocusedCell", async () => {
    const { grid, container, events } = await createGrid();

    grid.setFocusedCell({ rowId: "r4", field: "v" });
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r4", rowIndex: 4 });
    expect(events[0]!.source).toBe("api");

    grid.setFocusedCell({ rowIndex: 1, field: "name" });
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r1" });

    // Unknown field / row → no-op, no event.
    const count = events.length;
    grid.setFocusedCell({ rowId: "r4", field: "missing" });
    grid.setFocusedCell({ rowId: "missing", field: "v" });
    expect(events).toHaveLength(count);

    grid.moveFocusedCell("down");
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r2" });

    grid.clearFocusedCell();
    expect(grid.getFocusedCell()).toBeNull();
    // Clearing again does not emit.
    const after = events.length;
    grid.clearFocusedCell();
    expect(events).toHaveLength(after);

    grid.destroy();
    container.remove();
  });
});
