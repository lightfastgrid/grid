/**
 * CSV Export V1 - pure column scope planner (Stage 1).
 *
 * Resolves a `CsvColumnScope` into an ordered list of planned columns. The
 * column universe is small (bounded by column count, not rows), so this runs
 * eagerly. `ColumnDef` objects are referenced, never cloned or mutated.
 *
 * The synthetic row-number column is a feature-owned virtual variant; no real
 * `ColumnDef` is created for it. When enabled it is prepended to the plan.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 10.
 */

import { isInternalColumn } from "../../internal/internalColumns";
import type { ColumnDef } from "../../types";

import {
  CsvExportDuplicateColumnError,
  CsvExportUnknownColumnError,
} from "./csvExportErrors";
import type { CsvExportSnapshot } from "./csvExportSnapshot";
import type { CsvColumnScope } from "./csvExportTypes";
import type { NormalizedCsvExportDefaults } from "./normalizeCsvExportOptions";

/** A real data column referenced from the snapshot column arrays. */
export interface CsvPlannedDataColumn {
  kind: "data";
  /** The referenced column def (never cloned or mutated). */
  column: ColumnDef;
  /** The column's field, used as its export id (dot-paths stay opaque ids). */
  field: string;
}

/** The synthetic row-number column. Owns no `ColumnDef`. */
export interface CsvPlannedRowNumberColumn {
  kind: "rowNumber";
  headerName: string;
  startAt: number;
}

export type CsvPlannedColumn = CsvPlannedDataColumn | CsvPlannedRowNumberColumn;

function isUtilityColumn(column: ColumnDef): boolean {
  return column.cellKind === "actions";
}

/** `exportable: false` is an absolute exclusion for every scope. */
function isExportable(column: ColumnDef): boolean {
  return column.exportable !== false;
}

/** Scope-derived inclusion (visible / all / selected) with opt-in gates. */
function includeInScope(
  column: ColumnDef,
  normalized: NormalizedCsvExportDefaults,
): boolean {
  if (!isExportable(column)) return false;
  if (isInternalColumn(column) && !normalized.includeInternalColumns) return false;
  if (isUtilityColumn(column) && !normalized.includeUtilityColumns) return false;
  return true;
}

function toDataColumn(column: ColumnDef): CsvPlannedDataColumn {
  return { kind: "data", column, field: column.field };
}

function planFieldsScope(
  snapshot: CsvExportSnapshot,
  fields: readonly string[],
): CsvPlannedDataColumn[] {
  // Universe excludes `exportable: false` columns absolutely, so an explicit
  // request for one resolves as unknown. Hidden and utility columns remain
  // requestable by naming them.
  const byField = new Map<string, ColumnDef>();
  for (const column of snapshot.allLeafColumns) {
    if (isExportable(column)) byField.set(column.field, column);
  }

  const requested = new Set<string>();
  const out: CsvPlannedDataColumn[] = [];
  for (const field of fields) {
    if (requested.has(field)) throw new CsvExportDuplicateColumnError(field);
    requested.add(field);
    const column = byField.get(field);
    if (column === undefined) throw new CsvExportUnknownColumnError(field);
    out.push(toDataColumn(column));
  }
  return out;
}

/**
 * Resolve a column scope into an ordered planned-column list.
 *
 * - `visible`: effective visible columns in lane order.
 * - `all`: all leaf columns including hidden, in source-definition order.
 * - `selected`: selected columns in visible display lane order.
 * - `fields`: caller field order (may include hidden/utility columns).
 *
 * When `includeRowNumbers` is enabled the synthetic row-number column is
 * prepended.
 */
export function planCsvColumnScope(
  snapshot: CsvExportSnapshot,
  scope: CsvColumnScope,
  normalized: NormalizedCsvExportDefaults,
): CsvPlannedColumn[] {
  let dataColumns: CsvPlannedDataColumn[];
  switch (scope.mode) {
    case "visible":
      dataColumns = snapshot.visibleColumns
        .filter((column) => includeInScope(column, normalized))
        .map(toDataColumn);
      break;
    case "all":
      dataColumns = snapshot.allLeafColumns
        .filter((column) => includeInScope(column, normalized))
        .map(toDataColumn);
      break;
    case "selected":
      dataColumns = snapshot.visibleColumns
        .filter(
          (column) =>
            snapshot.selectedColumnIds.has(column.field) &&
            includeInScope(column, normalized),
        )
        .map(toDataColumn);
      break;
    case "fields":
      dataColumns = planFieldsScope(snapshot, scope.fields);
      break;
  }

  const rowNumbers = normalized.includeRowNumbers;
  if (rowNumbers.enabled) {
    const synthetic: CsvPlannedRowNumberColumn = {
      kind: "rowNumber",
      headerName: rowNumbers.headerName,
      startAt: rowNumbers.startAt,
    };
    return [synthetic, ...dataColumns];
  }
  return dataColumns;
}
