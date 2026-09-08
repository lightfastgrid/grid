/**
 * Public cell-styling types — class-only.
 *
 * v1 scope: class names only. No `cellStyle` / `getCellStyle`, no inline-style
 * objects, no string expressions, no DOM access from resolver.
 *
 * Identity: callbacks receive `rowId` (resolved by the grid identity service)
 * so consumers keep using row-based identity. `rowIndex` is callback context
 * only and MUST NOT be used to derive an id.
 */

import type { Grid } from "../../Grid";
import type { ColumnDef, RowData } from "../../types";

/**
 * Context object passed to cell-class callbacks.
 *
 * - `row`        — the row object as supplied by the grid.
 * - `rowIndex`   — current data-array index. Position only; never use it
 *                  to derive a row id.
 * - `rowId`      — stable id resolved by the grid's identity service.
 * - `column`     — the column definition this cell belongs to.
 * - `field`      — convenience accessor for `column.field`.
 * - `value`      — resolved cell value (after `valueGetter`, before
 *                  `valueFormatter` — same value passed to formatters).
 * - `grid`       — live `Grid` handle for read-only inspection.
 */
export interface CellClassParams {
  row: RowData;
  rowIndex: number;
  rowId: string;
  column: ColumnDef;
  field: string;
  value: unknown;
  grid: Grid;
}

/**
 * Predicate map. Each key is a class name; the value decides whether the
 * class should apply for a given cell. Predicate errors propagate by design —
 * the resolver does not swallow them.
 */
export type CellClassRules = Record<string, (params: CellClassParams) => boolean>;

/**
 * Functional cell-class hook. May return:
 * - a single class name string,
 * - an array of class names,
 * - `null` / `undefined` / `false` to add nothing.
 */
export type GetCellClass = (
  params: CellClassParams,
) => string | string[] | null | undefined | false;
