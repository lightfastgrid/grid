/**
 * Owns the full virtual-window sync boundary.
 *
 * Vertical and horizontal axes are fully decoupled:
 *   - Vertical: VerticalRingBuffer recycles pool rows. Small scrolls
 *     rebind only entering rows; large jumps do a full rebind.
 *   - Horizontal: HorizontalRingBuffer recycles cell slots. Small scrolls
 *     rebind only entering column slots; large jumps do a full rebind.
 *   - Diagonal: both rings advance independently. Entering rows get full
 *     column binding; entering columns get per-cell updates on non-entering
 *     rows.
 *
 * Header sync uses the same horizontal ring mapping.
 * CSS-variable geometry system drives left/width — no inline style writes.
 *
 * DomGridRenderer calls `sync()` or `syncFromScroll()` with a context bag.
 * If virtualization or row binding is broken, this file is the place to look.
 */

import type { PinnedRowEntry } from "../../features/row-pinning";
import type {
  HeaderAddonSyncContext,
  HeaderLaneRefs,
} from "../../features/types";
import type {
  ColumnWidthOverride,
  ResizeLayoutControl,
} from "../../internal/layoutTypes";
import type { GridLayoutMetrics } from "../../layout/gridLayoutMetrics";
import type {
  CellRendererRegistry,
  ColumnDef,
  PooledRow,
  RowData,
  RowSelectionConfig,
} from "../../types";
import type { ResolveHeaderControls } from "../headerControlTypes";
import { applyColumnWidthVars } from "../helpers/applyColumnWidthVars";
import { buildColumnLeftEdges } from "../helpers/columnLayout";
import { HEADER_HEIGHT, ROW_HEIGHT } from "../helpers/gridConstants";
import { clearRowCellChangeFlashes } from "../helpers/cellChangeFlash";
import { type ColumnWindow, populateRow, rebindCells, type ResolveCellClassesFn, type ResolveRowClassesFn, syncPinnedRowCells } from "../helpers/populateRow";
import { positionPinnedRow, positionRow } from "../helpers/positionRow";
import {
  syncHeaderRowSlots,
  syncHeaderRowSlotsPartial,
  syncPinnedHeaderSlots,
} from "../helpers/syncHeaderRowSlots";
import type { DisplayRowReader } from "../rowViewAccess";

import {
  buildCachedColumnLayout,
  type CachedColumnLayout,
  columnLayoutCacheKeyChanged,
  type ColWindowFromLayout,
  computeColumnWindowFromLayout,
  resizeOverrideKey,
} from "./columnLayoutCache";
import { computeRowWindow } from "./computeWindows";
import { HorizontalRingBuffer } from "./HorizontalRingBuffer";
import { VerticalRingBuffer } from "./VerticalRingBuffer";

export type { ResizeLayoutControl } from "../../internal/layoutTypes";

