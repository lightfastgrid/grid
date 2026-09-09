import {
  captureGridEventCallbacks,
  type GridEventSource,
  subscribeGridEventCallbacks,
} from './adapters/gridEventCallbacks';
import type { GridContext } from './context/GridContext';
import { createGridContext } from './context/GridContext';
import type { EventHandler } from './events/EventBus';
import { EventBus } from './events/EventBus';
import type { GridEventMap } from './events/GridEventMap';
import { GridExecutionService } from './execution/GridExecutionService';
import type { QuickSearchOperationInput } from './execution/operations/quick-search';
import { resolveQuickSearchWorkerEligibility } from './execution/operations/quick-search';
import type { SnapshotTransferDisposition } from './execution/operations/quick-search/QuickSearchSnapshotClient';
import { rowIndexExecutionResultToRowOrder } from './execution/operations/types';
import { columnMenuRenderChanged } from './features/column-menu/columnMenuRenderChange';
import type {
  CsvExportCapability,
  CsvExportDefaults,
  CsvExportParams,
  CsvExportTask,
} from './features/csv-export/csvExportTypes';
import type { EditCommitChange } from './features/editing/editingTypes';
import type { NormalizedColumnFilterConfig } from './features/filters';
import {
  createFilterDisplayValueAccessorForModel,
  normalizeColumnFilterModel,
  normalizeFilterModel,
  resolveColumnFilterConfigs,
} from './features/filters';
import { getQuickFilterCacheMode, isQuickFilterEnabled, shouldQuickFilterPrewarm } from './features/quick-search/quickFilterConfig';
import {
  createBuiltInHeadlessFeatures,
  type HeadlessGridFeature,
} from './features/registry';
import { isAutoSizeEligibleColumn } from './features/resize/autoSizeColumnEligibility';
import { measureColumnAutoFitWidth } from './features/resize/measureColumnAutoFit';
import {
  buildSizeToFitColumns,
  computeReservedWidth,
  computeSizeSelectedToFit,
  computeSizeToFit,
  type SizeToFitColumn,
} from './features/resize/sizeColumnsToFit';
import type { GetRowClass, RowClassRules } from './features/row-styling';
import { createSelectionChangedEvent } from './features/selection/createSelectionChangedEvent';
import { RowIdentityService } from './identity/RowIdentityService';
import { columnPixelWidth } from './internal/columnSizing';
import type { RowAccess } from './internal/rowAccess';
import { DomGridRenderer } from './rendering/DomGridRenderer';
import { createDisplayRowReader } from './rendering/rowViewAccess';
import type {
  ColumnLayoutRendererCapability,
  ColumnSelectionRendererCapability,
  EditingRendererCapability,
  FocusRendererCapability,
  GridRenderer,
  SelectionRendererCapability,
} from './rendering/types/capabilities';
import type { GridRenderSnapshot } from './rendering/types/renderSnapshot';
import {
  createEmptyTransactionResult,
  diffImmutableRows,
} from './row-model/transactions';
import { RenderScheduler } from './scheduling/RenderScheduler';
import { GridState } from './state/GridState';
import type { GridThemeInput } from './themes/types';
import { resolveSelectedRowsLiveFromDisplayRows } from './utils/rowSelection';
import { sortModelsEqual } from './utils/sortModel';
import { resolvedThemeEqual, resolveGridTheme } from './themes';
import type {
  CellMenuOptions,
  CellRendererRegistry,
  CellShellOverlayRenderer,
  ColumnDef,
  ColumnFilterModel,
  ColumnGroupHeadersOptions,
  ColumnMenuGridApi,
  ColumnMenuOptions,
  ColumnOrderProp,
  ColumnPinChange,
  ColumnPinChangeSource,
  ColumnPinState,
  ColumnSelectionChangeSource,
  ColumnSelectionProp,
  ColumnSizeToFitSource,
  ColumnVisibilityChange,
  ColumnVisibilityChangeSource,
  ColumnVisibilityState,
  ExecutionOptions,
  FilterChangeSource,
  FilterModel,
  FloatingFiltersOptions,
  FocusChangeSource,
  FocusedCell,
  FocusMoveDirection,
  GridAccessibilityOptions,
  GridAdapterApi,
  GridCreateOptions,
  GridEventCallbacks,
  GridHooks,
  GridLifecycle,
  GridOptions,
  GridOverlayKind,
  GridOverlaysOptions,
  HeaderActionRendererRegistry,
  LightFastGridColumnInput,
  LightFastGridPaginationChangedEvent,
  LightFastGridRowDataUpdatedEvent,
  LightFastGridRowOrderChangedEvent,
  LightFastGridRowPinChangedEvent,
  PaginationChangeSource,
  PaginationConfig,
  PaginationState,
  QuickFilterOptions,
  RowData,
  RowDataTransaction,
  RowDataTransactionResult,
  RowDataUpdateSource,
  RowDragProp,
  RowOrderChangeSource,
  RowPinChange,
  RowPinChangeSource,
  RowPinPosition,
  RowPinStateEntry,
  RowSelectionProp,
  SelectionChange,
  SelectionChangeSource,
  SortChangeSource,
  SortDirection,
  SortModel,
  Unsubscribe,
} from './types';

function isCsvExportCapability(
  feature: HeadlessGridFeature,
): feature is HeadlessGridFeature & CsvExportCapability {
  return (
    "exportDataAsCsv" in feature &&
    typeof feature.exportDataAsCsv === "function" &&
    "getDataAsCsv" in feature &&
    typeof feature.getDataAsCsv === "function"
  );
}

function gridAccessibilityOptionsEqual(
  a: GridAccessibilityOptions | undefined,
  b: GridAccessibilityOptions | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) {
    return a === undefined && b === undefined;
  }
  return (
    a.ariaLabel === b.ariaLabel &&
    a.ariaLabelledBy === b.ariaLabelledBy &&
    a.ariaDescribedBy === b.ariaDescribedBy
  );
}

/**
 * Thin orchestrator over state + events + scheduler + renderer.
 *
 * Framework adapters (React/Vue/Angular) only need to:
 *   1. `new Grid(config, options)`
 *   2. `grid.mount(element)`
 *   3. push props into `setData` / `setColumns` / `setOptions`
 *   4. subscribe with `on(...)`
 *   5. `grid.destroy()` on unmount
 *
 * All grid logic (mutation, batching, rendering) lives below this class.
 */
export class Grid implements GridAdapterApi, GridEventSource, GridLifecycle {
  private readonly rowIdentity = new RowIdentityService();
  private readonly state: GridState;
  private readonly bus = new EventBus<GridEventMap>();
  private readonly scheduler = new RenderScheduler();
  private readonly execution: GridExecutionService;
  private readonly constructorEventCallbacks: Readonly<GridEventCallbacks>;
  private readonly renderer: GridRenderer &
    SelectionRendererCapability &
    ColumnSelectionRendererCapability &
    ColumnLayoutRendererCapability &
    FocusRendererCapability &
    EditingRendererCapability;
  private readonly ctx: GridContext;
  private readonly headlessFeatures: readonly HeadlessGridFeature[];
  private readonly csvExportCapability: CsvExportCapability;
  private readonly unsubscribeEventCallbacks: Unsubscribe;

  private accessibilityOptions?: GridAccessibilityOptions;
  private csvExportConfig?: boolean | CsvExportDefaults;
  private onBeforeCellEditCommitCallback?: GridHooks['onBeforeCellEditCommit'];

  // ── Async transaction batching ─────────────────────────────────────
  private readonly asyncTransactionQueue: Array<{
    transaction: RowDataTransaction;
    callback?: (result: RowDataTransactionResult) => void;
  }> = [];
  private asyncFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private asyncTransactionWaitMillis: number;
  private hasWarnedImmutableWithoutRowId = false;

  private mounted = false;
  private destroyed = false;

