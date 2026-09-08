import type {
  ColumnWidthOverride,
  DomGridFeatureContext,
  ResizeLayoutControl,
} from "../internal/layoutTypes";
import type {
  ImmutableIdMembership,
  RowSelectionReadSnapshot,
} from "../internal/readSnapshots";
import type {
  ColumnDef,
  ColumnSelectionChangeSource,
  FocusChangeSource,
  FocusedCell,
  FocusMoveDirection,
  SelectionChange,
  SelectionChangeSource,
} from "../types";

export type { DomGridFeatureContext } from "../internal/layoutTypes";

export interface DomGridFeature {
  readonly name: string;
  attach(ctx: DomGridFeatureContext): void;
  detach(): void;
  /** Optional capability surface — column menu open field for ARIA. */
  getOpenColumnMenuField?(): string | null;
  /** Current column-menu popup id for the trigger `aria-controls` relation. */
  getOpenColumnMenuPopupId?(): string | null;
}

/** Cached DOM insertion points for one header lane (center / left / right). */
export interface HeaderLaneRef {
  /** Container that holds all header rows for this lane. */
  container: HTMLDivElement;
  /** Leaf header row element (existing interaction row). */
  leafRow: HTMLDivElement;
}

/** Per-lane header refs owned by DomPoolManager. Absent pinned lanes are null. */
export interface HeaderLaneRefs {
  center: HeaderLaneRef;
  left: HeaderLaneRef | null;
  right: HeaderLaneRef | null;
}

/** Per-lane columns + prefix edges for header addon geometry sync. */
export interface HeaderAddonLaneGeometry {
  columns: ColumnDef[];
  /**
   * `prefixEdges[i]` = sum of widths of columns `0..i-1`.
   * Length is `columns.length + 1`.
   */
  prefixEdges: Float64Array | readonly number[];
  /**
   * X offset that maps lane-local planner geometry into the associated
   * `HeaderLaneRef.container` coordinate space.
   *
   * - Pinned left/right stacks: `0` (container is lane-local).
   * - Center (`skeleton.header`): effective left-pinned width (container is global).
   */
  containerOffsetX: number;
}

/**
 * Layout bag built by VirtualWindowSync after leaf header slots are bound.
 * Passed to every HeaderAddonCapability via DomFeatureHost.syncHeaderAddons.
 */
export interface HeaderAddonSyncContext {
  centerWindow: { startCol: number; endCol: number };
  lanes: {
    left: HeaderAddonLaneGeometry | null;
    center: HeaderAddonLaneGeometry;
    right: HeaderAddonLaneGeometry | null;
  };
  headerLaneRefs: HeaderLaneRefs;
  layoutVersion: number;
}

/**
 * Generic header-addon contribution (floating filters now; column groups later).
 * Height is queried before window sync; geometry sync runs after leaf headers bind.
 */
export interface HeaderAddonCapability {
  getHeaderAddonHeight(): number;
  syncHeaderAddon(context: HeaderAddonSyncContext): void;
}

export function hasHeaderAddonCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & HeaderAddonCapability {
  const f = feature as Partial<HeaderAddonCapability>;
  return (
    typeof f.getHeaderAddonHeight === "function" &&
    typeof f.syncHeaderAddon === "function"
  );
}

export function findAllCapabilities<T extends DomGridFeature>(
  features: readonly DomGridFeature[],
  guard: (f: DomGridFeature) => f is T,
): T[] {
  const out: T[] = [];
  for (const f of features) {
    if (guard(f)) out.push(f);
  }
  return out;
}

export function sumHeaderAddonHeight(
  capabilities: readonly HeaderAddonCapability[],
): number {
  let total = 0;
  for (const cap of capabilities) {
    total += cap.getHeaderAddonHeight();
  }
  return total;
}

export function dispatchHeaderAddonSync(
  capabilities: readonly HeaderAddonCapability[],
  context: HeaderAddonSyncContext,
): void {
  for (const cap of capabilities) {
    cap.syncHeaderAddon(context);
  }
}

/** Optional: features may transform the resolved column list (e.g. inject selection checkbox). */
export interface ColumnTransformCapability {
  transformColumns(columns: ColumnDef[]): ColumnDef[];
}

export function hasColumnTransform(
  feature: DomGridFeature,
): feature is DomGridFeature & ColumnTransformCapability {
  return (
    typeof (feature as Partial<ColumnTransformCapability>).transformColumns ===
    "function"
  );
}

