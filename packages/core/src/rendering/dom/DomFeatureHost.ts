import { buildColumnPinningLayout } from "../../features/column-pinning/columnPinningLayout";
import type { EditCommitChange } from "../../features/editing/editingTypes";
import type { OverlayState } from "../../features/overlays";
import { createBuiltInFeatures } from "../../features/registry";
import {
  type CellMenuCapability,
  type ColumnMenuCapability,
  type ColumnOrderCapability,
  type ColumnSelectionCapability,
  type ColumnTransformCapability,
  type DedicatedFilterPopupCapability,
  dispatchHeaderAddonSync,
  type DomGridFeature,
  type EditingCapability,
  type ExactFocusBindingCapability,
  type FilterIndicatorCapability,
  findAllCapabilities,
  findCapability,
  type FloatingFilterCapability,
  type FocusCapability,
  hasCellMenuCapability,
  hasColumnMenuCapability,
  hasColumnOrderCapability,
  hasColumnSelectionCapability,
  hasColumnTransform,
  hasDedicatedFilterPopupCapability,
  hasEditingCapability,
  hasExactFocusBindingCapability,
  hasFilterIndicatorCapability,
  hasFloatingFilterCapability,
  hasFocusCapability,
  hasHeaderAddonCapability,
  hasOverlayCapability,
  hasResizeCapability,
  hasRowActionCapability,
  hasRowOrderCapability,
  hasSelectionCapability,
  hasSortCapability,
  hasTooltipCapability,
  type HeaderAddonCapability,
  type HeaderAddonSyncContext,
  type HeaderLaneRefs,
  type OverlayCapability,
  type ResizeCapability,
  type RowActionCapability,
  type RowOrderCapability,
  type SelectionCapability,
  type SortCapability,
  sumHeaderAddonHeight,
  type TooltipCapability,
} from "../../features/types";
import type { Grid } from "../../Grid";
import type {
  LogicalColumnLayoutInput,
  LogicalColumnLayoutReadSnapshot,
} from "../../internal/columnLayoutReadSnapshot";
import type {
  ColumnWidthOverride,
  DomGridFeatureContext,
  ResizeLayoutControl,
  RowPinnedLogicalPoolRowVisitor,
  VisualRowLayout,
} from "../../internal/layoutTypes";
import {
  captureEmptyRowSelection,
  EMPTY_ID_MEMBERSHIP,
  type ImmutableIdMembership,
  type RowSelectionReadSnapshot,
} from "../../internal/readSnapshots";
import type { GridLayoutMetrics } from "../../layout/gridLayoutMetrics";
import type {
  CellMenuGridApi,
  CellMenuOptions,
  CellRendererRegistry,
  CellShellOverlayRenderer,
  ColumnDef,
  ColumnGroupHeadersSnapshot,
  ColumnMenuGridApi,
  ColumnMenuOptions,
  ColumnOrderConfig,
  ColumnPinChangeSource,
  ColumnPinState,
  ColumnSelectionChangeSource,
  ColumnSelectionConfig,
  ColumnSizeToFitSource,
  FloatingFiltersOptions,
  FocusChangeSource,
  FocusedCell,
  FocusMoveDirection,
  HeaderActionGridApi,
  HeaderActionRendererRegistry,
  LightFastGridCellShellActionEvent,
  LightFastGridColumnOrderChangedEvent,
  LightFastGridColumnSelectionChangedEvent,
  LightFastGridFocusedCellChangedEvent,
  LightFastGridOverlayPresentationChangedEvent,
  LightFastGridRowOrderChangedEvent,
  PooledRow,
  RowActionGridApi,
  RowData,
  RowDragNormalizedConfig,
  RowOrderChangeSource,
  RowSelectionConfig,
  SelectionChange,
  SelectionChangeSource,
  SortChangeSource,
  SortDirection,
  SortModel,
} from "../../types";
import type { DisplayRowReader } from "../rowViewAccess";
import type {
  ColumnLayoutRendererCapability,
  ColumnSelectionRendererCapability,
  SelectionRendererCapability,
} from "../types/capabilities";

