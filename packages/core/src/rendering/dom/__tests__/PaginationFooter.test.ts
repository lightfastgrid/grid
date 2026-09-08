// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { GridPaginationSnapshot } from "../../../types";
import { buildPageItems, PaginationFooter } from "../PaginationFooter";

function makeState(
  partial: Partial<GridPaginationSnapshot> = {},
): GridPaginationSnapshot {
  return {
    enabled: true,
    pageIndex: 0,
    pageSize: 10,
    pageCount: 3,
    totalRows: 25,
    startRow: 1,
    endRow: 10,
    pageSizeOptions: [10, 25, 50],
    ...partial,
  };
}

function makeFooter(state = makeState()) {
  const setPageIndex = vi.fn();
  const setPageSize = vi.fn();
  const footer = new PaginationFooter({ setPageIndex, setPageSize });
  footer.sync(state);
  return { footer, setPageIndex, setPageSize };
}

function pageButtons(footer: PaginationFooter): HTMLButtonElement[] {
  return Array.from(
    footer.element.querySelectorAll<HTMLButtonElement>(
      ".lfg-pagination-button",
    ),
  );
}

describe("buildPageItems", () => {
  it("shows all pages when few", () => {
    expect(buildPageItems(5, 0)).toEqual([1, 2, 3, 4, 5]);
    expect(buildPageItems(0, 0)).toEqual([]);
  });

  it("collapses distant pages with ellipsis", () => {
    expect(buildPageItems(20, 0)).toEqual([1, 2, "…", 20]);
    expect(buildPageItems(20, 9)).toEqual([1, "…", 9, 10, 11, "…", 20]);
    expect(buildPageItems(20, 19)).toEqual([1, "…", 19, 20]);
  });
});

