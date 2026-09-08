import type { GridLayoutMetrics } from "../../layout/gridLayoutMetrics";

import {
  DEFAULT_VIEWPORT_HEIGHT,
  HEADER_HEIGHT,
  ROW_HEIGHT,
} from "./gridConstants";

export const POOL_SIDE_BUFFER_ROWS = 5;

/**
 * Low-level pool size from explicit body height.
 * Prefer `computeRowPoolSize` which reads the viewport directly.
 */
export function calculatePoolSize(
  viewportBodyHeight: number,
  rowHeight: number,
  buffer: number = POOL_SIDE_BUFFER_ROWS,
): number {
  const visible = Math.ceil(viewportBodyHeight / rowHeight);
  return visible + buffer * 2;
}

/**
 * Row pool size from a live viewport element.
 * Accounts for header height, fallback dimensions, and suppress flag.
 */
export function computeRowPoolSize(
  viewport: HTMLElement | null,
  totalRows: number,
  suppressVirtualization: boolean,
  metrics?: GridLayoutMetrics,
): number {
  if (suppressVirtualization) return Math.max(1, totalRows);
  const rh = metrics?.rowHeight ?? ROW_HEIGHT;
  const hh = metrics?.headerHeight ?? HEADER_HEIGHT;
  const raw = viewport?.clientHeight ?? 0;
  const h = raw > 0 ? raw : DEFAULT_VIEWPORT_HEIGHT;
  const bodyHeight = Math.max(rh, h - hh);
  return calculatePoolSize(bodyHeight, rh);
}