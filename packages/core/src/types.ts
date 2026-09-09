import type {
  CellClassRules,
  GetCellClass,
} from './features/cell-styling';
import type {
  CsvExportCapability,
  CsvExportDefaults,
  CsvExportEventCallbacks,
  CsvExportGridOptions,
} from './features/csv-export/csvExportTypes';
import type { FloatingPlacement } from './features/floating/types';
import type {
  GetRowClass,
  RowClassRules,
} from './features/row-styling';
import type { TooltipValueGetter } from './features/tooltips';
import type { GridLayoutMetrics } from './layout/gridLayoutMetrics';
import type { RowView } from './row-model/rowOrder';
import type { GridThemeInput, GridThemeOptions, ResolvedGridTheme } from './themes/types';
import type { Grid } from './Grid';

export type { FloatingPlacement };

/**
 * Public types for `@lightfastgrid/core`.
 *
 * Structural, framework-agnostic contract consumed by adapters
 * (`@lightfastgrid/adapter-react`, future Vue/Angular/vanilla wrappers)
 * and by internal modules (state, renderer, scheduler, events).
 */

export type RowData = Record<string, unknown>;

export type Unsubscribe = () => void;

export type CellEditorKind = "text" | "number" | "date" | "checkbox" | "boolean" | "select";

export type SelectOptionValue = string | number | boolean | null;

/**
 * How a boolean cell is activated.
 *
 * - `"toggle"` — a click on the rendered checkbox control commits directly, and
 *   plain Space does the same. Requires `cellShell: "checkbox"`.
 * - `"edit"` — a single click only focuses; double-click, Enter, or F2 opens the
 *   pooled checkbox editor.
 * - `"auto"` (default) — `"toggle"` when the column uses the built-in checkbox
 *   presentation, otherwise `"edit"`.
 *
 * `"toggle"` without the built-in checkbox presentation fails safe to `"edit"`,
 * so no mutation path exists without a visible control.
 */
export type CheckboxActivation = "auto" | "toggle" | "edit";

/** Options shared by every editor kind. */
export interface BaseCellEditorConfig {
  maxLength?: number;
  placeholder?: string;
  /** Marks the edit-mode value as required and exposes `aria-required`. */
  required?: boolean;
}

export interface TextCellEditorConfig extends BaseCellEditorConfig {
  type: "text";
}

export interface NumberCellEditorConfig extends BaseCellEditorConfig {
  type: "number";
}

export interface DateCellEditorConfig extends BaseCellEditorConfig {
  type: "date";
}

export interface SelectCellEditorConfig extends BaseCellEditorConfig {
  type: "select";
  options?: ReadonlyArray<string | { value: SelectOptionValue; label: string }>;
}

export interface CheckboxCellEditorConfig extends BaseCellEditorConfig {
  /** `"boolean"` is an accepted alias for `"checkbox"`. */
  type: "checkbox" | "boolean";
  /** Interaction mode. Defaults to `"auto"`. */
  activation?: CheckboxActivation;
}

/**
 * Discriminated by `type`, so kind-specific options cannot appear on unrelated
 * editors (e.g. `activation` is a compile error on a `text` editor).
 */
export type CellEditorConfig =
  | TextCellEditorConfig
  | NumberCellEditorConfig
  | DateCellEditorConfig
  | SelectCellEditorConfig
  | CheckboxCellEditorConfig;

export interface CellEditEligibilityContext {
  row: RowData;
  rowIndex: number;
  column: ColumnDef;
  field: string;
  value: unknown;
}

/** @deprecated Use `CellEditorKind` instead. */
export type CellEditorType = "text" | "number" | "date" | "boolean" | "select" | "checkbox";

/** @deprecated Use `CellEditorConfig` instead. */
export interface CellEditor {
  type: CellEditorType;
  options?: ReadonlyArray<string | { value: SelectOptionValue; label: string }>;
  maxLength?: number;
  placeholder?: string;
  /** @deprecated Use `CellEditorConfig.required`. */
  required?: boolean;
}

/** Modifiers for imperative `GridActions.selectRow` (reserved; not wired in core yet). */
export type RowSelectionModifier = "replace" | "toggle" | "range";

export interface SelectionConfig {
  mode: RowSelectionMode;
  /** Render a checkbox column when true (multi). */
  checkboxColumn?: boolean;
  /** Column id used as stable row identity. Falls back to schema primaryKey. */
  rowKey?: string;
}

/**
 * Pagination configuration (prop-driven shape). Omitted `pageSize`
 * means the default (100); `pageSizeOptions` always end up including
 * the effective page size.
 */
export interface PaginationConfig {
  enabled: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
}

export type PaginationChangeSource = "api" | "ui";

// ── Focused cell ──────────────────────────────────────────────────────

/**
 * The currently focused cell. Identity is `rowId` + `field`; the
 * indexes are the cell's current position and are refreshed when the
 * row model changes (sort/pagination/transactions).
 */
export interface FocusedCell {
  rowId: string;
  field: string;
  /** Current display (view) index of the row. */
  rowIndex: number;
  /** Raw/source index of the row in the source rows array. */
  sourceIndex: number;
}

export type FocusChangeSource = "click" | "keyboard" | "api";

/** Directions accepted by {@link Grid.moveFocusedCell}. */
export type FocusMoveDirection =
  | "up"
  | "down"
  | "left"
  | "right"
  | "home"
  | "end"
  | "pageUp"
  | "pageDown";

export interface LightFastGridFocusedCellChangedEvent {
  focusedCell: FocusedCell | null;
  previousCell: FocusedCell | null;
  source: FocusChangeSource;
}

// ── Row-data transactions ─────────────────────────────────────────────

export type {
  RowDataTransaction,
  RowDataTransactionEntry,
  RowDataTransactionResult,
  RowDataTransactionSkipped,
  RowDataTransactionSkipReason,
} from "./row-model/transactions/types";

import type {
  RowDataTransaction as RowDataTransactionType,
  RowDataTransactionResult as RowDataTransactionResultType,
} from "./row-model/transactions/types";

/** Which API path produced a row-data update. */
export type RowDataUpdateSource =
  | "transaction"
  | "asyncTransaction"
  | "immutableRows"
  | "cellEdit";

export interface LightFastGridRowDataUpdatedEvent {
  source: RowDataUpdateSource;
  addCount: number;
  updateCount: number;
  removeCount: number;
  skippedCount: number;
  /** Total rows after the update. */
  rowCount: number;
}

export interface LightFastGridAsyncTransactionsFlushedEvent {
  /** One result per queued transaction, in application order. */
  results: RowDataTransactionResultType[];
}

/** Current client-side pagination state. `pageIndex` is zero-based. */
export interface PaginationState {
  enabled: boolean;
  /** Zero-based current page index (clamped to the valid range). */
  pageIndex: number;
  pageSize: number;
  /** Number of pages. 0 when there are no rows. */
  pageCount: number;
  /** Total rows feeding the pager (after sort; raw count today). */
  totalRows: number;
  /** One-based first visible row for UI display; 0 when no rows. */
  startRow: number;
  /** One-based last visible row for UI display; 0 when no rows. */
  endRow: number;
}

/** Pagination data carried on `GridSnapshot` for the footer UI. */
export interface GridPaginationSnapshot extends PaginationState {
  /** Ascending page-size choices for the rows-per-page select. */
  pageSizeOptions: number[];
}

export interface LightFastGridPaginationChangedEvent {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  totalRows: number;
  startRow: number;
  endRow: number;
  source: PaginationChangeSource;
}

// ── Column filter types ───────────────────────────────────────────────

export type ColumnFilterType = "text" | "number" | "date" | "boolean";

export type FilterJoinOperator = "and" | "or";

export type TextFilterOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "startsWith"
  | "endsWith"
  | "isEmpty"
  | "isNotEmpty"
  | "in"
  | "notIn";

export type NumberFilterOperator =
  | "equals"
  | "notEquals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "isNull"
  | "isNotNull"
  | "in"
  | "notIn";

export type DateFilterOperator =
  | "equals"
  | "notEquals"
  | "before"
  | "after"
  | "between"
  | "isNull"
  | "isNotNull"
  | "in"
  | "notIn";

export type BooleanFilterOperator =
  | "equals"
  | "notEquals"
  | "isNull"
  | "isNotNull"
  | "in"
  | "notIn";

export type ColumnFilterOperator =
  | TextFilterOperator
  | NumberFilterOperator
  | DateFilterOperator
  | BooleanFilterOperator;

export interface ColumnFilterCondition {
  operator: ColumnFilterOperator;
  value?: string | number | boolean | null | readonly (string | number | boolean)[];
  valueTo?: string | number | null;
}

export interface ColumnFilterSelection {
  operator: "in" | "notIn";
  values: readonly (string | number | boolean)[];
}

export interface ColumnFilterModel {
  type: ColumnFilterType;
  operator?: FilterJoinOperator;
  conditions: ColumnFilterCondition[];
  selection?: ColumnFilterSelection;
}

export type FilterModel = Record<string, ColumnFilterModel>;

export type FilterChangeSource = "api" | "ui";

export interface ColumnFilterConfig {
  type?: ColumnFilterType;
  defaultOperator?: ColumnFilterOperator;
  caseSensitive?: boolean;
  trimInput?: boolean;
}

export interface NormalizedColumnFilterConfig {
  type: ColumnFilterType;
  defaultOperator: ColumnFilterOperator;
  caseSensitive: boolean;
  trimInput: boolean;
}

export type ColumnFilterInput =
  | boolean
  | ColumnFilterType
  | ColumnFilterConfig;

/** @deprecated Use `ColumnFilterOperator` instead. */
export type FilterOperator = ColumnFilterOperator;

// ── Quick filter / quick search ────────────────────────────────────

export interface GetQuickFilterTextParams {
  value: unknown;
  row: RowData;
  column: ColumnDef;
}

export type QuickFilterCacheMode = boolean | "auto";

