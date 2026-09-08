import type { GridEventMap } from "../events/GridEventMap";
import type { Grid } from "../Grid";
import type {
  LogicalColumnLayoutInput,
  LogicalColumnLayoutReadSnapshot,
} from "../internal/columnLayoutReadSnapshot";
import type {
  ImmutableIdMembership,
  RowSelectionReadSnapshot,
} from "../internal/readSnapshots";
import type { DisplayRowReader } from "../rendering/rowViewAccess";
import type { GridReadSnapshot } from "../state/GridReadSnapshot";
import type {
  CellMenuGridApi,
  CellMenuOptions,
  CellRendererRegistry,
  CellShellOverlayRenderer,
  ColumnDef,
  ColumnMenuGridApi,
  ColumnMenuOptions,
  ColumnOrderConfig,
  ColumnPinChangeSource,
  ColumnPinState,
  ColumnSelectionConfig,
  ColumnSizeToFitSource,
  ExecutionThresholds,
  FloatingFiltersOptions,
  HeaderActionGridApi,
  HeaderActionRendererRegistry,
  LightFastGridCellShellActionEvent,
  LightFastGridColumnOrderChangedEvent,
  LightFastGridColumnSelectionChangedEvent,
  LightFastGridFocusedCellChangedEvent,
  LightFastGridOverlayPresentationChangedEvent,
  LightFastGridRowOrderChangedEvent,
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
} from "../types";

import { cellMenuFeature } from "./cell-menu/cellMenuFeature";
import { cellShellActionFeature } from "./cell-shells/cellShellActionFeature";
import { cellShellOverlayFeature } from "./cell-shells/cellShellOverlayFeature";
import { columnGroupHeaderFeature } from "./column-groups/columnGroupHeaderFeature";
import type { ColumnMenuContributionRegistry } from "./column-menu/columnMenuContributionRegistry";
import { createColumnMenuContributionRegistry } from "./column-menu/columnMenuContributionRegistry";
import { columnMenuFeature } from "./column-menu/columnMenuFeature";
import { columnOrderFeature } from "./column-order/columnOrderFeature";
import { columnSelectionFeature } from "./column-selection/columnSelectionFeature";
import { csvExportFeature } from "./csv-export/csvExportFeature";
import type { CsvExportDefaults } from "./csv-export/csvExportTypes";
import { editingFeature } from "./editing/editingFeature";
import type { EditCommitChange } from "./editing/editingTypes";
import { filterColumnMenuFeature } from "./filters/filterColumnMenuFeature";
import { resolveFilterPreviewCellValue } from "./filters/filterDisplayValueAccess";
import { floatingFilterFeature } from "./floating-filters/FloatingFilterController";
import { focusFeature } from "./focus/focusFeature";
import { headerActionFeature } from "./header-actions/headerActionFeature";
import { inputFeature } from "./input/inputFeature";
import { overlayFeature } from "./overlays/overlayFeature";
import { resizeFeature } from "./resize/resizeFeature";
import { rowActionFeature } from "./row-actions/rowActionFeature";
import { rowControlsFeature } from "./row-controls/rowControlsFeature";
import { rowOrderFeature } from "./row-order/rowOrderFeature";
import { selectionFeature } from "./selection/selectionFeature";
import { sortFeature } from "./sort/sortFeature";
import { tooltipFeature } from "./tooltips/tooltipFeature";
import {
  accessibilityFeature,
  createAccessibilityGridReadSeam,
} from "./accessibility";
import { createCellShellPreview } from "./cell-shells";
import type { OverlayState } from "./overlays";
import type { DomGridFeature } from "./types";

/** Internal, feature-neutral contract for non-DOM Grid capabilities. */
export interface HeadlessGridFeature {
  readonly name: string;
  destroy(): void;
}

/** Generic dependencies available to built-in headless features. */
export interface HeadlessGridFeatureFactoryContext {
  captureReadSnapshot(): GridReadSnapshot;
  captureLogicalColumnLayoutSnapshot(
    input: LogicalColumnLayoutInput,
  ): LogicalColumnLayoutReadSnapshot;
  captureRowSelectionSnapshot(
    universeRowCount: number,
  ): RowSelectionReadSnapshot;
  captureColumnSelectionSnapshot(): ImmutableIdMembership<string>;
  resolveRowId(row: RowData, sourceIndex: number): string;
  getCsvExportConfig(): boolean | CsvExportDefaults | undefined;
  getExecutionThreshold(name: keyof ExecutionThresholds): number;
  emit<K extends keyof GridEventMap>(event: K, payload: GridEventMap[K]): void;
}

export interface HeadlessGridFeatureFactory {
  readonly name: string;
  create(ctx: HeadlessGridFeatureFactoryContext): HeadlessGridFeature;
}