export interface WindowSyncContext {
  viewport: HTMLElement;
  root: HTMLElement;
  pool: PooledRow[];
  /** Center header row (scrollable columns). */
  headerRowEl: HTMLDivElement | null;
  /** Pinned-left header row (inside sticky layer). */
  pinnedHeaderRowEl: HTMLDivElement | null;
  columns: ColumnDef[];
  /**
   * Display-row reader backed by RowView. All hot rendering paths — center
   * body row binding, row-pinning render partitioning, and visible-row
   * feature controllers — resolve rows through this reader. Source rows
   * live separately in `currentSourceRows` (from `RowView.rows`) and are
   * used only for public/source-row APIs.
   */
  displayRows: DisplayRowReader;
  columnSlotCount: number;
  dataRevision: number;
  rowSelection: RowSelectionConfig;
  suppressRowVirtualization: boolean;
  suppressColumnVirtualization: boolean;
  getRowId?: (row: RowData, dataIndex: number) => string;
  isRowSelected?: (rowId: string) => boolean;
  isColumnSelected?: (field: string) => boolean;
  resizeOverride: ColumnWidthOverride | null;
  resizeLayoutCtrl: ResizeLayoutControl;
  refreshHeaderSelectionState?: () => void;
  refreshHeaderSortState?: () => void;
  refreshHeaderFilterState?: () => void;
  /** Number of left-pinned columns (0 when no pinning). */
  pinnedLeftCount: number;
  /** Left-pinned column defs (subset of columns). */
  pinnedLeftColumns: ColumnDef[];
  /** Center (scrollable) column defs (subset of columns). */
  centerColumns: ColumnDef[];
  /** Number of center (horizontally virtualized) physical cell slots. */
  centerSlotCount: number;
  /** Pinned-right header row (inside sticky layer). */
  pinnedRightHeaderRowEl: HTMLDivElement | null;
  /** Number of right-pinned columns (0 when no pinning). */
  pinnedRightCount: number;
  /** Right-pinned column defs (subset of columns). */
  pinnedRightColumns: ColumnDef[];
  resolveHeaderControls?: ResolveHeaderControls;
  /**
   * Number of center body rows (display rows minus pinned rows).
   * Defaults to `displayRows.rowCount` when omitted.
   */
  centerRowCount?: number;
  /**
   * Map a center body row index to its display index when row pinning
   * is active. Omitted = identity mapping (`center[i] === i`).
   */
  centerToDisplayIndex?: (centerIndex: number) => number;
  pinnedTopRows?: PinnedRowEntry[];
  pinnedBottomRows?: PinnedRowEntry[];
  /** PooledRow instances for row-pinned top lane (horizontal column sync). */
  pinnedTopLaneRows?: PooledRow[];
  /** PooledRow instances for row-pinned bottom lane (horizontal column sync). */
  pinnedBottomLaneRows?: PooledRow[];
  /**
   * Row-styling resolver — pre-built by the renderer per render, captures the
   * user's `rowClass / getRowClass / rowClassRules` inputs and the live
   * `Grid`. Forwarded to every `populateRow` call here so managed row classes
   * apply uniformly across center body, column-pinned, and row-pinned rows.
   */
  resolveRowClasses?: ResolveRowClassesFn;
  /** Version that bumps when row-styling inputs change. */
  rowClassVersion?: number;
  /**
   * Cell-styling resolver — pre-built by the renderer per render from visible
   * column cell-styling inputs and the live `Grid`. Forwarded to:
   *
   *   - center body cells via `populateRow` / `rebindCells`
   *   - pinned-left + pinned-right body cells via `syncPinnedRowCells`
   *   - row-pinned top + bottom **center** lane cells via
   *     `syncRowPinLaneCols` (full) and `rebindRowPinLaneCols` (partial
   *     horizontal entering slots)
   *   - row-pinned top + bottom **left** and **right** sub-lane cells via
   *     `syncRowPinLanes` → `rowPinLaneDom` (separate code path; the
   *     resolver flows through `bindOptions` rather than the WindowSync
   *     context).
   */
  resolveCellClasses?: ResolveCellClassesFn;
  /** Version that bumps when any column's cell-styling inputs change. */
  cellClassVersion?: number;
  /** Row-action renderer modes used only while binding action triggers. */
  cellRenderers?: CellRendererRegistry;
  layoutMetrics?: GridLayoutMetrics;
  headerAddonHeight?: number;
  /**
   * Cached header lane containers + leaf rows from DomPoolManager.
   * Forwarded into HeaderAddonSyncContext when syncHeaderAddons runs.
   */
  headerLaneRefs?: HeaderLaneRefs | null;
  /**
   * Generic header-addon sync callback. Invoked after leaf header slots bind,
   * with a HeaderAddonSyncContext built from already-computed layout data.
   */
  syncHeaderAddons?: (ctx: HeaderAddonSyncContext) => void;
  /**
   * When present (update-only transaction, stable visual order), maps
   * rowId → changed field names. Passed through to `populateRow` and
   * `syncPinnedRowCells` so unchanged rows/cells are skipped.
   */
  changedRows?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Transaction cell-change flash metadata for this bind. Distinct from
   * {@link changedRows} so flashes survive full renders.
   */
  flashRows?: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface SyncResult {
  rowBindingsChanged: boolean;
}

export class VirtualWindowSync {
  private readonly vRing = new VerticalRingBuffer();
  private readonly hRing = new HorizontalRingBuffer();
  private lastScrollSyncKey = "";
  private lastVisibleRowStart = 0;
  /** Bumps when column layout cache rebuilds; forwarded to header addons. */
  private layoutVersion = 0;

