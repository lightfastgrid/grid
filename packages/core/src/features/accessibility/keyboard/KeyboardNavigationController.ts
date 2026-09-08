import { isSelectionHostColumn } from "../../../internal/internalColumns";
import type { VisualRowLayout } from "../../../internal/layoutTypes";
import type { ColumnDef, ColumnGroupHeadersSnapshot } from "../../../types";

import { isKeyboardTargetElementBound } from "./isKeyboardTargetElementBound";
import {
  clearKeyboardTarget,
  copyKeyboardTarget,
  createKeyboardTargetState,
  KEYBOARD_NAVIGATION_UNCHANGED,
  type KeyboardMoveDirection,
  type KeyboardNavigationResult,
  type KeyboardTargetState,
  type KeyboardWritingDirection,
  setBodyCellTarget,
} from "./keyboardTarget";
import { resolveKeyboardNavigationIntent } from "./navigationIntent";
import type { KeyboardNavigationPlan } from "./navigationPlan";
import { planKeyboardNavigationTopology } from "./planNavigationTopology";
import {
  createKeyboardNavigationScratch,
  type KeyboardNavigationContext,
  resolveKeyboardNavigationTarget,
} from "./resolveNavigationTarget";
import {
  keyboardDisplayIndexAtVisual,
  keyboardVisualIndexOfDisplay,
  keyboardVisualRowCount,
} from "./visualRows";

export type KeyboardInteractionMode = "navigation" | "edit" | "widget";

export interface KeyboardNavigationControllerHost {
  readonly surface?: HTMLElement;
  readPageSize(): number;
  readWritingDirection(): KeyboardWritingDirection;
  focusBodyCell?(
    displayRowIndex: number,
    field: string,
  ): boolean;
  toggleRowSelection?(displayRowIndex: number): boolean;
  selectRow?(displayRowIndex: number): boolean;
  extendRowSelection?(
    previousDisplayRowIndex: number,
    nextDisplayRowIndex: number,
  ): boolean;
  toggleAllRows?(): boolean;
  toggleColumnSelection?(field: string): boolean;
  toggleSort?(field: string, multi: boolean): boolean;
  isCellEditing?(): boolean;
  startCellEdit?(
    displayRowIndex: number,
    field: string,
    cellElement: HTMLElement,
    charSeed?: string,
  ): boolean;
  stopCellEdit?(commit: boolean): boolean;
  toggleBooleanCell?(displayRowIndex: number, field: string): boolean;
  getBooleanCellKeyboardMode?(
    displayRowIndex: number,
    field: string,
  ): "toggle" | "edit" | null;
  resolveTargetWidgetCount?(displayRowIndex: number, field: string): number;
  resolveTargetWidget?(
    displayRowIndex: number,
    field: string,
    widgetIndex: number,
  ): HTMLElement | null;
  resolveHeaderWidgetCount?(
    kind: "leafHeader" | "floatingFilter",
    field: string,
  ): number;
  resolveHeaderWidget?(
    kind: "leafHeader" | "floatingFilter",
    field: string,
    widgetIndex: number,
  ): HTMLElement | null;
  ensureFieldVisible?(field: string): void;
  resolveTargetElement?(target: Readonly<KeyboardTargetState>): HTMLElement | null;
  readPointerTarget?(
    target: EventTarget | null,
    out: KeyboardTargetState,
  ): boolean;
  resolveColumnMenuTrigger?(field: string): HTMLElement | null;
  resolveDedicatedFilterTrigger?(field: string): HTMLElement | null;
  resolveResizeHandle?(field: string): HTMLElement | null;
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
  closeOpenPopup?(): boolean;
  requestKeyboardTooltip?(target: HTMLElement | null): void;
  dismissKeyboardTooltip?(): boolean;
  clearRowSelection?(): boolean;
  clearColumnSelection?(): boolean;
  moveColumn?(field: string, visualDelta: -1 | 1): boolean;
  moveRow?(displayRowIndex: number, adjacentDisplayRowIndex: number): boolean;
  resizeColumn?(field: string, deltaPx: number): boolean;
  setExactFocusBindingActive?(active: boolean): void;
}

export interface KeyboardTopologyInput {
  readonly columns: readonly ColumnDef[];
  readonly columnGroupHeaders?: ColumnGroupHeadersSnapshot | null;
  readonly hasFloatingFilterRow: boolean;
}

const EMPTY_DISPLAY_INDEXES: number[] = [];
Object.freeze(EMPTY_DISPLAY_INDEXES);

const EMPTY_ROW_LAYOUT: VisualRowLayout = Object.freeze({
  topDisplayIndexes: EMPTY_DISPLAY_INDEXES,
  centerRowCount: 0,
  centerToDisplayIndex: null,
  bottomDisplayIndexes: EMPTY_DISPLAY_INDEXES,
});

const FOCUS_PREVENT_SCROLL: FocusOptions = Object.freeze({
  preventScroll: true,
});

/**
 * Keyboard-owned surface focus. Reveals `:focus-visible` after a prior pointer
 * focus that intentionally suppressed the keyboard ring.
 * TypeScript's shipped DOM lib does not yet declare `focusVisible`.
 */
const FOCUS_KEYBOARD_VISIBLE = Object.freeze({
  preventScroll: true,
  focusVisible: true,
}) as FocusOptions;

const ACTIVE_TARGET_CLASS = "lfg-a11y-active-target";
/** Surface modality class used when `:focus-visible` cannot be re-enabled. */
const KEYBOARD_FOCUS_CLASS = "lfg-keyboard-focus";

function isSpaceKey(key: string): boolean {
  return key === " " || key === "Spacebar";
}

function isPopupOpenKey(event: KeyboardEvent): boolean {
  const ctrlOrMeta = event.ctrlKey || event.metaKey;
  return (
    (event.altKey && !event.shiftKey && !ctrlOrMeta && event.key === "ArrowDown") ||
    (event.shiftKey && !event.altKey && !ctrlOrMeta && event.key === "F10")
  );
}

function bodyDataColumnOrdinalForPointer(
  plan: KeyboardNavigationPlan,
  ordinal: number,
): number {
  if (plan.columns[ordinal]?.column.internal === undefined) return ordinal;
  const next = plan.nextDataColumnOrdinal[ordinal] ?? -1;
  return next >= 0 ? next : (plan.previousDataColumnOrdinal[ordinal] ?? -1);
}

