import type { VisualRowLayout } from "../../../internal/layoutTypes";
import type { PooledRow } from "../../../internal/poolTypes";
import { CSS as LFG_CSS } from "../../../rendering/const/css-classes";
import type { RowSelectionMode } from "../../../types";
import { visualIndexOfDisplay } from "../../focus/focusNavigation";
import type {
  DomGridFeatureContext,
  HeaderLaneRef,
} from "../../types";
import { countAccessibilityHeaderRows } from "../gridRootStructuralSnapshot";

import {
  applyPresentationRowElementSemantics,
  applyRowElementSemantics,
  clearRowElementSemantics,
} from "./rowSemanticsDom";

export interface LogicalRowBinding {
  readonly rowId: string;
  readonly displayIndex: number;
}

/** 1-based `aria-rowindex` in the grid row index space. */
export function toAriaRowIndex(
  headerRowCount: number,
  visualRowIndex: number,
): number | null {
  if (
    !Number.isSafeInteger(headerRowCount) ||
    headerRowCount < 0 ||
    !Number.isSafeInteger(visualRowIndex) ||
    visualRowIndex < 0
  ) {
    return null;
  }
  const value = headerRowCount + visualRowIndex + 1;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Map display index to top-pinned, center, then bottom-pinned visual order. */
export function resolveVisualRowIndex(
  displayIndex: number,
  layout: VisualRowLayout | null,
  displayRowCount?: number,
): number | null {
  if (!Number.isInteger(displayIndex) || displayIndex < 0) {
    return null;
  }
  if (
    displayRowCount !== undefined &&
    (!Number.isInteger(displayRowCount) ||
      displayRowCount < 0 ||
      displayIndex >= displayRowCount)
  ) {
    return null;
  }
  return layout === null
    ? displayIndex
    : visualIndexOfDisplay(layout, displayIndex);
}

/** Logical binding comes from renderer-owned pool scalars, never DOM reads. */
export function resolveLogicalRowBinding(
  poolRow: PooledRow,
): LogicalRowBinding | null {
  return poolRow.rowId !== null && poolRow.rowIndex >= 0
    ? { rowId: poolRow.rowId, displayIndex: poolRow.rowIndex }
    : null;
}

/** Header lanes are discovered only during structural reconciliation. */
export function resolveAccessibilityHeaderLanes(
  ctx: DomGridFeatureContext,
): (HeaderLaneRef | null)[] {
  const refs = ctx.getHeaderLaneRefs?.() ?? null;
  if (refs !== null) {
    return [refs.left, refs.center, refs.right];
  }

  const centerContainer = ctx.surface.querySelector<HTMLElement>(
    `.${LFG_CSS.HEADER}`,
  );
  if (centerContainer === null) {
    return [];
  }
  const leafRow =
    ctx.getHeaderRowEl() ??
    centerContainer.querySelector<HTMLDivElement>(`.${LFG_CSS.HEADER_ROW}`);
  return leafRow === null
    ? []
    : [
        null,
        {
          container: centerContainer as HTMLDivElement,
          leafRow,
        },
        null,
      ];
}

export interface RowSemanticsRead {
  getRowSelectionMode(): RowSelectionMode;
  isRowSelected(rowId: string): boolean;
}

interface RetainedRowSemanticState {
  initialized: boolean;
  rowId: string | null;
  rowIndex: number;
  ariaRowIndex: number;
  selectionMode: RowSelectionMode;
  selected: boolean;
  centerElement: HTMLElement | null;
  leftElement: HTMLElement | null;
  rightElement: HTMLElement | null;
  centerVisible: boolean;
  leftVisible: boolean;
  rightVisible: boolean;
}

function createRetainedRowSemanticState(): RetainedRowSemanticState {
  return {
    initialized: false,
    rowId: null,
    rowIndex: -1,
    ariaRowIndex: -1,
    selectionMode: "none",
    selected: false,
    centerElement: null,
    leftElement: null,
    rightElement: null,
    centerVisible: false,
    leftVisible: false,
    rightVisible: false,
  };
}

function isVisible(element: HTMLElement | null): boolean {
  return element !== null && element.style.display !== "none";
}


/**
 * Retained, pool-bounded body-row semantic reconciler.
 *
 * Structural reconciliation is the only path that creates WeakMap entries.
 * Positional reconciliation performs scalar comparisons and updates existing
 * row roots only.
 */
export class RowSemanticsReconciler {
  private states = new WeakMap<PooledRow, RetainedRowSemanticState>();
  private currentRead: RowSemanticsRead | null = null;
  private currentLayout: VisualRowLayout | null = null;
  private currentDisplayRowCount = 0;
  private currentHeaderRowCount = 0;
  private currentSelectionMode: RowSelectionMode = "none";
  private allowCreate = false;
  private complete = true;

  private readonly visitPinnedRow = (poolRow: PooledRow): void => {
    this.syncPoolRow(poolRow, null, null);
  };

  private readonly visitPinnedLogicalRow = (
    center: PooledRow,
    left: PooledRow | null,
    right: PooledRow | null,
  ): void => {
    this.syncPoolRow(center, left, right);
  };

  syncStructure(
    ctx: DomGridFeatureContext,
    read: RowSemanticsRead,
  ): void {
    this.preparePass(ctx, read, countAccessibilityHeaderRows(ctx), true);
    this.visitPools(ctx);
    this.finishPass();
  }

  /** Returns false when a new physical row requires a structural warm-up. */
  syncPosition(
    ctx: DomGridFeatureContext,
    read: RowSemanticsRead,
  ): boolean {
    this.preparePass(ctx, read, countAccessibilityHeaderRows(ctx), false);
    this.visitPools(ctx);
    const complete = this.complete;
    this.finishPass();
    return complete;
  }

  clear(ctx: DomGridFeatureContext): void {
    for (const poolRow of ctx.getPool()) {
      this.clearPoolRow(poolRow);
    }
    if (ctx.forEachRowPinnedLogicalPoolRow !== undefined) {
      ctx.forEachRowPinnedLogicalPoolRow(this.clearPinnedLogicalRow);
    } else {
      ctx.forEachRowPinnedLanePoolRow?.(this.clearPinnedPoolRow);
    }
    this.states = new WeakMap<PooledRow, RetainedRowSemanticState>();
  }

  private readonly clearPinnedPoolRow = (poolRow: PooledRow): void => {
    this.clearPoolRow(poolRow);
  };

  private readonly clearPinnedLogicalRow = (
    center: PooledRow,
    left: PooledRow | null,
    right: PooledRow | null,
  ): void => {
    this.clearPoolRow(center);
    if (left !== null) this.clearPoolRow(left);
    if (right !== null) this.clearPoolRow(right);
  };

  private clearPoolRow(poolRow: PooledRow): void {
    clearRowElementSemantics(poolRow.element);
    clearRowElementSemantics(poolRow.pinnedElement);
    clearRowElementSemantics(poolRow.rightPinnedElement);
  }

  private preparePass(
    ctx: DomGridFeatureContext,
    read: RowSemanticsRead,
    headerRowCount: number,
    allowCreate: boolean,
  ): void {
    this.currentRead = read;
    this.currentLayout = ctx.getVisualRowLayout?.() ?? null;
    this.currentDisplayRowCount = ctx.getDisplayRows().rowCount;
    this.currentHeaderRowCount = headerRowCount;
    this.currentSelectionMode = read.getRowSelectionMode();
    this.allowCreate = allowCreate;
    this.complete = true;
  }

  private finishPass(): void {
    this.currentRead = null;
    this.currentLayout = null;
    this.allowCreate = false;
  }

  private visitPools(ctx: DomGridFeatureContext): void {
    for (const poolRow of ctx.getPool()) {
      this.syncPoolRow(poolRow, null, null);
    }
    if (ctx.forEachRowPinnedLogicalPoolRow !== undefined) {
      ctx.forEachRowPinnedLogicalPoolRow(this.visitPinnedLogicalRow);
    } else {
      ctx.forEachRowPinnedLanePoolRow?.(this.visitPinnedRow);
    }
  }

  private syncPoolRow(
    poolRow: PooledRow,
    leftPoolRow: PooledRow | null,
    rightPoolRow: PooledRow | null,
  ): void {
    let state = this.states.get(poolRow);
    if (state === undefined) {
      if (!this.allowCreate) {
        this.complete = false;
        return;
      }
      state = createRetainedRowSemanticState();
      this.states.set(poolRow, state);
    }

    const validBinding =
      poolRow.rowId !== null &&
      poolRow.rowIndex >= 0 &&
      poolRow.rowIndex < this.currentDisplayRowCount;
    const rowId = validBinding ? poolRow.rowId : null;
    const rowIndex = validBinding ? poolRow.rowIndex : -1;
    const visualIndex =
      validBinding
        ? resolveVisualRowIndex(
            rowIndex,
            this.currentLayout,
            this.currentDisplayRowCount,
          )
        : null;
    const ariaRowIndex =
      visualIndex === null
        ? -1
        : (toAriaRowIndex(this.currentHeaderRowCount, visualIndex) ?? -1);
    const semanticBindingValid = rowId !== null && ariaRowIndex > 0;
    const selectionMode = semanticBindingValid
      ? this.currentSelectionMode
      : "none";
    const selected =
      semanticBindingValid &&
      selectionMode !== "none" &&
      this.currentRead !== null
        ? this.currentRead.isRowSelected(rowId)
        : false;

    const centerElement = poolRow.element;
    const leftElement = leftPoolRow?.element ?? poolRow.pinnedElement ?? null;
    const rightElement =
      rightPoolRow?.element ?? poolRow.rightPinnedElement ?? null;
    const centerVisible = semanticBindingValid && isVisible(centerElement);
    const leftVisible =
      semanticBindingValid &&
      isVisible(leftElement) &&
      (leftPoolRow === null ||
        (leftPoolRow.rowId === rowId && leftPoolRow.rowIndex === rowIndex));
    const rightVisible =
      semanticBindingValid &&
      isVisible(rightElement) &&
      (rightPoolRow === null ||
        (rightPoolRow.rowId === rowId && rightPoolRow.rowIndex === rowIndex));

    const logicalChanged =
      !state.initialized ||
      state.rowId !== rowId ||
      state.rowIndex !== rowIndex ||
      state.ariaRowIndex !== ariaRowIndex ||
      state.selectionMode !== selectionMode ||
      state.selected !== selected;

    this.syncLane(
      state.centerElement,
      centerElement,
      state.centerVisible,
      centerVisible,
      logicalChanged,
      ariaRowIndex,
      selectionMode,
      selected,
      false,
    );
    this.syncLane(
      state.leftElement,
      leftElement,
      state.leftVisible,
      leftVisible,
      logicalChanged,
      ariaRowIndex,
      selectionMode,
      selected,
      true,
    );
    this.syncLane(
      state.rightElement,
      rightElement,
      state.rightVisible,
      rightVisible,
      logicalChanged,
      ariaRowIndex,
      selectionMode,
      selected,
      true,
    );

    state.initialized = true;
    state.rowId = rowId;
    state.rowIndex = rowIndex;
    state.ariaRowIndex = ariaRowIndex;
    state.selectionMode = selectionMode;
    state.selected = selected;
    state.centerElement = centerElement;
    state.leftElement = leftElement;
    state.rightElement = rightElement;
    state.centerVisible = centerVisible;
    state.leftVisible = leftVisible;
    state.rightVisible = rightVisible;
  }

  private syncLane(
    previousElement: HTMLElement | null,
    element: HTMLElement | null,
    previousVisible: boolean,
    visible: boolean,
    logicalChanged: boolean,
    ariaRowIndex: number,
    selectionMode: RowSelectionMode,
    selected: boolean,
    presentation: boolean,
  ): void {
    const elementChanged = previousElement !== element;
    if (elementChanged && previousElement !== null) {
      clearRowElementSemantics(previousElement);
    }
    if (element === null) return;

    if (!visible) {
      if (elementChanged || previousVisible || logicalChanged) {
        clearRowElementSemantics(element);
      }
      return;
    }

    if (elementChanged || !previousVisible || logicalChanged) {
      if (presentation) {
        applyPresentationRowElementSemantics(element);
      } else {
        applyRowElementSemantics(
          element,
          ariaRowIndex,
          selectionMode,
          selected,
        );
      }
    }
  }
}

/** One-shot compatibility helper for pure/integration tests. */
export function syncRowSemantics(
  ctx: DomGridFeatureContext,
  read: RowSemanticsRead,
): void {
  new RowSemanticsReconciler().syncStructure(ctx, read);
}

export function clearRowSemantics(ctx: DomGridFeatureContext): void {
  new RowSemanticsReconciler().clear(ctx);
}
