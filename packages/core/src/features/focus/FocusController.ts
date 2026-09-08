/**
 * Focused-cell controller.
 *
 * Owns the focused-cell store, the delegated click + keydown listeners
 * on the grid root, DOM patching of `.lfg-cell-focused` on recycled
 * pooled cells and scroll-into-view for keyboard navigation. Composite-grid
 * IDs and `aria-activedescendant` are owned by the accessibility feature.
 *
 * Identity is `rowId` + `field`; navigation uses display indexes via
 * `DisplayRowReader` and the visible column order. No full-grid DOM
 * scans: visuals are patched through the bounded row pool, and row
 * lookup by id is O(1) against the last known index with an O(n) data
 * scan only when the row order actually changed.
 */

import { isInternalColumn } from "../../internal/internalColumns";
import type { VisualRowLayout } from "../../internal/layoutTypes";
import type { PooledRow } from "../../internal/poolTypes";
import type { GridLayoutMetrics } from "../../layout/gridLayoutMetrics";
import { HEADER_HEIGHT, ROW_HEIGHT } from "../../rendering/helpers/gridConstants";
import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type {
  ColumnDef,
  FocusChangeSource,
  FocusedCell,
  FocusMoveDirection,
  LightFastGridFocusedCellChangedEvent,
  RowData,
} from "../../types";
import { isRowActionUiTarget } from "../row-actions/rowActionDom";

import { FocusedCellStore } from "./FocusedCellStore";
import type { FocusNavigationDirection } from "./focusNavigation";
import { isPinnedDisplayIndex, resolveNavigationTarget } from "./focusNavigation";

/** Fallback pageUp/pageDown jump when the viewport height is unknown. */
const PAGE_SIZE_FALLBACK = 10;

const FOCUSED_CELL_CLASS = "lfg-cell-focused";

/** Click targets that must never steal cell focus. */
const FOCUS_EXCLUDED_TARGET_SELECTOR = [
  ".lfg-row-selection-checkbox",
  ".lfg-header-selection-checkbox",
  ".lfg-resize-handle",
  ".lfg-row-drag-handle",
  ".lfg-column-drag-handle",
  "input",
  "textarea",
  "select",
  "button",
  "[contenteditable='true']",
].join(", ");

export interface FocusControllerOptions {
  getPool: () => PooledRow[];
  getColumns: () => ColumnDef[];
  getDisplayRows: () => DisplayRowReader;
  resolveRowId: (row: RowData, index: number) => string;
  getViewport: () => HTMLElement | null;
  layoutMetrics?: GridLayoutMetrics;
  /**
   * Renderer-provided horizontal scroll: ensure `field` is visible
   * using the effective column layout (works for columns outside the
   * rendered window under column virtualization). When absent, falls
   * back to element-based adjustment for rendered cells only.
   */
  ensureFieldVisible?: (field: string) => void;
  /**
   * Visual row order (top-pinned → center → bottom-pinned). Absent →
   * focus treats display order as visual order.
   */
  getVisualRowLayout?: () => VisualRowLayout;
  /**
   * Visit each pooled row in the row-pinned top/bottom lanes
   * (center/left/right sub-lanes), which live outside {@link getPool}.
   * Callback-style to avoid building a throwaway array on focus paths.
   */
  forEachRowPinnedLanePoolRow?: (cb: (row: PooledRow) => void) => void;
  onFocusedCellChanged?: (e: LightFastGridFocusedCellChangedEvent) => void;
}

export class FocusController {
  private root: HTMLElement | null = null;
  private focusableFields = new Set<string>();
  private focusableColumnsIdentity: ColumnDef[] | null = null;
  private pendingFocusedRowIndex = -1;
  private pendingFocusedField: string | null = null;
  private focusFlushScheduled = false;
  private readonly store = new FocusedCellStore();
  /** Cell elements currently carrying the focused class (≤ 3 lanes). */
  private focusedEls: HTMLElement[] = [];

  constructor(private readonly options: FocusControllerOptions) {}

  attach(root: HTMLElement): void {
    this.detach();
    this.root = root;
    this.syncFocusableFields();
    root.addEventListener("click", this.onClick);
  }

  detach(): void {
    if (this.root) {
      this.root.removeEventListener("click", this.onClick);
      this.root = null;
    }
    this.focusableFields.clear();
    this.focusableColumnsIdentity = null;
    this.pendingFocusedRowIndex = -1;
    this.pendingFocusedField = null;
    this.focusFlushScheduled = false;
    this.clearVisuals();
  }

  // ── Public API (via capability) ─────────────────────────────────────

  getFocusedCell(): FocusedCell | null {
    return this.store.get();
  }

