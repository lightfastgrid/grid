import type { SortOperationCache } from '../execution/operations/sort';
import type { SortExecutionContext } from '../execution/operations/sort/sortMainThread';
import {
  rowIndexExecutionResultToRowOrder,
  rowOrderToRowIndexExecutionResult,
} from '../execution/operations/types';
import { isColumnGroupHeadersEnabled } from '../features/column-groups/columnGroupHeadersConfig';
import { deriveColumnGroupHeaderSnapshot } from '../features/column-groups/deriveColumnGroupHeaderSnapshot';
import { flattenColumnInput } from '../features/column-groups/flattenColumnInput';
import { resolveColumnFilterable } from '../features/filters/filterColumnEligibility';
import { cloneColumnFilterModel, cloneFilterModel, filterModelsEqual } from '../features/filters/filterModelEquality';
import {
  computePaginationState,
  DEFAULT_PAGINATION_PAGE_SIZE,
  normalizePageSize,
  normalizePageSizeOptions,
  paginateRowOrder,
} from '../features/pagination';
import {
  isQuickFilterActive,
  isQuickFilterEnabled,
} from '../features/quick-search/quickFilterConfig';
import { quickFilterDependencyOptionsEqual, quickFilterOptionsEqual } from '../features/quick-search/quickFilterOptionsEquality';
import type { QuickSearchDependencyPlan } from '../features/quick-search/quickSearchDependencyPlan';
import { buildQuickSearchDependencyPlan } from '../features/quick-search/quickSearchDependencyPlan';
import { analyzeQuickSearchDirtyImpact } from '../features/quick-search/quickSearchDirtyImpact';
import {
  QuickSearchDirtySourceAccumulator,
  type QuickSearchDirtySourceSnapshot,
  type QuickSearchDirtyTransferSnapshot,
} from '../features/quick-search/quickSearchDirtySourceAccumulator';
import {
  type QuickSearchLayoutSnapshot,
  remapRowOrderByRowIds,
} from '../features/quick-search/quickSearchRowOrderRemap';
import type { GetRowClass, RowClassRules } from '../features/row-styling';
import {
  clampColumnWidth,
  isColumnResizable,
} from '../internal/columnSizing';
import { isInternalColumn } from '../internal/internalColumns';
import {
  captureKeyedMembership,
  type ImmutableKeyedMembership,
} from '../internal/readSnapshots';
import { RowModelRuntime } from '../row-model/RowModelRuntime';
import type { SortCache } from '../row-model/RowModelRuntime.types';
import type { RowOrder, RowView } from '../row-model/rowOrder';
import { createRowView, getRowOrderLength } from '../row-model/rowOrder';
import { didAnyDirtyFieldTouch } from '../row-model/store/dirtyFieldUtils';
import { RowStore } from '../row-model/store/RowStore';
import type {
  RowStoreBatchOutcome,
  RowStoreCommitOutcome,
  RowStoreDirtyMetadata,
} from '../row-model/store/RowStore.types';
import type {
  ResolveTransactionRowId,
  RowDataTransaction,
} from '../row-model/transactions/types';
import type {
  ColumnDef,
  ColumnFilterModel,
  ColumnGroupHeadersOptions,
  ColumnGroupPathMeta,
  ColumnOrderConfig,
  ColumnOrderProp,
  ColumnPinChange,
  ColumnPinState,
  ColumnSelectionConfig,
  ColumnSelectionProp,
  ColumnVisibilityChange,
  ColumnVisibilityState,
  FilterModel,
  FloatingFiltersOptions,
  GridOptions,
  GridOverlayKind,
  GridOverlaysOptions,
  GridPaginationSnapshot,
  GridSnapshot,
  LightFastGridColDef,
  LightFastGridColumnInput,
  LightFastGridDefaultColDef,
  PaginationState,
  QuickFilterOptions,
  RowData,
  RowDragNormalizedConfig,
  RowDragProp,
  RowPinChange,
  RowPinningProp,
  RowPinPosition,
  RowPinStateEntry,
  RowSelectionConfig,
  RowSelectionProp,
  SortModel,
} from '../types';
import {
  columnOrderConfigsEqual,
  normalizeColumnOrder,
} from '../utils/columnOrderConfig';
import {
  columnSelectionConfigsEqual,
  normalizeColumnSelection,
} from '../utils/columnSelectionConfig';
import { resolveMergedColumnVisibility } from '../utils/columnVisibility';
import {
  normalizeRowDrag,
  rowDragConfigsEqual,
} from '../utils/rowDragConfig';
import {
  normalizeRowSelection,
  rowSelectionConfigsEqual,
} from '../utils/rowSelectionConfig';
import {
  buildSortEntries,
  normalizeSortModel,
  sortColumnSnapshotsEqual,
  sortModelsEqual,
  takeSortColumnSnapshot,
} from '../utils/sortModel';

import {
  batchSetColumnWidths,
  buildBaselineWidths,
  computePinStateChanges,
  computeVisibilityChanges,
  isColumnEffectivelyVisible,
  pruneRuntimeVisibility,
  resetColumnWidthsToBaseline,
} from './columnStateHelpers';
import { defaultColDefsEqual } from './defaultColDefEquality';
import type { GridReadSnapshot } from './GridReadSnapshot';

const noopResolveId: ResolveTransactionRowId = () => null;

/**
 * State facade — canonical source of truth for columns, rows, and
 * configuration. Coordinates state reads/writes but does not own
 * feature-controller logic, DOM/rendering, or row-model cache internals.
 *
 * Row storage is owned by {@link RowStore} which provides a persistent
 * id index and copy-on-write semantics. `setRows` stores the caller's
 * array by reference (borrowed, never mutated). Transactions that update
 * rows in place clone the array first (copy-on-write) so external inputs
 * are never modified.
 */
export class GridState {
  // ── Source schema fields ───────────────────────────────────────────
  /** Flat leaf column defs (extracted from possibly-nested input). */
  private columns: LightFastGridColDef[] | undefined;
  private readonly store = new RowStore();
  private defaultColDef: LightFastGridDefaultColDef | undefined;

  // ── Column group metadata ─────────────────────────────────────────
  /** Group path metadata for ALL leaves (including hidden). Empty for flat input. */
  private allColumnGroupMeta: Record<string, ColumnGroupPathMeta> = {};

  // ── Column runtime fields ─────────────────────────────────────────
  private runtimeColumnVisibility = new Map<string, boolean>();
  /** Baseline column widths from the last setColumns/constructor call. */
  private baselineWidths = new Map<string, number | undefined>();

  // ── Interaction config fields ─────────────────────────────────────
  private rowSelection: RowSelectionConfig;
  private columnSelection: ColumnSelectionConfig;
  private columnOrder: ColumnOrderConfig;
  private rowDrag: RowDragNormalizedConfig;

  // ── Row-model / sort / cache fields ────────────────────────────────
  // Sort cache and RowView runtime internals are owned by `row-model/`;
  // fields here are the facade's coordination handles into that subsystem.
  private sortModel: SortModel = [];
  private sortCache: SortCache | null = null;
  private sortPending = false;
  // Async sort result waiting to be promoted into `sortCache`. Stored as a
  // `RowOrder` — materialization is deferred to the snapshot getter.
  private asyncSortedRowOrder: RowOrder | null = null;
  private pendingSortFallback: { rawRows: RowData[]; rowOrder: RowOrder } | null = null;
  private readonly rowModelRuntime = new RowModelRuntime();
  // Bumps only when source rows reference changes (`setRows`), not on
  // sort/selection/width changes. Lets `RowValueCache` survive unrelated updates.
  private rowRevision = 0;
  // RowView built lazily in `getSnapshot()` from (rawRows, rowOrder).
  // Generation bumps when either input reference changes.
  private rowViewCache: {
    rawRows: RowData[];
    rowOrder: RowOrder;
    view: RowView;
  } | null = null;
  // Unpaginated view over the same sorted order — the selection/feature
  // "universe" when pagination is active. Separate cache slot so the
  // paginated rowView cache is not thrashed.
  private fullRowViewCache: {
    rawRows: RowData[];
    rowOrder: RowOrder;
    view: RowView;
  } | null = null;
  private rowViewGeneration = 0;

  // ── Row styling fields ────────────────────────────────────────────
  // `rowStylingVersion` bumps only when an input changes; the renderer uses
  // it to invalidate per-row class without forcing a full cell rebind.
  private rowClass: string | string[] | undefined;
  private getRowClass: GetRowClass | undefined;
  private rowClassRules: RowClassRules | undefined;
  private rowStylingVersion = 0;

  // ── Overlay fields ────────────────────────────────────────────────
  private loading = false;
  private manualOverlay: GridOverlayKind | null = null;
  private overlays: GridOverlaysOptions | undefined;
  private floatingFilters: boolean | FloatingFiltersOptions | undefined;
  /**
   * Display config for group header rows (not the derived snapshot).
   * Default undefined = enabled when group metadata exists.
   */
  private columnGroupHeadersConfig:
    | boolean
    | ColumnGroupHeadersOptions
    | undefined;

  // ── Pagination fields ─────────────────────────────────────────────
  // Pagination is a row-model stage: sorted RowOrder → paginated
  // RowOrder → RowView. `pageIndex` is zero-based and clamped lazily
  // against the current row count.
  private paginationEnabled = false;
  private pageIndex = 0;
  private pageSize = DEFAULT_PAGINATION_PAGE_SIZE;
  private pageSizeOptions: number[] = [];
  // Paginated slice of the sorted order, cached by inputs so the
  // RowView cache (keyed by order reference) stays stable.
  private paginatedOrderCache: {
    baseOrder: RowOrder;
    pageIndex: number;
    pageSize: number;
    order: RowOrder;
  } | null = null;

  // ── Row pinning fields ────────────────────────────────────────────
  // Insertion-ordered Map for deterministic iteration; visual order follows
  // current data order, not insertion order.
  private rowPinned: Map<string, RowPinPosition> = new Map();
  private rowPinnedShared = false;

  // ── Filter state fields ─────────────────────────────────────────────
  private filterModel: FilterModel = {};
  private filterCache: {
    rawRows: RowData[];
    filterModel: FilterModel;
    filterConfigVersion: number;
    rowOrder: RowOrder;
  } | null = null;
  private filterPending = false;
  private asyncFilteredRowOrder: RowOrder | null = null;
  private pendingFilterFallback: { rawRows: RowData[]; rowOrder: RowOrder } | null = null;
  private _needsFilterSchedule = false;
  private filterConfigVersion = 0;
  private filteredOrderVersion = 0;

  // ── Quick filter / quick search state ─────────────────────────────
  private quickFilterText = "";
  private quickFilter: boolean | QuickFilterOptions | undefined;
  private quickSearchPending = false;
  private quickSearchCache: {
    rawRows: RowData[];
    quickFilterText: string;
    searchableFieldsSignature: string;
    searchableFieldsVersion: number;
    filterModel: FilterModel;
    filterConfigVersion: number;
    filteredOrder: RowOrder;
    rowOrder: RowOrder;
  } | null = null;
  private asyncQuickSearchRowOrder: RowOrder | null = null;
  private pendingQuickSearchFallback: { rawRows: RowData[]; rowOrder: RowOrder } | null = null;
  private quickSearchFieldsVersion = 0;
  private _quickSearchDependencyPlan!: QuickSearchDependencyPlan;
  private _quickSearchDependencyPlanReady = false;
  /** Monotonic searchable/projection content revision for this GridState lifetime. */
  private searchableDataRevision = 0;
  private readonly quickSearchDirtySources = new QuickSearchDirtySourceAccumulator();
  private _needsQuickSearchSchedule = false;

