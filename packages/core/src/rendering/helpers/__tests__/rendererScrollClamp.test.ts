// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import { GridState } from "../../../state/GridState";
import type { LightFastGridColDef, RowData } from "../../../types";
import { CSS } from "../../const/css-classes";
import { HEADER_HEIGHT, ROW_HEIGHT } from "../gridConstants";
import {
  calculateMaximumValidScrollTop,
  calculateVerticalContentHeight,
  clampScrollTopAfterRowCountReduction,
} from "../verticalScrollGeometry";

const VIEWPORT_HEIGHT = 240;
const LARGE_ROW_COUNT = 500;

let originalClientHeightDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalClientHeightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => VIEWPORT_HEIGHT,
  });
});

afterEach(() => {
  if (originalClientHeightDescriptor === undefined) {
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  } else {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientHeight",
      originalClientHeightDescriptor,
    );
  }
  document.body.innerHTML = "";
});

function makeRows(count = LARGE_ROW_COUNT): RowData[] {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `person-${index}`,
    name: `Person ${String(index).padStart(4, "0")}`,
  }));
  if (count >= 2) {
    rows[count - 2] = { id: "zoe-zane", name: "Zoe Zane" };
    rows[count - 1] = { id: "zoe-zimmerman", name: "Zoe Zimmerman" };
  }
  return rows;
}

const COLUMNS: LightFastGridColDef[] = [
  {
    field: "name",
    pinned: "left",
    sortable: true,
    filter: "text",
    // Force the low-threshold sort through the asynchronous main-thread path.
    valueGetter: ({ row }) => row.name,
  },
  {
    field: "id",
    pinned: "right",
    searchable: false,
  },
];

function stateOf(grid: Grid): GridState {
  const state: unknown = Reflect.get(grid, "state");
  if (!(state instanceof GridState)) {
    throw new Error("Grid.state is not a GridState instance");
  }
  return state;
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function flushRenders(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

async function settle(grid: Grid, maxTicks = 80): Promise<void> {
  for (let tick = 0; tick < maxTicks; tick++) {
    await nextFrame();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const state = stateOf(grid);
    if (!state.isSortPending() && !state.isQuickSearchPending()) {
      await flushRenders();
      return;
    }
  }
  throw new Error("grid operations did not settle");
}

async function mountGrid(rows: RowData[] = makeRows()): Promise<{
  grid: Grid;
  container: HTMLDivElement;
  viewport: HTMLElement;
}> {
  const container = document.createElement("div");
  Object.assign(container.style, { width: "600px", height: "400px" });
  document.body.appendChild(container);
  const grid = new Grid({
    rows,
    columns: COLUMNS,
    getRowId: (row) => String(row.id),
    quickFilter: true,
    execution: {
      thresholds: {
        sort: 1,
        filter: 10_000,
        quickSearch: 10_000,
      },
    },
  });
  grid.mount(container);
  await flushRenders();
  const viewport = container.querySelector<HTMLElement>(`.${CSS.VIEWPORT}`);
  if (viewport === null) throw new Error("viewport not mounted");
  return { grid, container, viewport };
}

async function deepScroll(viewport: HTMLElement, rowCount: number): Promise<number> {
  const maximum = HEADER_HEIGHT + rowCount * ROW_HEIGHT - VIEWPORT_HEIGHT;
  viewport.scrollTop = maximum;
  viewport.dispatchEvent(new Event("scroll"));
  await flushRenders();
  return maximum;
}

function renderedRowIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(`.${CSS.ROW}[data-row-id]`),
    (row) => row.style.display === "none" ? "" : (row.dataset.rowId ?? ""),
  ).filter(Boolean);
}

