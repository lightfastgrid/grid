/**
 * Row order primitives.
 *
 * Display order is represented separately from the row data so the common
 * "no transform" case allocates nothing, and active transforms (sort, filter,
 * pagination) carry a compact `Uint32Array` of source indexes.
 *
 * These primitives never mutate user rows.
 */

import type { RowData } from "../types";

/**
 * - `identity` — display index equals source index. No index array allocated.
 * - `indexed` — `indexes[displayIndex]` is the source index.
 */
export type RowOrder =
  | { kind: "identity"; length: number }
  | { kind: "indexed"; indexes: Uint32Array };

/**
 * A read-only view over `rows` in a specific display order. Renderer hot
 * paths (center body binding, row-pin partitioning, styling, autosize)
 * consume `RowView` via `DisplayRowReader`. `snapshot.data` is the raw
 * source-rows reference (no materialization); all display-order access
 * goes through `RowView`.
 */
export interface RowView {
  /** Monotonic generation tag; bumps when the underlying order/rows change. */
  generation: number;
  /** The source row objects. Never mutated. */
  rows: RowData[];
  /** Number of rows in display order. */
  rowCount: number;
  /** Map a display index to its source index, or `-1` when out of range. */
  getSourceIndex(displayIndex: number): number;
  /** Resolve the row at a display index, or `undefined` when out of range. */
  getRow(displayIndex: number): RowData | undefined;
}

/** Identity order — allocates no index array. */
export function createIdentityRowOrder(length: number): RowOrder {
  return { kind: "identity", length };
}

/** Indexed order backed by a `Uint32Array` of source indexes. */
export function createIndexedRowOrder(indexes: Uint32Array): RowOrder {
  return { kind: "indexed", indexes };
}

/** Number of display rows the order represents. */
export function getRowOrderLength(order: RowOrder): number {
  return order.kind === "identity" ? order.length : order.indexes.length;
}

/**
 * Build a `RowView` over `rows` in the given `order`. Identity order reads
 * rows directly; indexed order maps through the `Uint32Array`. The returned
 * view never mutates `rows`.
 */
export function createRowView(
  rows: RowData[],
  order: RowOrder,
  generation: number,
): RowView {
  const rowCount = getRowOrderLength(order);

  if (order.kind === "identity") {
    return {
      generation,
      rows,
      rowCount,
      getSourceIndex: (displayIndex) =>
        displayIndex >= 0 && displayIndex < rowCount ? displayIndex : -1,
      getRow: (displayIndex) =>
        displayIndex >= 0 && displayIndex < rowCount
          ? rows[displayIndex]
          : undefined,
    };
  }

  const indexes = order.indexes;
  return {
    generation,
    rows,
    rowCount,
    getSourceIndex: (displayIndex) =>
      displayIndex >= 0 && displayIndex < rowCount
        ? indexes[displayIndex]!
        : -1,
    getRow: (displayIndex) => {
      if (displayIndex < 0 || displayIndex >= rowCount) return undefined;
      return rows[indexes[displayIndex]!];
    },
  };
}

/**
 * Materialize an ordered `RowData[]` from a row order.
 *
 * Compatibility helper for external consumers that still need a flat
 * display-order array. The renderer uses `RowView` / `DisplayRowReader`
 * exclusively.
 * Identity order returns the original `rows` reference (no copy).
 */
export function materializeRowOrder(
  rows: RowData[],
  order: RowOrder,
): RowData[] {
  if (order.kind === "identity") return rows;
  const indexes = order.indexes;
  const out = new Array<RowData>(indexes.length);
  for (let i = 0; i < indexes.length; i++) {
    out[i] = rows[indexes[i]!]!;
  }
  return out;
}