/** Retained composite-grid keyboard state and the sole surface key owner. */
export class KeyboardNavigationController {
  private readPageSize: (() => number) | null = null;
  private readWritingDirection: (() => KeyboardWritingDirection) | null = null;
  private focusBodyCell: ((displayRowIndex: number, field: string) => boolean) | null = null;
  private toggleRowSelection: ((displayRowIndex: number) => boolean) | null = null;
  private selectRow: ((displayRowIndex: number) => boolean) | null = null;
  private extendRowSelection: ((previousDisplayRowIndex: number, nextDisplayRowIndex: number) => boolean) | null = null;
  private toggleAllRows: (() => boolean) | null = null;
  private toggleColumnSelection: ((field: string) => boolean) | null = null;
  private toggleSort: ((field: string, multi: boolean) => boolean) | null = null;
  private isCellEditing: (() => boolean) | null = null;
  private startCellEdit: ((displayRowIndex: number, field: string, cellElement: HTMLElement, charSeed?: string) => boolean) | null = null;
  private stopCellEdit: ((commit: boolean) => boolean) | null = null;
  private toggleBooleanCell: ((displayRowIndex: number, field: string) => boolean) | null = null;
  private getBooleanCellKeyboardMode: ((displayRowIndex: number, field: string) => "toggle" | "edit" | null) | null = null;
  private resolveTargetWidgetCount: ((displayRowIndex: number, field: string) => number) | null = null;
  private resolveTargetWidget: ((displayRowIndex: number, field: string, widgetIndex: number) => HTMLElement | null) | null = null;
  private resolveHeaderWidgetCount: ((kind: "leafHeader" | "floatingFilter", field: string) => number) | null = null;
  private resolveHeaderWidget: ((kind: "leafHeader" | "floatingFilter", field: string, widgetIndex: number) => HTMLElement | null) | null = null;
  private ensureFieldVisible: ((field: string) => void) | null = null;
  private resolveTargetElement: ((target: Readonly<KeyboardTargetState>) => HTMLElement | null) | null = null;
  private readPointerTarget: ((target: EventTarget | null, out: KeyboardTargetState) => boolean) | null = null;
  private resolveColumnMenuTrigger: ((field: string) => HTMLElement | null) | null = null;
  private resolveDedicatedFilterTrigger: ((field: string) => HTMLElement | null) | null = null;
  private resolveResizeHandle: ((field: string) => HTMLElement | null) | null = null;
  private requestOpenColumnMenu: ((field: string, trigger: HTMLElement) => boolean) | null = null;
  private requestOpenCellMenu: ((displayRowIndex: number, field: string, cell: HTMLElement, invoker: HTMLElement) => boolean) | null = null;
  private resolveVisibleCellMenuTrigger: ((displayRowIndex: number, field: string, cell: HTMLElement) => HTMLElement | null) | null = null;
  private requestOpenRowAction: ((displayRowIndex: number, field: string, trigger: HTMLElement, invoker: HTMLElement) => boolean) | null = null;
  private requestOpenDedicatedFilter: ((field: string, trigger: HTMLElement) => boolean) | null = null;
  private closeOpenPopup: (() => boolean) | null = null;
  private requestKeyboardTooltip: ((target: HTMLElement | null) => void) | null = null;
  private dismissKeyboardTooltip: (() => boolean) | null = null;
  private clearRowSelection: (() => boolean) | null = null;
  private clearColumnSelection: (() => boolean) | null = null;
  private moveColumn: ((field: string, visualDelta: -1 | 1) => boolean) | null = null;
  private moveRow: ((displayRowIndex: number, adjacentDisplayRowIndex: number) => boolean) | null = null;
  private resizeColumn: ((field: string, deltaPx: number) => boolean) | null = null;
  private setExactFocusBindingActive: ((active: boolean) => void) | null = null;
  private surface: HTMLElement | null = null;
  private activeTargetElement: HTMLElement | null = null;
  private lifecycleOwner: object = {};
  private mode: KeyboardInteractionMode = "navigation";
  private readonly target = createKeyboardTargetState();
  private readonly navigationScratch = createKeyboardNavigationScratch();
  private plan: KeyboardNavigationPlan | null = null;
  private rowLayout: VisualRowLayout = EMPTY_ROW_LAYOUT;
  private navigationContext: KeyboardNavigationContext | null = null;
  private topologyRevision = 0;
  private lastTopologyColumns: readonly ColumnDef[] | null = null;
  private lastTopologyGroups: ColumnGroupHeadersSnapshot | null | undefined;
  private lastTopologyFloatingFilter = false;
  private activeDispatchToken = 0;
  private nextDispatchToken = 1;
  private widgetIndex = -1;
  private activeWidgetKind: "body" | "header" | null = null;
  private retainedBodyWidgetCount = 0;
  private externalBodyWidget: HTMLElement | null = null;
  private widgetTargetElement: HTMLElement | null = null;
  private activeWidgetElement: HTMLElement | null = null;
  private activeWidgetFocusDeparted = false;
  private suppressSurfaceFocusPublication = false;

  attach(host: KeyboardNavigationControllerHost): void {
    this.detach();
    this.readPageSize = host.readPageSize;
    this.readWritingDirection = host.readWritingDirection;
    this.focusBodyCell = host.focusBodyCell ?? null;
    this.toggleRowSelection = host.toggleRowSelection ?? null;
    this.selectRow = host.selectRow ?? null;
    this.extendRowSelection = host.extendRowSelection ?? null;
    this.toggleAllRows = host.toggleAllRows ?? null;
    this.toggleColumnSelection = host.toggleColumnSelection ?? null;
    this.toggleSort = host.toggleSort ?? null;
    this.isCellEditing = host.isCellEditing ?? null;
    this.startCellEdit = host.startCellEdit ?? null;
    this.stopCellEdit = host.stopCellEdit ?? null;
    this.toggleBooleanCell = host.toggleBooleanCell ?? null;
    this.getBooleanCellKeyboardMode = host.getBooleanCellKeyboardMode ?? null;
    this.resolveTargetWidgetCount = host.resolveTargetWidgetCount ?? null;
    this.resolveTargetWidget = host.resolveTargetWidget ?? null;
    this.resolveHeaderWidgetCount = host.resolveHeaderWidgetCount ?? null;
    this.resolveHeaderWidget = host.resolveHeaderWidget ?? null;
    this.ensureFieldVisible = host.ensureFieldVisible ?? null;
    this.resolveTargetElement = host.resolveTargetElement ?? null;
    this.readPointerTarget = host.readPointerTarget ?? null;
    this.resolveColumnMenuTrigger = host.resolveColumnMenuTrigger ?? null;
    this.resolveDedicatedFilterTrigger = host.resolveDedicatedFilterTrigger ?? null;
    this.resolveResizeHandle = host.resolveResizeHandle ?? null;
    this.requestOpenColumnMenu = host.requestOpenColumnMenu ?? null;
    this.requestOpenCellMenu = host.requestOpenCellMenu ?? null;
    this.resolveVisibleCellMenuTrigger =
      host.resolveVisibleCellMenuTrigger ?? null;
    this.requestOpenRowAction = host.requestOpenRowAction ?? null;
    this.requestOpenDedicatedFilter = host.requestOpenDedicatedFilter ?? null;
    this.closeOpenPopup = host.closeOpenPopup ?? null;
    this.requestKeyboardTooltip = host.requestKeyboardTooltip ?? null;
    this.dismissKeyboardTooltip = host.dismissKeyboardTooltip ?? null;
    this.clearRowSelection = host.clearRowSelection ?? null;
    this.clearColumnSelection = host.clearColumnSelection ?? null;
    this.moveColumn = host.moveColumn ?? null;
    this.moveRow = host.moveRow ?? null;
    this.resizeColumn = host.resizeColumn ?? null;
    this.setExactFocusBindingActive =
      host.setExactFocusBindingActive ?? null;
    this.surface = host.surface ?? null;
    this.surface?.addEventListener("keydown", this.onKeyDown);
    this.surface?.addEventListener("pointerdown", this.onPointerDown);
    this.surface?.addEventListener("focus", this.onSurfaceFocus);
    this.surface?.addEventListener("focusin", this.onFocusIn);
    this.lifecycleOwner = {};
  }

  detach(): void {
    this.lifecycleOwner = {};
    this.setExternalBodyWidget(null);
    this.setActiveTargetElement(null);
    this.setKeyboardFocusModality(false);
    this.surface?.removeEventListener("keydown", this.onKeyDown);
    this.surface?.removeEventListener("pointerdown", this.onPointerDown);
    this.surface?.removeEventListener("focus", this.onSurfaceFocus);
    this.surface?.removeEventListener("focusin", this.onFocusIn);
    this.readPageSize = null;
    this.readWritingDirection = null;
    this.focusBodyCell = null;
    this.toggleRowSelection = null;
    this.selectRow = null;
    this.extendRowSelection = null;
    this.toggleAllRows = null;
    this.toggleColumnSelection = null;
    this.toggleSort = null;
    this.isCellEditing = null;
    this.startCellEdit = null;
    this.stopCellEdit = null;
    this.toggleBooleanCell = null;
    this.getBooleanCellKeyboardMode = null;
    this.resolveTargetWidgetCount = null;
    this.resolveTargetWidget = null;
    this.resolveHeaderWidgetCount = null;
    this.resolveHeaderWidget = null;
    this.ensureFieldVisible = null;
    this.resolveTargetElement = null;
    this.readPointerTarget = null;
    this.resolveColumnMenuTrigger = null;
    this.resolveDedicatedFilterTrigger = null;
    this.resolveResizeHandle = null;
    this.requestOpenColumnMenu = null;
    this.requestOpenCellMenu = null;
    this.resolveVisibleCellMenuTrigger = null;
    this.requestOpenRowAction = null;
    this.requestOpenDedicatedFilter = null;
    this.closeOpenPopup = null;
    this.requestKeyboardTooltip = null;
    this.dismissKeyboardTooltip = null;
    this.clearRowSelection = null;
    this.clearColumnSelection = null;
    this.moveColumn = null;
    this.moveRow = null;
    this.resizeColumn = null;
    this.surface = null;
    this.mode = "navigation";
    this.target.kind = "none";
    this.plan = null;
    this.navigationContext = null;
    this.rowLayout = EMPTY_ROW_LAYOUT;
    this.topologyRevision = 0;
    this.lastTopologyColumns = null;
    this.lastTopologyGroups = undefined;
    this.lastTopologyFloatingFilter = false;
    this.activeDispatchToken = 0;
    this.nextDispatchToken = 1;
    this.widgetIndex = -1;
    this.activeWidgetKind = null;
    this.retainedBodyWidgetCount = 0;
    this.widgetTargetElement = null;
    this.setActiveWidgetElement(null);
    this.suppressSurfaceFocusPublication = false;
    this.setExactFocusBindingActive?.(false);
    this.setExactFocusBindingActive = null;
  }

