/**
 * Internal row-model cache runtime.
 *
 * Owns all cache instances that accelerate sorting (and later filtering,
 * formulas, quick search, worker execution). `GridState` delegates cache
 * operations here so it never contains cache algorithms, Map eviction
 * logic, or stamp-matching internals.
 *
 * The renderer must not import this module.
 */

import type { SortExecutionContext } from "../execution/operations/sort/sortMainThread";
import type { ColumnDef, RowData, SortDirection, SortModel } from "../types";
import {
  applySortModelToRowOrder,
  buildSortEntries,
} from "../utils/sortModel";

import type { CachedSortResolution } from "./RowModelRuntime.types";
import type { RowOrder } from "./rowOrder";
import { createIdentityRowOrder } from "./rowOrder";
import type { SortOrderPairCache } from "./SortOrderCache";
import { createSortOrderPairCache, querySortOrderPairCache } from "./SortOrderCache";
import { RowValueCache } from "./value-cache";


export class RowModelRuntime {
  /**
   * Shared value cache for sorting (and later filtering/formulas). Reuses
   * extracted per-column values across repeated sorts when the rows
   * reference and row revision are unchanged.
   */
  private readonly valueCache = new RowValueCache();

  /**
   * Two-direction pair cache for single-column asc↔desc sort order reuse.
   * After both directions are cached, toggling is a direct cache hit (O(1)).
   * Cleared when rows change; naturally invalidated by stamp checks when
   * field/valueGetter changes.
   */
  private sortOrderPairCache: SortOrderPairCache | null = null;

  /**
   * Cached identity `RowOrder` keyed by `rawRows` reference. Reused in the
   * no-sort path and the sort-pending fallback so `resolveRowView()` sees a
   * stable reference and avoids bumping the RowView generation.
   */
  private identityOrderCache: { rawRows: RowData[]; order: RowOrder } | null =
    null;

  // ── Identity order ──────────────────────────────────────────────────

  /**
   * Return a stable identity `RowOrder` for `rawRows`. Reuses the cached
   * instance when `rawRows` is the same reference, so downstream
   * `resolveRowView()` sees a stable object and avoids generation bumps.
   */
  getIdentityOrder(rawRows: RowData[]): RowOrder {
    const cached = this.identityOrderCache;
    if (cached && cached.rawRows === rawRows) return cached.order;
    const order = createIdentityRowOrder(rawRows.length);
    this.identityOrderCache = { rawRows, order };
    return order;
  }

  // ── Sort computation ────────────────────────────────────────────────

  /**
   * Run `applySortModelToRowOrder` with full cache wiring (value cache +
   * pair cache). Returns the computed `RowOrder`.
   *
   * This is the single entry point for the synchronous full-sort path.
   * GridState calls this when its own `sortCache` misses.
   */
  computeSortedRowOrder(
    rawRows: RowData[],
    sortModel: SortModel,
    visibleCols: ColumnDef[],
    rowEpoch: number,
    sourceIndexes?: Uint32Array,
  ): RowOrder {
    this.valueCache.setRowContext(rawRows, rowEpoch);
    return applySortModelToRowOrder(
      rawRows,
      sortModel,
      visibleCols,
      this.valueCache,
      rowEpoch,
      {
        valueCache: this.valueCache,
        rowEpoch,
        sortOrderPairCache: this.sortOrderPairCache,
        onSortOrderPairCache: (cache) => { this.sortOrderPairCache = cache; },
        sourceIndexes,
      },
    );
  }

  // ── Pair-cache fast path ────────────────────────────────────────────

  /**
   * Try to resolve the current sort from `SortOrderPairCache` without
   * running a full sort. Returns the cached `RowOrder` on a hit, or
   * `null` when a full sort is required.
   *
   * Used by `Grid.scheduleSortForCurrentState()` (via GridState) so warm
   * large-row single-column asc↔desc toggles can skip async scheduling.
   */
  tryResolveCachedSortOrder(
    rawRows: RowData[],
    sortModel: SortModel,
    visibleCols: ColumnDef[],
    rowEpoch: number,
  ): CachedSortResolution | null {
    if (sortModel.length === 0) return null;
    if (sortModel.length > 1) return null;
    if (!this.sortOrderPairCache) return null;

    const entries = buildSortEntries(sortModel, visibleCols);
    if (entries.length !== 1) return null;
    const entry = entries[0]!;
    if (entry.usesComparator) return null;

    const dir: SortDirection = entry.dir === 1 ? "asc" : "desc";
    this.valueCache.setRowContext(rawRows, rowEpoch);
    const cachedValues = this.valueCache.getSortValues(
      rawRows, rowEpoch, entry.field, entry.col,
    ).values;

    const result = querySortOrderPairCache(
      this.sortOrderPairCache,
      entry.field,
      dir,
      rawRows,
      rowEpoch,
      entry.col.valueGetter,
      cachedValues,
    );
    if (result.hit === "none") return null;

    return { rowOrder: result.rowOrder };
  }

