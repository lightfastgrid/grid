import { composeAccessibleNameWithVisibleText } from "../../../internal/accessibleName";
import { isInternalColumn } from "../../../internal/internalColumns";
import type { PooledCell, PooledRow } from "../../../internal/poolTypes";
import type { DisplayRowReader } from "../../../rendering/rowViewAccess";
import type {
  CellAccessibilityParams,
  CellShellKind,
  ColumnDef,
  FocusedCell,
  RowData,
} from "../../../types";
import { isActionColumn } from "../../row-actions/rowActionDom";
import type { DomGridFeatureContext } from "../../types";

import {
  applyBodyCellElementSemantics,
  applyPhysicalBodyCellSemantics,
  clearBodyCellBindingSemantics,
  clearBodyCellElementSemantics,
} from "./bodyCellSemanticsDom";
import {
  toAriaColIndex,
  visitColumnsInVisualLaneOrder,
} from "./headerSemantics";
import { normalizeAriaAttributeValue } from "./normalizeAriaAttributeValue";
import {
  type BodyCellOwnershipState,
  PinnedLaneOwnershipReconciler,
} from "./pinnedLaneOwnership";

const INTERACTIVE_SHELL_KINDS: readonly CellShellKind[] = [
  "checkbox",
  "button",
  "iconButton",
  "buttonGroup",
  "link",
];

let nextBodyCellSemanticsInstanceId = 1;

interface LogicalCellColumn {
  readonly column: ColumnDef;
  readonly ariaColIndex: number;
  readonly header: string;
}

interface RetainedCellSemanticState {
  readonly element: HTMLElement;
  readonly id: string;
  initialized: boolean;
  active: boolean;
  rowId: string | null;
  rowIndex: number;
  rowVersion: number;
  field: string | null;
  formattedValue: string;
  shellKind: CellShellKind | undefined;
  column: ColumnDef | null;
  ariaColIndex: number;
  ariaLabel: string | undefined;
  ariaSelected: boolean | undefined;
  ariaDescribedBy: string | undefined;
  widgetRoot: HTMLElement | undefined;
  readonly widgets: HTMLElement[];
  widgetCount: number;
}

interface RetainedBodyTargetRow {
  readonly poolRow: PooledRow;
  displayRowIndex: number;
  readonly cellsByField: Map<string, RetainedCellSemanticState>;
}

export interface BodyKeyboardPointerTarget {
  displayRowIndex: number;
  field: string;
}

function allocateBodyCellSemanticsInstanceId(): number {
  const id = nextBodyCellSemanticsInstanceId;
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error("Accessibility body-cell instance id exhausted");
  }
  nextBodyCellSemanticsInstanceId =
    id === Number.MAX_SAFE_INTEGER ? Number.NaN : id + 1;
  return id;
}

function isInteractiveShell(kind: CellShellKind | undefined): boolean {
  return kind !== undefined && INTERACTIVE_SHELL_KINDS.includes(kind);
}

function shouldUseContainerLabel(
  column: ColumnDef,
  shellKind: CellShellKind | undefined,
): boolean {
  return (
    !isInternalColumn(column) &&
    !isActionColumn(column) &&
    !isInteractiveShell(shellKind)
  );
}

function defaultCellAccessibleName(
  header: string,
  formattedValue: string,
): string | undefined {
  const visible = formattedValue.trim();
  if (header.length === 0) {
    return visible.length === 0 ? undefined : visible;
  }
  return visible.length === 0 ? header : `${header}: ${visible}`;
}

function resolveCellAccessibleName(
  logical: LogicalCellColumn,
  shellKind: CellShellKind | undefined,
  params: CellAccessibilityParams | null,
  formattedValue: string,
): string | undefined {
  if (!shouldUseContainerLabel(logical.column, shellKind)) {
    return undefined;
  }

  const fallback = defaultCellAccessibleName(
    logical.header,
    formattedValue,
  );
  const getLabel = logical.column.getCellAriaLabel;
  if (getLabel === undefined || params === null) {
    return fallback;
  }

  try {
    const custom = normalizeAriaAttributeValue(getLabel(params) ?? undefined);
    return custom === undefined
      ? fallback
      : composeAccessibleNameWithVisibleText(formattedValue, custom);
  } catch {
    return fallback;
  }
}

