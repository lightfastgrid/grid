import { describe, expect, it, vi } from "vitest";

import {
  formatCellValue,
  getCellRawValue,
} from "../../rendering/helpers/cellValue";
import type { ColumnDef, RowData } from "../../types";
import {
  formatColumnValue,
  resolveColumnDisplayValue,
  resolveColumnRawValue,
} from "../columnValueAccess";

describe("columnValueAccess - raw value", () => {
  it("reads a plain field", () => {
    const column: ColumnDef = { field: "name" };
    expect(resolveColumnRawValue({ name: "Alice" }, 0, column)).toBe("Alice");
  });

  it("reads a nested dot-path field", () => {
    const column: ColumnDef = { field: "address.city" };
    const row: RowData = { address: { city: "Paris" } };
    expect(resolveColumnRawValue(row, 0, column)).toBe("Paris");
  });

  it("valueGetter takes precedence and receives exact params", () => {
    const valueGetter = vi.fn(() => "computed");
    const column: ColumnDef = { field: "name", valueGetter };
    const row: RowData = { name: "ignored" };
    expect(resolveColumnRawValue(row, 7, column)).toBe("computed");
    expect(valueGetter).toHaveBeenCalledTimes(1);
    expect(valueGetter).toHaveBeenCalledWith({
      row,
      rowIndex: 7,
      field: "name",
      column,
    });
  });

  it("propagates valueGetter exceptions", () => {
    const column: ColumnDef = {
      field: "name",
      valueGetter: () => {
        throw new Error("getter boom");
      },
    };
    expect(() => resolveColumnRawValue({}, 0, column)).toThrow("getter boom");
  });
});

describe("columnValueAccess - format value", () => {
  it("valueFormatter receives exact params", () => {
    const valueFormatter = vi.fn(() => "formatted");
    const column: ColumnDef = { field: "name", valueFormatter };
    const row: RowData = { name: "Alice" };
    expect(formatColumnValue("raw", row, 3, column)).toBe("formatted");
    expect(valueFormatter).toHaveBeenCalledTimes(1);
    expect(valueFormatter).toHaveBeenCalledWith({
      row,
      rowIndex: 3,
      field: "name",
      column,
      value: "raw",
    });
  });

  it.each([
    [null, ""],
    [undefined, ""],
    [42, "42"],
    [true, "true"],
    [false, "false"],
    [10n, "10"],
  ])("converts %p to %p without a formatter", (input, expected) => {
    const column: ColumnDef = { field: "v" };
    expect(formatColumnValue(input, { v: input }, 0, column)).toBe(expected);
  });

  it("propagates valueFormatter exceptions", () => {
    const column: ColumnDef = {
      field: "name",
      valueFormatter: () => {
        throw new Error("formatter boom");
      },
    };
    expect(() => formatColumnValue("raw", {}, 0, column)).toThrow("formatter boom");
  });
});

describe("columnValueAccess - combined display", () => {
  it("runs getter then formatter, each exactly once", () => {
    const calls: string[] = [];
    const valueGetter = vi.fn(() => {
      calls.push("getter");
      return "raw";
    });
    const valueFormatter = vi.fn((params: { value: unknown }) => {
      calls.push("formatter");
      return `<${String(params.value)}>`;
    });
    const column: ColumnDef = { field: "name", valueGetter, valueFormatter };
    expect(resolveColumnDisplayValue({ name: "x" }, 0, column)).toBe("<raw>");
    expect(valueGetter).toHaveBeenCalledTimes(1);
    expect(valueFormatter).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["getter", "formatter"]);
  });

  it("does not mutate the column or row", () => {
    const column: ColumnDef = Object.freeze({ field: "name" });
    const row: RowData = Object.freeze({ name: "Alice" });
    expect(resolveColumnDisplayValue(row, 0, column)).toBe("Alice");
    expect(row).toEqual({ name: "Alice" });
    expect(column).toEqual({ field: "name" });
  });
});

describe("cellValue wrapper - renderer-local selection behavior", () => {
  it("selection columns bypass valueGetter/valueFormatter (stays local)", () => {
    const valueGetter = vi.fn(() => "getter-value");
    const valueFormatter = vi.fn(() => "formatter-value");
    const column: ColumnDef = {
      field: "__select",
      internal: "selection",
      valueGetter,
      valueFormatter,
    };
    const row: RowData = { __select: true };
    // Wrapper uses the raw field and String() conversion, never the callbacks.
    expect(getCellRawValue(row, 0, column)).toBe(true);
    expect(formatCellValue(true, row, 0, column)).toBe("true");
    expect(valueGetter).not.toHaveBeenCalled();
    expect(valueFormatter).not.toHaveBeenCalled();
  });

  it("ordinary columns delegate to the neutral semantics", () => {
    const column: ColumnDef = {
      field: "name",
      valueFormatter: ({ value }) => `[${String(value)}]`,
    };
    const row: RowData = { name: "Alice" };
    expect(getCellRawValue(row, 0, column)).toBe(
      resolveColumnRawValue(row, 0, column),
    );
    expect(formatCellValue("Alice", row, 0, column)).toBe(
      formatColumnValue("Alice", row, 0, column),
    );
  });
});