  setFocusedCell(
    target: { rowId?: string; rowIndex?: number; field: string },
    source: FocusChangeSource = "api",
  ): void {
    if (!this.isFocusableField(target.field)) return;
    const displayRows = this.options.getDisplayRows();

    let rowIndex = -1;
    if (target.rowId !== undefined) {
      rowIndex = this.findRowIndexById(target.rowId, displayRows);
    } else if (target.rowIndex !== undefined) {
      rowIndex =
        target.rowIndex >= 0 && target.rowIndex < displayRows.rowCount
          ? target.rowIndex
          : -1;
    }
    if (rowIndex < 0) return;

    const row = displayRows.getRowData(rowIndex);
    if (row === undefined) return;

    this.commitFocus(
      {
        rowId: this.options.resolveRowId(row, rowIndex),
        field: target.field,
        rowIndex,
        sourceIndex: displayRows.getSourceIndex(rowIndex),
      },
      source,
    );
    this.scrollCellIntoView(rowIndex, target.field);
  }

  clearFocusedCell(source: FocusChangeSource = "api"): void {
    const change = this.store.clear();
    if (!change) return;
    this.clearVisuals();
    this.emit(null, change.previous, source);
  }

  /**
   * O(1) publication seam used by the isolated keyboard coordinator. The
   * focus owner retains structural field membership; pool visuals and scroll
   * positioning run in one deferred flush outside the keydown caller stack.
   */
  setFocusedCellAtDisplayIndex(
    rowIndex: number,
    field: string,
    source: FocusChangeSource = "keyboard",
  ): boolean {
    if (!this.root || !this.focusableFields.has(field)) return false;
    const displayRows = this.options.getDisplayRows();
    if (rowIndex < 0 || rowIndex >= displayRows.rowCount) return false;
    const row = displayRows.getRowData(rowIndex);
    if (row === undefined) return false;

    const cell: FocusedCell = {
      rowId: this.options.resolveRowId(row, rowIndex),
      field,
      rowIndex,
      sourceIndex: displayRows.getSourceIndex(rowIndex),
    };
    const change = this.store.set(cell);
    if (change) this.emit(cell, change.previous, source);
    this.pendingFocusedRowIndex = rowIndex;
    this.pendingFocusedField = field;
    this.scheduleFocusFlush();
    return true;
  }

  /** Move focus one navigation step. Returns true when focus moved. */
  moveFocusedCell(
    direction: FocusMoveDirection | FocusNavigationDirection,
    source: FocusChangeSource = "api",
  ): boolean {
    const displayRows = this.options.getDisplayRows();
    const focusableFields = this.getFocusableFields();
    const current = this.store.get();

    const target = resolveNavigationTarget(
      current === null
        ? null
        : { rowIndex: current.rowIndex, field: current.field },
      direction,
      {
        rowLayout: this.getVisualRowLayout(displayRows),
        focusableFields,
        pageSize: this.getPageSize(),
      },
    );
    if (target === null) return false;

    const row = displayRows.getRowData(target.rowIndex);
    if (row === undefined) return false;

    const moved = this.commitFocus(
      {
        rowId: this.options.resolveRowId(row, target.rowIndex),
        field: target.field,
        rowIndex: target.rowIndex,
        sourceIndex: displayRows.getSourceIndex(target.rowIndex),
      },
      source,
    );
    this.scrollCellIntoView(target.rowIndex, target.field);
    return moved;
  }

  /**
   * Re-validate the focused cell against the current row view + column
   * set after a render: keep it (refreshing indexes/visuals) when the
   * rowId and field are still visible, otherwise clear with one event.
   * O(1) when the row kept its display index; O(n) data scan only when
   * the order changed.
   */
  syncAfterRender(): void {
    this.syncFocusableFields();
    const cell = this.store.get();
    if (cell === null) return;

    const displayRows = this.options.getDisplayRows();
    let rowIndex = -1;
    if (cell.rowIndex >= 0 && cell.rowIndex < displayRows.rowCount) {
      const row = displayRows.getRowData(cell.rowIndex);
      if (
        row !== undefined &&
        this.options.resolveRowId(row, cell.rowIndex) === cell.rowId
      ) {
        rowIndex = cell.rowIndex;
      }
    }
    if (rowIndex < 0) {
      rowIndex = this.findRowIndexById(cell.rowId, displayRows);
    }

    if (rowIndex < 0 || !this.isFocusableField(cell.field)) {
      const change = this.store.clear();
      this.clearVisuals();
      if (change) this.emit(null, change.previous, "api");
      return;
    }

    this.store.updatePosition(rowIndex, displayRows.getSourceIndex(rowIndex));
    this.applyVisuals();
  }

  // ── Listeners ───────────────────────────────────────────────────────

