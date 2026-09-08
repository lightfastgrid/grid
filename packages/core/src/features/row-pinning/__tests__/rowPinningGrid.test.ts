// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import { CSS } from "../../../rendering/const/css-classes";
import { queryCenterPoolRows } from "../../../rendering/helpers/dom/centerPoolRows";
import { HEADER_HEIGHT,ROW_HEIGHT } from "../../../rendering/helpers/gridConstants";
import type { ColumnDef, GridSnapshot, RowData } from "../../../types";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

const rows: RowData[] = [
  { id: "r1", name: "Alice" },
  { id: "r2", name: "Bob" },
  { id: "r3", name: "Carol" },
  { id: "r4", name: "Dave" },
  { id: "r5", name: "Eve" },
];

const columns: ColumnDef[] = [
  { field: "id" },
  { field: "name" },
];

/**
 * Push a `{ rowId → position }` map through the public `setRowPinState` API.
 * Use this instead of mutating private renderer state from tests.
 */
function setPinState(grid: Grid, state: Record<string, "top" | "bottom">): void {
  const entries = Object.entries(state).map(([rowId, pinned]) => ({
    rowId,
    pinned,
  }));
  grid.setRowPinState(entries);
}

/** Convert the legacy `{ rowId → position }` test map to a `RowPinningProp`. */
function toRowPinningProp(
  state: Record<string, "top" | "bottom">,
): { top: string[]; bottom: string[] } {
  const top: string[] = [];
  const bottom: string[] = [];
  for (const [rowId, pinned] of Object.entries(state)) {
    if (pinned === "top") top.push(rowId);
    else bottom.push(rowId);
  }
  return { top, bottom };
}

function forceRender(grid: Grid): void {
  const internals = grid as unknown as {
    renderer: { render(snapshot: GridSnapshot): void };
    state: { getSnapshot(): GridSnapshot };
  };
  internals.renderer.render(internals.state.getSnapshot());
}

function makeGrid(opts?: {
  rowPinState?: Record<string, "top" | "bottom">;
  columns?: ColumnDef[];
}) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "300px", width: "400px" });
  document.body.appendChild(container);

  const cols = opts?.columns ?? columns;

  const grid = new Grid({
    rows,
    columns: cols,
    getRowId: (row: RowData) => row.id as string,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    // Seed pre-mount through the public initial prop, not private state.
    rowPinning: opts?.rowPinState ? toRowPinningProp(opts.rowPinState) : undefined,
  });

  grid.mount(container);
  return { grid, container };
}

function getRoot(container: HTMLElement): HTMLElement {
  return container.querySelector(`.${CSS.GRID}`) as HTMLElement;
}

function getTopLayer(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-row-pinned-top-layer");
}

function getBottomLayer(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-row-pinned-bottom-layer");
}

function getCenterRowIds(root: HTMLElement): string[] {
  const scrollContainer = root.querySelector(`.${CSS.SCROLL_CONTAINER}`)!;
  return queryCenterPoolRows(scrollContainer)
    .map((r) => r.getAttribute("data-row-id"))
    .filter((id): id is string => id !== null);
}

function getPinnedLayerRowIds(layer: HTMLElement): string[] {
  const rows = layer.querySelectorAll<HTMLElement>(`.${CSS.ROW}`);
  return Array.from(rows)
    .map((r) => r.getAttribute("data-row-id"))
    .filter((id): id is string => id !== null);
}

function getCenterRowTranslateYs(root: HTMLElement): number[] {
  const scrollContainer = root.querySelector(`.${CSS.SCROLL_CONTAINER}`)!;
  return queryCenterPoolRows(scrollContainer)
    .map((r) => {
      const match = r.style.transform.match(/translateY\((\d+)px\)/);
      return match ? Number(match[1]) : -1;
    })
    .sort((a, b) => a - b);
}

function getScrollContainerHeight(root: HTMLElement): number {
  const sc = root.querySelector(`.${CSS.SCROLL_CONTAINER}`) as HTMLElement;
  const match = sc.style.height.match(/^(\d+)px$/);
  return match ? Number(match[1]) : -1;
}

/**
 * Extract the sorted set of column indices a row currently displays. Cell text
 * is `val-{row}-{col}`, so the trailing number identifies the bound column.
 */
function colIndicesOf(rowEl: Element): number[] {
  return Array.from(rowEl.querySelectorAll(`.${CSS.CELL}`))
    .map((c) => c.textContent.trim())
    .map((t) => {
      const m = t.match(/val-\d+-(\d+)/);
      return m ? Number(m[1]) : -1;
    })
    .filter((n) => n >= 0)
    .sort((a, b) => a - b);
}

/** First center (non-pinned) row that has been bound to data. */
function firstBoundCenterRow(root: HTMLElement): Element | undefined {
  const sc = root.querySelector(`.${CSS.SCROLL_CONTAINER}`)!;
  return queryCenterPoolRows(sc).find((r) => r.getAttribute("data-row-id"));
}