export interface SelectionCapability {
  isRowSelected(rowId: string): boolean;
  getSelectedIds(): string[];
  getSelectedCount(totalRows: number): number;
  /** O(1), snapshot-stable row-selection membership capture. */
  captureSelectionSnapshot(universeRowCount: number): RowSelectionReadSnapshot;
  clearSelection(opts?: {
    silent?: boolean;
    source?: SelectionChangeSource;
  }): SelectionChange | null;
  /** Replace the entire selection with the given row ids. */
  setSelectedIds(
    ids: string[],
    opts?: { silent?: boolean; source?: SelectionChangeSource },
  ): SelectionChange | null;
  syncSelectionMode(): void;
  /** Restore header aggregate checkbox from store after header DOM rebind. */
  refreshHeaderSelectionState(): void;
  /** O(1) command acceptance for one display row; DOM refresh is deferred. */
  toggleRowSelectionAtDisplayIndex(
    rowIndex: number,
    source?: SelectionChangeSource,
  ): boolean;
  /** O(1) command acceptance that selects one row and establishes its range anchor. */
  selectRowAtDisplayIndex(
    rowIndex: number,
    source?: SelectionChangeSource,
  ): boolean;
  /** O(1) adjacent range-step acceptance; row-id work is owner-deferred. */
  extendRowSelectionStep(
    previousRowIndex: number,
    nextRowIndex: number,
    source?: SelectionChangeSource,
  ): boolean;
  /** O(1) compact full-universe select-all toggle. */
  toggleAllRowSelection(source?: SelectionChangeSource): boolean;
}

export function hasSelectionCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & SelectionCapability {
  const f = feature as Partial<SelectionCapability>;
  return (
    typeof f.isRowSelected === "function" &&
    typeof f.getSelectedIds === "function" &&
    typeof f.getSelectedCount === "function" &&
    typeof f.captureSelectionSnapshot === "function" &&
    typeof f.clearSelection === "function" &&
    typeof f.setSelectedIds === "function" &&
    typeof f.syncSelectionMode === "function" &&
    typeof f.refreshHeaderSelectionState === "function" &&
    typeof f.toggleRowSelectionAtDisplayIndex === "function" &&
    typeof f.selectRowAtDisplayIndex === "function" &&
    typeof f.extendRowSelectionStep === "function" &&
    typeof f.toggleAllRowSelection === "function"
  );
}

export interface FocusCapability {
  getFocusedCell(): FocusedCell | null;
  setFocusedCell(
    target: { rowId?: string; rowIndex?: number; field: string },
    source?: FocusChangeSource,
  ): void;
  clearFocusedCell(source?: FocusChangeSource): void;
  moveFocusedCell(
    direction: FocusMoveDirection,
    source?: FocusChangeSource,
  ): boolean;
  /**
   * Publish a display-index focus target without running legacy navigation.
   * Structural column membership is retained by the focus owner, so this is
   * O(1) on the caller stack. Visual reconciliation and scrolling are deferred.
   */
  setFocusedCellAtDisplayIndex(
    rowIndex: number,
    field: string,
    source?: FocusChangeSource,
  ): boolean;
  /** Re-validate + re-apply focus visuals after a render. */
  syncFocusState(): void;
}

export function hasFocusCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & FocusCapability {
  const f = feature as Partial<FocusCapability>;
  return (
    typeof f.getFocusedCell === "function" &&
    typeof f.setFocusedCell === "function" &&
    typeof f.clearFocusedCell === "function" &&
    typeof f.moveFocusedCell === "function" &&
    typeof f.setFocusedCellAtDisplayIndex === "function" &&
    typeof f.syncFocusState === "function"
  );
}

export interface ExactFocusBindingCapability {
  /** O(1) validation after physical row/column slots have been rebound. */
  syncExactFocusBinding(): void;
}

export function hasExactFocusBindingCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & ExactFocusBindingCapability {
  return (
    typeof (feature as Partial<ExactFocusBindingCapability>)
      .syncExactFocusBinding === "function"
  );
}

export interface ResizeCapability extends ResizeLayoutControl {
  getResizeOverride(): ColumnWidthOverride | null;
  resizeColumnFromCommand(field: string, deltaPx: number): boolean;
}

export function hasResizeCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & ResizeCapability {
  const f = feature as Partial<ResizeCapability>;
  return (
    typeof f.getResizeOverride === "function" &&
    typeof f.resizeColumnFromCommand === "function" &&
    typeof f.isLayoutOnly === "function" &&
    typeof f.updateLayoutKey === "function" &&
    typeof f.resetLayoutKey === "function"
  );
}