  private readonly onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!this.root || !target) return;

    // Interactive grid UI (checkboxes, menus, action buttons, handles,
    // editors) owns its own click behavior — never steal focus.
    if (isRowActionUiTarget(target)) return;
    if (target.closest(FOCUS_EXCLUDED_TARGET_SELECTOR)) return;

    const cellEl = target.closest(".lfg-cell") as HTMLElement | null;
    if (!cellEl || !this.root.contains(cellEl)) return;
    const field = cellEl.getAttribute("data-col-id");
    if (!field || !this.isFocusableField(field)) return;

    const rowEl = cellEl.closest(
      ".lfg-row, .lfg-pinned-row, .lfg-pinned-right-row",
    ) as HTMLElement | null;
    const rowId = rowEl?.getAttribute("data-row-id");
    if (!rowEl || !rowId) return;

    // Display index from the bounded pool (no data scan on click).
    const rowIndex = this.findPoolRowIndex(rowEl, rowId);
    if (rowIndex < 0) return;

    const displayRows = this.options.getDisplayRows();
    this.commitFocus(
      {
        rowId,
        field,
        rowIndex,
        sourceIndex: displayRows.getSourceIndex(rowIndex),
      },
      "click",
    );
  };

  // ── Internals ───────────────────────────────────────────────────────

  /**
   * Visible focusable column fields in VISUAL order:
   * left-pinned → center → right-pinned. Pinned columns are included,
   * never skipped. The internal selection column is excluded.
   */
  private getFocusableFields(): string[] {
    const left: string[] = [];
    const center: string[] = [];
    const right: string[] = [];
    for (const col of this.options.getColumns()) {
      if (isInternalColumn(col)) continue;
      if (col.pinned === "left") left.push(col.field);
      else if (col.pinned === "right") right.push(col.field);
      else center.push(col.field);
    }
    return [...left, ...center, ...right];
  }

  /**
   * Visual row layout from the renderer, or a display-order identity
   * layout when row pinning metadata is unavailable.
   */
  private getVisualRowLayout(displayRows: DisplayRowReader): VisualRowLayout {
    return (
      this.options.getVisualRowLayout?.() ?? {
        topDisplayIndexes: [],
        centerRowCount: displayRows.rowCount,
        centerToDisplayIndex: null,
        bottomDisplayIndexes: [],
      }
    );
  }

  /**
   * Visit the pool rows focus visuals + pinned-row clicks may target:
   * the main center pool, then the row-pinned top/bottom lane
   * sub-pools. Bounded iteration, no throwaway arrays, no full-DOM scan.
   */
  private forEachFocusPoolRow(cb: (row: PooledRow) => void): void {
    const main = this.options.getPool();
    for (let i = 0; i < main.length; i++) cb(main[i]!);
    this.options.forEachRowPinnedLanePoolRow?.(cb);
  }

  private isFocusableField(field: string): boolean {
    return this.focusableFields.has(field);
  }

  private syncFocusableFields(): void {
    const columns = this.options.getColumns();
    if (columns === this.focusableColumnsIdentity) return;
    const next = new Set<string>();
    for (const column of columns) {
      if (!isInternalColumn(column)) next.add(column.field);
    }
    this.focusableFields = next;
    this.focusableColumnsIdentity = columns;
  }

  private scheduleFocusFlush(): void {
    if (this.focusFlushScheduled) return;
    this.focusFlushScheduled = true;
    queueMicrotask(this.flushDeferredFocus);
  }

  private readonly flushDeferredFocus = (): void => {
    this.focusFlushScheduled = false;
    const field = this.pendingFocusedField;
    const rowIndex = this.pendingFocusedRowIndex;
    this.pendingFocusedField = null;
    this.pendingFocusedRowIndex = -1;
    if (!this.root || field === null || rowIndex < 0) return;
    const focused = this.store.get();
    if (
      focused === null ||
      focused.rowIndex !== rowIndex ||
      focused.field !== field
    ) {
      return;
    }
    this.applyVisuals();
    this.scrollCellIntoView(rowIndex, field);
  };

  /** O(n) display-row scan; used for id-based lookups only. */
  private findRowIndexById(
    rowId: string,
    displayRows: DisplayRowReader,
  ): number {
    for (let i = 0; i < displayRows.rowCount; i++) {
      const row = displayRows.getRowData(i);
      if (row !== undefined && this.options.resolveRowId(row, i) === rowId) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Display index of a clicked row element via the bounded pools
   * (main center pool + row-pinned lane sub-pools). No data scan.
   */
  private findPoolRowIndex(rowEl: HTMLElement, rowId: string): number {
    let found = -1;
    this.forEachFocusPoolRow((poolRow) => {
      if (found !== -1 || poolRow.rowId !== rowId) return;
      if (
        poolRow.element === rowEl ||
        poolRow.pinnedElement === rowEl ||
        poolRow.rightPinnedElement === rowEl
      ) {
        found = poolRow.rowIndex;
      }
    });
    return found;
  }

  private getPageSize(): number {
    const viewport = this.options.getViewport();
    const hh = this.options.layoutMetrics?.headerHeight ?? HEADER_HEIGHT;
    const rh = this.options.layoutMetrics?.rowHeight ?? ROW_HEIGHT;
    const bodyHeight = (viewport?.clientHeight ?? 0) - hh;
    if (bodyHeight <= 0) return PAGE_SIZE_FALLBACK;
    return Math.max(1, Math.floor(bodyHeight / rh));
  }

  /** Returns true when the focused identity actually changed. */
  private commitFocus(cell: FocusedCell, source: FocusChangeSource): boolean {
    const change = this.store.set(cell);
    this.applyVisuals();
    if (!change) return false;
    this.emit(cell, change.previous, source);
    return true;
  }

  private emit(
    focusedCell: FocusedCell | null,
    previousCell: FocusedCell | null,
    source: FocusChangeSource,
  ): void {
    this.options.onFocusedCellChanged?.({ focusedCell, previousCell, source });
  }

  // ── DOM patching (bounded pool, recycled-cell safe) ─────────────────

  private applyVisuals(): void {
    this.removeVisualClasses();
    const cell = this.store.get();
    if (cell === null || !this.root) return;

    // Scan the main pool AND the row-pinned lane sub-pools. A row id can
    // appear in several pool rows (column-pinned lanes on a normal row;
    // center/left/right sub-lanes on a row-pinned row), and the focused
    // field's cell lives in exactly one of them — so collect from all
    // matches rather than stopping at the first.
    const selector = `.lfg-cell[data-col-id="${escapeAttr(cell.field)}"]`;
    const els: HTMLElement[] = [];
    const rowId = cell.rowId;
    this.forEachFocusPoolRow((poolRow) => {
      if (poolRow.rowId !== rowId) return;
      for (const lane of [
        poolRow.element,
        poolRow.pinnedElement,
        poolRow.rightPinnedElement,
      ]) {
        if (!lane) continue;
        const cellEl = lane.querySelector<HTMLElement>(selector);
        if (cellEl) els.push(cellEl);
      }
    });

    for (const el of els) el.classList.add(FOCUSED_CELL_CLASS);
    this.focusedEls = els;

  }

  private removeVisualClasses(): void {
    for (const el of this.focusedEls) {
      el.classList.remove(FOCUSED_CELL_CLASS);
    }
    this.focusedEls = [];
  }

  private clearVisuals(): void {
    this.removeVisualClasses();
  }

  // ── Scrolling ───────────────────────────────────────────────────────

  /**
   * Keep the target cell inside the viewport. Vertical math uses the
   * fixed row/header heights (virtualization-friendly: no DOM measure,
   * no row materialization). Horizontal scrolling goes through the
   * renderer's `ensureFieldVisible` (effective column layout, works for
   * columns outside the rendered window). The scroll event drives the
   * normal virtual-window sync which renders the target, and
   * `syncAfterRender` re-applies the focus visuals onto recycled cells.
   */
  private scrollCellIntoView(rowIndex: number, field: string): void {
    const viewport = this.options.getViewport();
    if (!viewport) return;

    // Pinned rows render in the sticky top/bottom layers and are always
    // visible — body vertical scroll math does not apply to them (it
    // would scroll the center body to an unrelated position). Horizontal
    // column visibility still applies, so fall through to that.
    const layout = this.getVisualRowLayout(this.options.getDisplayRows());
    const pinnedRow = isPinnedDisplayIndex(layout, rowIndex);

    if (!pinnedRow && viewport.clientHeight > 0) {
      const hh = this.options.layoutMetrics?.headerHeight ?? HEADER_HEIGHT;
      const rh = this.options.layoutMetrics?.rowHeight ?? ROW_HEIGHT;
      const top = hh + rowIndex * rh;
      const bottom = top + rh;
      const viewTop = viewport.scrollTop + hh; // sticky header
      const viewBottom = viewport.scrollTop + viewport.clientHeight;

      if (top < viewTop) {
        viewport.scrollTop = top - hh;
      } else if (bottom > viewBottom) {
        viewport.scrollTop = bottom - viewport.clientHeight;
      }
    }

    if (this.options.ensureFieldVisible) {
      this.options.ensureFieldVisible(field);
      return;
    }

    // Fallback: adjust only when the cell is rendered (pool-bounded).
    const el = this.focusedEls[0];
    if (!el) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < viewport.scrollLeft) {
      viewport.scrollLeft = left;
    } else if (right > viewport.scrollLeft + viewport.clientWidth) {
      viewport.scrollLeft = right - viewport.clientWidth;
    }
  }
}

/** Escape a field id for use inside an attribute selector. */
function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
