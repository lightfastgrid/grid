/**
 * CSV Export V1 - pure cell value projection (Stage 2B).
 *
 * Projects one exported cell for an ordinary data column. Reuses the Stage 2A
 * neutral value access; never duplicates getter/formatter logic and never
 * imports renderer, filter, or quick-search code.
 *
 * Precedence (Section 12):
 *   1. `exportValueField` reads through `resolveFieldValue`, skipping
 *      `valueGetter` and `valueFormatter` entirely.
 *   2. otherwise the raw value comes from `resolveColumnRawValue`.
 *   3. `valueFormatter` runs (via `formatColumnValue`) only when enabled.
 *   4. `processCell` runs last; its return becomes the projected value.
 *
 * Each of getter, formatter, and `processCell` runs at most once per cell.
 * Callback exceptions propagate unchanged. No row/`ColumnDef` mutation.
 */

import type { ColumnDef, RowData } from "../../types";
import { resolveFieldValue } from "../../utils/resolveDotPath";
import {
  formatColumnValue,
  resolveColumnRawValue,
} from "../../value-access/columnValueAccess";

import type { CsvProcessCellParams } from "./csvExportTypes";
import {
  csvEmptyStringify,
  type CsvProjectedValue,
  toTypedProjectedValue,
} from "./csvProjectedValue";
import type { CsvPlannedDataColumn } from "./planCsvColumnScope";

export interface ResolveCsvCellValueInput {
  plannedColumn: CsvPlannedDataColumn;
  row: RowData;
  rowId: string;
  /** Candidate export/display index before skipped rows are removed. */
  rowIndex: number;
  /** Original source-array index. */
  sourceRowIndex: number;
  useValueFormatter: boolean;
  processCell?: (params: CsvProcessCellParams) => CsvProjectedValue;
}

export function resolveCsvCellValue(
  input: ResolveCsvCellValueInput,
): CsvProjectedValue {
  const {
    plannedColumn,
    row,
    rowId,
    rowIndex,
    sourceRowIndex,
    useValueFormatter,
    processCell,
  } = input;
  const column: ColumnDef = plannedColumn.column;
  const field = plannedColumn.field;

  let rawValue: unknown;
  let projected: CsvProjectedValue;
  let formattedValue: string;

  if (column.exportValueField !== undefined) {
    // Precomputed display projection: never invoke getter/formatter.
    rawValue = resolveFieldValue(row, column.exportValueField);
    projected = toTypedProjectedValue(rawValue);
    formattedValue = csvEmptyStringify(rawValue);
  } else {
    rawValue = resolveColumnRawValue(row, rowIndex, column);
    if (useValueFormatter && column.valueFormatter !== undefined) {
      formattedValue = formatColumnValue(rawValue, row, rowIndex, column);
      projected = formattedValue; // formatter converts to a string
    } else {
      projected = toTypedProjectedValue(rawValue);
      formattedValue = csvEmptyStringify(rawValue);
    }
  }

  if (processCell !== undefined) {
    return processCell({
      row,
      rowId,
      rowIndex,
      sourceRowIndex,
      column,
      field,
      rawValue,
      formattedValue,
    });
  }
  return projected;
}