describe("vertical scroll geometry", () => {
  const geometry = {
    centerRowCount: 10,
    rowHeight: 40,
    headerHeight: 30,
    headerAddonHeight: 20,
    topPinnedHeight: 80,
    bottomPinnedHeight: 40,
  };

  it("uses the same header-addon and pinned-lane height contract", () => {
    expect(calculateVerticalContentHeight(geometry)).toBe(570);
  });

  it("returns zero when all content fits inside the viewport", () => {
    expect(calculateMaximumValidScrollTop(geometry, 600)).toBe(0);
  });

  it("subtracts cached viewport height when content is taller", () => {
    expect(calculateMaximumValidScrollTop(geometry, 200)).toBe(370);
  });

  it("uses zero for unavailable or invalid cached viewport height", () => {
    expect(calculateMaximumValidScrollTop(geometry, 0)).toBe(0);
    expect(calculateMaximumValidScrollTop(geometry, -1)).toBe(0);
    expect(calculateMaximumValidScrollTop(geometry, Number.NaN)).toBe(0);
  });

  it("preserves valid positions and ignores row-count growth", () => {
    expect(clampScrollTopAfterRowCountReduction({
      ...geometry,
      previousCenterRowCount: 20,
      currentScrollTop: 300,
      cachedViewportHeight: 200,
    })).toBe(300);
    expect(clampScrollTopAfterRowCountReduction({
      ...geometry,
      centerRowCount: 30,
      previousCenterRowCount: 20,
      currentScrollTop: 300,
      cachedViewportHeight: 200,
    })).toBe(300);
  });

  it("resets an out-of-range deep position instead of anchoring at the bottom", () => {
    expect(clampScrollTopAfterRowCountReduction({
      ...geometry,
      previousCenterRowCount: 100,
      currentScrollTop: 10_000,
      cachedViewportHeight: 200,
    })).toBe(0);
  });
});

