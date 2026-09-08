/**
 * Renderer-local cell value adapter.
 *
 * Keeps the selection-column special case local to the renderer and delegates
 * ordinary data columns to the feature-neutral value-access module, so every
 * consumer shares identical ordinary-column semantics. Exported names and
 * signatures are unchanged for hot-path callers (`populateRow`).
 */

import { isInternalColumn } from "../../internal/internalColumns";
import type { ColumnDef, RowData } from "../../types";
import {
  formatColumnValue,
  resolveColumnRawValue,
} from "../../value-access/columnValueAccess";

export function getCellRawValue(
  row: RowData,
  rowIndex: number,
  col: ColumnDef,
): unknown {
  if (isInternalColumn(col)) {
    return row[col.field];
  }
  return resolveColumnRawValue(row, rowIndex, col);
}

export function formatCellValue(
  rawValue: unknown,
  row: RowData,
  rowIndex: number,
  col: ColumnDef,
): string {
  if (isInternalColumn(col)) {
    return rawValue === null || rawValue === undefined
      ? ""
      : String(rawValue);
  }
  return formatColumnValue(rawValue, row, rowIndex, col);
}

export function getCellDisplayValue(
  row: RowData,
  rowIndex: number,
  col: ColumnDef,
): string {
  const raw = getCellRawValue(row, rowIndex, col);
  return formatCellValue(raw, row, rowIndex, col);
}