  syncTopology(input: KeyboardTopologyInput): KeyboardNavigationPlan {
    if (this.readPageSize === null) {
      throw new Error("Keyboard navigation controller is detached");
    }
    if (this.topologyRevision === Number.MAX_SAFE_INTEGER) {
      throw new Error("Keyboard navigation topology revision exhausted");
    }
    if (
      this.plan !== null &&
      this.lastTopologyColumns === input.columns &&
      this.lastTopologyGroups === input.columnGroupHeaders &&
      this.lastTopologyFloatingFilter === input.hasFloatingFilterRow
    ) {
      return this.plan;
    }
    const revision = this.topologyRevision + 1;
    const previousField = this.targetField();
    const plan = planKeyboardNavigationTopology({ ...input, topologyRevision: revision });
    this.topologyRevision = revision;
    this.plan = plan;
    this.lastTopologyColumns = input.columns;
    this.lastTopologyGroups = input.columnGroupHeaders;
    this.lastTopologyFloatingFilter = input.hasFloatingFilterRow;
    if (this.navigationContext === null) {
      this.navigationContext = {
        plan,
        rowLayout: this.rowLayout,
        pageSize: 1,
        writingDirection: "ltr",
      };
    } else {
      this.navigationContext.plan = plan;
    }
    this.restoreTargetColumn(previousField);
    return plan;
  }

  syncRowLayout(layout: VisualRowLayout): void {
    this.rowLayout = layout;
    if (this.navigationContext !== null) {
      this.navigationContext.rowLayout = layout;
    }
    this.restoreTargetRow();
  }

  syncFocusedBodyTarget(displayRowIndex: number, field: string): boolean {
    const plan = this.plan;
    if (this.readPageSize === null || plan === null) return false;
    const columnOrdinal = plan.columnOrdinalByField.get(field);
    if (columnOrdinal === undefined) return false;
    const visualRowIndex = keyboardVisualIndexOfDisplay(
      this.rowLayout,
      displayRowIndex,
    );
    if (
      !Number.isSafeInteger(visualRowIndex) ||
      visualRowIndex < 0 ||
      visualRowIndex >= keyboardVisualRowCount(this.rowLayout)
    ) {
      return false;
    }
    setBodyCellTarget(
      this.target,
      visualRowIndex,
      displayRowIndex,
      columnOrdinal,
    );
    return true;
  }

  syncRetainedBodyFocusPosition(
    displayRowIndex: number,
    field: string,
  ): void {
    if (
      this.target.kind !== "bodyCell" ||
      this.targetField() !== field ||
      this.target.displayRowIndex === displayRowIndex
    ) {
      return;
    }
    this.syncFocusedBodyTarget(displayRowIndex, field);
  }

