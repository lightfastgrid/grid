import { describe, expect, it, vi } from "vitest";

import type { ColumnDef, RowData } from "../../../types";
import {
  createCsvGroupHeaderProjectionCursor,
  createCsvLeafHeaderProjectionCursor,
} from "../csvHeaderProjectionCursor";
import type { CsvProjectedValue } from "../csvProjectedValue";
import { createCsvRowProjectionCursor } from "../csvRowProjectionCursor";
import type { CsvPlannedColumn } from "../planCsvColumnScope";
import type { CsvGroupHeaderRow } from "../planCsvGroupHeaders";
import { projectCsvHeaders } from "../projectCsvHeaders";
import { projectCsvRow, type ProjectCsvRowInput } from "../projectCsvRow";

function dataColumn(column: ColumnDef): CsvPlannedColumn {
  return { kind: "data", column, field: column.field };
}

function rowNumberColumn(startAt = 1): CsvPlannedColumn {
  return { kind: "rowNumber", headerName: "Row", startAt };
}

function rowInput(
  plannedColumns: readonly CsvPlannedColumn[],
  overrides: Partial<ProjectCsvRowInput> = {},
): ProjectCsvRowInput {
  return {
    row: {},
    rowId: "row-1",
    rowIndex: 4,
    sourceRowIndex: 9,
    emittedRowIndex: 2,
    plannedColumns,
    useValueFormatter: true,
    ...overrides,
  };
}

function groupRow(segments: CsvGroupHeaderRow["segments"]): CsvGroupHeaderRow {
  return { level: 0, segments };
}

describe("CSV projection cursors - callback-free construction", () => {
  it("constructs row, leaf, and group cursors without invoking callbacks", () => {
    const shouldExportRow = vi.fn(() => true);
    const valueGetter = vi.fn(() => "value");
    const processCell = vi.fn(() => "cell");
    const processHeader = vi.fn(() => "header");
    const processGroupHeader = vi.fn(() => "group");
    const columns = [dataColumn({ field: "a", valueGetter })];
    const row = groupRow([
      {
        run: { groupId: "g", headerName: "G", level: 0, fields: ["a"] },
        startColumnIndex: 0,
        span: 1,
      },
    ]);

    createCsvRowProjectionCursor(
      rowInput(columns, { shouldExportRow, processCell }),
    );
    createCsvLeafHeaderProjectionCursor(columns, processHeader);
    createCsvGroupHeaderProjectionCursor(row, processGroupHeader);

    expect(shouldExportRow).not.toHaveBeenCalled();
    expect(valueGetter).not.toHaveBeenCalled();
    expect(processCell).not.toHaveBeenCalled();
    expect(processHeader).not.toHaveBeenCalled();
    expect(processGroupHeader).not.toHaveBeenCalled();
  });
});

