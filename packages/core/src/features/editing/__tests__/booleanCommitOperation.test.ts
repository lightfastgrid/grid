import { describe, expect, it, vi } from "vitest";

import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import type { ColumnDef, RowData } from "../../../types";
import {
  type BooleanCommitOperationDeps,
  commitBooleanCell,
} from "../booleanCommitOperation";

function deps(
  row: RowData,
  column: ColumnDef = {
    field: "active",
    editable: true,
    cellShell: "checkbox",
  },
): BooleanCommitOperationDeps {
  return {
    getColumns: () => [column],
    getDisplayRows: () => createArrayDisplayRowReader([row]),
    resolveRowId: (value) => String(value.id),
    commitEdit: vi.fn(),
  };
}

describe("commitBooleanCell", () => {
  it.each([
    [true, false],
    [false, true],
    [null, true],
    [undefined, true],
  ])("commits valid value %s as primitive %s", (oldValue, nextValue) => {
    const d = deps({ id: "r1", active: oldValue });
    expect(commitBooleanCell(d, { rowIndex: 0, field: "active" })).toBe(true);

    expect(d.commitEdit).toHaveBeenCalledOnce();
    expect(vi.mocked(d.commitEdit).mock.calls[0]![0]).toMatchObject({
      rowId: "r1",
      rowIndex: 0,
      sourceIndex: 0,
      field: "active",
      oldValue,
      newValue: nextValue,
      updatedRow: { id: "r1", active: nextValue },
    });
    expect(typeof vi.mocked(d.commitEdit).mock.calls[0]![0].newValue).toBe(
      "boolean",
    );
  });

  it.each(["false", "true", 0, 1, {}, [], Number.NaN])(
    "rejects invalid runtime value %s",
    (value) => {
      const d = deps({ id: "r1", active: value });
      expect(commitBooleanCell(d, { rowIndex: 0, field: "active" })).toBe(false);
      expect(d.commitEdit).not.toHaveBeenCalled();
    },
  );

  it("uses the native candidate value when supplied", () => {
    const d = deps({ id: "r1", active: false });
    expect(
      commitBooleanCell(d, { rowIndex: 0, field: "active" }, true),
    ).toBe(true);
    expect(vi.mocked(d.commitEdit).mock.calls[0]![0].newValue).toBe(true);
  });

  it("refuses ineligible and edit-gated cells", () => {
    const readonly = deps(
      { id: "r1", active: true },
      { field: "active", editable: false, cellShell: "checkbox" },
    );
    expect(commitBooleanCell(readonly, { rowIndex: 0, field: "active" })).toBe(
      false,
    );

    const editGated = deps(
      { id: "r1", active: true },
      {
        field: "active",
        editable: true,
        cellShell: "checkbox",
        editor: { type: "checkbox", activation: "edit" },
      },
    );
    expect(commitBooleanCell(editGated, { rowIndex: 0, field: "active" })).toBe(
      false,
    );
    expect(readonly.commitEdit).not.toHaveBeenCalled();
    expect(editGated.commitEdit).not.toHaveBeenCalled();
  });

  it("requires a display row index and never scans by row id", () => {
    const getRowData = vi.fn(() => ({ id: "r1", active: true }));
    const d: BooleanCommitOperationDeps = {
      getColumns: () => [
        { field: "active", editable: true, cellShell: "checkbox" },
      ],
      getDisplayRows: () => ({
        rowCount: 10_000,
        getRow: () => {
          throw new Error("must not allocate or scan");
        },
        getRowData,
        getSourceIndex: () => 9_999,
      }),
      resolveRowId: () => "r1",
      commitEdit: vi.fn(),
    };

    expect(commitBooleanCell(d, { rowId: "r1", field: "active" })).toBe(false);
    expect(getRowData).not.toHaveBeenCalled();
    expect(
      commitBooleanCell(d, {
        rowId: "r1",
        rowIndex: 9_999,
        field: "active",
      }),
    ).toBe(true);
    expect(getRowData).toHaveBeenCalledOnce();
  });

  it("fails closed for stale row identity", () => {
    const d = deps({ id: "current", active: true });
    expect(
      commitBooleanCell(d, {
        rowId: "stale",
        rowIndex: 0,
        field: "active",
      }),
    ).toBe(false);
    expect(d.commitEdit).not.toHaveBeenCalled();
  });

  it("rethrows the exact commit error without retained state", () => {
    const error = new Error("commit failed");
    const d = deps({ id: "r1", active: true });
    d.commitEdit = vi.fn(() => {
      throw error;
    });
    expect(() =>
      commitBooleanCell(d, { rowIndex: 0, field: "active" }),
    ).toThrow(error);
    expect(d.commitEdit).toHaveBeenCalledOnce();
  });
});
