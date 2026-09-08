import type { HeaderLaneRefs } from "../features/types";
import type { GridLayoutMetrics } from "../layout/gridLayoutMetrics";
import type { DisplayRowReader } from "../rendering/rowViewAccess";
import type {
  ColumnDef,
  ColumnGroupHeadersSnapshot,
  ColumnPinChangeSource,
  ColumnSelectionChangeSource,
  ColumnSelectionConfig,
  FocusChangeSource,
  FocusedCell,
  RowData,
  SelectionChangeSource,
  SortChangeSource,
  SortDirection,
  SortModel,
} from "../types";

import type { PooledRow } from "./poolTypes";

/**
 * DOM row pool contract exposed to built-in DOM features.
 * This is internal because current core has only DomGridRenderer.
 */
export type { PooledRow };

/**
 * Visual row order for focused-cell navigation, expressed compactly so
 * navigation costs O(pinned count) rather than O(total rows): pinned
 * lanes are small explicit arrays of display indexes, and the center
 * body is an O(1) index mapper. Visual order is
 * top-pinned → center → bottom-pinned.
 */
export interface VisualRowLayout {
  /** Display indexes of top-pinned rows, in visual order. */
  topDisplayIndexes: number[];
  /** Number of center (non-pinned) body rows. */
  centerRowCount: number;
  /** Map a center index to its display index; `null` = identity. */
  centerToDisplayIndex: ((centerIndex: number) => number) | null;
  /** Display indexes of bottom-pinned rows, in visual order. */
  bottomDisplayIndexes: number[];
}

/**
 * Allocation-free view of one row-pinned logical row split across column
 * lanes. The center row is always present and is the canonical logical row;
 * left/right are absent when those pin lanes do not exist.
 */
export type RowPinnedLogicalPoolRowVisitor = (
  center: PooledRow,
  left: PooledRow | null,
  right: PooledRow | null,
) => void;

export interface ColumnWidthOverride {
  field: string;
  width: number;
}

export interface ResizeLayoutControl {
  isLayoutOnly(key: string): boolean;
  updateLayoutKey(key: string): void;
  resetLayoutKey(): void;
}

/**
 * Lifecycle context for built-in DOM-only grid features (attach/detach).
 *
 * ## Row access
 *
 * **Display rows** — rows in the current display order (after sort, eventually
 * filter/pagination). Use {@link getDisplayRows} to get a `DisplayRowReader`
 * with scalar `getRowData(displayIndex)` / `getSourceIndex(displayIndex)` /
 * `rowCount` accessors. All features **must** use this for any display-index
 * based lookups.
 *
 * **Source rows** — the original user-supplied row array in insertion order.
 * Use {@link getSourceRows} when you need to expose unordered rows to user
 * callbacks (e.g. `grid.getRows()` in menu/action APIs).
 */