export interface QuickFilterOptions {
  enabled?: boolean;
  includeHiddenColumns?: boolean;
  /**
   * Controls worker-side quick-search query caches.
   *
   * - `"auto"` / `true` / `undefined`: use the default bounded result,
   *   full-match, lazy-narrowing, and trigram-index caches.
   * - `false`: hard-disable reusable worker query caches for this request.
   */
  cache?: QuickFilterCacheMode;
  /**
   * Controls background worker snapshot prewarm after mount/config changes.
   *
   * - `"auto"` / `undefined`: prewarm only for worker-eligible datasets at or
   *   above the quick-search execution threshold (default, backward-compatible).
   * - `true`: prewarm whenever quick filter is enabled and worker-eligible,
   *   regardless of row count.
   * - `false`: never prewarm; pending prewarm is cancelled. Search still works
   *   on demand when the user types.
   */
  prewarm?: boolean | "auto";
  parser?: QuickFilterParser;
  matcher?: QuickFilterMatcher;
}

export type QuickFilterParser = (text: string) => string[];

export type QuickFilterMatcher = (params: QuickFilterMatcherParams) => boolean;

export interface QuickFilterMatcherParams {
  rowText: string;
  queryParts: string[];
}

export type QuickFilterChangeSource = "api";

export interface LightFastGridQuickFilterChangedEvent {
  quickFilterText: string;
  source: QuickFilterChangeSource;
}

export interface LightFastGridQuickSearchPendingChangedEvent {
  pending: boolean;
}

// ── Floating filters ────────────────────────────────────────────────

export type FloatingFilterControl =
  | "auto"
  | "text"
  | "numberRange"
  | "dateRange"
  | "dateButton"
  | "booleanSelect"
  | "select"
  | "none";

export type FloatingFilterSelectOption =
  | string
  | { value: string | number | boolean; label: string };

export interface FloatingFiltersOptions {
  enabled?: boolean;
  debounceMs?: number;
  menuButton?: boolean;
}

export interface FloatingFilterColumnOptions {
  enabled?: boolean;
  disabled?: boolean;
  debounceMs?: number;
  menuButton?: boolean;
  placeholder?: string;
  control?: FloatingFilterControl;
  options?: ReadonlyArray<FloatingFilterSelectOption>;
}

export type GridTheme = "light" | "dark";

export type {
  GridThemeBase,
  GridThemeDensity,
  GridThemeInput,
  GridThemeOptions,
  GridThemeRadius,
  ResolvedGridTheme,
} from "./themes/types";

/** Shared params for value pipeline (`valueGetter` / `valueFormatter`). */
export interface CellValueParams {
  row: RowData;
  rowIndex: number;
  field: string;
  column: ColumnDef;
}

/** Params for body-cell accessible names and description associations. */
export interface CellAccessibilityParams extends CellValueParams {
  rowId: string;
  sourceIndex: number;
  /** Already-resolved value-pipeline display string. */
  formattedValue: string;
}

/** Params for `valueGetter` (raw value before `valueFormatter`). */
export type ValueGetterParams = CellValueParams;

export interface ValueFormatterParams extends CellValueParams {
  value: unknown;
}

export type SortDirection = "asc" | "desc";

export interface SortModelItem {
  field: string;
  sort: SortDirection;
}

export type SortModel = SortModelItem[];

export type SortChangeSource = "api" | "ui";

export type HeaderControlKind = "headerActions" | "columnMenu" | "columnFilter";

export interface HeaderControlsConfig {
  order?: HeaderControlKind[];
}

// ── Cell shells ──────────────────────────────────────────────────────

export type CellShellKind =
  | "text"
  | "badge"
  | "checkbox"
  | "image"
  | "imageText"
  | "avatar"
  | "avatarText"
  | "iconText"
  | "prefixSuffix"
  | "button"
  | "iconButton"
  | "buttonGroup"
  | "link"
  | "progress"
  | "rating"
  | "inline";

export type CellOverlayTrigger = "click" | "hover";

/** A directly-readable shell value source. Never nests another source. */
export type CellShellBaseValueSource =
  | "value"
  | "formattedValue"
  | { field: string }
  | { literal: string };

/**
 * Derive a presentation string from a base value through an exact,
 * string-keyed map — for example a boolean to a pair of image URLs.
 *
 * Use this instead of overloading `valueFormatter` with asset strings:
 * `valueFormatter` output is human-readable text consumed by display, export,
 * search, tooltips, and accessible names.
 *
 * Semantics: `from` defaults to `"value"`. A `null`/`undefined` base value
 * bypasses `map` entirely and uses `fallback` (or `""`). Otherwise the key is
 * `String(baseValue)` and only own string-valued properties match; anything
 * else falls back. Malformed input fails safe and silently.
 */
export interface CellShellMappedValueSource {
  /** Non-recursive: a mapped source may not nest inside `from`. */
  from?: CellShellBaseValueSource;
  map: Record<string, string>;
  fallback?: string;
}

export type CellShellValueSource =
  | CellShellBaseValueSource
  | CellShellMappedValueSource;

export interface CellShellOverlayConfig {
  key: string;
  trigger?: CellOverlayTrigger;
  placement?: FloatingPlacement;
  matchAnchorWidth?: boolean;
  closeOnScroll?: boolean;
  hoverOpenDelayMs?: number;
  hoverCloseDelayMs?: number;
}

export interface CellShellConfig {
  kind: CellShellKind;
  text?: CellShellValueSource;
  checkbox?: {
    /** Visible label beside the checkbox. Omitted means no label element. */
    label?: CellShellValueSource;
    /** Accessible-name override for the native checkbox control. */
    ariaLabel?: CellShellValueSource;
  };
  image?: {
    src: CellShellValueSource;
    alt?: CellShellValueSource;
  };
  icon?: string;
  prefix?: string;
  suffix?: string;
  tone?: {
    /**
     * Non-recursive by design: a mapped source may not nest here. Unlike a
     * generic mapped source (which defaults to `"value"`), tone's effective
     * default base is `"formattedValue"`.
     */
    from?: CellShellBaseValueSource;
    map?: Record<string, string>;
    fallback?: string;
  };
  dot?: boolean;
  parts?: CellShellConfig[];
  overlay?: CellShellOverlayConfig;
  actionKey?: string;
  className?: string;
}

export interface CellShellOverlayRenderContext {
  host: HTMLElement;
  overlayKey: string;
  rowId: string;
  rowIndex: number;
  field: string;
  column: ColumnDef;
  row: RowData;
  value: unknown;
  formattedValue: string;
  anchor: HTMLElement;
  originalEvent: MouseEvent | PointerEvent;
  close: () => void;
}

export interface CellShellOverlayRenderer {
  kind: "cell-shell-overlay";
  render(ctx: CellShellOverlayRenderContext): void | (() => void);
}

/**
 * Emitted when a user clicks a cell-shell action element (a button /
 * iconButton / link shell configured with `actionKey`). Delivered through a
 * single grid-level delegated handler — no per-cell listeners.
 */
export interface LightFastGridCellShellActionEvent {
  /** The `actionKey` configured on the shell (mirrored as `data-action`). */
  actionKey: string;
  rowId: string;
  rowIndex: number;
  /** Column field id (the clicked cell's `data-col-id`). */
  field: string;
  column: ColumnDef;
  row: RowData;
  value: unknown;
  formattedValue: string;
  originalEvent: MouseEvent;
}

export interface ColumnDef {
  field: string;
  headerName?: string;
  /** Lightweight header action buttons that can open custom dropdown content. */
  headerActions?: HeaderActionDef[];
  /** Controls ordering for built-in header menu and custom header action buttons. */
  headerControls?: HeaderControlsConfig;
  width?: number;
  flex?: number;
  /** When false, the column is omitted from the table (merged). `true` or omitted: visible. */
  visible?: boolean;
  /** Minimum width (px) when dragging resize. Default 48. */
  minWidth?: number;
  /** Maximum width (px) when dragging resize. Default 4000. */
  maxWidth?: number;
  /** When false, no resize handle. Default true. */
  resizable?: boolean;
  /** Core-owned column (e.g. checkbox selection, row-drag handle); not from user defs. */
  internal?: "selection" | "row-drag" | "row-controls";
  /** Merged from column + `defaultColDef`. */
  sortable?: boolean;
  /**
   * Merged from `filterable` / `filter` on column + defaults (`filter` mirrors AG Grid).
   */
  filterable?: boolean;
  /** Column filter configuration. Resolved from column + defaultColDef `filter` inputs. */
  filter?: ColumnFilterInput;
  /** Per-column floating filter config. Merged from column + defaultColDef. */
  floatingFilter?: boolean | FloatingFilterColumnOptions;
  reorderable?: boolean;
  /** Pin column to the left or right edge. Pinned columns stay visible during horizontal scroll. */
  pinned?: "left" | "right" | false;
  pinnable?: boolean;
  editable?: boolean | ((ctx: CellEditEligibilityContext) => boolean);
  editor?: CellEditor | CellEditorKind | CellEditorConfig;
  /** When false, the column menu trigger is hidden for this column. Default true. */
  columnMenu?: boolean;
  /** Computed field value before formatting (default: `row[field]`). */
  valueGetter?: (params: ValueGetterParams) => unknown;
  /** Display string for the cell (default: `String(value)` with null → ""). */
  valueFormatter?: (params: ValueFormatterParams) => string;
  sortComparator?: (a: unknown, b: unknown, rowA: RowData, rowB: RowData) => number;
  /** Marks this column as a special cell kind (e.g. `"actions"` for row action menus). */
  cellKind?: CellKind;
  /** Key into `cellRenderers` registry for action columns. */
  actionsKey?: string;
  /** Customize the row action trigger button (icon, aria-label, className). */
  actionTrigger?: ActionCellTriggerOptions;
  /** When true, clicking a body cell in this column does not trigger row selection. Checkbox selection is unaffected. */
  suppressRowClickSelection?: boolean;
  /** When false, this column cannot be selected by header click / shift-range column selection. Default true. */
  columnSelectable?: boolean;
  /** Accessible-name override for a rendered body cell. */
  getCellAriaLabel?: (
    params: CellAccessibilityParams,
  ) => string | null | undefined;
  /** Space-separated ids of application-owned body-cell descriptions. */
  cellAriaDescribedBy?: string;
  /** Per-cell description-id override. */
  getCellAriaDescribedBy?: (
    params: CellAccessibilityParams,
  ) => string | null | undefined;

  // ── Quick filter / search ───────────────────────────────────────────
  /** When false, exclude this column from quick-filter matching. */
  searchable?: boolean;
  /** Custom quick-filter text extractor. Worker-ineligible. */
  getQuickFilterText?: (params: GetQuickFilterTextParams) => string;
  /** Dot-path field for worker-safe projected search text. */
  quickFilterTextField?: string;