export interface DomFeatureHostDeps {
  getPool(): PooledRow[];
  getColumns(): ColumnDef[];
  /** Display-row reader backed by RowView — preferred for display-index lookups. */
  getDisplayRows(): DisplayRowReader;
  /** Reader over ALL rows after sorting, ignoring pagination (selection universe). */
  getFullDisplayRows?(): DisplayRowReader;
  /** Original user-supplied rows in source (insertion) order. */
  getSourceRows(): RowData[];
  getVisibleRowStart(): number;
  /** Horizontally scroll the center viewport so `field` is visible. */
  ensureFieldVisible?(field: string): void;
  /** Visual row order for focused-cell navigation. */
  getVisualRowLayout?(): VisualRowLayout;
  /** Cached viewport height from the renderer's accepted layout state. */
  getCachedViewportHeight?(): number;
  /** Visit row-pinned top/bottom lane pool rows (outside the main pool). */
  forEachRowPinnedLanePoolRow?(cb: (row: PooledRow) => void): void;
  /** Visit row-pinned physical rows grouped by their logical row. */
  forEachRowPinnedLogicalPoolRow?(
    cb: RowPinnedLogicalPoolRowVisitor,
  ): void;
  getLayoutMetrics?(): GridLayoutMetrics;
  getColumnOrderConfig(): ColumnOrderConfig;
  getRowSelectionConfig(): RowSelectionConfig;
  getRowDragConfig(): RowDragNormalizedConfig;
  resolveRowId(row: RowData, index: number): string;
  getHeaderRowEl(): HTMLDivElement | null;
  getPinnedHeaderRowEl(): HTMLDivElement | null;
  getPinnedRightHeaderRowEl(): HTMLDivElement | null;
  getHeaderLaneRefs?: () => HeaderLaneRefs | null;
  getColumnGroupHeaders?: () => ColumnGroupHeadersSnapshot | undefined;
  getDataRevision(): number;
  requestSync(): void;
  requestColumnTransformSync(): void;
  commitResize(field: string, width: number): void;
  notifySelectionChanged?: (
    change: SelectionChange,
    source: SelectionChangeSource,
  ) => void;
  notifyColumnSelectionChanged?: (
    e: LightFastGridColumnSelectionChangedEvent,
  ) => void;
  notifyFocusedCellChanged?: (
    e: LightFastGridFocusedCellChangedEvent,
  ) => void;
  notifyCellShellAction?: (e: LightFastGridCellShellActionEvent) => void;
  notifyColumnOrderChanged?: (e: LightFastGridColumnOrderChangedEvent) => void;
  notifyRowOrderChanged?: (e: LightFastGridRowOrderChangedEvent) => void;
  commitRowOrder?: (
    rowId: string,
    rowIds: string[],
    insertionIndex: number,
    source: RowOrderChangeSource,
  ) => LightFastGridRowOrderChangedEvent | null;
  isRowReorderBlocked?: () => boolean;
  getColumnSelectionConfig(): ColumnSelectionConfig;
  syncColumnSelectionClasses(): void;
  getSortModel(): SortModel;
  isSortPending(): boolean;
  toggleColumnSort(field: string, opts: { multi: boolean; source: SortChangeSource }): void;
  setColumnSort(field: string, direction: SortDirection | null, source?: SortChangeSource, opts?: { multi?: boolean }): void;
  pinColumn(field: string, pinned: "left" | "right" | false, source?: ColumnPinChangeSource): void;
  setColumnPinState?: (state: ColumnPinState[], source?: ColumnPinChangeSource) => void;
  hideColumns?: (fields: string[], source?: "ui" | "api") => void;
  getMenuApi?: () => ColumnMenuGridApi;
  getColumnMenuOptions?: () => ColumnMenuOptions | undefined;
  getCellRenderers?: () => CellRendererRegistry | undefined;
  getCellShellOverlays?: () => Record<string, CellShellOverlayRenderer> | undefined;
  getRowActionGridApi?: () => RowActionGridApi;
  getCellMenuOptions?: () => CellMenuOptions | undefined;
  getCellMenuGridApi?: () => CellMenuGridApi;
  getGridInstance?: () => Grid | null;
  getFloatingFiltersOption?: () => boolean | FloatingFiltersOptions | undefined;
  getOverlayState?: () => OverlayState;
  sizeColumnsToFit?: (source?: ColumnSizeToFitSource) => void;
  sizeSelectedColumnsToFit?: (source?: ColumnSizeToFitSource) => void;
  resetColumnWidths?: (source?: ColumnSizeToFitSource) => void;
  autoSizeColumn?: (field: string, source?: ColumnSizeToFitSource) => void;
  autoSizeSelectedColumns?: (source?: ColumnSizeToFitSource) => void;
  getHeaderRenderers?: () => HeaderActionRendererRegistry | undefined;
  getHeaderActionGridApi?: () => HeaderActionGridApi;
  commitCellEdit?: (change: EditCommitChange) => void;
  notifyColumnMenuChanged?: (openField: string | null) => void;
  notifyOverlayPresentationChanged?: (
    event: LightFastGridOverlayPresentationChangedEvent,
  ) => void;
  /**
   * @internal When set (tests only), replaces the default built-in feature list.
   * Production code must omit this.
   */
  featuresOverride?: DomGridFeature[];
}

