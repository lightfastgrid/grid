import type { ColumnDef, FilterModel, RowData } from "../../types";
import { resolveFieldValue } from "../../utils/resolveDotPath";
import {
  formatColumnValue,
  resolveColumnRawValue,
} from "../../value-access/columnValueAccess";

import type { GetCellValue } from "./filterValueAccess";
import type { NormalizedColumnFilterConfig } from "./types";

export interface CreateFilterDisplayValueAccessorInput {
  columns: readonly ColumnDef[];
  columnsByField: ReadonlyMap<string, NormalizedColumnFilterConfig>;
  fields: Iterable<string>;
}

function fieldNeedsDisplayValueAccess(
  column: ColumnDef | undefined,
  config: NormalizedColumnFilterConfig | undefined,
): boolean {
  if (!column || !config) return false;
  return column.valueGetter !== undefined || (config.type === "text" && column.valueFormatter !== undefined);
}

export function readFilterColumnValue(row: RowData, rowIndex: number, column: ColumnDef): unknown {
  return resolveColumnRawValue(row, rowIndex, column);
}

export function createFilterDisplayValueAccessor(
  input: CreateFilterDisplayValueAccessorInput,
): GetCellValue | undefined {
  let needsCustomAccess = false;
  const columnsByField = new Map<string, ColumnDef>();
  for (const column of input.columns) {
    columnsByField.set(column.field, column);
  }

  for (const field of input.fields) {
    if (fieldNeedsDisplayValueAccess(columnsByField.get(field), input.columnsByField.get(field))) {
      needsCustomAccess = true;
      break;
    }
  }

  if (!needsCustomAccess) return undefined;

  return (row, rowIndex, field) => {
    const column = columnsByField.get(field);
    const config = input.columnsByField.get(field);
    if (!column || !config) return resolveFieldValue(row, field);

    const value = readFilterColumnValue(row, rowIndex, column);
    if (config.type === "text" && column.valueFormatter) {
      return formatColumnValue(value, row, rowIndex, column);
    }
    return value;
  };
}

/** Semantic cell value for filter selection previews (valueGetter when present). */
export function resolveFilterPreviewCellValue(
  row: RowData,
  rowIndex: number,
  column: ColumnDef,
  selectionValue: unknown,
): unknown {
  if (column.valueGetter) {
    return readFilterColumnValue(row, rowIndex, column);
  }
  return selectionValue;
}

export function createFilterDisplayValueAccessorForModel(
  columns: readonly ColumnDef[],
  columnsByField: ReadonlyMap<string, NormalizedColumnFilterConfig>,
  filterModel: FilterModel,
): GetCellValue | undefined {
  return createFilterDisplayValueAccessor({
    columns,
    columnsByField,
    fields: Object.keys(filterModel),
  });
}