function resolveCellAriaDescribedBy(
  logical: LogicalCellColumn,
  params: CellAccessibilityParams | null,
): string | undefined {
  const fallback = normalizeAriaAttributeValue(
    logical.column.cellAriaDescribedBy,
  );
  const getDescribedBy = logical.column.getCellAriaDescribedBy;
  if (getDescribedBy === undefined || params === null) {
    return fallback;
  }
  try {
    return (
      normalizeAriaAttributeValue(getDescribedBy(params) ?? undefined) ??
      fallback
    );
  } catch {
    return fallback;
  }
}

function createRetainedCellSemanticState(
  element: HTMLElement,
  id: string,
): RetainedCellSemanticState {
  return {
    element,
    id,
    initialized: false,
    active: false,
    rowId: null,
    rowIndex: -1,
    rowVersion: -1,
    field: null,
    formattedValue: "",
    shellKind: undefined,
    column: null,
    ariaColIndex: -1,
    ariaLabel: undefined,
    ariaSelected: undefined,
    ariaDescribedBy: undefined,
    widgetRoot: undefined,
    widgets: [],
    widgetCount: 0,
  };
}

function appendWidget(
  state: RetainedCellSemanticState,
  element: HTMLElement,
): void {
  state.widgets[state.widgetCount] = element;
  state.widgetCount++;
}

