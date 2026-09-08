// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { ColumnSelectionController } from "../ColumnSelectionController";

describe("column-selection scalar command actions", () => {
  it("checks retained eligibility and defers mutation and DOM sync", async () => {
    const getSelectableColumnIds = vi.fn(() => ["a", "b"]);
    const syncColumnSelectionClasses = vi.fn();
    const controller = new ColumnSelectionController({
      getConfig: () => ({
        enabled: true,
        mode: "multiple",
        enableHeaderClickSelection: true,
        clearOnOutsideClick: false,
      }),
      getHeaderRowEl: () => null,
      getSelectableColumnIds,
      syncColumnSelectionClasses,
    });
    controller.attach(document.createElement("div"));
    expect(getSelectableColumnIds).toHaveBeenCalledTimes(1);

    expect(controller.toggleColumnSelection("b")).toBe(true);
    expect(controller.isColumnSelected("b")).toBe(false);
    expect(getSelectableColumnIds).toHaveBeenCalledTimes(1);
    expect(syncColumnSelectionClasses).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(controller.isColumnSelected("b")).toBe(true);
    expect(syncColumnSelectionClasses).toHaveBeenCalledTimes(1);
    expect(controller.toggleColumnSelection("missing")).toBe(false);
    controller.detach();
  });
});