  /** Cached column edges; rebuilt only when columns ref or resize override changes. */
  private columnLayoutCache: {
    columnsRef: ColumnDef[];
    overrideKey: string;
    layout: CachedColumnLayout;
  } | null = null;
  /** Last horizontal window + edge snapshot (valid with current cache + scrollLeft). */
  private lastColWin: ColWindowFromLayout | null = null;
  private lastViewportScrollLeft = 0;

  /**
   * Bumps only on horizontal full reset (large jump or non-scroll sync).
   * Drives the row-level dirty check in populateRow so partial horizontal
   * rotations don't force unnecessary full-row re-populations.
   */
  private columnVersion = 0;
  /** Last column window built during sync — used by the dirty-patch path. */
  private lastColumnWindow: ColumnWindow | null = null;

  /** First visible data row (for auto-fit sampling). */
  get visibleRowStart(): number {
    return this.lastVisibleRowStart;
  }

  /** Last column window from the most recent sync. Null before first sync. */
  getLastColumnWindow(): ColumnWindow | null {
    return this.lastColumnWindow;
  }

  /** Current horizontal column version counter. */
  getColumnVersion(): number {
    return this.columnVersion;
  }

  /** Full sync -- render, rebuild, viewport resize, column resize. */
  sync(ctx: WindowSyncContext): void {
    this.run(ctx, false);
  }

  /** Scroll-driven sync -- may ring-rotate instead of full rebind. */
  syncFromScroll(ctx: WindowSyncContext): SyncResult {
    return this.run(ctx, true);
  }

  /** Reset both ring buffers when pool is torn down. */
  invalidate(): void {
    this.vRing.invalidate();
    this.hRing.invalidate();
    this.lastScrollSyncKey = "";
    this.columnVersion = 0;
    this.columnLayoutCache = null;
    this.lastColWin = null;
    this.lastViewportScrollLeft = 0;
  }

  // ── private ──────────────────────────────────────