describe("DomGridRenderer row-count reduction scroll clamp", () => {
  it("renders Zoe and Zoe Zimmerman after async sort and deep scrolling", async () => {
    const { grid, container, viewport } = await mountGrid();
    try {
      const pinnedBody = container.querySelector<HTMLElement>(
        ".lfg-pinned-body",
      );
      const pinnedRightBody = container.querySelector<HTMLElement>(
        ".lfg-pinned-right-body",
      );
      expect(pinnedBody?.style.height).toBe(`${LARGE_ROW_COUNT * ROW_HEIGHT}px`);
      expect(pinnedRightBody?.style.height).toBe(
        `${LARGE_ROW_COUNT * ROW_HEIGHT}px`,
      );

      grid.setSortModel([{ field: "name", sort: "asc" }]);
      expect(stateOf(grid).isSortPending()).toBe(true);
      await settle(grid);

      await deepScroll(viewport, LARGE_ROW_COUNT);
      grid.setQuickFilterText("Zoe");
      await settle(grid);

      expect(viewport.scrollTop).toBe(0);
      expect(pinnedBody?.style.height).toBe(`${2 * ROW_HEIGHT}px`);
      expect(pinnedRightBody?.style.height).toBe(`${2 * ROW_HEIGHT}px`);
      expect(renderedRowIds(container)).toEqual(
        expect.arrayContaining(["zoe-zane", "zoe-zimmerman"]),
      );
      expect(container.querySelector(`.${CSS.ROW}[data-row-id="zoe-zimmerman"]`))
        .not.toBeNull();

      grid.clearQuickFilter();
      await settle(grid);
      await deepScroll(viewport, LARGE_ROW_COUNT);
      grid.setQuickFilterText("Zoe Zimmerman");
      await settle(grid);

      expect(viewport.scrollTop).toBe(0);
      expect(renderedRowIds(container)).toContain("zoe-zimmerman");
      expect(renderedRowIds(container)).not.toContain("zoe-zane");
    } finally {
      grid.destroy();
    }
  });

  it("clamps a deep position after a generic column-filter reduction", async () => {
    const { grid, container, viewport } = await mountGrid();
    try {
      await deepScroll(viewport, LARGE_ROW_COUNT);
      grid.setColumnFilterModel("name", {
        type: "text",
        conditions: [{ operator: "contains", value: "Zoe" }],
      });
      await settle(grid);

      expect(viewport.scrollTop).toBe(0);
      expect(renderedRowIds(container)).toEqual(
        expect.arrayContaining(["zoe-zane", "zoe-zimmerman"]),
      );
    } finally {
      grid.destroy();
    }
  });

  it("resets to the first result when the reduced result remains scrollable", async () => {
    const rows = makeRows();
    for (let index = 0; index < 100; index++) {
      rows[index] = { ...rows[index]!, name: "Zoe Zimmerman" };
    }
    const matchingRowCount = rows.filter(
      (row) => row.name === "Zoe Zimmerman",
    ).length;
    const { grid, container, viewport } = await mountGrid(rows);
    try {
      await deepScroll(viewport, LARGE_ROW_COUNT);
      grid.setQuickFilterText("Zoe Zimmerman");
      await settle(grid);

      expect(viewport.scrollTop).toBe(0);
      expect(renderedRowIds(container)).toContain("person-0");
      expect(
        container.querySelector<HTMLElement>(".lfg-pinned-body")?.style.height,
      ).toBe(`${matchingRowCount * ROW_HEIGHT}px`);
    } finally {
      grid.destroy();
    }
  });

  it("preserves a scroll position that remains valid after setRows shrinks", async () => {
    const rows = makeRows();
    const { grid, viewport } = await mountGrid(rows);
    try {
      viewport.scrollTop = 1_000;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      grid.setRows(rows.slice(0, 300));
      await settle(grid);

      expect(viewport.scrollTop).toBe(1_000);
    } finally {
      grid.destroy();
    }
  });

  it("clamps to zero and preserves no-matching-rows overlay for empty results", async () => {
    const { grid, container, viewport } = await mountGrid();
    try {
      await deepScroll(viewport, LARGE_ROW_COUNT);
      grid.showNoMatchingRowsOverlay();
      grid.setQuickFilterText("No person can match this query");
      await settle(grid);

      expect(viewport.scrollTop).toBe(0);
      expect(renderedRowIds(container)).toHaveLength(0);
      expect(container.querySelector('[data-overlay-kind="noMatchingRows"]'))
        .not.toBeNull();
    } finally {
      grid.destroy();
    }
  });

  it("does not change scrollTop when the displayed row count grows", async () => {
    const initialRows = makeRows(50);
    const { grid, viewport } = await mountGrid(initialRows);
    try {
      viewport.scrollTop = 100;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      grid.setRows(makeRows());
      await settle(grid);

      expect(viewport.scrollTop).toBe(100);
    } finally {
      grid.destroy();
    }
  });
});

describe("vertical scroll clamp hot-path guard", () => {
  it("adds no layout reads, selectors, row loops, or feature-specific branches", () => {
    const rendererSource = readFileSync(
      join(__dirname, "../..", "DomGridRenderer.ts"),
      "utf8",
    );
    const method = rendererSource.match(
      /private clampVerticalScrollAfterRowCountReduction\([\s\S]*?\n {2}}\n\n {2}\/\*\*/,
    );
    expect(method).not.toBeNull();
    const helperSource = readFileSync(
      join(__dirname, "..", "verticalScrollGeometry.ts"),
      "utf8",
    );
    const guardedSource = `${method![0]}\n${helperSource}`;
    for (const forbidden of [
      "querySelector",
      "querySelectorAll",
      "getBoundingClientRect",
      "offsetHeight",
      "offsetTop",
      "clientHeight",
      "scrollHeight",
      "quickFilterText",
      "filterModel",
      "sortModel",
    ]) {
      expect(guardedSource).not.toContain(forbidden);
    }
    expect(guardedSource).not.toMatch(/\bfor\s*\(|\.forEach\(|\.map\(/);
  });
});
