// ─── DomGridRenderer.ts ───
//
// High-level facade: snapshot → pool / features / virtual window sync.
// Pool DOM and geometry live in {@link DomPoolManager}; selection + resize in
// {@link DomFeatureHost}; {@link createWindowSyncContext} builds the sync bag.

import type { GridContext } from "../context/GridContext";
import { assembleHeaderControlResolver } from "../features/assembleHeaderControls";
import { resolveCellClasses } from "../features/cell-styling";
import { buildColumnPinningLayout } from "../features/column-pinning/columnPinningLayout";
import {
  createRowPinningRenderModelBuilder,
  forEachLogicalRowPinLanePoolRow,
  forEachRowPinLanePoolRow,
  type PinnedRowEntry,
  type PinnedRowLaneState,
  type RowPinState,
  syncRowPinLaneDom,
} from "../features/row-pinning";
import {
  type GetRowClass,
  resolveRowClasses,
  type RowClassRules,
} from "../features/row-styling";
import type {
  LogicalColumnLayoutInput,
  LogicalColumnLayoutReadSnapshot,
} from "../internal/columnLayoutReadSnapshot";
import { columnPixelWidth } from "../internal/columnSizing";
import type { VisualRowLayout } from "../internal/layoutTypes";
import type {
  ImmutableIdMembership,
  RowSelectionReadSnapshot,
} from "../internal/readSnapshots";
import type { RowView } from "../row-model/rowOrder";
import { applyGridTheme } from "../themes";
import type { ResolvedGridTheme } from "../themes/types";
import type {
  ColumnDef,
  ColumnOrderConfig,
  ColumnSelectionChangeSource,
  ColumnSelectionConfig,
  FocusChangeSource,
  FocusedCell,
  FocusMoveDirection,
  GridPaginationSnapshot,
  GridSkeleton,
  GridSnapshot,
  HeaderActionGridApi,
  PooledRow,
  RowData,
  RowDragNormalizedConfig,
  RowSelectionConfig,
  SelectionChange,
  SelectionChangeSource,
  SortChangeSource,
  SortModel,
} from "../types";
import { normalizeColumnOrder } from "../utils/columnOrderConfig";
import { normalizeColumnSelection } from "../utils/columnSelectionConfig";
import { normalizeRowDrag } from "../utils/rowDragConfig";
import { normalizeRowSelection } from "../utils/rowSelectionConfig";

import { createWindowSyncContext } from "./dom/createWindowSyncContext";
import { DomFeatureHost } from "./dom/DomFeatureHost";
import { DomPoolManager } from "./dom/DomPoolManager";
import { PaginationFooter } from "./dom/PaginationFooter";
import { applyColumnWidthVars } from "./helpers/applyColumnWidthVars";
import { computeCenterSlotCount } from "./helpers/calculateColumnPoolSize";
import { computeRowPoolSize } from "./helpers/calculatePoolSize";
import { columnsStructureMatch, columnsWidthMatch } from "./helpers/columnDiff";
import { buildGridSkeleton } from "./helpers/dom";
import { applyRowStylingOnly, populateRow, type ResolveCellClassesFn, type ResolveRowClassesFn, syncPinnedRowCells } from "./helpers/populateRow";
import { syncColumnSelectionDom, syncFloatingFilterColumnSelectionDom } from "./helpers/syncColumnSelectionDom";
import { clampScrollTopAfterRowCountReduction } from "./helpers/verticalScrollGeometry";
import type { WindowSyncContext } from "./ring-buffer/VirtualWindowSync";
import { VirtualWindowSync } from "./ring-buffer/VirtualWindowSync";
import type {
  AutoSizeContext,
  ColumnLayoutRendererCapability,
  ColumnSelectionRendererCapability,
  GridRenderer,
  SelectionRendererCapability,
} from "./types/capabilities";
import type { GridRenderSnapshot, RenderChangeSet } from "./types/renderSnapshot";
import type { ResolveHeaderControls } from "./headerControlTypes";
import type { DisplayRowReader } from "./rowViewAccess";
import { createArrayDisplayRowReader, createDisplayRowReader } from "./rowViewAccess";

interface LaneRowBinding {
  entry: PinnedRowEntry;
  centerPoolRow: PooledRow;
  leftPoolRow: PooledRow | null;
  rightPoolRow: PooledRow | null;
}

interface DirtyPatchPlan {
  userColumns: ColumnDef[];
  renderedColumns: ColumnDef[];
  pinningLayout: ReturnType<typeof buildColumnPinningLayout>;
}

export interface DomGridRendererOptions {
  theme: string;
  getRowId?: (row: RowData, dataIndex: number) => unknown;
  suppressRowVirtualization?: boolean;
  suppressColumnVirtualization?: boolean;
  onColumnWidthCommit?: (field: string, width: number) => void;
}

function inferColumnsFromRows(data: RowData[]): ColumnDef[] {
  const keys = new Set<string>();
  for (const row of data) {
    for (const k of Object.keys(row)) keys.add(k);
  }
  return Array.from(keys)
    .sort()
    .map((field) => ({ field, headerName: field }));
}

/** @see GridSnapshot.columnSchemaProvided */
function snapshotUserColumns(
  snapshot: Pick<GridSnapshot, "columns" | "columnSchemaProvided">,
  data: RowData[],
): ColumnDef[] {
  if (snapshot.columns.length > 0) {
    return snapshot.columns;
  }
  if (snapshot.columnSchemaProvided) {
    return [];
  }
  return inferColumnsFromRows(data);
}

