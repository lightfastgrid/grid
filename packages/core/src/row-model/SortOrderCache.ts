/**
 * Two-direction sort order cache for single-column sorts.
 *
 * Stores both the ASC and DESC `RowOrder` for one field so repeated
 * asc↔desc toggles are cache hits after the first derivation. The first
 * opposite-direction request derives the order via safe group reversal
 * (O(n)); subsequent toggles return the cached order directly (O(1)).
 *
 * Multi-column sorts and sorts with a custom `sortComparator` bypass this
 * cache entirely. The cache is invalidated when any input (rows ref, row
 * epoch, field, valueGetter) changes.
 */

import type { ColumnDef, RowData, SortDirection } from "../types";
import { valuesCompareEqual } from "../utils/defaultSortCompare";

import type { RowOrder } from "./rowOrder";
import { createIndexedRowOrder } from "./rowOrder";

/** Cached order for one direction (asc or desc). */
export interface CachedDirectionOrder {
  indexes: Uint32Array;
  nonNullCount: number;
  /** Stable `RowOrder` wrapper — reused on exact hits so downstream
   *  `resolveRowView` sees the same reference and avoids generation bumps. */
  rowOrder: RowOrder;
}

/**
 * Pair cache for a single-column sort key. Holds up to two direction
 * orders (asc + desc) that are valid for the same (field, rows, epoch,
 * valueGetter) combination.
 */
export interface SortOrderPairCache {
  field: string;
  rowsRef: RowData[];
  rowEpoch: number;
  valueGetterRef: ColumnDef["valueGetter"] | undefined;
  asc: CachedDirectionOrder | null;
  desc: CachedDirectionOrder | null;
}

/** Result from {@link querySortOrderPairCache}. */
export type SortOrderCacheResult =
  | { hit: "exact"; rowOrder: RowOrder }
  | { hit: "derived"; rowOrder: RowOrder }
  | { hit: "none" };

function pairStampMatches(
  cache: SortOrderPairCache,
  field: string,
  rows: RowData[],
  rowEpoch: number,
  valueGetterRef: ColumnDef["valueGetter"] | undefined,
): boolean {
  return (
    cache.field === field &&
    cache.rowsRef === rows &&
    cache.rowEpoch === rowEpoch &&
    cache.valueGetterRef === valueGetterRef
  );
}

/**
 * Query the pair cache for a single-column sort direction. Returns one of:
 * - `exact` — the requested direction is already cached.
 * - `derived` — the opposite direction was cached; the requested direction
 *   was derived via safe group reversal and stored into the pair cache.
 * - `none` — no usable cache; caller must run the full sort.
 *
 * @param sortValues — cached extracted values indexed by source row index.
 *   Required for group-boundary detection during derivation.
 */
export function querySortOrderPairCache(
  cache: SortOrderPairCache | null,
  field: string,
  direction: SortDirection,
  rows: RowData[],
  rowEpoch: number,
  valueGetterRef: ColumnDef["valueGetter"] | undefined,
  sortValues: readonly unknown[] | null,
): SortOrderCacheResult {
  if (!cache) return { hit: "none" };
  if (!pairStampMatches(cache, field, rows, rowEpoch, valueGetterRef)) {
    return { hit: "none" };
  }

  // Exact hit — requested direction already cached. Returns the stable
  // RowOrder reference so resolveRowView sees identity and skips generation bump.
  const exact = direction === "asc" ? cache.asc : cache.desc;
  if (exact) {
    return { hit: "exact", rowOrder: exact.rowOrder };
  }

  // Try deriving from opposite direction.
  const opposite = direction === "asc" ? cache.desc : cache.asc;
  if (!opposite || !sortValues) return { hit: "none" };

  const derivedIndexes = reverseGroupOrder(opposite.indexes, opposite.nonNullCount, sortValues);
  const derivedRowOrder = createIndexedRowOrder(derivedIndexes);
  const entry: CachedDirectionOrder = {
    indexes: derivedIndexes,
    nonNullCount: opposite.nonNullCount,
    rowOrder: derivedRowOrder,
  };
  // Store into the pair cache for future exact hits.
  if (direction === "asc") {
    cache.asc = entry;
  } else {
    cache.desc = entry;
  }

  return { hit: "derived", rowOrder: derivedRowOrder };
}

/**
 * Create or replace a pair cache entry for a freshly full-sorted direction.
 * Clears the opposite direction (it will be derived on demand).
 */
export function createSortOrderPairCache(
  field: string,
  direction: SortDirection,
  rows: RowData[],
  rowEpoch: number,
  valueGetterRef: ColumnDef["valueGetter"] | undefined,
  indexes: Uint32Array,
  nonNullCount: number,
  rowOrder: RowOrder,
): SortOrderPairCache {
  const entry: CachedDirectionOrder = { indexes, nonNullCount, rowOrder };
  return {
    field,
    rowsRef: rows,
    rowEpoch,
    valueGetterRef,
    asc: direction === "asc" ? entry : null,
    desc: direction === "desc" ? entry : null,
  };
}

/**
 * Reverse equal-value groups in the non-null prefix of a sorted order.
 * Allocates a new `Uint32Array` — the source is never mutated.
 *
 * Groups are identified by the shared default sort comparator equality
 * (`valuesCompareEqual`) so that values which compare equal under the
 * full sort path (e.g. `1` and `"1"`) are kept in the same group.
 * Rows within each group keep their relative order (stable tie ordering).
 * The null segment `[nonNull, len)` is copied unchanged.
 */
export function reverseGroupOrder(
  src: Uint32Array,
  nonNull: number,
  sortValues: readonly unknown[],
): Uint32Array {
  const len = src.length;
  const out = new Uint32Array(len);

  // Collect group start indices.
  const groupStarts: number[] = [0];
  for (let i = 1; i < nonNull; i++) {
    if (!valuesCompareEqual(sortValues[src[i - 1]!], sortValues[src[i]!])) {
      groupStarts.push(i);
    }
  }

  // Emit groups in reverse order, preserving internal row order.
  let writePos = 0;
  for (let g = groupStarts.length - 1; g >= 0; g--) {
    const start = groupStarts[g]!;
    const end = g + 1 < groupStarts.length ? groupStarts[g + 1]! : nonNull;
    for (let i = start; i < end; i++) {
      out[writePos++] = src[i]!;
    }
  }

  // Copy null segment unchanged.
  for (let i = nonNull; i < len; i++) {
    out[i] = src[i]!;
  }

  return out;
}

/**
 * Count the non-null prefix length in a sorted order using the null flags
 * from the sort's value extraction. Because null/undefined always sort
 * last, the non-null rows form a contiguous prefix `[0, nonNullCount)`.
 */
export function countNonNull(nullFlags: Uint8Array, indexes: Uint32Array): number {
  const len = indexes.length;
  let nullCount = 0;
  for (let i = len - 1; i >= 0; i--) {
    if (nullFlags[indexes[i]!]) {
      nullCount++;
    } else {
      break;
    }
  }
  return len - nullCount;
}
