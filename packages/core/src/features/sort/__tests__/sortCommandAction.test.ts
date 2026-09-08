// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { SortController } from "../SortController";

describe("sort scalar command action", () => {
  it("uses the retained structural column map and invokes one owner operation", () => {
    const getColumns = vi.fn(() => [
      { field: "a", sortable: true },
      { field: "blocked", sortable: false },
    ]);
    const toggleColumnSort = vi.fn();
    const controller = new SortController({
      getColumns,
      getColumnSelectionConfig: () => ({
        enabled: false,
        mode: "multiple",
        enableHeaderClickSelection: true,
        clearOnOutsideClick: false,
      }),
      getSortModel: () => [],
      isSortPending: () => false,
      toggleColumnSort,
      getHeaderRowEl: () => null,
    });
    controller.attach(document.createElement("div"));
    controller.syncSortState();
    getColumns.mockClear();

    expect(controller.toggleSortFromCommand("a", true)).toBe(true);
    expect(getColumns).not.toHaveBeenCalled();
    expect(toggleColumnSort).toHaveBeenCalledWith("a", {
      multi: true,
      source: "ui",
    });
    expect(controller.toggleSortFromCommand("blocked", false)).toBe(false);
    expect(controller.toggleSortFromCommand("missing", false)).toBe(false);
    expect(toggleColumnSort).toHaveBeenCalledTimes(1);
    controller.detach();
  });
});