  private run(ctx: WindowSyncContext, fromScrollRaf: boolean): SyncResult {
    if (ctx.pool.length === 0) return { rowBindingsChanged: false };

    const {
      viewport, root, pool, headerRowEl, columns, displayRows,
      dataRevision, resizeOverride, resizeLayoutCtrl,
      rowSelection, isColumnSelected,
      pinnedLeftCount, pinnedLeftColumns, centerColumns, centerSlotCount,
      pinnedRightCount, pinnedRightColumns,
    } = ctx;
    const rowCount = ctx.centerRowCount ?? displayRows.rowCount;
    const poolSize = pool.length;
    const rh = ctx.layoutMetrics?.rowHeight ?? ROW_HEIGHT;
    const hh = (ctx.layoutMetrics?.headerHeight ?? HEADER_HEIGHT) + (ctx.headerAddonHeight ?? 0);
    const topPinnedHeight = (ctx.pinnedTopRows?.length ?? 0) * rh;
    const bodyStartY = hh + topPinnedHeight;

    // 1. Compute visible windows

    if (!resizeOverride) resizeLayoutCtrl.resetLayoutKey();

    const rowWin = computeRowWindow(
      viewport.scrollTop,
      rowCount,
      poolSize,
      rh,
      bodyStartY,
      ctx.suppressRowVirtualization,
    );
    this.lastVisibleRowStart = rowWin.startIndex;

    // Column layout cache and horizontal window use center columns only.
    if (
      fromScrollRaf &&
      !resizeOverride &&
      this.columnLayoutCache &&
      !columnLayoutCacheKeyChanged(
        centerColumns,
        resizeOverride,
        this.columnLayoutCache,
      ) &&
      this.lastColWin &&
      viewport.scrollLeft === this.lastViewportScrollLeft
    ) {
      const syncKey = `${rowWin.startIndex}|${this.lastColWin.startCol}|${rowCount}|${columns.length}|${this.lastColWin.totalWidth}|${dataRevision}|${pinnedLeftCount}|${pinnedRightCount}`;
      if (syncKey === this.lastScrollSyncKey) {
        return { rowBindingsChanged: false };
      }
    }

    const layoutRebuilt = this.refreshColumnLayoutCache(centerColumns, resizeOverride);

    let colWin: ColWindowFromLayout;
    if (
      !layoutRebuilt &&
      viewport.scrollLeft === this.lastViewportScrollLeft &&
      this.lastColWin
    ) {
      colWin = this.lastColWin;
    } else {
      colWin = computeColumnWindowFromLayout(
        viewport.scrollLeft,
        this.columnLayoutCache!.layout,
        centerSlotCount,
        ctx.suppressColumnVirtualization,
      );
      this.lastColWin = colWin;
      this.lastViewportScrollLeft = viewport.scrollLeft;
    }

    // 2. Scroll RAF dedup (window-level — no raw scrollTop/scrollLeft in key).

    const syncKey = `${rowWin.startIndex}|${colWin.startCol}|${rowCount}|${columns.length}|${colWin.totalWidth}|${dataRevision}|${pinnedLeftCount}|${pinnedRightCount}`;

    if (fromScrollRaf && !resizeOverride && syncKey === this.lastScrollSyncKey) {
      return { rowBindingsChanged: false };
    }

    // 3. Live resize CSS

    if (resizeOverride) {
      const hasPinned = pinnedLeftCount > 0 || pinnedRightCount > 0;
      const pinLayout = hasPinned
        ? { leftPinned: pinnedLeftColumns, center: centerColumns, rightPinned: pinnedRightColumns, ordered: columns }
        : null;
      applyColumnWidthVars(root, columns, resizeOverride, pinLayout);
    }

    const layoutKey = `${rowWin.startIndex}:${colWin.startCol}`;
    const rowLayoutOnly = resizeOverride !== null && resizeLayoutCtrl.isLayoutOnly(layoutKey);
    if (resizeOverride) resizeLayoutCtrl.updateLayoutKey(layoutKey);

    // 4. Horizontal ring sync (center columns only)

    const isScrollDriven = fromScrollRaf && !resizeOverride;
    const hResult = this.hRing.sync({
      startCol: colWin.startCol,
      slotCount: centerSlotCount,
      isScrollDriven,
    });
    if (hResult.outcome === "full") this.columnVersion++;

    // Center cells start at index 0 in the center pool (pinned cells are separate).
    const toPhysicalCenterCol = (v: number) =>
      this.hRing.toPhysical(v, centerSlotCount);

    // 5a. Pinned header sync (separate sticky layer)

    const { pinnedHeaderRowEl, resolveHeaderControls } = ctx;
    if (pinnedHeaderRowEl && pinnedLeftCount > 0) {
      const needsFullCenter = hResult.outcome === "full" || !fromScrollRaf;
      if (needsFullCenter) {
        syncPinnedHeaderSlots(
          pinnedHeaderRowEl,
          pinnedLeftColumns,
          rowSelection,
          isColumnSelected,
          "left",
          resolveHeaderControls,
        );
      }
    }

    // 5a-right. Right-pinned header sync (separate sticky layer)

    const { pinnedRightHeaderRowEl } = ctx;
    if (pinnedRightHeaderRowEl && pinnedRightCount > 0) {
      const needsFullCenter = hResult.outcome === "full" || !fromScrollRaf;
      if (needsFullCenter) {
        syncPinnedHeaderSlots(
          pinnedRightHeaderRowEl,
          pinnedRightColumns,
          rowSelection,
          isColumnSelected,
          "right",
          resolveHeaderControls,
        );
      }
    }

    // 5b. Center header sync

    if (headerRowEl) {
      const needsFullCenter = hResult.outcome === "full" || !fromScrollRaf;

      if (needsFullCenter) {
        syncHeaderRowSlots(
          headerRowEl,
          centerColumns,
          colWin.startCol,
          centerSlotCount,
          toPhysicalCenterCol,
          rowSelection,
          isColumnSelected,
          resolveHeaderControls,
        );
        ctx.refreshHeaderSelectionState?.();
        ctx.refreshHeaderSortState?.();
        ctx.refreshHeaderFilterState?.();
      } else if (hResult.outcome === "partial") {
        syncHeaderRowSlotsPartial(
          headerRowEl,
          centerColumns,
          colWin.startCol,
          hResult.enteringSlots,
          toPhysicalCenterCol,
          rowSelection,
          isColumnSelected,
          resolveHeaderControls,
        );
        ctx.refreshHeaderSelectionState?.();
        ctx.refreshHeaderSortState?.();
        ctx.refreshHeaderFilterState?.();
      }
    }

    this.invokeHeaderAddonSync(ctx, colWin, centerColumns, pinnedLeftColumns, pinnedRightColumns);

    // 6. Column window for center row binding

    const colWindow: ColumnWindow = {
      startIndex: colWin.startCol,
      slotCount: centerSlotCount,
      toPhysicalCol: toPhysicalCenterCol,
    };
    this.lastColumnWindow = colWindow;
    const slotLayoutOnly = isScrollDriven ? false : rowLayoutOnly;

    // 7. Vertical ring sync (independent of horizontal state)

    const vOutcome = this.vRing.sync({
      startIndex: rowWin.startIndex,
      poolSize,
      dataLength: rowCount,
      isScrollDriven,
      bindSlot: (v) => {
        this.bindSlotFull(
          v, rowWin.startIndex, pool, poolSize, centerColumns,
          colWindow, dataRevision, slotLayoutOnly, ctx,
        );
      },
    });

    // 8. Cross-axis: horizontal changes on non-entering rows.

    if (vOutcome !== "full") {
      if (hResult.outcome === "full") {
        for (let v = 0; v < poolSize; v++) {
          this.bindSlotDataOnly(
            v, rowWin.startIndex, pool, poolSize, centerColumns,
            colWindow, dataRevision, slotLayoutOnly, ctx,
          );
        }
      } else if (hResult.outcome === "partial") {
        for (let v = 0; v < poolSize; v++) {
          this.bindRowEnteringCols(
            v, rowWin.startIndex, pool, poolSize, centerColumns,
            colWin.startCol, hResult.enteringSlots, toPhysicalCenterCol,
            ctx,
          );
        }
      }
    }

    // 9. Row-pinned lane horizontal sync.

    if (hResult.outcome === "full" || !fromScrollRaf) {
      this.syncRowPinLaneCols(
        ctx.pinnedTopLaneRows, ctx.pinnedTopRows,
        centerColumns, colWindow, dataRevision, ctx,
      );
      this.syncRowPinLaneCols(
        ctx.pinnedBottomLaneRows, ctx.pinnedBottomRows,
        centerColumns, colWindow, dataRevision, ctx,
      );
    } else if (hResult.outcome === "partial") {
      this.rebindRowPinLaneCols(
        ctx.pinnedTopLaneRows, ctx.pinnedTopRows,
        centerColumns, colWin.startCol, hResult.enteringSlots,
        toPhysicalCenterCol, ctx,
      );
      this.rebindRowPinLaneCols(
        ctx.pinnedBottomLaneRows, ctx.pinnedBottomRows,
        centerColumns, colWin.startCol, hResult.enteringSlots,
        toPhysicalCenterCol, ctx,
      );
    }

    this.lastScrollSyncKey = syncKey;
    return { rowBindingsChanged: vOutcome !== "skipped" };
  }

