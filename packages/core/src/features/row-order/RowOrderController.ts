import type { PooledRow } from "../../internal/poolTypes";
import { ROW_DRAG_HANDLE_CLASS } from "../../internal/rowDragColumn";
import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type {
  RowData,
  RowDragNormalizedConfig,
} from "../../types";
import {
  attachDragListeners,
  hasExceededDragThreshold,
  startAutoScroll,
  suppressNextClick,
} from "../drag/index";

import {
  createRowDropIndicator,
  type RowDropIndicatorView,
  syncRowDropIndicator,
} from "./createRowDropIndicator";
import type { RowOrderStore } from "./RowOrderStore";
import type { RowOrderMoveRequest } from "./types";

export { ROW_DRAG_HANDLE_CLASS };
export const ROW_DRAG_ENABLED_CLASS = "lfg-row-drag-enabled";
export const ROW_DRAG_BLOCKED_CLASS = "lfg-row-drag-blocked";
const ROW_DRAG_ACTIVE_CLASS = "lfg-row-dragging";
const ROW_DRAG_SOURCE_CLASS = "lfg-row-drag-source";
const ROW_DROP_BEFORE_CLASS = "lfg-row-drop-before";
const ROW_DROP_AFTER_CLASS = "lfg-row-drop-after";

export interface RowOrderControllerDeps {
  getRowDragConfig: () => RowDragNormalizedConfig;
  isReorderBlocked?: () => boolean;
  /** Display-row reader backed by RowView — preferred for display-index lookups. */
  getDisplayRows: () => DisplayRowReader;
  getPool: () => PooledRow[];
  resolveRowId: (row: RowData, index: number) => string;
  getSelectedRowCountForRowOrder(): number;
  isRowSelectedForRowOrder(rowId: string): boolean;
  getSelectedRowIdsForRowOrder(): string[];
  getViewport?: () => HTMLElement | null;
  requestSync: () => void;
  onRowOrderChanged?: (e: RowOrderMoveRequest) => void;
  store: RowOrderStore;
}

type PreparedRowDrag = {
  rowIds: string[];
  movingRowIdSet: Set<string>;
  fromIndex: number;
  fromIndices: number[];
};

type ActiveDrag = {
  pointerId: number;
  rowId: string;
  startClientX: number;
  startClientY: number;
  dragStarted: boolean;
  detachListeners: () => void;
  prepared: PreparedRowDrag | null;
};

export function computeRowDropIndex(
  pool: readonly PooledRow[],
  clientY: number,
): number {
  const visible: { rowIndex: number; midY: number }[] = [];
  for (const pr of pool) {
    if (pr.rowIndex < 0) continue;
    const rect = pr.element.getBoundingClientRect();
    if (rect.height === 0) continue;
    visible.push({ rowIndex: pr.rowIndex, midY: rect.top + rect.height / 2 });
  }
  visible.sort((a, b) => a.rowIndex - b.rowIndex);

  for (const { rowIndex, midY } of visible) {
    if (clientY < midY) return rowIndex;
  }
  if (visible.length > 0) return visible[visible.length - 1]!.rowIndex + 1;
  return 0;
}

export class RowOrderController {
  private root: HTMLElement | null = null;
  private active: ActiveDrag | null = null;
  private stopAutoScrollFn: (() => void) | null = null;
  private stopClickSuppressFn: (() => void) | null = null;
  private lastDragClientY: number = 0;
  private readonly deps: RowOrderControllerDeps;
  private guardWarnFired = false;
  private pendingCommandRowIndex = -1;
  private pendingCommandAdjacentIndex = -1;
  private commandMoveScheduled = false;

  // Preview tracking — center rows
  private previewDragEls: Set<HTMLElement> = new Set();
  private previewDropEl: HTMLElement | null = null;
  private previewDropIsAfter = false;
  // Preview tracking — pinned-left rows (mirrored)
  private previewPinnedDragEls: Set<HTMLElement> = new Set();
  private previewPinnedDropEl: HTMLElement | null = null;
  // Preview tracking — pinned-right rows (mirrored)
  private previewRightPinnedDragEls: Set<HTMLElement> = new Set();
  private previewRightPinnedDropEl: HTMLElement | null = null;
  /** Surface-mounted rail + end caps (one continuous seam across lanes). */
  private dropIndicatorView: RowDropIndicatorView | null = null;

  constructor(deps: RowOrderControllerDeps) {
    this.deps = deps;
  }