/**
 * Context passed to built-in DOM feature factories from {@link DomFeatureHost}.
 */
export interface DomGridFeatureFactoryContext {
  getColumns(): ColumnDef[];
  getColumnOrderConfig(): ColumnOrderConfig;
  getRowSelectionConfig(): RowSelectionConfig;
  getColumnSelectionConfig(): ColumnSelectionConfig;
  getRowDragConfig(): RowDragNormalizedConfig;
  onSelectionChanged?: (
    change: SelectionChange,
    source: SelectionChangeSource,
  ) => void;
  onColumnSelectionChanged?: (
    e: LightFastGridColumnSelectionChangedEvent,
  ) => void;
  onColumnOrderChanged?: (e: LightFastGridColumnOrderChangedEvent) => void;
  onRowOrderChanged?: (e: LightFastGridRowOrderChangedEvent) => void;
  onFocusedCellChanged?: (e: LightFastGridFocusedCellChangedEvent) => void;
  onCellShellAction?: (e: LightFastGridCellShellActionEvent) => void;
  getCellShellOverlays?: () => Record<string, CellShellOverlayRenderer> | undefined;
  /** Display-row reader backed by RowView — preferred for display-index lookups. */
  getDisplayRows(): DisplayRowReader;
  /** Original user-supplied rows in source (insertion) order. */
  getSourceRows(): RowData[];
  resolveRowId(row: RowData, index: number): string;
  commitResize(field: string, width: number): void;
  commitRowOrder?: (
    rowId: string,
    rowIds: string[],
    insertionIndex: number,
    source: RowOrderChangeSource,
  ) => LightFastGridRowOrderChangedEvent | null;
  /**
   * Returns true when managed row reorder should be blocked (sort/filter active).
   * Always false until sort/filter state lands in core.
   */
  isRowReorderBlocked?: () => boolean;
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
  getRowActionGridApi?: () => RowActionGridApi;
  getHeaderRenderers?: () => HeaderActionRendererRegistry | undefined;
  getSelectedColumnIds?: () => string[];
  getHeaderActionGridApi?: () => HeaderActionGridApi;
  getFocusedCell?: () => { rowIndex: number; field: string } | null;
  setFocusedCell?: (target: { rowIndex: number; field: string }, source: string) => void;
  commitCellEdit?: (change: EditCommitChange) => void;
  columnMenuContributions?: ColumnMenuContributionRegistry;
  onColumnMenuChanged?: (openField: string | null) => void;
  onOverlayPresentationChanged?: (
    event: LightFastGridOverlayPresentationChangedEvent,
  ) => void;
}

export interface DomGridFeatureFactory {
  readonly name: string;
  create(ctx: DomGridFeatureFactoryContext): DomGridFeature | null;
}

/** Ordered built-in features that own no DOM lifecycle. */
export const BUILT_IN_HEADLESS_FEATURE_FACTORIES: readonly HeadlessGridFeatureFactory[] = [
  {
    name: "csv-export",
    create: csvExportFeature,
  },
];

/**
 * Ordered built-in features for the DOM core bundle.
 *
 * This centralizes feature wiring so disabling an internal feature is localized
 * to this list. True package-level tree shaking will come later through separate
 * entrypoints / external feature arrays.
 */
