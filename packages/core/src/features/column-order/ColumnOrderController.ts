import { isInternalColumn } from "../../internal/internalColumns";
import type {
  ColumnDef,
  ColumnOrderConfig,
  LightFastGridColumnOrderChangedEvent,
} from "../../types";
import {
  attachDragListeners,
  hasExceededDragThreshold,
  startAutoScroll,
  suppressNextClick,
} from "../drag/index";

import type { ColumnOrderStore } from "./ColumnOrderStore";
import {
  type ColumnDropIndicatorView,
  type ColumnDropPlacement,
  createColumnDropIndicator,
  syncColumnDropIndicator,
} from "./createColumnDropIndicator";

export { DRAG_START_THRESHOLD_PX } from "../drag/DragSession";

const HEADER_CELL = "lfg-header-cell";

/** Added to the grid root while column drag-reorder UX is enabled. */
export const COLUMN_ORDER_ENABLED_CLASS = "lfg-column-order-enabled";

/** Viewport edge zone (px) that triggers horizontal auto-scroll during drag. */
const SCROLL_ZONE_PX = 80;
/** Maximum scroll delta per animation frame when pointer is at the very edge. */
const MAX_SCROLL_SPEED_PX = 20;
// These constants are forwarded to startAutoScroll; kept here for locality.

/** Data attribute used to identify the per-drag preview <style> element. */
const PREVIEW_STYLE_ATTR = "data-lfg-col-order-preview";

const DRAG_SOURCE_OPACITY = ".55";

function columnPinLane(column: ColumnDef): "left" | "center" | "right" {
  if (column.pinned === "left") return "left";
  if (column.pinned === "right") return "right";
  return "center";
}

