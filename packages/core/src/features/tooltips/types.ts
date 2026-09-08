/**
 * Public tooltip types — plain-text only.
 *
 * v1 scope: plain text tooltips. No HTML, no custom renderers, no DOM access
 * from the getter. The resolver is a pure function that returns `string | null`.
 *
 * Identity: callbacks receive `rowId` (resolved by the grid identity service)
 * so consumers keep using row-based identity. `rowIndex` is callback context
 * only and MUST NOT be used to derive an id.
 */

import type { Grid } from "../../Grid";
import type { ColumnDef, RowData } from "../../types";

/**
 * Context object passed to tooltip value getter callbacks.
 *
 * - `row`            — the row object as supplied by the grid.
 * - `rowIndex`       — current displayed/bound row index from the display
 *                      reader, not the source data-array index. Position
 *                      only; never use it to derive a row id.
 * - `rowId`          — stable id resolved by the grid's identity service.
 * - `column`         — the column definition this cell belongs to.
 * - `field`          — convenience accessor for `column.field`.
 * - `value`          — resolved cell value (after `valueGetter`, before
 *                      `valueFormatter`).
 * - `formattedValue` — display text (after `valueFormatter`).
 * - `grid`           — live `Grid` handle for read-only inspection.
 */
export interface TooltipValueGetterParams {
  row: RowData;
  rowIndex: number;
  rowId: string;
  column: ColumnDef;
  field: string;
  value: unknown;
  formattedValue: string;
  grid: Grid;
}

/**
 * Functional tooltip value getter. May return:
 * - a non-empty string to show as tooltip text,
 * - `null` or `undefined` to show no tooltip.
 */
export type TooltipValueGetter = (
  params: TooltipValueGetterParams,
) => string | null | undefined;