  // ── Cell styling (class-only) ────────────────────────────────────────
  /** Static class name(s) applied to every body cell in this column. */
  cellClass?: string | string[];
  /** Functional cell-class hook. See {@link GetCellClass}. */
  getCellClass?: GetCellClass;
  /** Predicate-keyed class names. See {@link CellClassRules}. */
  cellClassRules?: CellClassRules;

  // ── Tooltips (plain text) ────────────────────────────────────────────
  /** When `true`, show the formatted cell value as a tooltip. */
  tooltip?: boolean;
  /** Custom tooltip text getter. Overrides the `tooltip` boolean. */
  tooltipValueGetter?: TooltipValueGetter;

  // ── Sizing ──────────────────────────────────────────────────────────
  /** When `true`, exclude this column from `sizeColumnsToFit()`. */
  suppressSizeToFit?: boolean;

  // ── Cell shells ────────────────────────────────────────────────────
  /** Grid-owned cell shell. Shorthand string sets `kind`; object for full config. */
  cellShell?: CellShellKind | CellShellConfig;

  // ── CSV export ──────────────────────────────────────────────────────
  /** When false, exclude this column from CSV export scopes. Default true. */
  exportable?: boolean;
  /**
   * Dot-path field read as the final precomputed CSV display projection,
   * bypassing this column's `valueGetter` / `valueFormatter`. Keeps
   * worker-assisted and main-thread export values identical.
   */
  exportValueField?: string;
  /**
   * When true, briefly highlight currently rendered cells after a successful
   * `applyTransaction` / `applyTransactionAsync` update of this column.
   * Disabled by default. Internal, selection, row-drag, and action cells
   * never flash.
   *
   * Ordinary field columns flash when the transaction dirty-field set
   * touches `field` (including dot-path prefix matching), on the settled
   * row-model render — including when that render rebinds the row onto a
   * different pooled cell. Columns with `valueGetter` / `valueFormatter`
   * flash only when the already-bound cell's previous display string
   * differs from the new one. Undeclared cross-field `valueGetter`
   * dependencies that do not change that bound display string are a v1
   * non-flash boundary.
   */
  cellChangeFlash?: boolean;
}

/** Renderer/state snapshot produced by `GridState.getSnapshot()` — not intended for user construction. */
export interface GridSnapshot {
  /** Effective column defs that are currently visible (layout + render). Hidden columns are omitted. */
  columns: ColumnDef[];
  /**
   * True when the host passed a non-empty `columns` array, including when every column is hidden.
   * Prevents inferring columns from row keys in that case (e.g. selection-only layout).
   */
  columnSchemaProvided?: boolean;
  /**
   * Source rows in their original insertion order — always the raw rows
   * reference passed via `setRows()` / constructor `rows` prop.
   *
   * **Not used by the renderer.** The renderer resolves all display rows
   * through {@link rowView} / `DisplayRowReader`. External consumers
   * needing display-order access should use {@link rowView} and
   * `createDisplayRowReader()`.
   *
   * @deprecated Prefer {@link rowView} for display-order access. This
   * field no longer reflects sort order.
   */
  data: RowData[];
  /**
   * Read-only view over the source rows in current display order. Backed by
   * a {@link RowOrder} (identity or `Uint32Array` indexed). The renderer and
   * features should consume this in preference to {@link data} so future
   * filtering/pagination/etc. plug in without renderer changes.
   */
  rowView: RowView;
  /**
   * Read-only view over ALL rows after sorting, ignoring pagination —
   * the selection/feature "universe". Equals {@link rowView} (same
   * reference) when pagination is disabled. Consumers that must see the
   * full row model (e.g. select-all scope `"all"`) read this instead of
   * the paginated {@link rowView}.
   */
  fullRowView?: RowView;
  /**
   * Increments when the grid replaces row or column data (`GridState` revision).
   * Used for row-level dirty skips with ring-buffer recycling.
   */
  dataRevision?: number;
  /** Normalized row selection UX; synced into the renderer on each snapshot. */
  rowSelection?: RowSelectionConfig;
  /** Column header selection (field ids); optional. */
  columnSelection?: ColumnSelectionConfig;
  /** Column reorder UX (drag-to-reorder); normalized from {@link LightFastGridProps#columnOrder}. */
  columnOrder?: ColumnOrderConfig;
  /** Row drag-to-reorder; normalized from {@link LightFastGridProps#rowDrag}. */
  rowDrag?: RowDragNormalizedConfig;
  /**
   * Row pin state keyed by stable row id. Owned by {@link GridState}; passed
   * to the renderer through the snapshot so renderer never holds private state.
   * Missing keys mean "not pinned"; ids with no matching row remain in state
   * but do not render.
   */
  rowPinState?: { readonly [rowId: string]: RowPinPosition };
  /**
   * Row styling config (class-only). Owned by {@link GridState}; the renderer
   * consumes this + {@link rowStylingVersion} to build a `resolveRowClasses`
   * closure and skip-cache invalidation.
   */
  rowStyling?: {
    rowClass?: string | string[];
    getRowClass?: GetRowClass;
    rowClassRules?: RowClassRules;
  };
  /** Version that bumps whenever any of the row styling inputs change. */
  rowStylingVersion?: number;
  sortModel?: SortModel;
  sortPending?: boolean;
  filterModel?: FilterModel;
  filterPending?: boolean;
  quickFilterText?: string;
  quickSearchPending?: boolean;
  /** Pagination state + page-size options; present only when enabled. */
  pagination?: GridPaginationSnapshot;
  /** Whether the loading overlay should be shown (from `props.loading`). */
  loading?: boolean;
  /** Explicit manual overlay kind, or `null` for none. */
  manualOverlay?: GridOverlayKind | null;
  /** User overlay customization (text, className, custom render). */
  overlays?: GridOverlaysOptions;
  /** Floating filter row config from props. */
  floatingFilters?: boolean | FloatingFiltersOptions;
  /** Derived column group header metadata. Absent or depth 0 for flat grids. */
  columnGroupHeaders?: ColumnGroupHeadersSnapshot;
}

// ── Overlays (loading / no rows / no matching rows) ──────────────────

/** Identifies which overlay variant is being shown. */
export type GridOverlayKind = "loading" | "noRows" | "noMatchingRows";

/** Context passed to a custom overlay render function. */
export interface GridOverlayRenderContext {
  /** Host element the renderer should populate. */
  host: HTMLElement;
  /** Which overlay variant is being rendered. */
  kind: GridOverlayKind;
  /** Live grid handle (may be `null` before mount). */
  grid: Grid | null;
}

/** Customization for a single overlay variant. */
export interface GridOverlayOptions {
  /**
   * Text shown in the default overlay layout and announced as the overlay
   * status. Custom renderers should set this to an equivalent concise message.
   */
  text?: string;
  /** Additional CSS class appended to the overlay host. */
  className?: string;
  /**
   * Custom render function. When set, replaces the default DOM. May return
   * a cleanup callback that runs when the overlay is hidden.
   */
  render?: (ctx: GridOverlayRenderContext) => void | (() => void);
}

/** Per-variant overlay customizations passed via `LightFastGridProps.overlays`. */
export interface GridOverlaysOptions {
  loading?: GridOverlayOptions;
  noRows?: GridOverlayOptions;
  noMatchingRows?: GridOverlayOptions;
}

/** Accepted visual overlay presentation published by the overlay owner. */
export interface LightFastGridOverlayPresentationChangedEvent {
  /** Active overlay kind, or null after the prior overlay is hidden. */
  readonly kind: GridOverlayKind | null;
  /** Bounded status text for the active overlay, or null when hidden. */
  readonly text: string | null;
}

export interface LightFastGridColDef {
  field: string;
  headerName?: string;
  /** Lightweight header action buttons that can open custom dropdown content. */
  headerActions?: HeaderActionDef[];
  /** Controls ordering for built-in header menu and custom header action buttons. */
  headerControls?: HeaderControlsConfig;
  flex?: number;
  width?: number;
  /** When false, the column is omitted from the table. Omitted or true: visible. */
  visible?: boolean;
  minWidth?: number;
  maxWidth?: number;

  /** When true, cells in this column can be edited in place. */
  editable?: boolean | ((ctx: CellEditEligibilityContext) => boolean);
  /** Editor used when `editable` is true. */
  editor?: CellEditor | CellEditorKind | CellEditorConfig;

  sortable?: boolean;
  /** Core naming; if set, takes precedence over `filter`. */
  filterable?: boolean;
  /** Column filter config. `true` enables text filter; string sets filter type; object for full config. */
  filter?: ColumnFilterInput;
  /** Per-column floating filter config. `true` enables; `false` disables; object for full config. */
  floatingFilter?: boolean | FloatingFilterColumnOptions;
  resizable?: boolean;
  reorderable?: boolean;
  pinned?: "left" | "right" | false;
  pinnable?: boolean;
  /** When false, the column menu trigger is hidden for this column. Default true. */
  columnMenu?: boolean;
  valueGetter?: (params: ValueGetterParams) => unknown;
  valueFormatter?: (params: ValueFormatterParams) => string;
  sortComparator?: (a: unknown, b: unknown, rowA: RowData, rowB: RowData) => number;
  /** Marks this column as a special cell kind (e.g. `"actions"` for row action menus). */
  cellKind?: CellKind;
  /** Key into `cellRenderers` registry for action columns. */
  actionsKey?: string;
  /** Customize the row action trigger button (icon, aria-label, className). */
  actionTrigger?: ActionCellTriggerOptions;
  /** When true, clicking a body cell in this column does not trigger row selection. Checkbox selection is unaffected. */
  suppressRowClickSelection?: boolean;
  /** When false, this column cannot be selected by header click / shift-range column selection. Default true. */
  columnSelectable?: boolean;
  /** Accessible-name override for a rendered body cell. */
  getCellAriaLabel?: (
    params: CellAccessibilityParams,
  ) => string | null | undefined;
  /** Space-separated ids of application-owned body-cell descriptions. */
  cellAriaDescribedBy?: string;
  /** Per-cell description-id override. */
  getCellAriaDescribedBy?: (
    params: CellAccessibilityParams,
  ) => string | null | undefined;

