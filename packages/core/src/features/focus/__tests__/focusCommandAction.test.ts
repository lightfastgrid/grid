// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { DisplayRowReader } from "../../../rendering/rowViewAccess";
import { FocusController } from "../FocusController";

const DISPLAY_ROWS: DisplayRowReader = {
  rowCount: 1,
  getRowData: (index) => (index === 0 ? { id: "r0" } : undefined),
  getSourceIndex: (index) => (index === 0 ? 0 : -1),
  getRow: () => null,
};

describe("focus scalar command action", () => {
  it("publishes state in O(1) and defers pool visuals and scroll work", async () => {
    const getPool = vi.fn(() => []);
    const ensureFieldVisible = vi.fn();
    const controller = new FocusController({
      getPool,
      getColumns: () => [{ field: "a" }],
      getDisplayRows: () => DISPLAY_ROWS,
      resolveRowId: () => "r0",
      getViewport: () => document.createElement("div"),
      ensureFieldVisible,
    });
    controller.attach(document.createElement("div"));
    getPool.mockClear();

    expect(controller.setFocusedCellAtDisplayIndex(0, "a")).toBe(true);
    expect(controller.getFocusedCell()).toMatchObject({
      rowId: "r0",
      rowIndex: 0,
      field: "a",
    });
    expect(getPool).not.toHaveBeenCalled();
    expect(ensureFieldVisible).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(getPool).toHaveBeenCalledTimes(1);
    expect(ensureFieldVisible).toHaveBeenCalledWith("a");
    controller.detach();
  });
});