function syncRetainedWidgets(
  state: RetainedCellSemanticState,
  cell: PooledCell,
): void {
  const root = cell.shellRoot;
  state.widgetRoot = root;
  state.widgetCount = 0;
  const view = cell.element.ownerDocument.defaultView;
  const HTMLElementCtor = view?.HTMLElement;
  const HTMLInputElementCtor = view?.HTMLInputElement;
  const HTMLButtonElementCtor = view?.HTMLButtonElement;

  if (root === undefined) {
    const children = cell.element.children;
    for (let index = 0; index < children.length; index++) {
      const child = children.item(index);
      if (
        HTMLInputElementCtor !== undefined &&
        child instanceof HTMLInputElementCtor
      ) {
        state.widgetRoot = child;
        if (!child.disabled) appendWidget(state, child);
        return;
      }
      if (
        HTMLButtonElementCtor !== undefined &&
        child instanceof HTMLButtonElementCtor &&
        child.hasAttribute("data-actions-key")
      ) {
        state.widgetRoot = child;
        appendWidget(state, child);
        return;
      }
    }
    return;
  }

  switch (cell.shellKind) {
    case "button":
    case "iconButton":
      appendWidget(state, root);
      return;
    case "link":
      if (root.getAttribute("role") === "link") appendWidget(state, root);
      return;
    case "buttonGroup": {
      const children = root.children;
      for (let i = 0; i < children.length; i++) {
        const child = children.item(i);
        if (
          HTMLElementCtor !== undefined &&
          child instanceof HTMLElementCtor &&
          !child.hasAttribute("disabled")
        ) {
          appendWidget(state, child);
        }
      }
      return;
    }
    case "checkbox": {
      const children = root.children;
      for (let i = 0; i < children.length; i++) {
        const child = children.item(i);
        if (child === null) continue;
        if (
          HTMLInputElementCtor !== undefined &&
          child instanceof HTMLInputElementCtor
        ) {
          if (!child.disabled) appendWidget(state, child);
          return;
        }
        const nested = child.children;
        for (let j = 0; j < nested.length; j++) {
          const control = nested.item(j);
          if (
            HTMLInputElementCtor !== undefined &&
            control instanceof HTMLInputElementCtor
          ) {
            if (!control.disabled) appendWidget(state, control);
            return;
          }
        }
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Retained, pool-bounded body-cell semantic reconciler.
 *
 * Structural work allocates the logical map and physical cell states. Settled
 * positional work only compares accepted bindings and updates changed cells.
 */
export class BodyCellSemanticsReconciler {
  private readonly instanceId = allocateBodyCellSemanticsInstanceId();
  private nextPhysicalCellId = 1;
  private states = new WeakMap<PooledCell, RetainedCellSemanticState>();
  private pointerStateByElement =
    new WeakMap<HTMLElement, RetainedCellSemanticState>();
  private logicalByField = new Map<string, LogicalCellColumn>();
  private complete = true;
  private allowCreate = false;
  private currentCtx: DomGridFeatureContext | null = null;
  private currentDisplayRows: DisplayRowReader | null = null;
  private currentForce = false;
  private currentColumnSelectionEnabled = false;
  private callbackPoolRow: PooledRow | null = null;
  private callbackRowResolved = false;
  private callbackRow: RowData | undefined;
  private callbackSourceIndex = -1;
  private lifecycleOwner: object = {};
  private activeAttemptOwner: object | null = null;
  private attemptAborted = false;
  private readonly ownership = new PinnedLaneOwnershipReconciler();
  private targetRows = new WeakMap<PooledRow, RetainedBodyTargetRow>();
  private readonly activeTargetRows0 = new Map<number, RetainedBodyTargetRow>();
  private readonly activeTargetRows1 = new Map<number, RetainedBodyTargetRow>();
  private readonly activeTargetRows2 = new Map<number, RetainedBodyTargetRow>();

  private readonly readOwnershipState = (
    cell: PooledCell,
  ): BodyCellOwnershipState | null => this.states.get(cell) ?? null;

  private readonly visitPinnedPoolRow = (poolRow: PooledRow): void => {
    this.syncPoolRow(poolRow);
  };

  private readonly clearPinnedPoolRow = (poolRow: PooledRow): void => {
    this.clearPoolRow(poolRow);
  };

  syncStructure(ctx: DomGridFeatureContext): void {
    this.logicalByField = new Map<string, LogicalCellColumn>();
    visitColumnsInVisualLaneOrder(
      ctx.getColumns(),
      (column, logicalIndex) => {
        if (this.logicalByField.has(column.field)) return;
        this.logicalByField.set(column.field, {
          column,
          ariaColIndex: toAriaColIndex(logicalIndex),
          header: (column.headerName?.trim() || column.field).trim(),
        });
      },
    );
    this.allowCreate = true;
    this.complete = true;
    try {
      this.visitPools(ctx, true);
      if (!this.attemptAborted) {
        this.ownership.syncStructure(ctx, this.readOwnershipState);
      }
    } finally {
      this.allowCreate = false;
    }
    this.syncActiveDescendant(ctx);
  }

  /** Returns false when a new physical cell needs structural warm-up. */
  syncPosition(ctx: DomGridFeatureContext): boolean {
    this.allowCreate = false;
    this.complete = true;
    this.visitPools(ctx, false);
    const ownershipComplete = this.attemptAborted
      ? false
      : this.ownership.syncPosition(ctx, this.readOwnershipState);
    if (!ownershipComplete) {
      this.complete = false;
    }
    this.syncActiveDescendant(ctx);
    return this.complete;
  }

  syncActiveDescendant(ctx: DomGridFeatureContext): void {
    // `aria-activedescendant` is a composite-grid attribute and belongs on the
    // surface (the `role="grid"` host), not the outer layout root.
    const activeElement = ctx.surface.ownerDocument.activeElement;
    if (
      activeElement !== null &&
      activeElement !== ctx.surface &&
      ctx.surface.contains(activeElement)
    ) {
      ctx.surface.removeAttribute("aria-activedescendant");
      return;
    }
    const focused = ctx.getFocusedCell?.() ?? null;
    const id = focused === null ? null : this.findFocusedCellId(ctx, focused);
    if (id === null) {
      if (ctx.surface.hasAttribute("aria-activedescendant")) {
        ctx.surface.removeAttribute("aria-activedescendant");
      }
      return;
    }
    if (ctx.surface.getAttribute("aria-activedescendant") !== id) {
      ctx.surface.setAttribute("aria-activedescendant", id);
    }
  }

  resolveTargetElement(
    displayRowIndex: number,
    field: string,
  ): HTMLElement | null {
    const state = this.resolveTargetState(displayRowIndex, field);
    return state === undefined ? null : state.element;
  }

  resolveTargetWidgetCount(displayRowIndex: number, field: string): number {
    return this.resolveTargetState(displayRowIndex, field)?.widgetCount ?? 0;
  }

  resolveTargetWidget(
    displayRowIndex: number,
    field: string,
    widgetIndex: number,
  ): HTMLElement | null {
    const state = this.resolveTargetState(displayRowIndex, field);
    if (
      state === undefined ||
      widgetIndex < 0 ||
      widgetIndex >= state.widgetCount
    ) {
      return null;
    }
    return state.widgets[widgetIndex] ?? null;
  }

  resolvePointerTarget(
    target: EventTarget | null,
    out: BodyKeyboardPointerTarget,
  ): boolean {
    let element = target instanceof HTMLElement ? target : null;
    while (element !== null) {
      const state = this.pointerStateByElement.get(element);
      if (
        state?.active === true &&
        state.rowIndex >= 0 &&
        state.field !== null
      ) {
        out.displayRowIndex = state.rowIndex;
        out.field = state.field;
        return true;
      }
      element = element.parentElement;
    }
    return false;
  }

  clear(ctx: DomGridFeatureContext): void {
    this.lifecycleOwner = {};
    this.attemptAborted = true;
    this.ownership.clear(ctx);
    for (const poolRow of ctx.getPool()) {
      this.clearPoolRow(poolRow);
    }
    ctx.forEachRowPinnedLanePoolRow?.(this.clearPinnedPoolRow);
    if (ctx.surface.hasAttribute("aria-activedescendant")) {
      ctx.surface.removeAttribute("aria-activedescendant");
    }
    this.states = new WeakMap<PooledCell, RetainedCellSemanticState>();
    this.pointerStateByElement =
      new WeakMap<HTMLElement, RetainedCellSemanticState>();
    this.targetRows = new WeakMap<PooledRow, RetainedBodyTargetRow>();
    this.clearActiveTargetRows();
    this.logicalByField.clear();
  }

  private visitPools(ctx: DomGridFeatureContext, force: boolean): void {
    this.activeAttemptOwner = this.lifecycleOwner;
    this.attemptAborted = false;
    this.currentCtx = ctx;
    this.currentDisplayRows = ctx.getDisplayRows();
    this.currentForce = force;
    this.currentColumnSelectionEnabled =
      ctx.getColumnSelectionConfig?.().enabled ?? false;
    this.clearActiveTargetRows();
    try {
      for (const poolRow of ctx.getPool()) {
        this.syncPoolRow(poolRow);
      }
      ctx.forEachRowPinnedLanePoolRow?.(this.visitPinnedPoolRow);
    } finally {
      this.currentCtx = null;
      this.currentDisplayRows = null;
      this.callbackPoolRow = null;
      this.callbackRow = undefined;
    }
  }

  private syncPoolRow(poolRow: PooledRow): void {
    if (this.attemptAborted) return;
    const displayRows = this.currentDisplayRows;
    if (displayRows === null) return;
    const rowValid =
      poolRow.rowId !== null &&
      poolRow.rowIndex >= 0 &&
      poolRow.rowIndex < displayRows.rowCount;
    const targetRow = this.targetRowFor(poolRow);
    targetRow.displayRowIndex = rowValid ? poolRow.rowIndex : -1;
    targetRow.cellsByField.clear();
    this.callbackPoolRow = poolRow;
    this.callbackRowResolved = false;
    this.callbackRow = undefined;
    this.callbackSourceIndex = -1;
    this.syncCellArray(poolRow, poolRow.cells, rowValid, targetRow);
    this.syncCellArray(poolRow, poolRow.pinnedCells, rowValid, targetRow);
    this.syncCellArray(poolRow, poolRow.rightPinnedCells, rowValid, targetRow);
    if (rowValid) this.registerActiveTargetRow(targetRow);
  }

  private syncCellArray(
    poolRow: PooledRow,
    cells: readonly PooledCell[] | undefined,
    rowValid: boolean,
    targetRow: RetainedBodyTargetRow,
  ): void {
    if (cells === undefined) return;
    for (const cell of cells) {
      if (this.attemptAborted) return;
      let state = this.states.get(cell);
      if (state === undefined) {
        if (!this.allowCreate) {
          this.complete = false;
          continue;
        }
        const physicalId = this.nextPhysicalCellId;
        if (!Number.isSafeInteger(physicalId) || physicalId < 1) {
          throw new Error("Accessibility physical cell id exhausted");
        }
        this.nextPhysicalCellId =
          physicalId === Number.MAX_SAFE_INTEGER
            ? Number.NaN
            : physicalId + 1;
        state = createRetainedCellSemanticState(
          cell.element,
          `lfg-a11y-${this.instanceId}-cell-${physicalId}`,
        );
        this.states.set(cell, state);
        this.pointerStateByElement.set(cell.element, state);
        applyPhysicalBodyCellSemantics(cell.element, state.id);
      }

      const fieldValue = cell.element.getAttribute("data-col-id");
      const field =
        fieldValue === null || fieldValue.length === 0 ? null : fieldValue;
      const logical =
        field === null ? undefined : this.logicalByField.get(field);
      const active =
        rowValid &&
        logical !== undefined &&
        cell.element.style.display !== "none";
      if (
        !active ||
        poolRow.rowId === null ||
        field === null
      ) {
        if (this.currentForce || state.active || !state.initialized) {
          applyPhysicalBodyCellSemantics(cell.element, state.id);
          clearBodyCellBindingSemantics(
            cell.element,
            state.ariaDescribedBy,
          );
        }
        state.initialized = true;
        state.active = false;
        state.rowId = null;
        state.rowIndex = -1;
        state.rowVersion = poolRow.rowVersion;
        state.field = field;
        state.formattedValue = cell.value;
        state.shellKind = cell.shellKind;
        state.column = logical?.column ?? null;
        state.ariaColIndex = -1;
        state.ariaLabel = undefined;
        state.ariaSelected = undefined;
        state.ariaDescribedBy = undefined;
        state.widgetRoot = cell.shellRoot;
        state.widgetCount = 0;
        continue;
      }

      targetRow.cellsByField.set(field, state);
      syncRetainedWidgets(state, cell);

      const bindingChanged =
        this.currentForce ||
        !state.initialized ||
        !state.active ||
        state.rowId !== poolRow.rowId ||
        state.rowIndex !== poolRow.rowIndex ||
        state.rowVersion !== poolRow.rowVersion ||
        state.field !== field ||
        state.formattedValue !== cell.value ||
        state.shellKind !== cell.shellKind ||
        state.column !== logical.column ||
        state.ariaColIndex !== logical.ariaColIndex;
      const ariaSelected = this.currentColumnSelectionEnabled
        ? (this.currentCtx?.isColumnSelected?.(field) ?? false)
        : undefined;
      const selectionChanged = state.ariaSelected !== ariaSelected;

      if (!bindingChanged && !selectionChanged) {
        continue;
      }

      let ariaLabel = state.ariaLabel;
      let ariaDescribedBy = state.ariaDescribedBy;
      if (bindingChanged) {
        const needsParams =
          logical.column.getCellAriaLabel !== undefined ||
          logical.column.getCellAriaDescribedBy !== undefined;
        const params = needsParams
          ? this.resolveCallbackParams(logical, cell.value)
          : null;
        ariaLabel = resolveCellAccessibleName(
          logical,
          cell.shellKind,
          params,
          cell.value,
        );
        if (!this.isCurrentAttempt()) return;
        ariaDescribedBy = resolveCellAriaDescribedBy(logical, params);
        if (!this.isCurrentAttempt()) return;
      }

      applyBodyCellElementSemantics(cell.element, {
        id: state.id,
        ariaColIndex: logical.ariaColIndex,
        ariaLabel,
        ariaSelected,
        previousAriaDescribedBy: state.ariaDescribedBy,
        ariaDescribedBy,
      });
      state.initialized = true;
      state.active = true;
      state.rowId = poolRow.rowId;
      state.rowIndex = poolRow.rowIndex;
      state.rowVersion = poolRow.rowVersion;
      state.field = field;
      state.formattedValue = cell.value;
      state.shellKind = cell.shellKind;
      state.column = logical.column;
      state.ariaColIndex = logical.ariaColIndex;
      state.ariaLabel = ariaLabel;
      state.ariaSelected = ariaSelected;
      state.ariaDescribedBy = ariaDescribedBy;
    }
  }

  private isCurrentAttempt(): boolean {
    if (
      this.activeAttemptOwner === this.lifecycleOwner &&
      this.currentCtx !== null
    ) {
      return true;
    }
    this.attemptAborted = true;
    this.complete = false;
    return false;
  }

  private resolveCallbackParams(
    logical: LogicalCellColumn,
    formattedValue: string,
  ): CellAccessibilityParams | null {
    const poolRow = this.callbackPoolRow;
    const displayRows = this.currentDisplayRows;
    if (poolRow === null || displayRows === null) return null;
    if (!this.callbackRowResolved) {
      this.callbackRowResolved = true;
      this.callbackRow =
        poolRow.rowIndex >= 0 && poolRow.rowIndex < displayRows.rowCount
          ? displayRows.getRowData(poolRow.rowIndex)
          : undefined;
      this.callbackSourceIndex =
        this.callbackRow === undefined
          ? -1
          : displayRows.getSourceIndex(poolRow.rowIndex);
    }
    if (this.callbackRow === undefined || poolRow.rowId === null) {
      return null;
    }
    return {
      row: this.callbackRow,
      rowId: poolRow.rowId,
      rowIndex: poolRow.rowIndex,
      sourceIndex: this.callbackSourceIndex,
      field: logical.column.field,
      column: logical.column,
      formattedValue,
    };
  }

  private findFocusedCellId(
    _ctx: DomGridFeatureContext,
    focused: FocusedCell,
  ): string | null {
    const first = this.activeTargetRows0.get(focused.rowIndex);
    const second = this.activeTargetRows1.get(focused.rowIndex);
    const third = this.activeTargetRows2.get(focused.rowIndex);
    const targetRow =
      first?.poolRow.rowId === focused.rowId
        ? first
        : second?.poolRow.rowId === focused.rowId
          ? second
          : third?.poolRow.rowId === focused.rowId
            ? third
            : undefined;
    return targetRow?.cellsByField.get(focused.field)?.id ?? null;
  }

  private resolveTargetState(
    displayRowIndex: number,
    field: string,
  ): RetainedCellSemanticState | undefined {
    return (
      this.activeTargetRows0.get(displayRowIndex)?.cellsByField.get(field) ??
      this.activeTargetRows1.get(displayRowIndex)?.cellsByField.get(field) ??
      this.activeTargetRows2.get(displayRowIndex)?.cellsByField.get(field)
    );
  }

  private targetRowFor(poolRow: PooledRow): RetainedBodyTargetRow {
    let targetRow = this.targetRows.get(poolRow);
    if (targetRow !== undefined) return targetRow;
    targetRow = {
      poolRow,
      displayRowIndex: -1,
      cellsByField: new Map(),
    };
    this.targetRows.set(poolRow, targetRow);
    return targetRow;
  }

  private clearActiveTargetRows(): void {
    this.activeTargetRows0.clear();
    this.activeTargetRows1.clear();
    this.activeTargetRows2.clear();
  }

  private registerActiveTargetRow(targetRow: RetainedBodyTargetRow): void {
    const displayRowIndex = targetRow.displayRowIndex;
    if (!this.activeTargetRows0.has(displayRowIndex)) {
      this.activeTargetRows0.set(displayRowIndex, targetRow);
    } else if (!this.activeTargetRows1.has(displayRowIndex)) {
      this.activeTargetRows1.set(displayRowIndex, targetRow);
    } else if (!this.activeTargetRows2.has(displayRowIndex)) {
      this.activeTargetRows2.set(displayRowIndex, targetRow);
    }
  }

  private clearPoolRow(poolRow: PooledRow): void {
    for (const cell of poolRow.cells) {
      this.clearCell(cell);
    }
    if (poolRow.pinnedCells !== undefined) {
      for (const cell of poolRow.pinnedCells) {
        this.clearCell(cell);
      }
    }
    if (poolRow.rightPinnedCells !== undefined) {
      for (const cell of poolRow.rightPinnedCells) {
        this.clearCell(cell);
      }
    }
  }

  private clearCell(cell: PooledCell): void {
    clearBodyCellElementSemantics(
      cell.element,
      this.states.get(cell)?.ariaDescribedBy,
    );
  }
}
