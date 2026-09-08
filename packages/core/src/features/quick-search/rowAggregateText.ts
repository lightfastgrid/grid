import type { ColumnDef, RowData } from "../../types";

import type { QuickSearchNormalizer } from "./normalizer";
import { readRowFieldValue } from "./rowFieldValue";

/**
 * Build normalized aggregate row text for main-thread fallback matching.
 *
 * Field values are joined with a space so query parts can match across
 * columns — same contract as the worker snapshot store.
 *
 * Precedence per column (mirrors {@link searchableFieldResolver}):
 * 1. `quickFilterTextField` → read projection field (same as worker).
 * 2. `getQuickFilterText` → run custom extractor.
 * 3. `valueGetter` + optional `valueFormatter` → run value pipeline.
 * 4. Raw field value.
 */
export function buildNormalizedRowAggregateText(
  row: RowData,
  columns: readonly ColumnDef[],
  normalizer: QuickSearchNormalizer,
  rowIndex: number = 0,
): string {
  const parts: string[] = new Array(columns.length);
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]!;
    let raw: unknown;
    if (col.quickFilterTextField) {
      raw = readRowFieldValue(row, col.quickFilterTextField);
    } else if (typeof col.getQuickFilterText === "function") {
      raw = col.getQuickFilterText({
        value: readRowFieldValue(row, col.field),
        row,
        column: col,
      });
    } else if (typeof col.valueGetter === "function") {
      const baseParams = { row, rowIndex, field: col.field, column: col };
      const gotten = col.valueGetter(baseParams);
      raw = typeof col.valueFormatter === "function"
        ? col.valueFormatter({ ...baseParams, value: gotten })
        : gotten;
    } else if (typeof col.valueFormatter === "function") {
      const fieldVal = readRowFieldValue(row, col.field);
      raw = col.valueFormatter({ value: fieldVal, row, rowIndex, field: col.field, column: col });
    } else {
      raw = readRowFieldValue(row, col.field);
    }
    parts[i] = normalizer.normalizeValue(raw);
  }
  return parts.join(" ");
}