  constructor(props: GridCreateOptions) {
    this.constructorEventCallbacks = captureGridEventCallbacks(props);
    this.unsubscribeEventCallbacks = subscribeGridEventCallbacks(
      this,
      () => this.constructorEventCallbacks,
    );
    this.accessibilityOptions = props.accessibility;
    this.csvExportConfig = props.csvExport;
    this.execution = new GridExecutionService(props.execution);
    this.state = new GridState(props);
    this.onBeforeCellEditCommitCallback = props.onBeforeCellEditCommit;
    this.asyncTransactionWaitMillis = Math.max(
      0,
      props.asyncTransactionWaitMillis ?? 50,
    );
    this.ctx = createGridContext(
      props,
      {
        resizeColumn: (field, width) => this.setColumnWidth(field, width),
        notifySelectionChanged: (change, source) => {
          void this.dispatchSelectionChange(change, source);
        },
        notifyColumnSelectionChanged: (e) => {
          this.bus.emit("column-selection:changed", e);
        },
        notifyFocusedCellChanged: (e) => {
          this.bus.emit("focused-cell:changed", e);
        },
        notifyCellShellAction: (e) => {
          this.bus.emit("cell-shell:action", e);
        },
        notifyColumnOrderChanged: (e) => {
          this.bus.emit("column-order:changed", e);
        },
        notifyRowOrderChanged: (e) => {
          this.bus.emit("row-order:changed", e);
        },
        commitRowOrder: (rowId, rowIds, insertionIndex, source) => {
          return this.handleRowOrderCommit(rowId, rowIds, insertionIndex, source);
        },
        notifySortChanged: (e) => {
          this.bus.emit("sort:changed", e);
        },
        toggleColumnSort: (field, opts) => {
          this.toggleColumnSort(field, opts);
        },
        setColumnSort: (field, direction, source, opts) => {
          this.setColumnSort(field, direction, source, opts);
        },
        pinColumn: (field, pinned, source) => {
          this.pinColumn(field, pinned, source);
        },
        setColumnPinState: (state, source) => {
          this.setColumnPinState(state, source);
        },
        notifyColumnPinChanged: (e) => {
          this.bus.emit("column-pin:changed", e);
        },
        hideColumns: (fields, source) => {
          this.hideColumns(fields, source);
        },
        sizeColumnsToFit: (source) => {
          this.sizeColumnsToFit(source);
        },
        sizeSelectedColumnsToFit: (source) => {
          this.sizeSelectedColumnsToFit(source);
        },
        resetColumnWidths: (source) => {
          this.resetColumnWidths(source);
        },
        autoSizeColumn: (field, source) => {
          this.autoSizeColumn(field, source);
        },
        autoSizeSelectedColumns: (source) => {
          this.autoSizeSelectedColumns(source);
        },
        getMenuApi: () => this.getMenuApi(),
        setPageIndex: (pageIndex, source) => {
          this.setPageIndex(pageIndex, source);
        },
        setPageSize: (pageSize, source) => {
          this.setPageSize(pageSize, source);
        },
        notifyColumnMenuChanged: (openField) => {
          this.bus.emit("column-menu:changed", { openField });
        },
        notifyOverlayPresentationChanged: (event) => {
          this.bus.emit("overlay:presentation-changed", event);
        },
      },
      this.rowIdentity,
      () => this,
      (change) => this.commitCellEdit(change),
    );
    this.renderer = new DomGridRenderer(this.ctx);
    this.headlessFeatures = createBuiltInHeadlessFeatures({
      captureReadSnapshot: () => this.state.captureReadSnapshot(),
      captureLogicalColumnLayoutSnapshot: (input) =>
        this.renderer.captureLogicalColumnLayoutSnapshot(input),
      captureRowSelectionSnapshot: (universeRowCount) =>
        this.renderer.captureRowSelectionSnapshot(universeRowCount),
      captureColumnSelectionSnapshot: () =>
        this.renderer.captureColumnSelectionSnapshot(),
      resolveRowId: (row, sourceIndex) =>
        this.ctx.resolveRowId(row, sourceIndex),
      getCsvExportConfig: () => this.csvExportConfig,
      getExecutionThreshold: (name) =>
        this.execution.getExecutionThreshold(name),
      emit: (event, payload) => this.bus.emit(event, payload),
    });
    const csvExportCapability = this.headlessFeatures.find(
      isCsvExportCapability,
    );
    if (csvExportCapability === undefined) {
      throw new Error("Built-in CSV export capability is not registered");
    }
    this.csvExportCapability = csvExportCapability;
  }

  setColumnMenu(options: ColumnMenuOptions | undefined): void {
    this.assertAlive();
    const previous = this.ctx.config.columnMenu;
    this.ctx.config.columnMenu = options;
    if (columnMenuRenderChanged(previous, options)) this.scheduleRender();
  }

  setCellMenu(options: CellMenuOptions | undefined): void {
    this.assertAlive();
    this.ctx.config.cellMenu = options;
  }

  setCellRenderers(renderers: CellRendererRegistry | undefined): void {
    this.assertAlive();
    this.ctx.config.cellRenderers = renderers;
  }

  setHeaderRenderers(
    renderers: HeaderActionRendererRegistry | undefined,
  ): void {
    this.assertAlive();
    this.ctx.config.headerRenderers = renderers;
  }

  setCellShellOverlays(
    overlays: Record<string, CellShellOverlayRenderer> | undefined,
  ): void {
    this.assertAlive();
    this.ctx.config.cellShellOverlays = overlays;
  }

  setCsvExportConfig(config: boolean | CsvExportDefaults | undefined): void {
    this.assertAlive();
    this.csvExportConfig = config;
  }

  setBeforeCellEditCommitHook(
    hook: GridHooks['onBeforeCellEditCommit'],
  ): void {
    this.assertAlive();
    this.onBeforeCellEditCommitCallback = hook;
  }

  resizeColumn(field: string, width: number): void {
    this.setColumnWidth(field, width);
  }

  exportDataAsCsv(params?: CsvExportParams): CsvExportTask {
    this.assertAlive();
    return this.csvExportCapability.exportDataAsCsv(params);
  }

  getDataAsCsv(
    params?: Omit<CsvExportParams, "output">,
  ): Promise<string> {
    this.assertAlive();
    return this.csvExportCapability.getDataAsCsv(params);
  }

  mount(container: HTMLElement): void {
    this.assertAlive();
    if (this.mounted) return;
    this.mounted = true;
    this.renderer.mount(container);
    this.bus.emit('grid:mounted', { container });
    this.scheduleRender();
    this.scheduleQuickSearchPrewarmIfEligible();
  }

  setTheme(theme?: GridThemeInput): void {
    this.assertAlive();
    const resolved = resolveGridTheme(theme);
    if (resolvedThemeEqual(resolved, this.ctx.config.resolvedTheme)) return;
    this.ctx.config.theme = resolved.dataTheme;
    this.ctx.config.resolvedTheme = resolved;
    this.ctx.config.layoutMetrics = resolved.layoutMetrics;
    if (this.mounted) {
      (this.renderer as DomGridRenderer).setTheme(resolved);
    }
  }

  /** Live grid-root accessibility naming options (accessibility plugin reads this). */
  getAccessibilityOptions(): GridAccessibilityOptions | undefined {
    this.assertAlive();
    return this.accessibilityOptions;
  }

