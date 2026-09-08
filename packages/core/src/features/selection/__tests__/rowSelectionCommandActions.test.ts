// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { DisplayRowReader } from "../../../rendering/rowViewAccess";
import { RowSelectionController } from "../RowSelectionController";

function reader(rows: readonly { id: string }[]): DisplayRowReader {
  return {
    rowCount: rows.length,
    getRowData: (index) => rows[index],
    getSourceIndex: (index) =>
      index >= 0 && index < rows.length ? index : -1,
    getRow: () => null,
  };
}

describe("row-selection scalar command actions", () => {
  it("accepts in O(1) and defers snapshot-detaching mutation off the caller stack", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const displayRows = reader(rows);
    const resolveRowId = vi.fn((row: { id?: unknown }) => String(row.id));
    const controller = new RowSelectionController({
      getPool: () => [],
      getConfig: () => ({
        mode: "multiple",
        checkboxes: false,
        headerCheckbox: false,
        enableRowClickSelection: true,
        selectAllScope: "page",
        checkboxColumn: { width: 44, pinned: false },
      }),
      getColumns: () => [],
      getDisplayRows: () => displayRows,
      getFullDisplayRows: () => displayRows,
      getDataRevision: () => 1,
      resolveRowId,
      getHeaderRowEl: () => null,
    });
    controller.attach(document.createElement("div"));
    controller.syncMode();
    const captured = controller.captureSelectionSnapshot(rows.length);

    expect(controller.toggleRowSelectionAtDisplayIndex(1)).toBe(true);
    expect(resolveRowId).not.toHaveBeenCalled();
    expect(captured.has("b")).toBe(false);

    await Promise.resolve();
    expect(resolveRowId).toHaveBeenCalledTimes(1);
    expect(controller.isSelected("b")).toBe(true);
    expect(captured.has("b")).toBe(false);
    controller.detach();
  });

  it("uses the compact all-minus-excluded model without scanning rows", async () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const displayRows = reader(rows);
    const getRowData = vi.spyOn(displayRows, "getRowData");
    const controller = new RowSelectionController({
      getPool: () => [],
      getConfig: () => ({
        mode: "multiple",
        checkboxes: false,
        headerCheckbox: false,
        enableRowClickSelection: true,
        selectAllScope: "page",
        checkboxColumn: { width: 44, pinned: false },
      }),
      getColumns: () => [],
      getDisplayRows: () => displayRows,
      getFullDisplayRows: () => displayRows,
      getDataRevision: () => 1,
      resolveRowId: (row) => String(row.id),
      getHeaderRowEl: () => null,
    });
    controller.attach(document.createElement("div"));
    controller.syncMode();

    expect(controller.toggleAllRowSelection()).toBe(true);
    expect(getRowData).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(getRowData).not.toHaveBeenCalled();
    expect(controller.getSelectedCount(rows.length)).toBe(rows.length);
    controller.detach();
  });

  it("defers Shift+Space anchor and adjacent range row-id work", async () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const displayRows = reader(rows);
    const resolveRowId = vi.fn((row: { id?: unknown }) => String(row.id));
    const controller = new RowSelectionController({
      getPool: () => [],
      getConfig: () => ({
        mode: "multiple",
        checkboxes: false,
        headerCheckbox: false,
        enableRowClickSelection: true,
        selectAllScope: "page",
        checkboxColumn: { width: 44, pinned: false },
      }),
      getColumns: () => [],
      getDisplayRows: () => displayRows,
      getFullDisplayRows: () => displayRows,
      getDataRevision: () => 1,
      resolveRowId,
      getHeaderRowEl: () => null,
    });
    controller.attach(document.createElement("div"));
    controller.syncMode();

    expect(controller.selectRowAtDisplayIndex(0)).toBe(true);
    expect(resolveRowId).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(controller.getSelectedIds()).toEqual(["a"]);

    resolveRowId.mockClear();
    expect(controller.extendRowSelectionStep(0, 1)).toBe(true);
    expect(resolveRowId).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(resolveRowId).toHaveBeenCalledTimes(2);
    expect(controller.isSelected("a")).toBe(true);
    expect(controller.isSelected("b")).toBe(true);
    controller.detach();
  });
});