  attach(root: HTMLElement): void {
    this.root = root;
    root.addEventListener("pointerdown", this.onPointerDown, true);
    this.syncConfig();
  }

  syncConfig(): void {
    if (!this.root) return;
    const cfgEnabled = this.deps.getRowDragConfig().enabled;
    const blocked = this.deps.isReorderBlocked?.() ?? false;
    const active = cfgEnabled && !blocked;
    this.root.classList.toggle(ROW_DRAG_ENABLED_CLASS, active);
    this.root.classList.toggle(ROW_DRAG_BLOCKED_CLASS, cfgEnabled && blocked);
    if (!active) {
      this.endDrag(null, false);
      this.clearPreview();
      this.stopAutoScroll();
    }
  }

  detach(): void {
    this.stopAutoScroll();
    this.stopClickSuppressFn?.();
    this.stopClickSuppressFn = null;
    this.clearPreview();
    this.endDrag(null, false);
    if (this.root) {
      this.root.classList.remove(ROW_DRAG_ACTIVE_CLASS);
      this.root.classList.remove(ROW_DRAG_ENABLED_CLASS);
      this.root.classList.remove(ROW_DRAG_BLOCKED_CLASS);
      this.root.removeEventListener("pointerdown", this.onPointerDown, true);
      this.root = null;
    }
    this.pendingCommandRowIndex = -1;
    this.pendingCommandAdjacentIndex = -1;
    this.commandMoveScheduled = false;
  }

  moveRowFromCommand(
    displayRowIndex: number,
    adjacentDisplayRowIndex: number,
  ): boolean {
    const config = this.deps.getRowDragConfig();
    if (
      !config.enabled ||
      config.managed === false ||
      this.deps.isReorderBlocked?.() ||
      !Number.isSafeInteger(displayRowIndex) ||
      !Number.isSafeInteger(adjacentDisplayRowIndex) ||
      displayRowIndex < 0 ||
      adjacentDisplayRowIndex < 0 ||
      displayRowIndex === adjacentDisplayRowIndex
    ) {
      return false;
    }
    this.pendingCommandRowIndex = displayRowIndex;
    this.pendingCommandAdjacentIndex = adjacentDisplayRowIndex;
    if (!this.commandMoveScheduled) {
      this.commandMoveScheduled = true;
      queueMicrotask(this.flushCommandMove);
    }
    return true;
  }

  private readonly flushCommandMove = (): void => {
    this.commandMoveScheduled = false;
    const fromIndex = this.pendingCommandRowIndex;
    const adjacentIndex = this.pendingCommandAdjacentIndex;
    this.pendingCommandRowIndex = -1;
    this.pendingCommandAdjacentIndex = -1;
    const displayRows = this.deps.getDisplayRows();
    if (
      fromIndex < 0 ||
      adjacentIndex < 0 ||
      fromIndex >= displayRows.rowCount ||
      adjacentIndex >= displayRows.rowCount
    ) {
      return;
    }
    const row = displayRows.getRowData(fromIndex);
    if (row === undefined) return;
    const rowId = this.deps.resolveRowId(row, fromIndex);
    const insertionIndex = adjacentIndex < fromIndex
      ? adjacentIndex
      : adjacentIndex + 1;
    this.deps.requestSync();
    this.deps.onRowOrderChanged?.({
      rowId,
      rowIds: [rowId],
      fromIndex,
      fromIndices: [fromIndex],
      insertionIndex,
      source: "keyboard",
    });
  };

  private stopAutoScroll(): void {
    this.stopAutoScrollFn?.();
    this.stopAutoScrollFn = null;
  }

  private clearPreview(): void {
    for (const el of this.previewDragEls) {
      el.classList.remove(ROW_DRAG_SOURCE_CLASS);
    }
    this.previewDragEls = new Set();
    if (this.previewDropEl) {
      this.previewDropEl.classList.remove(ROW_DROP_BEFORE_CLASS, ROW_DROP_AFTER_CLASS);
      this.previewDropEl = null;
    }
    // Clear mirrored pinned-left classes
    for (const el of this.previewPinnedDragEls) {
      el.classList.remove(ROW_DRAG_SOURCE_CLASS);
    }
    this.previewPinnedDragEls = new Set();
    if (this.previewPinnedDropEl) {
      this.previewPinnedDropEl.classList.remove(ROW_DROP_BEFORE_CLASS, ROW_DROP_AFTER_CLASS);
      this.previewPinnedDropEl = null;
    }
    // Clear mirrored pinned-right classes
    for (const el of this.previewRightPinnedDragEls) {
      el.classList.remove(ROW_DRAG_SOURCE_CLASS);
    }
    this.previewRightPinnedDragEls = new Set();
    if (this.previewRightPinnedDropEl) {
      this.previewRightPinnedDropEl.classList.remove(
        ROW_DROP_BEFORE_CLASS,
        ROW_DROP_AFTER_CLASS,
      );
      this.previewRightPinnedDropEl = null;
    }
    this.removeDropIndicator();
  }