  /** @returns whether edges were rebuilt (vs cache hit). */
  private refreshColumnLayoutCache(
    columns: ColumnDef[],
    resizeOverride: ColumnWidthOverride | null,
  ): boolean {
    const key = resizeOverrideKey(resizeOverride);
    if (
      this.columnLayoutCache &&
      this.columnLayoutCache.columnsRef === columns &&
      this.columnLayoutCache.overrideKey === key
    ) {
      return false;
    }
    const layout = buildCachedColumnLayout(columns, resizeOverride);
    this.columnLayoutCache = {
      columnsRef: columns,
      overrideKey: key,
      layout,
    };
    this.layoutVersion++;
    return true;
  }

  /**
   * After leaf header slots bind, forward already-computed layout into the
   * generic header-addon callback. No addon-specific branches.
   */
  private invokeHeaderAddonSync(
    ctx: WindowSyncContext,
    colWin: ColWindowFromLayout,
    centerColumns: ColumnDef[],
    pinnedLeftColumns: ColumnDef[],
    pinnedRightColumns: ColumnDef[],
  ): void {
    const { syncHeaderAddons, headerLaneRefs, resizeOverride } = ctx;
    if (!syncHeaderAddons || !headerLaneRefs) return;

    const centerLaneEdges =
      this.columnLayoutCache?.layout.edges ??
      buildColumnLeftEdges(centerColumns, resizeOverride);
    const leftLaneEdges =
      pinnedLeftColumns.length > 0
        ? buildColumnLeftEdges(pinnedLeftColumns, resizeOverride)
        : null;
    const rightLaneEdges =
      pinnedRightColumns.length > 0
        ? buildColumnLeftEdges(pinnedRightColumns, resizeOverride)
        : null;

    // Inclusive end index (doc: centerWindow.endCol is inclusive).
    const endCol = Math.min(
      centerColumns.length - 1,
      colWin.startCol + colWin.slotCount - 1,
    );

    // Center header container is global X; pinned stacks are lane-local.
    // Left-pinned width = last left-lane prefix edge (already computed).
    const centerContainerOffsetX =
      leftLaneEdges && pinnedLeftColumns.length > 0
        ? leftLaneEdges[leftLaneEdges.length - 1]!
        : 0;

    const addonCtx: HeaderAddonSyncContext = {
      centerWindow: { startCol: colWin.startCol, endCol },
      lanes: {
        left:
          leftLaneEdges && pinnedLeftColumns.length > 0
            ? {
                columns: pinnedLeftColumns,
                prefixEdges: leftLaneEdges,
                containerOffsetX: 0,
              }
            : null,
        center: {
          columns: centerColumns,
          prefixEdges: centerLaneEdges,
          containerOffsetX: centerContainerOffsetX,
        },
        right:
          rightLaneEdges && pinnedRightColumns.length > 0
            ? {
                columns: pinnedRightColumns,
                prefixEdges: rightLaneEdges,
                containerOffsetX: 0,
              }
            : null,
      },
      headerLaneRefs,
      layoutVersion: this.layoutVersion,
    };
    syncHeaderAddons(addonCtx);
  }

