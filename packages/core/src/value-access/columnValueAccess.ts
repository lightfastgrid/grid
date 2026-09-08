/**
 * Feature-neutral ordinary-column value access.
 *
 * Pure raw/format/display resolution for ordinary data columns, shared by the
 * renderer, feature controllers (cell shells, tooltips), filters, and (later)
 * CSV export so every consumer produces identical values. This is the
 * compatibility baseline previously embedded in `rendering/helpers/cellValue`.
 *
 * This module owns NO policy for selection/action/utility columns, rendering,
 * filtering, quick search, CSV, DOM, or workers. It depends only on shared
 * types and the dot-path field resolver.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Sections 12 and 16.8.
 */

import type { ColumnDef, RowData } from "../types";
import { resolveFieldValue } from "../utils/resolveDotPath";

/**
 * Raw pre-format value for an ordinary column. `valueGetter` takes precedence
 * over field access; otherwise the dot-path field value is used. The getter
 * receives `row`, `rowIndex`, `field`, and the same `ColumnDef` reference, and
 * its exceptions propagate unchanged.
 */
export function resolveColumnRawValue(
  row: RowData,
  rowIndex: number,
  column: ColumnDef,
): unknown {
  if (column.valueGetter) {
    return column.valueGetter({
      row,
      rowIndex,
      field: column.field,
      column,
    });
  }
  return resolveFieldValue(row, column.field);
}

/**
 * Display string for a pre-resolved raw value. `valueFormatter` receives the
 * raw value, `row`, `rowIndex`, `field`, and `ColumnDef`, and its exceptions
 * propagate unchanged. Without a formatter, `null`/`undefined` become `""` and
 * every other value uses `String(value)`.
 */
export function formatColumnValue(
  rawValue: unknown,
  row: RowData,
  rowIndex: number,
  column: ColumnDef,
): string {
  if (column.valueFormatter) {
    return column.valueFormatter({
      row,
      rowIndex,
      field: column.field,
      column,
      value: rawValue,
    });
  }
  return rawValue === null || rawValue === undefined ? "" : String(rawValue);
}

/**
 * Combined display resolution. Invokes each configured callback exactly once:
 * `valueGetter` (if any) then `valueFormatter` (if any).
 */
export function resolveColumnDisplayValue(
  row: RowData,
  rowIndex: number,
  column: ColumnDef,
): string {
  const rawValue = resolveColumnRawValue(row, rowIndex, column);
  return formatColumnValue(rawValue, row, rowIndex, column);
}