export interface ColumnSelectionCapability {
  getSelectedColumnIds(): string[];
  /** O(1), snapshot-stable selected-column membership capture. */
  captureColumnSelectionSnapshot(): ImmutableIdMembership<string>;
  setSelectedColumnIds(
    ids: string[],
    opts?: { silent?: boolean; source?: ColumnSelectionChangeSource },
  ): boolean;
  clearColumnSelection(opts?: {
    silent?: boolean;
    source?: ColumnSelectionChangeSource;
  }): boolean;
  isColumnSelected(field: string): boolean;
  /** O(1) command acceptance against the retained selectable-field set. */
  toggleColumnSelection(
    field: string,
    source?: ColumnSelectionChangeSource,
  ): boolean;
  syncColumnSelectionFromConfig(): void;
}

export function hasColumnSelectionCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & ColumnSelectionCapability {
  const f = feature as Partial<ColumnSelectionCapability>;
  return (
    typeof f.getSelectedColumnIds === "function" &&
    typeof f.captureColumnSelectionSnapshot === "function" &&
    typeof f.setSelectedColumnIds === "function" &&
    typeof f.clearColumnSelection === "function" &&
    typeof f.isColumnSelected === "function" &&
    typeof f.toggleColumnSelection === "function" &&
    typeof f.syncColumnSelectionFromConfig === "function"
  );
}

export interface RowOrderCapability {
  syncRowDragConfig(): void;
  moveRowFromCommand(
    displayRowIndex: number,
    adjacentDisplayRowIndex: number,
  ): boolean;
}

export function hasRowOrderCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & RowOrderCapability {
  const candidate = feature as Partial<RowOrderCapability>;
  return (
    typeof candidate.syncRowDragConfig === "function" &&
    typeof candidate.moveRowFromCommand === "function"
  );
}

export interface ColumnOrderCapability {
  moveColumnFromCommand(field: string, visualDelta: -1 | 1): boolean;
  syncColumnOrderConfig(): void;
}

export function hasColumnOrderCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & ColumnOrderCapability {
  const candidate = feature as Partial<ColumnOrderCapability>;
  return (
    typeof candidate.moveColumnFromCommand === "function" &&
    typeof candidate.syncColumnOrderConfig === "function"
  );
}

export interface SortCapability {
  syncSortState(): void;
  /** O(1) eligibility lookup followed by one sort-owner operation. */
  toggleSortFromCommand(field: string, multi: boolean): boolean;
}

export function hasSortCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & SortCapability {
  const f = feature as Partial<SortCapability>;
  return (
    typeof f.syncSortState === "function" &&
    typeof f.toggleSortFromCommand === "function"
  );
}

export interface ColumnMenuCapability {
  getOpenColumnMenuField(): string | null;
  getOpenColumnMenuPopupId(): string | null;
  requestOpenColumnMenu(field: string, trigger: HTMLElement): boolean;
  closeColumnMenuFromCommand(): boolean;
  isColumnMenuOpen(): boolean;
}

export function hasColumnMenuCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & ColumnMenuCapability {
  return (
    typeof (feature as Partial<ColumnMenuCapability>).getOpenColumnMenuField ===
      "function" &&
    typeof (feature as Partial<ColumnMenuCapability>)
      .getOpenColumnMenuPopupId === "function"
    && typeof (feature as Partial<ColumnMenuCapability>)
      .requestOpenColumnMenu === "function"
    && typeof (feature as Partial<ColumnMenuCapability>)
      .closeColumnMenuFromCommand === "function"
    && typeof (feature as Partial<ColumnMenuCapability>)
      .isColumnMenuOpen === "function"
  );
}

export interface CellMenuCapability {
  resolveVisibleCellMenuTrigger(
    displayRowIndex: number,
    field: string,
    cell: HTMLElement,
  ): HTMLElement | null;
  requestOpenCellMenu(
    displayRowIndex: number,
    field: string,
    cell: HTMLElement,
    invoker: HTMLElement,
  ): boolean;
  closeCellMenuFromCommand(): boolean;
  isCellMenuOpen(): boolean;
}

export function hasCellMenuCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & CellMenuCapability {
  const candidate = feature as Partial<CellMenuCapability>;
  return (
    typeof candidate.resolveVisibleCellMenuTrigger === "function" &&
    typeof candidate.requestOpenCellMenu === "function" &&
    typeof candidate.closeCellMenuFromCommand === "function" &&
    typeof candidate.isCellMenuOpen === "function"
  );
}

export interface RowActionCapability {
  requestOpenRowAction(
    displayRowIndex: number,
    field: string,
    trigger: HTMLElement,
    invoker: HTMLElement,
  ): boolean;
  closeRowActionFromCommand(): boolean;
  isRowActionOpen(): boolean;
}

