// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import type { LightFastGridProps } from "../../../types";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function makeContainer(width = 520, height = 280): HTMLDivElement {
  const container = document.createElement("div");
  Object.assign(container.style, { width: `${width}px`, height: `${height}px` });
  document.body.appendChild(container);
  return container;
}

function headerCell(container: HTMLElement, field: string): HTMLElement | null {
  return container.querySelector(
    `.lfg-header-cell[data-col-id="${field}"]`,
  ) as HTMLElement | null;
}

function click(el: Element, shiftKey = false): void {
  el.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, shiftKey }),
  );
}

describe("Grid sort API", () => {
  it("setSortModel emits onSortChanged with source api", () => {
    const onSortChanged = vi.fn();
    const grid = new Grid({
      columns: [{ field: "a" }],
      rows: [{ a: 1 }],
      onSortChanged,
    });
    grid.setSortModel([{ field: "a", sort: "asc" }]);
    expect(onSortChanged).toHaveBeenCalledTimes(1);
    expect(onSortChanged).toHaveBeenCalledWith({
      sortModel: [{ field: "a", sort: "asc" }],
      source: "api",
    });
  });

  it("clearSort emits only when changed", () => {
    const onSortChanged = vi.fn();
    const grid = new Grid({
      columns: [{ field: "a" }],
      rows: [{ a: 1 }],
      onSortChanged,
    });

    grid.clearSort();
    expect(onSortChanged).not.toHaveBeenCalled();

    grid.setSortModel([{ field: "a", sort: "asc" }]);
    onSortChanged.mockClear();

    grid.clearSort();
    expect(onSortChanged).toHaveBeenCalledTimes(1);
    expect(onSortChanged.mock.calls[0]?.[0]).toEqual({
      sortModel: [],
      source: "api",
    });
  });

  it("toggleColumnSort cycles asc/desc/none", () => {
    const grid = new Grid({
      columns: [{ field: "a" }],
      rows: [{ a: 1 }],
    });

    grid.toggleColumnSort("a");
    expect(grid.getSortModel()).toEqual([{ field: "a", sort: "asc" }]);

    grid.toggleColumnSort("a");
    expect(grid.getSortModel()).toEqual([{ field: "a", sort: "desc" }]);

    grid.toggleColumnSort("a");
    expect(grid.getSortModel()).toEqual([]);
  });

  it("toggleColumnSort with multi preserves other sort fields", () => {
    const grid = new Grid({
      columns: [{ field: "a" }, { field: "b" }],
      rows: [{ a: 1, b: 2 }],
    });

    grid.toggleColumnSort("a");
    grid.toggleColumnSort("b", { multi: true });

    expect(grid.getSortModel()).toEqual([
      { field: "a", sort: "asc" },
      { field: "b", sort: "asc" },
    ]);
  });

  it("no event when model unchanged", () => {
    const onSortChanged = vi.fn();
    const grid = new Grid({
      columns: [{ field: "a", sortable: true }],
      rows: [{ a: 1 }],
      onSortChanged,
    });

    grid.setSortModel([{ field: "a", sort: "asc" }]);
    expect(onSortChanged).toHaveBeenCalledTimes(1);
    onSortChanged.mockClear();

    grid.setSortModel([{ field: "a", sort: "asc" }]);
    expect(onSortChanged).not.toHaveBeenCalled();
  });
});

