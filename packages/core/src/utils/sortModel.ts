import { isInternalColumn } from "../internal/internalColumns";
import type { RowOrder } from "../row-model/rowOrder";
import {
  createIdentityRowOrder,
  createIndexedRowOrder,
  materializeRowOrder,
} from "../row-model/rowOrder";
import type { SortOrderPairCache } from "../row-model/SortOrderCache";
import {
  countNonNull,
  createSortOrderPairCache,
  querySortOrderPairCache,
} from "../row-model/SortOrderCache";
import type { RowValueCache } from "../row-model/value-cache";
import type { ColumnDef, RowData, SortDirection, SortModel, SortModelItem } from "../types";

import { defaultCompare } from "./defaultSortCompare";
import { resolveDotPath } from "./resolveDotPath";

function isValidDirection(d: unknown): d is SortDirection {
  return d === "asc" || d === "desc";
}

export function normalizeSortModel(
  model: SortModel | undefined,
  columns: ColumnDef[],
): SortModel {
  if (!model || model.length === 0) return [];

  const sortableFields = new Set<string>();
  for (const col of columns) {
    if (isInternalColumn(col)) continue;
    if (col.sortable !== false) sortableFields.add(col.field);
  }

  const seen = new Set<string>();
  const result: SortModelItem[] = [];
  for (const item of model) {
    if (!item.field || !isValidDirection(item.sort)) continue;
    if (seen.has(item.field)) continue;
    if (!sortableFields.has(item.field)) continue;
    seen.add(item.field);
    result.push({ field: item.field, sort: item.sort });
  }
  return result;
}

export function sortModelsEqual(a: SortModel, b: SortModel): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.field !== b[i]!.field || a[i]!.sort !== b[i]!.sort) return false;
  }
  return true;
}

interface SortEntry {
  field: string;
  dir: number;
  col: ColumnDef;
  pathParts: string[] | null;
  usesValueGetter: boolean;
  usesComparator: boolean;
}

export function buildSortEntries(
  sortModel: SortModel,
  columns: ColumnDef[],
): SortEntry[] {
  const colByField = new Map<string, ColumnDef>();
  for (const col of columns) colByField.set(col.field, col);

  const entries: SortEntry[] = [];
  for (const item of sortModel) {
    const col = colByField.get(item.field);
    if (!col) continue;
    entries.push({
      field: item.field,
      dir: item.sort === "desc" ? -1 : 1,
      col,
      pathParts: item.field.includes(".") ? item.field.split(".") : null,
      usesValueGetter: !!col.valueGetter,
      usesComparator: !!col.sortComparator,
    });
  }
  return entries;
}

function resolveValue(entry: SortEntry, row: RowData, rowIndex: number): unknown {
  if (entry.usesValueGetter) {
    return entry.col.valueGetter!({ row, rowIndex, field: entry.field, column: entry.col });
  }
  if (entry.pathParts) return resolveDotPath(row, entry.pathParts);
  return row[entry.field];
}

const NULL_SENTINEL = 1;
const NON_NULL = 0;

/**
 * Sort row indexes (not row objects) according to `sortModel`.
 *
 * Returns identity row order when the sort model is empty or contains no
 * resolvable entries — no `Uint32Array` is allocated in that case.
 * Otherwise returns an indexed row order with the display indexes packed
 * into a `Uint32Array`.
 *
 * When a `RowValueCache` is provided (with `rowEpoch`), per-column value
 * extraction is delegated to the cache so repeated sorts for the same
 * rows/epoch/field/valueGetter reuse previously extracted values.
 *
 * Sort semantics (preserved from {@link applySortModel}):
 * - number / boolean / string comparison via {@link defaultCompare}
 * - `null` / `undefined` always sort last (in both asc and desc)
 * - dot-path fields
 * - `valueGetter` (called with the source `rowIndex`)
 * - per-column `sortComparator`
 * - multi-column sort, comparing entries in model order
 * - stable tie-break by original source index
 *
 * Does not mutate `rows`.
 */