  private removeDropIndicator(): void {
    const view = this.dropIndicatorView;
    if (!view) return;
    syncRowDropIndicator(view, {
      visible: false,
      topPx: 0,
      placement: "before",
    });
    view.root.remove();
    this.dropIndicatorView = null;
  }

  private syncDropIndicatorOverlay(
    dropEl: HTMLElement | null,
    isAfter: boolean,
  ): void {
    if (!this.root) return;

    if (!dropEl) {
      if (this.dropIndicatorView) {
        syncRowDropIndicator(this.dropIndicatorView, {
          visible: false,
          topPx: 0,
          placement: "before",
        });
      }
      return;
    }

    const surface =
      this.root.querySelector<HTMLElement>(".lfg-grid-surface") ?? this.root;
    let view = this.dropIndicatorView;
    if (!view) {
      view = createRowDropIndicator();
      surface.appendChild(view.root);
      this.dropIndicatorView = view;
    } else if (view.root.parentElement !== surface) {
      surface.appendChild(view.root);
    }

    const surfaceRect = surface.getBoundingClientRect();
    const rowRect = dropEl.getBoundingClientRect();
    const topPx = isAfter
      ? rowRect.bottom - surfaceRect.top
      : rowRect.top - surfaceRect.top;
    const placement = isAfter ? "after" : "before";

    syncRowDropIndicator(view, {
      visible: true,
      topPx,
      placement,
      statusText:
        placement === "after" ? "Drop after row" : "Drop before row",
    });
  }

  private readonly onPointerDown = (ev: PointerEvent): void => {
    if (this.active) return;
    if (ev.button !== 0) return;
    const cfg = this.deps.getRowDragConfig();
    if (!cfg.enabled) return;
    if (this.deps.isReorderBlocked?.()) return;

    const el =
      ev.target instanceof Element
        ? ev.target
        : (ev.target as Node | null)?.parentElement;
    if (!el) return;

    if (!el.closest(`.${ROW_DRAG_HANDLE_CLASS}`)) return;

    const rowEl = el.closest("[data-row-id]") as HTMLElement | null;
    if (!rowEl) return;
    const rowId = rowEl.getAttribute("data-row-id");
    if (!rowId) return;

    const onMove = (e: PointerEvent): void => {
      if (!this.active || e.pointerId !== this.active.pointerId) return;
      const act = this.active;
      if (!act.dragStarted) {
        if (
          !hasExceededDragThreshold(
            act.startClientX,
            act.startClientY,
            e.clientX,
            e.clientY,
          )
        )
          return;
        if (!this.beginRealDrag(act, e)) return;
      }
      this.lastDragClientY = e.clientY;
      this.updateDragPreview(e.clientY);
    };

    const onUp = (e: PointerEvent): void => {
      this.endDrag(e, true);
    };

    const onCancel = (e: PointerEvent): void => {
      this.endDrag(e, false);
    };

    this.active = {
      pointerId: ev.pointerId,
      rowId,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      dragStarted: false,
      detachListeners: attachDragListeners(onMove, onUp, onCancel),
      prepared: null,
    };
  };