  move(direction: KeyboardMoveDirection): KeyboardNavigationResult {
    const readPageSize = this.readPageSize;
    const readWritingDirection = this.readWritingDirection;
    const context = this.navigationContext;
    if (
      readPageSize === null ||
      readWritingDirection === null ||
      context === null
    ) {
      return KEYBOARD_NAVIGATION_UNCHANGED;
    }
    const token = this.mintDispatchToken();
    if (token === 0) return KEYBOARD_NAVIGATION_UNCHANGED;
    const lifecycleOwner = this.lifecycleOwner;
    this.activeDispatchToken = token;
    try {
      const result = this.resolveMoveWithinDispatch(
        direction,
        readPageSize,
        readWritingDirection,
        context,
        lifecycleOwner,
        token,
      );
      if (result.moved) {
        copyKeyboardTarget(this.target, this.navigationScratch.candidate);
      }
      return result;
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  syncResolvedActiveDescendant(): void {
    this.publishActiveDescendant(this.target);
  }

  syncExactFocusBinding(): void {
    const surface = this.surface;
    const plan = this.plan;
    if (surface === null || plan === null) return;

    if (this.mode === "widget") {
      const widget = this.resolveActiveWidget(this.widgetIndex);
      const targetElement = this.widgetTargetElement;
      if (
        widget !== null &&
        widget === this.activeWidgetElement &&
        widget.isConnected &&
        targetElement !== null &&
        isKeyboardTargetElementBound(targetElement, this.target, plan)
      ) {
        return;
      }
      this.invalidateRecycledWidgetBinding();
      return;
    }

    if (this.mode !== "navigation") return;

    const activeTarget = this.activeTargetElement;
    if (
      activeTarget !== null &&
      !isKeyboardTargetElementBound(activeTarget, this.target, plan)
    ) {
      this.clearPublishedActiveDescendant();
    }
  }

  /**
   * Synthetic K3 owner dispatch. Production key handling is added atomically
   * in K4; this method proves cached capability use and replacement safety.
   */
  publishBodyFocus(): boolean {
    const action = this.focusBodyCell;
    if (
      action === null ||
      this.target.kind !== "bodyCell" ||
      this.plan === null
    ) {
      return false;
    }
    const column = this.plan.columns[this.target.columnOrdinal];
    if (column === undefined) return false;
    const token = this.mintDispatchToken();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    this.activeDispatchToken = token;
    try {
      const accepted = action(this.target.displayRowIndex, column.field);
      return accepted && this.ownsDispatch(lifecycleOwner, token);
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  toggleTargetRowSelection(): boolean {
    return this.dispatchBodyAction(this.toggleRowSelection);
  }

  toggleAllRowSelection(): boolean {
    return this.dispatchScalarAction(this.toggleAllRows);
  }

  toggleTargetColumnSelection(): boolean {
    const action = this.toggleColumnSelection;
    const field = this.targetField();
    if (action === null || field === null) return false;
    return this.dispatchFieldAction(action, field);
  }

  toggleTargetSort(multi: boolean): boolean {
    const action = this.toggleSort;
    if (action === null || this.target.kind !== "leafHeader" || this.plan === null) {
      return false;
    }
    const column = this.plan.columns[this.target.columnOrdinal];
    if (column === undefined) return false;
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      const accepted = action(column.field, multi);
      return accepted && this.ownsDispatch(lifecycleOwner, token);
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  setMode(mode: KeyboardInteractionMode): void {
    this.mode = mode;
    this.updateExactFocusBindingActivity();
  }

  getMode(): KeyboardInteractionMode {
    return this.mode;
  }

  getTarget(): Readonly<KeyboardTargetState> {
    return this.target;
  }

  getPlan(): KeyboardNavigationPlan | null {
    return this.plan;
  }

  writeBodyTargetFromDisplayIndex(
    displayRowIndex: number,
    field: string,
    out: KeyboardTargetState,
  ): boolean {
    const plan = this.plan;
    const sourceOrdinal = plan?.columnOrdinalByField.get(field);
    if (
      plan === null ||
      sourceOrdinal === undefined ||
      !Number.isSafeInteger(displayRowIndex) ||
      displayRowIndex < 0
    ) {
      return false;
    }
    const ordinal = bodyDataColumnOrdinalForPointer(plan, sourceOrdinal);
    if (ordinal < 0) return false;
    const visualRowIndex = keyboardVisualIndexOfDisplay(
      this.rowLayout,
      displayRowIndex,
    );
    const rowCount = keyboardVisualRowCount(this.rowLayout);
    if (
      visualRowIndex < 0 ||
      visualRowIndex >= rowCount ||
      keyboardDisplayIndexAtVisual(this.rowLayout, visualRowIndex) !==
        displayRowIndex
    ) {
      return false;
    }
    setBodyCellTarget(
      out,
      visualRowIndex,
      displayRowIndex,
      ordinal,
    );
    return true;
  }

  clearTarget(): void {
    clearKeyboardTarget(this.target);
    this.publishActiveDescendant(this.target);
  }

  private targetField(): string | null {
    const plan = this.plan;
    if (plan === null || this.target.kind === "none") return null;
    const ordinal = this.target.kind === "groupHeader"
      ? this.target.anchorColumnOrdinal
      : this.target.columnOrdinal;
    return plan.columns[ordinal]?.field ?? null;
  }

  private restoreTargetColumn(field: string | null): void {
    const plan = this.plan;
    if (field === null || plan === null || this.target.kind === "none") return;
    const ordinal = plan.columnOrdinalByField.get(field);
    if (ordinal === undefined) {
      clearKeyboardTarget(this.target);
      return;
    }
    if (this.target.kind !== "groupHeader") {
      this.target.columnOrdinal = ordinal;
      return;
    }
    const row = plan.groupRows[this.target.level];
    if (row === undefined) {
      this.target.kind = "leafHeader";
      this.target.columnOrdinal = ordinal;
      return;
    }
    let low = 0;
    let high = row.spans.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const span = row.spans[middle]!;
      if (ordinal < span.startColumnOrdinal) high = middle - 1;
      else if (ordinal > span.endColumnOrdinal) low = middle + 1;
      else {
        this.target.spanIndex = middle;
        this.target.anchorColumnOrdinal = ordinal;
        return;
      }
    }
    this.target.kind = "leafHeader";
    this.target.columnOrdinal = ordinal;
  }

  private restoreTargetRow(): void {
    if (this.target.kind !== "bodyCell") return;
    const visualRowIndex = keyboardVisualIndexOfDisplay(
      this.rowLayout,
      this.target.displayRowIndex,
    );
    if (
      visualRowIndex < 0 ||
      visualRowIndex >= keyboardVisualRowCount(this.rowLayout)
    ) {
      clearKeyboardTarget(this.target);
      return;
    }
    this.target.visualRowIndex = visualRowIndex;
  }

  private mintDispatchToken(): number {
    if (this.nextDispatchToken === Number.MAX_SAFE_INTEGER) {
      if (this.activeDispatchToken !== 0) return 0;
      this.nextDispatchToken = 1;
    }
    const token = this.nextDispatchToken;
    this.nextDispatchToken = token + 1;
    return token;
  }

  private beginDispatch(): number {
    const token = this.mintDispatchToken();
    if (token !== 0) this.activeDispatchToken = token;
    return token;
  }

  private resolveMoveWithinDispatch(
    direction: KeyboardMoveDirection,
    readPageSize: () => number,
    readWritingDirection: () => KeyboardWritingDirection,
    context: KeyboardNavigationContext,
    lifecycleOwner: object,
    token: number,
  ): KeyboardNavigationResult {
    const pageSize = readPageSize();
    if (!this.ownsDispatch(lifecycleOwner, token)) {
      return KEYBOARD_NAVIGATION_UNCHANGED;
    }
    const writingDirection = readWritingDirection();
    if (!this.ownsDispatch(lifecycleOwner, token)) {
      return KEYBOARD_NAVIGATION_UNCHANGED;
    }
    context.pageSize = pageSize;
    context.writingDirection = writingDirection;
    const result = resolveKeyboardNavigationTarget(
      this.target,
      direction,
      context,
      this.navigationScratch,
    );
    return this.ownsDispatch(lifecycleOwner, token)
      ? result
      : KEYBOARD_NAVIGATION_UNCHANGED;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.surface === null) return;
    const ownedWidgetEscape =
      this.mode === "widget" && event.key === "Escape";
    if (event.defaultPrevented && !ownedWidgetEscape) return;

    if (
      !event.defaultPrevented &&
      event.key === "Escape" &&
      this.closeOpenPopup?.() === true
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (this.isCellEditing?.() === true) {
      this.mode = "edit";
      this.handleEditModeKey(event);
      return;
    }
    if (this.mode === "edit") this.mode = "navigation";
    if (this.mode === "widget") {
      this.handleWidgetModeKey(event);
      return;
    }
    if (event.target !== this.surface) return;

    if (this.handleNavigationCommand(event)) {
      this.revealKeyboardFocusRing();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.altKey || event.shiftKey) return;
    const ctrlOrMeta = event.ctrlKey || event.metaKey;
    if (ctrlOrMeta && event.key !== "Home" && event.key !== "End") return;
    const intent = resolveKeyboardNavigationIntent(event.key, ctrlOrMeta);
    if (intent.type === "none") return;
    const readPageSize = this.readPageSize;
    const readWritingDirection = this.readWritingDirection;
    const context = this.navigationContext;
    if (
      readPageSize === null ||
      readWritingDirection === null ||
      context === null
    ) {
      return;
    }
    const token = this.beginDispatch();
    if (token === 0) return;
    const lifecycleOwner = this.lifecycleOwner;
    const hadValidTarget = this.target.kind !== "none" &&
      this.fieldForTarget(this.target) !== null;
    try {
      const result = this.resolveMoveWithinDispatch(
        intent.direction,
        readPageSize,
        readWritingDirection,
        context,
        lifecycleOwner,
        token,
      );
      if (!result.moved) {
        if (hadValidTarget && this.ownsDispatch(lifecycleOwner, token)) {
          this.revealKeyboardFocusRing();
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      const candidate = this.navigationScratch.candidate;
      if (!this.publishCandidate(candidate, lifecycleOwner, token)) return;
      copyKeyboardTarget(this.target, candidate);
      this.publishActiveDescendant(this.target);
      this.scheduleTargetTooltip();
      this.revealKeyboardFocusRing();
      event.preventDefault();
      event.stopPropagation();
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  };

  private handleNavigationCommand(event: KeyboardEvent): boolean {
    const ctrlOrMeta = event.ctrlKey || event.metaKey;
    const noAlt = !event.altKey;
    if (event.key === "Escape") {
      return this.dismissTooltipOrClearSelection();
    }
    if (isPopupOpenKey(event)) {
      return this.openTargetPopup();
    }
    if (
      this.target.kind === "floatingFilter" &&
      !event.altKey &&
      !event.shiftKey &&
      !ctrlOrMeta &&
      (event.key === "Enter" || isSpaceKey(event.key))
    ) {
      return this.openTargetDedicatedFilter();
    }
    if (
      this.target.kind === "leafHeader" &&
      event.altKey &&
      event.shiftKey &&
      !ctrlOrMeta &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      return this.resizeTargetColumn(
        event.key === "ArrowLeft" ? -10 : 10,
      );
    }
    if (
      this.target.kind === "leafHeader" &&
      ctrlOrMeta &&
      event.shiftKey &&
      !event.altKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      const visualDelta = event.key === "ArrowLeft" ? -1 : 1;
      return this.moveTargetColumn(
        this.readWritingDirection?.() === "rtl"
          ? (visualDelta === -1 ? 1 : -1)
          : visualDelta,
      );
    }
    if (
      this.target.kind === "bodyCell" &&
      event.altKey &&
      event.shiftKey &&
      !ctrlOrMeta &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      return this.moveTargetRow(event.key === "ArrowUp" ? -1 : 1);
    }
    if (
      (this.target.kind === "leafHeader" ||
        this.target.kind === "floatingFilter") &&
      !event.altKey &&
      !event.shiftKey &&
      !ctrlOrMeta &&
      event.key === "F2"
    ) {
      return this.enterHeaderWidget();
    }
    if (
      noAlt &&
      ctrlOrMeta &&
      !event.shiftKey &&
      (event.key === "a" || event.key === "A")
    ) {
      return this.toggleAllRowSelection();
    }
    if (
      noAlt &&
      ctrlOrMeta &&
      !event.shiftKey &&
      isSpaceKey(event.key)
    ) {
      return this.toggleTargetColumnSelection();
    }

    if (
      noAlt &&
      !ctrlOrMeta &&
      event.shiftKey &&
      this.target.kind === "bodyCell"
    ) {
      if (isSpaceKey(event.key)) return this.selectTargetRow();
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        return this.extendTargetRowSelection(
          event.key === "ArrowUp" ? "up" : "down",
        );
      }
    }

    if (
      noAlt &&
      !ctrlOrMeta &&
      this.target.kind === "leafHeader" &&
      (event.key === "Enter" || (!event.shiftKey && isSpaceKey(event.key)))
    ) {
      const column = this.plan?.columns[this.target.columnOrdinal]?.column;
      if (column && isSelectionHostColumn(column)) {
        return this.toggleAllRowSelection();
      }
      return this.toggleTargetSort(event.shiftKey && event.key === "Enter");
    }

    if (
      noAlt &&
      !ctrlOrMeta &&
      !event.shiftKey &&
      this.target.kind === "bodyCell"
    ) {
      if (isSpaceKey(event.key)) {
        if (this.toggleTargetRowSelection()) return true;
        return this.toggleTargetBooleanCell();
      }
      if (event.key === "F2") {
        return this.enterTargetWidget() ||
          this.startTargetInteraction(undefined, false);
      }
      if (event.key === "Enter") {
        return this.startTargetInteraction(undefined, true);
      }
      if (event.key.length === 1) {
        return this.startTargetInteraction(event.key, false);
      }
    }
    return false;
  }

  private selectTargetRow(): boolean {
    return this.dispatchBodyAction(this.selectRow);
  }

  private extendTargetRowSelection(direction: "up" | "down"): boolean {
    const action = this.extendRowSelection;
    const readPageSize = this.readPageSize;
    const readWritingDirection = this.readWritingDirection;
    const context = this.navigationContext;
    if (
      action === null ||
      readPageSize === null ||
      readWritingDirection === null ||
      context === null ||
      this.target.kind !== "bodyCell"
    ) {
      return false;
    }
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      const previousDisplayRowIndex = this.target.displayRowIndex;
      const result = this.resolveMoveWithinDispatch(
        direction,
        readPageSize,
        readWritingDirection,
        context,
        lifecycleOwner,
        token,
      );
      const candidate = this.navigationScratch.candidate;
      if (!result.moved || candidate.kind !== "bodyCell") return false;
      if (
        !action(previousDisplayRowIndex, candidate.displayRowIndex) ||
        !this.ownsDispatch(lifecycleOwner, token) ||
        !this.publishCandidate(candidate, lifecycleOwner, token)
      ) {
        return false;
      }
      copyKeyboardTarget(this.target, candidate);
      this.publishActiveDescendant(this.target);
      this.scheduleTargetTooltip();
      return true;
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private startTargetInteraction(
    charSeed: string | undefined,
    allowWidget: boolean,
  ): boolean {
    const startCellEdit = this.startCellEdit;
    const resolveTargetElement = this.resolveTargetElement;
    const plan = this.plan;
    if (
      startCellEdit === null ||
      resolveTargetElement === null ||
      plan === null ||
      this.target.kind !== "bodyCell"
    ) {
      return allowWidget && this.enterTargetWidget();
    }
    const field = plan.columns[this.target.columnOrdinal]?.field;
    if (field === undefined) return false;
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      if (
        allowWidget &&
        this.getBooleanCellKeyboardMode?.(
          this.target.displayRowIndex,
          field,
        ) === "toggle"
      ) {
        if (!this.ownsDispatch(lifecycleOwner, token)) return false;
        return this.enterTargetWidgetWithinDispatch(
          field,
          lifecycleOwner,
          token,
        );
      }
      const cellElement = resolveTargetElement(this.target);
      if (cellElement === null || !cellElement.isConnected) return false;
      const started = startCellEdit(
        this.target.displayRowIndex,
        field,
        cellElement,
        charSeed,
      );
      if (!started || !this.ownsDispatch(lifecycleOwner, token)) {
        return allowWidget && this.ownsDispatch(lifecycleOwner, token)
          ? this.enterTargetWidgetWithinDispatch(field, lifecycleOwner, token)
          : false;
      }
      this.mode = "edit";
      this.widgetIndex = -1;
      this.activeWidgetKind = null;
      this.publishActiveDescendant(this.target);
      return true;
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private enterTargetWidget(): boolean {
    const field = this.targetField();
    if (field === null || this.target.kind !== "bodyCell") return false;
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      return this.enterTargetWidgetWithinDispatch(field, lifecycleOwner, token);
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private toggleTargetBooleanCell(): boolean {
    const readMode = this.getBooleanCellKeyboardMode;
    const toggle = this.toggleBooleanCell;
    const field = this.targetField();
    if (
      readMode === null ||
      toggle === null ||
      field === null ||
      this.target.kind !== "bodyCell"
    ) {
      return false;
    }
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      const mode = readMode(this.target.displayRowIndex, field);
      if (!this.ownsDispatch(lifecycleOwner, token) || mode === null) {
        return false;
      }
      if (mode === "edit") return true;
      toggle(this.target.displayRowIndex, field);
      return this.ownsDispatch(lifecycleOwner, token);
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private enterTargetWidgetWithinDispatch(
    field: string,
    lifecycleOwner: object,
    token: number,
  ): boolean {
    if (this.target.kind !== "bodyCell") return false;
    this.setExternalBodyWidget(null);
    this.retainedBodyWidgetCount = 0;
    const retainedCount = this.resolveTargetWidgetCount?.(
      this.target.displayRowIndex,
      field,
    ) ?? 0;
    if (
      !this.ownsDispatch(lifecycleOwner, token) ||
      !Number.isSafeInteger(retainedCount) ||
      retainedCount < 0
    ) {
      return false;
    }
    const cell = this.resolveTargetElement?.(this.target) ?? null;
    if (!this.ownsDispatch(lifecycleOwner, token)) return false;
    const external = cell === null
      ? null
      : (this.resolveVisibleCellMenuTrigger?.(
          this.target.displayRowIndex,
          field,
          cell,
        ) ?? null);
    if (!this.ownsDispatch(lifecycleOwner, token)) return false;
    this.retainedBodyWidgetCount = retainedCount;
    this.setExternalBodyWidget(external);
    const count = this.retainedBodyWidgetCount + (external === null ? 0 : 1);
    if (count < 1) return false;
    const first = this.findEnabledWidgetIndexWithinDispatch(
      count,
      0,
      1,
      lifecycleOwner,
      token,
    );
    const focused = first >= 0 && this.focusWidgetWithinDispatch(
        first,
        "body",
        lifecycleOwner,
        token,
      );
    if (!focused && this.ownsDispatch(lifecycleOwner, token)) {
      this.setExternalBodyWidget(null);
      this.retainedBodyWidgetCount = 0;
    }
    return focused;
  }

  private handleEditModeKey(event: KeyboardEvent): void {
    if (event.key !== "Enter" && event.key !== "Escape" && event.key !== "Tab") {
      return;
    }
    const stopCellEdit = this.stopCellEdit;
    if (stopCellEdit === null) return;
    const token = this.beginDispatch();
    if (token === 0) return;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      const commit = event.key !== "Escape";
      const stopped = stopCellEdit(commit);
      if (!this.ownsDispatch(lifecycleOwner, token)) return;
      if (!stopped) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.mode = "navigation";
      this.widgetIndex = -1;
      this.activeWidgetKind = null;
      if (event.key === "Tab") {
        if (this.moveAfterEditTab(event.shiftKey, lifecycleOwner, token)) {
          event.preventDefault();
          event.stopPropagation();
        } else {
          this.publishActiveDescendant(this.target);
        }
        return;
      }
      this.restoreSurfaceFocus();
      event.preventDefault();
      event.stopPropagation();
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private moveAfterEditTab(
    backwards: boolean,
    lifecycleOwner: object,
    token: number,
  ): boolean {
    const plan = this.plan;
    if (plan === null || this.target.kind !== "bodyCell") return false;
    const currentOrdinal = this.target.columnOrdinal;
    const nextOrdinal = backwards
      ? plan.previousDataColumnOrdinal[currentOrdinal]
      : plan.nextDataColumnOrdinal[currentOrdinal];
    if (nextOrdinal === undefined || nextOrdinal < 0) return false;
    const candidate = this.navigationScratch.candidate;
    setBodyCellTarget(
      candidate,
      this.target.visualRowIndex,
      this.target.displayRowIndex,
      nextOrdinal,
    );
    if (!this.publishCandidate(candidate, lifecycleOwner, token)) return false;
    copyKeyboardTarget(this.target, candidate);
    this.restoreSurfaceFocus();
    this.scheduleTargetTooltip();
    return true;
  }

  private handleWidgetModeKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.exitWidgetMode();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const activeWidget = this.resolveActiveWidget(this.widgetIndex);
    if (isPopupOpenKey(event)) {
      if (this.activateWidgetPopup(activeWidget)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (
      this.isActiveResizeWidget(activeWidget) &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      if (this.resizeTargetColumn(event.key === "ArrowLeft" ? -10 : 10)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.key !== "Tab") return;
    const count = this.resolveActiveWidgetCount();
    const step = event.shiftKey ? -1 : 1;
    const nextIndex = this.findEnabledWidgetIndex(count, this.widgetIndex + step, step);
    if (nextIndex < 0) this.exitWidgetMode();
    else this.focusWidget(nextIndex);
    event.preventDefault();
    event.stopPropagation();
  }

  private exitWidgetMode(): void {
    this.leaveWidgetMode();
    this.restoreSurfaceFocus();
  }

  private leaveWidgetMode(): void {
    this.syncWidgetTabStop(this.activeWidgetElement, false);
    this.mode = "navigation";
    this.widgetIndex = -1;
    this.activeWidgetKind = null;
    this.setExternalBodyWidget(null);
    this.retainedBodyWidgetCount = 0;
    this.widgetTargetElement = null;
    this.setActiveWidgetElement(null);
    this.updateExactFocusBindingActivity();
  }

  private restoreSurfaceFocus(): void {
    this.setKeyboardFocusModality(true);
    this.surface?.focus(FOCUS_KEYBOARD_VISIBLE);
    this.publishActiveDescendant(this.target);
  }

  /**
   * After pointer focus suppressed `:focus-visible`, the first consumed
   * navigation key reveals the keyboard active-target ring. Re-focusing an
   * already-focused surface does not re-enable `:focus-visible` in Chromium,
   * so modality is also tracked with an owned class.
   */
  private revealKeyboardFocusRing(): void {
    const surface = this.surface;
    if (surface === null) return;
    if (surface.ownerDocument.activeElement !== surface) return;
    this.setKeyboardFocusModality(true);
    this.suppressSurfaceFocusPublication = true;
    try {
      surface.focus(FOCUS_KEYBOARD_VISIBLE);
    } finally {
      this.suppressSurfaceFocusPublication = false;
    }
  }

  private setKeyboardFocusModality(active: boolean): void {
    const surface = this.surface;
    if (surface === null) return;
    try {
      if (active) surface.classList.add(KEYBOARD_FOCUS_CLASS);
      else surface.classList.remove(KEYBOARD_FOCUS_CLASS);
    } catch {
      // Visual modality cannot invalidate retained logical target state.
    }
  }

  private openTargetPopup(): boolean {
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      return this.openTargetPopupWithinDispatch(lifecycleOwner, token);
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private openTargetPopupWithinDispatch(
    lifecycleOwner: object,
    token: number,
  ): boolean {
    if (this.target.kind === "bodyCell") {
      const field = this.targetField();
      const cell = this.resolveTargetElement?.(this.target) ?? null;
      const surface = this.surface;
      if (
        field === null ||
        cell === null ||
        surface === null ||
        !this.ownsDispatch(lifecycleOwner, token)
      ) {
        return false;
      }

      const rowActionTrigger = this.resolveTargetWidget?.(
        this.target.displayRowIndex,
        field,
        0,
      ) ?? null;
      const rowAction = this.requestOpenRowAction;
      if (
        rowActionTrigger !== null &&
        rowAction !== null &&
        this.ownsDispatch(lifecycleOwner, token)
      ) {
        const accepted = rowAction(
          this.target.displayRowIndex,
          field,
          rowActionTrigger,
          surface,
        );
        if (accepted) return this.ownsDispatch(lifecycleOwner, token);
        if (!this.ownsDispatch(lifecycleOwner, token)) return false;
      }

      const cellMenu = this.requestOpenCellMenu;
      if (cellMenu === null) return false;
      const accepted = cellMenu(
        this.target.displayRowIndex,
        field,
        cell,
        surface,
      );
      return accepted && this.ownsDispatch(lifecycleOwner, token);
    }
    if (this.target.kind === "floatingFilter") {
      return this.openTargetDedicatedFilterWithinDispatch(
        lifecycleOwner,
        token,
      );
    }
    const field = this.targetField();
    if (field === null) return false;
    const trigger = this.resolveColumnMenuTrigger?.(field) ?? null;
    const action = this.requestOpenColumnMenu;
    if (
      trigger === null ||
      action === null ||
      !this.ownsDispatch(lifecycleOwner, token)
    ) {
      return false;
    }
    const accepted = action(field, trigger);
    return accepted && this.ownsDispatch(lifecycleOwner, token);
  }

  private openTargetDedicatedFilter(): boolean {
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      return this.openTargetDedicatedFilterWithinDispatch(
        lifecycleOwner,
        token,
      );
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private openTargetDedicatedFilterWithinDispatch(
    lifecycleOwner: object,
    token: number,
  ): boolean {
    const field = this.targetField();
    if (field === null) return false;
    const trigger = this.resolveDedicatedFilterTrigger?.(field) ?? null;
    const action = this.requestOpenDedicatedFilter;
    if (
      trigger === null ||
      action === null ||
      !this.ownsDispatch(lifecycleOwner, token)
    ) {
      return false;
    }
    const accepted = action(field, trigger);
    return accepted && this.ownsDispatch(lifecycleOwner, token);
  }

  private moveTargetColumn(visualDelta: -1 | 1): boolean {
    const field = this.targetField();
    const action = this.moveColumn;
    if (field === null || action === null) return false;
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      const accepted = action(field, visualDelta);
      return accepted && this.ownsDispatch(lifecycleOwner, token);
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private resizeTargetColumn(deltaPx: number): boolean {
    const field = this.targetField();
    const action = this.resizeColumn;
    if (field === null || action === null) return false;
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      const accepted = action(field, deltaPx);
      return accepted && this.ownsDispatch(lifecycleOwner, token);
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private moveTargetRow(visualDelta: -1 | 1): boolean {
    if (this.target.kind !== "bodyCell") return false;
    const topCount = this.rowLayout.topDisplayIndexes.length;
    const centerStart = topCount;
    const centerEnd = centerStart + this.rowLayout.centerRowCount;
    const currentVisual = this.target.visualRowIndex;
    const nextVisual = currentVisual + visualDelta;
    if (
      currentVisual < centerStart ||
      currentVisual >= centerEnd ||
      nextVisual < centerStart ||
      nextVisual >= centerEnd
    ) {
      return false;
    }
    const adjacentDisplayRowIndex = keyboardDisplayIndexAtVisual(
      this.rowLayout,
      nextVisual,
    );
    const action = this.moveRow;
    if (action === null) return false;
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      const accepted = action(
        this.target.displayRowIndex,
        adjacentDisplayRowIndex,
      );
      return accepted && this.ownsDispatch(lifecycleOwner, token);
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private enterHeaderWidget(): boolean {
    const field = this.targetField();
    if (
      field === null ||
      (this.target.kind !== "leafHeader" &&
        this.target.kind !== "floatingFilter")
    ) return false;
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      this.setExternalBodyWidget(null);
      this.retainedBodyWidgetCount = 0;
      const count = this.resolveHeaderWidgetCount?.(this.target.kind, field) ?? 0;
      if (!this.ownsDispatch(lifecycleOwner, token)) return false;
      const first = this.findEnabledWidgetIndexWithinDispatch(
        count,
        0,
        1,
        lifecycleOwner,
        token,
      );
      if (first >= 0) {
        return this.focusWidgetWithinDispatch(
          first,
          "header",
          lifecycleOwner,
          token,
        );
      }
      const handle = this.target.kind === "leafHeader"
        ? (this.resolveResizeHandle?.(field) ?? null)
        : null;
      if (!this.isEnabledWidget(handle) || !this.ownsDispatch(lifecycleOwner, token)) {
        return false;
      }
      this.mode = "widget";
      this.widgetIndex = 0;
      this.activeWidgetKind = "header";
      this.publishActiveDescendant(this.target);
      this.syncWidgetTabStop(handle, true);
      handle.focus(FOCUS_PREVENT_SCROLL);
      return this.ownsDispatch(lifecycleOwner, token);
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private resolveActiveWidgetCount(): number {
    const field = this.targetField();
    if (field === null) return 0;
    if (this.activeWidgetKind === "body" && this.target.kind === "bodyCell") {
      return this.retainedBodyWidgetCount +
        (this.externalBodyWidget === null ? 0 : 1);
    }
    if (
      this.activeWidgetKind === "header" &&
      (this.target.kind === "leafHeader" ||
        this.target.kind === "floatingFilter")
    ) {
      const count = this.resolveHeaderWidgetCount?.(this.target.kind, field) ?? 0;
      return count > 0 ? count : this.target.kind === "leafHeader" ? 1 : 0;
    }
    return 0;
  }

  private resolveActiveWidget(index: number): HTMLElement | null {
    if (index < 0) return null;
    const field = this.targetField();
    if (field === null) return null;
    if (this.activeWidgetKind === "body" && this.target.kind === "bodyCell") {
      if (index < this.retainedBodyWidgetCount) {
        return this.resolveTargetWidget?.(
          this.target.displayRowIndex,
          field,
          index,
        ) ?? null;
      }
      return index === this.retainedBodyWidgetCount
        ? this.externalBodyWidget
        : null;
    }
    if (
      this.activeWidgetKind === "header" &&
      (this.target.kind === "leafHeader" ||
        this.target.kind === "floatingFilter")
    ) {
      const widget = this.resolveHeaderWidget?.(
        this.target.kind,
        field,
        index,
      ) ?? null;
      return widget ?? (
        this.target.kind === "leafHeader" && index === 0
          ? (this.resolveResizeHandle?.(field) ?? null)
          : null
      );
    }
    return null;
  }

  private isEnabledWidget(widget: HTMLElement | null): widget is HTMLElement {
    return widget !== null &&
      widget.isConnected &&
      !widget.hidden &&
      widget.style.display !== "none" &&
      !widget.hasAttribute("disabled") &&
      widget.getAttribute("aria-disabled") !== "true";
  }

  private findEnabledWidgetIndex(
    count: number,
    start: number,
    step: -1 | 1,
  ): number {
    for (let index = start; index >= 0 && index < count; index += step) {
      if (this.isEnabledWidget(this.resolveActiveWidget(index))) return index;
    }
    return -1;
  }

  private findEnabledWidgetIndexWithinDispatch(
    count: number,
    start: number,
    step: -1 | 1,
    lifecycleOwner: object,
    token: number,
  ): number {
    for (let index = start; index >= 0 && index < count; index += step) {
      const widget = this.resolveCandidateWidget(index);
      if (!this.ownsDispatch(lifecycleOwner, token)) return -1;
      if (this.isEnabledWidget(widget)) return index;
    }
    return -1;
  }

  private resolveCandidateWidget(index: number): HTMLElement | null {
    const field = this.targetField();
    if (field === null) return null;
    if (this.target.kind === "bodyCell") {
      if (index < this.retainedBodyWidgetCount) {
        return this.resolveTargetWidget?.(
          this.target.displayRowIndex,
          field,
          index,
        ) ?? null;
      }
      return index === this.retainedBodyWidgetCount
        ? this.externalBodyWidget
        : null;
    }
    if (
      this.target.kind === "leafHeader" ||
      this.target.kind === "floatingFilter"
    ) {
      return this.resolveHeaderWidget?.(this.target.kind, field, index) ?? null;
    }
    return null;
  }

  private focusWidgetWithinDispatch(
    index: number,
    kind: "body" | "header",
    lifecycleOwner: object,
    token: number,
  ): boolean {
    if (!this.ownsDispatch(lifecycleOwner, token)) return false;
    this.activeWidgetKind = kind;
    const widget = this.resolveActiveWidget(index);
    if (!this.isEnabledWidget(widget) || !this.ownsDispatch(lifecycleOwner, token)) {
      this.activeWidgetKind = null;
      return false;
    }
    this.mode = "widget";
    this.widgetIndex = index;
    this.setActiveWidgetElement(widget);
    this.widgetTargetElement =
      this.resolveTargetElement?.(this.target) ?? null;
    this.publishActiveDescendant(this.target);
    const count = this.resolveActiveWidgetCount();
    for (let candidateIndex = 0; candidateIndex < count; candidateIndex += 1) {
      this.syncWidgetTabStop(
        this.resolveActiveWidget(candidateIndex),
        candidateIndex === index,
      );
    }
    if (!this.ownsDispatch(lifecycleOwner, token)) return false;
    widget.focus(FOCUS_PREVENT_SCROLL);
    return this.ownsDispatch(lifecycleOwner, token);
  }

  private focusWidget(index: number): void {
    const previous = this.resolveActiveWidget(this.widgetIndex);
    const next = this.resolveActiveWidget(index);
    if (!this.isEnabledWidget(next)) {
      this.exitWidgetMode();
      return;
    }
    this.syncWidgetTabStop(previous, false);
    this.widgetIndex = index;
    this.setActiveWidgetElement(next);
    this.syncWidgetTabStop(next, true);
    next.focus(FOCUS_PREVENT_SCROLL);
  }

  private syncWidgetTabStop(widget: HTMLElement | null, active: boolean): void {
    if (widget === null) return;
    widget.tabIndex = active ? 0 : -1;
    if (widget.classList.contains("lfg-resize-handle")) {
      if (active) widget.removeAttribute("aria-hidden");
      else widget.setAttribute("aria-hidden", "true");
    }
  }

  private activateWidgetPopup(widget: HTMLElement | null): boolean {
    if (
      !this.isEnabledWidget(widget) ||
      !widget.hasAttribute("aria-haspopup") ||
      widget.getAttribute("aria-haspopup") === "false"
    ) {
      return false;
    }
    widget.click();
    return widget.getAttribute("aria-expanded") === "true" ||
      widget.ownerDocument.activeElement !== widget;
  }

  private setExternalBodyWidget(widget: HTMLElement | null): void {
    if (this.externalBodyWidget === widget) return;
    this.externalBodyWidget?.removeEventListener("keydown", this.onKeyDown);
    this.externalBodyWidget = widget;
    widget?.addEventListener("keydown", this.onKeyDown);
  }

  private setActiveWidgetElement(widget: HTMLElement | null): void {
    if (this.activeWidgetElement === widget) {
      this.activeWidgetFocusDeparted = false;
      return;
    }
    this.activeWidgetElement?.removeEventListener(
      "focusout",
      this.onActiveWidgetFocusOut,
    );
    this.activeWidgetElement?.removeEventListener(
      "focus",
      this.onActiveWidgetFocus,
    );
    this.activeWidgetElement = widget;
    this.activeWidgetFocusDeparted = false;
    widget?.addEventListener("focusout", this.onActiveWidgetFocusOut);
    widget?.addEventListener("focus", this.onActiveWidgetFocus);
  }

  private readonly onActiveWidgetFocus = (): void => {
    this.activeWidgetFocusDeparted = false;
  };

  private readonly onActiveWidgetFocusOut = (event: FocusEvent): void => {
    if (event.target !== this.activeWidgetElement) return;
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && relatedTarget.isConnected) {
      this.activeWidgetFocusDeparted = true;
    }
  };

  private isActiveResizeWidget(widget: HTMLElement | null): boolean {
    if (widget === null || this.target.kind !== "leafHeader") return false;
    if (widget.classList.contains("lfg-resize-handle")) return true;
    const field = this.targetField();
    return field !== null && this.resolveResizeHandle?.(field) === widget;
  }

  private dismissTooltipOrClearSelection(): boolean {
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      const dismiss = this.dismissKeyboardTooltip;
      if (dismiss !== null) {
        const dismissed = dismiss();
        if (!this.ownsDispatch(lifecycleOwner, token)) return false;
        if (dismissed) return true;
      }
      let cleared = false;
      const clearRows = this.clearRowSelection;
      if (clearRows !== null) {
        cleared = clearRows();
        if (!this.ownsDispatch(lifecycleOwner, token)) return false;
      }
      const clearColumns = this.clearColumnSelection;
      if (clearColumns !== null) {
        const columnsCleared = clearColumns();
        if (!this.ownsDispatch(lifecycleOwner, token)) return false;
        cleared = cleared || columnsCleared;
      }
      return cleared;
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private scheduleTargetTooltip(): void {
    const element = this.resolveTargetElement?.(this.target) ?? null;
    this.requestKeyboardTooltip?.(element);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const readPointerTarget = this.readPointerTarget;
    if (readPointerTarget === null) return;
    const candidate = this.navigationScratch.candidate;
    if (!readPointerTarget(event.target, candidate)) return;
    this.setKeyboardFocusModality(false);
    const activeWidget = this.mode === "widget"
      ? this.resolveActiveWidget(this.widgetIndex)
      : null;
    const pointerNode = event.target instanceof Node ? event.target : null;
    if (
      activeWidget !== null &&
      pointerNode !== activeWidget &&
      !activeWidget.contains(pointerNode)
    ) {
      this.leaveWidgetMode();
    }
    copyKeyboardTarget(this.target, candidate);
    this.publishActiveDescendant(this.target);
    this.scheduleTargetTooltip();
  };

  private readonly onSurfaceFocus = (): void => {
    if (this.suppressSurfaceFocusPublication) return;
    if (this.mode === "widget") this.leaveWidgetMode();
    // Do not force keyboard modality here: pointer-driven surface.focus() also
    // fires this handler, and Chromium keeps `:focus-visible` false for that
    // path. Tab entry relies on native `:focus-visible`; arrows call
    // revealKeyboardFocusRing().
    if (this.target.kind !== "none") {
      this.publishActiveDescendant(this.target);
      return;
    }
    const readPageSize = this.readPageSize;
    const readWritingDirection = this.readWritingDirection;
    const context = this.navigationContext;
    if (
      readPageSize === null ||
      readWritingDirection === null ||
      context === null
    ) {
      return;
    }
    const token = this.beginDispatch();
    if (token === 0) return;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      const result = this.resolveMoveWithinDispatch(
        "firstTarget",
        readPageSize,
        readWritingDirection,
        context,
        lifecycleOwner,
        token,
      );
      const candidate = this.navigationScratch.candidate;
      if (
        !result.moved ||
        !this.publishCandidate(candidate, lifecycleOwner, token)
      ) {
        return;
      }
      copyKeyboardTarget(this.target, candidate);
      this.publishActiveDescendant(this.target);
      this.scheduleTargetTooltip();
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    const surface = this.surface;
    if (surface === null || event.target === surface) return;
    if (this.isCellEditing?.() === true || this.mode === "edit") return;
    const view = surface.ownerDocument.defaultView;
    const HTMLElementCtor = view?.HTMLElement;
    if (
      HTMLElementCtor === undefined ||
      !(event.target instanceof HTMLElementCtor) ||
      !this.isEnabledWidget(event.target)
    ) {
      return;
    }
    if (
      this.mode === "widget" &&
      this.resolveActiveWidget(this.widgetIndex) === event.target
    ) {
      this.setActiveWidgetElement(event.target);
      this.publishActiveDescendant(this.target);
      return;
    }
    const readPointerTarget = this.readPointerTarget;
    if (readPointerTarget === null) return;
    const token = this.beginDispatch();
    if (token === 0) return;
    const lifecycleOwner = this.lifecycleOwner;
    const candidate = this.navigationScratch.candidate;
    try {
      if (
        !readPointerTarget(event.target, candidate) ||
        !this.ownsDispatch(lifecycleOwner, token)
      ) {
        return;
      }
      this.adoptFocusedWidget(
        candidate,
        event.target,
        lifecycleOwner,
        token,
      );
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  };

  private adoptFocusedWidget(
    candidate: Readonly<KeyboardTargetState>,
    widget: HTMLElement,
    lifecycleOwner: object,
    token: number,
  ): boolean {
    const field = this.fieldForTarget(candidate);
    if (field === null || !this.ownsDispatch(lifecycleOwner, token)) return false;

    let kind: "body" | "header";
    let index = -1;
    let retainedBodyCount = 0;
    let externalBodyWidget: HTMLElement | null = null;
    if (candidate.kind === "bodyCell") {
      kind = "body";
      retainedBodyCount = this.resolveTargetWidgetCount?.(
        candidate.displayRowIndex,
        field,
      ) ?? 0;
      if (
        !this.ownsDispatch(lifecycleOwner, token) ||
        !Number.isSafeInteger(retainedBodyCount) ||
        retainedBodyCount < 0
      ) {
        return false;
      }
      for (let i = 0; i < retainedBodyCount; i += 1) {
        const retainedWidget = this.resolveTargetWidget?.(
            candidate.displayRowIndex,
            field,
            i,
          ) ?? null;
        if (!this.ownsDispatch(lifecycleOwner, token)) return false;
        if (retainedWidget === widget) {
          index = i;
          break;
        }
      }
      if (index < 0) {
        const cell = this.resolveTargetElement?.(candidate) ?? null;
        externalBodyWidget = cell === null
          ? null
          : (this.resolveVisibleCellMenuTrigger?.(
              candidate.displayRowIndex,
              field,
              cell,
            ) ?? null);
        if (!this.ownsDispatch(lifecycleOwner, token)) return false;
        if (externalBodyWidget === widget) index = retainedBodyCount;
      }
      if (index < 0) {
        retainedBodyCount = 0;
        externalBodyWidget = widget;
        index = 0;
      }
      if (
        this.focusBodyCell?.(candidate.displayRowIndex, field) !== true ||
        !this.ownsDispatch(lifecycleOwner, token)
      ) {
        return false;
      }
    } else if (
      candidate.kind === "leafHeader" ||
      candidate.kind === "floatingFilter"
    ) {
      kind = "header";
      const count = this.resolveHeaderWidgetCount?.(
        candidate.kind,
        field,
      ) ?? 0;
      if (
        !this.ownsDispatch(lifecycleOwner, token) ||
        !Number.isSafeInteger(count) ||
        count < 0
      ) return false;
      for (let i = 0; i < count; i += 1) {
        const headerWidget = this.resolveHeaderWidget?.(
          candidate.kind,
          field,
          i,
        ) ?? null;
        if (!this.ownsDispatch(lifecycleOwner, token)) return false;
        if (headerWidget === widget) {
          index = i;
          break;
        }
      }
      if (
        index < 0 &&
        candidate.kind === "leafHeader" &&
        this.resolveResizeHandle?.(field) === widget
      ) {
        index = 0;
      }
    } else {
      return false;
    }
    if (index < 0 || !this.ownsDispatch(lifecycleOwner, token)) return false;

    this.leaveWidgetMode();
    copyKeyboardTarget(this.target, candidate);
    this.retainedBodyWidgetCount = retainedBodyCount;
    this.setExternalBodyWidget(externalBodyWidget);
    this.activeWidgetKind = kind;
    this.widgetIndex = index;
    this.mode = "widget";
    this.setActiveWidgetElement(widget);
    this.widgetTargetElement =
      this.resolveTargetElement?.(this.target) ?? null;
    this.publishActiveDescendant(this.target);
    const count = this.resolveActiveWidgetCount();
    for (let i = 0; i < count; i += 1) {
      this.syncWidgetTabStop(this.resolveActiveWidget(i), i === index);
    }
    return true;
  }

  private publishCandidate(
    candidate: Readonly<KeyboardTargetState>,
    lifecycleOwner: object,
    token: number,
  ): boolean {
    const field = this.fieldForTarget(candidate);
    if (field === null) return false;
    if (candidate.kind === "bodyCell") {
      const focusBodyCell = this.focusBodyCell;
      if (
        focusBodyCell === null ||
        !focusBodyCell(candidate.displayRowIndex, field)
      ) {
        return false;
      }
      return this.ownsDispatch(lifecycleOwner, token);
    }
    this.ensureFieldVisible?.(field);
    return this.ownsDispatch(lifecycleOwner, token);
  }

  private publishActiveDescendant(target: Readonly<KeyboardTargetState>): void {
    const surface = this.surface;
    if (surface === null) return;
    if (target.kind === "none") {
      surface.removeAttribute("aria-activedescendant");
      this.setActiveTargetElement(null);
      return;
    }
    if (this.mode !== "navigation") {
      this.clearPublishedActiveDescendant();
      return;
    }
    const element = this.resolveTargetElement?.(target) ?? null;
    if (element === null || !element.isConnected || element.id.length === 0) {
      surface.removeAttribute("aria-activedescendant");
      this.setActiveTargetElement(null);
      return;
    }
    this.setActiveTargetElement(element);
    if (surface.getAttribute("aria-activedescendant") !== element.id) {
      surface.setAttribute("aria-activedescendant", element.id);
    }
  }

  private setActiveTargetElement(next: HTMLElement | null): void {
    if (this.activeTargetElement === next) {
      this.updateExactFocusBindingActivity();
      return;
    }
    try {
      this.activeTargetElement?.classList.remove(ACTIVE_TARGET_CLASS);
    } catch {
      // Visual cleanup cannot invalidate the accepted logical target.
    }
    this.activeTargetElement = next;
    try {
      next?.classList.add(ACTIVE_TARGET_CLASS);
    } catch {
      // aria-activedescendant remains the authoritative semantic state.
    }
    this.updateExactFocusBindingActivity();
  }

  private invalidateRecycledWidgetBinding(): void {
    const surface = this.surface;
    const lifecycleOwner = this.lifecycleOwner;
    const activeWidget = this.activeWidgetElement;
    const activeElement =
      activeWidget?.ownerDocument.activeElement ?? null;
    // Reclaim the surface when the recycled widget still held focus, or focus
    // was lost with the widget (jsdom/browser dump to body). `activeWidgetFocusDeparted`
    // already covers a real move to outside chrome (toolbar search, demo panels).
    const restoreSurfaceFocus =
      activeWidget !== null &&
      !this.activeWidgetFocusDeparted &&
      (activeElement === activeWidget || !activeWidget.isConnected);
    this.leaveWidgetMode();
    if (restoreSurfaceFocus) {
      this.suppressSurfaceFocusPublication = true;
      try {
        surface?.focus(FOCUS_PREVENT_SCROLL);
      } finally {
        this.suppressSurfaceFocusPublication = false;
      }
    }
    if (
      this.lifecycleOwner !== lifecycleOwner ||
      this.surface !== surface
    ) {
      return;
    }
    this.clearPublishedActiveDescendant();
  }

  private clearPublishedActiveDescendant(): void {
    if (this.surface?.hasAttribute("aria-activedescendant")) {
      this.surface.removeAttribute("aria-activedescendant");
    }
    this.setActiveTargetElement(null);
  }

  private updateExactFocusBindingActivity(): void {
    this.setExactFocusBindingActive?.(
      this.activeTargetElement !== null ||
        this.mode === "widget" ||
        this.target.kind === "bodyCell",
    );
  }

  private fieldForTarget(target: Readonly<KeyboardTargetState>): string | null {
    const plan = this.plan;
    if (plan === null || target.kind === "none") return null;
    const ordinal = target.kind === "groupHeader"
      ? target.anchorColumnOrdinal
      : target.columnOrdinal;
    return plan.columns[ordinal]?.field ?? null;
  }

  private dispatchBodyAction(
    action: ((displayRowIndex: number) => boolean) | null,
  ): boolean {
    if (action === null || this.target.kind !== "bodyCell") return false;
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      const accepted = action(this.target.displayRowIndex);
      return accepted && this.ownsDispatch(lifecycleOwner, token);
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private dispatchScalarAction(action: (() => boolean) | null): boolean {
    if (action === null) return false;
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      const accepted = action();
      return accepted && this.ownsDispatch(lifecycleOwner, token);
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private dispatchFieldAction(
    action: (field: string) => boolean,
    field: string,
  ): boolean {
    const token = this.beginDispatch();
    if (token === 0) return false;
    const lifecycleOwner = this.lifecycleOwner;
    try {
      const accepted = action(field);
      return accepted && this.ownsDispatch(lifecycleOwner, token);
    } finally {
      if (this.activeDispatchToken === token) this.activeDispatchToken = 0;
    }
  }

  private ownsDispatch(owner: object, token: number): boolean {
    return (
      this.readPageSize !== null &&
      this.lifecycleOwner === owner &&
      this.activeDispatchToken === token
    );
  }
}