function cssEscapeField(field: string): string {
  return typeof CSS !== "undefined" && "escape" in CSS
    ? CSS.escape(field)
    : field.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Generates a compact CSS string that applies drag-preview visual state to
 * **both** `.lfg-header-cell` and `.lfg-cell` elements by `data-col-id`.
 *
 * Drop-edge inset shadows are intentionally omitted: the DOM drop indicator
 * owns the insertion seam. A second full-height inset line would paint
 * through the indicator's end caps.
 *
 * One call per animation frame; one `textContent` write to a `<style>` element
 * — no per-cell iteration, no inline styles.
 */
export function buildColumnPreviewCSS(
  movingFieldSet: Set<string>,
  shifts: Map<string, "left" | "right">,
  dropField: string | null = null,
  dropSide: "before" | "after" | null = null,
): string {
  const parts: string[] = [];
  void shifts;
  void dropField;
  void dropSide;
  for (const field of movingFieldSet) {
    const e = cssEscapeField(field);
    parts.push(
      `.lfg-grid .lfg-header-cell[data-col-id="${e}"],` +
        `.lfg-grid .lfg-cell[data-col-id="${e}"]` +
        `{opacity:${DRAG_SOURCE_OPACITY}}`,
    );
  }
  return parts.join("");
}

export interface ColumnOrderControllerDeps {
  getColumnOrderConfig: () => ColumnOrderConfig;
  getColumns: () => ColumnDef[];
  getHeaderRowEl: () => HTMLDivElement | null;
  getViewport?: () => HTMLElement | null;
  getSelectedColumnIdsForColumnOrder: () => string[];
  requestColumnTransformSync: () => void;
  onColumnOrderChanged?: (e: LightFastGridColumnOrderChangedEvent) => void;
  store: ColumnOrderStore;
}

type ActiveDrag = {
  pointerId: number;
  field: string;
  sourceCell: HTMLElement;
  movingFieldSet: Set<string>;
  dropIndicator: HTMLDivElement | null;
  dropIndicatorView: ColumnDropIndicatorView | null;
  startClientX: number;
  startClientY: number;
  dragStarted: boolean;
  /** Removes the document pointermove/pointerup/pointercancel listeners. */
  detachListeners: () => void;
};

function userHeaderCells(headerRow: HTMLElement): HTMLElement[] {
  return Array.from(
    headerRow.querySelectorAll<HTMLElement>(`.${HEADER_CELL}[data-col-id]`),
  ).filter((el) => {
    const id = el.getAttribute("data-col-id");
    if (!id) return false;
    return !isInternalColumn({ field: id, internal: undefined });
  });
}

/** Visible user header cell aligned with global {@link ColumnDef} order (by field). */
export type VisibleHeaderEntry = {
  el: HTMLElement;
  field: string;
  globalIndex: number;
};

/**
 * Collect user header cells from the DOM and sort by on-screen position (left edge).
 * Ring-buffer / virtualization may leave `querySelectorAll` order unrelated to visual order.
 */
export function collectVisibleUserHeaderEntries(
  headerRow: HTMLElement,
  globalFields: readonly string[],
): VisibleHeaderEntry[] {
  const indexByField = new Map(globalFields.map((f, i) => [f, i] as const));
  const raw = Array.from(
    headerRow.querySelectorAll<HTMLElement>(`.${HEADER_CELL}[data-col-id]`),
  );
  const out: VisibleHeaderEntry[] = [];
  for (const el of raw) {
    const id = el.getAttribute("data-col-id");
    if (!id || isInternalColumn({ field: id, internal: undefined })) continue;
    const gi = indexByField.get(id);
    if (gi === undefined) continue;
    out.push({ el, field: id, globalIndex: gi });
  }
  out.sort((a, b) => {
    const ra = a.el.getBoundingClientRect();
    const rb = b.el.getBoundingClientRect();
    if (ra.left !== rb.left) return ra.left - rb.left;
    return a.globalIndex - b.globalIndex;
  });
  return out;
}

/**
 * Global insertion slot 0..n (n = full user column count): before column at that index,
 * or n after the last column. Uses visible headers only for hit-testing against midpoints.
 */
export function computeGlobalDropIndexFromVisible(
  clientX: number,
  visibleSorted: readonly VisibleHeaderEntry[],
): number {
  if (visibleSorted.length === 0) return 0;
  const first = visibleSorted[0]!;
  const r0 = first.el.getBoundingClientRect();
  if (clientX < r0.left) return first.globalIndex;
  for (let i = 0; i < visibleSorted.length; i++) {
    const entry = visibleSorted[i]!;
    const r = entry.el.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    if (clientX < mid) return entry.globalIndex;
  }
  const last = visibleSorted[visibleSorted.length - 1]!;
  return last.globalIndex + 1;
}

function globalDropIndicatorPlacement(
  globalDropIdx: number,
  globalFields: readonly string[],
  visibleSorted: readonly VisibleHeaderEntry[],
): { kind: "before" | "after"; el: HTMLElement } | null {
  if (visibleSorted.length === 0) return null;
  const n = globalFields.length;
  const first = visibleSorted[0]!;
  if (globalDropIdx <= first.globalIndex) {
    return { kind: "before", el: first.el };
  }
  if (globalDropIdx >= n) {
    const last = visibleSorted[visibleSorted.length - 1]!;
    return { kind: "after", el: last.el };
  }
  for (const v of visibleSorted) {
    if (v.globalIndex >= globalDropIdx) return { kind: "before", el: v.el };
  }
  const last = visibleSorted[visibleSorted.length - 1]!;
  return { kind: "after", el: last.el };
}

/**
 * Returns an insertion slot in **array** order for the given `cells` sequence only.
 * Prefer {@link computeGlobalDropIndexFromVisible} for real header rows under virtualization.
 */
export function pickUserDropIndex(
  clientX: number,
  cells: HTMLElement[],
): number {
  if (cells.length === 0) return 0;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell) continue;
    const r = cell.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    if (clientX < mid) return i;
  }
  return cells.length;
}

function isInteractiveHeaderTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      "button, input, select, textarea, option, [contenteditable='true']",
    ) !== null
  );
}

function isUserColumnReorderable(col: ColumnDef | undefined): boolean {
  return col !== undefined && col.reorderable !== false;
}

