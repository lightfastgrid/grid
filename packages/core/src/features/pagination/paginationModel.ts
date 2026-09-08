/**
 * Client-side pagination model.
 *
 * Pagination is a row-model stage that composes after sorting and
 * before `RowView`:
 *
 *   raw rows -> sorted RowOrder -> paginated RowOrder -> RowView
 *
 * It operates purely on indexes — `paginateRowOrder` slices a
 * `RowOrder` without materializing `RowData[]`. Indexed orders are
 * sliced with `Uint32Array.subarray` (a view, no copy); identity
 * orders allocate one small page-sized index array.
 */

import type { RowOrder } from "../../row-model/rowOrder";
import {
  createIndexedRowOrder,
  getRowOrderLength,
} from "../../row-model/rowOrder";
import type { PaginationState } from "../../types";

export const DEFAULT_PAGINATION_PAGE_SIZE = 100;

export const DEFAULT_PAGINATION_PAGE_SIZE_OPTIONS = [
  25, 50, 100, 250, 500, 1000,
];

/** Coerce a user-provided page size to a positive integer, or `null`. */
export function normalizePageSize(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const size = Math.floor(value);
  return size > 0 ? size : null;
}

/**
 * Resolve the page-size options list: user options (or the defaults),
 * positive integers only, deduplicated, ascending, and always
 * including `pageSize` itself.
 */
export function normalizePageSizeOptions(
  options: number[] | undefined,
  pageSize: number,
): number[] {
  const base =
    options && options.length > 0
      ? options
      : DEFAULT_PAGINATION_PAGE_SIZE_OPTIONS;
  const set = new Set<number>();
  for (const value of base) {
    const size = normalizePageSize(value);
    if (size !== null) set.add(size);
  }
  set.add(pageSize);
  return [...set].sort((a, b) => a - b);
}

/** Number of pages for a row count. Zero rows → zero pages. */
export function computePageCount(totalRows: number, pageSize: number): number {
  return totalRows <= 0 ? 0 : Math.ceil(totalRows / pageSize);
}

/** Clamp a page index into `[0, pageCount - 1]` (0 when no pages). */
export function clampPageIndex(pageIndex: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  return Math.min(Math.max(0, pageIndex), pageCount - 1);
}

/** Derive the full pagination state for the current inputs. */
export function computePaginationState(
  enabled: boolean,
  pageIndex: number,
  pageSize: number,
  totalRows: number,
): PaginationState {
  const pageCount = computePageCount(totalRows, pageSize);
  const clampedIndex = clampPageIndex(pageIndex, pageCount);
  const start = clampedIndex * pageSize;
  const end = Math.min(start + pageSize, totalRows);
  return {
    enabled,
    pageIndex: clampedIndex,
    pageSize,
    pageCount,
    totalRows,
    // One-based for UI; 0 when the page is empty.
    startRow: end > start ? start + 1 : 0,
    endRow: end > start ? end : 0,
  };
}

/**
 * Slice a `RowOrder` to one page. Returns the input order reference
 * unchanged when the page covers all rows (single page / no-op), so
 * downstream `RowView` caching stays stable.
 */
export function paginateRowOrder(
  order: RowOrder,
  pageIndex: number,
  pageSize: number,
): RowOrder {
  const total = getRowOrderLength(order);
  const start = Math.min(pageIndex * pageSize, total);
  const end = Math.min(start + pageSize, total);
  if (start === 0 && end === total) return order;

  if (order.kind === "indexed") {
    // Subarray view over the sorted indexes — no copy.
    return createIndexedRowOrder(order.indexes.subarray(start, end));
  }
  const length = end - start;
  const indexes = new Uint32Array(length);
  for (let i = 0; i < length; i++) indexes[i] = start + i;
  return createIndexedRowOrder(indexes);
}