describe("Sort feature/controller behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  async function mountGrid(props: LightFastGridProps): Promise<{
    grid: Grid;
    container: HTMLDivElement;
  }> {
    const container = makeContainer();
    const grid = new Grid({
      rows: [{ a: 2, b: 1 }, { a: 1, b: 2 }],
      columns: [{ field: "a" }, { field: "b" }],
      ...props,
    });
    grid.mount(container);
    await flushRenders();
    await flushRenders();
    return { grid, container };
  }

  it("header click toggles sort asc", async () => {
    const { grid, container } = await mountGrid({});
    click(headerCell(container, "a")!);
    await flushRenders();
    expect(grid.getSortModel()).toEqual([{ field: "a", sort: "asc" }]);
  });

  it("second click toggles sort desc", async () => {
    const { grid, container } = await mountGrid({});
    const a = headerCell(container, "a")!;
    click(a);
    click(a);
    await flushRenders();
    expect(grid.getSortModel()).toEqual([{ field: "a", sort: "desc" }]);
  });

  it("third click clears sort", async () => {
    const { grid, container } = await mountGrid({});
    const a = headerCell(container, "a")!;
    click(a);
    click(a);
    click(a);
    await flushRenders();
    expect(grid.getSortModel()).toEqual([]);
  });

  it("shift-click appends multi-sort", async () => {
    const { grid, container } = await mountGrid({});
    click(headerCell(container, "a")!);
    click(headerCell(container, "b")!, true);
    await flushRenders();
    expect(grid.getSortModel()).toEqual([
      { field: "a", sort: "asc" },
      { field: "b", sort: "asc" },
    ]);
  });

  it("header click sorts columnSelectable false columns when column selection is enabled", async () => {
    const { grid, container } = await mountGrid({
      columns: [
        { field: "id", sortable: true, columnSelectable: false },
        { field: "a", sortable: true },
      ],
      columnSelection: {
        mode: "multiple",
        enableHeaderClickSelection: true,
      },
    });

    click(headerCell(container, "id")!);
    await flushRenders();
    expect(grid.getSortModel()).toEqual([{ field: "id", sort: "asc" }]);
    expect(grid.getSelectedColumnIds()).toEqual([]);
  });

  it("resize handle click does not sort", async () => {
    const { grid, container } = await mountGrid({});
    const resizeHandle = headerCell(container, "a")?.querySelector(".lfg-resize-handle");
    expect(resizeHandle).toBeTruthy();
    click(resizeHandle!);
    await flushRenders();
    expect(grid.getSortModel()).toEqual([]);
  });

  it("column drag handle click does not sort", async () => {
    const { grid, container } = await mountGrid({ columnOrder: { enabled: true } });
    const dragHandle = headerCell(container, "a")?.querySelector(".lfg-column-drag-handle");
    expect(dragHandle).toBeTruthy();
    click(dragHandle!);
    await flushRenders();
    expect(grid.getSortModel()).toEqual([]);
  });

  it("selection checkbox/header column does not sort", async () => {
    const { grid, container } = await mountGrid({
      rowSelection: { mode: "multiple", checkboxes: true, headerCheckbox: true },
      getRowId: (row) => String((row as { a: number; b: number }).a),
    });
    const headerCb = container.querySelector(".lfg-header-selection-checkbox");
    expect(headerCb).toBeTruthy();
    click(headerCb!);
    await flushRenders();
    expect(grid.getSortModel()).toEqual([]);
  });

  it("header classes and aria-sort sync with current sort model", async () => {
    const { grid, container } = await mountGrid({
      columns: [
        { field: "a", sortable: true },
        { field: "b", sortable: false },
      ],
    });

    const a = headerCell(container, "a")!;
    const b = headerCell(container, "b")!;
    expect(a.classList.contains("lfg-header-sortable")).toBe(true);
    expect(a.getAttribute("aria-sort")).toBeNull();
    expect(b.classList.contains("lfg-header-sortable")).toBe(false);
    expect(b.getAttribute("aria-sort")).toBeNull();

    grid.setSortModel([{ field: "a", sort: "asc" }], "api");
    await flushRenders();
    expect(a.classList.contains("lfg-header-sorted-asc")).toBe(true);
    expect(a.getAttribute("aria-sort")).toBe("ascending");

    grid.setSortModel([{ field: "a", sort: "desc" }], "api");
    await flushRenders();
    expect(a.classList.contains("lfg-header-sorted-desc")).toBe(true);
    expect(a.getAttribute("aria-sort")).toBe("descending");
  });

  it("header sort state restores after horizontal virtualization", async () => {
    const cols = Array.from({ length: 12 }, (_, i) => ({
      field: `c${i}`,
      width: 140,
      sortable: true,
    }));
    const row = Object.fromEntries(cols.map((c, i) => [c.field, i]));
    const container = makeContainer(240, 260);
    const grid = new Grid({
      rows: [row],
      columns: cols,
      initialSortModel: [{ field: "c8", sort: "asc" }],
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const viewport = container.querySelector(".lfg-viewport") as HTMLElement;
    expect(viewport).toBeTruthy();

    let sortedHeader: HTMLElement | null = null;
    for (let left = 0; left <= 2000; left += 200) {
      viewport.scrollLeft = left;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
      await flushRenders();
      sortedHeader = headerCell(container, "c8");
      if (sortedHeader) break;
    }

    expect(sortedHeader).toBeTruthy();
    expect(sortedHeader!.classList.contains("lfg-header-sorted-asc")).toBe(true);
    expect(sortedHeader!.getAttribute("aria-sort")).toBe("ascending");
  });
});