function movingFieldsForDrag(
  draggedField: string,
  userCols: ColumnDef[],
  selected: readonly string[],
): string[] {
  const colByField = new Map(userCols.map((c) => [c.field, c] as const));
  const selectedSet = new Set(selected);
  const draggedIsSelected = selectedSet.has(draggedField);

  const visibleSelectedReorderableInOrder = userCols
    .map((c) => c.field)
    .filter(
      (f) => selectedSet.has(f) && isUserColumnReorderable(colByField.get(f)),
    );

  if (draggedIsSelected && visibleSelectedReorderableInOrder.length > 1) {
    return visibleSelectedReorderableInOrder;
  }
  return [draggedField];
}

/** Indices of header cells whose field is in the moving set (non-contiguous OK). */
export function getMovingIndices(
  cells: HTMLElement[],
  movingFieldSet: Set<string>,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const id = cells[i]?.getAttribute("data-col-id");
    if (id && movingFieldSet.has(id)) out.push(i);
  }
  return out;
}

function fieldsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function orderedMovingFieldsInOrder(
  order: readonly string[],
  movingFieldSet: Set<string>,
): string[] {
  return order.filter((f) => movingFieldSet.has(f));
}

/**
 * Simulates {@link ColumnOrderStore#moveMany} field order for a candidate drop
 * slot (same insertion-slot / adjusted-slot rules as the store).
 */
export function previewOrderForDrop(
  order: readonly string[],
  movingFieldSet: Set<string>,
  dropIdx: number,
): string[] {
  const movingBlock = orderedMovingFieldsInOrder(order, movingFieldSet);
  if (movingBlock.length === 0) return [...order];

  const fromIndices = movingBlock.map((f) => order.indexOf(f));
  const n = order.length;
  const insertionSlot = Math.max(0, Math.min(dropIdx, n));
  const removedBeforeInsertion = fromIndices.filter(
    (i) => i < insertionSlot,
  ).length;
  const adjustedInsertion = insertionSlot - removedBeforeInsertion;
  const remaining = order.filter((f) => !movingFieldSet.has(f));
  const insertAt = Math.max(
    0,
    Math.min(adjustedInsertion, remaining.length),
  );
  const next = [...remaining];
  next.splice(insertAt, 0, ...movingBlock);
  return next;
}

export function isNoopPreview(
  order: readonly string[],
  movingFieldSet: Set<string>,
  dropIdx: number,
): boolean {
  return fieldsEqual(order, previewOrderForDrop(order, movingFieldSet, dropIdx));
}

/**
 * Non-moving fields whose index changes under {@link previewOrderForDrop}.
 * Used to apply shift-left / shift-right hints on header cells.
 */
export function shiftedFieldsForPreview(
  order: readonly string[],
  movingFieldSet: Set<string>,
  dropIdx: number,
): Map<string, "left" | "right"> {
  const next = previewOrderForDrop(order, movingFieldSet, dropIdx);
  const map = new Map<string, "left" | "right">();
  for (let i = 0; i < order.length; i++) {
    const f = order[i];
    if (!f || movingFieldSet.has(f)) continue;
    const newIdx = next.indexOf(f);
    if (newIdx < i) map.set(f, "left");
    else if (newIdx > i) map.set(f, "right");
  }
  return map;
}

/**
 * Header pointer drag to reorder user columns. Commits on pointerup only.
 */
export class ColumnOrderController {
  private root: HTMLElement | null = null;
  private active: ActiveDrag | null = null;
  private previewRafId: number | null = null;
  private pendingPreviewClientX: number | null = null;
  private stopClickSuppressFn: (() => void) | null = null;
  private stopAutoScrollFn: (() => void) | null = null;
  private lastDragClientX: number = 0;
  private previewStyleEl: HTMLStyleElement | null = null;
  private readonly deps: ColumnOrderControllerDeps;
  private commandColumns: readonly ColumnDef[] = [];
  private commandIndexByField = new Map<string, number>();
  private pendingCommandField: string | null = null;
  private pendingCommandDelta: -1 | 1 = 1;
  private commandMoveScheduled = false;

  constructor(deps: ColumnOrderControllerDeps) {
    this.deps = deps;
  }