export interface DomGridFeatureContext {
  root: HTMLElement;
  /**
   * Neutral viewport-only composite-grid surface (wraps the viewport, inside
   * `root`). Owns the base focus tabindex; the accessibility plugin writes
   * `role="grid"`, composite ARIA, and `aria-activedescendant` here, and
   * pointer focus targets it. Delegated input/focus listeners stay on `root`.
   */
  surface: HTMLElement;
  viewport: HTMLElement;
  getPool(): PooledRow[];
  getColumns(): ColumnDef[];
  /**
   * Display-row reader backed by `RowView`. Provides `rowCount`,
   * `getRowData(displayIndex)`, and `getSourceIndex(displayIndex)`.
   * Canonical display-row access for all features.
   */
  getDisplayRows(): DisplayRowReader;
  /**
   * Reader over ALL rows after sorting, ignoring pagination — the
   * selection/feature universe. Equals {@link getDisplayRows} when
   * pagination is disabled. Optional: consumers fall back to
   * {@link getDisplayRows}.
   */
  getFullDisplayRows?(): DisplayRowReader;
  /**
   * Original user-supplied rows in source (insertion) order. Use for
   * public/internal APIs that expose unordered rows to user callbacks
   * (e.g. cell-menu / row-action `grid.getRows()`). Never for
   * display-index lookups — use {@link getDisplayRows} instead.
   */
  getSourceRows(): RowData[];
  getVisibleRowStart(): number;
  /**
   * Horizontally scroll the center viewport so `field` is visible,
   * using the effective column layout (virtualization-friendly: no DOM
   * scan; works for columns outside the rendered window). Pinned
   * fields are always visible and never scroll. Optional — renderers
   * without horizontal scrolling may omit it.
   */
  ensureFieldVisible?(field: string): void;
  /**
   * Visual row order (top-pinned → center → bottom-pinned) for
   * focused-cell keyboard navigation. Optional — without it, focus
   * treats display order as visual order.
   */
  getVisualRowLayout?(): VisualRowLayout;
  /**
   * Visit each pooled row in the row-pinned top/bottom lanes (center +
   * left + right sub-lanes). These live outside {@link getPool}; focus
   * visuals and pinned-row clicks visit them in addition to the main
   * pool. Callback-style to avoid building a throwaway array.
   */
  forEachRowPinnedLanePoolRow?(cb: (row: PooledRow) => void): void;
  /**
   * Visit row-pinned rows as retained center/left/right physical triples.
   * This is a feature-neutral structural reader; implementations must not
   * allocate projection objects or invoke it from renderer scroll handling.
   */
  forEachRowPinnedLogicalPoolRow?(
    cb: RowPinnedLogicalPoolRowVisitor,
  ): void;
  layoutMetrics?: GridLayoutMetrics;
  requestSync(): void;
  /**
   * Re-run column transforms + pool/window sync when renderer-driven order changes
   * (e.g. column drag) without a full Grid snapshot.
   */
  requestColumnTransformSync(): void;
  /** Lightweight column-selection highlight sync (visible DOM only). */
  syncColumnSelectionClasses?(): void;
  resolveRowId(row: RowData, index: number): string;
  getHeaderRowEl(): HTMLDivElement | null;
  getPinnedHeaderRowEl(): HTMLDivElement | null;
  getPinnedRightHeaderRowEl(): HTMLDivElement | null;
  /**
   * Cached header lane containers + leaf rows (owned by DomPoolManager).
   * Header addon features insert relative to each lane's leafRow.
   */
  getHeaderLaneRefs?(): HeaderLaneRefs | null;
  /**
   * Derived column-group header metadata from the current snapshot.
   * Generic context only in Phase 3A — no feature consumes it yet for DOM.
   */
  getColumnGroupHeaders?(): ColumnGroupHeadersSnapshot | undefined;
  /** O(1) structural presence of the optional floating-filter header row. */
  hasFloatingFilterRow?(): boolean;
  /** GridState snapshot `dataRevision`; bumps when rows/columns/etc. change. */
  getDataRevision(): number;
  /** Escape clears — wired by {@link DomFeatureHost} for the input feature. */
  clearRowSelectionFromKeyboard?(): boolean;
  clearColumnSelectionFromKeyboard?(): boolean;
  toggleRowSelectionAtDisplayIndex?(
    rowIndex: number,
    source?: SelectionChangeSource,
  ): boolean;
  selectRowAtDisplayIndex?(
    rowIndex: number,
    source?: SelectionChangeSource,
  ): boolean;
  extendRowSelectionStep?(
    previousRowIndex: number,
    nextRowIndex: number,
    source?: SelectionChangeSource,
  ): boolean;
  toggleAllRowSelection?(source?: SelectionChangeSource): boolean;
  toggleColumnSelection?(
    field: string,
    source?: ColumnSelectionChangeSource,
  ): boolean;
  /**
   * Read-only selected column field ids for column reorder (multi-drag).
   * Wired by {@link DomFeatureHost} from column-selection capability.
   */
  getSelectedColumnIdsForColumnOrder(): string[];
  /** Current column-selection configuration for semantic state readers. */
  getColumnSelectionConfig?(): ColumnSelectionConfig;
  /** O(1) selected-column membership. */
  isColumnSelected?(field: string): boolean;
  /** Current focused-cell identity from the focus capability. */
  getFocusedCell?(): FocusedCell | null;
  /** O(1) focus-state publication; visual/scroll work is owner-deferred. */
  setFocusedCellAtDisplayIndex?(
    rowIndex: number,
    field: string,
    source?: FocusChangeSource,
  ): boolean;
  /**
   * Enable the neutral post-window-sync exact-focus check only while a feature
   * retains a physical focus binding that recycling could invalidate.
   */
  setExactFocusBindingActive?(active: boolean): void;
  /** Cached renderer viewport height; never performs a DOM read. */
  getCachedViewportHeight?(): number;
  getSelectedRowCountForRowOrder(): number;
  isRowSelectedForRowOrder(rowId: string): boolean;
  getSelectedRowIdsForRowOrder(): string[];
  getSortModel(): SortModel;
  toggleSortFromCommand?(field: string, multi: boolean): boolean;
  isCellEditing?(): boolean;
  startCellEditAtDisplayIndex?(
    rowIndex: number,
    field: string,
    cellElement: HTMLElement,
    charSeed?: string,
  ): boolean;
  stopCellEdit?(commit: boolean): boolean;
  toggleBooleanCellAtDisplayIndex?(rowIndex: number, field: string): boolean;
  getBooleanCellKeyboardModeAtDisplayIndex?(
    rowIndex: number,
    field: string,
  ): "toggle" | "edit" | null;
  toggleColumnSort(field: string, opts: { multi: boolean; source: SortChangeSource }): void;
  setColumnSort(field: string, direction: SortDirection | null, source?: SortChangeSource, opts?: { multi?: boolean }): void;
  pinColumn(field: string, pinned: "left" | "right" | false, source?: ColumnPinChangeSource): void;
  /** Open column-menu field for §4 menu trigger `aria-expanded` (accessibility plugin). */
  getOpenColumnMenuField?(): string | null;
  /** Connected column-menu popup id for §11 trigger `aria-controls`. */
  getOpenColumnMenuPopupId?(): string | null;
  requestOpenColumnMenu?(field: string, trigger: HTMLElement): boolean;
  requestOpenCellMenu?(
    displayRowIndex: number,
    field: string,
    cell: HTMLElement,
    invoker: HTMLElement,
  ): boolean;
  resolveVisibleCellMenuTrigger?(
    displayRowIndex: number,
    field: string,
    cell: HTMLElement,
  ): HTMLElement | null;
  requestOpenRowAction?(
    displayRowIndex: number,
    field: string,
    trigger: HTMLElement,
    invoker: HTMLElement,
  ): boolean;
  requestOpenDedicatedFilter?(field: string, trigger: HTMLElement): boolean;
  closeOpenPopupFromCommand?(): boolean;
  requestTooltipForKeyboardTarget?(target: HTMLElement | null): void;
  dismissKeyboardTooltip?(): boolean;
  moveColumnFromCommand?(field: string, visualDelta: -1 | 1): boolean;
  moveRowFromCommand?(
    displayRowIndex: number,
    adjacentDisplayRowIndex: number,
  ): boolean;
  resizeColumnFromCommand?(field: string, deltaPx: number): boolean;
}
