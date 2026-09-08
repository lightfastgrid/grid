/**
 * Cached column edge table for virtual horizontal scrolling.
 * Avoids rebuilding O(columns) edge arrays on every scroll frame when
 * columns and live resize override are unchanged.
 */

import type { ColumnWidthOverride } from "../../internal/layoutTypes";
import type { ColumnDef } from "../../types";
import { POOL_SIDE_BUFFER_COLS } from "../helpers/calculateColumnPoolSize";
import {
  buildColumnLeftEdges,
  firstColumnIndexForScrollLeft,
} from "../helpers/columnLayout";

/** Immutable column geometry derived from defs + optional resize override. */
export interface CachedColumnLayout {
  readonly edges: readonly number[];
  readonly totalWidth: number;
  readonly columnCount: number;
}

/** Same shape as {@link ColWindowResult} from computeWindows. */
export interface ColWindowFromLayout {
  startCol: number;
  slotCount: number;
  edges: readonly number[];
  key: string;
  totalWidth: number;
}

export function resizeOverrideKey(
  resizeOverride: ColumnWidthOverride | null,
): string {
  if (!resizeOverride) return "";
  return `${resizeOverride.field}\0${resizeOverride.width}`;
}

export function buildCachedColumnLayout(
  columns: ColumnDef[],
  resizeOverride: ColumnWidthOverride | null,
): CachedColumnLayout {
  const edges = buildColumnLeftEdges(columns, resizeOverride);
  const totalWidth =
    edges.length > 0 ? (edges[edges.length - 1] ?? 0) : 0;
  return {
    edges,
    totalWidth,
    columnCount: columns.length,
  };
}

/** True when edges must be rebuilt (new column set or new override). */
export function columnLayoutCacheKeyChanged(
  columns: ColumnDef[],
  resizeOverride: ColumnWidthOverride | null,
  cached: { columnsRef: ColumnDef[]; overrideKey: string } | null,
): boolean {
  if (!cached) return true;
  if (cached.columnsRef !== columns) return true;
  return cached.overrideKey !== resizeOverrideKey(resizeOverride);
}

/**
 * Compute first visible column / window start from scroll position and a layout
 * that already has edges (no allocation).
 */
export function computeColumnWindowFromLayout(
  scrollLeft: number,
  layout: CachedColumnLayout,
  columnSlotCount: number,
  suppressVirtualization: boolean,
): ColWindowFromLayout {
  const { edges, totalWidth, columnCount } = layout;
  let startCol = 0;
  if (columnCount > 0) {
    const firstVisible = firstColumnIndexForScrollLeft(
      scrollLeft,
      edges,
      columnCount,
    );
    const rawStartCol = suppressVirtualization
      ? 0
      : firstVisible - POOL_SIDE_BUFFER_COLS;
    const maxStartCol = Math.max(0, columnCount - columnSlotCount);
    startCol = Math.max(0, Math.min(rawStartCol, maxStartCol));
  }

  const key = `${startCol}|${columnSlotCount}|${totalWidth}`;
  return {
    startCol,
    slotCount: columnSlotCount,
    edges,
    key,
    totalWidth,
  };
}