  // ── Transaction invalidation signal ────────────────────────────────
  // Set by `invalidateAfterTransaction` / `setRows`; read by Grid to
  // decide whether `scheduleSortForCurrentState` is needed.
  private _needsSortSchedule = true;

  // ── Render change metadata ─────────────────────────────────────────
  // Accumulated during update-only transactions between renders. Consumed
  // and cleared in `consumeRenderChangeSetForRender()`. Null means "no
  // selective metadata" (full refresh). A Map means "only these rows/fields
  // changed". `_dirtyRowsRevision` stamps the revision at which metadata
  // was last set — if any other code path bumps `revision` afterwards, the
  // metadata becomes stale and `consumeRenderChangeSetForRender()` ignores it.
  private _pendingDirtyRows: Map<string, ReadonlySet<string>> | null = null;
  private _dirtyRowsRevision = -1;

  // ── General revision counter ──────────────────────────────────────
  private revision = 0;

  // ═══════════════════════════════════════════════════════════════════
  // §1  Source Data / Schema
  // ═══════════════════════════════════════════════════════════════════

  constructor(props: GridOptions) {
    this.applyColumnInput(props.columns);
    this.baselineWidths = buildBaselineWidths(this.columns);
    if (props.rows) {
      const initResolver: ResolveTransactionRowId = props.getRowId
        ? (row) => {
            const raw = props.getRowId!(row);
            return raw === null || raw === undefined || raw === ""
              ? null
              : String(raw);
          }
        : noopResolveId;
      this.store.replaceAll(props.rows, initResolver);
    }
    this.defaultColDef = props.defaultColDef;
    this.rowSelection = normalizeRowSelection(props.rowSelection);
    this.columnSelection = normalizeColumnSelection(props.columnSelection);
    this.columnOrder = normalizeColumnOrder(props.columnOrder);
    this.rowDrag = normalizeRowDrag(props.rowDrag);
    this.rowClass = props.rowClass;
    this.getRowClass = props.getRowClass;
    this.rowClassRules = props.rowClassRules;
    this.loading = props.loading ?? false;
    this.overlays = props.overlays;
    this.floatingFilters = props.floatingFilters;
    this.columnGroupHeadersConfig = props.columnGroupHeaders;
    this.initializeRowPinning(props.rowPinning);
    this.paginationEnabled = props.pagination === true;
    this.pageSize =
      normalizePageSize(props.paginationPageSize) ?? DEFAULT_PAGINATION_PAGE_SIZE;
    this.pageSizeOptions = normalizePageSizeOptions(
      props.paginationPageSizeOptions,
      this.pageSize,
    );
    if (props.initialSortModel) {
      const visibleCols = this.getVisibleColumnDefs();
      this.sortModel = normalizeSortModel(props.initialSortModel, visibleCols);
    }
    if (props.quickFilterText) {
      this.quickFilterText = props.quickFilterText;
    }
    this.quickFilter = props.quickFilter;
    this.rebuildQuickSearchDependencyPlan();
  }

  /**
   * Whether the last transaction invalidated the sort order and the
   * caller should schedule sort work. `false` when an update-only
   * transaction's dirty fields did not touch any active sort column.
   */
  get needsSortSchedule(): boolean {
    return this._needsSortSchedule;
  }

  get needsFilterSchedule(): boolean {
    return this._needsFilterSchedule;
  }

  get needsQuickSearchSchedule(): boolean {
    return this._needsQuickSearchSchedule;
  }

  setRows(rows: RowData[], resolveId?: ResolveTransactionRowId): void {
    this.store.replaceAll(rows, resolveId ?? noopResolveId);
    // Source rows changed — any pending async results are stale.
    this.asyncSortedRowOrder = null;
    this.asyncFilteredRowOrder = null;
    this.pendingSortFallback = null;
    this.pendingFilterFallback = null;
    this.filterCache = null;
    this.asyncQuickSearchRowOrder = null;
    this.quickSearchCache = null;
    this.pendingQuickSearchFallback = null;
    // Prior source indexes are invalid after a full replace.
    this.quickSearchDirtySources.clear();
    if (this.isQuickFilterPresent()) {
      this._needsQuickSearchSchedule = true;
    } else {
      this._needsQuickSearchSchedule = false;
    }
    this.rowModelRuntime.onRowsChanged();
    this.revision++;
    this.rowRevision++;
    this._needsSortSchedule = true;
    this._needsFilterSchedule = this.hasActiveFilters();
  }

  setColumns(columns: LightFastGridColumnInput[]): void {
    this.applyColumnInput(columns);
    const leafCols = this.columns ?? [];
    this.baselineWidths = buildBaselineWidths(this.columns);
    pruneRuntimeVisibility(this.runtimeColumnVisibility, leafCols);
    this.filterConfigVersion++;
    this.quickSearchFieldsVersion++;
    this.rebuildQuickSearchDependencyPlan();
    this.invalidateFilterCache();
    this.invalidateQuickSearchAfterFieldsChanged();
    this.revision++;
  }

  /**
   * Extract flat leaf columns and group metadata from possibly-nested input.
   * Called by constructor and setColumns.
   */
  private applyColumnInput(
    input: LightFastGridColumnInput[] | undefined,
  ): void {
    if (!input || input.length === 0) {
      this.columns = input?.length === 0 ? [] : undefined;
      this.allColumnGroupMeta = {};
      return;
    }
    const { leafColumns, groupMetaByField } = flattenColumnInput(input);
    this.columns = leafColumns;
    this.allColumnGroupMeta = groupMetaByField;
  }

  setDefaultColDef(defaultColDef: LightFastGridDefaultColDef | undefined): boolean {
    if (defaultColDefsEqual(this.defaultColDef, defaultColDef)) return false;
    this.defaultColDef = defaultColDef;
    this.filterConfigVersion++;
    this.quickSearchFieldsVersion++;
    this.rebuildQuickSearchDependencyPlan();
    this.invalidateFilterCache();
    this.invalidateQuickSearchAfterFieldsChanged();
    this.revision++;
    return true;
  }

  /** Current row array reference (read-only use; do not mutate in place). */
  getRows(): RowData[] {
    return this.store.sourceRows;
  }

  getRowCount(): number {
    return this.store.rowCount;
  }

  getColumnDefs(): readonly LightFastGridColDef[] {
    return this.columns ?? [];
  }

  getDefaultColDef(): LightFastGridDefaultColDef | undefined {
    return this.defaultColDef;
  }

  // ── Row-data transactions (RowStore delegation) ───────────────────

  replaceRowAtSourceIndex(
    sourceIndex: number,
    newRow: RowData,
    resolveId: ResolveTransactionRowId,
  ): RowStoreCommitOutcome {
    const outcome = this.store.replaceRowAtSourceIndex(sourceIndex, newRow, resolveId);
    if (outcome.changed) {
      this.invalidateAfterTransaction(outcome.dirty, outcome.structural);
    }
    return outcome;
  }

  /**
   * Apply a single transaction through the persistent RowStore.
   * Returns commit outcome with explicit `changed` / `structural` flags.
   */
  applyStoreTransaction(
    txn: RowDataTransaction,
    resolveId: ResolveTransactionRowId,
  ): RowStoreCommitOutcome {
    const layoutSnapshot = this.captureQuickSearchLayoutSnapshot();
    const outcome = this.store.applyTransaction(txn, resolveId);
    if (outcome.changed) {
      this.invalidateAfterTransaction(
        outcome.dirty,
        outcome.structural,
        outcome.structural ? layoutSnapshot : null,
      );
    }
    return outcome;
  }

  /**
   * Apply a batch of transactions through the persistent RowStore.
   * Returns batch outcome with merged dirty metadata.
   */
  applyStoreTransactionBatch(
    txns: RowDataTransaction[],
    resolveId: ResolveTransactionRowId,
  ): RowStoreBatchOutcome {
    const layoutSnapshot = this.captureQuickSearchLayoutSnapshot();
    const outcome = this.store.applyTransactionBatch(txns, resolveId);
    if (outcome.changed) {
      this.invalidateAfterTransaction(
        outcome.dirty,
        outcome.structural,
        outcome.structural ? layoutSnapshot : null,
      );
    }
    return outcome;
  }