export function hasRowActionCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & RowActionCapability {
  const candidate = feature as Partial<RowActionCapability>;
  return (
    typeof candidate.requestOpenRowAction === "function" &&
    typeof candidate.closeRowActionFromCommand === "function" &&
    typeof candidate.isRowActionOpen === "function"
  );
}

export interface DedicatedFilterPopupCapability {
  requestOpenDedicatedFilter(field: string, trigger: HTMLElement): boolean;
  closeDedicatedFilterFromCommand(): boolean;
  isDedicatedFilterOpen(): boolean;
}

export function hasDedicatedFilterPopupCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & DedicatedFilterPopupCapability {
  const candidate = feature as Partial<DedicatedFilterPopupCapability>;
  return (
    typeof candidate.requestOpenDedicatedFilter === "function" &&
    typeof candidate.closeDedicatedFilterFromCommand === "function" &&
    typeof candidate.isDedicatedFilterOpen === "function"
  );
}

export interface TooltipCapability {
  requestTooltipForKeyboardTarget(target: HTMLElement | null): void;
  dismissKeyboardTooltip(): boolean;
}

export function hasTooltipCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & TooltipCapability {
  const candidate = feature as Partial<TooltipCapability>;
  return (
    typeof candidate.requestTooltipForKeyboardTarget === "function" &&
    typeof candidate.dismissKeyboardTooltip === "function"
  );
}

export interface FilterIndicatorCapability {
  syncFilterIndicatorState(): void;
}

export function hasFilterIndicatorCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & FilterIndicatorCapability {
  return typeof (feature as Partial<FilterIndicatorCapability>).syncFilterIndicatorState === "function";
}

/** Sync overlay layer after each render. */
export interface OverlayCapability {
  syncOverlays(): void;
}

export function hasOverlayCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & OverlayCapability {
  return typeof (feature as Partial<OverlayCapability>).syncOverlays === "function";
}

export interface FloatingFilterCapability {
  syncFloatingFilters(): void;
  getHeaderAddonHeight(): number;
  /** Whether one logical floating-filter header row currently exists. */
  hasFloatingFilterRow(): boolean;
}

export function hasFloatingFilterCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & FloatingFilterCapability {
  const f = feature as Partial<FloatingFilterCapability>;
  return (
    typeof f.syncFloatingFilters === "function" &&
    typeof f.getHeaderAddonHeight === "function" &&
    typeof f.hasFloatingFilterRow === "function"
  );
}

export interface EditingCapability {
  getEditingCell(): { rowId: string; field: string } | null;
  isEditing(): boolean;
  startEdit(target: { rowId?: string; rowIndex?: number; field: string; charSeed?: string }): boolean;
  startEditAtDisplayIndex(
    rowIndex: number,
    field: string,
    cellElement: HTMLElement,
    charSeed?: string,
  ): boolean;
  stopEdit(opts: { commit: boolean }): boolean;
  stopEditFromCommand(commit: boolean): boolean;
  toggleBooleanCell(target: { rowId?: string; rowIndex?: number; field: string }): boolean;
  toggleBooleanCellAtDisplayIndex(rowIndex: number, field: string): boolean;
  getBooleanCellKeyboardMode(target: {
    rowId?: string;
    rowIndex?: number;
    field: string;
  }): "toggle" | "edit" | null;
  getBooleanCellKeyboardModeAtDisplayIndex(
    rowIndex: number,
    field: string,
  ): "toggle" | "edit" | null;
  syncEditingState(): void;
}

export function hasEditingCapability(
  feature: DomGridFeature,
): feature is DomGridFeature & EditingCapability {
  const f = feature as Partial<EditingCapability>;
  return (
    typeof f.getEditingCell === "function" &&
    typeof f.isEditing === "function" &&
    typeof f.startEdit === "function" &&
    typeof f.startEditAtDisplayIndex === "function" &&
    typeof f.stopEdit === "function" &&
    typeof f.stopEditFromCommand === "function" &&
    typeof f.toggleBooleanCell === "function" &&
    typeof f.toggleBooleanCellAtDisplayIndex === "function" &&
    typeof f.getBooleanCellKeyboardMode === "function" &&
    typeof f.getBooleanCellKeyboardModeAtDisplayIndex === "function" &&
    typeof f.syncEditingState === "function"
  );
}

export function findCapability<T extends DomGridFeature>(
  features: readonly DomGridFeature[],
  guard: (f: DomGridFeature) => f is T,
): T | undefined {
  for (const f of features) {
    if (guard(f)) return f;
  }
  return undefined;
}
