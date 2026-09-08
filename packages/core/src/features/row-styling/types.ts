/**
 * Public row-styling types — class-only.
 *
 * v1 scope: class names only. No `rowStyle` / `getRowStyle`, no inline-style
 * objects, no string expressions, no DOM access from resolver.
 *
 * Identity: callbacks receive `rowId` (resolved by the grid identity service)
 * so consumers keep using row-based identity. `rowIndex` is callback context
 * only and MUST NOT be used to derive an id.
 */

import type { Grid } from "../../Grid";
import type { RowData } from "../../types";

/**
 * Context object passed to row-class callbacks.
 *
 * - `row`        — the row object as supplied by the grid.
 * - `rowIndex`   — current data-array index. Position only; never use it
 *                  to derive a row id.
 * - `rowId`      — stable id resolved by the grid's identity service.
 * - `grid`       — live `Grid` handle for read-only inspection (e.g. selection).
 */
export interface RowClassParams {
  row: RowData;
  rowIndex: number;
  rowId: string;
  grid: Grid;
}

/**
 * Predicate map. Each key is a class name; the value decides whether the
 * class should apply for a given row. Predicate errors propagate by design —
 * the resolver does not swallow them.
 */
export type RowClassRules = Record<string, (params: RowClassParams) => boolean>;

/**
 * Functional row-class hook. May return:
 * - a single class name string,
 * - an array of class names,
 * - `null` / `undefined` / `false` to add nothing.
 */
export type GetRowClass = (
  params: RowClassParams,
) => string | string[] | null | undefined | false;
