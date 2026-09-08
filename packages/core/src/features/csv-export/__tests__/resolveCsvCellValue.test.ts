import { describe, expect, it, vi } from "vitest";

import type { ColumnDef, RowData } from "../../../types";
import type { CsvProcessCellParams } from "../csvExportTypes";
import type { CsvProjectedValue } from "../csvProjectedValue";
import type { CsvPlannedDataColumn } from "../planCsvColumnScope";
import { resolveCsvCellValue } from "../resolveCsvCellValue";

function dataColumn(column: ColumnDef): CsvPlannedDataColumn {
  return { kind: "data", column, field: column.field };
}

function resolve(
  column: ColumnDef,
  row: RowData,
  extra: {
    useValueFormatter?: boolean;
    processCell?: Parameters<typeof resolveCsvCellValue>[0]["processCell"];
    rowIndex?: number;
    sourceRowIndex?: number;
  } = {},
) {
  return resolveCsvCellValue({
    plannedColumn: dataColumn(column),
    row,
    rowId: "r1",
    rowIndex: extra.rowIndex ?? 4,
    sourceRowIndex: extra.sourceRowIndex ?? 9,
    useValueFormatter: extra.useValueFormatter ?? true,
    processCell: extra.processCell,
  });
}

describe("resolveCsvCellValue - exportValueField precedence", () => {
  it("reads exportValueField and skips getter and formatter", () => {
    const valueGetter = vi.fn(() => "getter");
    const valueFormatter = vi.fn(() => "formatter");
    const column: ColumnDef = {
      field: "price",
      exportValueField: "priceExport",
      valueGetter,
      valueFormatter,
    };
    const row: RowData = { price: 1, priceExport: "precomputed" };
    expect(resolve(column, row)).toBe("precomputed");
    expect(valueGetter).not.toHaveBeenCalled();
    expect(valueFormatter).not.toHaveBeenCalled();
  });

  it("supports dot-path exportValueField", () => {
    const column: ColumnDef = { field: "p", exportValueField: "meta.export" };
    expect(resolve(column, { meta: { export: 42 } })).toBe(42);
  });
});

describe("resolveCsvCellValue - getter / formatter", () => {
  it("valueGetter receives the candidate rowIndex", () => {
    const valueGetter = vi.fn(() => "v");
    const column: ColumnDef = { field: "name", valueGetter };
    resolve(column, { name: "x" }, { rowIndex: 12 });
    expect(valueGetter).toHaveBeenCalledTimes(1);
    expect(valueGetter).toHaveBeenCalledWith({
      row: { name: "x" },
      rowIndex: 12,
      field: "name",
      column,
    });
  });

  it("runs valueFormatter when enabled and converts to string", () => {
    const column: ColumnDef = {
      field: "n",
      valueFormatter: ({ value }) => `#${String(value)}`,
    };
    const result = resolve(column, { n: 5 }, { useValueFormatter: true });
    expect(result).toBe("#5");
    expect(typeof result).toBe("string");
  });

  it("skips valueFormatter when disabled, preserving the raw typed value", () => {
    const valueFormatter = vi.fn(() => "formatted");
    const column: ColumnDef = { field: "n", valueFormatter };
    const result = resolve(column, { n: 5 }, { useValueFormatter: false });
    expect(result).toBe(5);
    expect(typeof result).toBe("number");
    expect(valueFormatter).not.toHaveBeenCalled();
  });

  it("does not call getter or formatter more than once", () => {
    const valueGetter = vi.fn(() => 7);
    const valueFormatter = vi.fn(({ value }) => `=${String(value)}`);
    const column: ColumnDef = { field: "n", valueGetter, valueFormatter };
    resolve(column, {});
    expect(valueGetter).toHaveBeenCalledTimes(1);
    expect(valueFormatter).toHaveBeenCalledTimes(1);
  });
});

describe("resolveCsvCellValue - typed value preservation", () => {
  it.each([
    ["number", 42, 42],
    ["bigint", 10n, 10n],
    ["boolean", true, true],
    ["null", null, null],
    ["undefined", undefined, undefined],
  ])("preserves %s without a formatter", (_label, raw, expected) => {
    const column: ColumnDef = { field: "v" };
    expect(resolve(column, { v: raw }, { useValueFormatter: false })).toBe(expected);
  });

  it("converts unsupported object values with String()", () => {
    const column: ColumnDef = { field: "v" };
    expect(resolve(column, { v: { a: 1 } })).toBe("[object Object]");
  });
});

describe("resolveCsvCellValue - processCell", () => {
  it("receives both rowIndex and sourceRowIndex plus raw/formatted", () => {
    const processCell = vi.fn(() => "out");
    const column: ColumnDef = {
      field: "n",
      valueFormatter: ({ value }) => `f${String(value)}`,
    };
    const row: RowData = { n: 3 };
    const result = resolve(column, row, {
      processCell,
      rowIndex: 6,
      sourceRowIndex: 20,
    });
    expect(result).toBe("out");
    expect(processCell).toHaveBeenCalledTimes(1);
    expect(processCell).toHaveBeenCalledWith({
      row,
      rowId: "r1",
      rowIndex: 6,
      sourceRowIndex: 20,
      column,
      field: "n",
      rawValue: 3,
      formattedValue: "f3",
    });
  });

  it("takes final precedence over the formatter result", () => {
    const column: ColumnDef = {
      field: "n",
      valueFormatter: () => "formatted",
    };
    expect(resolve(column, { n: 1 }, { processCell: () => "final" })).toBe("final");
  });

  it("can return a typed value that changes the projected type", () => {
    const column: ColumnDef = { field: "n" };
    expect(resolve(column, { n: "5" }, { processCell: () => 5 })).toBe(5);
  });

  it("receives the exportValueField raw value on the projection path", () => {
    const processCell = vi.fn(
      (params: CsvProcessCellParams): CsvProjectedValue => `raw:${String(params.rawValue)}`,
    );
    const column: ColumnDef = { field: "p", exportValueField: "pe" };
    expect(resolve(column, { pe: 99 }, { processCell })).toBe("raw:99");
    expect(processCell).toHaveBeenCalledWith(
      expect.objectContaining({ rawValue: 99, formattedValue: "99" }),
    );
  });
});

describe("resolveCsvCellValue - callback error propagation", () => {
  it("propagates valueGetter errors", () => {
    const column: ColumnDef = {
      field: "n",
      valueGetter: () => {
        throw new Error("getter");
      },
    };
    expect(() => resolve(column, {})).toThrow("getter");
  });

  it("propagates valueFormatter errors", () => {
    const column: ColumnDef = {
      field: "n",
      valueFormatter: () => {
        throw new Error("formatter");
      },
    };
    expect(() => resolve(column, { n: 1 })).toThrow("formatter");
  });

  it("propagates processCell errors", () => {
    const column: ColumnDef = { field: "n" };
    expect(() =>
      resolve(column, { n: 1 }, {
        processCell: () => {
          throw new Error("process");
        },
      }),
    ).toThrow("process");
  });
});

describe("resolveCsvCellValue - no mutation", () => {
  it("does not mutate the row or column", () => {
    const column: ColumnDef = Object.freeze({ field: "n" });
    const row: RowData = Object.freeze({ n: 1 });
    resolve(column, row, { useValueFormatter: false });
    expect(row).toEqual({ n: 1 });
    expect(column).toEqual({ field: "n" });
  });
});
