import { columnPixelWidth } from "../../internal/columnSizing";
import type { ColumnWidthOverride } from "../../internal/layoutTypes";
import type { ColumnDef } from "../../types";

export type { ColumnWidthOverride } from "../../internal/layoutTypes";

/** `edges[i]` = left offset of column `i` in px; `edges[length]` = total width. */
export function buildColumnLeftEdges(
  columns: ColumnDef[],
  override?: ColumnWidthOverride | null,
): number[] {
  const edges: number[] = [];
  let x = 0;
  for (const c of columns) {
    edges.push(x);
    const w =
      override && override.field === c.field ? override.width : columnPixelWidth(c);
    x += w;
  }
  edges.push(x);
  return edges;
}

/** Pixel width of column `colIndex` from the precomputed edge table (matches live resize overrides). */
export function columnSpanWidth(
  colIndex: number,
  edges: readonly number[],
): number | undefined {
  const left = edges[colIndex];
  const right = edges[colIndex + 1];
  if (left === undefined || right === undefined) return undefined;
  return Math.max(0, right - left);
}

/**
 * First column index whose right edge is strictly to the right of `scrollLeft`.
 */
export function firstColumnIndexForScrollLeft(
  scrollLeft: number,
  edges: readonly number[],
  columnCount: number,
): number {
  if (columnCount === 0) return 0;
  let lo = 0;
  let hi = columnCount - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const right = edges[mid + 1];
    if (right !== undefined && right <= scrollLeft) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
