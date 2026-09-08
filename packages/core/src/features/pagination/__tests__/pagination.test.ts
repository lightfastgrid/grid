// @vitest-environment jsdom

/**
 * Public Grid pagination integration tests.
 *
 * Model/stage tests live in `features/pagination/__tests__`; footer DOM
 * unit tests live in `rendering/dom/__tests__`. This file only covers
 * the public Grid API surface and the mounted footer integration.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import type { LightFastGridColDef, RowData } from "../../../types";

const cols: LightFastGridColDef[] = [{ field: "v", sortable: true }];

function makeRows(n: number): RowData[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i), v: i }));
}

function makeGrid(onPaginationChanged?: ReturnType<typeof vi.fn>) {
  return new Grid({
    columns: cols,
    rows: makeRows(25),
    pagination: true,
    paginationPageSize: 10,
    onPaginationChanged,
  });
}

describe("pagination runtime API (Grid)", () => {
  it("nextPage / previousPage / firstPage / lastPage navigate and clamp", () => {
    const grid = makeGrid();

    grid.nextPage();
    expect(grid.getPaginationState().pageIndex).toBe(1);
    grid.nextPage();
    expect(grid.getPaginationState().pageIndex).toBe(2);
    // Already on the last page — clamped, no change.
    grid.nextPage();
    expect(grid.getPaginationState().pageIndex).toBe(2);

    grid.previousPage();
    expect(grid.getPaginationState().pageIndex).toBe(1);
    grid.firstPage();
    expect(grid.getPaginationState().pageIndex).toBe(0);
    grid.previousPage();
    expect(grid.getPaginationState().pageIndex).toBe(0);
    grid.lastPage();
    expect(grid.getPaginationState().pageIndex).toBe(2);

    grid.destroy();
  });

  it("emits pagination:changed with state and source", () => {
    const onPaginationChanged = vi.fn();
    const grid = makeGrid(onPaginationChanged);
    const busEvents: unknown[] = [];
    grid.on("pagination:changed", (e) => busEvents.push(e));

    grid.setPageIndex(1, "ui");
    expect(onPaginationChanged).toHaveBeenCalledOnce();
    expect(onPaginationChanged.mock.calls[0]![0]).toEqual({
      pageIndex: 1,
      pageSize: 10,
      pageCount: 3,
      totalRows: 25,
      startRow: 11,
      endRow: 20,
      source: "ui",
    });
    expect(busEvents).toHaveLength(1);

    grid.setPageIndex(99);
    expect(onPaginationChanged).toHaveBeenCalledTimes(2); // 99 clamps to 2 — change
    grid.setPageIndex(2);
    expect(onPaginationChanged).toHaveBeenCalledTimes(2); // same page — no event

    grid.setPageSize(25, "api");
    expect(onPaginationChanged).toHaveBeenCalledTimes(3);
    expect(onPaginationChanged.mock.calls[2]![0]).toMatchObject({
      pageIndex: 0, // clamped by the page-size change
      pageSize: 25,
      pageCount: 1,
      source: "api",
    });

    grid.destroy();
  });

  it("getPaginationState reports disabled pagination", () => {
    const grid = new Grid({ columns: cols, rows: makeRows(5) });
    expect(grid.getPaginationState()).toMatchObject({
      enabled: false,
      pageIndex: 0,
      pageCount: 1,
      totalRows: 5,
    });
    grid.destroy();
  });

  it("setPaginationConfig updates the live grid (post-mount prop sync path)", () => {
    const grid = new Grid({ columns: cols, rows: makeRows(25) });
    expect(grid.getPaginationState().enabled).toBe(false);

    // Mirrors what the React adapter does when props change after mount.
    grid.setPaginationConfig({ enabled: true, pageSize: 10 });
    expect(grid.getPaginationState()).toMatchObject({
      enabled: true,
      pageSize: 10,
      pageCount: 3,
    });

    grid.setPaginationConfig({ enabled: true, pageSize: 10, pageSizeOptions: [10, 99] });
    expect(grid.getPaginationState().pageSize).toBe(10);

    grid.setPaginationConfig({ enabled: false });
    expect(grid.getPaginationState().enabled).toBe(false);
    grid.destroy();
  });
});

describe("pagination footer integration (mounted grid)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Flush the rAF/timeout-driven render scheduler. */
  function flushRender(): void {
    vi.advanceTimersByTime(20);
  }

  function mountGrid(grid: Grid): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    grid.mount(container);
    flushRender();
    return container;
  }

  it("renders the footer with summary and reacts to next click", () => {
    const grid = makeGrid();
    const container = mountGrid(grid);

    const footer = container.querySelector(".lfg-pagination");
    expect(footer).not.toBeNull();
    expect(
      footer!.querySelector(".lfg-pagination-summary")!.textContent,
    ).toBe("Showing 1 to 10 of 25 rows");
    expect(footer!.getAttribute("aria-live")).toBeNull();
    expect(
      footer!.querySelector('[aria-current="page"]')?.getAttribute(
        "aria-label",
      ),
    ).toBe("Page 1");
    const pageSize = footer!.querySelector<HTMLSelectElement>(
      ".lfg-pagination-page-size-select",
    )!;
    expect(pageSize.labels).toHaveLength(1);
    expect(pageSize.labels![0]?.textContent).toContain("Rows per page");

    // Click next — UI source, state advances, footer re-renders.
    const buttons = footer!.querySelectorAll<HTMLButtonElement>(
      ".lfg-pagination-button",
    );
    buttons[buttons.length - 1]!.click();
    expect(grid.getPaginationState().pageIndex).toBe(1);
    flushRender();
    expect(
      container.querySelector(".lfg-pagination-summary")!.textContent,
    ).toBe("Showing 11 to 20 of 25 rows");
    expect(
      container
        .querySelector('[aria-current="page"]')
        ?.getAttribute("aria-label"),
    ).toBe("Page 2");

    grid.destroy();
    container.remove();
  });

  it("setPaginationConfig adds and removes the footer at runtime", () => {
    const grid = new Grid({ columns: cols, rows: makeRows(25) });
    const container = mountGrid(grid);
    expect(container.querySelector(".lfg-pagination")).toBeNull();

    grid.setPaginationConfig({ enabled: true, pageSize: 10 });
    flushRender();
    expect(container.querySelector(".lfg-pagination")).not.toBeNull();

    grid.setPaginationConfig({ enabled: false });
    flushRender();
    expect(container.querySelector(".lfg-pagination")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("rows-per-page select drives setPageSize with ui source", () => {
    const onPaginationChanged = vi.fn();
    const grid = makeGrid(onPaginationChanged);
    const container = mountGrid(grid);

    const select = container.querySelector<HTMLSelectElement>(
      ".lfg-pagination-page-size-select",
    )!;
    select.value = "25";
    select.dispatchEvent(new Event("change"));

    expect(grid.getPaginationState().pageSize).toBe(25);
    expect(onPaginationChanged).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 25, source: "ui" }),
    );

    grid.destroy();
    container.remove();
  });
});