  /**
   * Selective cache/sort invalidation after a transaction.
   *
   * Structural transactions (add/remove): full invalidation.
   * Update-only transactions: invalidate only dirty fields in value
   * cache; preserve sort cache when dirty fields don't touch sort columns.
   * When sort survives, rebases cache references to the (possibly COW'd)
   * rows array so downstream cache-key checks still hit.
   */
  private invalidateAfterTransaction(
    dirty: RowStoreDirtyMetadata,
    structural: boolean,
    layoutSnapshot: QuickSearchLayoutSnapshot | null = null,
  ): void {
    this.revision++;
    this._needsSortSchedule = true;

    if (structural) {
      this.invalidateAfterSourceRowLayoutChanged(layoutSnapshot);
      this.clearPendingDirtyRows();
      return;
    }

    // Update-only path: selective invalidation.
    const allDirtyFields = this.collectDirtyFields(dirty);
    const quickFilterEnabled = isQuickFilterEnabled(this.quickFilter);
    // Disabled hot path: no analyzer, revision bump, or accumulator work.
    let searchableTouched = false;
    if (quickFilterEnabled) {
      const impact = analyzeQuickSearchDirtyImpact(
        this._quickSearchDependencyPlan,
        dirty,
      );
      searchableTouched = impact.touched;
      if (searchableTouched) {
        this.searchableDataRevision++;
        this.quickSearchDirtySources.record(
          impact.sourceIndexes,
          impact.sourceIndexCoverageComplete,
        );
      }
    }
    const filterTouched = this.doDirtyFieldsTouchFilter(dirty);
    const quickSearchActive = this.isQuickFilterPresent();
    const quickSearchNeedsRun =
      quickSearchActive && (searchableTouched || filterTouched);

    if (allDirtyFields.size === 0) {
      // Rows updated but no field-level diff (same values, new objects).
      // Conservative: full invalidation for sort/filter/render.
      this._needsFilterSchedule = this.hasActiveFilters();
      this.asyncFilteredRowOrder = null;
      this.pendingFilterFallback = null;
      this.filterCache = null;
      this.asyncSortedRowOrder = null;
      this.pendingSortFallback = null;
      this.rowModelRuntime.onRowsChanged();
      this.sortCache = null;
      this.rowRevision++;
      // Incomplete field metadata must not leave an active quick search stale.
      if (quickSearchNeedsRun) {
        this.captureQuickSearchFallback();
        this.asyncQuickSearchRowOrder = null;
        this.quickSearchCache = null;
        this._needsQuickSearchSchedule = true;
      }
      this.clearPendingDirtyRows();
      return;
    }

    // Selective value cache invalidation (dirty entries evicted).
    this.rowModelRuntime.onRowsUpdated(allDirtyFields);

    const currentRows = this.store.sourceRows;

    if (filterTouched) {
      this._needsFilterSchedule = true;
      this.captureFilterFallback();
      this.asyncFilteredRowOrder = null;
      this.rebaseFilterCacheRowsRef(currentRows);
      if (this.pendingFilterFallback) {
        this.pendingFilterFallback = { ...this.pendingFilterFallback, rawRows: currentRows };
      }
    } else {
      this._needsFilterSchedule = false;
      this.rebaseFilterCacheRowsRef(currentRows);
      if (this.pendingFilterFallback) {
        this.pendingFilterFallback = { ...this.pendingFilterFallback, rawRows: currentRows };
      }
    }

    if (quickSearchNeedsRun) {
      this.captureQuickSearchFallback();
      this.asyncQuickSearchRowOrder = null;
      this.quickSearchCache = null;
      this._needsQuickSearchSchedule = true;
      this.captureSortFallback();
      this.asyncSortedRowOrder = null;
      this.sortCache = null;
      this._needsSortSchedule = true;
      if (filterTouched) {
        this.clearPendingDirtyRows();
      } else {
        this.accumulateDirtyRows(dirty);
      }
      return;
    }

    if (quickSearchActive) {
      this.rebaseQuickSearchCacheRowsRef(currentRows);
      this._needsQuickSearchSchedule = false;
      if (this.pendingQuickSearchFallback) {
        this.pendingQuickSearchFallback = {
          ...this.pendingQuickSearchFallback,
          rawRows: currentRows,
        };
      }
    }

    if (this.sortModel.length === 0) {
      // No active sort — rebase value cache refs for future sorts and
      // skip sort scheduling entirely.
      this.asyncSortedRowOrder = null;
      this.rowModelRuntime.rebaseRowsRef(currentRows);
      this._needsSortSchedule = false;
      if (filterTouched) {
        this.clearPendingDirtyRows();
      } else {
        this.accumulateDirtyRows(dirty);
      }
      return;
    }

    // A valid sort order exists if either sortCache or a pending
    // asyncSortedRowOrder is present (the latter hasn't been promoted
    // to sortCache because no getSnapshot ran since the sort completed).
    const hasSortOrder = this.sortCache !== null || this.asyncSortedRowOrder !== null;

    if (hasSortOrder && !this.doDirtyFieldsTouchSort(dirty)) {
      // Sort order survives. Rebase caches to the (possibly COW'd)
      // rows reference so downstream ref checks hit.
      if (this.sortCache) {
        this.sortCache = { ...this.sortCache, rawRows: currentRows };
      }
      if (this.pendingSortFallback) {
        this.pendingSortFallback = { ...this.pendingSortFallback, rawRows: currentRows };
      }
      // asyncSortedRowOrder (if present) contains a RowOrder with
      // indexes — those remain valid since row order/length are unchanged.
      this.rowModelRuntime.rebaseRowsRef(currentRows);
      this._needsSortSchedule = false;
      if (filterTouched) {
        this.clearPendingDirtyRows();
      } else {
        this.accumulateDirtyRows(dirty);
      }
    } else {
      // Sort touched or no sort order to preserve — full invalidation.
      this.captureSortFallback();
      this.asyncSortedRowOrder = null;
      this.sortCache = null;
      this.rowRevision++;
      this.clearPendingDirtyRows();
    }
  }

  private accumulateDirtyRows(dirty: RowStoreDirtyMetadata): void {
    const prevValid =
      this._pendingDirtyRows !== null &&
      this._dirtyRowsRevision === this.revision - 1;
    const base = prevValid ? this._pendingDirtyRows! : new Map<string, ReadonlySet<string>>();
    for (const [rowId, fields] of dirty.dirtyFieldsByRowId) {
      const existing = base.get(rowId);
      if (existing) {
        const merged = new Set(existing);
        for (const f of fields) merged.add(f);
        base.set(rowId, merged);
      } else {
        base.set(rowId, fields);
      }
    }
    this._pendingDirtyRows = base;
    this._dirtyRowsRevision = this.revision;
  }

  private clearPendingDirtyRows(): void {
    this._pendingDirtyRows = null;
    this._dirtyRowsRevision = -1;
  }

  /**
   * Consume pending render change metadata for the render path.
   *
   * Separated from `getSnapshot()` so that non-render snapshot
   * consumers (e.g. `onRowDataUpdated` callback calling a public API)
   * do not accidentally drain the metadata before the scheduled
   * renderer reads it.
   */
  consumeRenderChangeSetForRender(): ReadonlyMap<string, ReadonlySet<string>> | undefined {
    const changed =
      this._dirtyRowsRevision === this.revision
        ? this._pendingDirtyRows ?? undefined
        : undefined;
    this._pendingDirtyRows = null;
    this._dirtyRowsRevision = -1;
    return changed;
  }

  private collectDirtyFields(dirty: RowStoreDirtyMetadata): ReadonlySet<string> {
    if (dirty.dirtyFieldsByRowId.size === 0) return new Set();
    if (dirty.dirtyFieldsByRowId.size === 1) {
      return dirty.dirtyFieldsByRowId.values().next().value as ReadonlySet<string>;
    }
    const all = new Set<string>();
    for (const [, fields] of dirty.dirtyFieldsByRowId) {
      for (const f of fields) all.add(f);
    }
    return all;
  }

  /**
   * Check if any dirty field could affect the current sort order.
   * Conservative: returns true if any sort column uses valueGetter or
   * custom comparator (we can't statically know what fields they read).
   * Delegates dot-path and prefix matching to `didAnyDirtyFieldTouch`.
   */
  private doDirtyFieldsTouchSort(dirty: RowStoreDirtyMetadata): boolean {
    const visibleCols = this.getVisibleColumnDefs();
    const entries = buildSortEntries(this.sortModel, visibleCols);

    // valueGetter/comparator sorts read arbitrary fields — conservative.
    for (const entry of entries) {
      if (entry.usesValueGetter || entry.usesComparator) return true;
    }

    // Build the set of plain sort field paths and check via utility.
    const sortFields = new Set<string>();
    for (const entry of entries) {
      sortFields.add(entry.field);
    }
    return didAnyDirtyFieldTouch(sortFields, dirty);
  }

  /**
   * Check if any dirty field could affect the active filter result.
   * Delegates dot-path and prefix matching to `didAnyDirtyFieldTouch`,
   * so dirty top-level `user` touches active filter field `user.name`.
   */
  private doDirtyFieldsTouchFilter(dirty: RowStoreDirtyMetadata): boolean {
    const filterFields = Object.keys(this.filterModel);
    if (filterFields.length === 0) return false;
    return didAnyDirtyFieldTouch(filterFields, dirty);
  }

  private getSearchableFieldsSignature(): string {
    return this._quickSearchDependencyPlan.fieldsSignature;
  }

  getQuickSearchDependencyPlan(): QuickSearchDependencyPlan {
    return this._quickSearchDependencyPlan;
  }

  private rebuildQuickSearchDependencyPlan(): void {
    const next = buildQuickSearchDependencyPlan(
      this.getAllEffectiveColumnDefs(),
      this.quickFilter,
    );

    // Clear retained dirty deltas only when worker snapshot identity changes:
    // fields/normalizer signatures (including disable → sf|disabled).
    // Plan rebuild alone (e.g. parser/matcher → workerSafe) does not clear.
    if (
      this._quickSearchDependencyPlanReady &&
      (next.fieldsSignature !== this._quickSearchDependencyPlan.fieldsSignature ||
        next.normalizerSignature !== this._quickSearchDependencyPlan.normalizerSignature)
    ) {
      this.quickSearchDirtySources.clear();
    }

    this._quickSearchDependencyPlan = next;
    this._quickSearchDependencyPlanReady = true;
  }

  /**
   * Row add/remove/reorder changed source-index layout. Drop index-keyed
   * caches and remap any active quick-search fallback by stable row id.
   */
  private invalidateAfterSourceRowLayoutChanged(
    layoutSnapshot: QuickSearchLayoutSnapshot | null = null,
  ): void {
    this._needsFilterSchedule = this.hasActiveFilters();
    this._needsSortSchedule = true;
    this.asyncFilteredRowOrder = null;
    this.pendingFilterFallback = null;
    this.filterCache = null;
    this.filteredOrderVersion++;
    this.asyncSortedRowOrder = null;
    this.pendingSortFallback = null;
    this.rowModelRuntime.onRowsChanged();
    this.sortCache = null;
    this.rowRevision++;
    this.asyncQuickSearchRowOrder = null;
    this.quickSearchCache = null;
    this.pendingQuickSearchFallback = null;
    // Source indexes from the prior layout are no longer valid.
    this.quickSearchDirtySources.clear();

    if (this.isQuickFilterPresent() && layoutSnapshot !== null) {
      const remapped = remapRowOrderByRowIds(
        layoutSnapshot,
        this.store.rowIdToSourceIndex,
      );
      if (remapped !== null) {
        this.pendingQuickSearchFallback = {
          rawRows: this.store.sourceRows,
          rowOrder: remapped,
        };
      }
    }

    this._needsQuickSearchSchedule = this.isQuickFilterPresent();
  }

  private captureQuickSearchLayoutSnapshot(): QuickSearchLayoutSnapshot | null {
    if (!this.isQuickFilterPresent()) return null;
    const order =
      this.asyncQuickSearchRowOrder ??
      this.quickSearchCache?.rowOrder ??
      this.pendingQuickSearchFallback?.rowOrder ??
      null;
    if (order === null) return null;
    return {
      previousRows: this.store.sourceRows,
      previousRowIdToIndex: new Map(this.store.rowIdToSourceIndex),
      previousOrder: order,
    };
  }