  private prepareDragRows(rowId: string): PreparedRowDrag | null {
    const cfg = this.deps.getRowDragConfig();
    const displayRows = this.deps.getDisplayRows();
    const totalRows = displayRows.rowCount;

    const rowIdsInOrder: string[] = [];
    const indexById = new Map<string, number>();
    let fromIndex = -1;

    for (let i = 0; i < totalRows; i++) {
      const row = displayRows.getRowData(i);
      if (row === undefined) continue;
      const id = this.deps.resolveRowId(row, i);
      rowIdsInOrder.push(id);
      indexById.set(id, i);
      if (id === rowId) fromIndex = i;
    }
    if (fromIndex === -1) return null;

    this.deps.store.syncRowIds(rowIdsInOrder);

    const selectedCount = this.deps.getSelectedRowCountForRowOrder();
    const isDraggedRowSelected = this.deps.isRowSelectedForRowOrder(rowId);

    if (isDraggedRowSelected && selectedCount > 1) {
      if (
        selectedCount > cfg.maxMultiRowDragCount ||
        (totalRows > 0 && selectedCount / totalRows > cfg.maxMultiRowDragRatio)
      ) {
        this.warnGuardrailOnce();
        return {
          rowIds: [rowId],
          movingRowIdSet: new Set([rowId]),
          fromIndex,
          fromIndices: [fromIndex],
        };
      }

      const selectedIds = this.deps.getSelectedRowIdsForRowOrder();
      const selectedSet = new Set(selectedIds);
      const movingRowIds = rowIdsInOrder.filter((id) => selectedSet.has(id));
      const fromIndices = movingRowIds.map((id) => indexById.get(id)!);
      return {
        rowIds: movingRowIds,
        movingRowIdSet: new Set(movingRowIds),
        fromIndex,
        fromIndices,
      };
    }

    return {
      rowIds: [rowId],
      movingRowIdSet: new Set([rowId]),
      fromIndex,
      fromIndices: [fromIndex],
    };
  }

  private warnGuardrailOnce(): void {
    if (this.guardWarnFired) return;
    this.guardWarnFired = true;
    console.warn(
      "[LightFastGrid] Multi-row drag reduced to the dragged row " +
      "because the selected row count is too large. Configure " +
      "rowDrag.maxMultiRowDragCount or rowDrag.maxMultiRowDragRatio " +
      "to change this.",
    );
  }

  /** Returns false if drag preparation failed (rowId not found). */
  private beginRealDrag(act: ActiveDrag, e: PointerEvent): boolean {
    if (act.dragStarted) return true;

    const prepared = this.prepareDragRows(act.rowId);
    if (!prepared) {
      this.endDrag(null, false);
      return false;
    }

    act.prepared = prepared;
    act.dragStarted = true;
    e.preventDefault();
    this.root?.classList.add(ROW_DRAG_ACTIVE_CLASS);
    this.stopAutoScroll();
    this.stopAutoScrollFn = startAutoScroll({
      axis: "y",
      getViewport: () => this.deps.getViewport?.() ?? null,
      getClientPos: () => ({ x: 0, y: this.lastDragClientY }),
      shouldContinue: () => this.active?.dragStarted ?? false,
    });
    return true;
  }