  // ── Quick filter / search ───────────────────────────────────────────
  /** When false, exclude this column from quick-filter matching. */
  searchable?: boolean;
  /** Custom quick-filter text extractor. Worker-ineligible. */
  getQuickFilterText?: (params: GetQuickFilterTextParams) => string;
  /** Dot-path field for worker-safe projected search text. */
  quickFilterTextField?: string;

  // ── Cell styling (class-only) ────────────────────────────────────────
  /** Static class name(s) applied to every body cell in this column. */
  cellClass?: string | string[];
  /** Functional cell-class hook. See {@link GetCellClass}. */
  getCellClass?: GetCellClass;
  /** Predicate-keyed class names. See {@link CellClassRules}. */
  cellClassRules?: CellClassRules;

  // ── Tooltips (plain text) ────────────────────────────────────────────
  /** When `true`, show the formatted cell value as a tooltip. */
  tooltip?: boolean;
  /** Custom tooltip text getter. Overrides the `tooltip` boolean. */
  tooltipValueGetter?: TooltipValueGetter;

  // ── Sizing ──────────────────────────────────────────────────────────
  /** When `true`, exclude this column from `sizeColumnsToFit()`. */
  suppressSizeToFit?: boolean;

  // ── Cell shells ────────────────────────────────────────────────────
  /** Grid-owned cell shell. Shorthand string sets `kind`; object for full config. */
  cellShell?: CellShellKind | CellShellConfig;

  // ── CSV export ─────────────────────────────────────
  /** When false, exclude this column from CSV export scopes. Default true. */
  exportable?: boolean;
  /**
   * Dot-path field read as the final precomputed CSV display projection,
   * bypassing this column's `valueGetter` / `valueFormatter`.
   */
  exportValueField?: string;
  /**
   * When true, briefly highlight currently rendered cells after a successful
   * `applyTransaction` / `applyTransactionAsync` update of this column.
   * Disabled by default. See {@link ColumnDef.cellChangeFlash}.
   */
  cellChangeFlash?: boolean;
}

// ── Column Group Input Types ────────────────────────────────────────

/**
 * A group of columns rendered as a shared group header row above the leaf
 * header row. Structural only — no leaf behavior ownership in V1.
 */
export interface LightFastGridColumnGroupDef {
  headerName: string;
  children: LightFastGridColumnInput[];
  groupId?: string;
}

/**
 * Public column input: a leaf column def or a structural column group.
 * Passing a flat `LightFastGridColDef[]` still typechecks.
 */
export type LightFastGridColumnInput =
  | LightFastGridColDef
  | LightFastGridColumnGroupDef;

// ── Internal Column Group Types ────────────────────────────────────

/** Internal mirror of the public group def. */
export interface ColumnGroupDef {
  headerName: string;
  children: ColumnInput[];
  groupId?: string;
}

/** Internal column input union. */
export type ColumnInput = ColumnDef | ColumnGroupDef;

/** One segment in the root-to-leaf-parent group path. */
export interface ColumnGroupPathSegment {
  /** Parent-scoped stable identity. */
  id: string;
  /** Label displayed in the group header row. */
  headerName: string;
  /** 0 = topmost group row. */
  level: number;
}

/** Group ancestry metadata for a single leaf column. */
export interface ColumnGroupPathMeta {
  path: ColumnGroupPathSegment[];
}

/** Snapshot of derived column group header metadata for the renderer. */
export interface ColumnGroupHeadersSnapshot {
  /** Max group depth (0 = no groups). */
  depth: number;
  /** Group path metadata keyed by visible leaf field. */
  byField: Record<string, ColumnGroupPathMeta>;
}

/**
 * Display config for column group header rows.
 * Distinct from {@link ColumnGroupHeadersSnapshot} (derived renderer metadata).
 */
export interface ColumnGroupHeadersOptions {
  /**
   * When `false`, suppress group header rows while keeping the same leaf
   * columns and group ancestry metadata. Default / omitted: enabled.
   */
  enabled?: boolean;
}

/** Column defaults merged into each `columns` entry unless overridden per column. */
export interface LightFastGridDefaultColDef {
  visible?: boolean;
  headerControls?: HeaderControlsConfig;
  editable?: boolean | ((ctx: CellEditEligibilityContext) => boolean);
  editor?: CellEditor | CellEditorKind | CellEditorConfig;
  sortable?: boolean;
  filterable?: boolean;
  /** Default column filter config. Per-column `filter` overrides. */
  filter?: ColumnFilterInput;
  /** Default floating filter config. Per-column `floatingFilter` overrides. */
  floatingFilter?: boolean | FloatingFilterColumnOptions;
  resizable?: boolean;
  reorderable?: boolean;
  pinnable?: boolean;
  valueGetter?: (params: ValueGetterParams) => unknown;
  valueFormatter?: (params: ValueFormatterParams) => string;
  sortComparator?: (a: unknown, b: unknown, rowA: RowData, rowB: RowData) => number;

  // ── Quick filter / search — defaults for every column ────────────────
  /** Default searchable flag. Per-column `searchable` overrides. */
  searchable?: boolean;
  /** Default quick-filter text extractor. Per-column `getQuickFilterText` overrides. */
  getQuickFilterText?: (params: GetQuickFilterTextParams) => string;
  /** Default projection field. Per-column `quickFilterTextField` overrides. */
  quickFilterTextField?: string;

  // ── Cell styling (class-only) — defaults for every column ─────────────
  /** Static cell class default. Per-column `cellClass` overrides. */
  cellClass?: string | string[];
  /** Default functional cell-class hook. Per-column `getCellClass` overrides. */
  getCellClass?: GetCellClass;
  /** Default predicate-keyed class rules. Per-column `cellClassRules` overrides. */
  cellClassRules?: CellClassRules;

  // ── Tooltips (plain text) — defaults for every column ─────────────────
  /** Default tooltip flag. Per-column `tooltip` overrides. */
  tooltip?: boolean;
  /** Default tooltip value getter. Per-column `tooltipValueGetter` overrides. */
  tooltipValueGetter?: TooltipValueGetter;

  // ── Accessibility ───────────────────────────────────────────────────
  /** Default body-cell accessible-name override. */
  getCellAriaLabel?: (
    params: CellAccessibilityParams,
  ) => string | null | undefined;
  /** Default application-owned body-cell description ids. */
  cellAriaDescribedBy?: string;
  /** Default per-cell description-id override. */
  getCellAriaDescribedBy?: (
    params: CellAccessibilityParams,
  ) => string | null | undefined;

  // ── Cell shells ─────────────────────────────────────────────────────
  /** Default cell shell. Per-column `cellShell` overrides. */
  cellShell?: CellShellKind | CellShellConfig;

  // ── Sizing ──────────────────────────────────────────────────────────
  /** Default suppressSizeToFit. Per-column `suppressSizeToFit` overrides. */
  suppressSizeToFit?: boolean;

  // ── CSV export — defaults for every column ───────────────────────────
  /** Default exportable flag. Per-column `exportable` overrides. */
  exportable?: boolean;
  /** Default CSV projection field. Per-column `exportValueField` overrides. */
  exportValueField?: string;

  /**
   * Default cell-change flash. Per-column `cellChangeFlash` overrides.
   * See {@link ColumnDef.cellChangeFlash}.
   */
  cellChangeFlash?: boolean;
}

export interface LightFastGridSortChangedEvent {
  sortModel: SortModel;
  source: SortChangeSource;
}

export interface LightFastGridFilterChangedEvent {
  filterModel: FilterModel;
  source: FilterChangeSource;
  activeFilterCount: number;
  totalRows: number;
  filteredRows: number;
}

export type SelectionChangeKind =
  | "single"
  | "toggle"
  | "selectAll"
  | "clear"
  | "mode"
  | "api";

/** Point-in-time selection shape for events (no row objects). */
export interface SelectionSnapshot {
  type: "explicit" | "all";
  /** Present only for small explicit sets; otherwise resolve via {@link LightFastGridSelectionChangedEvent.getSelectedRowIds}. */
  ids?: readonly string[];
  /** Present when `type === "all"` (usually small). */
  excludedIds?: readonly string[];
  selectedCount: number;
}

/** Stable ID-based selection handshake between store and orchestrator — no row payloads. */
export interface SelectionChange {
  kind: SelectionChangeKind;
  changedIds: string[];
  selection: SelectionSnapshot;
}

export type SelectionChangeSource = "click" | "api" | "keyboard";

// @ForDocs: Lazy methods resolve from the emitted SelectionSnapshot + grid row state at call time for row objects — not from the live selection renderer. Prefer e.forEachSelectedRow for bulk work in "all" mode.
export interface LightFastGridSelectionChangedEvent {
  readonly selectionType: "explicit" | "all";
  readonly selectedCount: number;

  /**
   * Cheap only for small explicit selections; `undefined` in `all` mode or when large.
   */
  readonly selectedRowIds?: readonly string[];

  readonly changeKind: SelectionChangeKind;

  readonly changedRowIds: readonly string[];

  /** Eager only for small `changedRowIds`; empty for bulk `selectAll` / `clear`. */
  readonly changedRows: readonly RowData[];

  readonly source: SelectionChangeSource;

  isRowSelected(rowId: string): boolean;

  /**
   * Expensive: may scan all rows (`all` mode or large explicit).
   */
  getSelectedRowIds(): string[];

  /**
   * Expensive: resolves row objects for {@link getSelectedRowIds}.
   */
  getSelectedRows(): RowData[];

  /** Iterate selected rows without materializing a full array (preferred in `all` mode). */
  forEachSelectedRow(callback: (row: RowData, index: number) => void): void;
}

export type ColumnSelectionChangeSource = "click" | "api" | "keyboard";

export interface LightFastGridColumnSelectionChangedEvent {
  readonly selectedColumnIds: readonly string[];
  readonly changedColumnIds: readonly string[];
  readonly source: ColumnSelectionChangeSource;
}

export interface ColumnSelectionOptions {
  mode?: "single" | "multiple";
  enableHeaderClickSelection?: boolean;
  /** When true, clear column selection on pointer down outside the grid root. Default false. */
  clearOnOutsideClick?: boolean;
}

export type ColumnSelectionProp = boolean | ColumnSelectionOptions | undefined;

/** Internal normalized column selection (after `normalizeColumnSelection`). */
export interface ColumnSelectionConfig {
  enabled: boolean;
  mode: "single" | "multiple";
  enableHeaderClickSelection: boolean;
  clearOnOutsideClick: boolean;
}

