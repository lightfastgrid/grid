import { describe, expect, it, vi } from "vitest";

import type { ColumnDef } from "../../../types";
import type { CsvPlannedColumn } from "../planCsvColumnScope";
import { projectCsvRow } from "../projectCsvRow";

function dataCol(column: ColumnDef): CsvPlannedColumn {
  return { kind: "data", column, field: column.field };
}
function rowNumberCol(headerName = "Row", startAt = 1): CsvPlannedColumn {
  return { kind: "rowNumber", headerName, startAt };
}

const NAME = dataCol({ field: "name" });
const AGE = dataCol({ field: "age" });

describe("projectCsvRow - basic projection", () => {
  it("returns a flat value array aligned to planned columns", () => {
    const result = projectCsvRow({
      row: { name: "Alice", age: 30 },
      rowId: "a",
      rowIndex: 0,
      sourceRowIndex: 0,
      emittedRowIndex: 0,
      plannedColumns: [NAME, AGE],
      useValueFormatter: true,
    });
    expect(result.exported).toBe(true);
    expect(result.values).toEqual(["Alice", 30]);
  });
});

describe("projectCsvRow - shouldExportRow", () => {
  it("false result skips the row and invokes no cell callbacks", () => {
    const valueGetter = vi.fn(() => "v");
    const processCell = vi.fn(() => "p");
    const column = dataCol({ field: "name", valueGetter });
    const result = projectCsvRow({
      row: { name: "x" },
      rowId: "a",
      rowIndex: 3,
      sourceRowIndex: 8,
      emittedRowIndex: 0,
      plannedColumns: [column],
      useValueFormatter: true,
      processCell,
      shouldExportRow: () => false,
    });
    expect(result).toEqual({ exported: false, values: [] });
    expect(valueGetter).not.toHaveBeenCalled();
    expect(processCell).not.toHaveBeenCalled();
  });

  it("receives the candidate rowIndex and sourceRowIndex", () => {
    const shouldExportRow = vi.fn(() => true);
    projectCsvRow({
      row: { name: "x" },
      rowId: "a",
      rowIndex: 5,
      sourceRowIndex: 11,
      emittedRowIndex: 0,
      plannedColumns: [NAME],
      useValueFormatter: true,
      shouldExportRow,
    });
    expect(shouldExportRow).toHaveBeenCalledWith({
      row: { name: "x" },
      rowId: "a",
      rowIndex: 5,
      sourceRowIndex: 11,
    });
  });
});

describe("projectCsvRow - synthetic row numbers", () => {
  it("uses startAt + emittedRowIndex for contiguous numbering after skips", () => {
    const columns = [rowNumberCol("Row", 1), NAME];
    const first = projectCsvRow({
      row: { name: "a" },
      rowId: "a",
      rowIndex: 0,
      sourceRowIndex: 0,
      emittedRowIndex: 0,
      plannedColumns: columns,
      useValueFormatter: true,
    });
    // rowIndex 1 and 2 were skipped upstream; emittedRowIndex only counts kept.
    const second = projectCsvRow({
      row: { name: "b" },
      rowId: "b",
      rowIndex: 3,
      sourceRowIndex: 3,
      emittedRowIndex: 1,
      plannedColumns: columns,
      useValueFormatter: true,
    });
    expect(first.values).toEqual([1, "a"]);
    expect(second.values).toEqual([2, "b"]);
  });

  it("honors an explicit startAt of 0", () => {
    const result = projectCsvRow({
      row: { name: "a" },
      rowId: "a",
      rowIndex: 0,
      sourceRowIndex: 0,
      emittedRowIndex: 0,
      plannedColumns: [rowNumberCol("#", 0)],
      useValueFormatter: true,
    });
    expect(result.values).toEqual([0]);
  });

  it("never invokes processCell for the row-number column", () => {
    const processCell = vi.fn(() => "p");
    const result = projectCsvRow({
      row: { name: "a" },
      rowId: "a",
      rowIndex: 0,
      sourceRowIndex: 0,
      emittedRowIndex: 0,
      plannedColumns: [rowNumberCol(), NAME],
      useValueFormatter: true,
      processCell,
    });
    expect(result.values).toEqual([1, "p"]);
    expect(processCell).toHaveBeenCalledTimes(1); // only the data column
  });
});

describe("projectCsvRow - callback call counts", () => {
  it("runs getter and formatter at most once per cell", () => {
    const valueGetter = vi.fn(() => 1);
    const valueFormatter = vi.fn(({ value }) => `=${String(value)}`);
    const column = dataCol({ field: "n", valueGetter, valueFormatter });
    projectCsvRow({
      row: {},
      rowId: "a",
      rowIndex: 0,
      sourceRowIndex: 0,
      emittedRowIndex: 0,
      plannedColumns: [column],
      useValueFormatter: true,
    });
    expect(valueGetter).toHaveBeenCalledTimes(1);
    expect(valueFormatter).toHaveBeenCalledTimes(1);
  });
});