describe("PaginationFooter", () => {
  it("renders the stable class structure", () => {
    const { footer } = makeFooter();
    const el = footer.element;
    expect(el.classList.contains("lfg-pagination")).toBe(true);
    expect(el.querySelector(".lfg-pagination-summary")).not.toBeNull();
    expect(el.querySelector(".lfg-pagination-pages")).not.toBeNull();
    expect(
      el.querySelector(".lfg-pagination-page-size")?.tagName,
    ).toBe("LABEL");
    expect(el.querySelector(".lfg-pagination-page-size-label")).not.toBeNull();
    expect(el.querySelector(".lfg-pagination-page-size-select")).not.toBeNull();
  });

  it("uses native, descriptively named page buttons", () => {
    const { footer } = makeFooter();
    const buttons = pageButtons(footer);

    expect(buttons.map((button) => button.type)).toEqual([
      "button",
      "button",
      "button",
      "button",
      "button",
    ]);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Previous page",
      "Page 1",
      "Page 2",
      "Page 3",
      "Next page",
    ]);
  });

  it("renders the summary text with formatted counts", () => {
    const { footer } = makeFooter(
      makeState({
        pageIndex: 0,
        pageSize: 100,
        pageCount: 1000,
        totalRows: 100_000,
        startRow: 1,
        endRow: 100,
      }),
    );
    expect(
      footer.element.querySelector(".lfg-pagination-summary")!.textContent,
    ).toBe("Showing 1 to 100 of 100,000 rows");
  });

  it("marks the current page button active", () => {
    const { footer } = makeFooter(makeState({ pageIndex: 1 }));
    const active = footer.element.querySelectorAll<HTMLButtonElement>(
      '[aria-current="page"]',
    );
    expect(active.length).toBe(1);
    expect(active[0]!.textContent).toBe("2"); // one-based label
    expect(active[0]!.getAttribute("aria-label")).toBe("Page 2");
    expect(active[0]!.getAttribute("aria-current")).toBe("page");
  });

  it("prev is disabled on the first page; next on the last", () => {
    const first = makeFooter(makeState({ pageIndex: 0 }));
    const firstButtons = pageButtons(first.footer);
    expect(
      firstButtons[0]!.classList.contains("lfg-pagination-button-disabled"),
    ).toBe(true);
    expect(firstButtons[0]!.disabled).toBe(true);

    const last = makeFooter(
      makeState({ pageIndex: 2, startRow: 21, endRow: 25 }),
    );
    const lastButtons = pageButtons(last.footer);
    expect(
      lastButtons[lastButtons.length - 1]!.classList.contains(
        "lfg-pagination-button-disabled",
      ),
    ).toBe(true);
  });

  it("prev/next clicks call setPageIndex with ui source", () => {
    const { footer, setPageIndex } = makeFooter(makeState({ pageIndex: 1 }));
    const buttons = pageButtons(footer);

    buttons[0]!.click(); // prev
    expect(setPageIndex).toHaveBeenLastCalledWith(0, "ui");
    buttons[buttons.length - 1]!.click(); // next
    expect(setPageIndex).toHaveBeenLastCalledWith(2, "ui");
  });

  it("page number clicks jump to the zero-based page", () => {
    const { footer, setPageIndex } = makeFooter();
    const three = pageButtons(footer).find((b) => b.textContent === "3")!;
    three.click();
    expect(setPageIndex).toHaveBeenCalledWith(2, "ui");
  });

  it("renders an ellipsis for distant pages", () => {
    const { footer } = makeFooter(
      makeState({ pageCount: 20, totalRows: 200 }),
    );
    const ellipses = footer.element.querySelectorAll(
      ".lfg-pagination-ellipsis",
    );
    expect(ellipses.length).toBeGreaterThan(0);
    for (const ellipsis of Array.from(ellipses)) {
      expect(ellipsis.getAttribute("aria-hidden")).toBe("true");
      expect(ellipsis.getAttribute("tabindex")).toBeNull();
    }
  });

  it("associates the visible rows-per-page label with the select", () => {
    const { footer, setPageSize } = makeFooter();
    const pageSizeLabel = footer.element.querySelector<HTMLLabelElement>(
      ".lfg-pagination-page-size",
    )!;
    const select = footer.element.querySelector<HTMLSelectElement>(
      ".lfg-pagination-page-size-select",
    )!;
    expect(pageSizeLabel.contains(select)).toBe(true);
    expect(pageSizeLabel.textContent).toContain("Rows per page");
    expect(select.getAttribute("aria-label")).toBeNull();
    expect(select.labels).toHaveLength(1);
    expect(select.labels![0]).toBe(pageSizeLabel);

    expect(Array.from(select.options).map((o) => o.value)).toEqual(
      ["10", "25", "50"],
    );
    expect(select.value).toBe("10");

    select.value = "25";
    select.dispatchEvent(new Event("change"));
    expect(setPageSize).toHaveBeenCalledWith(25, "ui");
  });

  it("empty state renders without page buttons and keeps nav disabled", () => {
    const { footer } = makeFooter(
      makeState({
        pageIndex: 0,
        pageCount: 0,
        totalRows: 0,
        startRow: 0,
        endRow: 0,
      }),
    );
    const buttons = pageButtons(footer);
    // Only prev + next remain, both disabled.
    expect(buttons.length).toBe(2);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(
      footer.element.querySelector('[aria-current="page"]'),
    ).toBeNull();
    expect(
      footer.element.querySelector(".lfg-pagination-summary")!.textContent,
    ).toBe("Showing 0 to 0 of 0 rows");
  });

  it("does no subtree replacement for an unchanged snapshot", () => {
    const state = makeState();
    const { footer } = makeFooter(state);
    const pages = footer.element.querySelector<HTMLElement>(
      ".lfg-pagination-pages",
    )!;
    const select = footer.element.querySelector<HTMLSelectElement>(
      ".lfg-pagination-page-size-select",
    )!;
    const replacePages = vi.spyOn(pages, "replaceChildren");
    const replaceOptions = vi.spyOn(select, "replaceChildren");

    footer.sync(state);

    expect(replacePages).not.toHaveBeenCalled();
    expect(replaceOptions).not.toHaveBeenCalled();
  });

  it("replaces only pagination subtrees whose inputs changed", () => {
    const { footer } = makeFooter();
    const pages = footer.element.querySelector<HTMLElement>(
      ".lfg-pagination-pages",
    )!;
    const select = footer.element.querySelector<HTMLSelectElement>(
      ".lfg-pagination-page-size-select",
    )!;
    const replacePages = vi.spyOn(pages, "replaceChildren");
    const replaceOptions = vi.spyOn(select, "replaceChildren");

    footer.sync(
      makeState({
        pageIndex: 1,
        startRow: 11,
        endRow: 20,
      }),
    );
    expect(replacePages).toHaveBeenCalledTimes(1);
    expect(replaceOptions).not.toHaveBeenCalled();

    footer.sync(
      makeState({
        pageIndex: 0,
        pageSize: 25,
        pageCount: 1,
        startRow: 1,
        endRow: 25,
        pageSizeOptions: [10, 25, 50, 100],
      }),
    );
    expect(replacePages).toHaveBeenCalledTimes(2);
    expect(replaceOptions).toHaveBeenCalledTimes(1);
  });

  it("retries the same snapshot after page publication fails", () => {
    const setPageIndex = vi.fn();
    const setPageSize = vi.fn();
    const footer = new PaginationFooter({ setPageIndex, setPageSize });
    const pages = footer.element.querySelector<HTMLElement>(
      ".lfg-pagination-pages",
    )!;
    const failure = new Error("replace failed");
    const replacePages = vi
      .spyOn(pages, "replaceChildren")
      .mockImplementationOnce(() => {
        throw failure;
      });
    const state = makeState();

    expect(() => footer.sync(state)).toThrow(failure);
    expect(pageButtons(footer)).toHaveLength(0);

    footer.sync(state);
    expect(replacePages).toHaveBeenCalledTimes(2);
    expect(pageButtons(footer)).toHaveLength(5);
    expect(
      footer.element.querySelector('[aria-current="page"]')?.textContent,
    ).toBe("1");
  });

  it("retains an accepted page subtree when option publication fails", () => {
    const { footer } = makeFooter();
    const pages = footer.element.querySelector<HTMLElement>(
      ".lfg-pagination-pages",
    )!;
    const select = footer.element.querySelector<HTMLSelectElement>(
      ".lfg-pagination-page-size-select",
    )!;
    const replacePages = vi.spyOn(pages, "replaceChildren");
    const failure = new Error("options failed");
    const replaceOptions = vi
      .spyOn(select, "replaceChildren")
      .mockImplementationOnce(() => {
        throw failure;
      });
    const nextState = makeState({
      pageIndex: 1,
      startRow: 11,
      endRow: 20,
      pageSizeOptions: [10, 25, 50, 100],
    });

    expect(() => footer.sync(nextState)).toThrow(failure);
    expect(replacePages).toHaveBeenCalledTimes(1);
    expect(replaceOptions).toHaveBeenCalledTimes(1);
    expect(
      footer.element.querySelector('[aria-current="page"]')?.textContent,
    ).toBe("2");

    footer.sync(nextState);
    expect(replacePages).toHaveBeenCalledTimes(1);
    expect(replaceOptions).toHaveBeenCalledTimes(2);
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "10",
      "25",
      "50",
      "100",
    ]);
  });
});