  /** Full bind: position + pinned cells + all center column data (vertical ring entering rows). */
  private bindSlotFull(
    virtualSlot: number,
    startIndex: number,
    pool: PooledRow[],
    poolSize: number,
    centerColumns: ColumnDef[],
    colWindow: ColumnWindow,
    dataRevision: number,
    layoutOnly: boolean,
    ctx: WindowSyncContext,
  ): void {
    const phys = this.vRing.toPhysical(virtualSlot, poolSize);
    const poolRow = pool[phys];
    if (!poolRow) return;

    const centerIndex = startIndex + virtualSlot;
    const displayIndex = ctx.centerToDisplayIndex
      ? ctx.centerToDisplayIndex(centerIndex)
      : centerIndex;
    const rowData = ctx.displayRows.getRowData(displayIndex);
    if (rowData !== undefined) {
      const rh = ctx.layoutMetrics?.rowHeight ?? ROW_HEIGHT;
      const hh = (ctx.layoutMetrics?.headerHeight ?? HEADER_HEIGHT) + (ctx.headerAddonHeight ?? 0);
      const topPinH = (ctx.pinnedTopRows?.length ?? 0) * rh;
      positionRow(poolRow, centerIndex, rh, hh + topPinH);

      // Resolve changed fields once for pinned + center cell paths.
      const changedRows = ctx.changedRows;
      const flashRows = ctx.flashRows;
      const rowId = ctx.getRowId?.(rowData, displayIndex) ?? String(displayIndex);
      const changedFields = changedRows?.get(rowId);
      const flashFields = flashRows?.get(rowId);
      // Skip pinned cell work for unchanged rows when change metadata present.
      const skipPinned =
        changedRows !== undefined &&
        changedFields === undefined &&
        flashFields === undefined &&
        poolRow.rowId === rowId &&
        poolRow.rowIndex === displayIndex;

      if (ctx.pinnedLeftCount > 0 && poolRow.pinnedElement) {
        positionPinnedRow(poolRow, centerIndex, rh, "left", topPinH);
        if (!skipPinned) {
          syncPinnedRowCells(
            poolRow, rowData, ctx.pinnedLeftColumns, displayIndex,
            ctx.getRowId, ctx.isRowSelected, ctx.isColumnSelected, "left",
            ctx.resolveCellClasses, ctx.cellClassVersion, changedFields,
            ctx.cellRenderers, flashFields,
          );
        }
        poolRow.pinnedElement.style.display = "";
      }
      if (ctx.pinnedRightCount > 0 && poolRow.rightPinnedElement) {
        positionPinnedRow(poolRow, centerIndex, rh, "right", topPinH);
        if (!skipPinned) {
          syncPinnedRowCells(
            poolRow, rowData, ctx.pinnedRightColumns, displayIndex,
            ctx.getRowId, ctx.isRowSelected, ctx.isColumnSelected, "right",
            ctx.resolveCellClasses, ctx.cellClassVersion, changedFields,
            ctx.cellRenderers, flashFields,
          );
        }
        poolRow.rightPinnedElement.style.display = "";
      }
      populateRow(poolRow, rowData, centerColumns, displayIndex, colWindow, {
        layoutOnly,
        dataRevision,
        columnVersion: this.columnVersion,
        getRowId: ctx.getRowId,
        isRowSelected: ctx.isRowSelected,
        isColumnSelected: ctx.isColumnSelected,
        resolveRowClasses: ctx.resolveRowClasses,
        rowClassVersion: ctx.rowClassVersion,
        resolveCellClasses: ctx.resolveCellClasses,
        cellClassVersion: ctx.cellClassVersion,
        cellRenderers: ctx.cellRenderers,
        changedRows,
        flashRows,
      });
      poolRow.element.style.display = "";
    } else {
      clearRowCellChangeFlashes(poolRow);
      poolRow.element.style.display = "none";
      if (poolRow.pinnedElement) poolRow.pinnedElement.style.display = "none";
      if (poolRow.rightPinnedElement) poolRow.rightPinnedElement.style.display = "none";
      poolRow.rowIndex = -1;
      poolRow.rowId = null;
      poolRow.element.classList.remove("lfg-row-selected");
    }
  }