  attach(root: HTMLElement): void {
    this.root = root;
    root.addEventListener("pointerdown", this.onPointerDown, true);
    this.syncConfig();
  }

  /**
   * Sync root enabled class from `columnOrder.enabled`.
   * Mirrors row-drag's `lfg-row-drag-enabled` so header drag handles stay
   * CSS-hidden when the feature is off (even if handles remain in the DOM).
   */
  syncConfig(): void {
    if (!this.root) return;
    const enabled = this.deps.getColumnOrderConfig().enabled;
    this.root.classList.toggle(COLUMN_ORDER_ENABLED_CLASS, enabled);
    if (!enabled) {
      this.endDrag(null, false);
    }
  }

  detach(): void {
    this.stopAutoScroll();
    this.teardownClickSuppress();
    this.endDrag(null, false);
    if (this.root) {
      this.root.classList.remove(COLUMN_ORDER_ENABLED_CLASS);
      this.root.removeEventListener("pointerdown", this.onPointerDown, true);
      this.root = null;
    }
    this.commandColumns = [];
    this.commandIndexByField.clear();
    this.pendingCommandField = null;
    this.commandMoveScheduled = false;
  }

  syncCommandColumns(columns: readonly ColumnDef[]): void {
    const left: ColumnDef[] = [];
    const center: ColumnDef[] = [];
    const right: ColumnDef[] = [];
    for (const column of columns) {
      if (isInternalColumn(column) || column.visible === false) continue;
      if (column.pinned === "left") left.push(column);
      else if (column.pinned === "right") right.push(column);
      else center.push(column);
    }
    const ordered = [...left, ...center, ...right];
    const index = new Map<string, number>();
    for (let i = 0; i < ordered.length; i += 1) {
      index.set(ordered[i]!.field, i);
    }
    this.commandColumns = ordered;
    this.commandIndexByField = index;
  }

  moveColumnFromCommand(field: string, visualDelta: -1 | 1): boolean {
    if (!this.deps.getColumnOrderConfig().enabled) return false;
    const index = this.commandIndexByField.get(field);
    if (index === undefined) return false;
    const column = this.commandColumns[index];
    const adjacent = this.commandColumns[index + visualDelta];
    if (
      column === undefined ||
      !isUserColumnReorderable(column) ||
      adjacent === undefined ||
      columnPinLane(column) !== columnPinLane(adjacent)
    ) {
      return false;
    }
    this.pendingCommandField = field;
    this.pendingCommandDelta = visualDelta;
    if (!this.commandMoveScheduled) {
      this.commandMoveScheduled = true;
      queueMicrotask(this.flushCommandMove);
    }
    return true;
  }

  private readonly flushCommandMove = (): void => {
    this.commandMoveScheduled = false;
    const field = this.pendingCommandField;
    const delta = this.pendingCommandDelta;
    this.pendingCommandField = null;
    if (field === null) return;
    const visualIndex = this.commandIndexByField.get(field);
    const adjacent = visualIndex === undefined
      ? undefined
      : this.commandColumns[visualIndex + delta];
    if (visualIndex === undefined || adjacent === undefined) return;
    const userColumns = this.userColumns();
    const adjacentIndex = userColumns.findIndex(
      (column) => column.field === adjacent.field,
    );
    if (adjacentIndex < 0) return;
    const insertionIndex = delta < 0 ? adjacentIndex : adjacentIndex + 1;
    const result = this.deps.store.move(field, insertionIndex, userColumns);
    if (!result?.changed) return;
    this.deps.requestColumnTransformSync();
    this.deps.onColumnOrderChanged?.({
      columnOrder: result.order,
      movedColumnId: result.movedColumnId,
      fromIndex: result.fromIndex,
      toIndex: result.toIndex,
      source: "keyboard",
    });
  };

  private teardownClickSuppress(): void {
    this.stopClickSuppressFn?.();
    this.stopClickSuppressFn = null;
  }

  private cancelPreviewRaf(): void {
    if (this.previewRafId !== null) {
      cancelAnimationFrame(this.previewRafId);
      this.previewRafId = null;
    }
    this.pendingPreviewClientX = null;
  }