export class DomGridRenderer
  implements
    GridRenderer,
    SelectionRendererCapability,
    ColumnSelectionRendererCapability,
    ColumnLayoutRendererCapability
{
  private skeleton: GridSkeleton | null = null;
  private poolManager: DomPoolManager | null = null;
  private options: GridContext;

  private currentColumns: ColumnDef[] = [];
  /** Latest user columns from the last snapshot (pre feature transform). */
  private currentUserColumns: ColumnDef[] = [];
  /**
   * Original user-supplied rows in source order. Always assigned from
   * `snapshot.rowView.rows` — the RowView owns the raw rows reference.
   *
   * Used exclusively for public/internal APIs that intentionally expose
   * original rows — `getCellMenuGridApi().getRows()`,
   * `getRowActionGridApi().getRows()`, column inference fallback, and the
   * display-row reader fallback (when no sort is active source order =
   * display order). Never used for rendering, row binding, or display
   * row counts.
   */
  private currentSourceRows: RowData[] = [];
  /**
   * Read-only view over source rows in current display order. Sourced from
   * `snapshot.rowView` on every render. All hot rendering paths resolve rows
   * through the `currentDisplayRows` reader built from this view.
   */
  private currentRowView: RowView | null = null;
  /**
   * Renderer-side reader over display rows, built from `currentRowView`.
   * All hot rendering paths — center body binding (`VirtualWindowSync`),
   * row-pin partitioning, visible-row feature controllers, styling-only
   * fast path, autosize, and display row counts — resolve through this
   * reader. Falls back to a plain-array reader over `currentSourceRows`
   * when no sort is active (identity RowView), so source order = display
   * order and the fallback is correct.
   *
   * Cached by source reference (`currentDisplayRowsSource`) so the same
   * reader instance is reused across renders when the underlying RowView
   * or fallback data array hasn't changed. This preserves the row-pinning
   * render model's reference-equality cache.
   */
  private currentDisplayRows: DisplayRowReader | null = null;
  /** Source reference used to build `currentDisplayRows` (RowView or RowData[]). */
  private currentDisplayRowsSource: RowView | RowData[] | null = null;
  /**
   * Universe view (all rows after sort, ignoring pagination) from
   * `snapshot.fullRowView`. Same reference as `currentRowView` when
   * pagination is disabled.
   */
  private currentFullRowView: RowView | null = null;
  /** Cached reader over `currentFullRowView` (by view reference). */
  private currentFullDisplayRows: DisplayRowReader | null = null;
  private currentFullDisplayRowsSource: RowView | null = null;
  private currentDataRevision = 0;
  private currentRenderChangeSet: RenderChangeSet | undefined;
  private currentRowSelection: RowSelectionConfig =
    normalizeRowSelection(undefined);
  private currentColumnSelection: ColumnSelectionConfig =
    normalizeColumnSelection(undefined);
  private currentColumnOrder: ColumnOrderConfig =
    normalizeColumnOrder(undefined);
  private currentRowDrag: RowDragNormalizedConfig =
    normalizeRowDrag(undefined);
  private currentSortModel: SortModel = [];
  private currentSortPending = false;

  private readonly rowPinRenderModelBuilder = createRowPinningRenderModelBuilder();
  /**
   * Last row pin state observed in {@link GridSnapshot.rowPinState}. The
   * renderer is a consumer — `GridState` is the source of truth. We keep the
   * last value so derived structures (e.g. lane DOM) survive across render
   * calls where the snapshot omits it (defaults to an empty object).
   */
  private currentRowPinState: RowPinState = {};
  private currentPinnedTopRows: PinnedRowEntry[] = [];
  private currentPinnedBottomRows: PinnedRowEntry[] = [];
  /**
   * Center → display index mapper. `null` means identity (no pins active) and
   * is the common case — no per-snapshot index array is allocated at all.
   * Length lives in {@link currentCenterRowCount}.
   */
  private currentCenterToDisplayIndex: ((centerIndex: number) => number) | null = null;
  private currentCenterRowCount = 0;
  /** Pagination footer; created lazily when pagination is enabled. */
  private paginationFooter: PaginationFooter | null = null;
  /** Last pagination snapshot for dirty-patch value equality check. */
  private lastPaginationSnapshot: GridPaginationSnapshot | null = null;
  /**
   * Last viewport height (px) written to `--lfg-viewport-height`. -1 forces
   * the first write. Updated only on mount + the rAF-coalesced viewport
   * resize callback — never on scroll.
   */
  private currentViewportHeight = -1;
  /**
   * Latest row-styling inputs from the snapshot. The renderer rebuilds a
   * single {@link PopulateRowOptions.resolveRowClasses} closure per render
   * pass from these inputs; pool rows compare {@link currentRowStylingVersion}
   * against their cached `lastRowClassVersion` to skip recompute.
   */
  private currentRowClass: string | string[] | undefined;
  private currentGetRowClass: GetRowClass | undefined;
  private currentRowClassRules: RowClassRules | undefined;
  private currentRowStylingVersion = 0;
  private currentHeaderAddonHeight = 0;
  /**
   * Whether any of the visible effective columns — across center, pinned-left,
   * and pinned-right lanes — currently carries cell-styling inputs
   * (`cellClass` / `getCellClass` / `cellClassRules`). When false, the
   * renderer passes no resolver so `populateRow` skips the cell-styling path
   * entirely (and drains any leftover managed classes).
   */
  private currentHasCellStyling = false;
  /**
   * Monotonic version that bumps whenever the effective column cell-styling
   * inputs change between renders. Forwarded to populateRow / rebindCells so a
   * cell-styling change can re-run the resolver on visible cells even when row
   * data is unchanged. A structural fingerprint string drives the bump.
   */
  private currentCellClassVersion = 0;
  private lastCellStylingFingerprint = "";
  /** Stable identity tags for cell-styling fingerprint (memoized refs → stable tag). */
  private readonly refTagMap = new WeakMap<object, string>();
  private refTagSeq = 0;
  /**
   * `true` after the first `render(snapshot)` completes. Gates the
   * styling-only fast path so it never runs before the pool / lanes exist.
   */
  private hasRenderedOnce = false;

  // ── Visible row binding index (Phase 5) ─────────────────────────────
  // Maps rowId → pool rows for O(1) dirty-patch lookups. Rebuilt after
  // every window sync, scroll sync, and lane sync. Arrays per rowId to
  // avoid unsafe uniqueness assumptions.
  private bodyRowsById = new Map<string, PooledRow[]>();
  private topPinnedRowsById = new Map<string, LaneRowBinding[]>();
  private bottomPinnedRowsById = new Map<string, LaneRowBinding[]>();

  // ── Internal instrumentation (test-only, not public API) ───────────
  /** @internal */ _fullRenderCount = 0;
  /** @internal */ _dirtyPatchRenderCount = 0;
  /** @internal */ _dirtyPatchedRowCount = 0;
  /** @internal */ _dirtySkippedInvisibleRowCount = 0;
  /** @internal */ _dirtyPatchLookupHitCount = 0;
  /** @internal */ _dirtyPatchLookupMissCount = 0;
  /** @internal */ _dirtyPatchIndexRebuildCount = 0;
  /** @internal */ _dirtyPatchPoolScanCount = 0;
  /** @internal */ _rowIndexRebuildCount = 0;
  private isDirtyPatching = false;
  /** Last snapshot received in render(). Read by the overlay feature getter. */
  private currentSnapshot: GridRenderSnapshot | null = null;
  private pinnedTopLaneState: PinnedRowLaneState | undefined;
  private pinnedBottomLaneState: PinnedRowLaneState | undefined;
  private readonly boundResolveRowId = (row: RowData, index: number): string =>
    this.options.resolveRowId(row, index);

  private scrollRafId = 0;
  private resizeRafId = 0;
  private resizeObserver: ResizeObserver | null = null;

  private readonly windowSync = new VirtualWindowSync();
  private readonly featureHost: DomFeatureHost;

  private readonly onViewportScroll = (): void => {
    if (this.scrollRafId !== 0) return;
    this.scrollRafId = requestAnimationFrame(() => {
      this.scrollRafId = 0;
      if (!this.skeleton) return;
      const result = this.windowSync.syncFromScroll(this.buildSyncContext());
      if (result.rowBindingsChanged) {
        this.rebuildRowIndex();
      }
      // Scroll syncs recycle pooled cells — re-apply focus visuals.
      this.featureHost.syncFocusState();
      this.featureHost.syncEditingState();
    });
  };

  constructor(options: GridContext) {
    this.options = options;
    this.featureHost = new DomFeatureHost({
      getPool: () => this.poolManager?.pool ?? [],
      getColumns: () => this.currentColumns,
      getDisplayRows: () => this.resolveDisplayRows(
        this.currentRowView, this.currentSourceRows,
      ),
      getFullDisplayRows: () => this.resolveFullDisplayRows(),
      ensureFieldVisible: (field) => this.ensureFieldVisible(field),
      getVisualRowLayout: () => this.getVisualRowLayout(),
      getCachedViewportHeight: () => this.currentViewportHeight,
      forEachRowPinnedLanePoolRow: (cb) =>
        this.forEachRowPinnedLanePoolRow(cb),
      forEachRowPinnedLogicalPoolRow: (cb) =>
        this.forEachRowPinnedLogicalPoolRow(cb),
      getLayoutMetrics: () => this.options.config.layoutMetrics,
      getSourceRows: () => this.currentSourceRows,
      getVisibleRowStart: () => this.windowSync.visibleRowStart,
      getColumnOrderConfig: () => this.currentColumnOrder,
      getRowDragConfig: () => this.currentRowDrag,
      notifyColumnOrderChanged: (e) => {
        this.options.actions.notifyColumnOrderChanged?.(e);
      },
      notifyRowOrderChanged: (e) => {
        this.options.actions.notifyRowOrderChanged?.(e);
      },
      commitRowOrder: (rowId, rowIds, insertionIndex, source) => {
        return this.options.actions.commitRowOrder?.(rowId, rowIds, insertionIndex, source) ?? null;
      },
      getRowSelectionConfig: () => this.currentRowSelection,
      getColumnSelectionConfig: () => this.currentColumnSelection,
      resolveRowId: (row, index) => this.options.resolveRowId(row, index),
      getHeaderRowEl: () => this.poolManager?.headerRowEl ?? null,
      getPinnedHeaderRowEl: () => this.poolManager?.pinnedHeaderRowEl ?? null,
      getPinnedRightHeaderRowEl: () => this.poolManager?.pinnedRightHeaderRowEl ?? null,
      getHeaderLaneRefs: () => this.poolManager?.getHeaderLaneRefs() ?? null,
      getColumnGroupHeaders: () => this.currentSnapshot?.columnGroupHeaders,
      getDataRevision: () => this.currentDataRevision,
      requestSync: () => {
        if (!this.skeleton || !this.poolManager) return;
        // Route through the lane-aware sync so row-pinned left/right sub-lanes
        // refresh when structural inputs change (resize-driven width changes
        // alone hit the lane fingerprint fast-path and skip the rebind work).
        // Selection / column-selection updates flow through their own dedicated
        // DOM walks below, so they do not need an extra lane rebind here.
        this.syncRowPinLanesAndWindow(this.currentColumns);
      },
      requestColumnTransformSync: () => this.applyColumnTransformSync(),
      commitResize: (field, width) => {
        this.options.actions.resizeColumn?.(field, width);
      },
      notifySelectionChanged: (change, source) => {
        // Selection visuals on normal pool rows are patched by the selection
        // controller via getPool(). Row-pinned sub-lane pool rows are not in
        // that pool, so refresh their selection visuals here.
        this.refreshRowPinLaneSelectionVisuals();
        this.options.actions.notifySelectionChanged?.(change, source);
      },
      notifyColumnSelectionChanged: (e) => {
        this.options.actions.notifyColumnSelectionChanged?.(e);
      },
      notifyFocusedCellChanged: (e) => {
        this.options.actions.notifyFocusedCellChanged?.(e);
      },
      notifyCellShellAction: (e) => {
        this.options.actions.notifyCellShellAction?.(e);
      },
      syncColumnSelectionClasses: () =>
        this.applyColumnSelectionClassesToVisibleDom(),
      getSortModel: () => this.currentSortModel,
      isSortPending: () => this.currentSortPending,
      toggleColumnSort: (field: string, opts: { multi: boolean; source: SortChangeSource }) => {
        this.options.actions.toggleColumnSort?.(field, opts);
      },
      setColumnSort: (field, direction, source, opts) => {
        this.options.actions.setColumnSort?.(field, direction, source, opts);
      },
      isRowReorderBlocked: () => this.currentSortModel.length > 0,
      pinColumn: (field, pinned, source) => {
        this.options.actions.pinColumn?.(field, pinned, source);
      },
      setColumnPinState: this.options.actions.setColumnPinState
        ? (state, source) => this.options.actions.setColumnPinState!(state, source)
        : undefined,
      hideColumns: this.options.actions.hideColumns
        ? (fields, source) => this.options.actions.hideColumns!(fields, source)
        : undefined,
      getMenuApi: this.options.actions.getMenuApi,
      getColumnMenuOptions: () => this.options.config.columnMenu,
      getCellRenderers: () => this.options.config.cellRenderers,
      getCellShellOverlays: () => this.options.config.cellShellOverlays,
      getCellMenuOptions: () => this.options.config.cellMenu,
      getCellMenuGridApi: () => ({
        getRows: () => this.currentSourceRows.slice(),
      }),
      getGridInstance: () => this.options.getGridInstance(),
      getFloatingFiltersOption: () => this.currentSnapshot?.floatingFilters,
      getOverlayState: () => {
        const snap = this.currentSnapshot;
        return {
          loading: snap?.loading ?? false,
          manualOverlay: snap?.manualOverlay ?? null,
          overlays: snap?.overlays,
        };
      },
      sizeColumnsToFit: this.options.actions.sizeColumnsToFit,
      sizeSelectedColumnsToFit: this.options.actions.sizeSelectedColumnsToFit,
      resetColumnWidths: this.options.actions.resetColumnWidths,
      autoSizeColumn: this.options.actions.autoSizeColumn,
      autoSizeSelectedColumns: this.options.actions.autoSizeSelectedColumns,
      getRowActionGridApi: () => ({ getRows: () => this.currentSourceRows }),
      getHeaderRenderers: () => this.options.config.headerRenderers,
      getHeaderActionGridApi: (): HeaderActionGridApi => ({
        getColumns: () => this.currentColumns,
        getSelectedColumnIds: () => this.featureHost.getSelectedColumnIds(),
      }),
      commitCellEdit: this.options.commitCellEdit
        ? (change) => this.options.commitCellEdit!(change)
        : undefined,
      notifyColumnMenuChanged: this.options.actions.notifyColumnMenuChanged,
      notifyOverlayPresentationChanged:
        this.options.actions.notifyOverlayPresentationChanged,
    });
  }

  /** Visible header + pool cells only — no VirtualWindowSync / data rebind. */
  private applyColumnSelectionClassesToVisibleDom(): void {
    if (!this.poolManager) return;
    const enabled = this.currentColumnSelection.enabled;
    const isSelected = enabled
      ? (field: string) => this.featureHost.isColumnSelectedField(field)
      : () => false;
    syncColumnSelectionDom(
      this.poolManager.headerRowEl,
      this.poolManager.pool,
      isSelected,
    );
    if (this.poolManager.pinnedHeaderRowEl) {
      syncColumnSelectionDom(
        this.poolManager.pinnedHeaderRowEl,
        [],
        isSelected,
      );
    }
    if (this.poolManager.pinnedRightHeaderRowEl) {
      syncColumnSelectionDom(
        this.poolManager.pinnedRightHeaderRowEl,
        [],
        isSelected,
      );
    }
    syncFloatingFilterColumnSelectionDom(
      this.skeleton?.root ?? null,
      isSelected,
    );
    // Row-pinned sub-lanes hold their own pool rows that are not part of
    // poolManager.pool — walk each lane's pool rows so column-selection class
    // toggles reach pinned-row cells too.
    this.applyColumnSelectionClassesToRowPinLane(this.pinnedTopLaneState, isSelected);
    this.applyColumnSelectionClassesToRowPinLane(this.pinnedBottomLaneState, isSelected);
  }

  private applyColumnSelectionClassesToRowPinLane(
    state: PinnedRowLaneState | undefined,
    isSelected: (field: string) => boolean,
  ): void {
    if (!state) return;
    // No header arg — lane sub-lanes have no headers of their own.
    syncColumnSelectionDom(null, state.centerPoolRows, isSelected);
    if (state.leftLayer) syncColumnSelectionDom(null, state.leftPoolRows, isSelected);
    if (state.rightLayer) syncColumnSelectionDom(null, state.rightPoolRows, isSelected);
  }

  /**
   * Patch row-selection visuals (lfg-row-selected class + selection checkbox)
   * onto every row-pinned lane pool row. The selection controller already
   * walks the main pool via getPool(); lane pool rows live outside that pool
   * and would otherwise miss selection-only updates without a full render.
   */
  private refreshRowPinLaneSelectionVisuals(): void {
    const apply = (row: PooledRow): void => {
      const rowId = row.rowId;
      if (!rowId) return;
      const selected = this.featureHost.isRowSelected(rowId);
      row.element.classList.toggle("lfg-row-selected", selected);
      const cb = row.element.querySelector(
        ".lfg-row-selection-checkbox",
      ) as HTMLInputElement | null;
      if (cb) cb.checked = selected;
    };
    forEachRowPinLanePoolRow(this.pinnedTopLaneState, apply);
    forEachRowPinLanePoolRow(this.pinnedBottomLaneState, apply);
  }

  mount(container: HTMLElement): void {
    this.skeleton = buildGridSkeleton(this.options.config.resolvedTheme);

    const { rowHeight, headerHeight } = this.options.config.layoutMetrics;
    this.skeleton.root.style.setProperty("--lfg-base-header-height", `${headerHeight}px`);
    this.skeleton.root.style.setProperty(
      "--lfg-header-height",
      `${headerHeight + this.currentHeaderAddonHeight}px`,
    );
    this.skeleton.root.style.setProperty("--lfg-row-height", `${rowHeight}px`);
    this.skeleton.root.style.setProperty("--lfg-floating-filter-height", `${rowHeight}px`);
    this.skeleton.root.style.setProperty("--lfg-row-pinned-top-height", "0px");
    this.skeleton.root.style.setProperty("--lfg-row-pinned-bottom-height", "0px");
    this.skeleton.root.style.setProperty("--lfg-viewport-height", "0px");
    container.appendChild(this.skeleton.root);

    this.poolManager = new DomPoolManager({
      skeleton: this.skeleton,
      getLayoutMetrics: () => this.options.config.layoutMetrics,
      suppressRowVirtualization: () =>
        !!this.options.config.suppressRowVirtualization,
      suppressColumnVirtualization: () =>
        !!this.options.config.suppressColumnVirtualization,
      onPoolCleared: () => {
        this.windowSync.invalidate();
        this.bodyRowsById.clear();
        this.topPinnedRowsById.clear();
        this.bottomPinnedRowsById.clear();
      },
    });

    this.featureHost.attach(
      this.skeleton.root,
      this.skeleton.viewport,
      this.skeleton.surface,
    );

    // Seed the viewport-height CSS variable on mount. Bottom row-pinned lanes
    // use sticky `top: calc(viewport-height - bottom-height)` instead of
    // `bottom: 0` because center body rows are absolutely positioned and do
    // not extend scrollContainer's natural flow, so `bottom: 0` would resolve
    // near the top of the scroll container. See the row-pinned bottom rules
    // in `themes/default.css`.
    this.syncViewportHeightVar();

    this.skeleton.viewport.addEventListener("scroll", this.onViewportScroll, {
      passive: true,
    });
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.onViewportResize();
      });
      this.resizeObserver.observe(this.skeleton.viewport);
    }
  }

  setTheme(resolved: ResolvedGridTheme): void {
    if (!this.skeleton) return;
    applyGridTheme(this.skeleton.root, resolved);

    const { rowHeight, headerHeight } = resolved.layoutMetrics;
    this.skeleton.root.style.setProperty("--lfg-base-header-height", `${headerHeight}px`);
    this.skeleton.root.style.setProperty("--lfg-header-height", `${headerHeight + this.currentHeaderAddonHeight}px`);
    this.skeleton.root.style.setProperty("--lfg-row-height", `${rowHeight}px`);
    this.skeleton.root.style.setProperty("--lfg-floating-filter-height", `${rowHeight}px`);
    this.syncHeaderAddonHeight();

    if (this.poolManager) {
      const neededRows = computeRowPoolSize(
        this.skeleton.viewport,
        this.currentCenterRowCount,
        !!this.options.config.suppressRowVirtualization,
        resolved.layoutMetrics,
      );
      if (neededRows !== this.poolManager.pool.length) {
        this.fullRebuild(this.currentColumns);
      } else {
        this.syncPool();
      }
      this.syncRowPinLanesAndWindow(this.currentColumns);
    }
  }

  /**
   * Single DOM-read point for `viewport.clientHeight` — invoked on mount and
   * from the existing viewport-resize rAF callback only. Never called from
   * the scroll path.
   */
  private syncViewportHeightVar(): void {
    if (!this.skeleton) return;
    const next = this.skeleton.viewport.clientHeight;
    if (next === this.currentViewportHeight) return;
    this.currentViewportHeight = next;
    this.skeleton.root.style.setProperty(
      "--lfg-viewport-height",
      `${next}px`,
    );
  }

  render(snapshot: GridRenderSnapshot): void {
    if (!this.skeleton || !this.poolManager) return;
    // Cache the latest snapshot so the overlay feature getter can read
    // loading/manualOverlay/overlays without a snapshot reference of its own.
    this.currentSnapshot = snapshot;

    // ── Styling-only fast path ──────────────────────────────────────────
    // GridState bumps `revision` on every state change EXCEPT row styling
    // (which only bumps `rowStylingVersion`). So when `dataRevision` is
    // unchanged but `rowStylingVersion` differs, the snapshot represents a
    // pure styling update — we don't need to run column reconciliation,
    // re-sync the row pin model, rebuild lanes, or hit the window sync
    // (which would bump `columnVersion` and force per-cell rebinds).
    //
    // Gated on `hasRenderedOnce` so it cannot fire before the first full
    // render has built the pool and lane state.
    const nextRowStylingVersion = snapshot.rowStylingVersion ?? 0;
    const isStylingOnly =
      this.hasRenderedOnce &&
      (snapshot.dataRevision ?? 0) === this.currentDataRevision &&
      nextRowStylingVersion !== this.currentRowStylingVersion;
    if (isStylingOnly) {
      this.applyRowStylingOnlyUpdate(snapshot, nextRowStylingVersion);
      // Overlays may depend on snapshot.loading / manualOverlay even when
      // the rest of the state is unchanged.
      this.featureHost.syncOverlays();
      return;
    }

    // ── Dirty-patch fast path (Phase 4) ──────────────────────────────────
    // For update-only transactions with render change metadata and unchanged
    // visual structure, patch only the visible changed rows instead of
    // running the full column-reconciliation → window-sync pipeline.
    if (this.hasRenderedOnce && snapshot.renderChangeSet !== undefined) {
      const plan = this.canDirtyPatch(snapshot);
      if (plan) {
        this.applyDirtyPatch(snapshot, plan);
        return;
      }
    }

    // ── Full render path ───────────────────────────────────────────────
    this.currentDataRevision = snapshot.dataRevision ?? 0;
    this.currentRenderChangeSet = snapshot.renderChangeSet;
    this.currentRowSelection =
      snapshot.rowSelection ?? normalizeRowSelection(undefined);
    this.currentColumnSelection =
      snapshot.columnSelection ?? normalizeColumnSelection(undefined);
    this.currentColumnOrder =
      snapshot.columnOrder ?? normalizeColumnOrder(undefined);
    this.currentRowDrag =
      snapshot.rowDrag ?? normalizeRowDrag(undefined);
    this.currentSortModel = snapshot.sortModel ?? [];
    this.currentSortPending = snapshot.sortPending ?? false;
    // Row pin state flows through the snapshot from GridState — renderer is a
    // pure consumer. `GridState.getSnapshot()` always sets `rowPinState`
    // (`undefined` when no rows are pinned), so we always reset to the
    // snapshot value instead of preserving stale state.
    this.currentRowPinState = snapshot.rowPinState ?? {};
    // Row styling — `GridState.getSnapshot()` always includes both fields.
    this.currentRowClass = snapshot.rowStyling?.rowClass;
    this.currentGetRowClass = snapshot.rowStyling?.getRowClass;
    this.currentRowClassRules = snapshot.rowStyling?.rowClassRules;
    this.currentRowStylingVersion = snapshot.rowStylingVersion ?? 0;

    const { columns: rawColumns, columnSchemaProvided } = snapshot;

    // Source rows — always from the RowView (which owns the raw rows ref).
    this.currentSourceRows = snapshot.rowView.rows;
    // Store the row view and resolve the display-row reader (cached by
    // source reference). All hot rendering paths resolve rows through
    // this reader; fallback uses source rows (= display order when no
    // sort is active and RowView has identity mapping).
    this.currentRowView = snapshot.rowView;
    this.currentFullRowView = snapshot.fullRowView ?? snapshot.rowView;
    const effectiveDisplayRows = this.resolveDisplayRows(
      snapshot.rowView, this.currentSourceRows,
    );
    const rowPinModel = this.rowPinRenderModelBuilder(
      effectiveDisplayRows,
      this.currentRowPinState,
      this.boundResolveRowId,
    );
    const previousCenterRowCount = this.currentCenterRowCount;
    const nextCenterRowCount = rowPinModel.centerRowCount;
    // Capture before reconcileColumnLayout/syncPool writes the reduced
    // scroll-container height. No viewport geometry read is needed here.
    const scrollTopBeforeReduction = nextCenterRowCount < previousCenterRowCount
      ? this.skeleton.viewport.scrollTop
      : null;
    this.currentPinnedTopRows = rowPinModel.top;
    this.currentPinnedBottomRows = rowPinModel.bottom;
    this.currentCenterToDisplayIndex = rowPinModel.centerToDisplayIndex;
    this.currentCenterRowCount = nextCenterRowCount;

    const userColumns = snapshotUserColumns(
      { columns: rawColumns, columnSchemaProvided },
      this.currentSourceRows,
    );
    this.currentUserColumns = userColumns;
    const renderedColumns = this.featureHost.transformColumns(userColumns);
    // Footer first: adding/removing it changes the viewport height, so it
    // must be in the DOM before pool sizing and the virtual window sync
    // measure the viewport below.
    this.syncPaginationFooter(snapshot.pagination);
    this.lastPaginationSnapshot = snapshot.pagination ?? null;
    this.reconcileColumnLayout(renderedColumns);
    // Recompute cell-styling presence + version from the final center columns
    // (after transforms / reconciliation). Must run before the window sync so
    // the sync context carries the correct resolver + version.
    this.refreshCellStylingState();
    // Sync floating filters and header addon height before the window sync
    // so row positioning uses the effective header height on the first frame.
    this.featureHost.syncFloatingFilters();
    this.syncHeaderAddonHeight();
    this.clampVerticalScrollAfterRowCountReduction(
      previousCenterRowCount,
      scrollTopBeforeReduction,
    );
    this.syncRowPinLanesAndWindow(renderedColumns);
    // Change metadata is consumed by this render; clear so scroll-driven
    // syncs don't apply stale skip logic.
    this.currentRenderChangeSet = undefined;
    this.featureHost.syncRowDragConfig();
    this.featureHost.syncColumnOrderConfig();
    this.featureHost.syncColumnSelectionFromConfig();
    this.featureHost.syncSelectionMode();
    this.featureHost.syncSortState();
    this.featureHost.syncFilterIndicatorState();
    // Re-validate the focused cell against the new row view/columns and
    // re-apply visuals onto recycled cells.
    this.featureHost.syncFocusState();
    this.featureHost.syncEditingState();
    this.featureHost.syncOverlays();
    this._fullRenderCount++;
    this.hasRenderedOnce = true;
  }

  /**
   * Render path for snapshots where the ONLY change is `rowStylingVersion`.
   *
   * Skips column reconciliation, row-pin model rebuild, lane DOM rebuild,
   * and `windowSync.sync()` (which would force a full horizontal reset and
   * bump `columnVersion`, triggering per-cell re-binds). Just walks the
   * currently-bound pool rows and applies the managed-class diff.
   *
   * Selection / column-selection visuals are independent and continue to
   * flow through their own dedicated DOM walks.
   */
  private applyRowStylingOnlyUpdate(
    snapshot: GridRenderSnapshot,
    nextVersion: number,
  ): void {
    // Refresh the styling inputs FIRST so the resolver closure captures the
    // new values.
    this.currentRowClass = snapshot.rowStyling?.rowClass;
    this.currentGetRowClass = snapshot.rowStyling?.getRowClass;
    this.currentRowClassRules = snapshot.rowStyling?.rowClassRules;
    this.currentRowStylingVersion = nextVersion;

    const resolver = this.buildRowClassResolver();

    // Center body pool — every currently-bound row gets its managed classes
    // refreshed. populateRow's cell-rebind path is bypassed entirely.
    for (const poolRow of this.poolManager!.pool) {
      if (poolRow.rowIndex < 0 || poolRow.rowId === null) continue;
      const row = this.getDisplayRow(poolRow.rowIndex);
      if (row === undefined) continue;
      applyRowStylingOnly(poolRow, row, resolver, nextVersion);
    }

    // Row-pinned top + bottom lanes — apply to center / left / right pool
    // rows directly, and bump the lane fingerprint so the next full render
    // (via `syncRowPinLaneDom`) takes the fingerprint-match fast path.
    this.applyRowStylingOnlyToLane(this.pinnedTopLaneState, resolver, nextVersion);
    this.applyRowStylingOnlyToLane(this.pinnedBottomLaneState, resolver, nextVersion);
  }

  private applyRowStylingOnlyToLane(
    state: PinnedRowLaneState | undefined,
    resolver: ResolveRowClassesFn | undefined,
    nextVersion: number,
  ): void {
    if (!state) return;
    const applyPool = (pool: PooledRow[]): void => {
      for (const poolRow of pool) {
        if (poolRow.rowIndex < 0 || poolRow.rowId === null) continue;
        const row = this.getDisplayRow(poolRow.rowIndex);
        if (row === undefined) continue;
        applyRowStylingOnly(poolRow, row, resolver, nextVersion);
      }
    };
    applyPool(state.centerPoolRows);
    applyPool(state.leftPoolRows);
    applyPool(state.rightPoolRows);
    // Bump the lane fingerprint so subsequent full-path renders' fingerprint
    // check matches and skips the lane rebind work entirely.
    state.lastRowClassVersion = nextVersion;
  }

  // ── Phase 4: Targeted dirty-patch ───────────────────────────────────

  /**
   * Guard: can the dirty-patch fast path handle this snapshot?
   * Returns `false` if any visual structure changed, forcing a full render.
   *
   * IMPORTANT: this method is pure — it must not mutate any renderer state.
   * All state commits happen in {@link applyDirtyPatch} or the full render.
   */
  private canDirtyPatch(snapshot: GridRenderSnapshot): DirtyPatchPlan | null {
    // Column structure must be identical.
    const userColumns = snapshotUserColumns(
      { columns: snapshot.columns, columnSchemaProvided: snapshot.columnSchemaProvided },
      snapshot.rowView.rows,
    );
    const renderedColumns = this.featureHost.transformColumns(userColumns);
    if (!columnsStructureMatch(this.currentColumns, renderedColumns)) return null;
    if (!columnsWidthMatch(this.currentColumns, renderedColumns)) return null;

    // Row selection / column selection / column order / row drag config unchanged.
    const nextRowSel = snapshot.rowSelection ?? normalizeRowSelection(undefined);
    const nextColSel = snapshot.columnSelection ?? normalizeColumnSelection(undefined);
    const nextColOrder = snapshot.columnOrder ?? normalizeColumnOrder(undefined);
    const nextRowDrag = snapshot.rowDrag ?? normalizeRowDrag(undefined);
    if (nextRowSel !== this.currentRowSelection) return null;
    if (nextColSel !== this.currentColumnSelection) return null;
    if (nextColOrder !== this.currentColumnOrder) return null;
    if (nextRowDrag !== this.currentRowDrag) return null;

    // Sort model / sort pending unchanged.
    if (snapshot.sortModel !== this.currentSortModel) return null;
    if ((snapshot.sortPending ?? false) !== this.currentSortPending) return null;

    // Row pin state — value equality (getRowPinMap returns a new object each snapshot).
    if (!this.rowPinStateEqual(snapshot.rowPinState)) return null;

    // Row styling version unchanged.
    if ((snapshot.rowStylingVersion ?? 0) !== this.currentRowStylingVersion) return null;

    // Row view count unchanged (no structural add/remove). Use rowCount
    // from the RowView (display row count after sort/pagination) rather
    // than raw source array length.
    if (snapshot.rowView.rowCount !== (this.currentRowView?.rowCount ?? this.currentSourceRows.length)) return null;

    // Pagination state unchanged (full value check, not just enabled flag).
    if (!this.paginationEqual(snapshot.pagination)) return null;

    // Cell-styling fingerprint: compute WITHOUT mutating state.
    const pinningLayout = buildColumnPinningLayout(renderedColumns);
    if (this.computeCellStylingFingerprint(pinningLayout) !== this.lastCellStylingFingerprint) return null;

    return { userColumns, renderedColumns, pinningLayout };
  }

  private rowPinStateEqual(nextRaw: RowPinState | undefined): boolean {
    const next = nextRaw ?? {};
    const prev = this.currentRowPinState;
    const nextKeys = Object.keys(next);
    const prevKeys = Object.keys(prev);
    if (nextKeys.length !== prevKeys.length) return false;
    for (const key of nextKeys) {
      if (next[key] !== prev[key]) return false;
    }
    return true;
  }

  private paginationEqual(next: GridPaginationSnapshot | undefined): boolean {
    const hadPagination = this.paginationFooter !== null;
    const hasPagination = next?.enabled ?? false;
    if (hadPagination !== hasPagination) return false;
    if (!hasPagination) return true;
    // Both enabled — compare the fields that affect visible rows.
    if (!this.lastPaginationSnapshot) return false;
    const prev = this.lastPaginationSnapshot;
    return (
      next!.pageIndex === prev.pageIndex &&
      next!.pageSize === prev.pageSize &&
      next!.pageCount === prev.pageCount &&
      next!.startRow === prev.startRow &&
      next!.endRow === prev.endRow
    );
  }

  /**
   * Compute the cell-styling fingerprint string for a candidate pinning
   * layout WITHOUT mutating renderer state. Used by {@link canDirtyPatch}
   * to check whether cell-styling inputs changed.
   */
  private computeCellStylingFingerprint(
    layout: ReturnType<typeof buildColumnPinningLayout>,
  ): string {
    let fp = "";
    const scan = (group: ColumnDef[], tag: string): void => {
      for (let i = 0; i < group.length; i++) {
        const col = group[i]!;
        const hasCellClass = col.cellClass !== undefined;
        const hasGetCellClass = col.getCellClass !== undefined;
        const hasRules = col.cellClassRules !== undefined;
        if (!hasCellClass && !hasGetCellClass && !hasRules) continue;
        fp += `${tag}:${col.field}|${hasCellClass ? this.refTag(col.cellClass) : "-"}|`
          + `${hasGetCellClass ? this.refTag(col.getCellClass) : "-"}|`
          + `${hasRules ? this.refTag(col.cellClassRules) : "-"};`;
      }
    };
    scan(layout.leftPinned, "L");
    scan(layout.center, "C");
    scan(layout.rightPinned, "R");
    return fp;
  }

  /**
   * Targeted dirty-patch: update only visible changed rows using the
   * rowId binding index — O(changedRows), not O(visibleRows).
   */
  private applyDirtyPatch(snapshot: GridRenderSnapshot, plan: DirtyPatchPlan): void {
    const changeSet = snapshot.renderChangeSet!;
    const changedRows = changeSet.changedFieldsByRowId;
    this._dirtyPatchRenderCount++;
    this.isDirtyPatching = true;
    try {
      // Commit column state from the plan — already computed by canDirtyPatch.
      this.currentUserColumns = plan.userColumns;
      this.currentColumns = plan.renderedColumns;
      const pm = this.poolManager!;
      pm.pinningLayout = plan.pinningLayout;
      this.refreshCellStylingState();

      // Update renderer state so subsequent scroll syncs use latest data.
      this.currentDataRevision = snapshot.dataRevision ?? 0;
      this.currentSourceRows = snapshot.rowView.rows;
      this.currentRowView = snapshot.rowView;
      this.currentFullRowView = snapshot.fullRowView ?? snapshot.rowView;
      this.resolveDisplayRows(snapshot.rowView, this.currentSourceRows);
      this.currentSnapshot = snapshot;

      const pinLayout = pm.pinningLayout;
      const resolveRowClasses = this.buildRowClassResolver();
      const resolveCellClasses = this.buildCellClassResolver();
      const colSel = this.currentColumnSelection;
      const isColSelected = colSel.enabled
        ? (field: string) => this.featureHost.isColumnSelectedField(field)
        : undefined;
      const centerColumns = pinLayout.center;
      const colWin = this.windowSync.getLastColumnWindow();
      const colVer = this.windowSync.getColumnVersion();

      // ── Iterate changed rows, not the full pool ─────────────────────────
      for (const [rowId, changedFields] of changedRows) {
        let hit = false;

        // Body pool rows (O(1) lookup).
        const bodyBindings = this.bodyRowsById.get(rowId);
        if (bodyBindings) {
          for (const poolRow of bodyBindings) {
            const displayIndex = poolRow.rowIndex;
            const rowData = this.getDisplayRow(displayIndex);
            if (rowData === undefined) continue;

            populateRow(poolRow, rowData, centerColumns, displayIndex,
              colWin!, {
                dataRevision: this.currentDataRevision,
                columnVersion: colVer,
                getRowId: this.boundResolveRowId,
                isRowSelected: (id) => this.featureHost.isRowSelected(id),
                isColumnSelected: isColSelected,
                resolveRowClasses,
                rowClassVersion: this.currentRowStylingVersion,
                resolveCellClasses,
                cellClassVersion: this.currentCellClassVersion,
                cellRenderers: this.options.config.cellRenderers,
                changedRows,
              });

            if (pinLayout.leftPinned.length > 0 && poolRow.pinnedElement) {
              syncPinnedRowCells(
                poolRow, rowData, pinLayout.leftPinned, displayIndex,
                this.boundResolveRowId,
                (id) => this.featureHost.isRowSelected(id),
                isColSelected, "left",
                resolveCellClasses, this.currentCellClassVersion,
                changedFields,
                this.options.config.cellRenderers,
              );
            }
            if (pinLayout.rightPinned.length > 0 && poolRow.rightPinnedElement) {
              syncPinnedRowCells(
                poolRow, rowData, pinLayout.rightPinned, displayIndex,
                this.boundResolveRowId,
                (id) => this.featureHost.isRowSelected(id),
                isColSelected, "right",
                resolveCellClasses, this.currentCellClassVersion,
                changedFields,
                this.options.config.cellRenderers,
              );
            }

            this._dirtyPatchedRowCount++;
            hit = true;
          }
        }

        // Top pinned lane rows (O(1) lookup).
        const topBindings = this.topPinnedRowsById.get(rowId);
        if (topBindings) {
          for (const b of topBindings) {
            this.patchLaneBinding(
              b, changedFields, centerColumns, colWin, colVer,
              resolveRowClasses, resolveCellClasses, isColSelected, pinLayout, changedRows,
            );
            hit = true;
          }
        }

        // Bottom pinned lane rows (O(1) lookup).
        const bottomBindings = this.bottomPinnedRowsById.get(rowId);
        if (bottomBindings) {
          for (const b of bottomBindings) {
            this.patchLaneBinding(
              b, changedFields, centerColumns, colWin, colVer,
              resolveRowClasses, resolveCellClasses, isColSelected, pinLayout, changedRows,
            );
            hit = true;
          }
        }

        if (hit) {
          this._dirtyPatchLookupHitCount++;
        } else {
          this._dirtyPatchLookupMissCount++;
          this._dirtySkippedInvisibleRowCount++;
        }
      }
    } finally {
      this.isDirtyPatching = false;
    }

    // Clear change metadata so scroll syncs don't apply stale skip logic.
    this.currentRenderChangeSet = undefined;
    this.featureHost.syncOverlays();
  }

  private patchLaneBinding(
    b: LaneRowBinding,
    changedFields: ReadonlySet<string> | undefined,
    centerColumns: ColumnDef[],
    colWin: ReturnType<VirtualWindowSync["getLastColumnWindow"]>,
    colVer: number,
    resolveRowClasses: ResolveRowClassesFn | undefined,
    resolveCellClasses: ResolveCellClassesFn | undefined,
    isColSelected: ((field: string) => boolean) | undefined,
    pinLayout: { leftPinned: ColumnDef[]; rightPinned: ColumnDef[] },
    changedRows: ReadonlyMap<string, ReadonlySet<string>>,
  ): void {
    const { entry, centerPoolRow, leftPoolRow, rightPoolRow } = b;

    // Resolve fresh row data from the display reader — the entry may hold
    // a stale reference from before the transaction.
    const freshRow = this.getDisplayRow(entry.displayIndex);
    if (freshRow !== undefined) {
      entry.row = freshRow;
    }
    const rowData = entry.row;

    if (colWin) {
      populateRow(centerPoolRow, rowData, centerColumns, entry.displayIndex, colWin, {
        dataRevision: this.currentDataRevision,
        columnVersion: colVer,
        getRowId: this.boundResolveRowId,
        isRowSelected: (id) => this.featureHost.isRowSelected(id),
        isColumnSelected: isColSelected,
        resolveRowClasses,
        rowClassVersion: this.currentRowStylingVersion,
        resolveCellClasses,
        cellClassVersion: this.currentCellClassVersion,
        cellRenderers: this.options.config.cellRenderers,
        changedRows,
      });
    }

    if (leftPoolRow && pinLayout.leftPinned.length > 0) {
      syncPinnedRowCells(
        leftPoolRow, rowData, pinLayout.leftPinned, entry.displayIndex,
        this.boundResolveRowId,
        (id) => this.featureHost.isRowSelected(id),
        isColSelected, "left",
        resolveCellClasses, this.currentCellClassVersion,
        changedFields,
        this.options.config.cellRenderers,
      );
    }
    if (rightPoolRow && pinLayout.rightPinned.length > 0) {
      syncPinnedRowCells(
        rightPoolRow, rowData, pinLayout.rightPinned, entry.displayIndex,
        this.boundResolveRowId,
        (id) => this.featureHost.isRowSelected(id),
        isColSelected, "right",
        resolveCellClasses, this.currentCellClassVersion,
        changedFields,
        this.options.config.cellRenderers,
      );
    }

    this._dirtyPatchedRowCount++;
  }

  /**
   * Rebuild the rowId → pool-row binding indexes from current pool and
   * lane state. Called after every window sync, scroll sync, lane rebuild,
   * and resize so the dirty-patch path can look up bindings in O(1).
   */
  private rebuildRowIndex(): void {
    this._rowIndexRebuildCount++;
    if (this.isDirtyPatching) {
      this._dirtyPatchIndexRebuildCount++;
      this._dirtyPatchPoolScanCount++;
    }
    const body = this.bodyRowsById;
    body.clear();
    if (this.poolManager) {
      for (const poolRow of this.poolManager.pool) {
        if (poolRow.rowId === null || poolRow.rowIndex < 0) continue;
        let arr = body.get(poolRow.rowId);
        if (!arr) { arr = []; body.set(poolRow.rowId, arr); }
        arr.push(poolRow);
      }
    }

    this.rebuildLaneIndex(
      this.topPinnedRowsById,
      this.pinnedTopLaneState,
      this.currentPinnedTopRows,
    );
    this.rebuildLaneIndex(
      this.bottomPinnedRowsById,
      this.pinnedBottomLaneState,
      this.currentPinnedBottomRows,
    );
  }

  private rebuildLaneIndex(
    index: Map<string, LaneRowBinding[]>,
    state: PinnedRowLaneState | undefined,
    entries: PinnedRowEntry[],
  ): void {
    if (this.isDirtyPatching) this._dirtyPatchIndexRebuildCount++;
    index.clear();
    if (!state) return;
    const centerPool = state.centerPoolRows;
    for (let i = 0; i < centerPool.length; i++) {
      const poolRow = centerPool[i]!;
      if (poolRow.rowId === null) continue;
      const entry = entries[i];
      if (!entry) continue;
      const binding: LaneRowBinding = {
        entry,
        centerPoolRow: poolRow,
        leftPoolRow: state.leftPoolRows[i] ?? null,
        rightPoolRow: state.rightPoolRows[i] ?? null,
      };
      let arr = index.get(poolRow.rowId);
      if (!arr) { arr = []; index.set(poolRow.rowId, arr); }
      arr.push(binding);
    }
  }

  /**
   * After a renderer-driven column order change, re-run transforms from the last
   * snapshot user columns so {@link ColumnOrderStore} order reaches the pool/DOM.
   */
  private applyColumnTransformSync(): void {
    if (!this.skeleton || !this.poolManager) return;
    const renderedColumns = this.featureHost.transformColumns(
      this.currentUserColumns,
    );
    this.reconcileColumnLayout(renderedColumns);
    this.refreshCellStylingState();
    this.syncRowPinLanesAndWindow(renderedColumns);
    this.featureHost.syncColumnSelectionFromConfig();
    this.featureHost.syncSelectionMode();
  }

  /**
   * Create/update/remove the pagination footer to match the snapshot.
   * The footer lives in the grid root below the viewport; the root's
   * flex column layout shrinks the viewport automatically and the
   * viewport ResizeObserver keeps `--lfg-viewport-height` in sync.
   */
  private syncPaginationFooter(
    pagination: GridPaginationSnapshot | undefined,
  ): void {
    if (!this.skeleton) return;
    if (!pagination || !pagination.enabled) {
      if (this.paginationFooter) {
        this.paginationFooter.destroy();
        this.paginationFooter = null;
      }
      return;
    }
    if (!this.paginationFooter) {
      this.paginationFooter = new PaginationFooter({
        setPageIndex: (pageIndex, source) => {
          this.options.actions.setPageIndex?.(pageIndex, source);
        },
        setPageSize: (pageSize, source) => {
          this.options.actions.setPageSize?.(pageSize, source);
        },
      });
      this.skeleton.root.appendChild(this.paginationFooter.element);
    }
    this.paginationFooter.sync(pagination);
  }

  private reconcileColumnLayout(renderedColumns: ColumnDef[]): void {
    if (!this.skeleton || !this.poolManager) return;

    const structureChanged = !columnsStructureMatch(
      this.currentColumns,
      renderedColumns,
    );
    const widthChanged = !columnsWidthMatch(
      this.currentColumns,
      renderedColumns,
    );

    if (structureChanged) {
      this.fullRebuild(renderedColumns);
    } else if (widthChanged) {
      const pm = this.poolManager!;
      pm.pinningLayout = buildColumnPinningLayout(renderedColumns);
      applyColumnWidthVars(
        this.skeleton.root, renderedColumns, null,
        pm.pinningLayout,
      );
      const newCenterSlots = computeCenterSlotCount(
        this.skeleton.viewport,
        pm.pinningLayout,
        !!this.options.config.suppressColumnVirtualization,
      );
      if (newCenterSlots !== pm.centerSlotCount) {
        this.fullRebuild(renderedColumns);
      } else {
        this.syncPool();
      }
    } else {
      this.poolManager!.pinningLayout = buildColumnPinningLayout(renderedColumns);
      this.syncPool();
    }

    this.currentColumns = renderedColumns;
  }

  /**
   * Build/refresh both row-pinned lane DOMs. The lane derives left/center/right
   * column lists from {@link DomPoolManager.pinningLayout}, so no `columns`
   * arg is needed here — keeping it would only invite leaking column-pinning
   * business logic into row-pinning helpers.
   */
  /**
   * @param resolveRowClasses — optional pre-built row-class resolver. When
   *   omitted the method builds one itself; pass-through is used by
   *   {@link syncRowPinLanesAndWindow} so lane sync and window sync share a
   *   single closure per render path.
   * @param resolveCellClasses — optional pre-built cell-class resolver. Same
   *   shared-reference pattern. Passing this through `bindOptions` is what
   *   wires cell styling into the row-pinned LEFT and RIGHT sub-lanes,
   *   which are bound entirely inside `rowPinLaneDom` (VirtualWindowSync
   *   never sees them).
   */
  private syncRowPinLanes(
    resolveRowClasses?: ResolveRowClassesFn,
    resolveCellClasses?: ResolveCellClassesFn,
  ): void {
    if (!this.skeleton || !this.poolManager) return;
    const pm = this.poolManager;
    const centerSlotCount = pm.centerSlotCount;
    const pinningLayout = pm.pinningLayout;
    const colSel = this.currentColumnSelection;
    const rowResolver = resolveRowClasses ?? this.buildRowClassResolver();
    const cellResolver = resolveCellClasses ?? this.buildCellClassResolver();
    const bindOptions = {
      dataRevision: this.currentDataRevision,
      getRowId: this.boundResolveRowId,
      isRowSelected: (rowId: string) => this.featureHost.isRowSelected(rowId),
      isColumnSelected: colSel.enabled
        ? (field: string) => this.featureHost.isColumnSelectedField(field)
        : undefined,
      resolveRowClasses: rowResolver,
      rowClassVersion: this.currentRowStylingVersion,
      resolveCellClasses: cellResolver,
      cellClassVersion: this.currentCellClassVersion,
      cellRenderers: this.options.config.cellRenderers,
      changedRows: this.currentRenderChangeSet?.changedFieldsByRowId,
    };

    const metrics = this.options.config.layoutMetrics;
    this.pinnedTopLaneState = syncRowPinLaneDom(
      this.skeleton, this.currentPinnedTopRows, pinningLayout, centerSlotCount,
      "top", this.pinnedTopLaneState, bindOptions, metrics,
    );
    this.pinnedBottomLaneState = syncRowPinLaneDom(
      this.skeleton, this.currentPinnedBottomRows, pinningLayout, centerSlotCount,
      "bottom", this.pinnedBottomLaneState, bindOptions, metrics,
    );

    const rh = this.options.config.layoutMetrics.rowHeight;
    const topH = this.currentPinnedTopRows.length * rh;
    const bottomH = this.currentPinnedBottomRows.length * rh;
    this.skeleton.root.style.setProperty("--lfg-row-pinned-top-height", `${topH}px`);
    this.skeleton.root.style.setProperty("--lfg-row-pinned-bottom-height", `${bottomH}px`);
  }

  /**
   * Rebuild the DOM pool, column layout, and scroll height only.
   *
   * Does NOT run a window sync — the caller is responsible for readying the
   * row-pinned lanes and then issuing a single {@link syncRowPinLanesAndWindow}
   * so the final sync sees lane pool rows for the current horizontal window.
   *
   * Row count comes from `currentCenterRowCount` (display rows minus pinned),
   * not from `currentSourceRows.length`.
   */
  private fullRebuild(columns: ColumnDef[]): void {
    const rh = this.options.config.layoutMetrics.rowHeight;
    const topH = this.currentPinnedTopRows.length * rh;
    const bottomH = this.currentPinnedBottomRows.length * rh;
    this.poolManager!.rebuild(columns, this.currentCenterRowCount, topH, bottomH);
  }

  /**
   * Update scroll height / pool sizing only. Like {@link fullRebuild}, this does
   * not run a window sync; the caller drives lane prep + the single final sync.
   */
  private syncHeaderAddonHeight(): void {
    if (!this.skeleton) return;
    const addon = this.featureHost.getHeaderAddonHeight();
    if (addon !== this.currentHeaderAddonHeight) {
      this.currentHeaderAddonHeight = addon;
      const base = this.options.config.layoutMetrics.headerHeight;
      this.skeleton.root.style.setProperty("--lfg-header-height", `${base + addon}px`);
      this.syncPool();
    }
  }

  private syncPool(): void {
    const rh = this.options.config.layoutMetrics.rowHeight;
    const topH = this.currentPinnedTopRows.length * rh;
    const bottomH = this.currentPinnedBottomRows.length * rh;
    this.poolManager!.updateScrollHeight(this.currentCenterRowCount, topH, bottomH, this.currentHeaderAddonHeight);
  }

  /**
   * Keep a stale deep vertical offset inside the new content range after a
   * generic displayed-row reduction. Uses only cached/known geometry and the
   * scrollTop captured before the reduced height was written.
   */
  private clampVerticalScrollAfterRowCountReduction(
    previousCenterRowCount: number,
    scrollTopBeforeReduction: number | null,
  ): void {
    if (!this.skeleton || scrollTopBeforeReduction === null) return;
    const { rowHeight, headerHeight } = this.options.config.layoutMetrics;
    const nextScrollTop = clampScrollTopAfterRowCountReduction({
      previousCenterRowCount,
      centerRowCount: this.currentCenterRowCount,
      currentScrollTop: scrollTopBeforeReduction,
      cachedViewportHeight: this.currentViewportHeight,
      rowHeight,
      headerHeight,
      headerAddonHeight: this.currentHeaderAddonHeight,
      topPinnedHeight: this.currentPinnedTopRows.length * rowHeight,
      bottomPinnedHeight: this.currentPinnedBottomRows.length * rowHeight,
    });
    if (nextScrollTop < scrollTopBeforeReduction) {
      this.skeleton.viewport.scrollTop = nextScrollTop;
    }
  }

  /**
   * Ready the row-pinned lane DOM (so {@link PinnedRowLaneState.poolRows} exist),
   * then run exactly one window sync. At this point the sync context carries the
   * lane pool rows, so the lane cells bind to the current horizontal column
   * window instead of the identity (first-columns) window.
   */
  private syncRowPinLanesAndWindow(columns?: ColumnDef[]): void {
    // Build the row-class AND cell-class resolvers once per render path and
    // reuse them for both row-pinned lane sync and the final window sync.
    // Avoids the cost of creating four identical closures (two for row + two
    // for cell) and keeps the lane fingerprint and window-sync inputs
    // referentially identical for this render.
    const resolveRowClasses = this.buildRowClassResolver();
    const resolveCellClasses = this.buildCellClassResolver();
    this.syncRowPinLanes(resolveRowClasses, resolveCellClasses);
    this.windowSync.sync(
      this.buildSyncContext(columns, resolveRowClasses, resolveCellClasses),
    );
    this.poolManager!.syncPinnedBodyHeight(this.currentCenterRowCount);
    this.rebuildRowIndex();
  }

  private buildSyncContext(
    columns?: ColumnDef[],
    resolveRowClasses?: ResolveRowClassesFn,
    resolveCellClasses?: ResolveCellClassesFn,
  ): WindowSyncContext {
    const sk = this.skeleton!;
    const pm = this.poolManager!;
    const colSel = this.currentColumnSelection;
    return createWindowSyncContext({
      skeleton: sk,
      pool: pm.pool,
      headerRowEl: pm.headerRowEl,
      pinnedHeaderRowEl: pm.pinnedHeaderRowEl,
      pinnedRightHeaderRowEl: pm.pinnedRightHeaderRowEl,
      columns: columns ?? this.currentColumns,
      displayRows: this.resolveDisplayRows(
        this.currentRowView, this.currentSourceRows,
      ),
      columnSlotCount: pm.columnSlotCount,
      dataRevision: this.currentDataRevision,
      suppressRowVirtualization: !!this.options.config.suppressRowVirtualization,
      suppressColumnVirtualization:
        !!this.options.config.suppressColumnVirtualization,
      resolveRowId: (row, index) => this.options.resolveRowId(row, index),
      isRowSelected: (rowId) => this.featureHost.isRowSelected(rowId),
      isColumnSelected: colSel.enabled
        ? (field) => this.featureHost.isColumnSelectedField(field)
        : undefined,
      resizeOverride: this.featureHost.getResizeOverride(),
      resizeLayoutCtrl: this.featureHost.getResizeLayoutControl(),
      rowSelection: this.currentRowSelection,
      refreshHeaderSelectionState: () =>
        this.featureHost.refreshHeaderSelectionState(),
      refreshHeaderSortState: () => this.featureHost.syncSortState(),
      refreshHeaderFilterState: () => this.featureHost.syncFilterIndicatorState(),
      pinningLayout: pm.pinningLayout,
      centerSlotCount: pm.centerSlotCount,
      resolveHeaderControls: this.resolveHeaderControls(),
      // Null = identity mapping; downstream skips per-index lookups.
      centerRowCount: this.currentCenterRowCount,
      centerToDisplayIndex: this.currentCenterToDisplayIndex ?? undefined,
      pinnedTopRows: this.currentPinnedTopRows,
      pinnedBottomRows: this.currentPinnedBottomRows,
      pinnedTopLaneRows: this.pinnedTopLaneState?.centerPoolRows,
      pinnedBottomLaneRows: this.pinnedBottomLaneState?.centerPoolRows,
      // Row styling closure — built once per sync; populateRow only invokes it
      // for actually-bound (visible) rows. Caller may supply a pre-built
      // resolver so lane sync and window sync share the same closure ref.
      resolveRowClasses: resolveRowClasses ?? this.buildRowClassResolver(),
      rowClassVersion: this.currentRowStylingVersion,
      // Cell styling closure — wired through center body, pinned-left/right
      // body cells, AND row-pinned top/bottom center + left/right sub-lanes.
      // Caller may supply a pre-built closure for ref-stable reuse across
      // lane sync + window sync within one render path.
      resolveCellClasses: resolveCellClasses ?? this.buildCellClassResolver(),
      cellClassVersion: this.currentCellClassVersion,
      cellRenderers: this.options.config.cellRenderers,
      layoutMetrics: this.options.config.layoutMetrics,
      headerAddonHeight: this.currentHeaderAddonHeight,
      headerLaneRefs: pm.getHeaderLaneRefs(),
      syncHeaderAddons: (ctx) => this.featureHost.syncHeaderAddons(ctx),
      changedRows: this.currentRenderChangeSet?.changedFieldsByRowId,
    });
  }

  /**
   * Build the row-styling resolver closure for this render pass.
   *
   * Returns `undefined` when no row-styling inputs are set so `populateRow`'s
   * "resolver removed" cleanup branch runs (drops any leftover managed
   * classes from previous binds with styling active). When styling is active
   * the closure captures the current `rowClass / getRowClass / rowClassRules`
   * inputs PLUS the live `Grid` instance, and is invoked lazily per row
   * inside `populateRow` (visible rows only — never during scroll-only
   * transform updates and never for non-visible virtualized rows).
   */
  private resolveHeaderControls(): ResolveHeaderControls {
    return assembleHeaderControlResolver(this.options.config.columnMenu);
  }

  private buildRowClassResolver(): ResolveRowClassesFn | undefined {
    const rowClass = this.currentRowClass;
    const getRowClass = this.currentGetRowClass;
    const rowClassRules = this.currentRowClassRules;
    if (rowClass === undefined && getRowClass === undefined && rowClassRules === undefined) {
      return undefined;
    }
    const getGridInstance = this.options.getGridInstance;
    return (row, rowIndex, rowId) => {
      const grid = getGridInstance();
      if (grid === null) return [];
      return resolveRowClasses({
        rowClass,
        getRowClass,
        rowClassRules,
        params: { row, rowIndex, rowId, grid },
      });
    };
  }

  /**
   * Recompute whether cell styling is active and bump
   * {@link currentCellClassVersion} when the effective column cell-styling
   * inputs change. Cheap O(effective columns) scan across center,
   * pinned-left, and pinned-right lanes; reference-equality fingerprint
   * avoids bumping on unrelated renders.
   *
   * Cell-styling inputs live on the column defs (not the snapshot top-level),
   * so the fingerprint keys off the per-column `cellClass` / `getCellClass` /
   * `cellClassRules` references. The scan covers all three lane groups
   * because the renderer forwards cell styling to center, pinned-left, and
   * pinned-right lanes — without including pinned columns here a grid whose
   * ONLY cell-styled columns are pinned would incorrectly read as "no
   * styling active" and the resolver would never be built.
   */
  private refreshCellStylingState(): void {
    const layout = this.poolManager?.pinningLayout;
    let hasStyling = false;
    let fp = "";
    const scan = (group: ColumnDef[], tag: string): void => {
      for (let i = 0; i < group.length; i++) {
        const col = group[i]!;
        const hasCellClass = col.cellClass !== undefined;
        const hasGetCellClass = col.getCellClass !== undefined;
        const hasRules = col.cellClassRules !== undefined;
        if (!hasCellClass && !hasGetCellClass && !hasRules) continue;
        hasStyling = true;
        // Fingerprint uses lane tag + field + presence flags. We cannot diff
        // the actual function/rules-object contents cheaply, so a reference
        // identity tag is appended: when callers memoize their inputs
        // (recommended), a stable reference keeps the fingerprint stable; a
        // new reference bumps it.
        fp += `${tag}:${col.field}|${hasCellClass ? this.refTag(col.cellClass) : "-"}|`
          + `${hasGetCellClass ? this.refTag(col.getCellClass) : "-"}|`
          + `${hasRules ? this.refTag(col.cellClassRules) : "-"};`;
      }
    };
    if (layout) {
      scan(layout.leftPinned, "L");
      scan(layout.center, "C");
      scan(layout.rightPinned, "R");
    }

    this.currentHasCellStyling = hasStyling;
    if (fp !== this.lastCellStylingFingerprint) {
      this.lastCellStylingFingerprint = fp;
      this.currentCellClassVersion++;
    }
  }

  /**
   * Stable per-object reference tag for the cell-styling fingerprint. Identity
   * is assigned lazily via a WeakMap so equal references map to equal tags
   * across renders (memoized inputs → stable version). Primitive `cellClass`
   * strings/arrays are tagged by value where possible, falling back to the
   * WeakMap for arrays.
   */
  private refTag(value: unknown): string {
    if (typeof value === "string") return `s:${value}`;
    if (value === null || value === undefined) return "-";
    if (typeof value === "object" || typeof value === "function") {
      let tag = this.refTagMap.get(value as object);
      if (tag === undefined) {
        tag = `r${this.refTagSeq++}`;
        this.refTagMap.set(value as object, tag);
      }
      return tag;
    }
    return `v:${String(value)}`;
  }

  /**
   * Build the cell-styling resolver closure for this render pass. Returns
   * `undefined` when none of the visible effective columns across center,
   * pinned-left, and pinned-right lanes carries cell-styling inputs, so
   * populateRow's "resolver removed" cleanup branch drains any leftover
   * managed cell classes. The closure dispatches per-column to the pure
   * `resolveCellClasses(...)` using each cell's own column def.
   */
  private buildCellClassResolver(): ResolveCellClassesFn | undefined {
    if (!this.currentHasCellStyling) return undefined;
    const getGridInstance = this.options.getGridInstance;
    return (row, rowIndex, rowId, column, value) => {
      // Per-column inputs live on the column def itself. Columns without any
      // cell-styling inputs resolve to `[]` (drains stale classes via diff).
      if (
        column.cellClass === undefined &&
        column.getCellClass === undefined &&
        column.cellClassRules === undefined
      ) {
        return [];
      }
      const grid = getGridInstance();
      if (grid === null) return [];
      return resolveCellClasses({
        cellClass: column.cellClass,
        getCellClass: column.getCellClass,
        cellClassRules: column.cellClassRules,
        params: {
          row,
          rowIndex,
          rowId,
          column,
          field: column.field,
          value,
          grid,
        },
      });
    };
  }

  private readonly onViewportResize = (): void => {
    if (this.resizeRafId !== 0) return;
    this.resizeRafId = requestAnimationFrame(() => {
      this.resizeRafId = 0;
      if (!this.skeleton || !this.poolManager) return;

      // Sync `--lfg-viewport-height` once per resize tick. Bottom row-pinned
      // lanes depend on this to compute their sticky `top` offset.
      this.syncViewportHeightVar();

      const neededRows = computeRowPoolSize(
        this.skeleton.viewport,
        this.currentCenterRowCount,
        !!this.options.config.suppressRowVirtualization,
        this.options.config.layoutMetrics,
      );
      const neededCenterCols = computeCenterSlotCount(
        this.skeleton.viewport,
        this.poolManager.pinningLayout,
        !!this.options.config.suppressColumnVirtualization,
      );

      if (
        neededRows === this.poolManager.pool.length &&
        neededCenterCols === this.poolManager.centerSlotCount
      ) {
        this.windowSync.sync(this.buildSyncContext());
        this.rebuildRowIndex();
        return;
      }

      const displayRowCount = this.currentDisplayRows?.rowCount ?? 0;
      if (this.currentColumns.length > 0 || displayRowCount > 0) {
        this.fullRebuild(this.currentColumns);
        this.featureHost.syncFloatingFilters();
        this.syncHeaderAddonHeight();
        this.syncRowPinLanesAndWindow(this.currentColumns);
        this.featureHost.syncSelectionMode();
      }
    });
  };

  getSelectedRowIds(): string[] {
    return this.featureHost.getSelectedRowIds();
  }

  captureRowSelectionSnapshot(
    universeRowCount: number,
  ): RowSelectionReadSnapshot {
    return this.featureHost.captureRowSelectionSnapshot(universeRowCount);
  }

  captureLogicalColumnLayoutSnapshot(
    input: LogicalColumnLayoutInput,
  ): LogicalColumnLayoutReadSnapshot {
    return this.featureHost.captureLogicalColumnLayoutSnapshot(input);
  }

  clearSelection(): SelectionChange | null {
    const change = this.featureHost.clearSelection();
    if (change) this.refreshRowPinLaneSelectionVisuals();
    return change;
  }

  setSelectedRowIds(
    ids: string[],
    opts?: { silent?: boolean; source?: SelectionChangeSource },
  ): SelectionChange | null {
    const change = this.featureHost.setSelectedRowIds(ids, opts);
    // Row-pinned lane pool rows live outside getPool() so the selection
    // controller's patch path does not reach them — refresh here whenever
    // selection state actually changed.
    if (change) this.refreshRowPinLaneSelectionVisuals();
    return change;
  }

  isRowSelected(rowId: string): boolean {
    return this.featureHost.isRowSelected(rowId);
  }

  refreshHeaderSelectionState(): void {
    this.featureHost.refreshHeaderSelectionState();
  }

  // ── Focused cell (FocusRendererCapability) ──────────────────────────

  getFocusedCell(): FocusedCell | null {
    return this.featureHost.getFocusedCell();
  }

  setFocusedCell(
    target: { rowId?: string; rowIndex?: number; field: string },
    source?: FocusChangeSource,
  ): void {
    this.featureHost.setFocusedCell(target, source);
  }

  clearFocusedCell(source?: FocusChangeSource): void {
    this.featureHost.clearFocusedCell(source);
  }

  moveFocusedCell(
    direction: FocusMoveDirection,
    source?: FocusChangeSource,
  ): boolean {
    return this.featureHost.moveFocusedCell(direction, source);
  }

  getEditingCell(): { rowId: string; field: string } | null {
    return this.featureHost.getEditingCell();
  }

  startEdit(target: { rowId?: string; rowIndex?: number; field: string; charSeed?: string }): boolean {
    return this.featureHost.startEdit(target);
  }

  stopEdit(opts: { commit: boolean }): boolean {
    return this.featureHost.stopEdit(opts);
  }

  getSelectedColumnIds(): string[] {
    return this.featureHost.getSelectedColumnIds();
  }

  captureColumnSelectionSnapshot(): ImmutableIdMembership<string> {
    return this.featureHost.captureColumnSelectionSnapshot();
  }

  setSelectedColumnIds(
    ids: string[],
    opts?: { silent?: boolean; source?: ColumnSelectionChangeSource },
  ): boolean {
    return this.featureHost.setSelectedColumnIds(ids, opts);
  }

  clearColumnSelection(): boolean {
    return this.featureHost.clearColumnSelection();
  }

  getViewportWidth(): number {
    return this.skeleton?.viewport.clientWidth ?? 0;
  }

  getAutoSizeContext(): AutoSizeContext {
    return {
      visibleRowStart: this.windowSync.visibleRowStart,
      poolRowCount: this.poolManager?.pool.length ?? 0,
      displayRows: this.resolveDisplayRows(
        this.currentRowView, this.currentSourceRows,
      ),
    };
  }

  /**
   * Latest `RowView` for the rendered snapshot. Center body binding,
   * row-pin partitioning, and the styling-only `getDisplayRow` helper all
   * resolve rows through the `DisplayRowReader` built from this view.
   * Returns `null` before the first render.
   */
  getCurrentRowView(): RowView | null {
    return this.currentRowView;
  }

  /**
   * Return a `DisplayRowReader` for the given RowView (or fallback source
   * rows), reusing the cached reader when the source reference has not
   * changed. This keeps the row-pinning render model's reference-equality
   * cache intact across renders that don't change the underlying view.
   *
   * The fallback is `currentSourceRows` — original user-supplied rows in
   * source order. When no RowView exists (no sort active), source order
   * equals display order, so the plain-array reader is correct.
   */
  private resolveDisplayRows(
    rowView: RowView | null,
    fallbackSourceRows: RowData[],
  ): DisplayRowReader {
    const source: RowView | RowData[] = rowView ?? fallbackSourceRows;
    if (this.currentDisplayRows && source === this.currentDisplayRowsSource) {
      return this.currentDisplayRows;
    }
    const reader = rowView
      ? createDisplayRowReader(rowView)
      : createArrayDisplayRowReader(fallbackSourceRows);
    this.currentDisplayRows = reader;
    this.currentDisplayRowsSource = source;
    return reader;
  }

  /**
   * Horizontally scroll the center viewport so `field` is visible.
   * Pure column-metadata math — no DOM scan, works for columns outside
   * the rendered horizontal window. The scrollLeft change drives the
   * normal scroll-sync, which renders the target column and re-applies
   * focus visuals via `syncFocusState`.
   */
  private ensureFieldVisible(field: string): void {
    const viewport = this.skeleton?.viewport;
    const layout = this.poolManager?.pinningLayout;
    if (!viewport || !layout) return;

    // Pinned columns are sticky — always visible, no center scrolling.
    if (
      layout.leftPinned.some((c) => c.field === field) ||
      layout.rightPinned.some((c) => c.field === field)
    ) {
      return;
    }

    const override = this.featureHost.getResizeOverride();
    const widthOf = (col: ColumnDef): number =>
      override !== null && override.field === col.field
        ? override.width
        : columnPixelWidth(col);

    // Sticky pinned lanes: they offset the center geometry on the left
    // and occlude the center viewport edges on both sides.
    let pinnedLeftWidth = 0;
    for (const col of layout.leftPinned) pinnedLeftWidth += widthOf(col);
    let pinnedRightWidth = 0;
    for (const col of layout.rightPinned) pinnedRightWidth += widthOf(col);

    // Target edges in scroll-content coordinates: center columns are
    // laid out after the pinned-left lane, so the absolute position is
    // pinnedLeftWidth + the offset within the center columns.
    let centerOffset = 0;
    let width = 0;
    for (const col of layout.center) {
      const w = widthOf(col);
      if (col.field === field) {
        width = w;
        break;
      }
      centerOffset += w;
    }
    if (width === 0) return; // not in the center layout

    const targetLeft = pinnedLeftWidth + centerOffset;
    const targetRight = targetLeft + width;

    const viewLeft = viewport.scrollLeft + pinnedLeftWidth;
    const viewRight =
      viewport.scrollLeft + viewport.clientWidth - pinnedRightWidth;

    if (targetLeft < viewLeft) {
      viewport.scrollLeft = Math.max(0, targetLeft - pinnedLeftWidth);
    } else if (targetRight > viewRight) {
      viewport.scrollLeft =
        targetRight - viewport.clientWidth + pinnedRightWidth;
    }
  }

  /**
   * Visual row order for focused-cell navigation: top-pinned →
   * center → bottom-pinned. Pinned lanes are small explicit display
   * indexes; the center body reuses the row-pin model's O(1) mapper.
   * No full-row materialization.
   */
  private getVisualRowLayout(): VisualRowLayout {
    return {
      topDisplayIndexes: this.currentPinnedTopRows.map((e) => e.displayIndex),
      centerRowCount: this.currentCenterRowCount,
      centerToDisplayIndex: this.currentCenterToDisplayIndex,
      bottomDisplayIndexes: this.currentPinnedBottomRows.map(
        (e) => e.displayIndex,
      ),
    };
  }

  /**
   * Visit the pool rows for the row-pinned top/bottom lanes (center +
   * left + right sub-lanes), so focus visuals and pinned-row clicks
   * reach cells that live outside the main center pool. Callback-style
   * — no throwaway array.
   */
  private forEachRowPinnedLanePoolRow(cb: (row: PooledRow) => void): void {
    forEachRowPinLanePoolRow(this.pinnedTopLaneState, cb);
    forEachRowPinLanePoolRow(this.pinnedBottomLaneState, cb);
  }

  /** Visit retained row-pinned center/left/right physical rows by row slot. */
  private forEachRowPinnedLogicalPoolRow(
    cb: (
      center: PooledRow,
      left: PooledRow | null,
      right: PooledRow | null,
    ) => void,
  ): void {
    forEachLogicalRowPinLanePoolRow(this.pinnedTopLaneState, cb);
    forEachLogicalRowPinLanePoolRow(this.pinnedBottomLaneState, cb);
  }

  /**
   * Reader over the unpaginated universe view. Falls back to the
   * regular display reader when no full view is tracked (pagination
   * disabled or pre-render).
   */
  private resolveFullDisplayRows(): DisplayRowReader {
    const view = this.currentFullRowView;
    if (!view || view === this.currentRowView) {
      return this.resolveDisplayRows(this.currentRowView, this.currentSourceRows);
    }
    if (this.currentFullDisplayRows && this.currentFullDisplayRowsSource === view) {
      return this.currentFullDisplayRows;
    }
    const reader = createDisplayRowReader(view);
    this.currentFullDisplayRows = reader;
    this.currentFullDisplayRowsSource = view;
    return reader;
  }

  /**
   * Resolve the row object at a display index via the display-row reader.
   *
   * Used by the styling-only fast path and row-pinned lane styling
   * updates only — center body binding uses the scalar `getRowData`
   * accessor directly.
   */
  private getDisplayRow(displayIndex: number): RowData | undefined {
    return this.currentDisplayRows?.getRowData(displayIndex);
  }

  destroy(): void {
    if (this.scrollRafId !== 0) {
      cancelAnimationFrame(this.scrollRafId);
      this.scrollRafId = 0;
    }
    if (this.resizeRafId !== 0) {
      cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.featureHost.detach();
    this.poolManager?.clear();
    this.poolManager = null;
    if (this.skeleton) {
      this.skeleton.viewport.removeEventListener(
        "scroll",
        this.onViewportScroll,
      );
      this.skeleton.root.remove();
      this.skeleton = null;
    }
    this.currentColumns = [];
    this.currentUserColumns = [];
    this.currentSourceRows = [];
    this.currentRowView = null;
    this.currentDisplayRows = null;
    this.currentDisplayRowsSource = null;
    this.currentFullRowView = null;
    this.currentFullDisplayRows = null;
    this.currentFullDisplayRowsSource = null;
    this.currentRowPinState = {};
    this.currentPinnedTopRows = [];
    this.currentPinnedBottomRows = [];
    this.bodyRowsById.clear();
    this.topPinnedRowsById.clear();
    this.bottomPinnedRowsById.clear();
    this.currentCenterToDisplayIndex = null;
    this.currentCenterRowCount = 0;
    this.paginationFooter?.destroy();
    this.paginationFooter = null;
    this.lastPaginationSnapshot = null;
    this.currentViewportHeight = -1;
    this.pinnedTopLaneState = undefined;
    this.pinnedBottomLaneState = undefined;
  }
}
