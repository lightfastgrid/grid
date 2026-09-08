import type { GridEventMap } from '@lightfastgrid/core';

/**
 * Safely extracts `rowCount` from a `data:updated` payload.
 *
 * Core types the payload as `{ rowCount: number }`, but the helper stays
 * defensive: if a future payload shape changes or non-numeric sneaks in,
 * the consumer callback is not invoked instead of throwing.
 */
export function getRowCount(
  payload: GridEventMap['data:updated'] | unknown,
): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as { rowCount?: unknown }).rowCount;
  return typeof value === 'number' ? value : null;
}