export interface ApplySortOptions {
  valueCache?: RowValueCache;
  rowEpoch?: number;
  /** Two-direction pair cache for single-column sort order reuse. */
  sortOrderPairCache?: SortOrderPairCache | null;
  /** Callback to store/replace the pair cache after a full sort or derivation. */
  onSortOrderPairCache?: (cache: SortOrderPairCache) => void;
  /**
   * Upstream source indexes to sort (e.g. from filtering). When provided,
   * only these indexes are sorted; the result is a `Uint32Array` of exactly
   * these source indexes in sorted display order. Pair-cache is skipped
   * when sourceIndexes is present since it caches full-row sorts only.
   */
  sourceIndexes?: Uint32Array;
}

/**
 * Positional `valueCache` / `rowEpoch` args are kept for internal
 * compatibility with callers that pass only the first three args (tests,
 * `applySortModel`, `SortExecution`). New callers should prefer passing
 * everything through `sortOptions`. When `sortOptions.valueCache` /
 * `sortOptions.rowEpoch` are set they take precedence over the positional
 * args.
 */
export function applySortModelToRowOrder(
  rows: RowData[],
  sortModel: SortModel,
  columns: ColumnDef[],
  valueCache?: RowValueCache,
  rowEpoch?: number,
  sortOptions?: ApplySortOptions,
): RowOrder {
  const len = rows.length;
  const srcIndexes = sortOptions?.sourceIndexes;
  const sortLen = srcIndexes ? srcIndexes.length : len;

  if (sortModel.length === 0) {
    if (srcIndexes) return createIndexedRowOrder(new Uint32Array(srcIndexes));
    return createIdentityRowOrder(len);
  }

  const sortEntries = buildSortEntries(sortModel, columns);
  if (sortEntries.length === 0) {
    if (srcIndexes) return createIndexedRowOrder(new Uint32Array(srcIndexes));
    return createIdentityRowOrder(len);
  }

  // Prefer options-bag values; fall back to positional args for compat.
  const effectiveCache = sortOptions?.valueCache ?? valueCache;
  const epoch = sortOptions?.rowEpoch ?? rowEpoch ?? 0;
  const entryCount = sortEntries.length;

  // ── Single-column pair cache (exact hit or group-reverse derivation) ─
  // Pair cache stores full-row sorts only — skip when sorting a subset.
  if (!srcIndexes && entryCount === 1 && sortOptions?.sortOrderPairCache) {
    const entry = sortEntries[0]!;
    if (!entry.usesComparator) {
      const dir: SortDirection = entry.dir === 1 ? "asc" : "desc";
      let cachedValues: readonly unknown[] | null = null;
      if (effectiveCache) {
        cachedValues = effectiveCache.getSortValues(rows, epoch, entry.field, entry.col).values;
      }
      const result = querySortOrderPairCache(
        sortOptions.sortOrderPairCache,
        entry.field,
        dir,
        rows,
        epoch,
        entry.col.valueGetter,
        cachedValues,
      );
      if (result.hit === "exact" || result.hit === "derived") {
        if (result.hit === "derived") {
          sortOptions.onSortOrderPairCache?.(sortOptions.sortOrderPairCache!);
        }
        return result.rowOrder;
      }
    }
  }

  // ── Full sort path ──────────────────────────────────────────────────
  // Precompute values: values[entryIndex][rowIndex] (indexed by source index)
  const values: (readonly unknown[])[] = new Array(entryCount);
  // Precompute null flags: nullFlags[entryIndex][rowIndex]
  const nullFlags: Uint8Array[] = new Array(entryCount);

  for (let e = 0; e < entryCount; e++) {
    const entry = sortEntries[e]!;
    if (effectiveCache) {
      const cached = effectiveCache.getSortValues(rows, epoch, entry.field, entry.col);
      values[e] = cached.values;
      nullFlags[e] = cached.nullFlags;
    } else {
      const vals = new Array<unknown>(len);
      const flags = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        const v = resolveValue(entry, rows[i]!, i);
        vals[i] = v;
        flags[i] = (v === null || v === undefined) ? NULL_SENTINEL : NON_NULL;
      }
      values[e] = vals;
      nullFlags[e] = flags;
    }
  }

  // Sort source indexes. When sourceIndexes is provided, sort only those;
  // otherwise sort all 0..N-1.
  const order = srcIndexes
    ? new Uint32Array(srcIndexes)
    : new Uint32Array(sortLen);
  if (!srcIndexes) {
    for (let i = 0; i < sortLen; i++) order[i] = i;
  }

  order.sort((a, b) => {
    for (let e = 0; e < entryCount; e++) {
      const aNull = nullFlags[e]![a]!;
      const bNull = nullFlags[e]![b]!;
      if (aNull | bNull) {
        if (aNull & bNull) continue;
        return aNull ? 1 : -1;
      }
      const entry = sortEntries[e]!;
      const aVal = values[e]![a];
      const bVal = values[e]![b];
      const cmp = entry.usesComparator
        ? entry.col.sortComparator!(aVal, bVal, rows[a]!, rows[b]!)
        : defaultCompare(aVal, bVal);
      if (cmp !== 0) return cmp * entry.dir;
    }
    return a - b;
  });

  const rowOrder = createIndexedRowOrder(order);

  // Cache single-column sort order in the pair cache for future reuse.
  // Skip when sourceIndexes is present (subset sort) or custom comparator.
  if (!srcIndexes && entryCount === 1 && sortOptions?.onSortOrderPairCache && !sortEntries[0]!.usesComparator) {
    const entry = sortEntries[0]!;
    const dir: SortDirection = entry.dir === 1 ? "asc" : "desc";
    sortOptions.onSortOrderPairCache(createSortOrderPairCache(
      entry.field,
      dir,
      rows,
      epoch,
      entry.col.valueGetter,
      order,
      countNonNull(nullFlags[0]!, order),
      rowOrder,
    ));
  }

  return rowOrder;
}