  private updateDragPreview(clientY: number): void {
    const act = this.active;
    if (!act || !act.dragStarted || !act.prepared) return;

    const pool = this.deps.getPool();
    const dropIndex = computeRowDropIndex(pool, clientY);

    const newDragEls = new Set<HTMLElement>();
    const newPinnedDragEls = new Set<HTMLElement>();
    const newRightPinnedDragEls = new Set<HTMLElement>();
    const visibleByIndex = new Map<number, HTMLElement>();
    const pinnedByIndex = new Map<number, HTMLElement>();
    const rightPinnedByIndex = new Map<number, HTMLElement>();
    for (const pr of pool) {
      if (pr.rowIndex < 0) continue;
      visibleByIndex.set(pr.rowIndex, pr.element);
      if (pr.pinnedElement) pinnedByIndex.set(pr.rowIndex, pr.pinnedElement);
      if (pr.rightPinnedElement) {
        rightPinnedByIndex.set(pr.rowIndex, pr.rightPinnedElement);
      }
      if (act.prepared.movingRowIdSet.has(pr.rowId ?? "")) {
        newDragEls.add(pr.element);
        if (pr.pinnedElement) newPinnedDragEls.add(pr.pinnedElement);
        if (pr.rightPinnedElement) newRightPinnedDragEls.add(pr.rightPinnedElement);
      }
    }

    // Determine drop indicator element and side
    let newDropEl: HTMLElement | null = null;
    let newPinnedDropEl: HTMLElement | null = null;
    let newRightPinnedDropEl: HTMLElement | null = null;
    let isAfter = false;
    if (visibleByIndex.has(dropIndex)) {
      newDropEl = visibleByIndex.get(dropIndex)!;
      newPinnedDropEl = pinnedByIndex.get(dropIndex) ?? null;
      newRightPinnedDropEl = rightPinnedByIndex.get(dropIndex) ?? null;
      isAfter = false;
    } else if (dropIndex > 0 && visibleByIndex.has(dropIndex - 1)) {
      newDropEl = visibleByIndex.get(dropIndex - 1)!;
      newPinnedDropEl = pinnedByIndex.get(dropIndex - 1) ?? null;
      newRightPinnedDropEl = rightPinnedByIndex.get(dropIndex - 1) ?? null;
      isAfter = true;
    }

    // Remove stale drag-source classes (center)
    for (const el of this.previewDragEls) {
      if (!newDragEls.has(el)) {
        el.classList.remove(ROW_DRAG_SOURCE_CLASS);
      }
    }
    // Add new drag-source classes (center)
    for (const el of newDragEls) {
      el.classList.add(ROW_DRAG_SOURCE_CLASS);
    }
    this.previewDragEls = newDragEls;

    // Mirror drag-source to pinned-left rows
    for (const el of this.previewPinnedDragEls) {
      if (!newPinnedDragEls.has(el)) {
        el.classList.remove(ROW_DRAG_SOURCE_CLASS);
      }
    }
    for (const el of newPinnedDragEls) {
      el.classList.add(ROW_DRAG_SOURCE_CLASS);
    }
    this.previewPinnedDragEls = newPinnedDragEls;

    // Mirror drag-source to pinned-right rows
    for (const el of this.previewRightPinnedDragEls) {
      if (!newRightPinnedDragEls.has(el)) {
        el.classList.remove(ROW_DRAG_SOURCE_CLASS);
      }
    }
    for (const el of newRightPinnedDragEls) {
      el.classList.add(ROW_DRAG_SOURCE_CLASS);
    }
    this.previewRightPinnedDragEls = newRightPinnedDragEls;

    // Update drop indicator (center)
    const dropSideChanged = this.previewDropIsAfter !== isAfter;
    if (this.previewDropEl !== newDropEl || dropSideChanged) {
      this.previewDropEl?.classList.remove(ROW_DROP_BEFORE_CLASS, ROW_DROP_AFTER_CLASS);
    }
    if (newDropEl) {
      newDropEl.classList.add(isAfter ? ROW_DROP_AFTER_CLASS : ROW_DROP_BEFORE_CLASS);
    }
    this.previewDropEl = newDropEl;
    this.previewDropIsAfter = isAfter;

    // Mirror drop indicator to pinned-left rows
    if (this.previewPinnedDropEl !== newPinnedDropEl || dropSideChanged) {
      this.previewPinnedDropEl?.classList.remove(
        ROW_DROP_BEFORE_CLASS,
        ROW_DROP_AFTER_CLASS,
      );
    }
    if (newPinnedDropEl) {
      newPinnedDropEl.classList.add(
        isAfter ? ROW_DROP_AFTER_CLASS : ROW_DROP_BEFORE_CLASS,
      );
    }
    this.previewPinnedDropEl = newPinnedDropEl;

    // Mirror drop indicator to pinned-right rows
    if (this.previewRightPinnedDropEl !== newRightPinnedDropEl || dropSideChanged) {
      this.previewRightPinnedDropEl?.classList.remove(
        ROW_DROP_BEFORE_CLASS,
        ROW_DROP_AFTER_CLASS,
      );
    }
    if (newRightPinnedDropEl) {
      newRightPinnedDropEl.classList.add(
        isAfter ? ROW_DROP_AFTER_CLASS : ROW_DROP_BEFORE_CLASS,
      );
    }
    this.previewRightPinnedDropEl = newRightPinnedDropEl;

    this.syncDropIndicatorOverlay(newDropEl, isAfter);
  }

  private endDrag(ev: PointerEvent | null, commit: boolean): void {
    const act = this.active;
    if (!act) return;
    if (ev !== null && ev.pointerId !== act.pointerId) return;

    const dragStarted = act.dragStarted;
    const suppressClick = dragStarted && ev !== null && ev.type === "pointerup";

    this.stopAutoScroll();
    act.detachListeners();
    this.clearPreview();
    this.root?.classList.remove(ROW_DRAG_ACTIVE_CLASS);
    this.active = null;

    if (suppressClick && this.root) {
      this.stopClickSuppressFn?.();
      this.stopClickSuppressFn = suppressNextClick(this.root);
    }

    if (!commit || ev === null || !dragStarted || !act.prepared) return;

    const insertionIndex = computeRowDropIndex(this.deps.getPool(), ev.clientY);
    const result = this.deps.store.moveMany(act.prepared.rowIds, insertionIndex);
    if (!result?.changed) return;

    this.deps.requestSync();
    this.deps.onRowOrderChanged?.({
      rowId: act.rowId,
      rowIds: result.movedRowIds,
      fromIndex: act.prepared.fromIndex,
      fromIndices: act.prepared.fromIndices,
      insertionIndex,
      source: "drag",
    });
  }
}
