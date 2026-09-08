/**
 * Renderer-side display-row reader.
 *
 * Wraps a {@link RowView} into a thin accessor that the renderer uses to
 * resolve display rows. This layer lives between the row-model's `RowView`
 * (which owns order/index mapping) and the renderer's binding, styling,
 * and selection paths (which need row objects + source indexes).
 *
 * All renderer paths — center body row binding (via
 * `WindowSyncContext.displayRows`), row-pinning render partitioning,
 * pinned-lane binding, selection, row-order drag, overlays, and
 * visible-row feature controllers (cell menu, row actions, tooltips,
 * resize autosize) — resolve rows through `DisplayRowReader`. Source
 * rows live in `currentSourceRows` (from `RowView.rows`) and are used
 * only for public APIs. The renderer has no dependency on
 * `snapshot.data`.
 *
 * Internal — not exported from the public package surface.
 */

import type { RowView } from "../row-model/rowOrder";
import type { RowData } from "../types";

// ── Types ──────────────────────────────────────────────────────────────

/**
 * A single resolved display row with both its display-order position
 * and its source-array position.
 *
 * Callers that need the row object, its display index, and its original
 * position in the source array can destructure a single entry instead
 * of issuing separate lookups. Not used in hot paths — prefer the
 * scalar accessors `getRowData` / `getSourceIndex` to avoid allocation.
 */
export interface DisplayRowEntry {
  /** Position in display order (the index passed to `getRow`). */
  readonly displayIndex: number;
  /** Index of `row` in the source (unsorted/unfiltered) array. */
  readonly sourceIndex: number;
  /** Row object from the source data array. */
  readonly row: RowData;
}

/**
 * Read-only accessor over display rows backed by a {@link RowView}.
 *
 * This is the **preferred display-row access boundary** for features and
 * renderer internals. All display-index row lookups should go through
 * this reader rather than materializing a `RowData[]` array.
 *
 * - **`rowCount`** — number of rows in display order.
 * - **`getRowData(displayIndex)`** — row object at display position.
 *   Allocation-free; use in hot paths.
 * - **`getSourceIndex(displayIndex)`** — source-array index for a display
 *   position. Allocation-free.
 * - **`getRow(displayIndex)`** — convenience entry with display index,
 *   source index, and row object. Allocates per call; avoid in hot paths.
 *
 * The renderer caches one reader per render cycle by source reference so
 * the same instance is reused when the underlying RowView hasn't changed.
 */
export interface DisplayRowReader {
  /** Number of rows in display order. */
  readonly rowCount: number;
  /**
   * Resolve the {@link DisplayRowEntry} at `displayIndex`.
   * Returns `null` when the index is out of range or the underlying
   * RowView yields an invalid source index.
   *
   * Allocates a fresh object per call — prefer `getRowData` /
   * `getSourceIndex` in hot paths.
   */
  getRow(displayIndex: number): DisplayRowEntry | null;
  /**
   * Resolve just the row data object at `displayIndex`.
   * Returns `undefined` when the index is out of range or the source
   * index is invalid. Allocation-free — suitable for hot paths.
   */
  getRowData(displayIndex: number): RowData | undefined;
  /**
   * Resolve the source-array index for `displayIndex`.
   * Returns `-1` when out of range. Allocation-free.
   */
  getSourceIndex(displayIndex: number): number;
}

// ── Factory ────────────────────────────────────────────────────────────

/**
 * Build a {@link DisplayRowReader} that delegates to `rowView`.
 *
 * The returned reader is a thin stateless wrapper — it holds no caches
 * of its own and is safe to discard on every render cycle.
 *
 * Guards:
 * - Returns `null` / `undefined` / `-1` when `displayIndex` is out of range.
 * - Returns `null` / `undefined` when `rowView.getSourceIndex()` yields a
 *   negative value (RowView signals out-of-range with `-1`).
 * - Returns `null` / `undefined` when `rowView.getRow()` yields `undefined`.
 */
export function createDisplayRowReader(rowView: RowView): DisplayRowReader {
  return {
    get rowCount(): number {
      return rowView.rowCount;
    },
    getSourceIndex(displayIndex: number): number {
      return rowView.getSourceIndex(displayIndex);
    },
    getRowData(displayIndex: number): RowData | undefined {
      const si = rowView.getSourceIndex(displayIndex);
      if (si < 0) return undefined;
      return rowView.rows[si];
    },
    getRow(displayIndex: number): DisplayRowEntry | null {
      const sourceIndex = rowView.getSourceIndex(displayIndex);
      if (sourceIndex < 0) return null;
      const row = rowView.getRow(displayIndex);
      if (row === undefined) return null;
      return { displayIndex, sourceIndex, row };
    },
  };
}

/**
 * Build a {@link DisplayRowReader} backed by a plain `RowData[]` array
 * with identity mapping (display index equals source index).
 *
 * Used as the fallback when no `RowView` is available (pre-RowView
 * compatibility). Does not allocate an intermediate entry array — each
 * `getRow` call returns a fresh `DisplayRowEntry` object (non-hot-path
 * convenience only).
 */
export function createArrayDisplayRowReader(
  rows: RowData[],
): DisplayRowReader {
  return {
    get rowCount(): number {
      return rows.length;
    },
    getSourceIndex(displayIndex: number): number {
      return displayIndex >= 0 && displayIndex < rows.length
        ? displayIndex
        : -1;
    },
    getRowData(displayIndex: number): RowData | undefined {
      return displayIndex >= 0 && displayIndex < rows.length
        ? rows[displayIndex]
        : undefined;
    },
    getRow(displayIndex: number): DisplayRowEntry | null {
      if (displayIndex < 0 || displayIndex >= rows.length) return null;
      const row = rows[displayIndex];
      if (row === undefined) return null;
      return { displayIndex, sourceIndex: displayIndex, row };
    },
  };
}
