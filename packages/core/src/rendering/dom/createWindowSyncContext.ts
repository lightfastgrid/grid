import type { ColumnPinningLayout } from "../../features/column-pinning/columnPinningLayout";
import type { PinnedRowEntry } from "../../features/row-pinning";
import type {
  HeaderAddonSyncContext,
  HeaderLaneRefs,
} from "../../features/types";
import type { GridLayoutMetrics } from "../../layout/gridLayoutMetrics";
import type {
  CellRendererRegistry,
  ColumnDef,
  GridSkeleton,
  PooledRow,
  RowData,
  RowSelectionConfig,
} from "../../types";
import type { ResolveHeaderControls } from "../headerControlTypes";
import type { ColumnWidthOverride } from "../helpers/columnLayout";
import type { ResolveCellClassesFn, ResolveRowClassesFn } from "../helpers/populateRow";
import type {
  ResizeLayoutControl,
  WindowSyncContext,
} from "../ring-buffer/VirtualWindowSync";
import type { DisplayRowReader } from "../rowViewAccess";

export function createWindowSyncContext(args: {
  skeleton: GridSkeleton;
  pool: PooledRow[];
  headerRowEl: HTMLDivElement | null;
  pinnedHeaderRowEl: HTMLDivElement | null;
  columns: ColumnDef[];
  displayRows: DisplayRowReader;
  columnSlotCount: number;
  dataRevision: number;
  rowSelection: RowSelectionConfig;
  suppressRowVirtualization: boolean;
  suppressColumnVirtualization: boolean;
  resolveRowId(row: RowData, index: number): string;
  isRowSelected(rowId: string): boolean;
  isColumnSelected?: (field: string) => boolean;
  resizeOverride: ColumnWidthOverride | null;
  resizeLayoutCtrl: ResizeLayoutControl;
  refreshHeaderSelectionState?: () => void;
  refreshHeaderSortState?: () => void;
  refreshHeaderFilterState?: () => void;
  pinnedRightHeaderRowEl: HTMLDivElement | null;
  pinningLayout: ColumnPinningLayout;
  centerSlotCount: number;
  resolveHeaderControls?: ResolveHeaderControls;
  centerRowCount?: number;
  centerToDisplayIndex?: (centerIndex: number) => number;
  pinnedTopRows?: PinnedRowEntry[];
  pinnedBottomRows?: PinnedRowEntry[];
  pinnedTopLaneRows?: PooledRow[];
  pinnedBottomLaneRows?: PooledRow[];
  resolveRowClasses?: ResolveRowClassesFn;
  rowClassVersion?: number;
  resolveCellClasses?: ResolveCellClassesFn;
  cellClassVersion?: number;
  cellRenderers?: CellRendererRegistry;
  layoutMetrics?: GridLayoutMetrics;
  headerAddonHeight?: number;
  headerLaneRefs?: HeaderLaneRefs | null;
  syncHeaderAddons?: (ctx: HeaderAddonSyncContext) => void;
  changedRows?: ReadonlyMap<string, ReadonlySet<string>>;
  flashRows?: ReadonlyMap<string, ReadonlySet<string>>;
}): WindowSyncContext {
  const { pinningLayout } = args;
  return {
    viewport: args.skeleton.viewport,
    root: args.skeleton.root,
    pool: args.pool,
    headerRowEl: args.headerRowEl,
    pinnedHeaderRowEl: args.pinnedHeaderRowEl,
    columns: args.columns,
    displayRows: args.displayRows,
    columnSlotCount: args.columnSlotCount,
    dataRevision: args.dataRevision,
    rowSelection: args.rowSelection,
    suppressRowVirtualization: args.suppressRowVirtualization,
    suppressColumnVirtualization: args.suppressColumnVirtualization,
    getRowId: args.resolveRowId,
    isRowSelected: args.isRowSelected,
    isColumnSelected: args.isColumnSelected,
    resizeOverride: args.resizeOverride,
    resizeLayoutCtrl: args.resizeLayoutCtrl,
    refreshHeaderSelectionState: args.refreshHeaderSelectionState,
    refreshHeaderSortState: args.refreshHeaderSortState,
    refreshHeaderFilterState: args.refreshHeaderFilterState,
    pinnedLeftCount: pinningLayout.leftPinned.length,
    pinnedLeftColumns: pinningLayout.leftPinned,
    centerColumns: pinningLayout.center,
    centerSlotCount: args.centerSlotCount,
    pinnedRightHeaderRowEl: args.pinnedRightHeaderRowEl,
    pinnedRightCount: pinningLayout.rightPinned.length,
    pinnedRightColumns: pinningLayout.rightPinned,
    resolveHeaderControls: args.resolveHeaderControls,
    centerRowCount: args.centerRowCount,
    centerToDisplayIndex: args.centerToDisplayIndex,
    pinnedTopRows: args.pinnedTopRows,
    pinnedBottomRows: args.pinnedBottomRows,
    pinnedTopLaneRows: args.pinnedTopLaneRows,
    pinnedBottomLaneRows: args.pinnedBottomLaneRows,
    resolveRowClasses: args.resolveRowClasses,
    rowClassVersion: args.rowClassVersion,
    resolveCellClasses: args.resolveCellClasses,
    cellClassVersion: args.cellClassVersion,
    cellRenderers: args.cellRenderers,
    layoutMetrics: args.layoutMetrics,
    headerAddonHeight: args.headerAddonHeight,
    headerLaneRefs: args.headerLaneRefs,
    syncHeaderAddons: args.syncHeaderAddons,
    changedRows: args.changedRows,
    flashRows: args.flashRows,
  };
}