/** Internal normalized column order UX (after `normalizeColumnOrder`). */
export interface ColumnOrderConfig {
  enabled: boolean;
}

export type ColumnOrderProp = boolean | {
  enabled?: boolean;
};

export type ColumnOrderChangeSource = "drag" | "api" | "keyboard";

export interface LightFastGridColumnOrderChangedEvent {
  columnOrder: string[];
  movedColumnId: string;
  fromIndex: number;
  toIndex: number;
  source: ColumnOrderChangeSource;
  /** Present when multiple columns moved together (same order as {@link fromIndices}). */
  movedColumnIds?: string[];
  /** Original user-order indices for {@link movedColumnIds}; drag uses the pointer column for {@link movedColumnId}. */
  fromIndices?: number[];
}

export type ColumnPinChangeSource = "ui" | "api";

// ── Row pinning ──

/** Position a pinned row occupies in the layout. */
export type RowPinPosition = "top" | "bottom";

/** Single row's pin state. `pinned: false` means the row is unpinned. */
export interface RowPinStateEntry {
  rowId: string;
  pinned: RowPinPosition | false;
}

/** Full row pin state as a flat list. Order is not significant — visual order
 * always follows current data/render order. */
export type RowPinningState = RowPinStateEntry[];

export type RowPinChangeSource = "api" | "ui";

export interface RowPinChange {
  rowId: string;
  pinned: RowPinPosition | false;
  previousPinned: RowPinPosition | false;
}

export interface LightFastGridRowPinChangedEvent {
  source: RowPinChangeSource;
  /** Current row pin state after the change (only rows with active pins). */
  rowPinState: RowPinStateEntry[];
  /** One entry per row whose pin state actually changed. */
  changedRows: RowPinChange[];
}

/** Initial row pinning passed via `LightFastGridProps.rowPinning`. */
export interface RowPinningProp {
  top?: string[];
  bottom?: string[];
}

export interface ColumnPinState {
  field: string;
  pinned: "left" | "right" | false;
}

export interface ColumnPinChange {
  field: string;
  pinned: "left" | "right" | false;
  previousPinned: "left" | "right" | false;
}

export interface LightFastGridColumnPinChangedEvent {
  field: string;
  pinned: "left" | "right" | false;
  previousPinned: "left" | "right" | false;
  source: ColumnPinChangeSource;
  columnPinState: ColumnPinState[];
  changedColumns?: ColumnPinChange[];
}

export type ColumnVisibilityChangeSource = "ui" | "api";
export type ColumnSizeToFitSource = "api" | "ui";

export interface ColumnVisibilityState {
  field: string;
  visible: boolean;
}

export interface ColumnVisibilityChange {
  field: string;
  visible: boolean;
  previousVisible: boolean;
}

export interface LightFastGridColumnVisibilityChangedEvent {
  source: ColumnVisibilityChangeSource;
  columnVisibilityState: ColumnVisibilityState[];
  changedColumns: ColumnVisibilityChange[];
}

export interface LightFastGridCellValueChangedEvent {
  row?: RowData;
  columnId?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Fired synchronously after an edit prepares `row`, but **before** the row is
 * written into GridState / dirty-field computation / quick-search scheduling.
 * Mutate derived fields on `row` in place (e.g. quick-search projection text)
 * so the commit sees the updated values. Do not schedule a second transaction.
 */
export interface LightFastGridBeforeCellEditCommitEvent {
  /** The pending updated row object (same reference that will be committed). */
  row: RowData;
  columnId: string;
  oldValue: unknown;
  newValue: unknown;
  sourceIndex: number;
  rowId: string;
  rowIndex: number;
}

export interface RowDragConfig {
  enabled?: boolean;
  managed?: boolean;
  maxMultiRowDragCount?: number;
  maxMultiRowDragRatio?: number;
}

export type RowDragProp = boolean | RowDragConfig;

export interface RowDragNormalizedConfig {
  enabled: boolean;
  managed: boolean;
  maxMultiRowDragCount: number;
  maxMultiRowDragRatio: number;
}

export type RowOrderChangeSource = "drag" | "keyboard";

export interface LightFastGridRowOrderChangedEvent {
  rowId: string;
  rowIds: string[];
  row: RowData;
  rows: RowData[];
  fromIndex: number;
  fromIndices: number[];
  toIndex: number;
  source: RowOrderChangeSource;
  getRowOrderIds(): string[];
  getRows(): RowData[];
}

export interface LightFastGridColumnResizedEvent {
  field: string;
  width: number;
}

export type RowSelectionMode = "none" | "single" | "multiple";

/**
 * Layout configuration for the internal row-selection checkbox column.
 * Only width and placement are configurable — all other behavior
 * (resizable, reorderable, columnMenu, etc.) is hardcoded internally.
 */
export interface RowSelectionCheckboxColumnOptions {
  width?: number;
  pinned?: "left" | "right" | false;
}

/** Public object shape for `rowSelection` — omit fields to use defaults. */
/**
 * Universe the header select-all checkbox operates on.
 *
 * - `"page"` (default) — only the currently displayed rows (the active
 *   pagination page; all rows when pagination is disabled). Stores
 *   explicit row ids.
 * - `"all"` — every row in the client row model, across pages.
 */
export type RowSelectionSelectAllScope = "page" | "all";

export interface RowSelectionOptions {
  mode?: RowSelectionMode | "multi";
  checkboxes?: boolean;
  headerCheckbox?: boolean;
  enableRowClickSelection?: boolean;
  /** Header select-all universe. Default `"page"`. */
  selectAllScope?: RowSelectionSelectAllScope;
  /** Configure the internal checkbox column (width, pinning, etc). */
  checkboxColumn?: RowSelectionCheckboxColumnOptions;
}

/**
 * Internal normalized checkbox column config (after `normalizeRowSelection`).
 * Only `width` and `pinned` come from the user; everything else is fixed.
 */
export interface RowSelectionCheckboxColumnConfig {
  width: number;
  pinned: "left" | "right" | false;
}

/** Internal normalized selection flags (after `normalizeRowSelection`). */
export interface RowSelectionConfig {
  mode: RowSelectionMode;
  checkboxes: boolean;
  headerCheckbox: boolean;
  enableRowClickSelection: boolean;
  selectAllScope: RowSelectionSelectAllScope;
  checkboxColumn: RowSelectionCheckboxColumnConfig;
}

export type RowSelectionProp =
  | RowSelectionMode
  | "multi"
  | RowSelectionOptions
  | undefined;


export interface ColumnMenuItem {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  hidden?: boolean;
  action?: () => void;
}

export interface ColumnMenuSection {
  id: string;
  items: ColumnMenuItem[];
  render?: (host: HTMLElement) => void | (() => void);
}

export interface ColumnMenuGridApi {
  // Sort
  setSortModel(model: SortModel, source?: SortChangeSource): void;
  getSortModel(): SortModel;
  clearSort(source?: SortChangeSource): void;
  toggleColumnSort(field: string, opts?: { multi?: boolean; source?: SortChangeSource }): void;
  setColumnSort(field: string, direction: SortDirection | null, source?: SortChangeSource, opts?: { multi?: boolean }): void;
  // Filter
  setColumnFilterModel(field: string, model: ColumnFilterModel | null, source?: FilterChangeSource): void;
  getColumnFilterModel(field: string): ColumnFilterModel | null;
  clearColumnFilter(field: string, source?: FilterChangeSource): void;
  getFilterModel(): FilterModel;
  // Pinning
  pinColumn(field: string, pinned: "left" | "right" | false, source?: ColumnPinChangeSource): void;
  unpinColumn(field: string, source?: ColumnPinChangeSource): void;
  setColumnPinState(state: ColumnPinState[], source?: ColumnPinChangeSource): void;
  getColumnPinState(): ColumnPinState[];
  clearColumnPinning(source?: ColumnPinChangeSource): void;
  setColumnVisible(field: string, visible: boolean, source?: ColumnVisibilityChangeSource): void;
  hideColumns(fields: string[], source?: ColumnVisibilityChangeSource): void;
  showColumns(fields: string[], source?: ColumnVisibilityChangeSource): void;
  setColumnVisibilityState(state: ColumnVisibilityState[], source?: ColumnVisibilityChangeSource): void;
  getColumnVisibilityState(): ColumnVisibilityState[];
  showAllColumns(source?: ColumnVisibilityChangeSource): void;
  sizeColumnsToFit(source?: ColumnSizeToFitSource): void;
  sizeSelectedColumnsToFit(source?: ColumnSizeToFitSource): void;
  resetColumnWidths(source?: ColumnSizeToFitSource): void;
  autoSizeColumn(field: string, source?: ColumnSizeToFitSource): void;
  autoSizeColumns(fields: string[], source?: ColumnSizeToFitSource): void;
  autoSizeSelectedColumns(source?: ColumnSizeToFitSource): void;
}

export interface ColumnMenuSectionActionContext {
  field: string;
  column: ColumnDef;
  columns: ColumnDef[];
  selectedColumnIds: string[];
  defaultSections: ColumnMenuSection[];
  grid: ColumnMenuGridApi;
  close: () => void;
}

export interface ColumnMenuCustomPanelRenderContext {
  host: HTMLElement;
  field: string;
  column: ColumnDef;
  columns: ColumnDef[];
  selectedColumnIds: string[];
  grid: ColumnMenuGridApi;
  close: () => void;
}

export interface ColumnMenuCustomPanel {
  label: string;
  icon?: string;
  className?: string;
  hidden?: boolean;
  disabled?: boolean;
  render(ctx: ColumnMenuCustomPanelRenderContext): void | (() => void);
}

export type ColumnMenuCustomPanels = Record<string, ColumnMenuCustomPanel>;

export interface ColumnMenuCustomItem {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  hidden?: boolean;
  action?: (ctx: ColumnMenuSectionActionContext) => void;
}

export interface ColumnMenuCustomSection {
  id: string;
  items: ColumnMenuCustomItem[];
  position?: "top" | "bottom";
  before?: string;
  after?: string;
}

export type ColumnMenuSectionsFn = (ctx: ColumnMenuSectionActionContext) => ColumnMenuCustomSection[];

export interface ColumnMenuSortOptions {
  asc?: boolean;
  desc?: boolean;
  clear?: boolean;
}

export interface ColumnMenuPinningOptions {
  pinLeft?: boolean;
  pinRight?: boolean;
  unpin?: boolean;
}

export interface ColumnMenuVisibilityOptions {
  hideColumn?: boolean;
  hideSelectedColumns?: boolean;
}

export interface ColumnMenuSizingOptions {
  sizeColumnsToFit?: boolean;
  sizeSelectedColumnsToFit?: boolean;
  resetColumnWidths?: boolean;
  autoSizeColumn?: boolean;
  autoSizeSelectedColumns?: boolean;
}

export type FilterMenuPlacement = "mainMenu" | "dedicatedMenu" | "both";

export interface FilterSelectionListOptions {
  enabled?: boolean;
  placement?: FilterMenuPlacement;
}

export interface ColumnMenuFilterOptions {
  enabled?: boolean;
  placement?: FilterMenuPlacement;
  selectionList?: boolean | FilterSelectionListOptions;
  clear?: boolean;
  activeIcon?: string;
}

export interface ColumnMenuHeaderIcons {
  sortAsc?: string;
  sortDesc?: string;
  filtered?: string;
  sortAscFiltered?: string;
  sortDescFiltered?: string;
}

/** @deprecated Use `FilterMenuPlacement` instead. */
export type FilterPlacement = FilterMenuPlacement;

export interface ColumnMenuOptions {
  enabled?: boolean;
  sort?: boolean | ColumnMenuSortOptions;
  filter?: boolean | ColumnMenuFilterOptions;
  /** @deprecated Use `filter.placement` instead. */
  filterPlacement?: FilterMenuPlacement;
  pinning?: boolean | ColumnMenuPinningOptions;
  visibility?: boolean | ColumnMenuVisibilityOptions;
  sizing?: boolean | ColumnMenuSizingOptions;
  sections?: ColumnMenuSectionsFn;
  customPanels?: ColumnMenuCustomPanels;
  headerIcons?: ColumnMenuHeaderIcons;
}

// ── Execution options ──────────────────────────────────────────────────

export interface ExecutionThresholds {
  sort?: number;
  filter?: number;
  quickSearch?: number;
  /**
   * CSV export worker threshold, measured in **selected cells**
   * (`selectedRowCount * selectedColumnCount`) — unlike the row-count
   * thresholds used by sort, filter, and quick search.
   */
  csvExport?: number;
}

export interface ExecutionOptions {
  thresholds?: ExecutionThresholds;
}

/**
 * Grid-surface ARIA naming (`.lfg-grid-surface`). Consumed by the accessibility plugin;
 * see ACCESSIBILITY_V2_SURFACE §1.
 */
export interface GridAccessibilityOptions {
  /** Accessible name when the grid has no visible title in the DOM. */
  ariaLabel?: string;
  /** Space-separated ids of element(s) that label the grid. */
  ariaLabelledBy?: string;
  /** Space-separated ids of element(s) that describe the grid. */
  ariaDescribedBy?: string;
}

/**
 * Framework-neutral callback conveniences mapped to the typed Grid event bus.
 * `onBeforeCellEditCommit` is deliberately excluded because it is a
 * synchronous mutation hook, not an observational event.
 */
export interface GridEventCallbacks extends CsvExportEventCallbacks {
  onGridReady?: () => void;
  onColumnResized?: (event: LightFastGridColumnResizedEvent) => void;
  onSortChanged?: (event: LightFastGridSortChangedEvent) => void;
  onFilterChanged?: (event: LightFastGridFilterChangedEvent) => void;
  onSelectionChanged?: (event: LightFastGridSelectionChangedEvent) => void;
  onColumnSelectionChanged?: (
    event: LightFastGridColumnSelectionChangedEvent,
  ) => void;
  onColumnOrderChanged?: (event: LightFastGridColumnOrderChangedEvent) => void;
  onColumnPinChanged?: (event: LightFastGridColumnPinChangedEvent) => void;
  onRowPinChanged?: (event: LightFastGridRowPinChangedEvent) => void;
  onColumnVisibilityChanged?: (
    event: LightFastGridColumnVisibilityChangedEvent,
  ) => void;
  onRowOrderChanged?: (event: LightFastGridRowOrderChangedEvent) => void;
  onCellValueChanged?: (event: LightFastGridCellValueChangedEvent) => void;
  onPaginationChanged?: (event: LightFastGridPaginationChangedEvent) => void;
  onFocusedCellChanged?: (event: LightFastGridFocusedCellChangedEvent) => void;
  onCellShellAction?: (event: LightFastGridCellShellActionEvent) => void;
  onRowDataUpdated?: (event: LightFastGridRowDataUpdatedEvent) => void;
  onQuickFilterChanged?: (event: LightFastGridQuickFilterChangedEvent) => void;
  onQuickSearchPendingChanged?: (
    event: LightFastGridQuickSearchPendingChangedEvent,
  ) => void;
  onAsyncTransactionsFlushed?: (
    event: LightFastGridAsyncTransactionsFlushedEvent,
  ) => void;
}

/** Synchronous mutation hooks that run inside core operations. */
export interface GridHooks {
  onBeforeCellEditCommit?: (
    event: LightFastGridBeforeCellEditCommitEvent,
  ) => void;
}

/** Framework-neutral construction and configuration options. */
export interface GridOptions extends CsvExportGridOptions {
  // Data
  rows?: RowData[];
  columns?: LightFastGridColumnInput[];
  /**
   * Resolve a stable id from a row object. **Prefer the row-only form:**
   *
   * ```ts
   * getRowId={(row) => row.id}
   * ```
   *
   * Do NOT use row index as a row id — ids must represent the row, not its
   * current position. Index changes on sort, filter, reorder, and row
   * pinning. The legacy second parameter is accepted for back-compat but
   * should be ignored in new code.
   *
   * Returning `null` / `undefined` falls back to an internal object-identity
   * id (stable across sort/filter/reorder via a `WeakMap`) — never to row
   * index.
   */
  getRowId?: (row: RowData, index?: number) => unknown;
  /** Reserved for a future tree-specific shape API. Ignored by the flat wrapper today. */
  getParentId?: (row: RowData) => unknown;

