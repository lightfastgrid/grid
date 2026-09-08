/**
 * CSV Export V1 - pure row projection (Stage 2B).
 *
 * Projects one exported source row into a flat array of projected values,
 * aligned to the planned columns. This eager compatibility helper drains the
 * bounded Stage 3B-A row cursor; cooperative execution uses the cursor itself.
 *
 * - `shouldExportRow` runs once before any cell projection; a false result
 *   invokes no `valueGetter`, `valueFormatter`, or `processCell`.
 * - The synthetic row-number value is `startAt + emittedRowIndex`, so numbering
 *   stays contiguous after skipped rows. It fabricates no `ColumnDef` and never
 *   invokes `processCell` (which requires a real `ColumnDef`).
 * - The callback `rowIndex` is the pre-skip candidate index.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Sections 11-12.
 */

import type { RowData } from "../../types";

import type {
  CsvProcessCellParams,
  CsvShouldExportRowParams,
} from "./csvExportTypes";
import type { CsvProjectedValue } from "./csvProjectedValue";
import { createCsvRowProjectionCursor } from "./csvRowProjectionCursor";
import type { CsvPlannedColumn } from "./planCsvColumnScope";

export interface ProjectCsvRowInput {
  row: RowData;
  rowId: string;
  /** Candidate export/display index before skipped rows are removed. */
  rowIndex: number;
  /** Original source-array index. */
  sourceRowIndex: number;
  /** Count of rows already emitted; drives contiguous row numbering. */
  emittedRowIndex: number;
  plannedColumns: readonly CsvPlannedColumn[];
  useValueFormatter: boolean;
  processCell?: (params: CsvProcessCellParams) => CsvProjectedValue;
  shouldExportRow?: (params: CsvShouldExportRowParams) => boolean;
}

export interface ProjectCsvRowResult {
  /** `false` when `shouldExportRow` skipped the row (no cells projected). */
  exported: boolean;
  /** Flat projected values aligned to `plannedColumns`; empty when skipped. */
  values: CsvProjectedValue[];
}

export function projectCsvRow(input: ProjectCsvRowInput): ProjectCsvRowResult {
  const values: CsvProjectedValue[] = [];
  const cursor = createCsvRowProjectionCursor(input);
  while (!cursor.step(values, Number.MAX_SAFE_INTEGER)) {
    // The eager compatibility helper drains the bounded cursor completely.
  }
  return { exported: cursor.exported === true, values };
}