  // ── Async sort context ──────────────────────────────────────────────

  /**
   * Build a sort execution context that shares `RowValueCache` and
   * `SortOrderPairCache` with the synchronous path. The async sort
   * execution path uses this so cache hits can resolve immediately
   * and full-sort results are stored back into the same pair cache.
   */
  getSortExecutionContext(
    rawRows: RowData[],
    rowEpoch: number,
  ): SortExecutionContext {
    this.valueCache.setRowContext(rawRows, rowEpoch);
    return {
      valueCache: this.valueCache,
      rowEpoch,
      sortOrderPairCache: this.sortOrderPairCache,
      onSortOrderPairCache: (cache) => { this.sortOrderPairCache = cache; },
    };
  }

  // ── Worker sort pair-cache recording ─────────────────────────────────

  /**
   * Record a worker-produced sort order into the `SortOrderPairCache` so
   * subsequent single-column ASC↔DESC toggles can resolve from cache.
   *
   * Only records for single-column sorts where the column has no
   * `valueGetter` — the same conditions under which the main-thread
   * sort path populates the pair cache.
   *
   * `indexes` is the `Uint32Array` returned by the worker; `rowOrder`
   * is the already-created `RowOrder` wrapper.
   *
   * Call chain: `GridExecutionService` completes the worker sort →
   * `Grid`'s completion handler calls `GridState.recordWorkerSortOrder`
   * → `GridState` delegates here. This keeps pair-cache knowledge
   * inside `RowModelRuntime` rather than leaking internals into the
   * execution or Grid layer.
   */
  recordWorkerSortOrder(
    rawRows: RowData[],
    sortModel: SortModel,
    visibleCols: ColumnDef[],
    rowEpoch: number,
    indexes: Uint32Array,
    rowOrder: RowOrder,
  ): void {
    // Only single-column built-in sorts populate the pair cache.
    if (sortModel.length !== 1) return;

    const entries = buildSortEntries(sortModel, visibleCols);
    if (entries.length !== 1) return;

    const entry = entries[0]!;
    // valueGetter and custom comparator sorts are not eligible for
    // worker sort, but guard defensively.
    if (entry.usesValueGetter || entry.usesComparator) return;

    const dir: SortDirection = entry.dir === 1 ? "asc" : "desc";

    // Count non-null values using the raw rows and field directly.
    // This avoids depending on RowValueCache null flags that the
    // worker path did not populate.
    let nonNullCount = 0;
    for (let i = indexes.length - 1; i >= 0; i--) {
      const v = entry.pathParts
        ? this.resolveDotPath(rawRows[indexes[i]!]!, entry.pathParts)
        : rawRows[indexes[i]!]![entry.field];
      if (v !== null && v !== undefined) {
        nonNullCount = i + 1;
        break;
      }
    }

    this.sortOrderPairCache = createSortOrderPairCache(
      entry.field,
      dir,
      rawRows,
      rowEpoch,
      undefined, // no valueGetter — worker sorts only eligible for built-in fields
      indexes,
      nonNullCount,
      rowOrder,
    );
  }

  private resolveDotPath(row: RowData, parts: string[]): unknown {
    let current: unknown = row;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  // ── Invalidation ────────────────────────────────────────────────────

  /**
   * Called when the source rows change (`setRows`). Clears pair cache
   * and identity order cache so stale references are not retained.
   */
  onRowsChanged(): void {
    this.valueCache.clear();
    this.sortOrderPairCache = null;
    // identityOrderCache invalidates naturally via rawRows ref check,
    // but clearing it eagerly avoids retaining the old rows array.
    this.identityOrderCache = null;
  }

  /**
   * Selective invalidation for update-only transactions. Clears value
   * cache entries for dirty fields only, preserving entries for
   * untouched fields. Identity order cache is cleared since the rows
   * reference changed (COW).
   *
   * The sort pair cache is also cleared unconditionally. It could be
   * rebased when dirty fields don't touch the cached sort column, but
   * the pair cache only accelerates single-column asc↔desc toggles and
   * is rebuilt on the next sort — the cost of clearing is one extra
   * O(n) sort on the next toggle, which is acceptable for Phase 2.
   * The primary sort order and value cache are the high-value targets.
   */
  onRowsUpdated(dirtyFields: ReadonlySet<string>): void {
    this.valueCache.invalidateFields(dirtyFields);
    this.sortOrderPairCache = null;
    this.identityOrderCache = null;
  }

  /**
   * Rebase the value cache's rows reference after a COW clone that did
   * not change row order or length. Surviving cache entries (those not
   * cleared by a prior `invalidateFields`) get their stamp updated so
   * subsequent `getSortValues` calls see the new reference and hit cache.
   */
  rebaseRowsRef(rows: RowData[]): void {
    this.valueCache.rebaseRowsRef(rows);
  }
}