  private stopAutoScroll(): void {
    this.stopAutoScrollFn?.();
    this.stopAutoScrollFn = null;
  }

  private ensurePreviewStyleEl(): HTMLStyleElement {
    if (!this.previewStyleEl) {
      const el = document.createElement("style");
      el.setAttribute(PREVIEW_STYLE_ATTR, "");
      document.head!.appendChild(el);
      this.previewStyleEl = el;
    }
    return this.previewStyleEl;
  }

  private removePreviewStyleEl(): void {
    this.previewStyleEl?.remove();
    this.previewStyleEl = null;
  }

  private startAutoScrollLoop(): void {
    this.stopAutoScroll();
    this.stopAutoScrollFn = startAutoScroll({
      axis: "x",
      getViewport: () => this.deps.getViewport?.() ?? null,
      getClientPos: () => ({ x: this.lastDragClientX, y: 0 }),
      shouldContinue: () => this.active?.dragStarted ?? false,
      zoneSize: SCROLL_ZONE_PX,
      maxSpeed: MAX_SCROLL_SPEED_PX,
    });
  }

  private clearDragPreview(act: ActiveDrag): void {
    this.removePreviewStyleEl();
    const row = this.deps.getHeaderRowEl();
    const live = row ? userHeaderCells(row) : [];
    const seen = new Set<HTMLElement>();
    for (const el of [...live, act.sourceCell]) {
      if (seen.has(el)) continue;
      seen.add(el);
      el.classList.remove(
        "lfg-column-drag-source",
        "lfg-column-shift-left",
        "lfg-column-shift-right",
        "lfg-column-drop-before",
        "lfg-column-drop-after",
      );
    }
    act.sourceCell.classList.remove(
      "lfg-column-drag-source",
      "lfg-column-shift-left",
      "lfg-column-shift-right",
      "lfg-column-drop-before",
      "lfg-column-drop-after",
    );
    act.dropIndicator?.remove();
    act.dropIndicator = null;
    act.dropIndicatorView = null;
  }