  setAccessibilityOptions(
    accessibility: GridAccessibilityOptions | undefined,
  ): void {
    this.assertAlive();
    const prev = this.accessibilityOptions;
    if (gridAccessibilityOptionsEqual(prev, accessibility)) return;
    this.accessibilityOptions = accessibility;
    this.bus.emit("grid:configuration-changed", {
      property: "accessibility",
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.asyncFlushTimer !== null) {
      clearTimeout(this.asyncFlushTimer);
      this.asyncFlushTimer = null;
    }
    this.asyncTransactionQueue.length = 0;
    this.scheduler.cancel();
    for (let index = this.headlessFeatures.length - 1; index >= 0; index -= 1) {
      this.headlessFeatures[index]?.destroy();
    }
    this.execution.destroy();
    this.renderer.destroy();
    this.mounted = false;
    this.unsubscribeEventCallbacks();
    this.bus.emit('grid:destroyed', {});
    this.bus.clear();
  }

  /**
   * Replace source rows. Always runs the replacement path (`data:updated`,
   * invalidation, render scheduling). Pending cell-change flash is kept
   * only when `rows` is the same object sequence as the current source.
   */
  setRows(rows: RowData[]): void {
    this.assertAlive();
    this.state.setRows(rows, this.resolveTransactionRowId);
    this.bus.emit('data:updated', { rowCount: this.state.getRowCount() });
    if (this.state.needsFilterSchedule) {
      this.scheduleFilterForCurrentState();
    } else if (this.state.needsQuickSearchSchedule) {
      this.scheduleQuickSearchForCurrentState();
    } else {
      this.scheduleSortForCurrentState();
    }
    this.scheduleQuickSearchPrewarmIfEligible();
  }

  setColumns(columns: LightFastGridColumnInput[]): void {
    this.assertAlive();
    this.state.setColumns(columns);
    this.bus.emit('columns:updated', { columnCount: this.state.leafColumnCount });
    const sortChanged = this.state.refreshSortModel();
    const filtersChanged = this.renormalizeActiveFilters();
    const sortSource: SortChangeSource | undefined = sortChanged ? "api" : undefined;
    if (this.state.needsFilterSchedule) {
      this.scheduleFilterForCurrentState(filtersChanged ? "api" : undefined, sortSource);
    } else if (filtersChanged) {
      this.execution.cancelFilter();
      this.scheduleSortForCurrentState(sortSource);
      this.notifyFilterChanged("api");
    } else {
      this.scheduleSortForCurrentState(sortSource);
    }
    this.scheduleQuickSearchPrewarmIfEligible();
  }

  setDefaultColDef(
    defaultColDef: GridOptions['defaultColDef'],
  ): void {
    this.assertAlive();
    if (!this.state.setDefaultColDef(defaultColDef)) return;
    this.bus.emit("grid:configuration-changed", {
      property: "defaultColDef",
    });
    const sortChanged = this.state.refreshSortModel();
    const filtersChanged = this.renormalizeActiveFilters();
    const sortSource: SortChangeSource | undefined = sortChanged ? "api" : undefined;
    if (this.state.needsFilterSchedule) {
      this.scheduleFilterForCurrentState(filtersChanged ? "api" : undefined, sortSource);
    } else if (filtersChanged) {
      this.execution.cancelFilter();
      this.scheduleSortForCurrentState(sortSource);
      this.notifyFilterChanged("api");
    } else {
      this.scheduleSortForCurrentState(sortSource);
    }
    this.scheduleQuickSearchPrewarmIfEligible();
  }

  setColumnWidth(field: string, width: number): void {
    this.assertAlive();
    if (this.state.setColumnWidth(field, width)) {
      this.bus.emit("column:resized", { field, width });
      this.scheduleRender();
    }
  }

  sizeColumnsToFit(_source?: ColumnSizeToFitSource): void {
    this.assertAlive();
    const viewportWidth = this.renderer.getViewportWidth();
    if (viewportWidth <= 0) return;

    const snapshot = this.state.getSnapshot();
    const eligible = buildSizeToFitColumns(snapshot.columns);
    this.applySizeToFit(snapshot.columns, eligible, viewportWidth);
  }

  sizeSelectedColumnsToFit(_source?: ColumnSizeToFitSource): void {
    this.assertAlive();
    const viewportWidth = this.renderer.getViewportWidth();
    if (viewportWidth <= 0) return;

    const snapshot = this.state.getSnapshot();
    const selectedIds = new Set(this.getSelectedColumnIds());
    const eligible = buildSizeToFitColumns(snapshot.columns).filter(
      (col) => selectedIds.has(col.field),
    );
    if (eligible.length === 0) return;

    const { widths } = computeSizeSelectedToFit(
      snapshot.columns,
      eligible,
      viewportWidth,
    );
    const changed = this.state.setColumnWidths(widths);
    if (changed.length === 0) return;

    for (const field of changed) {
      this.bus.emit("column:resized", { field, width: widths[field]! });
    }
    this.scheduleRender();
  }

  resetColumnWidths(_source?: ColumnSizeToFitSource): void {
    this.assertAlive();
    const changed = this.state.resetColumnWidths();
    if (changed.length === 0) return;

    const snapshot = this.state.getSnapshot();
    for (const field of changed) {
      const col = snapshot.columns.find((c) => c.field === field);
      const width = col ? columnPixelWidth(col) : 150;
      this.bus.emit("column:resized", { field, width });
    }
    this.scheduleRender();
  }

  autoSizeColumn(field: string, source?: ColumnSizeToFitSource): void {
    this.autoSizeColumns([field], source);
  }

  autoSizeColumns(fields: string[], _source?: ColumnSizeToFitSource): void {
    this.assertAlive();
    if (fields.length === 0) return;

    const snapshot = this.state.getSnapshot();
    const { visibleRowStart, poolRowCount, displayRows } = this.renderer.getAutoSizeContext();
    const fieldSet = new Set(fields);

    const widths: Record<string, number> = {};
    for (const col of snapshot.columns) {
      if (!fieldSet.has(col.field)) continue;
      if (!isAutoSizeEligibleColumn(col)) continue;
      widths[col.field] = measureColumnAutoFitWidth(
        col, col.field, visibleRowStart, poolRowCount, displayRows,
      );
    }

    const changed = this.state.setColumnWidths(widths);
    if (changed.length === 0) return;

    for (const field of changed) {
      this.bus.emit("column:resized", { field, width: widths[field]! });
    }
    this.scheduleRender();
  }

  autoSizeSelectedColumns(source?: ColumnSizeToFitSource): void {
    this.assertAlive();
    const selectedIds = this.getSelectedColumnIds();
    if (selectedIds.length === 0) return;
    this.autoSizeColumns(selectedIds, source);
  }

  /** Shared size-to-fit application: compute target, fit, emit, render. */
  private applySizeToFit(
    allColumns: ColumnDef[],
    eligible: SizeToFitColumn[],
    viewportWidth: number,
  ): void {
    if (eligible.length === 0) return;

    const eligibleFields = new Set<string>();
    for (const col of eligible) eligibleFields.add(col.field);

    const reserved = computeReservedWidth(allColumns, eligibleFields);
    const centerTarget = viewportWidth - reserved;
    if (centerTarget <= 0) return;

    const { widths } = computeSizeToFit(eligible, centerTarget);
    const changed = this.state.setColumnWidths(widths);
    if (changed.length === 0) return;

    for (const field of changed) {
      this.bus.emit("column:resized", { field, width: widths[field]! });
    }
    this.scheduleRender();
  }

  setRowSelection(value: RowSelectionProp): void {
    this.assertAlive();
    if (this.state.setRowSelection(value)) {
      this.scheduleRender();
      this.bus.emit("grid:configuration-changed", {
        property: "rowSelection",
      });
    }
  }

  setColumnSelection(value: ColumnSelectionProp): void {
    this.assertAlive();
    if (this.state.setColumnSelection(value)) {
      this.scheduleRender();
      this.bus.emit("grid:configuration-changed", {
        property: "columnSelection",
      });
    }
  }

  setColumnOrder(value: ColumnOrderProp | undefined): void {
    this.assertAlive();
    if (this.state.setColumnOrder(value)) this.scheduleRender();
  }

  setRowDrag(value: RowDragProp | undefined): void {
    this.assertAlive();
    if (this.state.setRowDrag(value)) this.scheduleRender();
  }

  /**
   * Update the class-only row styling inputs (`rowClass`, `getRowClass`,
   * `rowClassRules`). Schedules exactly one render when any input actually
   * changed. Triggers row-class recompute on visible rows only — non-visible
   * rows are not bound and their callbacks never run.
   */
  setRowStyling(value: {
    rowClass?: string | string[];
    getRowClass?: GetRowClass;
    rowClassRules?: RowClassRules;
  }): void {
    this.assertAlive();
    if (this.state.setRowStyling(value)) {
      this.scheduleRender();
    }
  }

  // ── Overlays ─────────────────────────────────────────────────────

  setLoading(loading: boolean): void {
    this.assertAlive();
    if (this.state.setLoading(loading)) {
      this.scheduleRender();
      this.bus.emit("overlay:changed", {});
    }
  }

  showLoadingOverlay(): void {
    this.assertAlive();
    if (this.state.setManualOverlay("loading")) {
      this.scheduleRender();
      this.bus.emit("overlay:changed", {});
    }
  }

  showNoRowsOverlay(): void {
    this.assertAlive();
    if (this.state.setManualOverlay("noRows")) {
      this.scheduleRender();
      this.bus.emit("overlay:changed", {});
    }
  }

  showNoMatchingRowsOverlay(): void {
    this.assertAlive();
    if (this.state.setManualOverlay("noMatchingRows")) {
      this.scheduleRender();
      this.bus.emit("overlay:changed", {});
    }
  }

  hideOverlay(): void {
    this.assertAlive();
    if (this.state.setManualOverlay(null)) {
      this.scheduleRender();
      this.bus.emit("overlay:changed", {});
    }
  }

  /**
   * Replace the overlay customization (text/className/render per variant).
   * Schedules a render only when the reference changes.
   */
  setOverlays(overlays: GridOverlaysOptions | undefined): void {
    this.assertAlive();
    if (this.state.setOverlays(overlays)) {
      this.scheduleRender();
    }
  }

  setFloatingFilters(value: boolean | FloatingFiltersOptions | undefined): void {
    this.assertAlive();
    if (this.state.setFloatingFilters(value)) {
      this.scheduleRender();
      this.bus.emit("grid:configuration-changed", {
        property: "floatingFilters",
      });
    }
  }

  /**
   * Show or suppress column group header rows without changing leaf columns.
   * Nested `columns` input is preserved; only group header chrome is toggled.
   */
  setColumnGroupHeaders(
    value: boolean | ColumnGroupHeadersOptions | undefined,
  ): void {
    this.assertAlive();
    if (this.state.setColumnGroupHeaders(value)) {
      this.scheduleRender();
      this.bus.emit("grid:configuration-changed", {
        property: "columnGroupHeaders",
      });
    }
  }

  /** Whether group header rows are currently enabled (display config). */
  isColumnGroupHeadersEnabled(): boolean {
    this.assertAlive();
    return this.state.isColumnGroupHeadersEnabled();
  }

  /** Read the current overlay state (loading, manualOverlay, overlays). */
  getOverlayState(): {
    loading: boolean;
    manualOverlay: GridOverlayKind | null;
    overlays?: GridOverlaysOptions;
  } {
    this.assertAlive();
    return this.state.getOverlayState();
  }

  setSortModel(model: SortModel, source: SortChangeSource = "api"): void {
    this.assertAlive();
    if (!this.state.setSortModel(model)) return;
    this.scheduleSortForCurrentState(source);
  }

  getSortModel(): SortModel {
    this.assertAlive();
    return this.state.getSortModel();
  }

  clearSort(source: SortChangeSource = "api"): void {
    this.assertAlive();
    if (!this.state.setSortModel([])) return;
    this.execution.cancelSort();
    this.state.clearSortPending();
    this.scheduleRender();
    this.notifySortChanged(source);
  }

  toggleColumnSort(
    field: string,
    opts?: { multi?: boolean; source?: SortChangeSource },
  ): void {
    this.assertAlive();
    const multi = opts?.multi === true;
    const source = opts?.source ?? "api";
    const current = this.state.getSortModel();
    const currentDir = current.find((s) => s.field === field)?.sort;

    let nextDir: SortDirection | null;
    if (!currentDir) nextDir = "asc";
    else if (currentDir === "asc") nextDir = "desc";
    else nextDir = null;

    let next: SortModel;
    if (multi) {
      const others = current.filter((s) => s.field !== field);
      next = nextDir ? [...others, { field, sort: nextDir }] : others;
    } else {
      next = nextDir ? [{ field, sort: nextDir }] : [];
    }

    if (!this.state.setSortModel(next)) return;
    this.scheduleSortForCurrentState(source);
  }

  setColumnSort(
    field: string,
    direction: SortDirection | null,
    source: SortChangeSource = "api",
    opts?: { multi?: boolean },
  ): void {
    this.assertAlive();
    const multi = opts?.multi === true;
    let next: SortModel;
    if (multi) {
      const current = this.state.getSortModel();
      const others = current.filter((s) => s.field !== field);
      next = direction ? [...others, { field, sort: direction }] : others;
    } else {
      next = direction ? [{ field, sort: direction }] : [];
    }
    if (!this.state.setSortModel(next)) return;
    this.scheduleSortForCurrentState(source);
  }

  private scheduleSortForCurrentState(emitSource?: SortChangeSource): void {
    const rowCount = this.state.getRowCount();
    const sortModel = this.state.getSortModel();

    if (sortModel.length === 0 || rowCount < this.execution.getSortThreshold()) {
      this.execution.cancelSort();
      this.state.clearSortPending();
      this.scheduleRender();
      if (emitSource) this.notifySortChanged(emitSource);
      return;
    }

    // Build sort execution context before scheduling so the async path
    // shares RowValueCache + SortOrderPairCache with the sync path. The
    // cache boundary handles warm pair-cache hits (single-column
    // ASC↔DESC) — those complete synchronously inside scheduleSort, so
    // sortPending is only marked when the sort is actually async.
    const sortCtx = this.state.getSortExecutionContext();
    const sortCache = this.state.getSortOperationCache();
    const rows = this.state.getRows();
    const columns = this.state.getVisibleColumnDefs();

    // Pass the upstream quick-search order so the async sort operates on
    // the narrowed match set — the composition is raw rows → column filter
    // → quick search → sort → pagination. Sorting from the column-filtered
    // order alone would drop the quick-search narrowing and re-expand the
    // result to the full filtered dataset. The typed-array reference is
    // passed through directly (no copy or re-scan).
    const filteredOrder = this.state.getFilteredRowOrder(rows);
    const quickSearchOrder = this.state.getQuickSearchRowOrder(rows, filteredOrder);
    const sourceIndexes = quickSearchOrder.kind === 'indexed'
      ? quickSearchOrder.indexes
      : undefined;

    const completedSynchronously = { current: false };
    let scheduleReturned = false;

    this.execution.scheduleSort(rows, sortModel, columns, (completion) => {
      if (!scheduleReturned) completedSynchronously.current = true;

      if (this.destroyed) return;
      if (completion.sourceRows !== this.state.getRows()) return;
      if (!sortModelsEqual(completion.sortModel, this.state.getSortModel())) return;

      if (completion.producer === "cache") {
        // The cache adapter already populated GridState.sortCache via
        // tryResolveCachedSortOrder() — keep that stable RowOrder
        // instead of replacing it with a re-wrapped one.
        this.state.clearSortPending();
      } else {
        const rowOrder = rowIndexExecutionResultToRowOrder(completion.result);
        this.state.applySortedRowOrder(rowOrder);
      }

      this.scheduleRender();
    }, sortCtx, sortCache, sourceIndexes);

    scheduleReturned = true;

    if (completedSynchronously.current) {
      if (emitSource) this.notifySortChanged(emitSource);
      return;
    }

    this.state.markSortPending();
    this.scheduleRender();
    if (emitSource) this.notifySortChanged(emitSource);
  }

  // ── Filter Model ─────────────────────────────────────────────────────

  setFilterModel(model: FilterModel, source: FilterChangeSource = "api"): void {
    this.assertAlive();
    const columnsByField = this.resolveColumnFilterConfigs();
    const normalized = normalizeFilterModel(model, { columnsByField });
    if (!this.state.setFilterModel(normalized)) return;
    this.afterFilterModelMutation(source);
  }

  getFilterModel(): FilterModel {
    this.assertAlive();
    return this.state.getFilterModel();
  }

  clearFilters(source: FilterChangeSource = "api"): void {
    this.setFilterModel({}, source);
  }

  setColumnFilterModel(
    field: string,
    model: ColumnFilterModel | null,
    source: FilterChangeSource = "api",
  ): void {
    this.assertAlive();
    if (model === null) {
      if (!this.state.clearColumnFilter(field)) return;
    } else {
      const config = this.resolveColumnFilterConfigs().get(field);
      if (!config) return;
      const normalized = normalizeColumnFilterModel(model, config);
      if (normalized === null) {
        if (!this.state.clearColumnFilter(field)) return;
      } else {
        if (!this.state.setColumnFilterModel(field, normalized)) return;
      }
    }
    this.afterFilterModelMutation(source);
  }

  getColumnFilterModel(field: string): ColumnFilterModel | null {
    this.assertAlive();
    return this.state.getColumnFilterModel(field);
  }

  clearColumnFilter(field: string, source: FilterChangeSource = "api"): void {
    this.setColumnFilterModel(field, null, source);
  }

  getColumnFilterConfig(field: string): NormalizedColumnFilterConfig | null {
    this.assertAlive();
    return this.resolveColumnFilterConfigs().get(field) ?? null;
  }

  private afterFilterModelMutation(source: FilterChangeSource): void {
    if (this.state.isQuickFilterPresent()) {
      this.execution.cancelQuickSearch();
    }
    if (this.state.hasActiveFilters()) {
      this.scheduleFilterForCurrentState(source);
    } else {
      this.execution.cancelFilter();
      this.notifyFilterChanged(source);
      if (this.state.needsQuickSearchSchedule) {
        this.scheduleQuickSearchForCurrentState();
      } else {
        this.scheduleSortForCurrentState();
      }
    }
  }

  private resolveColumnFilterConfigs(): ReadonlyMap<string, NormalizedColumnFilterConfig> {
    const cols = this.state.getColumnDefs();
    const d = this.state.getDefaultColDef();
    return resolveColumnFilterConfigs({ columns: cols, defaultFilterable: d?.filterable, defaultFilter: d?.filter });
  }

  /**
   * Re-normalize the active filter model against the current column
   * configs. Called after `setColumns` / `setDefaultColDef` to drop
   * filters for fields that are no longer configured or filterable.
   */
  private renormalizeActiveFilters(): boolean {
    if (!this.state.hasActiveFilters()) return false;
    const columnsByField = this.resolveColumnFilterConfigs();
    const current = this.state.getFilterModel();
    const normalized = normalizeFilterModel(current, { columnsByField });
    return this.state.setFilterModel(normalized);
  }

  private scheduleFilterForCurrentState(
    filterChangeSource?: FilterChangeSource,
    sortChangeSource?: SortChangeSource,
  ): void {
    const rows = this.state.getRows();
    const filterModel = this.state.getFilterModel();
    const columnsByField = this.resolveColumnFilterConfigs();
    const getCellValue = createFilterDisplayValueAccessorForModel(
      this.state.getColumnDefs(),
      columnsByField,
      filterModel,
    );

    const completedSynchronously = { current: false };
    let scheduleReturned = false;

    this.execution.scheduleFilter(rows, filterModel, columnsByField, (completion) => {
      if (!scheduleReturned) completedSynchronously.current = true;

      if (this.destroyed) return;
      if (completion.sourceRows !== this.state.getRows()) return;
      if (!this.state.isCurrentFilterModel(completion.filterModel)) return;

      const rowOrder = rowIndexExecutionResultToRowOrder(completion.result);
      this.state.applyFilteredRowOrder(rowOrder);

      if (this.state.needsQuickSearchSchedule) {
        this.scheduleQuickSearchForCurrentState();
      } else if (this.state.needsSortSchedule) {
        this.scheduleSortForCurrentState(sortChangeSource);
      } else {
        this.scheduleRender();
      }
      if (filterChangeSource) this.notifyFilterChanged(filterChangeSource);
    }, getCellValue);

    scheduleReturned = true;

    if (completedSynchronously.current) {
      return;
    }

    this.state.markFilterPending();
    this.scheduleRender();
  }

  private notifyFilterChanged(source: FilterChangeSource): void {
    const filterModel = this.state.getFilterModel();
    const snapshot = this.state.getSnapshot();
    const fullView = snapshot.fullRowView ?? snapshot.rowView;
    const event = {
      filterModel,
      source,
      activeFilterCount: Object.keys(filterModel).length,
      totalRows: this.state.getRowCount(),
      filteredRows: fullView.rowCount,
    };
    this.bus.emit("filter:changed", event);
  }

  // ── Quick Filter / Quick Search ───────────────────────────────────────

  setQuickFilterText(text: string): void {
    this.assertAlive();
    const wasPending = this.state.isQuickSearchPending();
    if (!this.state.setQuickFilterText(text)) return;
    this.afterQuickFilterMutation(wasPending);
  }

  clearQuickFilter(): void {
    this.setQuickFilterText("");
  }

  getQuickFilterText(): string {
    this.assertAlive();
    return this.state.getQuickFilterText();
  }

  isQuickFilterPresent(): boolean {
    this.assertAlive();
    return this.state.isQuickFilterPresent();
  }

  /**
   * Replace quick-filter options (for example `includeHiddenColumns`).
   * When a query is active, enters pending state and schedules quick-search
   * work; otherwise cancels any in-flight quick-search execution.
   */
  setQuickFilterConfig(quickFilter: boolean | QuickFilterOptions | undefined): void {
    this.assertAlive();
    const wasPending = this.state.isQuickSearchPending();
    const wasEnabled = isQuickFilterEnabled(this.state.getQuickFilterOptions());
    if (!this.state.setQuickFilterOptions(quickFilter)) return;
    if (wasEnabled && !isQuickFilterEnabled(this.state.getQuickFilterOptions())) {
      // §9: edits during the disabled window are untracked, so a retained
      // worker snapshot could serve stale text on re-enable. Clearing it
      // forces the next sync to start a fresh generation.
      this.execution.clearQuickSearchWorkerSnapshot();
    }
    this.afterQuickFilterConfigMutation(wasPending);
  }

  private afterQuickFilterConfigMutation(wasPendingBefore: boolean): void {
    this.scheduleQuickSearchForCurrentState(wasPendingBefore);
    this.scheduleQuickSearchPrewarmIfEligible();
    if (this.state.needsSortSchedule) {
      this.scheduleSortForCurrentState();
    }
  }

  /**
   * Central hook for quick-search execution orchestration. Cancels stale
   * work, marks pending while fresh results are scheduled, and renders.
   */
  private buildQuickSearchOperationInput(): QuickSearchOperationInput {
    const rows = this.state.getRows();
    const filteredOrder = this.state.getFilteredRowOrder(rows);
    const sourceIndexes =
      filteredOrder.kind === "indexed" ? filteredOrder.indexes : undefined;
    const dependencyPlan = this.state.getQuickSearchDependencyPlan();

    return {
      rows,
      quickFilterText: this.state.getQuickFilterText(),
      quickFilter: this.state.getQuickFilterOptions(),
      quickFilterCacheMode: getQuickFilterCacheMode(this.state.getQuickFilterOptions()),
      columns: this.state.getAllEffectiveColumnDefs(),
      dependencyPlan,
      sourceIndexes,
      searchableFieldsSignature: dependencyPlan.fieldsSignature,
      filterModel: this.state.getFilterModel(),
      filteredOrderVersion: this.state.getFilteredOrderVersion(),
      sourceLayoutRevision: this.state.getQuickSearchSourceLayoutRevision(),
      searchableDataRevision: this.state.getQuickSearchSearchableDataRevision(),
      // Deferred: begins ownership only from worker.buildPayload() after
      // OperationExecutionRunner cancels prior worker work.
      prepareWorkerTransfer: () => this.prepareQuickSearchWorkerTransfer(),
    };
  }

  /**
   * Begin a dirty-index transfer for the large worker-eligible path.
   * Invoked at most once per worker request from buildPayload — never while
   * constructing the normal operation input.
   */
  private prepareQuickSearchWorkerTransfer() {
    const transfer = this.state.beginQuickSearchDirtySourceTransferIfNeeded();
    if (transfer === undefined) {
      return undefined;
    }
    return {
      transferId: transfer.transferId,
      indexes: transfer.indexes,
      complete: transfer.complete,
      onDisposition: (disposition: SnapshotTransferDisposition) => {
        if (this.destroyed) return;
        switch (disposition.kind) {
          case "posted":
            this.state.acknowledgeQuickSearchDirtySourceTransferPosted(
              disposition.transferId,
            );
            break;
          case "cancelled":
            this.state.cancelQuickSearchDirtySourceTransfer(disposition.transferId);
            break;
          case "rebuild-required":
            this.state.acknowledgeQuickSearchDirtySourceTransferCoveredByFullSnapshot(
              disposition.transferId,
            );
            break;
        }
      },
    };
  }

  private scheduleQuickSearchForCurrentState(wasPendingBefore = false): void {
    if (!this.state.isQuickFilterPresent()) {
      this.execution.cancelQuickSearch();
      this.state.clearQuickSearchPending();
      if (wasPendingBefore) {
        this.notifyQuickSearchPendingChanged(false);
      }
      this.scheduleRender();
      return;
    }

    if (!this.state.needsQuickSearchSchedule) {
      this.scheduleRender();
      return;
    }

    // The quick-search result is the sort's upstream source. Scheduling a
    // fresh search invalidates that source, so any in-flight sort is now
    // stale: without cancellation it could complete and commit a
    // full-source order over the pre-search subset (its completion guard
    // only checks rows identity + sort model, both unchanged by a
    // quick-search edit). Cancel it via the execution tracker before the
    // new search runs; the accepted search completion reschedules the sort
    // over the narrowed subset. The captured sort fallback keeps the last
    // good order on screen while the search is pending — no synchronous
    // re-sort is triggered.
    if (this.state.getSortModel().length > 0 && this.state.isSortPending()) {
      this.execution.cancelSort();
    }

    const input = this.buildQuickSearchOperationInput();
    const completedSynchronously = { current: false };
    let scheduleReturned = false;

    this.execution.scheduleQuickSearch(input, (completion) => {
      if (!scheduleReturned) completedSynchronously.current = true;

      if (this.destroyed) return;
      if (completion.quickFilterText !== this.state.getQuickFilterText()) return;
      if (
        completion.searchableFieldsSignature !==
        this.state.getQuickSearchSearchableFieldsSignature()
      ) {
        return;
      }
      if (!this.state.isCurrentFilterModel(completion.filterModel)) {
        return;
      }
      if (completion.filteredOrderVersion !== this.state.getFilteredOrderVersion()) {
        return;
      }
      if (
        completion.sourceLayoutRevision !==
        this.state.getQuickSearchSourceLayoutRevision()
      ) {
        return;
      }
      if (
        completion.searchableDataRevision !==
        this.state.getQuickSearchSearchableDataRevision()
      ) {
        return;
      }

      const wasPending = this.state.isQuickSearchPending();
      const rowOrder = rowIndexExecutionResultToRowOrder(completion.result);
      this.state.applyQuickSearchRowOrder(rowOrder);

      if (wasPending) {
        this.notifyQuickSearchPendingChanged(false);
      }

      if (this.state.needsSortSchedule) {
        this.scheduleSortForCurrentState();
      } else {
        this.scheduleRender();
      }
    });

    scheduleReturned = true;

    if (completedSynchronously.current) {
      return;
    }

    if (!this.state.isQuickSearchPending()) {
      this.state.markQuickSearchPending();
      this.notifyQuickSearchPendingChanged(true);
    }
    this.scheduleRender();
  }

  private afterQuickFilterMutation(wasPendingBefore: boolean): void {
    const text = this.state.getQuickFilterText();
    const hasQuery = this.state.isQuickFilterPresent();

    this.scheduleQuickSearchForCurrentState(wasPendingBefore);

    if (!hasQuery) {
      this.scheduleSortForCurrentState();
    }

    this.notifyQuickFilterChanged(text);
  }

  private notifyQuickFilterChanged(text: string): void {
    const event = { quickFilterText: text, source: "api" as const };
    this.bus.emit("quick-filter:changed", event);
  }

  private notifyQuickSearchPendingChanged(pending: boolean): void {
    const event = { pending };
    this.bus.emit("quick-search-pending:changed", event);
  }

  /**
   * Background worker snapshot sync for large worker-eligible datasets.
   * Never marks pending and never runs on the input keystroke path.
   */
  private scheduleQuickSearchPrewarmIfEligible(): void {
    const quickFilter = this.state.getQuickFilterOptions();
    const rows = this.state.getRows();
    const threshold = this.execution.getQuickSearchThreshold();
    const dependencyPlan = this.state.getQuickSearchDependencyPlan();

    const eligibility = resolveQuickSearchWorkerEligibility({
      rows,
      quickFilterText: "",
      quickFilter,
      columns: this.state.getAllEffectiveColumnDefs(),
      dependencyPlan,
      searchableFieldsSignature: dependencyPlan.fieldsSignature,
      filterModel: this.state.getFilterModel(),
      filteredOrderVersion: this.state.getFilteredOrderVersion(),
      sourceLayoutRevision: this.state.getQuickSearchSourceLayoutRevision(),
      searchableDataRevision: this.state.getQuickSearchSearchableDataRevision(),
    });

    if (
      !shouldQuickFilterPrewarm({
        quickFilter,
        rowCount: rows.length,
        threshold,
        workerEligible: eligibility.eligible,
      })
    ) {
      this.execution.cancelQuickSearchPrewarm();
      return;
    }

    this.execution.prewarmQuickSearchSnapshot({
      rows,
      descriptors: eligibility.descriptors,
      fieldsSignature: eligibility.fieldsSignature,
      sourceLayoutRevision: this.state.getQuickSearchSourceLayoutRevision(),
      searchableDataRevision: this.state.getQuickSearchSearchableDataRevision(),
    });
  }

  private handleRowOrderCommit(
    rowId: string,
    rowIds: string[],
    insertionIndex: number,
    source: RowOrderChangeSource,
  ): LightFastGridRowOrderChangedEvent | null {
    const result = this.state.moveRowsByIds(
      rowId,
      rowIds,
      insertionIndex,
      (row, i) => this.ctx.resolveRowId(row, i),
    );
    if (!result?.changed) return null;
    this.scheduleRender();

    const event: LightFastGridRowOrderChangedEvent = {
      rowId: result.rowId,
      rowIds: result.rowIds,
      row: result.rows[result.rowIds.indexOf(result.rowId)] ?? result.rows[0]!,
      rows: result.rows,
      fromIndex: result.fromIndex,
      fromIndices: result.fromIndices,
      toIndex: result.toIndex,
      source,
      getRowOrderIds: () => {
        const rows = this.state.getRows();
        return rows.map((row, index) => this.ctx.resolveRowId(row, index));
      },
      getRows: () => this.state.getRows().slice(),
    };

    this.bus.emit("row-order:changed", event);
    return event;
  }

  getRowCount(): number {
    return this.state.getRowCount();
  }

  getRows(): RowData[] {
    this.assertAlive();
    return this.state.getRows().slice();
  }

  getSelectedRowIds(): string[] {
    this.assertAlive();
    if (!this.mounted) return [];
    return this.renderer.getSelectedRowIds();
  }

  getSelectedRows(): RowData[] {
    this.assertAlive();
    if (!this.mounted) return [];
    // Full (unpaginated) view so selections on other pages resolve too.
    const snapshot = this.state.getSnapshot();
    const displayRows = createDisplayRowReader(
      snapshot.fullRowView ?? snapshot.rowView,
    );
    return resolveSelectedRowsLiveFromDisplayRows(
      displayRows,
      (row, index) => this.ctx.resolveRowId(row, index),
      (id) => this.renderer.isRowSelected(id),
    );
  }

  clearSelection(): void {
    this.assertAlive();
    if (!this.mounted) return;
    const change = this.renderer.clearSelection();
    if (!change) return;
    this.dispatchSelectionChange(change, "api");
  }

  /**
   * Replace the current row selection with exactly these ids.
   * Respects the active mode: `none` → no-op, `single` → first id only.
   * Emits `selection:changed` with the given source (default `"api"`).
   */
  setSelectedRowIds(
    ids: string[],
    source: SelectionChangeSource = "api",
  ): void {
    this.assertAlive();
    if (!this.mounted) return;
    const change = this.renderer.setSelectedRowIds(ids, {
      silent: true,
      source,
    });
    if (!change) return;
    this.dispatchSelectionChange(change, source);
  }

  /**
   * Restore header row-selection checkbox (checked/indeterminate) from the
   * current selection model. Called internally after header DOM rebind; safe
   * to call after horizontal column virtualization.
   */
  refreshHeaderSelectionState(): void {
    this.assertAlive();
    if (!this.mounted) return;
    this.renderer.refreshHeaderSelectionState();
  }

  getSelectedColumnIds(): string[] {
    this.assertAlive();
    if (!this.mounted) return [];
    return this.renderer.getSelectedColumnIds();
  }

  setSelectedColumnIds(
    ids: string[],
    source: ColumnSelectionChangeSource = "api",
  ): void {
    this.assertAlive();
    if (!this.mounted) return;
    this.renderer.setSelectedColumnIds(ids, {
      silent: false,
      source,
    });
  }

  clearColumnSelection(): void {
    this.assertAlive();
    if (!this.mounted) return;
    this.renderer.clearColumnSelection();
  }

  pinColumn(field: string, pinned: "left" | "right" | false, source: ColumnPinChangeSource = "api"): void {
    this.assertAlive();
    const previousPinned = this.state.setColumnPinned(field, pinned);
    if (previousPinned === null) return;
    const event = this.createColumnPinChangedEvent(
      [{ field, pinned, previousPinned }],
      source,
    );
    this.bus.emit("column-pin:changed", event);
    this.scheduleRender();
  }

  unpinColumn(field: string, source: ColumnPinChangeSource = "api"): void {
    this.pinColumn(field, false, source);
  }

  setColumnPinState(
    state: ColumnPinState[],
    source: ColumnPinChangeSource = "api",
  ): void {
    this.assertAlive();
    const changes = this.state.setColumnPinState(state);
    if (changes.length === 0) return;
    const event = this.createColumnPinChangedEvent(changes, source);
    this.bus.emit("column-pin:changed", event);
    this.scheduleRender();
  }

  getColumnPinState(): ColumnPinState[] {
    this.assertAlive();
    return this.state.getColumnPinState();
  }

  /**
   * Effective leaf column defs for user columns (excludes internal system columns).
   * Used by app chrome that needs header labels / pinnable / etc.
   */
  getColumns(): ColumnDef[] {
    this.assertAlive();
    return this.state
      .getAllEffectiveColumnDefs()
      .filter((col) => !col.internal);
  }

  clearColumnPinning(source: ColumnPinChangeSource = "api"): void {
    this.setColumnPinState([], source);
  }

  // ── Row pinning ─────────────────────────────────────────────────────────
  //
  // Public APIs are the only legitimate path for mutating row pin state.
  // Each call batches to one render via `scheduleRender()` and emits a single
  // `row-pin:changed` event for the entire batch.

  /**
   * Pin a single row to `position` (`"top"` or `"bottom"`). No-op + no event
   * if the row is already pinned in that position.
   */
  pinRow(
    rowId: string,
    position: RowPinPosition,
    source: RowPinChangeSource = "api",
  ): void {
    this.assertAlive();
    const change = this.state.pinRow(rowId, position);
    if (!change) return;
    this.afterRowPinChange([change], source);
  }

  /** Bulk pin many rows to the same position; emits one event for the batch. */
  pinRows(
    rowIds: string[],
    position: RowPinPosition,
    source: RowPinChangeSource = "api",
  ): void {
    this.assertAlive();
    const changes = this.state.pinRows(rowIds, position);
    if (changes.length === 0) return;
    this.afterRowPinChange(changes, source);
  }

  /** Unpin many rows; ignores ids that are not currently pinned. */
  unpinRows(rowIds: string[], source: RowPinChangeSource = "api"): void {
    this.assertAlive();
    const changes = this.state.unpinRows(rowIds);
    if (changes.length === 0) return;
    this.afterRowPinChange(changes, source);
  }

  /**
   * Replace the entire row pin state. `pinned: false` entries unpin those
   * rows; ids missing from `state` also get unpinned. Duplicate ids follow
   * last-write-wins. Ids with no matching row remain in state but do not
   * render.
   */
  setRowPinState(
    state: RowPinStateEntry[],
    source: RowPinChangeSource = "api",
  ): void {
    this.assertAlive();
    const changes = this.state.setRowPinState(state);
    if (changes.length === 0) return;
    this.afterRowPinChange(changes, source);
  }

  getRowPinState(): RowPinStateEntry[] {
    this.assertAlive();
    return this.state.getRowPinStateArray();
  }

  clearRowPinning(source: RowPinChangeSource = "api"): void {
    this.assertAlive();
    const changes = this.state.clearRowPinning();
    if (changes.length === 0) return;
    this.afterRowPinChange(changes, source);
  }

  setColumnVisible(
    field: string,
    visible: boolean,
    source: ColumnVisibilityChangeSource = "api",
  ): void {
    this.assertAlive();
    const change = this.state.setColumnVisible(field, visible);
    if (!change) return;
    this.afterVisibilityChange([change], source);
  }

  hideColumns(fields: string[], source: ColumnVisibilityChangeSource = "api"): void {
    this.assertAlive();
    const fieldSet = new Set(fields);
    const state = this.state.getColumnVisibilityState().map((s) =>
      fieldSet.has(s.field) ? { field: s.field, visible: false } : s,
    );
    const changes = this.state.setColumnVisibilityState(state);
    if (changes.length === 0) return;
    this.afterVisibilityChange(changes, source);
  }

  showColumns(fields: string[], source: ColumnVisibilityChangeSource = "api"): void {
    this.assertAlive();
    const fieldSet = new Set(fields);
    const state = this.state.getColumnVisibilityState().map((s) =>
      fieldSet.has(s.field) ? { field: s.field, visible: true } : s,
    );
    const changes = this.state.setColumnVisibilityState(state);
    if (changes.length === 0) return;
    this.afterVisibilityChange(changes, source);
  }

  setColumnVisibilityState(
    state: ColumnVisibilityState[],
    source: ColumnVisibilityChangeSource = "api",
  ): void {
    this.assertAlive();
    const changes = this.state.setColumnVisibilityState(state);
    if (changes.length === 0) return;
    this.afterVisibilityChange(changes, source);
  }

  getColumnVisibilityState(): ColumnVisibilityState[] {
    this.assertAlive();
    return this.state.getColumnVisibilityState();
  }

  showAllColumns(source: ColumnVisibilityChangeSource = "api"): void {
    this.setColumnVisibilityState([], source);
  }

  private afterVisibilityChange(
    changes: ColumnVisibilityChange[],
    source: ColumnVisibilityChangeSource,
  ): void {
    const sortChanged = this.state.refreshSortModel();
    if (sortChanged) {
      this.notifySortChanged(source === "ui" ? "ui" : "api");
    }
    const event = {
      source,
      columnVisibilityState: this.state.getColumnVisibilityState(),
      changedColumns: changes,
    };
    this.bus.emit("column-visibility:changed", event);
    this.scheduleRender();
  }

  private menuApi: ColumnMenuGridApi | null = null;

  private getMenuApi(): ColumnMenuGridApi {
    if (!this.menuApi) {
      this.menuApi = {
        setSortModel: (model, source) => this.setSortModel(model, source),
        getSortModel: () => this.getSortModel(),
        clearSort: (source) => this.clearSort(source),
        toggleColumnSort: (field, opts) => this.toggleColumnSort(field, opts),
        setColumnSort: (field, direction, source, opts) =>
          this.setColumnSort(field, direction, source, opts),
        setColumnFilterModel: (field, model, source) =>
          this.setColumnFilterModel(field, model, source),
        getColumnFilterModel: (field) => this.getColumnFilterModel(field),
        clearColumnFilter: (field, source) => this.clearColumnFilter(field, source),
        getFilterModel: () => this.getFilterModel(),
        pinColumn: (field, pinned, source) => this.pinColumn(field, pinned, source),
        unpinColumn: (field, source) => this.unpinColumn(field, source),
        setColumnPinState: (state, source) => this.setColumnPinState(state, source),
        getColumnPinState: () => this.getColumnPinState(),
        clearColumnPinning: (source) => this.clearColumnPinning(source),
        setColumnVisible: (field, visible, source) =>
          this.setColumnVisible(field, visible, source),
        hideColumns: (fields, source) => this.hideColumns(fields, source),
        showColumns: (fields, source) => this.showColumns(fields, source),
        setColumnVisibilityState: (state, source) =>
          this.setColumnVisibilityState(state, source),
        getColumnVisibilityState: () => this.getColumnVisibilityState(),
        showAllColumns: (source) => this.showAllColumns(source),
        sizeColumnsToFit: (source) => this.sizeColumnsToFit(source),
        sizeSelectedColumnsToFit: (source) => this.sizeSelectedColumnsToFit(source),
        resetColumnWidths: (source) => this.resetColumnWidths(source),
        autoSizeColumn: (field, source) => this.autoSizeColumn(field, source),
        autoSizeColumns: (fields, source) => this.autoSizeColumns(fields, source),
        autoSizeSelectedColumns: (source) => this.autoSizeSelectedColumns(source),
      };
    }
    return this.menuApi;
  }

  on<K extends keyof GridEventMap>(
    event: K,
    handler: EventHandler<GridEventMap[K]>,
  ): Unsubscribe {
    return this.bus.on(event, handler);
  }

  private rowAccess(): RowAccess {
    return {
      getRows: () => this.state.getRows(),
      resolveRowId: (row, index) => this.ctx.resolveRowId(row, index),
    };
  }

  private dispatchSelectionChange(
    change: SelectionChange,
    source: SelectionChangeSource,
  ): void {
    // Full (unpaginated) view: lazy id/row resolution in the event must
    // cover the whole selection universe, not the current page.
    const snapshot = this.state.getSnapshot();
    const payload = createSelectionChangedEvent({
      change,
      source,
      rowAccess: this.rowAccess(),
      displayRows: createDisplayRowReader(
        snapshot.fullRowView ?? snapshot.rowView,
      ),
    });

    this.bus.emit("selection:changed", payload);
  }

  private notifySortChanged(source: SortChangeSource): void {
    const event = {
      sortModel: this.state.getSortModel(),
      source,
    };
    this.bus.emit("sort:changed", event);
  }

  /** One emit per public-API call: build the event, dispatch, and schedule a render. */
  private afterRowPinChange(
    changes: RowPinChange[],
    source: RowPinChangeSource,
  ): void {
    const event: LightFastGridRowPinChangedEvent = {
      source,
      rowPinState: this.state.getRowPinStateArray(),
      changedRows: changes,
    };
    this.bus.emit("row-pin:changed", event);
    this.scheduleRender();
  }

  private createColumnPinChangedEvent(
    changes: ColumnPinChange[],
    source: ColumnPinChangeSource,
  ) {
    const first = changes[0]!;
    return {
      field: first.field,
      pinned: first.pinned,
      previousPinned: first.previousPinned,
      source,
      columnPinState: this.state.getColumnPinState(),
      changedColumns: changes,
    };
  }


  // ── Row-data transactions ───────────────────────────────────────────
  //
  // The transaction algorithm lives in `row-model/transactions` (pure,
  // id-indexed, O(n + k)). This section only orchestrates: commit rows
  // once, clean up id-based feature state, emit events, and reuse the
  // existing sort/pagination/render paths.

  /**
   * Apply an add/update/remove transaction synchronously and return
   * the normalized result. Update/remove matching requires a stable
   * `getRowId`; entries that cannot be matched are reported in
   * `result.skipped` instead of throwing.
   */
  applyTransaction(transaction: RowDataTransaction): RowDataTransactionResult {
    this.assertAlive();
    const outcome = this.state.applyStoreTransaction(
      transaction,
      this.resolveTransactionRowId,
    );
    if (outcome.changed) {
      this.afterRowDataCommit([outcome.result], "transaction");
    }
    return outcome.result;
  }

  /**
   * Update the async transaction batching delay. Normalized to
   * `Math.max(0, value ?? 50)`. A flush timer that is already queued
   * keeps its original timing; the new delay applies from the next
   * queue start.
   */
  setAsyncTransactionWaitMillis(ms?: number): void {
    this.assertAlive();
    this.asyncTransactionWaitMillis = Math.max(0, ms ?? 50);
  }

  setExecutionOptions(execution?: ExecutionOptions): void {
    this.assertAlive();
    this.execution.setExecutionOptions(execution);
    this.scheduleQuickSearchPrewarmIfEligible();
  }

  /**
   * Queue a transaction for batched application. The queue flushes as
   * one commit (one render/sort pass) after `asyncTransactionWaitMillis`
   * (default 50ms), or immediately via {@link flushAsyncTransactions}.
   */
  applyTransactionAsync(
    transaction: RowDataTransaction,
    callback?: (result: RowDataTransactionResult) => void,
  ): void {
    this.assertAlive();
    this.asyncTransactionQueue.push({ transaction, callback });
    if (this.asyncFlushTimer === null) {
      this.asyncFlushTimer = setTimeout(() => {
        this.asyncFlushTimer = null;
        if (!this.destroyed) this.flushAsyncTransactions();
      }, this.asyncTransactionWaitMillis);
    }
  }

  /**
   * Drain the async transaction queue now. Transactions apply in queue
   * order against one evolving row array, commit once, then callbacks
   * run in order followed by a single `async-transactions:flushed`
   * event carrying all results.
   */
  flushAsyncTransactions(): RowDataTransactionResult[] {
    this.assertAlive();
    if (this.asyncFlushTimer !== null) {
      clearTimeout(this.asyncFlushTimer);
      this.asyncFlushTimer = null;
    }
    if (this.asyncTransactionQueue.length === 0) return [];
    const queue = this.asyncTransactionQueue.splice(0);

    const txns = queue.map((entry) => entry.transaction);
    const batchOutcome = this.state.applyStoreTransactionBatch(
      txns,
      this.resolveTransactionRowId,
    );
    const { results } = batchOutcome;

    if (batchOutcome.changed) {
      this.afterRowDataCommit(results, "asyncTransaction");
    }

    for (let i = 0; i < queue.length; i++) {
      queue[i]!.callback?.(results[i]!);
    }
    const flushedEvent = { results };
    this.bus.emit("async-transactions:flushed", flushedEvent);
    return results;
  }

  /**
   * Replace the row array via id-based immutable diffing. `nextRows`
   * order is authoritative. Requires a stable `getRowId`; without one
   * this falls back to {@link setRows} (warned once in that case) so
   * data is never lost.
   */
  setRowsImmutable(nextRows: RowData[]): RowDataTransactionResult {
    this.assertAlive();
    if (!this.ctx.config.getRowId) {
      if (!this.hasWarnedImmutableWithoutRowId) {
        this.hasWarnedImmutableWithoutRowId = true;
        console.warn(
          "LightFastGrid: setRowsImmutable/immutableRows requires a stable " +
            "getRowId for diffing. Falling back to setRows — provide " +
            "getRowId to enable immutable row updates.",
        );
      }
      this.setRows(nextRows);
      return createEmptyTransactionResult(nextRows);
    }
    const currentRows = this.state.getRows();
    if (nextRows === currentRows) {
      return createEmptyTransactionResult(currentRows);
    }
    const result = diffImmutableRows(
      currentRows,
      nextRows,
      this.resolveTransactionRowId,
    );
    // Always commit — nextRows order is authoritative even when
    // add/update/remove counts are zero (reorder, skipped rows).
    this.state.setRows(result.rows, this.resolveTransactionRowId);
    this.afterRowDataCommit([result], "immutableRows");
    return result;
  }

  /**
   * Stable-id resolver for the transaction engine: the user `getRowId`
   * only. Identity-fallback ids are positional and unsafe for matching
   * detached transaction rows, so without `getRowId` ids are reported
   * as missing (and surfaced via `result.skipped`).
   */
  private readonly resolveTransactionRowId = (row: RowData): string | null => {
    const getRowId = this.ctx.config.getRowId;
    if (!getRowId) return null;
    const raw = getRowId(row);
    return raw === null || raw === undefined || raw === ""
      ? null
      : String(raw);
  };

  /**
   * Post-commit hook: emit events, clean up removed-row state, and
   * schedule sort/render. Called after RowStore (or setRows for immutable
   * diff) has already updated GridState. The caller is responsible for
   * gating on `outcome.changed`.
   */
  private afterRowDataCommit(
    results: RowDataTransactionResult[],
    source: RowDataUpdateSource,
  ): void {
    const event: LightFastGridRowDataUpdatedEvent = {
      source,
      addCount: 0,
      updateCount: 0,
      removeCount: 0,
      skippedCount: 0,
      rowCount: this.state.getRowCount(),
    };
    const removedIds: string[] = [];
    for (const result of results) {
      event.addCount += result.addCount;
      event.updateCount += result.updateCount;
      event.removeCount += result.removeCount;
      event.skippedCount += result.skippedCount;
      for (const row of result.removed) {
        const id = this.resolveTransactionRowId(row);
        if (id !== null) removedIds.push(id);
      }
    }

    this.cleanupRemovedRowState(removedIds);

    this.bus.emit("data:updated", { rowCount: this.state.getRowCount() });
    this.bus.emit("row-data:updated", event);

    if (this.state.needsFilterSchedule) {
      this.scheduleFilterForCurrentState();
    } else if (this.state.needsQuickSearchSchedule) {
      this.scheduleQuickSearchForCurrentState();
    } else if (this.state.needsSortSchedule) {
      this.scheduleSortForCurrentState();
    } else {
      this.scheduleRender();
    }
    this.scheduleQuickSearchPrewarmIfEligible();
  }

  /**
   * Drop removed row ids from selection and row pinning. Both paths
   * emit their own change events only when state actually changed.
   */
  private cleanupRemovedRowState(removedIds: string[]): void {
    if (removedIds.length === 0) return;
    const removedSet = new Set(removedIds);

    const selectedIds = this.getSelectedRowIds();
    const keptSelected = selectedIds.filter((id) => !removedSet.has(id));
    if (keptSelected.length !== selectedIds.length) {
      this.setSelectedRowIds(keptSelected, "api");
    }

    // unpinRows ignores ids that are not pinned and emits one event
    // only when pins actually changed.
    this.unpinRows(removedIds, "api");
  }

  // ── Focused cell ────────────────────────────────────────────────────
  //
  // Focus logic lives in `features/focus`; these are thin public
  // wrappers over the renderer's focus capability. Events flow through
  // the feature → renderer → ctx action → bus/callback path.

  /** Current focused cell, or `null` when no cell is focused. */
  getFocusedCell(): FocusedCell | null {
    this.assertAlive();
    if (!this.mounted) return null;
    return this.renderer.getFocusedCell();
  }

  /**
   * Focus a cell by `rowId` or display `rowIndex` plus column `field`.
   * No-op when the row or field cannot be resolved in the current view.
   */
  setFocusedCell(
    target: { rowId?: string; rowIndex?: number; field: string },
    source: FocusChangeSource = "api",
  ): void {
    this.assertAlive();
    if (!this.mounted) return;
    this.renderer.setFocusedCell(target, source);
  }

  clearFocusedCell(source: FocusChangeSource = "api"): void {
    this.assertAlive();
    if (!this.mounted) return;
    this.renderer.clearFocusedCell(source);
  }

  /** Move the focused cell one navigation step (clamped at boundaries). */
  moveFocusedCell(
    direction: FocusMoveDirection,
    source: FocusChangeSource = "api",
  ): void {
    this.assertAlive();
    if (!this.mounted) return;
    this.renderer.moveFocusedCell(direction, source);
  }

  // ── Cell editing (internal) ─────────────────────────────────────────

  private commitCellEdit(change: EditCommitChange): void {
    const rows = this.state.getRows();
    const original = rows[change.sourceIndex];
    if (original && original !== change.updatedRow) {
      this.rowIdentity.transferIdentity(original, change.updatedRow);
    }
    // Derived fields (e.g. quick-search projections) must be applied on
    // `updatedRow` before replaceRowAtSourceIndex computes dirty fields and
    // afterRowDataCommit schedules quick search.
    this.onBeforeCellEditCommitCallback?.({
      row: change.updatedRow,
      columnId: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue,
      sourceIndex: change.sourceIndex,
      rowId: change.rowId,
      rowIndex: change.rowIndex,
    });
    const outcome = this.state.replaceRowAtSourceIndex(
      change.sourceIndex,
      change.updatedRow,
      this.resolveTransactionRowId,
    );
    if (outcome.changed) {
      this.afterRowDataCommit([outcome.result], "cellEdit");
      const event = {
        row: change.updatedRow,
        columnId: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
      };
      this.bus.emit("cell-value:changed", event);
    }
  }

  // ── Pagination ──────────────────────────────────────────────────────

  /** Current pagination state (zero-based `pageIndex`). */
  getPaginationState(): PaginationState {
    this.assertAlive();
    return this.state.getPaginationState();
  }

  /**
   * Replace the pagination configuration. Renders only when the
   * normalized config actually changed.
   */
  setPaginationConfig(config: PaginationConfig): void {
    this.assertAlive();
    if (!this.state.setPaginationConfig(config)) return;
    this.scheduleRender();
  }

  /** Jump to a zero-based page index (clamped to the valid range). */
  setPageIndex(
    pageIndex: number,
    source: PaginationChangeSource = "api",
  ): void {
    this.assertAlive();
    if (!this.state.setPageIndex(pageIndex)) return;
    this.afterPaginationChange(source);
  }

  /** Change rows per page; the page index is clamped to stay valid. */
  setPageSize(pageSize: number, source: PaginationChangeSource = "api"): void {
    this.assertAlive();
    if (!this.state.setPageSize(pageSize)) return;
    this.afterPaginationChange(source);
  }

  nextPage(source: PaginationChangeSource = "api"): void {
    this.setPageIndex(this.getPaginationState().pageIndex + 1, source);
  }

  previousPage(source: PaginationChangeSource = "api"): void {
    this.setPageIndex(this.getPaginationState().pageIndex - 1, source);
  }

  firstPage(source: PaginationChangeSource = "api"): void {
    this.setPageIndex(0, source);
  }

  lastPage(source: PaginationChangeSource = "api"): void {
    this.setPageIndex(this.getPaginationState().pageCount - 1, source);
  }

  private afterPaginationChange(source: PaginationChangeSource): void {
    this.scheduleRender();
    const state = this.state.getPaginationState();
    const event: LightFastGridPaginationChangedEvent = {
      pageIndex: state.pageIndex,
      pageSize: state.pageSize,
      pageCount: state.pageCount,
      totalRows: state.totalRows,
      startRow: state.startRow,
      endRow: state.endRow,
      source,
    };
    this.bus.emit("pagination:changed", event);
  }

  private scheduleRender(): void {
    if (!this.mounted || this.destroyed) return;
    this.scheduler.schedule(() => {
      if (!this.mounted || this.destroyed) return;
      const baseSnapshot = this.state.getSnapshot();
      const changedFields = this.state.consumeRenderChangeSetForRender();
      const cellChangeFlash = this.state.consumeCellChangeFlashForRender();
      const renderSnapshot: GridRenderSnapshot =
        changedFields || cellChangeFlash
          ? {
              ...baseSnapshot,
              ...(changedFields
                ? { renderChangeSet: { changedFieldsByRowId: changedFields } }
                : {}),
              ...(cellChangeFlash
                ? { cellChangeFlash: { changedFieldsByRowId: cellChangeFlash } }
                : {}),
            }
          : baseSnapshot;
      this.renderer.render(renderSnapshot);
    });
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('Grid has been destroyed');
  }
}