const NOOP_RESIZE_LAYOUT_CONTROL: ResizeLayoutControl = {
  isLayoutOnly: () => false,
  updateLayoutKey: () => {},
  resetLayoutKey: () => {},
};

/**
 * Owns built-in features: lifecycle attach/detach, column transforms, and
 * capability surfaces for sync + imperative selection APIs.
 */
export class DomFeatureHost
  implements
    SelectionRendererCapability,
    ColumnSelectionRendererCapability,
    ColumnLayoutRendererCapability
{
  private readonly deps: DomFeatureHostDeps;
  private readonly features: DomGridFeature[];
  private readonly columnTransforms: Array<
    DomGridFeature & ColumnTransformCapability
  >;
  private readonly selectionCapability: (DomGridFeature &
    SelectionCapability) | null;
  private readonly resizeCapability: (DomGridFeature & ResizeCapability) | null;
  private readonly columnSelectionCapability: (DomGridFeature &
    ColumnSelectionCapability) | null;
  private readonly rowOrderCapability: (DomGridFeature & RowOrderCapability) | null;
  private readonly sortCapability: (DomGridFeature & SortCapability) | null;
  private readonly columnMenuCapability: (DomGridFeature & ColumnMenuCapability) | null;
  private readonly cellMenuCapability: (DomGridFeature & CellMenuCapability) | null;
  private readonly rowActionCapability: (DomGridFeature & RowActionCapability) | null;
  private readonly dedicatedFilterPopupCapability: (DomGridFeature & DedicatedFilterPopupCapability) | null;
  private readonly tooltipCapability: (DomGridFeature & TooltipCapability) | null;
  private readonly columnOrderCapability: (DomGridFeature & ColumnOrderCapability) | null;
  private readonly filterIndicatorCapability: (DomGridFeature & FilterIndicatorCapability) | null;
  private readonly overlayCapability: (DomGridFeature & OverlayCapability) | null;
  private readonly focusCapability: (DomGridFeature & FocusCapability) | null;
  private readonly exactFocusBindingCapability: (DomGridFeature &
    ExactFocusBindingCapability) | null;
  private exactFocusBindingActive = false;
  private readonly floatingFilterCapability: (DomGridFeature & FloatingFilterCapability) | null;
  private readonly headerAddonCapabilities: Array<
    DomGridFeature & HeaderAddonCapability
  >;
  private readonly editingCapability: (DomGridFeature & EditingCapability) | null;

  constructor(deps: DomFeatureHostDeps) {
    this.deps = deps;
    this.features =
      deps.featuresOverride ??
      createBuiltInFeatures({
        getColumns: () => deps.getColumns(),
        getColumnOrderConfig: () => deps.getColumnOrderConfig(),
        getRowSelectionConfig: () => deps.getRowSelectionConfig(),
        getColumnSelectionConfig: () => deps.getColumnSelectionConfig(),
        getRowDragConfig: () => deps.getRowDragConfig(),
        getDisplayRows: () => deps.getDisplayRows(),
        getSourceRows: () => deps.getSourceRows(),
        resolveRowId: (row, index) => deps.resolveRowId(row, index),
        onSelectionChanged: deps.notifySelectionChanged,
        onColumnSelectionChanged: deps.notifyColumnSelectionChanged,
        onFocusedCellChanged: deps.notifyFocusedCellChanged,
        onCellShellAction: deps.notifyCellShellAction,
        getCellShellOverlays: deps.getCellShellOverlays,
        onColumnOrderChanged: deps.notifyColumnOrderChanged,
        onRowOrderChanged: deps.notifyRowOrderChanged,
        commitResize: deps.commitResize,
        commitRowOrder: deps.commitRowOrder,
        isRowReorderBlocked: deps.isRowReorderBlocked,
        getSortModel: () => deps.getSortModel(),
        isSortPending: () => deps.isSortPending(),
        toggleColumnSort: (field, opts) => deps.toggleColumnSort(field, opts),
        setColumnSort: (field, direction, source, opts) => deps.setColumnSort(field, direction, source, opts),
        pinColumn: (field, pinned, source) => deps.pinColumn(field, pinned, source),
        setColumnPinState: deps.setColumnPinState
          ? (state, source) => deps.setColumnPinState!(state, source)
          : undefined,
        hideColumns: deps.hideColumns
          ? (fields, source) => deps.hideColumns!(fields, source)
          : undefined,
        getMenuApi: deps.getMenuApi,
        getColumnMenuOptions: deps.getColumnMenuOptions,
        getCellRenderers: deps.getCellRenderers,
        getCellMenuOptions: deps.getCellMenuOptions,
        getCellMenuGridApi: deps.getCellMenuGridApi,
        getGridInstance: deps.getGridInstance,
        getFloatingFiltersOption: deps.getFloatingFiltersOption,
        getOverlayState: deps.getOverlayState,
        sizeColumnsToFit: deps.sizeColumnsToFit,
        sizeSelectedColumnsToFit: deps.sizeSelectedColumnsToFit,
        resetColumnWidths: deps.resetColumnWidths,
        autoSizeColumn: deps.autoSizeColumn,
        autoSizeSelectedColumns: deps.autoSizeSelectedColumns,
        getRowActionGridApi: deps.getRowActionGridApi
          ? () => deps.getRowActionGridApi!()
          : undefined,
        getHeaderRenderers: deps.getHeaderRenderers,
        getSelectedColumnIds: () => this.getSelectedColumnIds(),
        getHeaderActionGridApi: deps.getHeaderActionGridApi
          ? () => deps.getHeaderActionGridApi!()
          : undefined,
        getFocusedCell: () => this.getFocusedCell(),
        setFocusedCell: (target, source) => this.setFocusedCell(target, source as FocusChangeSource),
        commitCellEdit: deps.commitCellEdit,
        onColumnMenuChanged: deps.notifyColumnMenuChanged,
        onOverlayPresentationChanged:
          deps.notifyOverlayPresentationChanged,
      });
    this.columnTransforms = this.features.filter(hasColumnTransform);
    this.selectionCapability =
      findCapability(this.features, hasSelectionCapability) ?? null;
    this.resizeCapability =
      findCapability(this.features, hasResizeCapability) ?? null;
    this.columnSelectionCapability =
      findCapability(this.features, hasColumnSelectionCapability) ?? null;
    this.rowOrderCapability =
      findCapability(this.features, hasRowOrderCapability) ?? null;
    this.sortCapability =
      findCapability(this.features, hasSortCapability) ?? null;
    this.columnMenuCapability =
      findCapability(this.features, hasColumnMenuCapability) ?? null;
    this.cellMenuCapability =
      findCapability(this.features, hasCellMenuCapability) ?? null;
    this.rowActionCapability =
      findCapability(this.features, hasRowActionCapability) ?? null;
    this.dedicatedFilterPopupCapability =
      findCapability(this.features, hasDedicatedFilterPopupCapability) ?? null;
    this.tooltipCapability =
      findCapability(this.features, hasTooltipCapability) ?? null;
    this.columnOrderCapability =
      findCapability(this.features, hasColumnOrderCapability) ?? null;
    this.filterIndicatorCapability =
      findCapability(this.features, hasFilterIndicatorCapability) ?? null;
    this.overlayCapability =
      findCapability(this.features, hasOverlayCapability) ?? null;
    this.floatingFilterCapability =
      findCapability(this.features, hasFloatingFilterCapability) ?? null;
    this.headerAddonCapabilities = findAllCapabilities(
      this.features,
      hasHeaderAddonCapability,
    );
    this.focusCapability =
      findCapability(this.features, hasFocusCapability) ?? null;
    this.exactFocusBindingCapability =
      findCapability(this.features, hasExactFocusBindingCapability) ?? null;
    this.editingCapability =
      findCapability(this.features, hasEditingCapability) ?? null;
  }

  /** Applies column transforms from features in registry order. */
  transformColumns(userColumns: ColumnDef[]): ColumnDef[] {
    let cols = userColumns;
    for (const feature of this.columnTransforms) {
      cols = feature.transformColumns(cols);
    }
    return cols;
  }

  /**
   * Capture logical task columns without consulting DOM/layout state.
   * Feature transforms supply runtime order and internal definitions; user
   * columns in the all-leaf universe are restored to source-definition order.
   */
  captureLogicalColumnLayoutSnapshot(
    input: LogicalColumnLayoutInput,
  ): LogicalColumnLayoutReadSnapshot {
    const transformedAll = this.transformColumns([
      ...input.allUserLeafColumns,
    ]);
    const internalColumns = transformedAll.filter(
      (column) => column.internal !== undefined,
    );
    const transformedVisible = this.transformColumns([
      ...input.visibleUserColumns,
    ]);
    return {
      visibleColumns: buildColumnPinningLayout(transformedVisible).ordered,
      allLeafColumns: [
        ...internalColumns,
        ...input.allUserLeafColumns.filter(
          (column) => column.internal === undefined,
        ),
      ],
    };
  }

  attach(root: HTMLElement, viewport: HTMLElement, surface: HTMLElement): void {
    const hostDeps = this.deps;
    const ctx: DomGridFeatureContext = {
      root,
      surface,
      viewport,
      getPool: () => this.deps.getPool(),
      getColumns: () => this.deps.getColumns(),
      getDisplayRows: () => this.deps.getDisplayRows(),
      getFullDisplayRows: () =>
        (this.deps.getFullDisplayRows ?? this.deps.getDisplayRows)(),
      getSourceRows: () => this.deps.getSourceRows(),
      getVisibleRowStart: () => this.deps.getVisibleRowStart(),
      ensureFieldVisible: this.deps.ensureFieldVisible
        ? (field) => this.deps.ensureFieldVisible!(field)
        : undefined,
      getVisualRowLayout: this.deps.getVisualRowLayout
        ? () => this.deps.getVisualRowLayout!()
        : undefined,
      getCachedViewportHeight: this.deps.getCachedViewportHeight
        ? () => this.deps.getCachedViewportHeight!()
        : undefined,
      forEachRowPinnedLanePoolRow: this.deps.forEachRowPinnedLanePoolRow
        ? (cb) => this.deps.forEachRowPinnedLanePoolRow!(cb)
        : undefined,
      forEachRowPinnedLogicalPoolRow:
        this.deps.forEachRowPinnedLogicalPoolRow
          ? (cb) => this.deps.forEachRowPinnedLogicalPoolRow!(cb)
          : undefined,
      get layoutMetrics() { return hostDeps.getLayoutMetrics?.(); },
      requestSync: () => this.deps.requestSync(),
      requestColumnTransformSync: () =>
        this.deps.requestColumnTransformSync(),
      syncColumnSelectionClasses: () => this.deps.syncColumnSelectionClasses(),
      resolveRowId: (row, index) => this.deps.resolveRowId(row, index),
      getHeaderRowEl: () => this.deps.getHeaderRowEl(),
      getPinnedHeaderRowEl: () => this.deps.getPinnedHeaderRowEl(),
      getPinnedRightHeaderRowEl: () => this.deps.getPinnedRightHeaderRowEl(),
      getHeaderLaneRefs: () => this.deps.getHeaderLaneRefs?.() ?? null,
      getColumnGroupHeaders: () => this.deps.getColumnGroupHeaders?.(),
      hasFloatingFilterRow: () =>
        this.floatingFilterCapability?.hasFloatingFilterRow() ?? false,
      getDataRevision: () => this.deps.getDataRevision(),
      clearRowSelectionFromKeyboard: () =>
        this.clearRowSelectionFromKeyboard(),
      clearColumnSelectionFromKeyboard: () =>
        this.clearColumnSelectionFromKeyboard(),
      toggleRowSelectionAtDisplayIndex: (rowIndex, source) =>
        this.selectionCapability?.toggleRowSelectionAtDisplayIndex(
          rowIndex,
          source,
        ) ?? false,
      selectRowAtDisplayIndex: (rowIndex, source) =>
        this.selectionCapability?.selectRowAtDisplayIndex(
          rowIndex,
          source,
        ) ?? false,
      extendRowSelectionStep: (previousRowIndex, nextRowIndex, source) =>
        this.selectionCapability?.extendRowSelectionStep(
          previousRowIndex,
          nextRowIndex,
          source,
        ) ?? false,
      toggleAllRowSelection: (source) =>
        this.selectionCapability?.toggleAllRowSelection(source) ?? false,
      toggleColumnSelection: (field, source) =>
        this.columnSelectionCapability?.toggleColumnSelection(
          field,
          source,
        ) ?? false,
      getSelectedColumnIdsForColumnOrder: () =>
        this.getSelectedColumnIds(),
      getColumnSelectionConfig: () => this.deps.getColumnSelectionConfig(),
      isColumnSelected: (field) =>
        this.columnSelectionCapability?.isColumnSelected(field) ?? false,
      getFocusedCell: () => this.focusCapability?.getFocusedCell() ?? null,
      setFocusedCellAtDisplayIndex: (rowIndex, field, source) =>
        this.focusCapability?.setFocusedCellAtDisplayIndex(
          rowIndex,
          field,
          source,
        ) ?? false,
      setExactFocusBindingActive: (active) => {
        this.exactFocusBindingActive = active;
      },
      getSelectedRowCountForRowOrder: () => {
        // Universe count — with pagination, the page reader undercounts.
        const totalRows = (
          this.deps.getFullDisplayRows ?? this.deps.getDisplayRows
        )().rowCount;
        return this.selectionCapability?.getSelectedCount(totalRows) ?? 0;
      },
      isRowSelectedForRowOrder: (rowId) => this.isRowSelected(rowId),
      getSelectedRowIdsForRowOrder: () => this.getSelectedRowIds(),
      getSortModel: () => this.deps.getSortModel(),
      toggleSortFromCommand: (field, multi) =>
        this.sortCapability?.toggleSortFromCommand(field, multi) ?? false,
      isCellEditing: () => this.editingCapability?.isEditing() ?? false,
      startCellEditAtDisplayIndex: (rowIndex, field, cellElement, charSeed) =>
        this.editingCapability?.startEditAtDisplayIndex(
          rowIndex,
          field,
          cellElement,
          charSeed,
        ) ?? false,
      stopCellEdit: (commit) =>
        this.editingCapability?.stopEditFromCommand(commit) ?? true,
      toggleBooleanCellAtDisplayIndex: (rowIndex, field) =>
        this.editingCapability?.toggleBooleanCellAtDisplayIndex(
          rowIndex,
          field,
        ) ?? false,
      getBooleanCellKeyboardModeAtDisplayIndex: (rowIndex, field) =>
        this.editingCapability?.getBooleanCellKeyboardModeAtDisplayIndex(
          rowIndex,
          field,
        ) ?? null,
      toggleColumnSort: (field, opts) => this.deps.toggleColumnSort(field, opts),
      setColumnSort: (field, direction, source, opts) => this.deps.setColumnSort(field, direction, source, opts),
      pinColumn: (field, pinned, source) => this.deps.pinColumn(field, pinned, source),
      getOpenColumnMenuField: () =>
        this.columnMenuCapability?.getOpenColumnMenuField() ?? null,
      getOpenColumnMenuPopupId: () =>
        this.columnMenuCapability?.getOpenColumnMenuPopupId() ?? null,
      requestOpenColumnMenu: (field, trigger) =>
        this.columnMenuCapability?.requestOpenColumnMenu(field, trigger) ?? false,
      requestOpenCellMenu: (rowIndex, field, cell, invoker) =>
        this.cellMenuCapability?.requestOpenCellMenu(
          rowIndex,
          field,
          cell,
          invoker,
        ) ?? false,
      resolveVisibleCellMenuTrigger: (rowIndex, field, cell) =>
        this.cellMenuCapability?.resolveVisibleCellMenuTrigger(
          rowIndex,
          field,
          cell,
        ) ?? null,
      requestOpenRowAction: (rowIndex, field, trigger, invoker) =>
        this.rowActionCapability?.requestOpenRowAction(
          rowIndex,
          field,
          trigger,
          invoker,
        ) ?? false,
      requestOpenDedicatedFilter: (field, trigger) =>
        this.dedicatedFilterPopupCapability?.requestOpenDedicatedFilter(
          field,
          trigger,
        ) ?? false,
      closeOpenPopupFromCommand: () => {
        if (this.dedicatedFilterPopupCapability?.closeDedicatedFilterFromCommand()) {
          return true;
        }
        if (this.columnMenuCapability?.closeColumnMenuFromCommand()) return true;
        if (this.cellMenuCapability?.closeCellMenuFromCommand()) return true;
        return this.rowActionCapability?.closeRowActionFromCommand() ?? false;
      },
      requestTooltipForKeyboardTarget: (target) =>
        this.tooltipCapability?.requestTooltipForKeyboardTarget(target),
      dismissKeyboardTooltip: () =>
        this.tooltipCapability?.dismissKeyboardTooltip() ?? false,
      moveColumnFromCommand: (field, visualDelta) =>
        this.columnOrderCapability?.moveColumnFromCommand(
          field,
          visualDelta,
        ) ?? false,
      moveRowFromCommand: (rowIndex, adjacentRowIndex) =>
        this.rowOrderCapability?.moveRowFromCommand(
          rowIndex,
          adjacentRowIndex,
        ) ?? false,
      resizeColumnFromCommand: (field, deltaPx) =>
        this.resizeCapability?.resizeColumnFromCommand(field, deltaPx) ?? false,
    };
    for (const feature of this.features) {
      feature.attach(ctx);
    }
  }

  detach(): void {
    for (const feature of this.features.slice().reverse()) {
      feature.detach();
    }
    this.exactFocusBindingActive = false;
  }

  isRowSelected(rowId: string): boolean {
    return this.selectionCapability?.isRowSelected(rowId) ?? false;
  }

  getSelectedRowIds(): string[] {
    return this.selectionCapability?.getSelectedIds() ?? [];
  }

  captureRowSelectionSnapshot(
    universeRowCount: number,
  ): RowSelectionReadSnapshot {
    return (
      this.selectionCapability?.captureSelectionSnapshot(universeRowCount) ??
      captureEmptyRowSelection(universeRowCount)
    );
  }

  clearSelection(): SelectionChange | null {
    return (
      this.selectionCapability?.clearSelection({ silent: true }) ?? null
    );
  }

  setSelectedRowIds(
    ids: string[],
    opts?: { silent?: boolean; source?: SelectionChangeSource },
  ): SelectionChange | null {
    return this.selectionCapability?.setSelectedIds(ids, opts) ?? null;
  }

  /** Escape / input feature: emit row selection change with `keyboard` source. */
  clearRowSelectionFromKeyboard(): boolean {
    const change =
      this.selectionCapability?.clearSelection({
        silent: false,
        source: "keyboard",
      }) ?? null;
    return change !== null;
  }

  syncSelectionMode(): void {
    this.selectionCapability?.syncSelectionMode();
  }

  /** After header slot sync (column virtualization); restores header checkbox from store. */
  refreshHeaderSelectionState(): void {
    this.selectionCapability?.refreshHeaderSelectionState();
  }

  getResizeOverride(): ColumnWidthOverride | null {
    return this.resizeCapability?.getResizeOverride() ?? null;
  }

  getResizeLayoutControl(): ResizeLayoutControl {
    return this.resizeCapability ?? NOOP_RESIZE_LAYOUT_CONTROL;
  }

  getSelectedColumnIds(): string[] {
    return this.columnSelectionCapability?.getSelectedColumnIds() ?? [];
  }

  captureColumnSelectionSnapshot(): ImmutableIdMembership<string> {
    return (
      this.columnSelectionCapability?.captureColumnSelectionSnapshot() ??
      EMPTY_ID_MEMBERSHIP
    );
  }

  setSelectedColumnIds(
    ids: string[],
    opts?: { silent?: boolean; source?: ColumnSelectionChangeSource },
  ): boolean {
    return (
      this.columnSelectionCapability?.setSelectedColumnIds(ids, opts) ?? false
    );
  }

  clearColumnSelection(): boolean {
    return (
      this.columnSelectionCapability?.clearColumnSelection({
        silent: false,
        source: "api",
      }) ?? false
    );
  }

  clearColumnSelectionFromKeyboard(): boolean {
    return (
      this.columnSelectionCapability?.clearColumnSelection({
        silent: false,
        source: "keyboard",
      }) ?? false
    );
  }

  isColumnSelectedField(field: string): boolean {
    return this.columnSelectionCapability?.isColumnSelected(field) ?? false;
  }

  syncColumnSelectionFromConfig(): void {
    this.columnSelectionCapability?.syncColumnSelectionFromConfig();
  }

  syncRowDragConfig(): void {
    this.rowOrderCapability?.syncRowDragConfig();
  }

  syncColumnOrderConfig(): void {
    this.columnOrderCapability?.syncColumnOrderConfig();
  }

  syncSortState(): void {
    this.sortCapability?.syncSortState();
  }

  syncFloatingFilters(): void {
    this.floatingFilterCapability?.syncFloatingFilters();
  }

  getHeaderAddonHeight(): number {
    return sumHeaderAddonHeight(this.headerAddonCapabilities);
  }

  syncHeaderAddons(context: HeaderAddonSyncContext): void {
    dispatchHeaderAddonSync(this.headerAddonCapabilities, context);
  }

  syncFilterIndicatorState(): void {
    this.filterIndicatorCapability?.syncFilterIndicatorState();
  }

  // ── Focused cell ─────────────────────────────────────────────────────

  getFocusedCell(): FocusedCell | null {
    return this.focusCapability?.getFocusedCell() ?? null;
  }

  setFocusedCell(
    target: { rowId?: string; rowIndex?: number; field: string },
    source?: FocusChangeSource,
  ): void {
    this.focusCapability?.setFocusedCell(target, source);
  }

  clearFocusedCell(source?: FocusChangeSource): void {
    this.focusCapability?.clearFocusedCell(source);
  }

  moveFocusedCell(
    direction: FocusMoveDirection,
    source?: FocusChangeSource,
  ): boolean {
    return this.focusCapability?.moveFocusedCell(direction, source) ?? false;
  }

  /** Re-validate + re-apply focus visuals after a render. */
  syncFocusState(): void {
    this.focusCapability?.syncFocusState();
    if (this.exactFocusBindingActive) {
      this.exactFocusBindingCapability?.syncExactFocusBinding();
    }
  }

  syncOverlays(): void {
    this.overlayCapability?.syncOverlays();
  }

  // ── Editing ──────────────────────────────────────────────────────────

  getEditingCell(): { rowId: string; field: string } | null {
    return this.editingCapability?.getEditingCell() ?? null;
  }

  startEdit(target: { rowId?: string; rowIndex?: number; field: string; charSeed?: string }): boolean {
    return this.editingCapability?.startEdit(target) ?? false;
  }

  stopEdit(opts: { commit: boolean }): boolean {
    return this.editingCapability?.stopEdit(opts) ?? true;
  }

  syncEditingState(): void {
    this.editingCapability?.syncEditingState();
  }

  isRowReorderBlocked(): boolean {
    return this.deps.getSortModel().length > 0;
  }
}