  private updateDragPreview(clientX: number): void {
    const act = this.active;
    if (!act || !this.root || !act.dragStarted) return;

    const row = this.deps.getHeaderRowEl();
    if (!row) return;

    const userCols = this.userColumns();
    const globalFields = userCols.map((c) => c.field);
    // Re-collect fresh after any horizontal scroll; do not cache across frames.
    const visibleSorted = collectVisibleUserHeaderEntries(row, globalFields);
    const dropIdx = computeGlobalDropIndexFromVisible(clientX, visibleSorted);

    // Clear all drag classes from currently-visible cells.
    for (const { el } of visibleSorted) {
      el.classList.remove(
        "lfg-column-drag-source",
        "lfg-column-shift-left",
        "lfg-column-shift-right",
        "lfg-column-drop-before",
        "lfg-column-drop-after",
      );
    }

    // Reapply drag-source to visible cells for moving fields.
    // Necessary because ring-buffer may have rebound cells during horizontal scroll.
    for (const { el, field: fid } of visibleSorted) {
      if (act.movingFieldSet.has(fid)) {
        el.classList.add("lfg-column-drag-source");
      }
    }

    const noop = isNoopPreview(globalFields, act.movingFieldSet, dropIdx);
    const shifts = noop
      ? new Map<string, "left" | "right">()
      : shiftedFieldsForPreview(globalFields, act.movingFieldSet, dropIdx);

    // Compute drop target field/side before writing CSS (needed for body drop line).
    const place = noop
      ? null
      : globalDropIndicatorPlacement(dropIdx, globalFields, visibleSorted);
    const dropField = place?.el.getAttribute("data-col-id") ?? null;
    const dropSide = place?.kind ?? null;

    // One textContent write: opacity and drop box-shadow for header + body.
    this.ensurePreviewStyleEl().textContent = buildColumnPreviewCSS(
      act.movingFieldSet,
      shifts,
      dropField,
      dropSide,
    );

    if (noop || !place || !dropSide) {
      if (act.dropIndicatorView) {
        syncColumnDropIndicator(act.dropIndicatorView, {
          visible: false,
          leftPx: 0,
          badgeTopPx: 0,
          placement: "before",
        });
      }
      return;
    }

    for (const { el, field: fid } of visibleSorted) {
      if (act.movingFieldSet.has(fid)) continue;
      const dir = shifts.get(fid);
      if (dir === "left") el.classList.add("lfg-column-shift-left");
      else if (dir === "right") el.classList.add("lfg-column-shift-right");
    }

    let view = act.dropIndicatorView;
    const surface =
      this.root.querySelector<HTMLElement>(".lfg-grid-surface") ?? this.root;
    if (!view) {
      view = createColumnDropIndicator();
      surface.appendChild(view.root);
      act.dropIndicatorView = view;
      act.dropIndicator = view.root;
    }

    const surfaceRect = surface.getBoundingClientRect();
    const cr = place.el.getBoundingClientRect();
    // Full sticky header band (leaf titles + floating filters), not leaf-only.
    const headerBand =
      (row.closest(".lfg-header") as HTMLElement | null) ??
      this.root.querySelector<HTMLElement>(".lfg-header") ??
      row;
    const headerRect = headerBand.getBoundingClientRect();
    const bandTop = Math.max(0, headerRect.top - surfaceRect.top);
    // Sit the chip ~80px down the seam (below header chrome / upper body).
    const badgeTopPx = bandTop + 80;
    const leftPx =
      dropSide === "before"
        ? cr.left - surfaceRect.left
        : cr.right - surfaceRect.left;
    const placement = dropSide as ColumnDropPlacement;
    const headerLabel = place.el.querySelector(".lfg-header-label");
    const targetLabel =
      (headerLabel?.textContent ?? "").trim() || dropField || "column";
    const relation = placement === "before" ? "before" : "after";

    syncColumnDropIndicator(view, {
      visible: true,
      leftPx,
      badgeTopPx,
      placement,
      title: "Insert",
      detail: targetLabel,
      statusText: `Insert column ${relation} ${targetLabel}`,
    });
  }

  private scheduleClickSuppress(): void {
    const root = this.root;
    if (!root) return;
    this.teardownClickSuppress();
    this.stopClickSuppressFn = suppressNextClick(root);
  }

  private beginRealDrag(act: ActiveDrag, e: PointerEvent): void {
    if (act.dragStarted) return;
    act.dragStarted = true;
    e.preventDefault();
    const headerRow = this.deps.getHeaderRowEl();
    if (headerRow) {
      for (const f of act.movingFieldSet) {
        const escaped = cssEscapeField(f);
        const el = headerRow.querySelector<HTMLElement>(
          `.${HEADER_CELL}[data-col-id="${escaped}"]`,
        );
        if (el) el.classList.add("lfg-column-drag-source");
      }
    }
    this.ensurePreviewStyleEl().textContent = buildColumnPreviewCSS(
      act.movingFieldSet,
      new Map(),
    );
    this.root?.classList.add("lfg-column-order-dragging");
    this.startAutoScrollLoop();
  }

