import type { ColumnDef } from "../types";

import { isInternalColumn } from "./internalColumns";

export const DEFAULT_COL_WIDTH = 150;

export function columnPixelWidth(
  col: ColumnDef,
  defaultW = DEFAULT_COL_WIDTH,
): number {
  return col.width ?? defaultW;
}

export const DEFAULT_MIN_COLUMN_WIDTH = 48;
export const DEFAULT_MAX_COLUMN_WIDTH = 4000;

export function isColumnResizable(col: ColumnDef): boolean {
  if (isInternalColumn(col)) return false;
  if (col.visible === false) return false;
  return col.resizable !== false;
}

export function clampColumnWidth(col: ColumnDef, widthPx: number): number {
  const min = col.minWidth ?? DEFAULT_MIN_COLUMN_WIDTH;
  const max = col.maxWidth ?? DEFAULT_MAX_COLUMN_WIDTH;
  return Math.round(Math.min(max, Math.max(min, widthPx)));
}

/** Width used when starting a drag (honors current `col.width` fallback). */
export function baseColumnDragWidth(col: ColumnDef): number {
  return columnPixelWidth(col);
}