  /** Data-only bind for center columns (horizontal full reset on non-entering rows). */
  private bindSlotDataOnly(
    virtualSlot: number,
    startIndex: number,
    pool: PooledRow[],
    poolSize: number,
    centerColumns: ColumnDef[],
    colWindow: ColumnWindow,
    dataRevision: number,
    layoutOnly: boolean,
    ctx: WindowSyncContext,
  ): void {
    const phys = this.vRing.toPhysical(virtualSlot, poolSize);
    const poolRow = pool[phys];
    if (!poolRow) return;

    const centerIndex = startIndex + virtualSlot;
    const displayIndex = ctx.centerToDisplayIndex
      ? ctx.centerToDisplayIndex(centerIndex)
      : centerIndex;
    const rowData = ctx.displayRows.getRowData(displayIndex);
    if (rowData !== undefined) {
      populateRow(poolRow, rowData, centerColumns, displayIndex, colWindow, {
        layoutOnly,
        dataRevision,
        columnVersion: this.columnVersion,
        getRowId: ctx.getRowId,
        isRowSelected: ctx.isRowSelected,
        isColumnSelected: ctx.isColumnSelected,
        resolveRowClasses: ctx.resolveRowClasses,
        rowClassVersion: ctx.rowClassVersion,
        resolveCellClasses: ctx.resolveCellClasses,
        cellClassVersion: ctx.cellClassVersion,
        cellRenderers: ctx.cellRenderers,
        changedRows: ctx.changedRows,
        flashRows: ctx.flashRows,
      });
    }
  }