  private readonly onPointerDown = (ev: PointerEvent): void => {
    if (this.active) return;
    if (ev.button !== 0) return;
    if (!this.deps.getColumnOrderConfig().enabled) return;

    const t = ev.target;
    if (!(t instanceof Node)) return;

    if (isInteractiveHeaderTarget(t)) return;

    const el = t instanceof Element ? t : t.parentElement;
    if (!el) return;
    // Resize handle takes priority and must not start reorder.
    if (el.closest(".lfg-resize-handle")) return;
    // Only the dedicated drag handle starts column reorder; cell body clicks
    // remain reserved for selection / sort / other header actions.
    if (!el.closest(".lfg-column-drag-handle")) return;

    const cell = el.closest(`.${HEADER_CELL}`) as HTMLElement | null;
    if (!cell) return;

    const field = cell.getAttribute("data-col-id");
    if (!field) return;
    if (isInternalColumn({ field, internal: undefined })) return;

    const userCols = this.userColumns();
    const colDef = userCols.find((c) => c.field === field);
    if (!colDef || !isUserColumnReorderable(colDef)) return;

    const headerRow = this.deps.getHeaderRowEl();
    if (!headerRow || !headerRow.contains(cell)) return;

    const selected = this.deps.getSelectedColumnIdsForColumnOrder();
    const moving = movingFieldsForDrag(field, userCols, selected);
    const movingFieldSet = new Set(moving);

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
        this.beginRealDrag(act, e);
      }
      this.lastDragClientX = e.clientX;
      this.pendingPreviewClientX = e.clientX;
      if (this.previewRafId !== null) return;
      this.previewRafId = requestAnimationFrame(() => {
        this.previewRafId = null;
        if (!this.active?.dragStarted) return;
        const cx = this.pendingPreviewClientX;
        if (cx === null) return;
        this.updateDragPreview(cx);
      });
    };

    const onUp = (e: PointerEvent): void => {
      this.endDrag(e, true);
    };

    const onCancel = (e: PointerEvent): void => {
      this.endDrag(e, false);
    };

    this.active = {
      pointerId: ev.pointerId,
      field,
      sourceCell: cell,
      movingFieldSet,
      dropIndicator: null,
      dropIndicatorView: null,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      dragStarted: false,
      detachListeners: attachDragListeners(onMove, onUp, onCancel),
    };
  };

  private endDrag(ev: PointerEvent | null, commit: boolean): void {
    const act = this.active;
    if (!act) return;
    if (ev !== null && ev.pointerId !== act.pointerId) return;

    const dragStarted = act.dragStarted;
    const suppressClick =
      dragStarted && ev !== null && ev.type === "pointerup";

    this.stopAutoScroll();
    this.cancelPreviewRaf();
    act.detachListeners();

    if (dragStarted) {
      this.clearDragPreview(act);
    } else {
      act.dropIndicator?.remove();
      act.dropIndicator = null;
      act.dropIndicatorView = null;
    }

    this.root?.classList.remove("lfg-column-order-dragging");
    this.active = null;

    if (suppressClick) {
      this.scheduleClickSuppress();
    }

    if (!commit || ev === null || !dragStarted) return;

    const actRef = act;
    const userCols = this.userColumns();
    const toIdx = this.computeDropIndex(ev.clientX);
    const selected = this.deps.getSelectedColumnIdsForColumnOrder();
    const movingFields = movingFieldsForDrag(actRef.field, userCols, selected);

    if (movingFields.length > 1) {
      const result = this.deps.store.moveMany(movingFields, toIdx, userCols);
      if (!result?.changed) return;
      this.deps.requestColumnTransformSync();
      const ix = result.movedColumnIds.indexOf(actRef.field);
      const fromIndex =
        ix >= 0 ? result.fromIndices[ix]! : result.fromIndices[0]!;
      this.deps.onColumnOrderChanged?.({
        columnOrder: result.order,
        movedColumnId: actRef.field,
        fromIndex,
        toIndex: result.toIndex,
        source: "drag",
        movedColumnIds: result.movedColumnIds,
        fromIndices: result.fromIndices,
      });
      return;
    }

    const result = this.deps.store.move(actRef.field, toIdx, userCols);
    if (!result?.changed) return;
    this.deps.requestColumnTransformSync();
    this.deps.onColumnOrderChanged?.({
      columnOrder: result.order,
      movedColumnId: result.movedColumnId,
      fromIndex: result.fromIndex,
      toIndex: result.toIndex,
      source: "drag",
    });
  }

  private userColumns(): ColumnDef[] {
    return this.deps.getColumns().filter((c) => !isInternalColumn(c));
  }

  private computeDropIndex(clientX: number): number {
    const row = this.deps.getHeaderRowEl();
    if (!row) return 0;
    const globalFields = this.userColumns().map((c) => c.field);
    // Re-collect fresh visible headers — accounts for any scrollLeft change during auto-scroll.
    const visibleSorted = collectVisibleUserHeaderEntries(row, globalFields);
    return computeGlobalDropIndexFromVisible(clientX, visibleSorted);
  }
}