  // Shape / mode
  /** Reserved for future non-flat shapes. The current wrapper only supports flat data. */
  mode?: "tree" | "flat";
  /** Reserved for future server-backed shapes. The current wrapper only supports client data. */
  rowModelType?: "client" | "server";

  // Defaults
  defaultColDef?: LightFastGridDefaultColDef;

  // Selection & pagination
  rowSelection?: RowSelectionProp;
  /** Select columns by header click; uses column `field` ids only. */
  columnSelection?: ColumnSelectionProp;
  /**
   * Column reordering (e.g. drag handles). `undefined` / `false`: disabled; `true`: enabled with defaults;
   * object merges with default `{ enabled: true }`.
   */
  columnOrder?: ColumnOrderProp;
  /**
   * Row drag-to-reorder. `undefined` / `false`: disabled; `true`: `{ enabled: true, managed: true }`;
   * object merges with defaults.
   */
  rowDrag?: RowDragProp;
  /**
   * Initial row pinning by row id. Values: `{ top: [...ids], bottom: [...ids] }`.
   * Same id in both arrays: last wins (bottom overrides top — last-write-wins).
   * Use the imperative API ({@link Grid.pinRow}, etc.) to mutate after mount.
   */
  rowPinning?: RowPinningProp;

  /**
   * Class names applied to every body row. String or string[]; strings are
   * whitespace-split and deduplicated. Class-only — no inline styles.
   */
  rowClass?: string | string[];
  /**
   * Functional row-class hook. Receives {@link RowClassParams} and returns
   * additional class names. Return `null` / `undefined` / `false` to add
   * nothing.
   */
  getRowClass?: GetRowClass;
  /**
   * Predicate-keyed class names. Each key is a class name applied when the
   * predicate returns `true`. Predicate errors propagate by design.
   */
  rowClassRules?: RowClassRules;
  initialSortModel?: SortModel;
  pagination?: boolean;
  /** Rows per page. Default 100. */
  paginationPageSize?: number;
  /**
   * Choices for the rows-per-page select. Default
   * `[25, 50, 100, 250, 500, 1000]`; `paginationPageSize` is always
   * included.
   */
  paginationPageSizeOptions?: number[];

  // Sizing / theme
  theme?: GridTheme | string | GridThemeOptions;
  /** Render all rows (disable vertical row virtualization). */
  suppressRowVirtualization?: boolean;
  /** Render all columns (disable horizontal column virtualization). */
  suppressColumnVirtualization?: boolean;

  // Floating filters
  /**
   * Show a floating filter row below the header. `true` enables with defaults;
   * `false` / `undefined` disables; object for full config.
   */
  floatingFilters?: boolean | FloatingFiltersOptions;

  // Column group headers (display)
  /**
   * Show group header rows above the leaf header when `columns` contain groups.
   * - `undefined` / `true` / `{ enabled: true }` — show (default)
   * - `false` / `{ enabled: false }` — suppress group rows; leaf columns unchanged
   *
   * This is display config only. It does not flatten or rewrite `columns`.
   * Distinct from {@link GridSnapshot.columnGroupHeaders} (derived metadata).
   */
  columnGroupHeaders?: boolean | ColumnGroupHeadersOptions;

  // Quick filter / quick search
  /** Quick filter configuration. `true` enables with defaults. */
  quickFilter?: boolean | QuickFilterOptions;
  /** Initial quick-filter text applied at construction. */
  quickFilterText?: string;

  // Column menu
  columnMenu?: ColumnMenuOptions;

  // Cell menu
  cellMenu?: CellMenuOptions;

  // Cell renderers
  /** Registry of cell renderers keyed by `actionsKey` on column definitions. */
  cellRenderers?: CellRendererRegistry;
  /** Registry of header action renderers keyed by `headerActions[].rendererKey`. */
  headerRenderers?: HeaderActionRendererRegistry;

  // Cell shell overlays
  /** Registry of overlay renderers keyed by `CellShellOverlayConfig.key`. */
  cellShellOverlays?: Record<string, CellShellOverlayRenderer>;

  /**
   * Delay (ms) before queued {@link Grid.applyTransactionAsync}
   * transactions flush as one batch. Default 50.
   */
  asyncTransactionWaitMillis?: number;

  // ── Execution ────────────────────────────────────────────────────
  /**
   * Configure execution thresholds that control when sort, filter, and
   * quick-search operations run asynchronously (via Worker or deferred
   * main-thread). Omit to use the built-in defaults (25 000 rows each for
   * sort, filter, and quickSearch).
   */
  execution?: ExecutionOptions;