describe("CSV projection cursors - bounded data rows", () => {
  it("projects a 100-column row one cell per step with exact continuation", () => {
    const columns = Array.from({ length: 100 }, (_unused, index) =>
      dataColumn({ field: `c${index}` }),
    );
    const row: RowData = {};
    for (let index = 0; index < columns.length; index++) {
      row[`c${index}`] = index;
    }
    const cursor = createCsvRowProjectionCursor(
      rowInput(columns, { row }),
    );
    const out: CsvProjectedValue[] = [];
    let steps = 0;
    let done = false;

    while (!done) {
      const before = out.length;
      done = cursor.step(out, 1);
      expect(out.length - before).toBe(1);
      steps++;
    }

    expect(steps).toBe(100);
    expect(out).toEqual(Array.from({ length: 100 }, (_unused, index) => index));
  });

  it("decides a skipped row once and invokes no cell callbacks", () => {
    const shouldExportRow = vi.fn(() => false);
    const valueGetter = vi.fn(() => "value");
    const valueFormatter = vi.fn(() => "formatted");
    const processCell = vi.fn(() => "processed");
    const cursor = createCsvRowProjectionCursor(
      rowInput([
        dataColumn({ field: "a", valueGetter, valueFormatter }),
      ], { shouldExportRow, processCell }),
    );
    const out: CsvProjectedValue[] = [];

    expect(cursor.step(out, 10)).toBe(true);
    expect(cursor.exported).toBe(false);
    expect(cursor.step(out, 10)).toBe(true);
    expect(shouldExportRow).toHaveBeenCalledTimes(1);
    expect(valueGetter).not.toHaveBeenCalled();
    expect(valueFormatter).not.toHaveBeenCalled();
    expect(processCell).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("preserves value precedence, indexes, and callback-once behavior", () => {
    const projectedGetter = vi.fn(() => "wrong");
    const projectedFormatter = vi.fn(() => "wrong");
    const valueGetter = vi.fn(() => 7);
    const valueFormatter = vi.fn(({ value }) => `F${String(value)}`);
    const processCell = vi.fn(({ field, formattedValue }) =>
      `${field}:${formattedValue}`,
    );
    const columns: CsvPlannedColumn[] = [
      rowNumberColumn(10),
      dataColumn({
        field: "projected",
        exportValueField: "display.projected",
        valueGetter: projectedGetter,
        valueFormatter: projectedFormatter,
      }),
      dataColumn({ field: "normal", valueGetter, valueFormatter }),
    ];
    const row = { display: { projected: "P" } };
    const cursor = createCsvRowProjectionCursor(
      rowInput(columns, { row, processCell }),
    );
    const out: CsvProjectedValue[] = [];

    expect(cursor.step(out, 1)).toBe(false);
    expect(cursor.step(out, 1)).toBe(false);
    expect(cursor.step(out, 1)).toBe(true);
    expect(cursor.step(out, 1)).toBe(true);

    expect(out).toEqual([12, "projected:P", "normal:F7"]);
    expect(projectedGetter).not.toHaveBeenCalled();
    expect(projectedFormatter).not.toHaveBeenCalled();
    expect(valueGetter).toHaveBeenCalledTimes(1);
    expect(valueFormatter).toHaveBeenCalledTimes(1);
    expect(processCell).toHaveBeenCalledTimes(2);
    expect(processCell).toHaveBeenCalledWith(
      expect.objectContaining({ rowIndex: 4, sourceRowIndex: 9 }),
    );
  });

  it("completes an exported zero-column row as one empty logical row", () => {
    const shouldExportRow = vi.fn(() => true);
    const cursor = createCsvRowProjectionCursor(
      rowInput([], { shouldExportRow }),
    );
    const out: CsvProjectedValue[] = [];

    expect(cursor.step(out, 0)).toBe(true);
    expect(cursor.exported).toBe(true);
    expect(out).toEqual([]);
    expect(shouldExportRow).toHaveBeenCalledTimes(1);
    expect(projectCsvRow(rowInput([]))).toEqual({ exported: true, values: [] });
  });

  it("normalizes every invalid cell budget to exactly one unit of progress", () => {
    const columns = ["a", "b", "c", "d"].map((field) =>
      dataColumn({ field }),
    );
    const cursor = createCsvRowProjectionCursor(
      rowInput(columns, { row: { a: 1, b: 2, c: 3, d: 4 } }),
    );
    const out: CsvProjectedValue[] = [];
    const budgets = [0, Number.NaN, Number.POSITIVE_INFINITY, -10];

    for (const budget of budgets) {
      const before = out.length;
      cursor.step(out, budget);
      expect(out.length - before).toBe(1);
    }
    expect(out).toEqual([1, 2, 3, 4]);
  });
});

describe("CSV projection cursors - bounded headers", () => {
  it("bounds leaf headers, preserves order, and calls each data header once", () => {
    const columns = [
      rowNumberColumn(),
      dataColumn({ field: "a", headerName: "A" }),
      dataColumn({ field: "b" }),
    ];
    const processHeader = vi.fn(({ headerName }) => `[${headerName}]`);
    const cursor = createCsvLeafHeaderProjectionCursor(columns, processHeader);
    const out: CsvProjectedValue[] = [];

    expect(cursor.step(out, 1)).toBe(false);
    expect(out).toEqual(["Row"]);
    expect(cursor.step(out, 1)).toBe(false);
    expect(out).toEqual(["Row", "[A]"]);
    expect(cursor.step(out, 1)).toBe(true);
    expect(out).toEqual(["Row", "[A]", "[b]"]);
    expect(processHeader).toHaveBeenCalledTimes(2);
  });

  it("emits a very large group span incrementally with one callback", () => {
    const processGroupHeader = vi.fn(() => "[Huge]");
    const cursor = createCsvGroupHeaderProjectionCursor(
      groupRow([
        {
          run: {
            groupId: "huge",
            headerName: "Huge",
            level: 0,
            fields: ["first"],
          },
          startColumnIndex: 0,
          span: 100_000,
        },
      ]),
      processGroupHeader,
    );
    const out: CsvProjectedValue[] = [];

    expect(cursor.step(out, 3)).toBe(false);
    expect(out).toEqual(["[Huge]", "", ""]);
    expect(cursor.step(out, 2)).toBe(false);
    expect(out).toEqual(["[Huge]", "", "", "", ""]);
    expect(processGroupHeader).toHaveBeenCalledTimes(1);
  });

  it("preserves group spacers across steps and normalizes invalid budgets", () => {
    const processGroupHeader = vi.fn(({ headerName }) => `[${headerName}]`);
    const cursor = createCsvGroupHeaderProjectionCursor(
      groupRow([
        { run: null, startColumnIndex: 0, span: 1 },
        {
          run: { groupId: "g", headerName: "G", level: 0, fields: ["a", "b"] },
          startColumnIndex: 1,
          span: 2,
        },
        { run: null, startColumnIndex: 3, span: 1 },
      ]),
      processGroupHeader,
    );
    const out: CsvProjectedValue[] = [];

    expect(cursor.step(out, 0)).toBe(false);
    expect(out).toEqual([""]);
    expect(cursor.step(out, Number.NaN)).toBe(false);
    expect(out).toEqual(["", "[G]"]);
    expect(cursor.step(out, -1)).toBe(false);
    expect(out).toEqual(["", "[G]", ""]);
    expect(cursor.step(out, Number.POSITIVE_INFINITY)).toBe(true);
    expect(out).toEqual(["", "[G]", "", ""]);
    expect(processGroupHeader).toHaveBeenCalledTimes(1);
  });
});

describe("CSV projection cursors - compatibility and errors", () => {
  it("keeps eager row and header helpers value-identical to cursor drains", () => {
    const columns = [
      rowNumberColumn(3),
      dataColumn({ field: "a", headerName: "A" }),
      dataColumn({ field: "b" }),
    ];
    const input = rowInput(columns, { row: { a: "x", b: 2 } });
    const rowCursor = createCsvRowProjectionCursor(input);
    const rowValues: CsvProjectedValue[] = [];
    while (!rowCursor.step(rowValues, 1)) {
      // drain with the smallest valid budget
    }
    expect(projectCsvRow(input)).toEqual({ exported: true, values: rowValues });

    const plannedGroupRow = groupRow([
      { run: null, startColumnIndex: 0, span: 1 },
      {
        run: { groupId: "g", headerName: "G", level: 0, fields: ["a", "b"] },
        startColumnIndex: 1,
        span: 2,
      },
    ]);
    expect(
      projectCsvHeaders({
        plannedColumns: columns,
        groupHeaderPlan: { rows: [plannedGroupRow] },
        includeColumnHeaders: true,
      }),
    ).toEqual({ groupRows: [["", "G", ""]], leafRow: ["Row", "A", "b"] });
  });

  it("propagates callback errors without mutating row, columns, plans, or output", () => {
    const error = new Error("projection callback failed");
    const row: RowData = Object.freeze({ a: 1 });
    const column: ColumnDef = Object.freeze({ field: "a" });
    const plannedColumn: CsvPlannedColumn = Object.freeze(
      dataColumn(column),
    );
    const columns: readonly CsvPlannedColumn[] = Object.freeze([plannedColumn]);
    const rowOut: CsvProjectedValue[] = [];
    const rowCursor = createCsvRowProjectionCursor(
      rowInput(columns, {
        row,
        processCell: () => {
          throw error;
        },
      }),
    );

    expect(() => rowCursor.step(rowOut, 1)).toThrow(error);
    expect(rowOut).toEqual([]);
    expect(row).toEqual({ a: 1 });
    expect(column).toEqual({ field: "a" });

    const run = Object.freeze({
      groupId: "g",
      headerName: "G",
      level: 0,
      fields: Object.freeze(["a"]),
    });
    const segment = Object.freeze({
      run,
      startColumnIndex: 0,
      span: 1,
    });
    const plannedGroupRow: CsvGroupHeaderRow = Object.freeze({
      level: 0,
      segments: Object.freeze([segment]),
    });
    const headerOut: CsvProjectedValue[] = [];
    const headerCursor = createCsvGroupHeaderProjectionCursor(
      plannedGroupRow,
      () => {
        throw error;
      },
    );

    expect(() => headerCursor.step(headerOut, 1)).toThrow(error);
    expect(headerOut).toEqual([]);
    expect(plannedGroupRow.segments[0]).toBe(segment);
  });
});