  private rebaseFilterCacheRowsRef(rawRows: RowData[]): void {
    if (!this.filterCache) return;
    this.filterCache = {
      ...this.filterCache,
      rawRows,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // §2  Column Definition Resolution
  // ═══════════════════════════════════════════════════════════════════

  /** Effective `ColumnDef` after `defaultColDef` merge (AG-style: column wins if set). */
  effectiveColumnDef(col: LightFastGridColDef): ColumnDef {
    const d = this.defaultColDef;
    const visible = this.runtimeColumnVisibility.has(col.field)
      ? this.runtimeColumnVisibility.get(col.field)
      : resolveMergedColumnVisibility(col, d);
    return {
      field: col.field,
      headerName: col.headerName,
      ...(col.headerActions !== undefined
        ? { headerActions: col.headerActions }
        : {}),
      ...(col.headerControls !== undefined || d?.headerControls !== undefined
        ? { headerControls: col.headerControls ?? d?.headerControls }
        : {}),
      width: col.width,
      flex: col.flex,
      visible,
      minWidth: col.minWidth,
      maxWidth: col.maxWidth,
      resizable: col.resizable ?? d?.resizable,
      sortable: col.sortable ?? d?.sortable,
      filterable: resolveColumnFilterable({
        column: col,
        columnFilterable: col.filterable,
        columnFilter: col.filter,
        defaultFilterable: d?.filterable,
        defaultFilter: d?.filter,
      }),
      filter: col.filter ?? d?.filter,
      floatingFilter: col.floatingFilter ?? d?.floatingFilter,
      reorderable: col.reorderable ?? d?.reorderable,
      pinned: col.pinned,
      pinnable: col.pinnable ?? d?.pinnable,
      editable: col.editable ?? d?.editable,
      editor: col.editor ?? d?.editor,
      columnMenu: col.columnMenu,
      cellKind: col.cellKind,
      actionsKey: col.actionsKey,
      actionTrigger: col.actionTrigger,
      suppressRowClickSelection: col.suppressRowClickSelection,
      columnSelectable: col.columnSelectable,
      getCellAriaLabel: col.getCellAriaLabel ?? d?.getCellAriaLabel,
      cellAriaDescribedBy:
        col.cellAriaDescribedBy ?? d?.cellAriaDescribedBy,
      getCellAriaDescribedBy:
        col.getCellAriaDescribedBy ?? d?.getCellAriaDescribedBy,
      valueGetter: col.valueGetter ?? d?.valueGetter,
      valueFormatter: col.valueFormatter ?? d?.valueFormatter,
      sortComparator: col.sortComparator ?? d?.sortComparator,
      cellClass: col.cellClass ?? d?.cellClass,
      getCellClass: col.getCellClass ?? d?.getCellClass,
      cellClassRules: col.cellClassRules ?? d?.cellClassRules,
      // `tooltip: false` on a column blocks inheritance of
      // `defaultColDef.tooltipValueGetter`.
      tooltip: col.tooltip ?? d?.tooltip,
      tooltipValueGetter: col.tooltipValueGetter
        ?? (col.tooltip === false ? undefined : d?.tooltipValueGetter),
      suppressSizeToFit: col.suppressSizeToFit ?? d?.suppressSizeToFit,
      cellShell: col.cellShell ?? d?.cellShell,
      searchable: col.searchable ?? d?.searchable,
      getQuickFilterText: col.getQuickFilterText ?? d?.getQuickFilterText,
      quickFilterTextField: col.quickFilterTextField ?? d?.quickFilterTextField,
      exportable: col.exportable ?? d?.exportable,
      exportValueField: col.exportValueField ?? d?.exportValueField,
    };
  }

  /** Effective defs for columns that are currently visible (for layout/render snapshot). */
  getVisibleColumnDefs(): ColumnDef[] {
    return (this.columns ?? [])
      .map((c) => this.effectiveColumnDef(c))
      .filter((c) => c.visible !== false);
  }

  /** Effective defs for all columns including hidden (for quick-search field resolution). */
  getAllEffectiveColumnDefs(): ColumnDef[] {
    return (this.columns ?? []).map((c) => this.effectiveColumnDef(c));
  }

  // ═══════════════════════════════════════════════════════════════════
  // §3  Column Sizing
  // ═══════════════════════════════════════════════════════════════════

  setColumnWidth(field: string, width: number): boolean {
    if (isInternalColumn({ field })) return false;
    const cols = this.columns;
    if (!cols) return false;
    const col = cols.find((c) => c.field === field);
    if (!col) return false;
    const eff = this.effectiveColumnDef(col);
    if (!isColumnResizable(eff)) return false;
    col.width = clampColumnWidth(eff, width);
    this.revision++;
    return true;
  }

  /**
   * Batch-set multiple column widths in a single revision bump.
   * Iterates the column array once (O(columns), not O(fields × columns)).
   */
  setColumnWidths(widths: Record<string, number>): string[] {
    const cols = this.columns;
    if (!cols) return [];
    const changed = batchSetColumnWidths(cols, widths, (c) => this.effectiveColumnDef(c));
    if (changed.length > 0) {
      this.revision++;
    }
    return changed;
  }

  /**
   * Reset visible column widths to their baseline (original schema) values.
   * Hidden columns are not mutated.
   */
  resetColumnWidths(): string[] {
    const cols = this.columns;
    if (!cols) return [];
    const changed = resetColumnWidthsToBaseline(cols, this.baselineWidths, (c) => this.effectiveColumnDef(c));
    if (changed.length > 0) {
      this.revision++;
    }
    return changed;
  }

  getColumnWidth(field: string): number | undefined {
    const cols = this.columns;
    if (!cols) return undefined;
    const col = cols.find((c) => c.field === field);
    if (!col) return undefined;
    return col.width;
  }

  // ═══════════════════════════════════════════════════════════════════
  // §4  Column Pinning
  // ═══════════════════════════════════════════════════════════════════

  getColumnPinState(): ColumnPinState[] {
    return (this.columns ?? [])
      .map((col) => this.effectiveColumnDef(col))
      .filter((col) => !isInternalColumn(col))
      .map((col) => ({
        field: col.field,
        pinned: col.pinned || false,
      }));
  }

  setColumnPinned(field: string, pinned: "left" | "right" | false): "left" | "right" | false | null {
    if (isInternalColumn({ field })) return null;
    const cols = this.columns;
    if (!cols) return null;
    const col = cols.find((c) => c.field === field);
    if (!col) return null;
    const eff = this.effectiveColumnDef(col);
    if (eff.pinnable === false) return null;
    const next = pinned || undefined;
    if (col.pinned === next) return null;
    const prev = col.pinned || false;
    col.pinned = next;
    this.revision++;
    return prev;
  }

  setColumnPinState(state: ColumnPinState[]): ColumnPinChange[] {
    const cols = this.columns;
    if (!cols) return [];
    const changes = computePinStateChanges(cols, state, (c) => this.effectiveColumnDef(c));
    if (changes.length > 0) {
      this.revision++;
    }
    return changes;
  }

  // ═══════════════════════════════════════════════════════════════════
  // §5  Column Visibility
  // ═══════════════════════════════════════════════════════════════════

  getColumnVisibilityState(): ColumnVisibilityState[] {
    return (this.columns ?? [])
      .filter((col) => !isInternalColumn(col))
      .map((col) => ({
        field: col.field,
        visible: isColumnEffectivelyVisible(col, this.runtimeColumnVisibility, this.defaultColDef),
      }));
  }

  setColumnVisible(field: string, visible: boolean): ColumnVisibilityChange | null {
    if (isInternalColumn({ field })) return null;
    const cols = this.columns;
    if (!cols) return null;
    const col = cols.find((c) => c.field === field);
    if (!col) return null;
    const prev = isColumnEffectivelyVisible(col, this.runtimeColumnVisibility, this.defaultColDef);
    this.runtimeColumnVisibility.set(field, visible);
    col.visible = visible ? true : false;
    if (prev === visible) return null;
    this.quickSearchFieldsVersion++;
    this.rebuildQuickSearchDependencyPlan();
    this.invalidateQuickSearchAfterFieldsChanged();
    this.revision++;
    return { field, visible, previousVisible: prev };
  }

  setColumnVisibilityState(state: ColumnVisibilityState[]): ColumnVisibilityChange[] {
    const cols = this.columns;
    if (!cols) return [];
    const changes = computeVisibilityChanges(cols, state, this.runtimeColumnVisibility, this.defaultColDef);
    if (changes.length > 0) {
      this.quickSearchFieldsVersion++;
      this.rebuildQuickSearchDependencyPlan();
      this.invalidateQuickSearchAfterFieldsChanged();
      this.revision++;
    }
    return changes;
  }

  // ═══════════════════════════════════════════════════════════════════
  // §6  Selection / Ordering / Drag Config
  // ═══════════════════════════════════════════════════════════════════

  setRowSelection(value: RowSelectionProp): boolean {
    const next = normalizeRowSelection(value);
    if (rowSelectionConfigsEqual(this.rowSelection, next)) return false;
    this.rowSelection = next;
    this.revision++;
    return true;
  }

  setColumnSelection(value: ColumnSelectionProp): boolean {
    const next = normalizeColumnSelection(value);
    if (columnSelectionConfigsEqual(this.columnSelection, next)) return false;
    this.columnSelection = next;
    this.revision++;
    return true;
  }

  setColumnOrder(value: ColumnOrderProp | undefined): boolean {
    const next = normalizeColumnOrder(value);
    if (columnOrderConfigsEqual(this.columnOrder, next)) return false;
    this.columnOrder = next;
    this.revision++;
    return true;
  }

  setRowDrag(value: RowDragProp | undefined): boolean {
    const next = normalizeRowDrag(value);
    if (rowDragConfigsEqual(this.rowDrag, next)) return false;
    this.rowDrag = next;
    this.revision++;
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════
  // §7  Sorting / Row Model
  // ═══════════════════════════════════════════════════════════════════

  setSortModel(model: SortModel): boolean {
    const effective = normalizeSortModel(model, this.getVisibleColumnDefs());
    if (sortModelsEqual(this.sortModel, effective)) return false;
    this.captureSortFallback();
    this.sortModel = effective;
    // Cached RowOrder / pending async result was computed under the old model.
    this.asyncSortedRowOrder = null;
    this.sortCache = null;
    if (effective.length === 0) this.pendingSortFallback = null;
    this.revision++;
    return true;
  }

  getSortModel(): SortModel {
    return [...this.sortModel];
  }

  private captureSortFallback(): void {
    const rawRows = this.store.sourceRows;
    const order = this.asyncSortedRowOrder ?? this.sortCache?.rowOrder ?? null;
    if (order) {
      this.pendingSortFallback = { rawRows, rowOrder: order };
    }
  }

  private captureFilterFallback(): void {
    const rawRows = this.store.sourceRows;
    const order = this.asyncFilteredRowOrder ?? this.filterCache?.rowOrder ?? null;
    if (order) {
      this.pendingFilterFallback = { rawRows, rowOrder: order };
    }
  }

  /**
   * Build a sort execution context that shares `RowValueCache` and
   * `SortOrderPairCache` with the synchronous path.
   */
  getSortExecutionContext(): SortExecutionContext {
    const rawRows = this.store.sourceRows;
    return this.rowModelRuntime.getSortExecutionContext(rawRows, this.rowRevision);
  }

  /**
   * Try to resolve the current sort from `SortOrderPairCache` without
   * running a full sort. Returns the cached `RowOrder` on a hit, or
   * `null` when a full sort is required.
   *
   * On hit, rebuilds `sortCache` so `getSnapshot()` takes the fast path.
   */
  tryResolveCachedSortOrder(): RowOrder | null {
    const rawRows = this.store.sourceRows;
    const visibleCols = this.getVisibleColumnDefs();

    const resolution = this.rowModelRuntime.tryResolveCachedSortOrder(
      rawRows, this.sortModel, visibleCols, this.rowRevision,
    );
    if (!resolution) return null;

    const { rowOrder } = resolution;

    const colSnap = takeSortColumnSnapshot(this.sortModel, visibleCols);
    this.sortCache = {
      rawRows,
      sortModel: this.sortModel,
      columnSnapshot: colSnap,
      rowOrder,
    };

    return rowOrder;
  }

  markSortPending(): void {
    this.sortPending = true;
  }

  clearSortPending(): void {
    this.sortPending = false;
  }

  isSortPending(): boolean {
    return this.sortPending;
  }

  /**
   * Commit an async sort completion. Promoted into `sortCache` lazily on
   * the next snapshot getter call.
   */
  applySortedRowOrder(rowOrder: RowOrder): void {
    this.asyncSortedRowOrder = rowOrder;
    this.sortPending = false;
    this.sortCache = null;
    this.pendingSortFallback = null;
  }

  /**
   * Record a worker-produced sort order into the pair cache so
   * subsequent single-column ASC↔DESC toggles resolve from cache.
   *
   * Called through `SortOperationCache.record` (see
   * `getSortOperationCache`) when the generic runner completes a worker
   * sort. Delegates to `RowModelRuntime.recordWorkerSortOrder` which
   * guards against multi-column sorts, valueGetter columns, etc.
   */
  recordWorkerSortOrder(
    indexes: Uint32Array,
    rowOrder: RowOrder,
  ): void {
    const rawRows = this.store.sourceRows;
    this.rowModelRuntime.recordWorkerSortOrder(
      rawRows,
      this.sortModel,
      this.getVisibleColumnDefs(),
      this.rowRevision,
      indexes,
      rowOrder,
    );
  }

  /**
   * Sort cache boundary for the generic execution pipeline. Delegates
   * to the existing pair-cache methods — `tryResolveCachedSortOrder`
   * for lookups and `recordWorkerSortOrder` for worker results.
   *
   * `record` only handles worker-produced indexes: main-thread sorts
   * still populate the pair cache internally via `SortExecutionContext`,
   * and cache-produced results need no re-recording.
   */
  getSortOperationCache(): SortOperationCache {
    return {
      tryResolve: (input) => {
        if (input.sourceIndexes) return null;
        const rowOrder = this.tryResolveCachedSortOrder();
        return rowOrder ? rowOrderToRowIndexExecutionResult(rowOrder) : null;
      },
      record: (input, output, producer) => {
        if (input.sourceIndexes) return;
        if (producer !== 'worker') return;
        if (output.kind !== 'indexes') return;
        const rowOrder = rowIndexExecutionResultToRowOrder(output);
        this.recordWorkerSortOrder(output.indexes, rowOrder);
      },
    };
  }

  refreshSortModel(): boolean {
    if (this.sortModel.length === 0) return false;
    const effective = normalizeSortModel(this.sortModel, this.getVisibleColumnDefs());
    if (sortModelsEqual(this.sortModel, effective)) return false;
    this.captureSortFallback();
    this.sortModel = effective;
    this.asyncSortedRowOrder = null;
    this.sortCache = null;
    this.pendingSortFallback = null;
    this.revision++;
    return true;
  }

  // Resolve the current sorted `RowOrder`. Used once per `getSnapshot()` to
  // build the `RowView`; `snapshot.data` remains the raw source-rows reference
  // for public/source-row access. When an upstream filtered order provides
  // source indexes, sort operates on that subset directly — no post-restrict.
  private getSortedRowOrder(
    rawRows: RowData[],
    visibleCols: ColumnDef[],
    upstreamOrder?: RowOrder,
  ): RowOrder {
    if (this.sortModel.length === 0) {
      this.asyncSortedRowOrder = null;
      return upstreamOrder ?? this.getIdentityOrder(rawRows);
    }

    if (this.sortPending) {
      const fallback = this.pendingSortFallback;
      if (fallback && fallback.rawRows === rawRows) return fallback.rowOrder;
      return (
        this.asyncSortedRowOrder ??
        this.sortCache?.rowOrder ??
        upstreamOrder ??
        this.getIdentityOrder(rawRows)
      );
    }

    // Promote a freshly-delivered async result into the cache.
    if (this.asyncSortedRowOrder) {
      const order = this.asyncSortedRowOrder;
      this.asyncSortedRowOrder = null;
      this.pendingSortFallback = null;
      this.sortCache = {
        rawRows,
        sortModel: this.sortModel,
        columnSnapshot: takeSortColumnSnapshot(this.sortModel, visibleCols),
        rowOrder: order,
      };
      return order;
    }

    const colSnap = takeSortColumnSnapshot(this.sortModel, visibleCols);
    const cache = this.sortCache;
    if (
      cache &&
      cache.rawRows === rawRows &&
      sortModelsEqual(cache.sortModel, this.sortModel) &&
      sortColumnSnapshotsEqual(cache.columnSnapshot, colSnap)
    ) {
      return cache.rowOrder;
    }

    // Extract upstream source indexes for subset sort when filter is active.
    const sourceIndexes = upstreamOrder?.kind === 'indexed'
      ? upstreamOrder.indexes
      : undefined;

    const rowOrder = this.rowModelRuntime.computeSortedRowOrder(
      rawRows,
      this.sortModel,
      visibleCols,
      this.rowRevision,
      sourceIndexes,
    );
    this.pendingSortFallback = null;
    this.sortCache = {
      rawRows,
      sortModel: this.sortModel,
      columnSnapshot: colSnap,
      rowOrder,
    };
    return rowOrder;
  }

  private getIdentityOrder(rawRows: RowData[]): RowOrder {
    return this.rowModelRuntime.getIdentityOrder(rawRows);
  }

  // ── Filter Model ──────────────────────────────────────────────────────

  setFilterModel(model: FilterModel): boolean {
    if (filterModelsEqual(this.filterModel, model)) return false;
    const nextKeys = Object.keys(model);
    this.filterModel = nextKeys.length > 0 ? cloneFilterModel(model) : {};
    this.invalidateAfterFilterModelChanged();
    return true;
  }

  getFilterModel(): FilterModel {
    return cloneFilterModel(this.filterModel);
  }

  hasActiveFilters(): boolean {
    return Object.keys(this.filterModel).length > 0;
  }

  isCurrentFilterModel(model: FilterModel): boolean {
    return filterModelsEqual(this.filterModel, model);
  }

  getColumnFilterModel(field: string): ColumnFilterModel | null {
    const m = this.filterModel[field];
    if (!m) return null;
    return cloneColumnFilterModel(m);
  }

  setColumnFilterModel(field: string, model: ColumnFilterModel | null): boolean {
    if (model === null) {
      return this.clearColumnFilter(field);
    }
    const existing = this.filterModel[field];
    if (existing && filterModelsEqual({ [field]: existing }, { [field]: model })) {
      return false;
    }
    this.filterModel = { ...cloneFilterModel(this.filterModel), [field]: cloneColumnFilterModel(model) };
    this.invalidateAfterFilterModelChanged();
    return true;
  }

  clearColumnFilter(field: string): boolean {
    if (!this.filterModel[field]) return false;
    const next = cloneFilterModel(this.filterModel);
    delete next[field];
    this.filterModel = Object.keys(next).length > 0 ? next : {};
    this.invalidateAfterFilterModelChanged();
    return true;
  }

  private invalidateAfterFilterModelChanged(): void {
    this.captureFilterFallback();
    this.captureSortFallback();
    this.asyncFilteredRowOrder = null;
    this.filterCache = null;
    this.filteredOrderVersion++;
    this.asyncSortedRowOrder = null;
    this.sortCache = null;
    this.invalidateQuickSearchAfterFilterChanged();
    this.revision++;
    if (this.hasActiveFilters()) {
      this._needsFilterSchedule = true;
    } else {
      this.filterPending = false;
      this.pendingFilterFallback = null;
      this._needsFilterSchedule = false;
    }
    this._needsSortSchedule = true;
  }

  markFilterPending(): void {
    this.filterPending = true;
    this._needsFilterSchedule = false;
  }

  clearFilterPending(): void {
    this.filterPending = false;
  }

  isFilterPending(): boolean {
    return this.filterPending;
  }

  applyFilteredRowOrder(rowOrder: RowOrder): void {
    this.asyncFilteredRowOrder = rowOrder;
    this.filterPending = false;
    this.pendingFilterFallback = null;
    this._needsFilterSchedule = false;
    this.filterCache = null;
    this.filteredOrderVersion++;
    if (this.sortModel.length > 0) {
      this.captureSortFallback();
    }
    this.asyncSortedRowOrder = null;
    this.sortCache = null;
    this._needsSortSchedule = true;
  }

  getFilterConfigVersion(): number {
    return this.filterConfigVersion;
  }

  getFilteredOrderVersion(): number {
    return this.filteredOrderVersion;
  }

  private invalidateFilterCache(): void {
    this.captureFilterFallback();
    this.filterCache = null;
    this.asyncFilteredRowOrder = null;
    this.filteredOrderVersion++;
    if (this.hasActiveFilters()) {
      this._needsFilterSchedule = true;
    }
  }

  /**
   * Return the current filtered `RowOrder`. Never executes filter logic
   * inline — returns the cached/async result when available, or identity
   * order when no filter result exists yet (the Grid controller schedules
   * filter work through `GridExecutionService.scheduleFilter`).
   */
  getFilteredRowOrder(rawRows: RowData[]): RowOrder {
    if (!this.hasActiveFilters()) {
      this.asyncFilteredRowOrder = null;
      this.filterCache = null;
      return this.getIdentityOrder(rawRows);
    }

    // Promote a freshly-delivered async result into the cache.
    if (this.asyncFilteredRowOrder) {
      const order = this.asyncFilteredRowOrder;
      this.asyncFilteredRowOrder = null;
      this.pendingFilterFallback = null;
      this.filterCache = {
        rawRows,
        filterModel: this.filterModel,
        filterConfigVersion: this.filterConfigVersion,
        rowOrder: order,
      };
      return order;
    }

    const cache = this.filterCache;
    if (
      cache &&
      cache.rawRows === rawRows &&
      cache.filterModel === this.filterModel &&
      cache.filterConfigVersion === this.filterConfigVersion
    ) {
      return cache.rowOrder;
    }

    if (this.filterPending) {
      const fallback = this.pendingFilterFallback;
      if (fallback && fallback.rawRows === rawRows) return fallback.rowOrder;
      return cache?.rowOrder ?? this.getIdentityOrder(rawRows);
    }

    // No cached result and not pending — signal that filter needs scheduling.
    this._needsFilterSchedule = true;
    return this.getIdentityOrder(rawRows);
  }

  // ── Quick Filter / Quick Search State ──────────────────────────────

  setQuickFilterText(text: string): boolean {
    if (text === this.quickFilterText) return false;
    const wasActive = this.isQuickFilterPresent();
    this.quickFilterText = text;
    const isActive = this.isQuickFilterPresent();

    if (!isActive) {
      this.clearQuickSearchState();
      this.quickSearchPending = false;
      this._needsQuickSearchSchedule = false;
    } else if (!wasActive) {
      this._needsQuickSearchSchedule = true;
    } else {
      this.invalidateAfterQuickFilterTextChanged();
    }

    this.revision++;
    return true;
  }

  getQuickFilterText(): string {
    return this.quickFilterText;
  }

  isQuickFilterPresent(): boolean {
    return isQuickFilterActive(this.quickFilterText, this.quickFilter);
  }

  getQuickFilterOptions(): boolean | QuickFilterOptions | undefined {
    return this.quickFilter;
  }

  getQuickSearchSearchableFieldsSignature(): string {
    return this.getSearchableFieldsSignature();
  }

  getQuickSearchSearchableDataRevision(): number {
    return this.searchableDataRevision;
  }

  getQuickSearchSourceLayoutRevision(): number {
    return this.store.sourceLayoutRevision;
  }

  getQuickSearchDirtySourceSnapshot(): QuickSearchDirtySourceSnapshot {
    return this.quickSearchDirtySources.snapshot();
  }

  /**
   * Move pending dirty source indexes into an in-flight transfer ownership
   * snapshot for later extraction/posting. Does not schedule work or reset
   * revisions.
   */
  beginQuickSearchDirtySourceTransfer(): QuickSearchDirtyTransferSnapshot {
    const transfer = this.quickSearchDirtySources.beginTransfer();
    return {
      transferId: transfer.transferId,
      indexes: transfer.indexes,
      complete: transfer.complete,
      sourceLayoutRevision: this.store.sourceLayoutRevision,
      searchableDataRevision: this.searchableDataRevision,
    };
  }

  /**
   * Begin a dirty-source transfer only when retained ownership exists.
   * Returns undefined for empty + complete with no in-flight work, without
   * allocating a transfer ID. Captures layout/data revisions when begun.
   */
  beginQuickSearchDirtySourceTransferIfNeeded():
    | QuickSearchDirtyTransferSnapshot
    | undefined {
    const transfer = this.quickSearchDirtySources.beginTransferIfNeeded();
    if (transfer === undefined) {
      return undefined;
    }
    return {
      transferId: transfer.transferId,
      indexes: transfer.indexes,
      complete: transfer.complete,
      sourceLayoutRevision: this.store.sourceLayoutRevision,
      searchableDataRevision: this.searchableDataRevision,
    };
  }

  /**
   * Cancel an active transfer by transferId, restoring its indexes to pending.
   * Stale IDs are no-ops.
   */
  cancelQuickSearchDirtySourceTransfer(transferId: number): boolean {
    return this.quickSearchDirtySources.cancelTransfer(transferId);
  }

  /**
   * Acknowledge that a complete transfer has been successfully handed to
   * transport. Drops only matching in-flight ownership; newer pending edits
   * remain. Stale IDs and incomplete transfers are no-ops that return false.
   */
  acknowledgeQuickSearchDirtySourceTransferPosted(transferId: number): boolean {
    return this.quickSearchDirtySources.acknowledgeTransferPosted(transferId);
  }

  /**
   * Acknowledge that an accepted full-snapshot rebuild covered the transfer.
   * Drops matching in-flight ownership even when incomplete; newer pending
   * edits remain. Stale IDs are no-ops that return false.
   */
  acknowledgeQuickSearchDirtySourceTransferCoveredByFullSnapshot(
    transferId: number,
  ): boolean {
    return this.quickSearchDirtySources.acknowledgeTransferCoveredByFullSnapshot(
      transferId,
    );
  }

  setQuickFilterOptions(quickFilter: boolean | QuickFilterOptions | undefined): boolean {
    if (quickFilterOptionsEqual(this.quickFilter, quickFilter)) return false;
    const wasPresent = this.isQuickFilterPresent();
    const dependencyChanged = !quickFilterDependencyOptionsEqual(
      this.quickFilter,
      quickFilter,
    );
    this.quickFilter = quickFilter;
    // Cache/prewarm-only changes preserve plan identity and dirty deltas.
    if (dependencyChanged) {
      this.rebuildQuickSearchDependencyPlan();
    }
    const isPresent = this.isQuickFilterPresent();

    if (!isPresent) {
      this.clearQuickSearchState();
      this.quickSearchPending = false;
      this._needsQuickSearchSchedule = false;
    } else if (!wasPresent) {
      this._needsQuickSearchSchedule = true;
    } else if (dependencyChanged) {
      this.quickSearchFieldsVersion++;
      this.invalidateQuickSearchAfterFieldsChanged();
    }

    this.revision++;
    return true;
  }

  markQuickSearchPending(): void {
    this.quickSearchPending = true;
    this._needsQuickSearchSchedule = false;
  }

  clearQuickSearchPending(): void {
    this.quickSearchPending = false;
  }

  isQuickSearchPending(): boolean {
    return this.quickSearchPending;
  }

  applyQuickSearchRowOrder(rowOrder: RowOrder): void {
    this.asyncQuickSearchRowOrder = rowOrder;
    this.quickSearchPending = false;
    this.pendingQuickSearchFallback = null;
    this._needsQuickSearchSchedule = false;
    this.quickSearchCache = null;
    if (this.sortModel.length > 0) {
      this.captureSortFallback();
      this.asyncSortedRowOrder = null;
      this.sortCache = null;
      this._needsSortSchedule = true;
    }
    this.revision++;
  }

  /**
   * Return the current quick-search `RowOrder` over the upstream filtered
   * order. Never executes search inline — returns cached/async/fallback
   * results when available, or the filtered order while work is pending.
   */
  getQuickSearchRowOrder(rawRows: RowData[], filteredOrder: RowOrder): RowOrder {
    if (!this.isQuickFilterPresent()) {
      this.asyncQuickSearchRowOrder = null;
      this.quickSearchCache = null;
      return filteredOrder;
    }

    if (this.asyncQuickSearchRowOrder) {
      const order = this.asyncQuickSearchRowOrder;
      this.asyncQuickSearchRowOrder = null;
      this.pendingQuickSearchFallback = null;
      this.quickSearchCache = {
        rawRows,
        quickFilterText: this.quickFilterText,
        searchableFieldsSignature: this.getSearchableFieldsSignature(),
        searchableFieldsVersion: this.quickSearchFieldsVersion,
        filterModel: this.filterModel,
        filterConfigVersion: this.filterConfigVersion,
        filteredOrder,
        rowOrder: order,
      };
      return order;
    }

    const cache = this.quickSearchCache;
    const fieldsSignature = this.getSearchableFieldsSignature();
    if (
      cache &&
      cache.rawRows === rawRows &&
      cache.quickFilterText === this.quickFilterText &&
      cache.searchableFieldsSignature === fieldsSignature &&
      cache.searchableFieldsVersion === this.quickSearchFieldsVersion &&
      cache.filterModel === this.filterModel &&
      cache.filterConfigVersion === this.filterConfigVersion &&
      cache.filteredOrder === filteredOrder
    ) {
      return cache.rowOrder;
    }

    if (this.quickSearchPending) {
      const fallback = this.pendingQuickSearchFallback;
      if (fallback && fallback.rawRows === rawRows) return fallback.rowOrder;
      return cache?.rowOrder ?? filteredOrder;
    }

    this._needsQuickSearchSchedule = true;
    return cache?.rowOrder ?? filteredOrder;
  }

  private captureQuickSearchFallback(): void {
    const rawRows = this.store.sourceRows;
    const order =
      this.asyncQuickSearchRowOrder ?? this.quickSearchCache?.rowOrder ?? null;
    if (order) {
      this.pendingQuickSearchFallback = { rawRows, rowOrder: order };
    }
  }

  private clearQuickSearchState(): void {
    this.asyncQuickSearchRowOrder = null;
    this.quickSearchCache = null;
    this.pendingQuickSearchFallback = null;
    this.pendingSortFallback = null;
    this.asyncSortedRowOrder = null;
    this.sortCache = null;
    if (this.sortModel.length > 0) {
      this._needsSortSchedule = true;
    }
  }

  private invalidateAfterQuickFilterTextChanged(): void {
    this.captureQuickSearchFallback();
    this.captureSortFallback();
    this.asyncQuickSearchRowOrder = null;
    this.quickSearchCache = null;
    this.asyncSortedRowOrder = null;
    this.sortCache = null;
    this._needsQuickSearchSchedule = true;
    this._needsSortSchedule = this.sortModel.length > 0;
  }

  private invalidateQuickSearchAfterFilterChanged(): void {
    if (!this.isQuickFilterPresent()) {
      this.asyncQuickSearchRowOrder = null;
      this.quickSearchCache = null;
      this.pendingQuickSearchFallback = null;
      this._needsQuickSearchSchedule = false;
      return;
    }
    this.captureQuickSearchFallback();
    this.asyncQuickSearchRowOrder = null;
    this.quickSearchCache = null;
    this._needsQuickSearchSchedule = true;
  }

  private invalidateQuickSearchAfterFieldsChanged(): void {
    if (!this.isQuickFilterPresent()) return;
    this.captureQuickSearchFallback();
    this.asyncQuickSearchRowOrder = null;
    this.quickSearchCache = null;
    this._needsQuickSearchSchedule = true;
    if (this.sortModel.length > 0) {
      this.captureSortFallback();
      this.asyncSortedRowOrder = null;
      this.sortCache = null;
      this._needsSortSchedule = true;
    }
  }

  private rebaseQuickSearchCacheRowsRef(rawRows: RowData[]): void {
    if (this.quickSearchCache) {
      this.quickSearchCache = {
        ...this.quickSearchCache,
        rawRows,
        filteredOrder: this.getFilteredRowOrder(rawRows),
      };
    }
  }

  // Build / reuse the `RowView` for (rawRows, order). Generation bumps
  // only when the input reference pair changes.
  private resolveRowView(rawRows: RowData[], order: RowOrder): RowView {
    const cached = this.rowViewCache;
    if (cached && cached.rawRows === rawRows && cached.rowOrder === order) {
      return cached.view;
    }
    this.rowViewGeneration++;
    const view = createRowView(rawRows, order, this.rowViewGeneration);
    this.rowViewCache = { rawRows, rowOrder: order, view };
    return view;
  }

  // Same as resolveRowView but for the unpaginated (full) view, with
  // its own cache slot.
  private resolveFullRowView(rawRows: RowData[], order: RowOrder): RowView {
    const cached = this.fullRowViewCache;
    if (cached && cached.rawRows === rawRows && cached.rowOrder === order) {
      return cached.view;
    }
    this.rowViewGeneration++;
    const view = createRowView(rawRows, order, this.rowViewGeneration);
    this.fullRowViewCache = { rawRows, rowOrder: order, view };
    return view;
  }

  // ═══════════════════════════════════════════════════════════════════
  // §8  Row Styling
  // ═══════════════════════════════════════════════════════════════════
  //
  // Stored as-is (no normalization). Bumps `rowStylingVersion` only when
  // an input differs by reference. Does NOT bump `revision` — row-styling
  // changes must not invalidate the per-row data fingerprint.

  setRowStyling(value: {
    rowClass?: string | string[];
    getRowClass?: GetRowClass;
    rowClassRules?: RowClassRules;
  }): boolean {
    if (
      this.rowClass === value.rowClass &&
      this.getRowClass === value.getRowClass &&
      this.rowClassRules === value.rowClassRules
    ) {
      return false;
    }
    this.rowClass = value.rowClass;
    this.getRowClass = value.getRowClass;
    this.rowClassRules = value.rowClassRules;
    this.rowStylingVersion++;
    return true;
  }

  getRowStyling(): {
    rowClass: string | string[] | undefined;
    getRowClass: GetRowClass | undefined;
    rowClassRules: RowClassRules | undefined;
  } {
    return {
      rowClass: this.rowClass,
      getRowClass: this.getRowClass,
      rowClassRules: this.rowClassRules,
    };
  }

  getRowStylingVersion(): number {
    return this.rowStylingVersion;
  }

  // ═══════════════════════════════════════════════════════════════════
  // §9  Overlays
  // ═══════════════════════════════════════════════════════════════════
  //
  // Overlay state does NOT bump `revision`. Bumping it would invalidate
  // row/cell virtualization caches. Grid methods that mutate overlay state
  // call `scheduleRender()` themselves when these setters return `true`.

  /** Returns true when the loading flag changed. */
  setLoading(value: boolean): boolean {
    if (this.loading === value) return false;
    this.loading = value;
    return true;
  }

  /** Returns true when the manual overlay kind changed. */
  setManualOverlay(kind: GridOverlayKind | null): boolean {
    if (this.manualOverlay === kind) return false;
    this.manualOverlay = kind;
    return true;
  }

  /** Returns true when the overlays customization reference changed. */
  setOverlays(overlays: GridOverlaysOptions | undefined): boolean {
    if (this.overlays === overlays) return false;
    this.overlays = overlays;
    return true;
  }

  setFloatingFilters(value: boolean | FloatingFiltersOptions | undefined): boolean {
    if (this.floatingFilters === value) return false;
    this.floatingFilters = value;
    return true;
  }

  /**
   * Show or suppress column group header rows without changing leaf columns
   * or group ancestry metadata. Returns true when the config changed.
   */
  setColumnGroupHeaders(
    value: boolean | ColumnGroupHeadersOptions | undefined,
  ): boolean {
    if (this.columnGroupHeadersConfig === value) return false;
    this.columnGroupHeadersConfig = value;
    return true;
  }

  /** Whether group header rows are enabled in display config. */
  isColumnGroupHeadersEnabled(): boolean {
    return isColumnGroupHeadersEnabled(this.columnGroupHeadersConfig);
  }

  getOverlayState(): {
    loading: boolean;
    manualOverlay: GridOverlayKind | null;
    overlays: GridOverlaysOptions | undefined;
  } {
    return {
      loading: this.loading,
      manualOverlay: this.manualOverlay,
      overlays: this.overlays,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // §10  Row Pinning
  // ═══════════════════════════════════════════════════════════════════
  //
  // Internal model: `Map<rowId, RowPinPosition>` for O(1) lookups + small,
  // stable iteration. Mutation methods return only rows that actually
  // changed. `revision++` only on real state change.

  /** Seed `rowPinned` from a `RowPinningProp`. `bottom` wins ties (last-write-wins). */
  private initializeRowPinning(value: RowPinningProp | undefined): void {
    if (!value) return;
    if (value.top) {
      for (const id of value.top) this.rowPinned.set(id, "top");
    }
    if (value.bottom) {
      for (const id of value.bottom) this.rowPinned.set(id, "bottom");
    }
  }

  /** Snapshot of current row pin state as a plain record for the renderer. */
  getRowPinMap(): Record<string, RowPinPosition> | undefined {
    if (this.rowPinned.size === 0) return undefined;
    const out: Record<string, RowPinPosition> = {};
    for (const [id, pos] of this.rowPinned) out[id] = pos;
    return out;
  }

  getRowPinStateArray(): RowPinStateEntry[] {
    const out: RowPinStateEntry[] = [];
    for (const [rowId, pinned] of this.rowPinned) out.push({ rowId, pinned });
    return out;
  }

  /** O(1) immutable read capture; later pin mutations detach first. */
  captureRowPinReadSnapshot(): ImmutableKeyedMembership<
    string,
    RowPinPosition
  > {
    this.rowPinnedShared = true;
    return captureKeyedMembership(this.rowPinned);
  }

  /** Set a single row's pin position. Returns the change when state actually changed. */
  pinRow(rowId: string, position: RowPinPosition | false): RowPinChange | null {
    const prev = this.rowPinned.get(rowId) ?? false;
    if (prev === position) return null;
    this.detachRowPinnedForMutation();
    if (position === false) {
      this.rowPinned.delete(rowId);
    } else {
      this.rowPinned.set(rowId, position);
    }
    this.revision++;
    return { rowId, pinned: position, previousPinned: prev };
  }

  /** Bulk pin multiple rows to the same position. Returns only rows whose state changed. */
  pinRows(rowIds: readonly string[], position: RowPinPosition): RowPinChange[] {
    const changes: RowPinChange[] = [];
    for (const rowId of rowIds) {
      const prev = this.rowPinned.get(rowId) ?? false;
      if (prev === position) continue;
      this.detachRowPinnedForMutation();
      this.rowPinned.set(rowId, position);
      changes.push({ rowId, pinned: position, previousPinned: prev });
    }
    if (changes.length > 0) this.revision++;
    return changes;
  }

  unpinRows(rowIds: readonly string[]): RowPinChange[] {
    const changes: RowPinChange[] = [];
    for (const rowId of rowIds) {
      const prev = this.rowPinned.get(rowId);
      if (prev === undefined) continue;
      this.detachRowPinnedForMutation();
      this.rowPinned.delete(rowId);
      changes.push({ rowId, pinned: false, previousPinned: prev });
    }
    if (changes.length > 0) this.revision++;
    return changes;
  }

  /**
   * Replace the entire row pin state. Duplicate `rowId` entries follow
   * last-write-wins. `pinned: false` unpins. Ids missing from `state`
   * get unpinned.
   */
  setRowPinState(state: readonly RowPinStateEntry[]): RowPinChange[] {
    const next = new Map<string, RowPinPosition>();
    for (const entry of state) {
      if (entry.pinned === false) {
        next.delete(entry.rowId);
      } else {
        next.set(entry.rowId, entry.pinned);
      }
    }

    const changes: RowPinChange[] = [];

    for (const [rowId, prev] of this.rowPinned) {
      if (!next.has(rowId)) {
        changes.push({ rowId, pinned: false, previousPinned: prev });
      }
    }
    for (const [rowId, pinned] of next) {
      const prev = this.rowPinned.get(rowId) ?? false;
      if (prev !== pinned) {
        changes.push({ rowId, pinned, previousPinned: prev });
      }
    }

    if (changes.length === 0) return changes;
    this.rowPinned = next;
    this.rowPinnedShared = false;
    this.revision++;
    return changes;
  }

  /** Unpin every currently pinned row. */
  clearRowPinning(): RowPinChange[] {
    if (this.rowPinned.size === 0) return [];
    const changes: RowPinChange[] = [];
    for (const [rowId, prev] of this.rowPinned) {
      changes.push({ rowId, pinned: false, previousPinned: prev });
    }
    this.rowPinned = new Map();
    this.rowPinnedShared = false;
    this.revision++;
    return changes;
  }

  private detachRowPinnedForMutation(): void {
    if (!this.rowPinnedShared) return;
    this.rowPinned = new Map(this.rowPinned);
    this.rowPinnedShared = false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // §11  Row Reorder Mutation
  // ═══════════════════════════════════════════════════════════════════

  moveRowsByIds(
    rowId: string,
    rowIds: string[],
    insertionIndex: number,
    resolveRowId: (row: RowData, index: number) => string,
  ): {
    changed: boolean;
    rowId: string;
    rowIds: string[];
    rows: RowData[];
    fromIndex: number;
    fromIndices: number[];
    toIndex: number;
  } | null {
    const allRows = this.store.sourceRows;
    if (allRows.length === 0) return null;

    const deduped = [...new Set(rowIds)];
    if (deduped.length === 0) return null;

    const resolvedIds: string[] = new Array(allRows.length);
    const indexById = new Map<string, number>();
    for (let i = 0; i < allRows.length; i++) {
      const id = resolveRowId(allRows[i]!, i);
      resolvedIds[i] = id;
      indexById.set(id, i);
    }

    const movingWithIndex: Array<{ id: string; idx: number; row: RowData }> = [];
    for (const id of deduped) {
      const idx = indexById.get(id);
      if (idx === undefined) continue;
      movingWithIndex.push({ id, idx, row: allRows[idx]! });
    }
    if (movingWithIndex.length === 0) return null;
    movingWithIndex.sort((a, b) => a.idx - b.idx);

    const movingSet = new Set(movingWithIndex.map((m) => m.id));
    const fromIndices = movingWithIndex.map((m) => m.idx);
    const movedRows = movingWithIndex.map((m) => m.row);
    const movedIds = movingWithIndex.map((m) => m.id);

    let removed = 0;
    for (const { idx } of movingWithIndex) {
      if (idx < insertionIndex) removed++;
    }
    const adjustedTarget = insertionIndex - removed;

    const withoutMoving = allRows.filter((_, i) => !movingSet.has(resolvedIds[i]!));
    const clampedTarget = Math.max(0, Math.min(adjustedTarget, withoutMoving.length));

    const rebuilt = [
      ...withoutMoving.slice(0, clampedTarget),
      ...movedRows,
      ...withoutMoving.slice(clampedTarget),
    ];
    const changed = !rebuilt.every((r, i) => r === allRows[i]);
    if (!changed) {
      const ptrIdx = movedIds.indexOf(rowId);
      return {
        changed: false,
        rowId,
        rowIds: movedIds,
        rows: movedRows,
        fromIndex: fromIndices[ptrIdx] ?? fromIndices[0]!,
        fromIndices,
        toIndex: clampedTarget,
      };
    }

    const rowToId = new Map<RowData, string>();
    for (let i = 0; i < allRows.length; i++) {
      rowToId.set(allRows[i]!, resolvedIds[i]!);
    }
    const layoutSnapshot = this.captureQuickSearchLayoutSnapshot();
    this.store.replaceAll(rebuilt, (row) => rowToId.get(row) ?? null);
    this.revision++;
    this.invalidateAfterSourceRowLayoutChanged(layoutSnapshot);
    this.clearPendingDirtyRows();

    const ptrIdx = movedIds.indexOf(rowId);
    return {
      changed: true,
      rowId,
      rowIds: movedIds,
      rows: movedRows,
      fromIndex: fromIndices[ptrIdx] ?? fromIndices[0]!,
      fromIndices,
      toIndex: clampedTarget,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // §12  Pagination
  // ═══════════════════════════════════════════════════════════════════
  //
  // Pagination composes after quick search and sorting, before RowView:
  //   raw rows → filter → quick search → sort → paginated RowOrder → RowView
  // `pageIndex` is zero-based and clamped lazily against the current
  // row count so row/page-size changes never leave it out of range.

  isPaginationEnabled(): boolean {
    return this.paginationEnabled;
  }

  /**
   * Total rows feeding the pagination stage — the length of the row
   * order produced by the upstream stages (filter → quick search → sort).
   * Derives from the current composed row order so the total is consistent
   * whether called from `getPaginationState()` or `getSnapshot()`.
   */
  private getUpstreamTotalRows(): number {
    const rawRows = this.store.sourceRows;
    const filteredOrder = this.getFilteredRowOrder(rawRows);
    const quickSearchOrder = this.getQuickSearchRowOrder(rawRows, filteredOrder);
    return getRowOrderLength(quickSearchOrder);
  }

  // Derive pagination state for an upstream total and persist the lazy
  // pageIndex clamp so relative navigation starts from the effective page.
  private derivePaginationState(totalRows: number): PaginationState {
    const state = computePaginationState(
      this.paginationEnabled,
      this.pageIndex,
      this.pageSize,
      totalRows,
    );
    this.pageIndex = state.pageIndex;
    return state;
  }

  /** Current pagination state with `pageIndex` clamped to valid range. */
  getPaginationState(): PaginationState {
    return this.derivePaginationState(this.getUpstreamTotalRows());
  }

  getPageSizeOptions(): number[] {
    return this.pageSizeOptions;
  }

  /**
   * Replace the pagination configuration (prop-driven shape: omitted
   * `pageSize` means the default). Normalizes inputs and returns true
   * only when the effective config actually changed — callers schedule
   * renders off that flag.
   */
  setPaginationConfig(config: {
    enabled: boolean;
    pageSize?: number;
    pageSizeOptions?: number[];
  }): boolean {
    const enabled = config.enabled === true;
    const pageSize =
      normalizePageSize(config.pageSize) ?? DEFAULT_PAGINATION_PAGE_SIZE;
    const pageSizeOptions = normalizePageSizeOptions(
      config.pageSizeOptions,
      pageSize,
    );
    if (
      enabled === this.paginationEnabled &&
      pageSize === this.pageSize &&
      pageSizeOptions.length === this.pageSizeOptions.length &&
      pageSizeOptions.every((v, i) => v === this.pageSizeOptions[i])
    ) {
      return false;
    }
    this.paginationEnabled = enabled;
    this.pageSize = pageSize;
    this.pageSizeOptions = pageSizeOptions;
    this.pageIndex = this.derivePaginationState(
      this.getUpstreamTotalRows(),
    ).pageIndex;
    this.revision++;
    return true;
  }

  /** Set the zero-based page index (clamped). Returns true when changed. */
  setPageIndex(pageIndex: number): boolean {
    const totalRows = this.getUpstreamTotalRows();
    const current = this.derivePaginationState(totalRows);
    const next = computePaginationState(
      this.paginationEnabled,
      pageIndex,
      this.pageSize,
      totalRows,
    );
    if (next.pageIndex === current.pageIndex) return false;
    this.pageIndex = next.pageIndex;
    this.revision++;
    return true;
  }

  /** Set rows per page (positive integer). Returns true when changed. */
  setPageSize(pageSize: number): boolean {
    const size = normalizePageSize(pageSize);
    if (size === null || size === this.pageSize) return false;
    this.pageSize = size;
    // The options list always includes the current page size so the
    // footer select can display it.
    this.pageSizeOptions = normalizePageSizeOptions(
      this.pageSizeOptions,
      size,
    );
    // Re-clamp the page index against the new page count.
    this.pageIndex = this.derivePaginationState(
      this.getUpstreamTotalRows(),
    ).pageIndex;
    this.revision++;
    return true;
  }

  // Slice the sorted order to the current page. Cached by inputs so the
  // RowView cache (keyed by order reference) stays stable across
  // unrelated snapshots.
  private getPaginatedOrder(
    baseOrder: RowOrder,
    pageIndex: number,
    pageSize: number,
  ): RowOrder {
    const cached = this.paginatedOrderCache;
    if (
      cached &&
      cached.baseOrder === baseOrder &&
      cached.pageIndex === pageIndex &&
      cached.pageSize === pageSize
    ) {
      return cached.order;
    }
    const order = paginateRowOrder(baseOrder, pageIndex, pageSize);
    this.paginatedOrderCache = { baseOrder, pageIndex, pageSize, order };
    return order;
  }

  // ═══════════════════════════════════════════════════════════════════
  // §13  Snapshot Assembly
  // ═══════════════════════════════════════════════════════════════════

  /** Number of flat leaf columns (after flattening any nested groups). */
  get leafColumnCount(): number {
    return this.columns?.length ?? 0;
  }

  /**
   * Capture generic immutable references for headless readers without building
   * the renderer's allocated row-pin record. Row-model fallbacks are resolved
   * through the same pending-safe pipeline as the render snapshot.
   */
  captureReadSnapshot(): GridReadSnapshot {
    const sourceRows = this.store.captureSourceRows();
    const rowState = this.resolveCapturedRowState(sourceRows);

    return {
      sourceRows,
      currentPageView: rowState.rowView,
      fullView: rowState.fullRowView,
      visibleUserColumns: this.getVisibleColumnDefs(),
      allUserLeafColumns: this.getAllEffectiveColumnDefs(),
      groupMetaByField: this.allColumnGroupMeta,
      groupHeaderDisplayEnabled: isColumnGroupHeadersEnabled(
        this.columnGroupHeadersConfig,
      ),
      rowPinState: this.captureRowPinReadSnapshot(),
      sourceLayoutRevision: this.store.sourceLayoutRevision,
      dataRevision: this.revision,
      columnRevision: this.revision,
    };
  }

  getSnapshot(): GridSnapshot {
    const visibleCols = this.getVisibleColumnDefs();
    const rowState = this.resolveSnapshotRowState(visibleCols);
    const rawRows = rowState.rawRows;
    const rowView = rowState.rowView;
    const fullRowView = rowState.fullRowView;

    const columnGroupHeaders = isColumnGroupHeadersEnabled(
      this.columnGroupHeadersConfig,
    )
      ? deriveColumnGroupHeaderSnapshot(this.allColumnGroupMeta, visibleCols)
      : undefined;

    return {
      columns: visibleCols,
      columnSchemaProvided: (this.columns?.length ?? 0) > 0,
      columnGroupHeaders,
      data: rawRows,
      rowView,
      fullRowView,
      dataRevision: this.revision,
      rowSelection: this.rowSelection,
      columnSelection: this.columnSelection,
      columnOrder: this.columnOrder,
      rowDrag: this.rowDrag,
      rowPinState: this.getRowPinMap(),
      rowStyling: {
        rowClass: this.rowClass,
        getRowClass: this.getRowClass,
        rowClassRules: this.rowClassRules,
      },
      rowStylingVersion: this.rowStylingVersion,
      sortModel: this.sortModel,
      sortPending: this.sortPending,
      filterModel: this.filterModel,
      filterPending: this.filterPending,
      quickFilterText: this.quickFilterText,
      quickSearchPending: this.quickSearchPending,
      pagination: rowState.pagination,
      loading: this.loading,
      manualOverlay: this.manualOverlay,
      overlays: this.overlays,
      floatingFilters: this.floatingFilters,
    };
  }

  private resolveSnapshotRowState(visibleCols: ColumnDef[]): {
    rawRows: RowData[];
    rowView: RowView;
    fullRowView: RowView;
    pagination: GridPaginationSnapshot | undefined;
  } {
    const rawRows = this.store.sourceRows;
    // Pipeline: raw rows → filter → quick search → sort → paginate → RowView.
    const filteredOrder = this.getFilteredRowOrder(rawRows);
    const quickSearchOrder = this.getQuickSearchRowOrder(rawRows, filteredOrder);
    const upstreamOrder = this.getSortedRowOrder(
      rawRows,
      visibleCols,
      quickSearchOrder,
    );
    let order = upstreamOrder;
    let pagination: GridPaginationSnapshot | undefined;
    if (this.paginationEnabled) {
      const state = this.derivePaginationState(getRowOrderLength(order));
      order = this.getPaginatedOrder(order, state.pageIndex, state.pageSize);
      pagination = { ...state, pageSizeOptions: this.pageSizeOptions };
    }
    const rowView = this.resolveRowView(rawRows, order);
    const fullRowView =
      order === upstreamOrder
        ? rowView
        : this.resolveFullRowView(rawRows, upstreamOrder);
    return { rawRows, rowView, fullRowView, pagination };
  }

  /**
   * Capture the current published/pending-safe row model without executing a
   * cold filter, quick-search, or sort. Unlike resolveSnapshotRowState(), this
   * path is task-capture only and deliberately leaves published results and
   * scheduling flags untouched.
   */
  private resolveCapturedRowState(rawRows: RowData[]): {
    rowView: RowView;
    fullRowView: RowView;
  } {
    const filteredOrder = this.captureFilteredRowOrder(rawRows);
    const quickSearchOrder = this.captureQuickSearchRowOrder(
      rawRows,
      filteredOrder,
    );
    const fullOrder = this.captureSortedRowOrder(rawRows, quickSearchOrder);
    const fullRowView = this.resolveFullRowView(rawRows, fullOrder);
    if (!this.paginationEnabled) {
      return { rowView: fullRowView, fullRowView };
    }
    return {
      rowView: this.capturePaginatedRowView(fullRowView),
      fullRowView,
    };
  }

  private captureFilteredRowOrder(rawRows: RowData[]): RowOrder {
    if (!this.hasActiveFilters()) return this.getIdentityOrder(rawRows);
    if (this.asyncFilteredRowOrder) return this.asyncFilteredRowOrder;
    const cache = this.filterCache;
    if (
      cache &&
      cache.rawRows === rawRows &&
      cache.filterModel === this.filterModel &&
      cache.filterConfigVersion === this.filterConfigVersion
    ) {
      return cache.rowOrder;
    }
    if (this.filterPending) {
      const fallback = this.pendingFilterFallback;
      if (fallback?.rawRows === rawRows) return fallback.rowOrder;
    }
    return this.getIdentityOrder(rawRows);
  }

  private captureQuickSearchRowOrder(
    rawRows: RowData[],
    filteredOrder: RowOrder,
  ): RowOrder {
    if (!this.isQuickFilterPresent()) return filteredOrder;
    if (this.asyncQuickSearchRowOrder) return this.asyncQuickSearchRowOrder;
    const cache = this.quickSearchCache;
    if (
      cache &&
      cache.rawRows === rawRows &&
      cache.quickFilterText === this.quickFilterText &&
      cache.searchableFieldsSignature === this.getSearchableFieldsSignature() &&
      cache.searchableFieldsVersion === this.quickSearchFieldsVersion &&
      cache.filterModel === this.filterModel &&
      cache.filterConfigVersion === this.filterConfigVersion &&
      cache.filteredOrder === filteredOrder
    ) {
      return cache.rowOrder;
    }
    if (this.quickSearchPending) {
      const fallback = this.pendingQuickSearchFallback;
      if (fallback?.rawRows === rawRows) return fallback.rowOrder;
    }
    return filteredOrder;
  }

  private captureSortedRowOrder(
    rawRows: RowData[],
    upstreamOrder: RowOrder,
  ): RowOrder {
    if (this.sortModel.length === 0) return upstreamOrder;
    if (this.sortPending) {
      const fallback = this.pendingSortFallback;
      if (fallback?.rawRows === rawRows) return fallback.rowOrder;
    }
    if (this.asyncSortedRowOrder) return this.asyncSortedRowOrder;
    if (this.sortCache?.rawRows === rawRows) return this.sortCache.rowOrder;
    return upstreamOrder;
  }

  /** O(1) page view over the captured full view; no identity index array. */
  private capturePaginatedRowView(fullView: RowView): RowView {
    const pagination = this.derivePaginationState(fullView.rowCount);
    const start = Math.min(
      pagination.pageIndex * pagination.pageSize,
      fullView.rowCount,
    );
    const rowCount = Math.min(
      pagination.pageSize,
      fullView.rowCount - start,
    );
    if (start === 0 && rowCount === fullView.rowCount) return fullView;
    this.rowViewGeneration++;
    return {
      generation: this.rowViewGeneration,
      rows: fullView.rows,
      rowCount,
      getSourceIndex: (displayIndex) =>
        displayIndex >= 0 && displayIndex < rowCount
          ? fullView.getSourceIndex(start + displayIndex)
          : -1,
      getRow: (displayIndex) =>
        displayIndex >= 0 && displayIndex < rowCount
          ? fullView.getRow(start + displayIndex)
          : undefined,
    };
  }
}