  // ── Overlays ──────────────────────────────────────────────────────
  /**
   * When `true`, the grid shows the loading overlay. The runtime API
   * {@link Grid.setLoading} toggles this at runtime.
   */
  loading?: boolean;
  /**
   * Customize overlay variants (text, className, custom render).
   * See {@link GridOverlaysOptions}.
   */
  overlays?: GridOverlaysOptions;

  /**
   * Grid-surface accessible name and description (`aria-label`, `aria-labelledby`,
   * `aria-describedby` on `.lfg-grid-surface`). Applied by the accessibility plugin.
   */
  accessibility?: GridAccessibilityOptions;
}

/** Complete framework-neutral options accepted by the core constructor. */
export type GridCreateOptions = GridOptions & GridHooks & GridEventCallbacks;

/**
 * @deprecated Use {@link GridCreateOptions}. React-only container fields now
 * live on `ReactLightFastGridProps`.
 */
export type LightFastGridProps = GridCreateOptions;

/** Framework-neutral application-facing runtime API. */
export interface GridApi extends CsvExportCapability {
  /** Current source rows. Returns a shallow copy of the grid-owned row array. */
  getRows: () => RowData[];
  getSelectedRowIds: () => string[];
  getSelectedRows: () => RowData[];
  setSelectedRowIds: (ids: string[], source?: SelectionChangeSource) => void;
  clearSelection: () => void;
  getSelectedColumnIds: () => string[];
  setSelectedColumnIds: (ids: string[], source?: ColumnSelectionChangeSource) => void;
  clearColumnSelection: () => void;
  setSortModel: (model: SortModel, source?: SortChangeSource) => void;
  getSortModel: () => SortModel;
  clearSort: (source?: SortChangeSource) => void;
  toggleColumnSort: (field: string, opts?: { multi?: boolean; source?: SortChangeSource }) => void;
  // Filters
  setFilterModel: (model: FilterModel, source?: FilterChangeSource) => void;
  getFilterModel: () => FilterModel;
  clearFilters: (source?: FilterChangeSource) => void;
  setColumnFilterModel: (field: string, model: ColumnFilterModel | null, source?: FilterChangeSource) => void;
  getColumnFilterModel: (field: string) => ColumnFilterModel | null;
  clearColumnFilter: (field: string, source?: FilterChangeSource) => void;
  getColumnFilterConfig: (field: string) => NormalizedColumnFilterConfig | null;
  setFloatingFilters: (value: boolean | FloatingFiltersOptions | undefined) => void;
  /**
   * Show or suppress column group header rows without changing leaf columns.
   * See {@link LightFastGridProps.columnGroupHeaders}.
   */
  setColumnGroupHeaders: (
    value: boolean | ColumnGroupHeadersOptions | undefined,
  ) => void;
  /** Whether group header rows are currently enabled (display config). */
  isColumnGroupHeadersEnabled: () => boolean;
  // Quick filter
  setQuickFilterText: (text: string) => void;
  setQuickFilterConfig: (quickFilter: boolean | QuickFilterOptions | undefined) => void;
  clearQuickFilter: () => void;
  getQuickFilterText: () => string;
  isQuickFilterPresent: () => boolean;
  pinColumn: (field: string, pinned: "left" | "right" | false, source?: ColumnPinChangeSource) => void;
  unpinColumn: (field: string, source?: ColumnPinChangeSource) => void;
  setColumnPinState: (state: ColumnPinState[], source?: ColumnPinChangeSource) => void;
  getColumnPinState: () => ColumnPinState[];
  clearColumnPinning: (source?: ColumnPinChangeSource) => void;
  /**
   * Effective leaf column defs for user columns (excludes internal system columns).
   * Includes `headerName`, `pinnable`, current `pinned` / `visible`, etc.
   */
  getColumns: () => ColumnDef[];
  setColumnVisible: (field: string, visible: boolean, source?: ColumnVisibilityChangeSource) => void;
  hideColumns: (fields: string[], source?: ColumnVisibilityChangeSource) => void;
  showColumns: (fields: string[], source?: ColumnVisibilityChangeSource) => void;
  setColumnVisibilityState: (state: ColumnVisibilityState[], source?: ColumnVisibilityChangeSource) => void;
  getColumnVisibilityState: () => ColumnVisibilityState[];
  showAllColumns: (source?: ColumnVisibilityChangeSource) => void;
  // Row pinning
  pinRow: (rowId: string, position: RowPinPosition, source?: RowPinChangeSource) => void;
  pinRows: (rowIds: string[], position: RowPinPosition, source?: RowPinChangeSource) => void;
  unpinRows: (rowIds: string[], source?: RowPinChangeSource) => void;
  setRowPinState: (state: RowPinStateEntry[], source?: RowPinChangeSource) => void;
  getRowPinState: () => RowPinStateEntry[];
  clearRowPinning: (source?: RowPinChangeSource) => void;
  // Row styling — class-only API. Identical shape to `LightFastGridProps`;
  // pass `undefined` for any input to clear it. Triggers exactly one render
  // and is a no-op when none of the inputs actually change by reference.
  setRowStyling: (value: {
    rowClass?: string | string[];
    getRowClass?: GetRowClass;
    rowClassRules?: RowClassRules;
  }) => void;
  /** Resize eligible center columns to fill the viewport width. */
  sizeColumnsToFit: (source?: ColumnSizeToFitSource) => void;
  /** Resize only selected eligible center columns to fill the viewport width. */
  sizeSelectedColumnsToFit: (source?: ColumnSizeToFitSource) => void;
  /** Reset all column widths to their original schema values. */
  resetColumnWidths: (source?: ColumnSizeToFitSource) => void;
  /** Content-based autosize for one column. */
  autoSizeColumn: (field: string, source?: ColumnSizeToFitSource) => void;
  /** Content-based autosize for multiple columns. */
  autoSizeColumns: (fields: string[], source?: ColumnSizeToFitSource) => void;
  /** Content-based autosize for selected columns. */
  autoSizeSelectedColumns: (source?: ColumnSizeToFitSource) => void;

  // ── Overlays ──────────────────────────────────────────────────────
  /** Toggle the loading overlay. */
  setLoading: (loading: boolean) => void;
  /** Force-show the loading overlay until {@link hideOverlay} is called. */
  showLoadingOverlay: () => void;
  /** Force-show the "no rows" overlay until {@link hideOverlay} is called. */
  showNoRowsOverlay: () => void;
  /** Force-show the "no matching rows" overlay until {@link hideOverlay} is called. */
  showNoMatchingRowsOverlay: () => void;
  /** Clear any manually shown overlay. Does not change `loading`. */
  hideOverlay: () => void;
  /** Replace the overlay customization (text/className/render per variant). */
  setOverlays: (overlays: GridOverlaysOptions | undefined) => void;

  // ── Pagination ────────────────────────────────────────────────────
  /** Current pagination state (zero-based `pageIndex`). */
  getPaginationState: () => PaginationState;
  /** Replace the pagination configuration (enabled / pageSize / options). */
  setPaginationConfig: (config: PaginationConfig) => void;
  /** Jump to a zero-based page index (clamped to the valid range). */
  setPageIndex: (pageIndex: number, source?: PaginationChangeSource) => void;
  /** Change rows per page; the page index is clamped to stay valid. */
  setPageSize: (pageSize: number, source?: PaginationChangeSource) => void;
  nextPage: (source?: PaginationChangeSource) => void;
  previousPage: (source?: PaginationChangeSource) => void;
  firstPage: (source?: PaginationChangeSource) => void;
  lastPage: (source?: PaginationChangeSource) => void;

  // ── Row-data transactions ─────────────────────────────────────────
  /** Apply an add/update/remove transaction synchronously. */
  applyTransaction: (
    transaction: RowDataTransactionType,
  ) => RowDataTransactionResultType;
  /** Queue a transaction; batches flush after `asyncTransactionWaitMillis`. */
  applyTransactionAsync: (
    transaction: RowDataTransactionType,
    callback?: (result: RowDataTransactionResultType) => void,
  ) => void;
  /** Drain the async transaction queue immediately. */
  flushAsyncTransactions: () => RowDataTransactionResultType[];
  /** Replace rows via id-based immutable diffing (requires `getRowId`). */
  setRowsImmutable: (nextRows: RowData[]) => RowDataTransactionResultType;

  // ── Execution ──────────────────────────────────────────────────────
  /** Update execution thresholds at runtime. */
  setExecutionOptions: (execution?: ExecutionOptions) => void;

  // ── Theme ──────────────────────────────────────────────────────────
  /** Update the grid theme at runtime without remounting. */
  setTheme: (theme?: GridThemeInput) => void;

