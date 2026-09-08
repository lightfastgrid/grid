/**
 * Derive the column group headers snapshot for visible columns only.
 *
 * Depth is computed from visible grouped leaves — if all grouped leaves are
 * hidden (or no grouped leaves exist), returns `undefined` so the renderer
 * treats the grid as flat.
 */

import type {
  ColumnDef,
  ColumnGroupHeadersSnapshot,
  ColumnGroupPathMeta,
} from '../../types';

/**
 * @param allGroupMeta - Group path metadata for ALL leaves (including hidden), keyed by field.
 * @param visibleCols  - Effective visible column defs from the snapshot.
 * @returns Snapshot with depth computed from visible grouped leaves, or `undefined` when none exist.
 */
export function deriveColumnGroupHeaderSnapshot(
  allGroupMeta: Record<string, ColumnGroupPathMeta>,
  visibleCols: readonly ColumnDef[],
): ColumnGroupHeadersSnapshot | undefined {
  const byField: Record<string, ColumnGroupPathMeta> = {};
  let visibleDepth = 0;

  for (const col of visibleCols) {
    const meta = allGroupMeta[col.field];
    if (meta) {
      byField[col.field] = meta;
      if (meta.path.length > visibleDepth) {
        visibleDepth = meta.path.length;
      }
    }
  }

  if (visibleDepth === 0) return undefined;
  return { depth: visibleDepth, byField };
}