/**
 * Compatibility wrapper: returns a materialized `RowData[]` in display order.
 *
 * Delegates to {@link applySortModelToRowOrder}. When the resulting order is
 * identity, returns the original `rows` reference (no copy). When the order
 * is indexed, builds a new array by mapping through the index buffer.
 *
 * New callers should prefer {@link applySortModelToRowOrder} directly.
 */
export function applySortModel(
  rows: RowData[],
  sortModel: SortModel,
  columns: ColumnDef[],
): RowData[] {
  const order = applySortModelToRowOrder(rows, sortModel, columns);
  return materializeRowOrder(rows, order);
}

export function toggleSortDirection(
  current: SortDirection | undefined,
): SortDirection | null {
  if (!current) return "asc";
  if (current === "asc") return "desc";
  return null;
}

export interface SortColumnSnapshot {
  field: string;
  sortable: boolean | undefined;
  valueGetter: ColumnDef["valueGetter"];
  sortComparator: ColumnDef["sortComparator"];
}

export function takeSortColumnSnapshot(
  sortModel: SortModel,
  columns: ColumnDef[],
): SortColumnSnapshot[] {
  if (sortModel.length === 0) return [];
  const colByField = new Map<string, ColumnDef>();
  for (const col of columns) colByField.set(col.field, col);

  const result: SortColumnSnapshot[] = [];
  for (const item of sortModel) {
    const col = colByField.get(item.field);
    if (!col) continue;
    result.push({
      field: col.field,
      sortable: col.sortable,
      valueGetter: col.valueGetter,
      sortComparator: col.sortComparator,
    });
  }
  return result;
}

export function sortColumnSnapshotsEqual(
  a: SortColumnSnapshot[],
  b: SortColumnSnapshot[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (
      ai.field !== bi.field ||
      ai.sortable !== bi.sortable ||
      ai.valueGetter !== bi.valueGetter ||
      ai.sortComparator !== bi.sortComparator
    ) return false;
  }
  return true;
}