export const BUILT_IN_FEATURE_FACTORIES: readonly DomGridFeatureFactory[] = [
  {
    name: "column-order",
    create(ctx) {
      return columnOrderFeature({
        getColumnOrderConfig: ctx.getColumnOrderConfig,
        onColumnOrderChanged: ctx.onColumnOrderChanged,
      });
    },
  },
  {
    name: "row-controls",
    create(ctx) {
      return rowControlsFeature({
        getRowSelectionConfig: ctx.getRowSelectionConfig,
        getRowDragConfig: ctx.getRowDragConfig,
      });
    },
  },
  // Cell-shell floating popovers + action features registered before
  // selection so their stopImmediatePropagation preempts the selection
  // listener. Popover is registered first so it sees the click before
  // the action controller calls stopImmediatePropagation. When a shell
  // has both overlay and actionKey: popover opens, then action fires.
  // (Unrelated to full-grid state overlays registered later as "overlays".)
  {
    name: "cell-shell-overlays",
    create(ctx) {
      return cellShellOverlayFeature({
        getColumns: ctx.getColumns,
        getDisplayRows: ctx.getDisplayRows,
        resolveRowId: ctx.resolveRowId,
        getCellShellOverlays: ctx.getCellShellOverlays ?? (() => undefined),
      });
    },
  },
  {
    name: "cell-shell-actions",
    create(ctx) {
      return cellShellActionFeature({
        getColumns: ctx.getColumns,
        getDisplayRows: ctx.getDisplayRows,
        resolveRowId: ctx.resolveRowId,
        onCellShellAction: ctx.onCellShellAction,
      });
    },
  },
  {
    name: "editing",
    create(ctx) {
      return editingFeature({
        getFocusedCell: ctx.getFocusedCell ?? (() => null),
        setFocusedCell: ctx.setFocusedCell ?? (() => {}),
        commitCellEdit: ctx.commitCellEdit ?? (() => {}),
      });
    },
  },
  {
    name: "selection",
    create(ctx) {
      return selectionFeature({
        getConfig: ctx.getRowSelectionConfig,
        onSelectionChanged: ctx.onSelectionChanged,
      });
    },
  },
  {
    name: "resize",
    create(ctx) {
      return resizeFeature({
        commitResize: ctx.commitResize,
      });
    },
  },
  {
    name: "column-selection",
    create(ctx) {
      return columnSelectionFeature({
        getColumnSelectionConfig: ctx.getColumnSelectionConfig,
        onColumnSelectionChanged: ctx.onColumnSelectionChanged,
      });
    },
  },
  // Pointer focus ownership; keyboard policy is owned by accessibility below.
  {
    name: "input",
    create() {
      return inputFeature();
    },
  },
  // Focused cell + keyboard navigation. Independent from selection —
  // shares only the root's delegated listeners.
  {
    name: "focus",
    create(ctx) {
      return focusFeature({
        onFocusedCellChanged: ctx.onFocusedCellChanged,
      });
    },
  },
  // Sole import seam for the private accessibility runtime. Public option
  // storage, neutral events, and atomic legacy-writer transfers are governed by
  // the separate architecture guards.
  {
    name: "accessibility",
    create(ctx) {
      const read = createAccessibilityGridReadSeam({
        getRowSelectionConfig: ctx.getRowSelectionConfig,
        getGridInstance: ctx.getGridInstance,
      });
      return accessibilityFeature({
        read,
        getGrid: () => ctx.getGridInstance?.() ?? null,
      });
    },
  },
  {
    name: "sort",
    create(ctx) {
      return sortFeature({
        getColumns: ctx.getColumns,
        getColumnSelectionConfig: ctx.getColumnSelectionConfig,
        getSortModel: ctx.getSortModel,
        isSortPending: ctx.isSortPending,
        toggleColumnSort: ctx.toggleColumnSort,
      });
    },
  },
  {
    name: "filter-column-menu",
    create(ctx) {
      if (!ctx.getMenuApi) return null;
      const menuApi = ctx.getMenuApi;
      return filterColumnMenuFeature({
        getColumns: ctx.getColumns,
        getColumnFilterModel: (field) => menuApi().getColumnFilterModel(field),
        setColumnFilterModel: (field, model, source) => menuApi().setColumnFilterModel(field, model, source),
        clearColumnFilter: (field, source) => menuApi().clearColumnFilter(field, source),
        getFilterConfig: ctx.getGridInstance
          ? (field) => ctx.getGridInstance!()?.getColumnFilterConfig(field) ?? null
          : undefined,
        getFilterModel: () => menuApi().getFilterModel(),
        getColumnMenuOptions: ctx.getColumnMenuOptions,
        getRows: ctx.getSourceRows,
        renderSelectionValuePreview: (previewCtx) => {
          if (previewCtx.column.cellShell === undefined || previewCtx.sampleRow === undefined) return null;
          const { column, sampleRow, sampleRowIndex } = previewCtx;
          return createCellShellPreview({
            column,
            field: previewCtx.field,
            value: resolveFilterPreviewCellValue(
              sampleRow,
              sampleRowIndex,
              column,
              previewCtx.value,
            ),
            formattedValue: previewCtx.label,
            row: sampleRow,
            rowIndex: sampleRowIndex,
          });
        },
        columnMenuContributions: ctx.columnMenuContributions,
      });
    },
  },
  {
    name: "floating-filters",
    create(ctx) {
      if (!ctx.getMenuApi || !ctx.getFloatingFiltersOption) return null;
      const menuApi = ctx.getMenuApi;
      return floatingFilterFeature({
        getColumns: ctx.getColumns,
        getFloatingFiltersOption: ctx.getFloatingFiltersOption,
        getColumnFilterModel: (field) => menuApi().getColumnFilterModel(field),
        setColumnFilterModel: (field, model, source) =>
          menuApi().setColumnFilterModel(field, model, source),
        clearColumnFilter: (field, source) =>
          menuApi().clearColumnFilter(field, source),
        getFilterConfig: ctx.getGridInstance
          ? (field) => ctx.getGridInstance!()?.getColumnFilterConfig(field) ?? null
          : () => null,
      });
    },
  },
  {
    // Display-only group header rows above leaf headers (all lanes).
    // Height via HeaderAddonCapability; geometry via syncHeaderAddon.
    name: "column-group-headers",
    create() {
      return columnGroupHeaderFeature();
    },
  },
  {
    name: "column-menu",
    create(ctx) {
      return columnMenuFeature({
        getColumns: ctx.getColumns,
        getSortModel: ctx.getSortModel,
        setColumnSort: ctx.setColumnSort,
        pinColumn: (field, pinned) => ctx.pinColumn(field, pinned, "ui"),
        setColumnPinState: ctx.setColumnPinState
          ? (state) => ctx.setColumnPinState!(state, "ui")
          : undefined,
        hideColumns: ctx.hideColumns
          ? (fields) => ctx.hideColumns!(fields, "ui")
          : undefined,
        sizeColumnsToFit: ctx.sizeColumnsToFit,
        sizeSelectedColumnsToFit: ctx.sizeSelectedColumnsToFit,
        resetColumnWidths: ctx.resetColumnWidths,
        autoSizeColumn: ctx.autoSizeColumn,
        autoSizeSelectedColumns: ctx.autoSizeSelectedColumns,
        getMenuApi: ctx.getMenuApi,
        getColumnMenuOptions: ctx.getColumnMenuOptions,
        columnMenuContributions: ctx.columnMenuContributions,
        onOpenFieldChange: ctx.onColumnMenuChanged,
      });
    },
  },
  {
    name: "header-actions",
    create(ctx) {
      return headerActionFeature({
        getColumns: ctx.getColumns,
        getHeaderRenderers: ctx.getHeaderRenderers ?? (() => undefined),
        getSelectedColumnIds: ctx.getSelectedColumnIds ?? (() => []),
        getHeaderActionGridApi:
          ctx.getHeaderActionGridApi ??
          (() => ({
            getColumns: ctx.getColumns,
            getSelectedColumnIds: ctx.getSelectedColumnIds ?? (() => []),
          })),
      });
    },
  },
  {
    name: "row-actions",
    create(ctx) {
      return rowActionFeature({
        getColumns: ctx.getColumns,
        getDisplayRows: ctx.getDisplayRows,
        resolveRowId: ctx.resolveRowId,
        getCellRenderers: ctx.getCellRenderers ?? (() => undefined),
        getRowActionGridApi: ctx.getRowActionGridApi ?? (() => ({ getRows: ctx.getSourceRows })),
      });
    },
  },
  {
    name: "cell-menu",
    create(ctx) {
      return cellMenuFeature({
        getColumns: ctx.getColumns,
        getDisplayRows: ctx.getDisplayRows,
        resolveRowId: ctx.resolveRowId,
        getCellMenuOptions: ctx.getCellMenuOptions ?? (() => undefined),
        getCellMenuGridApi:
          ctx.getCellMenuGridApi ??
          (() => ({ getRows: () => ctx.getSourceRows().slice() })),
      });
    },
  },
  {
    name: "tooltip",
    create(ctx) {
      return tooltipFeature({
        getColumns: ctx.getColumns,
        getDisplayRows: ctx.getDisplayRows,
        resolveRowId: ctx.resolveRowId,
        getGridInstance: () => ctx.getGridInstance?.() ?? null,
      });
    },
  },
  {
    // Full-grid state overlays (loading, noRows) — not anchored floating popovers.
    name: "overlays",
    create(ctx) {
      return overlayFeature({
        getOverlayState:
          ctx.getOverlayState ??
          (() => ({ loading: false, manualOverlay: null, overlays: undefined })),
        getDisplayRowCount: () => ctx.getDisplayRows().rowCount,
        getGridInstance: () => ctx.getGridInstance?.() ?? null,
        onPresentationChanged: ctx.onOverlayPresentationChanged,
      });
    },
  },
  {
    name: "row-order",
    create(ctx) {
      return rowOrderFeature({
        getRowDragConfig: ctx.getRowDragConfig,
        getRows: ctx.getSourceRows,
        resolveRowId: ctx.resolveRowId,
        isReorderBlocked: ctx.isRowReorderBlocked,
        commitRowOrder: ctx.commitRowOrder,
        onRowOrderChanged: ctx.onRowOrderChanged,
      });
    },
  },
];

export function createBuiltInFeatures(
  ctx: DomGridFeatureFactoryContext,
): DomGridFeature[] {
  const columnMenuContributions = createColumnMenuContributionRegistry();
  const extendedCtx = { ...ctx, columnMenuContributions };

  return BUILT_IN_FEATURE_FACTORIES
    .map((f) => f.create(extendedCtx))
    .filter((f): f is DomGridFeature => f !== null);
}

export function createBuiltInHeadlessFeatures(
  ctx: HeadlessGridFeatureFactoryContext,
): HeadlessGridFeature[] {
  return BUILT_IN_HEADLESS_FEATURE_FACTORIES.map((factory) =>
    factory.create(ctx),
  );
}
