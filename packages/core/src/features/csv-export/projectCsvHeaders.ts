/**
 * CSV Export V1 - pure leaf/group header projection (Stage 2B).
 *
 * Projects group-header rows and the leaf-header row into flat value arrays
 * aligned to the planned columns. This eager compatibility helper drains the
 * bounded Stage 3B-A header cursors. Group-header and leaf-header inclusion are
 * independent: group rows are present iff the group plan has rows; the leaf row
 * is present iff `includeColumnHeaders`.
 *
 * - Default data header is `column.headerName ?? column.field`.
 * - The row-number header comes from its virtual planned column.
 * - `processHeader` runs once per real data column only.
 * - `processGroupHeader` runs once per contiguous group run, receiving the
 *   exact `groupId`/`headerName`/`level`/`fields`.
 * - Each group run expands to its label in the first cell plus `span - 1`
 *   empty cells; row-number and ungrouped columns are empty spacers.
 * - Callback exceptions propagate unchanged.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Sections 11-12.
 */

import type {
  CsvProcessGroupHeaderParams,
  CsvProcessHeaderParams,
} from "./csvExportTypes";
import {
  createCsvGroupHeaderProjectionCursor,
  createCsvLeafHeaderProjectionCursor,
} from "./csvHeaderProjectionCursor";
import type { CsvProjectedValue } from "./csvProjectedValue";
import type { CsvPlannedColumn } from "./planCsvColumnScope";
import type {
  CsvGroupHeaderPlan,
  CsvGroupHeaderRow,
} from "./planCsvGroupHeaders";

export interface ProjectCsvHeadersInput {
  plannedColumns: readonly CsvPlannedColumn[];
  groupHeaderPlan: CsvGroupHeaderPlan;
  includeColumnHeaders: boolean;
  processHeader?: (params: CsvProcessHeaderParams) => string;
  processGroupHeader?: (params: CsvProcessGroupHeaderParams) => string;
}

export interface CsvHeaderProjection {
  /** Group-header rows, top level first. Empty when the plan has no rows. */
  groupRows: CsvProjectedValue[][];
  /** Leaf-header row, or `null` when `includeColumnHeaders` is false. */
  leafRow: CsvProjectedValue[] | null;
}

function projectLeafRow(
  plannedColumns: readonly CsvPlannedColumn[],
  processHeader:
    | ((params: CsvProcessHeaderParams) => string)
    | undefined,
): CsvProjectedValue[] {
  const out: CsvProjectedValue[] = [];
  const cursor = createCsvLeafHeaderProjectionCursor(
    plannedColumns,
    processHeader,
  );
  while (!cursor.step(out, Number.MAX_SAFE_INTEGER)) {
    // The eager compatibility helper drains the bounded cursor completely.
  }
  return out;
}

function projectGroupRow(
  row: CsvGroupHeaderRow,
  processGroupHeader:
    | ((params: CsvProcessGroupHeaderParams) => string)
    | undefined,
): CsvProjectedValue[] {
  const out: CsvProjectedValue[] = [];
  const cursor = createCsvGroupHeaderProjectionCursor(
    row,
    processGroupHeader,
  );
  while (!cursor.step(out, Number.MAX_SAFE_INTEGER)) {
    // The eager compatibility helper drains the bounded cursor completely.
  }
  return out;
}

export function projectCsvHeaders(
  input: ProjectCsvHeadersInput,
): CsvHeaderProjection {
  const groupRows = input.groupHeaderPlan.rows.map((row) =>
    projectGroupRow(row, input.processGroupHeader),
  );
  const leafRow = input.includeColumnHeaders
    ? projectLeafRow(input.plannedColumns, input.processHeader)
    : null;
  return { groupRows, leafRow };
}