  // ── Focused cell ──────────────────────────────────────────────────
  /** Current focused cell, or `null`. */
  getFocusedCell: () => FocusedCell | null;
  /** Focus a cell by rowId or display rowIndex plus column field. */
  setFocusedCell: (
    target: { rowId?: string; rowIndex?: number; field: string },
    source?: FocusChangeSource,
  ) => void;
  clearFocusedCell: (source?: FocusChangeSource) => void;
  /** Move focus one navigation step (clamped at boundaries). */
  moveFocusedCell: (
    direction: FocusMoveDirection,
    source?: FocusChangeSource,
  ) => void;
}

/** Framework-adaptor synchronization API; not automatically exposed by handles. */
export interface GridAdapterApi extends GridApi {
  setRows(rows: RowData[]): void;
  setColumns(columns: LightFastGridColumnInput[]): void;
  setDefaultColDef(defaultColDef?: LightFastGridDefaultColDef): void;
  setRowSelection(selection: RowSelectionProp): void;
  setColumnSelection(selection: ColumnSelectionProp): void;
  setColumnOrder(order?: ColumnOrderProp): void;
  setRowDrag(rowDrag?: RowDragProp): void;
  setAccessibilityOptions(options?: GridAccessibilityOptions): void;
  setAsyncTransactionWaitMillis(ms?: number): void;
  setColumnMenu(options?: ColumnMenuOptions): void;
  setCellMenu(options?: CellMenuOptions): void;
  setCellRenderers(renderers?: CellRendererRegistry): void;
  setHeaderRenderers(renderers?: HeaderActionRendererRegistry): void;
  setCellShellOverlays(
    overlays?: Record<string, CellShellOverlayRenderer>,
  ): void;
  setCsvExportConfig(config?: boolean | CsvExportDefaults): void;
  setBeforeCellEditCommitHook(
    hook?: GridHooks['onBeforeCellEditCommit'],
  ): void;
}

export interface GridLifecycle {
  mount(container: HTMLElement): void;
  destroy(): void;
}

/**
 * @deprecated Use {@link GridApi}; framework adaptors add `getInstance()`
 * to their own handle type.
 */
export interface LightFastGridHandle extends GridApi {
  getInstance(): Grid | null;
}

export type { GridSkeleton, PooledCell, PooledRow } from './rendering/types/types';

// ── Header action renderers ──

export interface HeaderActionDef {
  id: string;
  rendererKey: string;
  icon?: string;
  ariaLabel?: string;
  className?: string;
  placement?: FloatingPlacement;
  hidden?: boolean;
  disabled?: boolean;
}

export interface HeaderActionGridApi {
  getColumns(): ColumnDef[];
  getSelectedColumnIds(): string[];
}

export interface HeaderActionRenderContext {
  host: HTMLElement;
  field: string;
  column: ColumnDef;
  columns: ColumnDef[];
  selectedColumnIds: string[];
  grid: HeaderActionGridApi;
  close: () => void;
}

export interface HeaderActionRenderer {
  kind: "header-action";
  mode: "custom";
  render(ctx: HeaderActionRenderContext): void | (() => void);
}

export type HeaderActionRendererRegistry = Record<string, HeaderActionRenderer>;


export interface GridActions {
  resizeColumn?: (field: string, width: number) => void;
  selectRow?: (rowId: string, modifiers: RowSelectionModifier) => void;
  notifySelectionChanged?: (
    change: SelectionChange,
    source: SelectionChangeSource,
  ) => void;
  notifyColumnSelectionChanged?: (
    e: LightFastGridColumnSelectionChangedEvent,
  ) => void;
  notifyFocusedCellChanged?: (e: LightFastGridFocusedCellChangedEvent) => void;
  notifyCellShellAction?: (e: LightFastGridCellShellActionEvent) => void;
  notifyColumnOrderChanged?: (e: LightFastGridColumnOrderChangedEvent) => void;
  notifyRowOrderChanged?: (e: LightFastGridRowOrderChangedEvent) => void;
  /** Commit a managed row reorder into the authoritative row array. */
  commitRowOrder?: (
    rowId: string,
    rowIds: string[],
    insertionIndex: number,
    source: RowOrderChangeSource,
  ) => LightFastGridRowOrderChangedEvent | null;
  notifySortChanged?: (e: LightFastGridSortChangedEvent) => void;
  toggleColumnSort?: (field: string, opts: { multi: boolean; source: SortChangeSource }) => void;
  setColumnSort?: (field: string, direction: SortDirection | null, source?: SortChangeSource, opts?: { multi?: boolean }) => void;
  pinColumn?: (field: string, pinned: "left" | "right" | false, source?: ColumnPinChangeSource) => void;
  setColumnPinState?: (state: ColumnPinState[], source?: ColumnPinChangeSource) => void;
  notifyColumnPinChanged?: (e: LightFastGridColumnPinChangedEvent) => void;
  hideColumns?: (fields: string[], source?: ColumnVisibilityChangeSource) => void;
  sizeColumnsToFit?: (source?: ColumnSizeToFitSource) => void;
  sizeSelectedColumnsToFit?: (source?: ColumnSizeToFitSource) => void;
  resetColumnWidths?: (source?: ColumnSizeToFitSource) => void;
  autoSizeColumn?: (field: string, source?: ColumnSizeToFitSource) => void;
  autoSizeSelectedColumns?: (source?: ColumnSizeToFitSource) => void;
  getMenuApi?: () => ColumnMenuGridApi;
  setPageIndex?: (pageIndex: number, source?: PaginationChangeSource) => void;
  setPageSize?: (pageSize: number, source?: PaginationChangeSource) => void;
  notifyColumnMenuChanged?: (openField: string | null) => void;
  notifyOverlayPresentationChanged?: (
    event: LightFastGridOverlayPresentationChangedEvent,
  ) => void;
}

// ── Cell renderers ──

export type CellKind = "actions";

export interface ActionCellTriggerOptions {
  /** Text or emoji shown inside the trigger button. Default `"⋯"`. */
  icon?: string;
  /** Accessible label for the trigger button. Default `"Row actions"`. */
  ariaLabel?: string;
  /** Additional CSS class appended to `lfg-action-trigger`. */
  className?: string;
  /** Dropdown placement relative to the trigger button. Default `"bottom-end"`. */
  placement?: FloatingPlacement;
  /**
   * Show a popover arrow on the menu pointing toward the trigger.
   * Default `true`. Set `false` to disable.
   */
  arrow?: boolean;
}

export interface RowActionItem {
  id: string;
  label: string;
  icon?: string;
  className?: string;
  disabled?: boolean;
  hidden?: boolean;
}

export interface RowActionGridApi {
  /** Minimal grid API surface available inside row action callbacks. */
  getRows(): RowData[];
}

export interface RowActionContext {
  row: RowData;
  rowIndex: number;
  rowId: string;
  column: ColumnDef;
  grid: RowActionGridApi;
}

export interface RowActionClickContext {
  actionId: string;
  action: RowActionItem;
  row: RowData;
  rowIndex: number;
  rowId: string;
  column: ColumnDef;
  grid: RowActionGridApi;
  close: () => void;
}

/**
 * Context passed to a custom row action renderer's `render()` callback.
 * The renderer owns `host` and should append its own DOM.
 */
export interface RowActionRenderContext {
  /** Container element the renderer should populate. */
  host: HTMLElement;
  row: RowData;
  rowIndex: number;
  rowId: string;
  column: ColumnDef;
  grid: RowActionGridApi;
  /** Close the action panel. */
  close: () => void;
}

/**
 * Built-in menu renderer: the framework renders a dropdown menu from
 * `getActions()` and dispatches clicks to `onAction()`.
 */
export interface ActionMenuCellRenderer {
  kind: "actions";
  /** Omit or set to `"menu"` for the built-in dropdown menu. */
  mode?: "menu";
  getActions(ctx: RowActionContext): RowActionItem[];
  onAction(ctx: RowActionClickContext): void;
}

/**
 * Custom renderer: the consumer provides a `render()` function that fully
 * owns the action panel DOM. Framework-free — no React/Vue/Angular imports.
 *
 * `render()` receives a host element and may return a cleanup function
 * that is called when the panel closes.
 */
export interface ActionCustomCellRenderer {
  kind: "actions";
  mode: "custom";
  /** Render custom content into `host`. Return an optional cleanup function. */
  render(ctx: RowActionRenderContext): void | (() => void);
}

/**
 * Discriminated union for row action cell renderers.
 *
 * - `mode` omitted or `"menu"` → built-in dropdown menu via `getActions` / `onAction`.
 * - `mode: "custom"` → consumer-owned render function.
 */
export type ActionCellRenderer =
  | ActionMenuCellRenderer
  | ActionCustomCellRenderer;

export type CellRendererRegistry = Record<string, ActionCellRenderer>;

// ── Cell menu ──

export type CellMenuTrigger =
  | "contextmenu"
  | "button"
  | "contextmenu-and-button";

export interface CellMenuItem {
  /** Stable action id passed to `onAction`. Must be unique among visible resolved actions for one open; duplicates throw during open. */
  id: string;
  label: string;
  icon?: string;
  className?: string;
  disabled?: boolean;
  hidden?: boolean;
}

export interface CellMenuGridApi {
  /** Shallow copy of the current source-row array. Row object references are retained. Not the displayed subset. */
  getRows(): RowData[];
}

export interface CellMenuContext {
  row: RowData;
  rowIndex: number;
  rowId: string;
  column: ColumnDef;
  field: string;
  value: unknown;
  grid: CellMenuGridApi;
}

export interface CellMenuActionContext extends CellMenuContext {
  actionId: string;
  action: CellMenuItem;
  /** Session-bound close for the open that created this callback. Stale callbacks are no-ops. Application close restores the connected invoker. */
  close: () => void;
}

/** Context for optional custom content inside the cell menu panel. */
export interface CellMenuPanelRenderContext extends CellMenuContext {
  /** Session-bound close for the open that created this callback. Stale callbacks are no-ops. Application close restores the connected invoker. */
  close: () => void;
}

export interface CellMenuTriggerButtonConfig {
  /** Icon text content for the trigger button. Default: `"⋮"`. */
  icon?: string;
  /** Accessible label for the trigger button. Default: `"Open cell menu"`. */
  ariaLabel?: string;
  /** Whitespace-separated CSS class tokens appended to the trigger button. */
  className?: string;
  /** Where to position the trigger within the cell. Default: `"right-center"`. */
  placement?: "right-center" | "left-center";
}

export interface CellMenuOptions {
  enabled?: boolean;
  trigger?: CellMenuTrigger;
  placement?: FloatingPlacement;
  /** Styling/icon config for the overlay trigger button (used when trigger includes "button"). */
  triggerButton?: CellMenuTriggerButtonConfig;
  getActions?: (ctx: CellMenuContext) => CellMenuItem[];
  onAction?: (ctx: CellMenuActionContext) => void;
  /**
   * Optional custom panel body (links, React mounts, etc.).
   * When set, the popup surface is a labelled non-modal dialog; descriptor-only surfaces remain menus.
   * Appended below action items. Return a cleanup function when needed.
   */
  renderPanel?: (
    host: HTMLElement,
    ctx: CellMenuPanelRenderContext,
  ) => void | (() => void);
}

export interface GridConfig {
  theme: string;
  resolvedTheme: ResolvedGridTheme;
  layoutMetrics: GridLayoutMetrics;
  /** See {@link LightFastGridProps.getRowId}. Prefer `(row) => row.id`. */
  getRowId?: (row: RowData, index?: number) => unknown;
  suppressRowVirtualization: boolean;
  suppressColumnVirtualization: boolean;
  columnMenu?: ColumnMenuOptions;
  cellMenu?: CellMenuOptions;
  cellRenderers?: CellRendererRegistry;
  cellShellOverlays?: Record<string, CellShellOverlayRenderer>;
  headerRenderers?: HeaderActionRendererRegistry;
}