  /** Per-cell bind for entering column slots (horizontal partial on non-entering rows). */
  private bindRowEnteringCols(
    virtualSlot: number,
    startIndex: number,
    pool: PooledRow[],
    poolSize: number,
    centerColumns: ColumnDef[],
    startCol: number,
    enteringColSlots: number[],
    toPhysicalCol: (v: number) => number,
    ctx: WindowSyncContext,
  ): void {
    const phys = this.vRing.toPhysical(virtualSlot, poolSize);
    const poolRow = pool[phys];
    if (!poolRow) return;

    const centerIndex = startIndex + virtualSlot;
    const displayIndex = ctx.centerToDisplayIndex
      ? ctx.centerToDisplayIndex(centerIndex)
      : centerIndex;
    const rowData = ctx.displayRows.getRowData(displayIndex);
    if (rowData === undefined) return;

    rebindCells(
      poolRow,
      rowData,
      centerColumns,
      displayIndex,
      startCol,
      enteringColSlots,
      toPhysicalCol,
      ctx.getRowId,
      ctx.isRowSelected,
      ctx.isColumnSelected,
      ctx.resolveCellClasses,
      ctx.cellClassVersion,
      ctx.cellRenderers,
    );
  }

  /** Full horizontal rebind for row-pinned lane rows. */
  private syncRowPinLaneCols(
    laneRows: PooledRow[] | undefined,
    entries: PinnedRowEntry[] | undefined,
    centerColumns: ColumnDef[],
    colWindow: ColumnWindow,
    dataRevision: number,
    ctx: WindowSyncContext,
  ): void {
    if (!laneRows || !entries || laneRows.length === 0) return;
    for (let i = 0; i < laneRows.length; i++) {
      const poolRow = laneRows[i];
      const entry = entries[i];
      if (!poolRow || !entry) continue;
      populateRow(poolRow, entry.row, centerColumns, entry.displayIndex, colWindow, {
        dataRevision,
        columnVersion: this.columnVersion,
        getRowId: ctx.getRowId,
        isRowSelected: ctx.isRowSelected,
        isColumnSelected: ctx.isColumnSelected,
        resolveRowClasses: ctx.resolveRowClasses,
        rowClassVersion: ctx.rowClassVersion,
        resolveCellClasses: ctx.resolveCellClasses,
        cellClassVersion: ctx.cellClassVersion,
        cellRenderers: ctx.cellRenderers,
        changedRows: ctx.changedRows,
        flashRows: ctx.flashRows,
      });
    }
  }

  /** Partial horizontal rebind for row-pinned lane rows (entering column slots only). */
  private rebindRowPinLaneCols(
    laneRows: PooledRow[] | undefined,
    entries: PinnedRowEntry[] | undefined,
    centerColumns: ColumnDef[],
    startCol: number,
    enteringSlots: number[],
    toPhysicalCol: (v: number) => number,
    ctx: WindowSyncContext,
  ): void {
    if (!laneRows || !entries || laneRows.length === 0) return;
    for (let i = 0; i < laneRows.length; i++) {
      const poolRow = laneRows[i];
      const entry = entries[i];
      if (!poolRow || !entry) continue;
      rebindCells(
        poolRow, entry.row, centerColumns, entry.displayIndex,
        startCol, enteringSlots, toPhysicalCol,
        ctx.getRowId, ctx.isRowSelected, ctx.isColumnSelected,
        ctx.resolveCellClasses, ctx.cellClassVersion,
        ctx.cellRenderers,
      );
    }
  }
}