describe("row pinning grid integration", () => {
  let grid: Grid;
  let container: HTMLElement;

  afterEach(() => {
    grid.destroy();
    container.remove();
  });

  it("top pinned rows visible at top", async () => {
    ({ grid, container } = makeGrid({ rowPinState: { r1: "top" } }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const topLayer = getTopLayer(root);
    expect(topLayer).not.toBeNull();

    const topRowIds = getPinnedLayerRowIds(topLayer!);
    expect(topRowIds).toContain("r1");

    expect(topLayer!.style.height).toBe(`${ROW_HEIGHT}px`);
  });

  it("bottom pinned rows visible at bottom at scrollTop 0", async () => {
    ({ grid, container } = makeGrid({ rowPinState: { r5: "bottom" } }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const bottomLayer = getBottomLayer(root);
    expect(bottomLayer).not.toBeNull();

    const bottomRowIds = getPinnedLayerRowIds(bottomLayer!);
    expect(bottomRowIds).toContain("r5");

    expect(bottomLayer!.style.height).toBe(`${ROW_HEIGHT}px`);
  });

  it("bottom pinned rows remain visible after vertical scroll", async () => {
    ({ grid, container } = makeGrid({ rowPinState: { r5: "bottom" } }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollTop = 100;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    const bottomLayer = getBottomLayer(root);
    expect(bottomLayer).not.toBeNull();
    const bottomRowIds = getPinnedLayerRowIds(bottomLayer!);
    expect(bottomRowIds).toContain("r5");
  });

  it("top and bottom pinned rows can coexist", async () => {
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top", r5: "bottom" },
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const topLayer = getTopLayer(root);
    const bottomLayer = getBottomLayer(root);

    expect(topLayer).not.toBeNull();
    expect(bottomLayer).not.toBeNull();

    expect(getPinnedLayerRowIds(topLayer!)).toContain("r1");
    expect(getPinnedLayerRowIds(bottomLayer!)).toContain("r5");
  });

  it("pinned rows do not duplicate in center body", async () => {
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top", r5: "bottom" },
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const centerIds = getCenterRowIds(root);

    expect(centerIds).not.toContain("r1");
    expect(centerIds).not.toContain("r5");
    expect(centerIds).toContain("r2");
    expect(centerIds).toContain("r3");
    expect(centerIds).toContain("r4");
  });

  it("no vertical transform on pinned row layers", async () => {
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top", r5: "bottom" },
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const topLayer = getTopLayer(root)!;
    const bottomLayer = getBottomLayer(root)!;

    expect(topLayer.style.transform).toBe("");
    expect(bottomLayer.style.transform).toBe("");

    const topRows = topLayer.querySelectorAll<HTMLElement>(`.${CSS.ROW}`);
    for (const row of Array.from(topRows)) {
      expect(row.style.transform).toBe("");
    }

    const bottomRows = bottomLayer.querySelectorAll<HTMLElement>(`.${CSS.ROW}`);
    for (const row of Array.from(bottomRows)) {
      expect(row.style.transform).toBe("");
    }
  });

  it("layers are children of scroll container for native horizontal scroll", async () => {
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top", r5: "bottom" },
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const scrollContainer = root.querySelector(`.${CSS.SCROLL_CONTAINER}`)!;
    const topLayer = getTopLayer(root)!;
    const bottomLayer = getBottomLayer(root)!;

    expect(topLayer.parentElement).toBe(scrollContainer);
    expect(bottomLayer.parentElement).toBe(scrollContainer);
  });

  it("no lanes created when pin state is empty", async () => {
    ({ grid, container } = makeGrid());
    await flushRenders();

    const root = getRoot(container);
    expect(getTopLayer(root)).toBeNull();
    expect(getBottomLayer(root)).toBeNull();
  });

  it("multiple top pinned rows preserve data order", async () => {
    ({ grid, container } = makeGrid({
      rowPinState: { r3: "top", r1: "top" },
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const topLayer = getTopLayer(root)!;
    const topRowIds = getPinnedLayerRowIds(topLayer);
    expect(topRowIds).toEqual(["r1", "r3"]);

    expect(topLayer.style.height).toBe(`${2 * ROW_HEIGHT}px`);
  });

  // ── Vertical layout contract ──

  it("with one top pinned row, first center row starts below pinned lane", async () => {
    ({ grid, container } = makeGrid({ rowPinState: { r1: "top" } }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const ys = getCenterRowTranslateYs(root);
    const topPinnedHeight = 1 * ROW_HEIGHT;
    for (let i = 0; i < ys.length; i++) {
      expect(ys[i]).toBe(HEADER_HEIGHT + topPinnedHeight + i * ROW_HEIGHT);
    }
  });

  it("with two top pinned rows, first center row starts below both", async () => {
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top", r2: "top" },
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const ys = getCenterRowTranslateYs(root);
    const topPinnedHeight = 2 * ROW_HEIGHT;
    for (let i = 0; i < ys.length; i++) {
      expect(ys[i]).toBe(HEADER_HEIGHT + topPinnedHeight + i * ROW_HEIGHT);
    }
  });

  it("with bottom pinned rows only, center rows start at header height", async () => {
    ({ grid, container } = makeGrid({ rowPinState: { r5: "bottom" } }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const ys = getCenterRowTranslateYs(root);
    for (let i = 0; i < ys.length; i++) {
      expect(ys[i]).toBe(HEADER_HEIGHT + i * ROW_HEIGHT);
    }
  });

  it("scroll container height includes pinned lane heights", async () => {
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top", r5: "bottom" },
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const centerCount = 3; // r2, r3, r4
    const topH = 1 * ROW_HEIGHT;
    const bottomH = 1 * ROW_HEIGHT;
    const expected = HEADER_HEIGHT + topH + centerCount * ROW_HEIGHT + bottomH;
    expect(getScrollContainerHeight(root)).toBe(expected);
  });

  it("scroll container height with no pinned rows has no extra space", async () => {
    ({ grid, container } = makeGrid());
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const expected = HEADER_HEIGHT + 5 * ROW_HEIGHT;
    expect(getScrollContainerHeight(root)).toBe(expected);
  });

  it("clearing pin state resets CSS variables to 0px", async () => {
    ({ grid, container } = makeGrid({ rowPinState: { r1: "top", r5: "bottom" } }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    expect(root.style.getPropertyValue("--lfg-row-pinned-top-height")).toBe(`${ROW_HEIGHT}px`);
    expect(root.style.getPropertyValue("--lfg-row-pinned-bottom-height")).toBe(`${ROW_HEIGHT}px`);

    setPinState(grid, {});
    forceRender(grid);
    await flushRenders();

    expect(root.style.getPropertyValue("--lfg-row-pinned-top-height")).toBe("0px");
    expect(root.style.getPropertyValue("--lfg-row-pinned-bottom-height")).toBe("0px");
  });

  it("re-render reuses lane element when structure unchanged", async () => {
    ({ grid, container } = makeGrid({ rowPinState: { r1: "top" } }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const firstLayer = getTopLayer(root)!;
    expect(firstLayer).not.toBeNull();

    forceRender(grid);
    await flushRenders();

    const secondLayer = getTopLayer(root)!;
    expect(secondLayer).toBe(firstLayer);
  });

  it("changed pin count updates lane correctly", async () => {
    ({ grid, container } = makeGrid({ rowPinState: { r1: "top" } }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const topLayer = getTopLayer(root)!;
    expect(getPinnedLayerRowIds(topLayer)).toEqual(["r1"]);
    expect(topLayer.style.height).toBe(`${ROW_HEIGHT}px`);

    setPinState(grid, { r1: "top", r2: "top" });
    forceRender(grid);
    await flushRenders();

    const newTopLayer = getTopLayer(root)!;
    expect(getPinnedLayerRowIds(newTopLayer)).toEqual(["r1", "r2"]);
    expect(newTopLayer.style.height).toBe(`${2 * ROW_HEIGHT}px`);
  });

  it("pinned rows show selection checkbox when selection column present", async () => {
    const selColumns: ColumnDef[] = [
      { field: "__lfg_selection__", headerName: "", width: 40, internal: "selection" },
      { field: "id" },
      { field: "name" },
    ];
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top" },
      columns: selColumns,
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const topLayer = getTopLayer(root)!;
    const checkbox = topLayer.querySelector(".lfg-row-selection-checkbox");
    expect(checkbox).not.toBeNull();
    expect((checkbox as HTMLInputElement).type).toBe("checkbox");
  });

  it("pinned rows show action trigger when action column present", async () => {
    const actionColumns: ColumnDef[] = [
      { field: "id" },
      { field: "name" },
      { field: "__actions__", cellKind: "actions", actionsKey: "row", actionTrigger: { icon: "⋯" } },
    ];
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top" },
      columns: actionColumns,
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const topLayer = getTopLayer(root)!;
    const trigger = topLayer.querySelector(".lfg-action-trigger");
    expect(trigger).not.toBeNull();
    expect(trigger!.tagName).toBe("BUTTON");
  });

  // ── Horizontal scroll behavior ──

  it("horizontal scroll does not add inline transform to pinned lanes", async () => {
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top", r5: "bottom" },
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollLeft = 50;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    const topLayer = getTopLayer(root)!;
    const bottomLayer = getBottomLayer(root)!;
    expect(topLayer.style.transform).toBe("");
    expect(bottomLayer.style.transform).toBe("");
  });

  it("horizontal scroll does not trigger row pin lane rebuild", async () => {
    ({ grid, container } = makeGrid({ rowPinState: { r1: "top" } }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const layerBefore = getTopLayer(root)!;

    const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollLeft = 80;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    const layerAfter = getTopLayer(root)!;
    expect(layerAfter).toBe(layerBefore);
  });

  it("top and bottom pinned lanes keep same element identity after horizontal scroll", async () => {
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top", r5: "bottom" },
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const topBefore = getTopLayer(root)!;
    const bottomBefore = getBottomLayer(root)!;

    const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollLeft = 120;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    expect(getTopLayer(root)).toBe(topBefore);
    expect(getBottomLayer(root)).toBe(bottomBefore);
  });

  it("pinned lanes are in scroll container for native horizontal scroll participation", async () => {
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top", r5: "bottom" },
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const scrollContainer = root.querySelector(`.${CSS.SCROLL_CONTAINER}`)!;
    const topLayer = getTopLayer(root)!;
    const bottomLayer = getBottomLayer(root)!;

    // Lanes are inside the scroll container, so they move with horizontal scroll natively
    expect(topLayer.closest(`.${CSS.SCROLL_CONTAINER}`)).toBe(scrollContainer);
    expect(bottomLayer.closest(`.${CSS.SCROLL_CONTAINER}`)).toBe(scrollContainer);
  });

  it("deterministic DOM order: top lane before bottom lane regardless of creation order", async () => {
    // Create with both pinned — top should always precede bottom in DOM
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top", r5: "bottom" },
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const scrollContainer = root.querySelector(`.${CSS.SCROLL_CONTAINER}`)!;
    const topLayer = getTopLayer(root)!;
    const bottomLayer = getBottomLayer(root)!;

    const children = Array.from(scrollContainer.children);
    const topIdx = children.indexOf(topLayer);
    const bottomIdx = children.indexOf(bottomLayer);
    expect(topIdx).toBeLessThan(bottomIdx);
  });

  it("top lane is placed after header in DOM", async () => {
    ({ grid, container } = makeGrid({
      rowPinState: { r1: "top" },
    }));
    await flushRenders();
    forceRender(grid);
    await flushRenders();

    const root = getRoot(container);
    const scrollContainer = root.querySelector(`.${CSS.SCROLL_CONTAINER}`)!;
    const header = scrollContainer.querySelector(`.${CSS.HEADER}`)!;
    const topLayer = getTopLayer(root)!;

    const children = Array.from(scrollContainer.children);
    const headerIdx = children.indexOf(header);
    const topIdx = children.indexOf(topLayer);
    expect(topIdx).toBe(headerIdx + 1);
  });

  describe("horizontal column virtualization in pinned lanes", () => {
    const colCount = 50;
    const wideColumns: ColumnDef[] = Array.from({ length: colCount }, (_, i) => ({
      field: `c${i}`,
      width: 120,
    }));

    const wideRows: RowData[] = Array.from({ length: 10 }, (_, r) => {
      const row: Record<string, unknown> = { id: `r${r}` };
      for (let i = 0; i < colCount; i++) row[`c${i}`] = `val-${r}-${i}`;
      return row as RowData;
    });

    function makeWideGrid(pinState: Record<string, "top" | "bottom">) {
      const cont = document.createElement("div");
      Object.assign(cont.style, { height: "300px", width: "400px" });
      document.body.appendChild(cont);

      const g = new Grid({
        rows: wideRows,
        columns: wideColumns,
        getRowId: (row: RowData) => row.id as string,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: false,
        rowPinning: toRowPinningProp(pinState),
      });

      g.mount(cont);
      return { grid: g, container: cont };
    }

    it("pinned lane cells update content after horizontal scroll", async () => {
      ({ grid, container } = makeWideGrid({ r0: "top" }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const topLayer = getTopLayer(root)!;
      const laneRow = topLayer.querySelector(`.${CSS.ROW}`)!;

      // Capture initial cell text content
      const initialTexts = Array.from(laneRow.querySelectorAll(`.${CSS.CELL}`))
        .map((c) => c.textContent);

      // Scroll horizontally far enough to change the column window
      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      viewport.scrollLeft = 2000;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      // After scroll, cells should show different column values
      const afterTexts = Array.from(laneRow.querySelectorAll(`.${CSS.CELL}`))
        .map((c) => c.textContent);

      // At least some cells should have changed (column window shifted)
      const changed = afterTexts.some((t, i) => t !== initialTexts[i]);
      expect(changed).toBe(true);
    });

    it("pinned lane cells match center row cells for same columns after scroll", async () => {
      ({ grid, container } = makeWideGrid({ r0: "top" }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;

      // Scroll right
      viewport.scrollLeft = 1500;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      const topLayer = getTopLayer(root)!;
      const laneRow = topLayer.querySelector(`.${CSS.ROW}`)!;
      const laneCellTexts = Array.from(laneRow.querySelectorAll(`.${CSS.CELL}`))
        .map((c) => c.textContent);

      // Find any center row that has data-row-id (it's bound) and compare cell count
      const scrollContainer = root.querySelector(`.${CSS.SCROLL_CONTAINER}`)!;
      const centerRows = scrollContainer.querySelectorAll<HTMLElement>(`:scope > .${CSS.ROW}:not([style*="display: none"])`);
      // Get the first visible center row
      const centerRow = Array.from(centerRows).find((r) => r.getAttribute("data-row-id"));

      if (centerRow) {
        const centerCellTexts = Array.from(centerRow.querySelectorAll(`.${CSS.CELL}`))
          .map((c) => c.textContent);

        // Same number of physical cell slots
        expect(laneCellTexts.length).toBe(centerCellTexts.length);
      }
    });

    it("lane DOM identity preserved across horizontal scrolls (no rebuild)", async () => {
      ({ grid, container } = makeWideGrid({ r0: "top", r9: "bottom" }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const topLayer = getTopLayer(root)!;
      const bottomLayer = getBottomLayer(root)!;
      const topRowBefore = topLayer.querySelector(`.${CSS.ROW}`)!;
      const bottomRowBefore = bottomLayer.querySelector(`.${CSS.ROW}`)!;

      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      viewport.scrollLeft = 1000;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      // Lane layers and row elements are the same DOM nodes (no rebuild)
      expect(getTopLayer(root)).toBe(topLayer);
      expect(getBottomLayer(root)).toBe(bottomLayer);
      expect(topLayer.querySelector(`.${CSS.ROW}`)).toBe(topRowBefore);
      expect(bottomLayer.querySelector(`.${CSS.ROW}`)).toBe(bottomRowBefore);
    });

    it("bottom pinned lane also updates cells on horizontal scroll", async () => {
      ({ grid, container } = makeWideGrid({ r9: "bottom" }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const bottomLayer = getBottomLayer(root)!;
      const laneRow = bottomLayer.querySelector(`.${CSS.ROW}`)!;

      const initialTexts = Array.from(laneRow.querySelectorAll(`.${CSS.CELL}`))
        .map((c) => c.textContent);

      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      viewport.scrollLeft = 2000;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      const afterTexts = Array.from(laneRow.querySelectorAll(`.${CSS.CELL}`))
        .map((c) => c.textContent);

      const changed = afterTexts.some((t, i) => t !== initialTexts[i]);
      expect(changed).toBe(true);
    });

    it("lane created while already scrolled binds to current window, not first columns", async () => {
      // Mount WITHOUT any pinned rows so the lane does not exist yet.
      const cont = document.createElement("div");
      Object.assign(cont.style, { height: "300px", width: "400px" });
      document.body.appendChild(cont);

      const g = new Grid({
        rows: wideRows,
        columns: wideColumns,
        getRowId: (row: RowData) => row.id as string,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: false,
      });
      g.mount(cont);
      grid = g;
      container = cont;
      await flushRenders();

      const root = getRoot(cont);
      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;

      // Scroll horizontally BEFORE the pinned lane is created.
      viewport.scrollLeft = 1500;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      // Now pin a row and render — the lane is created at this scrolled position.
      g.pinRow("r0", "top");
      await flushRenders();

      const topLayer = getTopLayer(root)!;
      const laneRow = topLayer.querySelector(`.${CSS.ROW}`)!;
      const laneCols = colIndicesOf(laneRow);

      const centerRow = firstBoundCenterRow(root)!;
      const centerCols = colIndicesOf(centerRow);

      // The newly created lane immediately reflects the current horizontal
      // window — identical to the center rows, not reset to the first columns.
      expect(laneCols.length).toBeGreaterThan(0);
      expect(laneCols).toEqual(centerCols);
      expect(laneCols).not.toContain(0);
    });

    it("structural rebuild keeps pinned lane bound to the current window", async () => {
      ({ grid, container } = makeWideGrid({ r0: "top" }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;

      // Scroll right so the active window is away from the first columns.
      viewport.scrollLeft = 1500;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      const laneColsBefore = colIndicesOf(
        getTopLayer(root)!.querySelector(`.${CSS.ROW}`)!,
      );
      expect(laneColsBefore).not.toContain(0);

      // Trigger a structural column change → fullRebuild path.
      grid.setColumns([...wideColumns, { field: "extra", width: 120 }]);
      await flushRenders();

      const laneRow = getTopLayer(root)!.querySelector(`.${CSS.ROW}`)!;
      const laneCols = colIndicesOf(laneRow);
      const centerCols = colIndicesOf(firstBoundCenterRow(root)!);

      // After the rebuild the lane is still bound to the current horizontal
      // window (matching center rows), not reset to the first columns.
      expect(laneCols.length).toBeGreaterThan(0);
      expect(laneCols).toEqual(centerCols);
      expect(laneCols).not.toContain(0);
    });
  });

  describe("left/right sub-lanes inside row-pinned lanes", () => {
    const colCount = 30;
    const wideRows: RowData[] = Array.from({ length: 10 }, (_, r) => {
      const row: Record<string, unknown> = { id: `r${r}` };
      for (let i = 0; i < colCount; i++) row[`c${i}`] = `val-${r}-${i}`;
      return row as RowData;
    });

    function makeColumns(
      leftPinned: string[] = [],
      rightPinned: string[] = [],
    ): ColumnDef[] {
      const cols: ColumnDef[] = [];
      for (const f of leftPinned) cols.push({ field: f, width: 120, pinned: "left" });
      for (let i = 0; i < colCount; i++) {
        const f = `c${i}`;
        if (leftPinned.includes(f) || rightPinned.includes(f)) continue;
        cols.push({ field: f, width: 120 });
      }
      for (const f of rightPinned) cols.push({ field: f, width: 120, pinned: "right" });
      return cols;
    }

    function makeSubLaneGrid(opts: {
      leftPinned?: string[];
      rightPinned?: string[];
      rowPinState: Record<string, "top" | "bottom">;
    }) {
      const cont = document.createElement("div");
      Object.assign(cont.style, { height: "300px", width: "400px" });
      document.body.appendChild(cont);
      const cols = makeColumns(opts.leftPinned, opts.rightPinned);
      const g = new Grid({
        rows: wideRows,
        columns: cols,
        getRowId: (row: RowData) => row.id as string,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: false,
        rowPinning: toRowPinningProp(opts.rowPinState),
      });
      g.mount(cont);
      return { grid: g, container: cont };
    }

    function getTopLeftSubLane(root: HTMLElement): HTMLElement | null {
      return root.querySelector(".lfg-row-pinned-top-left-layer");
    }
    function getTopRightSubLane(root: HTMLElement): HTMLElement | null {
      return root.querySelector(".lfg-row-pinned-top-right-layer");
    }
    function getBottomLeftSubLane(root: HTMLElement): HTMLElement | null {
      return root.querySelector(".lfg-row-pinned-bottom-left-layer");
    }
    function getBottomRightSubLane(root: HTMLElement): HTMLElement | null {
      return root.querySelector(".lfg-row-pinned-bottom-right-layer");
    }

    it("top pinned row with a left-pinned column renders the cell in the left sub-lane after horizontal scroll", async () => {
      ({ grid, container } = makeSubLaneGrid({
        leftPinned: ["c0"],
        rowPinState: { r0: "top" },
      }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const leftSub = getTopLeftSubLane(root)!;
      expect(leftSub).not.toBeNull();

      const cell = leftSub.querySelector(`.${CSS.CELL}[data-col-id="c0"]`);
      expect(cell?.textContent).toBe("val-0-0");

      // Scroll horizontally — the left sub-lane cell stays put with the same value.
      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      viewport.scrollLeft = 1500;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      const cellAfter = leftSub.querySelector(`.${CSS.CELL}[data-col-id="c0"]`);
      expect(cellAfter?.textContent).toBe("val-0-0");
    });

    it("bottom pinned row with a left-pinned column renders in left sub-lane after horizontal scroll", async () => {
      ({ grid, container } = makeSubLaneGrid({
        leftPinned: ["c0"],
        rowPinState: { r9: "bottom" },
      }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const leftSub = getBottomLeftSubLane(root)!;
      expect(leftSub).not.toBeNull();
      expect(leftSub.querySelector(`.${CSS.CELL}[data-col-id="c0"]`)?.textContent)
        .toBe("val-9-0");

      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      viewport.scrollLeft = 1500;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      expect(leftSub.querySelector(`.${CSS.CELL}[data-col-id="c0"]`)?.textContent)
        .toBe("val-9-0");
    });

    it("top pinned row with a right-pinned column renders in right sub-lane after horizontal scroll", async () => {
      ({ grid, container } = makeSubLaneGrid({
        rightPinned: ["c29"],
        rowPinState: { r0: "top" },
      }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const rightSub = getTopRightSubLane(root)!;
      expect(rightSub).not.toBeNull();
      expect(rightSub.querySelector(`.${CSS.CELL}[data-col-id="c29"]`)?.textContent)
        .toBe("val-0-29");

      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      viewport.scrollLeft = 1500;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      expect(rightSub.querySelector(`.${CSS.CELL}[data-col-id="c29"]`)?.textContent)
        .toBe("val-0-29");
    });

    it("bottom pinned row with a right-pinned column renders in right sub-lane after horizontal scroll", async () => {
      ({ grid, container } = makeSubLaneGrid({
        rightPinned: ["c29"],
        rowPinState: { r9: "bottom" },
      }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const rightSub = getBottomRightSubLane(root)!;
      expect(rightSub).not.toBeNull();
      expect(rightSub.querySelector(`.${CSS.CELL}[data-col-id="c29"]`)?.textContent)
        .toBe("val-9-29");

      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      viewport.scrollLeft = 1500;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      expect(rightSub.querySelector(`.${CSS.CELL}[data-col-id="c29"]`)?.textContent)
        .toBe("val-9-29");
    });

    it("center sub-lane in row-pinned lane still horizontally virtualizes when left/right are pinned", async () => {
      ({ grid, container } = makeSubLaneGrid({
        leftPinned: ["c0"],
        rightPinned: ["c29"],
        rowPinState: { r0: "top" },
      }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const centerLane = getTopLayer(root)!;
      const beforeTexts = Array.from(centerLane.querySelectorAll(`.${CSS.CELL}`))
        .map((c) => c.textContent);

      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      viewport.scrollLeft = 1200;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      const afterTexts = Array.from(centerLane.querySelectorAll(`.${CSS.CELL}`))
        .map((c) => c.textContent);

      // At least some center sub-lane cell text changed.
      expect(afterTexts.some((t, i) => t !== beforeTexts[i])).toBe(true);
    });

    it("horizontal scroll does not replace sub-lane elements or row elements", async () => {
      ({ grid, container } = makeSubLaneGrid({
        leftPinned: ["c0"],
        rightPinned: ["c29"],
        rowPinState: { r0: "top", r9: "bottom" },
      }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const topCenterBefore = getTopLayer(root)!;
      const topLeftBefore = getTopLeftSubLane(root)!;
      const topRightBefore = getTopRightSubLane(root)!;
      const bottomLeftBefore = getBottomLeftSubLane(root)!;
      const bottomRightBefore = getBottomRightSubLane(root)!;

      const topLeftRowBefore = topLeftBefore.querySelector(`.${CSS.ROW}`)!;
      const topRightRowBefore = topRightBefore.querySelector(`.${CSS.ROW}`)!;
      const bottomLeftRowBefore = bottomLeftBefore.querySelector(`.${CSS.ROW}`)!;
      const bottomRightRowBefore = bottomRightBefore.querySelector(`.${CSS.ROW}`)!;

      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      viewport.scrollLeft = 1500;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      expect(getTopLayer(root)).toBe(topCenterBefore);
      expect(getTopLeftSubLane(root)).toBe(topLeftBefore);
      expect(getTopRightSubLane(root)).toBe(topRightBefore);
      expect(getBottomLeftSubLane(root)).toBe(bottomLeftBefore);
      expect(getBottomRightSubLane(root)).toBe(bottomRightBefore);

      expect(topLeftBefore.querySelector(`.${CSS.ROW}`)).toBe(topLeftRowBefore);
      expect(topRightBefore.querySelector(`.${CSS.ROW}`)).toBe(topRightRowBefore);
      expect(bottomLeftBefore.querySelector(`.${CSS.ROW}`)).toBe(bottomLeftRowBefore);
      expect(bottomRightBefore.querySelector(`.${CSS.ROW}`)).toBe(bottomRightRowBefore);
    });

    it("sub-lanes are not created when no columns are pinned", async () => {
      ({ grid, container } = makeSubLaneGrid({
        rowPinState: { r0: "top", r9: "bottom" },
      }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      // Center lanes exist; sub-lanes do not.
      expect(getTopLayer(root)).not.toBeNull();
      expect(getBottomLayer(root)).not.toBeNull();
      expect(getTopLeftSubLane(root)).toBeNull();
      expect(getTopRightSubLane(root)).toBeNull();
      expect(getBottomLeftSubLane(root)).toBeNull();
      expect(getBottomRightSubLane(root)).toBeNull();
    });

    it("selection checkbox works inside row-pinned left sub-lane", async () => {
      // Selection column explicitly pinned left for left sub-lane placement.
      const cont = document.createElement("div");
      Object.assign(cont.style, { height: "300px", width: "400px" });
      document.body.appendChild(cont);
      const g = new Grid({
        rows: wideRows,
        columns: makeColumns(["c0"]),
        getRowId: (row: RowData) => row.id as string,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: false,
        rowSelection: {
          mode: "multi",
          checkboxes: true,
          checkboxColumn: { pinned: "left" },
        },
      });
      g.setRowPinState([{ rowId: "r0", pinned: "top" }]);
      g.mount(cont);
      grid = g;
      container = cont;
      await flushRenders();
      forceRender(g);
      await flushRenders();

      const root = getRoot(cont);
      const leftSub = getTopLeftSubLane(root)!;
      expect(leftSub).not.toBeNull();
      const checkbox = leftSub.querySelector<HTMLInputElement>(
        ".lfg-row-selection-checkbox",
      );
      expect(checkbox).not.toBeNull();
      expect(checkbox!.checked).toBe(false);
      expect(checkbox!.tabIndex).toBe(-1);
      expect(checkbox!.getAttribute("aria-label")).toBe("Select row");

      g.setSelectedRowIds(["r0"]);
      await flushRenders();
      forceRender(g);
      await flushRenders();

      const checkboxAfter = leftSub.querySelector<HTMLInputElement>(
        ".lfg-row-selection-checkbox",
      );
      expect(checkboxAfter!.checked).toBe(true);
    });

    it("action cell renders inside row-pinned right sub-lane", async () => {
      const cont = document.createElement("div");
      Object.assign(cont.style, { height: "300px", width: "400px" });
      document.body.appendChild(cont);
      const cols: ColumnDef[] = [
        ...Array.from({ length: colCount }, (_, i) => ({
          field: `c${i}`,
          width: 120,
        })),
        {
          field: "__actions__",
          width: 60,
          pinned: "right",
          cellKind: "actions",
          actionTrigger: { ariaLabel: "Row actions", icon: "⋯" },
        } as ColumnDef,
      ];
      const g = new Grid({
        rows: wideRows,
        columns: cols,
        getRowId: (row: RowData) => row.id as string,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: false,
      });
      g.setRowPinState([{ rowId: "r0", pinned: "top" }]);
      g.mount(cont);
      grid = g;
      container = cont;
      await flushRenders();
      forceRender(g);
      await flushRenders();

      const root = getRoot(cont);
      const rightSub = getTopRightSubLane(root)!;
      expect(rightSub).not.toBeNull();
      const trigger = rightSub.querySelector(".lfg-action-trigger");
      expect(trigger).not.toBeNull();
      expect(trigger!.tagName).toBe("BUTTON");
      expect((trigger as HTMLButtonElement).tabIndex).toBe(-1);
      expect(trigger!.getAttribute("aria-label")).toBe("Row actions");
    });

    it("cell-shell widgets retain semantics inside a row-pinned sub-lane", async () => {
      const cont = document.createElement("div");
      Object.assign(cont.style, { height: "300px", width: "400px" });
      document.body.appendChild(cont);
      const cols = makeColumns(["c0"]);
      const pinnedShellColumn = cols.find((column) => column.field === "c0")!;
      pinnedShellColumn.cellShell = {
        kind: "button",
        text: { literal: "Open pinned row" },
        actionKey: "open",
      };
      const g = new Grid({
        rows: wideRows,
        columns: cols,
        getRowId: (row: RowData) => row.id as string,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: false,
      });
      g.setRowPinState([{ rowId: "r0", pinned: "top" }]);
      g.mount(cont);
      grid = g;
      container = cont;
      await flushRenders();
      forceRender(g);
      await flushRenders();

      const button = getTopLeftSubLane(getRoot(cont))?.querySelector(
        ".lfg-cell-shell-button",
      ) as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      expect(button!.type).toBe("button");
      expect(button!.tabIndex).toBe(-1);
      expect(button!.getAttribute("aria-label")).toBe("Open pinned row");
    });

    it("selection runtime API updates checkbox/selected state in left sub-lane without forceRender", async () => {
      const cont = document.createElement("div");
      Object.assign(cont.style, { height: "300px", width: "400px" });
      document.body.appendChild(cont);
      const g = new Grid({
        rows: wideRows,
        columns: makeColumns(["c0"]),
        getRowId: (row: RowData) => row.id as string,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: false,
        rowSelection: {
          mode: "multi",
          checkboxes: true,
          checkboxColumn: { pinned: "left" },
        },
      });
      g.setRowPinState([{ rowId: "r0", pinned: "top" }]);
      g.mount(cont);
      grid = g;
      container = cont;
      await flushRenders();
      forceRender(g);
      await flushRenders();

      const root = getRoot(cont);
      const leftSub = getTopLeftSubLane(root)!;
      expect(leftSub).not.toBeNull();
      const before = leftSub.querySelector<HTMLInputElement>(
        ".lfg-row-selection-checkbox",
      );
      expect(before?.checked).toBe(false);
      const rowBefore = leftSub.querySelector(`.${CSS.ROW}`)!;
      expect(rowBefore.classList.contains("lfg-row-selected")).toBe(false);

      // NO forceRender between mutation and assertion.
      g.setSelectedRowIds(["r0"]);
      await flushRenders();

      const after = leftSub.querySelector<HTMLInputElement>(
        ".lfg-row-selection-checkbox",
      );
      expect(after?.checked).toBe(true);
      const rowAfter = leftSub.querySelector(`.${CSS.ROW}`)!;
      expect(rowAfter.classList.contains("lfg-row-selected")).toBe(true);

      // Clearing selection removes the visual too.
      g.clearSelection();
      await flushRenders();
      const cleared = leftSub.querySelector<HTMLInputElement>(
        ".lfg-row-selection-checkbox",
      );
      expect(cleared?.checked).toBe(false);
      expect(leftSub.querySelector(`.${CSS.ROW}`)!.classList.contains("lfg-row-selected"))
        .toBe(false);
    });

    it("column selection toggle updates column-selected class inside row-pinned left sub-lane", async () => {
      const cont = document.createElement("div");
      Object.assign(cont.style, { height: "300px", width: "400px" });
      document.body.appendChild(cont);
      const g = new Grid({
        rows: wideRows,
        columns: makeColumns(["c0"], ["c29"]),
        getRowId: (row: RowData) => row.id as string,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: false,
        columnSelection: { mode: "multiple" },
      });
      g.setRowPinState([{ rowId: "r0", pinned: "top" }]);
      g.mount(cont);
      grid = g;
      container = cont;
      await flushRenders();
      forceRender(g);
      await flushRenders();

      const root = getRoot(cont);
      const leftSub = getTopLeftSubLane(root)!;
      const rightSub = getTopRightSubLane(root)!;
      const leftCell = leftSub.querySelector<HTMLElement>(`.${CSS.CELL}[data-col-id="c0"]`)!;
      const rightCell = rightSub.querySelector<HTMLElement>(`.${CSS.CELL}[data-col-id="c29"]`)!;
      expect(leftCell.classList.contains("lfg-column-selected")).toBe(false);
      expect(rightCell.classList.contains("lfg-column-selected")).toBe(false);

      g.setSelectedColumnIds(["c0", "c29"]);
      await flushRenders();

      expect(leftCell.classList.contains("lfg-column-selected")).toBe(true);
      expect(rightCell.classList.contains("lfg-column-selected")).toBe(true);

      g.clearColumnSelection();
      await flushRenders();
      expect(leftCell.classList.contains("lfg-column-selected")).toBe(false);
      expect(rightCell.classList.contains("lfg-column-selected")).toBe(false);
    });

    it("repeated render with unchanged inputs does not replace sub-lane row elements", async () => {
      ({ grid, container } = makeSubLaneGrid({
        leftPinned: ["c0"],
        rightPinned: ["c29"],
        rowPinState: { r0: "top", r9: "bottom" },
      }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const topCenterRow = getTopLayer(root)!.querySelector(`.${CSS.ROW}`)!;
      const topLeftRow = getTopLeftSubLane(root)!.querySelector(`.${CSS.ROW}`)!;
      const topRightRow = getTopRightSubLane(root)!.querySelector(`.${CSS.ROW}`)!;
      const botLeftRow = getBottomLeftSubLane(root)!.querySelector(`.${CSS.ROW}`)!;
      const botRightRow = getBottomRightSubLane(root)!.querySelector(`.${CSS.ROW}`)!;

      // Force multiple render passes — no data/columns/selection changes.
      for (let i = 0; i < 5; i++) {
        forceRender(grid);
        await flushRenders();
      }

      expect(getTopLayer(root)!.querySelector(`.${CSS.ROW}`)).toBe(topCenterRow);
      expect(getTopLeftSubLane(root)!.querySelector(`.${CSS.ROW}`)).toBe(topLeftRow);
      expect(getTopRightSubLane(root)!.querySelector(`.${CSS.ROW}`)).toBe(topRightRow);
      expect(getBottomLeftSubLane(root)!.querySelector(`.${CSS.ROW}`)).toBe(botLeftRow);
      expect(getBottomRightSubLane(root)!.querySelector(`.${CSS.ROW}`)).toBe(botRightRow);
    });

    it("horizontal scroll does not rebuild left/right sub-lanes", async () => {
      ({ grid, container } = makeSubLaneGrid({
        leftPinned: ["c0"],
        rightPinned: ["c29"],
        rowPinState: { r0: "top" },
      }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const leftSub = getTopLeftSubLane(root)!;
      const rightSub = getTopRightSubLane(root)!;
      const leftRow = leftSub.querySelector(`.${CSS.ROW}`)!;
      const rightRow = rightSub.querySelector(`.${CSS.ROW}`)!;
      const leftCell = leftSub.querySelector(`.${CSS.CELL}[data-col-id="c0"]`)!;
      const rightCell = rightSub.querySelector(`.${CSS.CELL}[data-col-id="c29"]`)!;

      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      // Many scroll events
      for (let s = 100; s <= 2000; s += 100) {
        viewport.scrollLeft = s;
        viewport.dispatchEvent(new Event("scroll"));
      }
      await flushRenders();

      // Sub-lane DOM nodes are identity-preserved across all scroll events.
      expect(getTopLeftSubLane(root)).toBe(leftSub);
      expect(getTopRightSubLane(root)).toBe(rightSub);
      expect(leftSub.querySelector(`.${CSS.ROW}`)).toBe(leftRow);
      expect(rightSub.querySelector(`.${CSS.ROW}`)).toBe(rightRow);
      // Cells inside left/right sub-lanes are identity-preserved too.
      expect(leftSub.querySelector(`.${CSS.CELL}[data-col-id="c0"]`)).toBe(leftCell);
      expect(rightSub.querySelector(`.${CSS.CELL}[data-col-id="c29"]`)).toBe(rightCell);
    });

    it("data revision change updates row-pinned sub-lane text", async () => {
      ({ grid, container } = makeSubLaneGrid({
        leftPinned: ["c0"],
        rightPinned: ["c29"],
        rowPinState: { r0: "top" },
      }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const leftSub = getTopLeftSubLane(root)!;
      const rightSub = getTopRightSubLane(root)!;
      expect(leftSub.querySelector(`.${CSS.CELL}[data-col-id="c0"]`)?.textContent)
        .toBe("val-0-0");
      expect(rightSub.querySelector(`.${CSS.CELL}[data-col-id="c29"]`)?.textContent)
        .toBe("val-0-29");

      // Mutate row data and push new rows array.
      const newRows = wideRows.map((r) =>
        r.id === "r0" ? { ...r, c0: "edited-0", c29: "edited-29" } : r,
      );
      grid.setRows(newRows);
      await flushRenders();

      expect(leftSub.querySelector(`.${CSS.CELL}[data-col-id="c0"]`)?.textContent)
        .toBe("edited-0");
      expect(rightSub.querySelector(`.${CSS.CELL}[data-col-id="c29"]`)?.textContent)
        .toBe("edited-29");
    });

    it("sub-lane rebuilds when pinned column count changes (structural)", async () => {
      ({ grid, container } = makeSubLaneGrid({
        leftPinned: ["c0"],
        rowPinState: { r0: "top" },
      }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const leftBefore = getTopLeftSubLane(root)!;
      expect(leftBefore.querySelectorAll(`.${CSS.CELL}`).length).toBe(1);

      // Pin a second column on the left — sub-lane should rebuild with 2 cells.
      grid.setColumns(makeColumns(["c0", "c1"]));
      await flushRenders();

      const leftAfter = getTopLeftSubLane(root)!;
      expect(leftAfter.querySelectorAll(`.${CSS.CELL}`).length).toBe(2);
    });
  });

  describe("bottom row-pinned lane positioning (viewport-bottom sticky)", () => {
    it("sets --lfg-viewport-height on the grid root on mount", async () => {
      ({ grid, container } = makeGrid());
      await flushRenders();

      const root = getRoot(container);
      const cssVar = root.style.getPropertyValue("--lfg-viewport-height").trim();
      // jsdom returns layout values via clientHeight only when explicit sizes
      // are present. The variable is always written (initial "0px" or the
      // measured pixel value); never left unset.
      expect(cssVar).toMatch(/^\d+px$/);
    });

    it("bottom lane is rendered immediately after pinning, without scrolling", async () => {
      ({ grid, container } = makeGrid({ rowPinState: { r5: "bottom" } }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const bottomLayer = getBottomLayer(root);
      expect(bottomLayer).not.toBeNull();

      // Bottom lane carries the expected pinned row id.
      expect(getPinnedLayerRowIds(bottomLayer!)).toContain("r5");

      // Bottom layer carries the row-pinned-bottom class — actual
      // `position: sticky; top: calc(...)` is enforced by `themes/default.css`
      // (jsdom does not load the stylesheet so `getComputedStyle` here returns
      // the user-agent default). We additionally verify the viewport-height
      // variable is in place so the calc() resolves at runtime.
      expect(bottomLayer!.classList.contains("lfg-row-pinned-bottom-layer")).toBe(true);
      expect(root.style.getPropertyValue("--lfg-viewport-height"))
        .toMatch(/^\d+px$/);
      expect(root.style.getPropertyValue("--lfg-row-pinned-bottom-height"))
        .toBe(`${ROW_HEIGHT}px`);
    });

    it("sets --lfg-row-pinned-bottom-height when bottom rows are pinned", async () => {
      ({ grid, container } = makeGrid({ rowPinState: { r5: "bottom" } }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      expect(root.style.getPropertyValue("--lfg-row-pinned-bottom-height"))
        .toBe(`${ROW_HEIGHT}px`);
    });

    it("vertical scroll does not replace or reposition the bottom lane", async () => {
      ({ grid, container } = makeGrid({ rowPinState: { r5: "bottom" } }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const layerBefore = getBottomLayer(root)!;
      const rowBefore = layerBefore.querySelector(`.${CSS.ROW}`)!;
      // Inline style left empty by intent — sticky positioning comes from CSS
      // class rules + the viewport-height var, not per-element inline writes.
      const inlineCssBefore = layerBefore.style.cssText;
      const viewportVarBefore = getRoot(container).style.getPropertyValue(
        "--lfg-viewport-height",
      );

      // Multiple vertical scroll events.
      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      for (let s = 50; s <= 300; s += 50) {
        viewport.scrollTop = s;
        viewport.dispatchEvent(new Event("scroll"));
      }
      await flushRenders();

      // Same layer + row element (no rebuild).
      expect(getBottomLayer(root)).toBe(layerBefore);
      expect(layerBefore.querySelector(`.${CSS.ROW}`)).toBe(rowBefore);
      // No per-scroll inline style writes on the lane.
      expect(layerBefore.style.cssText).toBe(inlineCssBefore);
      // Viewport-height var is not touched on scroll (only on resize).
      expect(getRoot(container).style.getPropertyValue("--lfg-viewport-height"))
        .toBe(viewportVarBefore);
    });

    it("top + bottom pinned rows coexist and render in separate layers", async () => {
      ({ grid, container } = makeGrid({
        rowPinState: { r1: "top", r5: "bottom" },
      }));
      await flushRenders();
      forceRender(grid);
      await flushRenders();

      const root = getRoot(container);
      const topLayer = getTopLayer(root);
      const bottomLayer = getBottomLayer(root);
      expect(topLayer).not.toBeNull();
      expect(bottomLayer).not.toBeNull();
      expect(getPinnedLayerRowIds(topLayer!)).toContain("r1");
      expect(getPinnedLayerRowIds(bottomLayer!)).toContain("r5");
      // Pinned rows must not appear in the center body.
      const centerIds = getCenterRowIds(root);
      expect(centerIds).not.toContain("r1");
      expect(centerIds).not.toContain("r5");
    });

    it("horizontal scroll still virtualizes bottom center lane columns", async () => {
      const cont = document.createElement("div");
      Object.assign(cont.style, { height: "300px", width: "400px" });
      document.body.appendChild(cont);

      const colCount = 30;
      const wideCols: ColumnDef[] = Array.from({ length: colCount }, (_, i) => ({
        field: `c${i}`,
        width: 120,
      }));
      const wideRowsBig: RowData[] = Array.from({ length: 10 }, (_, r) => {
        const row: Record<string, unknown> = { id: `r${r}` };
        for (let i = 0; i < colCount; i++) row[`c${i}`] = `val-${r}-${i}`;
        return row as RowData;
      });

      const g = new Grid({
        rows: wideRowsBig,
        columns: wideCols,
        getRowId: (row: RowData) => row.id as string,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: false,
        rowPinning: { bottom: ["r9"] },
      });
      g.mount(cont);
      grid = g;
      container = cont;
      await flushRenders();

      const root = getRoot(cont);
      const bottomLayer = getBottomLayer(root)!;
      const laneRow = bottomLayer.querySelector(`.${CSS.ROW}`)!;
      const before = Array.from(laneRow.querySelectorAll(`.${CSS.CELL}`))
        .map((c) => c.textContent);

      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      viewport.scrollLeft = 1500;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      const after = Array.from(laneRow.querySelectorAll(`.${CSS.CELL}`))
        .map((c) => c.textContent);

      // Bottom center sub-lane cells updated to a different column window.
      expect(after.some((t, i) => t !== before[i])).toBe(true);
      // Lane DOM identity preserved (no rebuild on h-scroll).
      expect(getBottomLayer(root)).toBe(bottomLayer);
      expect(bottomLayer.querySelector(`.${CSS.ROW}`)).toBe(laneRow);
    });

    it("bottom left/right sub-lanes use the same sticky-top formula as the center sub-lane", async () => {
      const cont = document.createElement("div");
      Object.assign(cont.style, { height: "300px", width: "400px" });
      document.body.appendChild(cont);

      const cols: ColumnDef[] = [
        { field: "c0", width: 120, pinned: "left" },
        { field: "c1", width: 120 },
        { field: "c2", width: 120 },
        { field: "c3", width: 120, pinned: "right" },
      ];
      const rs: RowData[] = Array.from({ length: 6 }, (_, r) => ({
        id: `r${r}`,
        c0: `${r}-0`, c1: `${r}-1`, c2: `${r}-2`, c3: `${r}-3`,
      }));

      const g = new Grid({
        rows: rs,
        columns: cols,
        getRowId: (row: RowData) => row.id as string,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: false,
        rowPinning: { bottom: ["r5"] },
      });
      g.mount(cont);
      grid = g;
      container = cont;
      await flushRenders();

      const root = getRoot(cont);
      const center = getBottomLayer(root)!;
      const left = root.querySelector<HTMLElement>(".lfg-row-pinned-bottom-left-layer");
      const right = root.querySelector<HTMLElement>(".lfg-row-pinned-bottom-right-layer");
      expect(left).not.toBeNull();
      expect(right).not.toBeNull();

      // All three bottom sub-lanes carry their corresponding class. The
      // shared sticky-top calc() expression is declared in `default.css` and
      // applies via these class selectors; jsdom doesn't load that stylesheet
      // so getComputedStyle would return user-agent defaults. We instead
      // verify the structural wiring and shared CSS-variable inputs.
      expect(center.classList.contains("lfg-row-pinned-bottom-layer")).toBe(true);
      expect(left!.classList.contains("lfg-row-pinned-bottom-left-layer")).toBe(true);
      expect(right!.classList.contains("lfg-row-pinned-bottom-right-layer")).toBe(true);

      // Center sub-lane reserves flow height equal to row count × ROW_HEIGHT;
      // left/right overlays intentionally have NO inline height (CSS sets
      // `height: 0` so they don't push the column-pinned lane to the right).
      expect(center.style.height).toBe(`${ROW_HEIGHT}px`);
      expect(left!.style.height).toBe("");
      expect(right!.style.height).toBe("");

      // Overlay rows have inline absolute positioning (top + left) so their
      // vertical placement matches the center sub-lane visually.
      const leftRow = left!.querySelector<HTMLElement>(`.${CSS.ROW}`)!;
      const rightRow = right!.querySelector<HTMLElement>(`.${CSS.ROW}`)!;
      expect(leftRow.style.position).toBe("absolute");
      expect(rightRow.style.position).toBe("absolute");
      expect(leftRow.style.top).toBe("0px");
      expect(rightRow.style.top).toBe("0px");
    });
  });

  describe("row-pinned left/right sub-lanes are zero-flow overlays", () => {
    /**
     * Wide-grid factory used by the overlay layout tests. Pins are passed via
     * the public `rowPinning` prop — no private renderer mutation.
     */
    function makeOverlayGrid(opts: {
      leftPinned: string[];
      rightPinned?: string[];
      rowPinning?: { top?: string[]; bottom?: string[] };
    }) {
      const cont = document.createElement("div");
      Object.assign(cont.style, { height: "300px", width: "500px" });
      document.body.appendChild(cont);

      const colCount = 20;
      const cols: ColumnDef[] = [];
      for (const f of opts.leftPinned) cols.push({ field: f, width: 100, pinned: "left" });
      for (let i = 0; i < colCount; i++) {
        const f = `c${i}`;
        if (opts.leftPinned.includes(f)) continue;
        if (opts.rightPinned?.includes(f)) continue;
        cols.push({ field: f, width: 100 });
      }
      if (opts.rightPinned) {
        for (const f of opts.rightPinned) cols.push({ field: f, width: 100, pinned: "right" });
      }

      const data: RowData[] = Array.from({ length: 8 }, (_, r) => {
        const row: Record<string, unknown> = { id: `r${r}` };
        for (let i = 0; i < colCount; i++) row[`c${i}`] = `val-${r}-${i}`;
        return row as RowData;
      });

      const g = new Grid({
        rows: data,
        columns: cols,
        getRowId: (row: RowData) => row.id as string,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: false,
        rowPinning: opts.rowPinning,
      });
      g.mount(cont);
      return { grid: g, container: cont };
    }

    it("top-left overlay does NOT add inline height that would push body content", async () => {
      ({ grid, container } = makeOverlayGrid({
        leftPinned: ["c0"],
        rowPinning: { top: ["r0"] },
      }));
      await flushRenders();

      const root = getRoot(container);
      const overlay = root.querySelector<HTMLElement>(".lfg-row-pinned-top-left-layer")!;
      expect(overlay).not.toBeNull();
      // No inline height — CSS height:0 keeps the overlay out of flow.
      expect(overlay.style.height).toBe("");
      // The single overlay row is absolutely positioned, not in flow.
      const overlayRow = overlay.querySelector<HTMLElement>(`.${CSS.ROW}`)!;
      expect(overlayRow.style.position).toBe("absolute");
      expect(overlayRow.style.top).toBe("0px");
      // jsdom normalizes `style.left = "0"` to `"0px"`.
      expect(overlayRow.style.left).toMatch(/^0(px)?$/);
    });

    it("multi-row top-left overlay stacks rows via inline absolute top, not flow", async () => {
      ({ grid, container } = makeOverlayGrid({
        leftPinned: ["c0"],
        rowPinning: { top: ["r0", "r1"] },
      }));
      await flushRenders();

      const root = getRoot(container);
      const overlay = root.querySelector<HTMLElement>(".lfg-row-pinned-top-left-layer")!;
      const overlayRows = overlay.querySelectorAll<HTMLElement>(`.${CSS.ROW}`);
      expect(overlayRows.length).toBe(2);
      expect(overlayRows[0]!.style.top).toBe("0px");
      expect(overlayRows[1]!.style.top).toBe(`${ROW_HEIGHT}px`);
      expect(overlayRows[0]!.style.position).toBe("absolute");
      expect(overlayRows[1]!.style.position).toBe("absolute");
    });

    it("column-pinned-left lane is NOT shifted right by the row-pinned-left overlay", async () => {
      // Without any pin: capture the natural offsetLeft of the column-pinned lane.
      const noPin = makeOverlayGrid({ leftPinned: ["c0"] });
      await flushRenders();
      const rootNoPin = getRoot(noPin.container);
      const columnPinnedNoPin = rootNoPin.querySelector<HTMLElement>(
        ".lfg-pinned-left-layer",
      )!;
      const noPinOffset = columnPinnedNoPin.offsetLeft;
      noPin.grid.destroy();
      noPin.container.remove();

      // With top pin: column-pinned lane must remain at the same offsetLeft.
      ({ grid, container } = makeOverlayGrid({
        leftPinned: ["c0"],
        rowPinning: { top: ["r0"] },
      }));
      await flushRenders();
      const root = getRoot(container);
      const columnPinned = root.querySelector<HTMLElement>(".lfg-pinned-left-layer")!;
      expect(columnPinned).not.toBeNull();
      // The overlay must not push the column-pinned lane right.
      expect(columnPinned.offsetLeft).toBe(noPinOffset);
    });

    it("bottom-left overlay also has zero inline height and absolute rows", async () => {
      ({ grid, container } = makeOverlayGrid({
        leftPinned: ["c0"],
        rowPinning: { bottom: ["r7"] },
      }));
      await flushRenders();

      const root = getRoot(container);
      const overlay = root.querySelector<HTMLElement>(".lfg-row-pinned-bottom-left-layer")!;
      expect(overlay).not.toBeNull();
      expect(overlay.style.height).toBe("");
      const overlayRow = overlay.querySelector<HTMLElement>(`.${CSS.ROW}`)!;
      expect(overlayRow.style.position).toBe("absolute");
      expect(overlayRow.style.top).toBe("0px");
    });

    it("bottom column-pinned lane is NOT shifted by the bottom-left overlay", async () => {
      const noPin = makeOverlayGrid({ leftPinned: ["c0"] });
      await flushRenders();
      const baseOffset = getRoot(noPin.container)
        .querySelector<HTMLElement>(".lfg-pinned-left-layer")!.offsetLeft;
      noPin.grid.destroy();
      noPin.container.remove();

      ({ grid, container } = makeOverlayGrid({
        leftPinned: ["c0"],
        rowPinning: { bottom: ["r7"] },
      }));
      await flushRenders();
      const offsetWithBottomPin = getRoot(container)
        .querySelector<HTMLElement>(".lfg-pinned-left-layer")!.offsetLeft;
      expect(offsetWithBottomPin).toBe(baseOffset);
    });

    it("top + bottom pins together do not shift the column-pinned-left lane", async () => {
      const noPin = makeOverlayGrid({ leftPinned: ["c0"] });
      await flushRenders();
      const baseOffset = getRoot(noPin.container)
        .querySelector<HTMLElement>(".lfg-pinned-left-layer")!.offsetLeft;
      noPin.grid.destroy();
      noPin.container.remove();

      ({ grid, container } = makeOverlayGrid({
        leftPinned: ["c0"],
        rowPinning: { top: ["r0"], bottom: ["r7"] },
      }));
      await flushRenders();
      const offsetWithBothPins = getRoot(container)
        .querySelector<HTMLElement>(".lfg-pinned-left-layer")!.offsetLeft;
      expect(offsetWithBothPins).toBe(baseOffset);
    });

    it("right-pinned-column row overlay also has zero inline height", async () => {
      ({ grid, container } = makeOverlayGrid({
        leftPinned: [],
        rightPinned: ["c19"],
        rowPinning: { top: ["r0"] },
      }));
      await flushRenders();

      const root = getRoot(container);
      const overlay = root.querySelector<HTMLElement>(".lfg-row-pinned-top-right-layer")!;
      expect(overlay).not.toBeNull();
      expect(overlay.style.height).toBe("");
      const overlayRow = overlay.querySelector<HTMLElement>(`.${CSS.ROW}`)!;
      expect(overlayRow.style.position).toBe("absolute");
      expect(overlayRow.style.left).toMatch(/^0(px)?$/);
    });

    it("horizontal scroll keeps row-pinned left overlay cell intact and identity-preserved", async () => {
      ({ grid, container } = makeOverlayGrid({
        leftPinned: ["c0"],
        rowPinning: { top: ["r0"] },
      }));
      await flushRenders();

      const root = getRoot(container);
      const overlay = root.querySelector<HTMLElement>(".lfg-row-pinned-top-left-layer")!;
      const overlayRow = overlay.querySelector<HTMLElement>(`.${CSS.ROW}`)!;
      const overlayCell = overlay.querySelector<HTMLElement>(
        `.${CSS.CELL}[data-col-id="c0"]`,
      )!;
      const textBefore = overlayCell.textContent;

      const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
      for (let s = 100; s <= 800; s += 100) {
        viewport.scrollLeft = s;
        viewport.dispatchEvent(new Event("scroll"));
      }
      await flushRenders();

      // Identity preserved across scroll — no rebuild.
      expect(overlay.querySelector(`.${CSS.ROW}`)).toBe(overlayRow);
      expect(overlay.querySelector(`.${CSS.CELL}[data-col-id="c0"]`)).toBe(overlayCell);
      // Pinned-left value unchanged under horizontal scroll.
      expect(overlayCell.textContent).toBe(textBefore);
      expect(overlayCell.textContent).toBe("val-0-0");
      // Inline absolute-positioning attrs untouched on scroll.
      expect(overlayRow.style.position).toBe("absolute");
      expect(overlayRow.style.top).toBe("0px");
    });

    it("top-pinned row with left-pinned selection column still shows center cell text", async () => {
      const cont = document.createElement("div");
      Object.assign(cont.style, { height: "300px", width: "500px" });
      document.body.appendChild(cont);

      const g = new Grid({
        rows: [
          { id: "r0", c0: "left-val", c1: "center-val-1", c2: "center-val-2" },
          { id: "r1", c0: "x", c1: "y", c2: "z" },
        ],
        columns: [
          { field: "c0", width: 100, pinned: "left" },
          { field: "c1", width: 100 },
          { field: "c2", width: 100 },
        ],
        getRowId: (row: RowData) => row.id as string,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: false,
        rowPinning: { top: ["r0"] },
      });
      g.mount(cont);
      grid = g;
      container = cont;
      await flushRenders();

      const root = getRoot(container);

      // Left overlay carries the left-pinned cell.
      const leftOverlay = root.querySelector<HTMLElement>(
        ".lfg-row-pinned-top-left-layer",
      )!;
      expect(leftOverlay.querySelector(`.${CSS.CELL}[data-col-id="c0"]`)?.textContent)
        .toBe("left-val");

      // Center row-pinned lane carries the center cells.
      const centerLane = getTopLayer(root)!;
      expect(centerLane.querySelector(`.${CSS.CELL}[data-col-id="c1"]`)?.textContent)
        .toBe("center-val-1");
      expect(centerLane.querySelector(`.${CSS.CELL}[data-col-id="c2"]`)?.textContent)
        .toBe("center-val-2");
    });

    it("row-pinned overlay rule clamps min/max width to 100% (overrides inherited --lfg-total-width)", async () => {
      // jsdom does not load `default.css`; assert directly against the shipped
      // stylesheet source that the override is present for all four overlay
      // sub-lane selectors. This is the deterministic way to lock in the fix
      // without depending on a real browser render.
      const fs = await import("fs/promises");
      const path = await import("path");
      const url = await import("url");
      // Resolve from this test file's directory up to packages/core/src/themes.
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const cssPath = path.resolve(here, "../../..", "themes", "default.css");
      const css = await fs.readFile(cssPath, "utf8");

      // The four selectors must appear together in the rule that clamps
      // min/max width to 100%.
      const ruleMatch = css.match(
        /\.lfg-row-pinned-top-left-layer \.lfg-row,[\s\S]*?\.lfg-row-pinned-bottom-right-layer \.lfg-row\s*\{[^}]+\}/,
      );
      expect(ruleMatch).not.toBeNull();
      const body = ruleMatch![0];
      expect(body).toMatch(/\bmin-width\s*:\s*100%/);
      expect(body).toMatch(/\bmax-width\s*:\s*100%/);
      expect(body).toMatch(/\bwidth\s*:\s*100%/);
      // And does NOT use --lfg-total-width inside the override.
      expect(body.includes("--lfg-total-width")).toBe(false);
    });

    it("changing pinned row count updates absolute `top` on overlay rows", async () => {
      ({ grid, container } = makeOverlayGrid({
        leftPinned: ["c0"],
        rowPinning: { top: ["r0"] },
      }));
      await flushRenders();

      const root = getRoot(container);
      let overlay = root.querySelector<HTMLElement>(".lfg-row-pinned-top-left-layer")!;
      expect(overlay.querySelectorAll(`.${CSS.ROW}`).length).toBe(1);

      // Add a second pinned row — overlay must rebuild with two absolute rows.
      grid.pinRows(["r1"], "top");
      await flushRenders();

      overlay = root.querySelector<HTMLElement>(".lfg-row-pinned-top-left-layer")!;
      const rows = overlay.querySelectorAll<HTMLElement>(`.${CSS.ROW}`);
      expect(rows.length).toBe(2);
      expect(rows[0]!.style.top).toBe("0px");
      expect(rows[1]!.style.top).toBe(`${ROW_HEIGHT}px`);
      // No inline lane height even after rebuild.
      expect(overlay.style.height).toBe("");
    });
  });
});
