import { pinnedWidths } from "../../features/column-pinning/columnPinningGeometry";
import type { ColumnPinningLayout } from "../../features/column-pinning/columnPinningLayout";
import { columnPixelWidth, DEFAULT_COL_WIDTH } from "../../internal/columnSizing";

import { DEFAULT_VIEWPORT_HEIGHT } from "./gridConstants";

export const POOL_SIDE_BUFFER_COLS = 2;

export function calculateColumnPoolSize(
  viewportWidth: number,
  minColumnWidth: number = DEFAULT_COL_WIDTH,
  buffer: number = POOL_SIDE_BUFFER_COLS,
): number {
  const w = Math.max(1, viewportWidth);
  const visible = Math.ceil(w / minColumnWidth);
  return Math.max(1, visible + buffer * 2);
}

/**
 * Column slot count from a live viewport element.
 * Accounts for fallback dimensions, suppress flag, and column count clamp.
 */
export function computeColumnSlotCount(
  viewport: HTMLElement | null,
  columnCount: number,
  suppressVirtualization: boolean,
): number {
  if (columnCount === 0) return 1;
  if (suppressVirtualization) return columnCount;
  const raw = viewport?.clientWidth ?? 0;
  const w = raw > 0 ? raw : DEFAULT_VIEWPORT_HEIGHT;
  const slots = calculateColumnPoolSize(w);
  return Math.min(Math.max(1, slots), columnCount);
}

/**
 * Center (non-pinned) slot count safe for every horizontal scroll position.
 *
 * Uses the narrowest center column width to compute the worst-case number
 * of columns visible at any scroll offset, then adds side buffer. This
 * guarantees enough physical cell/header slots even when early columns are
 * wide and later columns are narrow (mixed-width grids, post-sizeColumnsToFit).
 *
 * O(center columns) at rebuild/reconcile time only — never in the scroll
 * path. No row scans, no cell measurement.
 */
export function computeCenterSlotCount(
  viewport: HTMLElement | null,
  pinningLayout: ColumnPinningLayout,
  suppressVirtualization: boolean,
): number {
  const centerCount = pinningLayout.center.length;
  if (centerCount === 0) return 0;
  if (suppressVirtualization) return centerCount;

  const raw = viewport?.clientWidth ?? 0;
  const vpWidth = raw > 0 ? raw : DEFAULT_VIEWPORT_HEIGHT;

  const { left: leftWidth, right: rightWidth } = pinnedWidths(pinningLayout);
  const availableWidth = Math.max(1, vpWidth - leftWidth - rightWidth);

  // Find the narrowest positive center column width for worst-case density.
  // Starts at +Infinity so the first valid width wins; falls back to
  // DEFAULT_COL_WIDTH only when no positive finite width exists.
  let minWidth = Number.POSITIVE_INFINITY;
  for (let i = 0; i < centerCount; i++) {
    const w = columnPixelWidth(pinningLayout.center[i]!);
    if (Number.isFinite(w) && w > 0 && w < minWidth) minWidth = w;
  }
  if (!Number.isFinite(minWidth)) minWidth = DEFAULT_COL_WIDTH;

  const visibleNeeded = Math.ceil(availableWidth / minWidth);
  const slots = visibleNeeded + POOL_SIDE_BUFFER_COLS * 2;
  return Math.min(Math.max(1, slots), centerCount);
}
