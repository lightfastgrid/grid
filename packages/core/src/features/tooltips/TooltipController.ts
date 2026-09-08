/**
 * Cell tooltip controller — delegated event handling, lazy resolve on
 * hover/focus, single floating instance.
 *
 * Performance contract:
 * - No tooltip resolver calls during row/cell rendering.
 * - No DOM layout reads in render loops.
 * - Truncation layout read (`scrollWidth > clientWidth`) only on hover/focus.
 * - One floating instance, one tooltip host at a time.
 * - Delegated listeners only — no per-cell listeners.
 *
 * Event delegation uses `pointerover`/`pointerout` (bubble) with
 * `relatedTarget` guards rather than `pointerenter`/`pointerleave`
 * (which don't bubble and require capture). This is the conventional
 * approach for delegated pointer tracking on a container element.
 */

import type { Grid } from "../../Grid";
import { isInternalColumn } from "../../internal/internalColumns";
import { CSS } from "../../rendering/const/css-classes";
import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type { ColumnDef, RowData } from "../../types";
import { formatColumnValue, resolveColumnRawValue } from "../../value-access/columnValueAccess";
import { FloatingController } from "../floating/FloatingController";

import { createTooltipElement } from "./tooltipDom";
import { resolveTooltip } from "./tooltipResolver";
import {
  allocateTooltipId,
  connectTooltipTarget,
  disconnectTooltipTarget,
} from "./tooltipSemantics";

export interface TooltipControllerOptions {
  gridRoot: HTMLElement;
  viewport: HTMLElement;
  getColumns: () => ColumnDef[];
  getDisplayRows: () => DisplayRowReader;
  resolveRowId: (row: RowData, index: number) => string;
  /** May return `null` before the Grid instance has finished wiring. */
  getGridInstance: () => Grid | null;
}

/** Selector matching any body row element (center, pinned-left, pinned-right, row-pinned lanes). */
const BODY_ROW_SELECTOR = [
  `.${CSS.ROW}`,
  ".lfg-pinned-row",
  ".lfg-pinned-right-row",
].join(", ");

const SHOW_DELAY_MS = 250;

/**
 * Handles cell tooltips via delegated event handling on the grid root.
 *
 * Uses `pointerover`/`pointerout` (bubbling) with `relatedTarget` guards
 * and `focusin`/`focusout` on the grid root. Tooltip text is resolved
 * lazily on hover/focus — never during rendering.
 */
export class TooltipController {
  private readonly tooltipId = allocateTooltipId();
  private root: HTMLElement | null = null;
  private floating: FloatingController | null = null;
  private readonly options: TooltipControllerOptions;
  private lifecycleOwner: object = {};

  /** The cell element the tooltip is currently shown for, or pending. */
  private activeCell: HTMLElement | null = null;
  private tooltipElement: HTMLElement | null = null;
  private pointerInsideCell = false;
  private pointerInsideTooltip = false;
  private focusInsideCell = false;
  private showTimer = 0;
  private pendingKeyboardCell: HTMLElement | null = null;
  private keyboardRequestScheduled = false;

  constructor(options: TooltipControllerOptions) {
    this.options = options;
  }

  attach(root: HTMLElement): void {
    this.detach();
    this.lifecycleOwner = {};
    this.root = root;
    this.floating = new FloatingController(
      this.options.gridRoot,
      this.options.viewport,
    );
    // Delegated via bubbling pointer/mouse over/out + focusin/focusout.
    // Both pointer and mouse events are registered so tooltips work in
    // browsers/environments where only one event family fires reliably.
    // The shared handler guards against double-scheduling via activeCell.
    // No per-cell listeners — only these six on the root.
    this.root.addEventListener("pointerover", this.onEnter);
    this.root.addEventListener("pointerout", this.onLeave);
    this.root.addEventListener("mouseover", this.onEnter);
    this.root.addEventListener("mouseout", this.onLeave);
    this.root.addEventListener("focusin", this.onFocusIn);
    this.root.addEventListener("focusout", this.onFocusOut);
  }

  /**
   * Close tooltip, cancel pending timers, and remove listeners.
   * Floating internals are destroyed — call from feature teardown or
   * before a fresh `attach()`.
   */
  detach(): void {
    this.lifecycleOwner = {};
    this.pendingKeyboardCell = null;
    this.keyboardRequestScheduled = false;
    this.cancelPending();
    let primaryError: unknown;
    if (this.floating) {
      try {
        this.floating.destroy();
      } catch (error) {
        primaryError = error;
      }
      this.floating = null;
    }
    if (this.root) {
      this.root.removeEventListener("pointerover", this.onEnter);
      this.root.removeEventListener("pointerout", this.onLeave);
      this.root.removeEventListener("mouseover", this.onEnter);
      this.root.removeEventListener("mouseout", this.onLeave);
      this.root.removeEventListener("focusin", this.onFocusIn);
      this.root.removeEventListener("focusout", this.onFocusOut);
      this.root = null;
    }
    this.resetInteractionState();
    if (primaryError !== undefined) {
      throw primaryError;
    }
  }

  /** O(1) replacement-safe acceptance; tooltip resolution stays off keydown. */
  requestTooltipForKeyboardTarget(target: HTMLElement | null): void {
    this.pendingKeyboardCell = target;
    if (!this.keyboardRequestScheduled) {
      this.keyboardRequestScheduled = true;
      queueMicrotask(this.flushKeyboardRequest);
    }
  }

  dismissKeyboardTooltip(): boolean {
    const visible = this.tooltipElement !== null || this.floating?.isOpen() === true;
    const present = visible || this.showTimer !== 0 || this.pendingKeyboardCell !== null;
    this.pendingKeyboardCell = null;
    if (present) this.closeAndCancel();
    return visible;
  }

  private readonly flushKeyboardRequest = (): void => {
    this.keyboardRequestScheduled = false;
    const cell = this.pendingKeyboardCell;
    this.pendingKeyboardCell = null;
    if (cell === this.activeCell) return;
    this.closeAndCancel();
    if (cell !== null && cell.isConnected) this.scheduleShow(cell);
  };

  // ── Event handlers (delegated, bubbling) ───────────────────────
  //
  // Shared by both pointer and mouse events. The activeCell guard
  // prevents double-scheduling when both event families fire.

  private readonly onEnter = (e: PointerEvent | MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (this.isTooltipTarget(target)) {
      this.pointerInsideTooltip = true;
      return;
    }

    const cell = this.resolveEligibleCell(target);
    if (!cell) return;

    // relatedTarget guard: if the pointer moved from inside the same cell
    // (child → child), this is not a real cell-enter.
    const related = e.relatedTarget as HTMLElement | null;
    if (related && cell.contains(related)) return;

    if (cell === this.activeCell) {
      this.pointerInsideCell = true;
      return;
    }

    this.closeAndCancel();
    this.pointerInsideCell = true;
    this.scheduleShow(cell);
  };

  private readonly onLeave = (e: PointerEvent | MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const related = e.relatedTarget as HTMLElement | null;
    if (this.isTooltipTarget(target)) {
      if (related !== null && this.isTooltipTarget(related)) return;
      this.pointerInsideTooltip = false;
      if (related !== null && this.activeCell?.contains(related)) {
        this.pointerInsideCell = true;
      }
      this.closeIfInactive();
      return;
    }

    const cell = target.closest(`.${CSS.CELL}`) as HTMLElement | null;
    if (!cell || cell !== this.activeCell) return;

    // relatedTarget guard: if the pointer is moving to a child of the same
    // cell, this is not a real cell-leave.
    if (related && cell.contains(related)) return;

    this.pointerInsideCell = false;
    if (related !== null && this.isTooltipTarget(related)) {
      this.pointerInsideTooltip = true;
    }
    this.closeIfInactive();
  };

  private readonly onFocusIn = (e: FocusEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const cell = this.resolveEligibleCell(target);
    if (!cell) return;

    if (cell === this.activeCell) {
      this.focusInsideCell = true;
    } else {
      this.closeAndCancel();
      this.focusInsideCell = true;
      this.scheduleShow(cell);
    }
  };

  private readonly onFocusOut = (e: FocusEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const cell = target.closest(`.${CSS.CELL}`) as HTMLElement | null;
    if (!cell || cell !== this.activeCell) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related !== null && cell.contains(related)) return;
    this.focusInsideCell = false;
    this.closeIfInactive();
  };

  // ── Show / close lifecycle ──────────────────────────────────────

  private scheduleShow(cell: HTMLElement): void {
    this.activeCell = cell;
    const owner = this.lifecycleOwner;
    this.showTimer = window.setTimeout(() => {
      this.showTimer = 0;
      if (owner === this.lifecycleOwner) {
        try {
          this.showForCell(cell, owner);
        } catch (error) {
          if (
            owner === this.lifecycleOwner &&
            this.activeCell === cell
          ) {
            this.resetInteractionState();
          }
          throw error;
        }
      }
    }, SHOW_DELAY_MS);
  }

  private showForCell(cell: HTMLElement, owner: object): void {
    // Verify cell is still connected and is still the active target.
    if (!cell.isConnected || cell !== this.activeCell) {
      this.resetInteractionState();
      return;
    }

    // Grid instance may be null during early wiring — bail silently.
    const grid = this.options.getGridInstance();
    if (!grid) {
      this.resetInteractionState();
      return;
    }

    const resolved = this.resolveContext(cell);
    if (!resolved) {
      this.resetInteractionState();
      return;
    }

    const { colDef, row, rowIndex, rowId, rawValue, formattedValue } = resolved;

    // Check if this column has any tooltip config.
    if (colDef.tooltip === undefined && colDef.tooltipValueGetter === undefined) {
      this.resetInteractionState();
      return;
    }

    // For `tooltip: true` without a getter, only show if text is truncated.
    if (
      colDef.tooltip === true &&
      colDef.tooltipValueGetter === undefined &&
      !this.isTruncated(cell)
    ) {
      this.resetInteractionState();
      return;
    }

    const text = resolveTooltip({
      tooltip: colDef.tooltip,
      tooltipValueGetter: colDef.tooltipValueGetter,
      params: {
        row,
        rowIndex,
        rowId,
        column: colDef,
        field: colDef.field,
        value: rawValue,
        formattedValue,
        grid,
      },
    });

    if (!text) {
      this.resetInteractionState();
      return;
    }

    if (!this.isCurrentTarget(cell, owner)) {
      return;
    }

    const floating = this.floating;
    if (floating === null) return;

    try {
      floating.open({
        anchorEl: cell,
        placement: "top-start",
        closeOnOutsideClick: false,
        closeOnEscape: true,
        closeOnScroll: true,
        render: (host) => {
          const element = createTooltipElement(
            cell.ownerDocument,
            text,
            this.tooltipId,
          );
          host.appendChild(element);
          if (!element.isConnected) {
            throw new Error("Tooltip must be connected before publication");
          }
          connectTooltipTarget(cell, this.tooltipId);
          this.tooltipElement = element;
          return () => {
            disconnectTooltipTarget(cell, this.tooltipId);
            if (this.tooltipElement === element) {
              this.tooltipElement = null;
            }
          };
        },
        onClose: () => {
          if (this.activeCell === cell) {
            this.resetInteractionState();
          }
        },
      });
    } catch (error) {
      if (owner === this.lifecycleOwner && this.activeCell === cell) {
        this.resetInteractionState();
      }
      throw error;
    }
  }

  private closeAndCancel(): void {
    this.cancelPending();
    try {
      if (this.floating?.isOpen()) {
        this.floating.close();
      }
    } finally {
      this.resetInteractionState();
    }
  }

  private cancelPending(): void {
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = 0;
    }
  }

  private closeIfInactive(): void {
    if (
      !this.pointerInsideCell &&
      !this.pointerInsideTooltip &&
      !this.focusInsideCell
    ) {
      this.closeAndCancel();
    }
  }

  private isTooltipTarget(target: Node): boolean {
    return (
      (this.tooltipElement?.contains(target) ?? false) ||
      (this.floating?.containsTarget(target) ?? false)
    );
  }

  private isCurrentTarget(cell: HTMLElement, owner: object): boolean {
    return (
      owner === this.lifecycleOwner &&
      cell === this.activeCell &&
      cell.isConnected
    );
  }

  private resetInteractionState(): void {
    this.activeCell = null;
    this.tooltipElement = null;
    this.pointerInsideCell = false;
    this.pointerInsideTooltip = false;
    this.focusInsideCell = false;
  }

  // ── Cell resolution ─────────────────────────────────────────────

  /**
   * Given an event target, find the closest eligible `.lfg-cell` with
   * `data-col-id`. Excludes header cells and internal columns.
   */
  private resolveEligibleCell(target: HTMLElement): HTMLElement | null {
    const cell = target.closest(`.${CSS.CELL}`) as HTMLElement | null;
    if (!cell) return null;

    // Must have a data-col-id (real data cell).
    const field = cell.getAttribute("data-col-id");
    if (!field) return null;

    // Must be inside a body row (not header).
    const row = cell.closest(BODY_ROW_SELECTOR) as HTMLElement | null;
    if (!row) return null;
    if (row.closest(`.${CSS.HEADER}`)) return null;

    // Exclude internal columns.
    const columns = this.options.getColumns();
    const colDef = columns.find((c) => c.field === field);
    if (!colDef) return null;
    if (isInternalColumn(colDef)) return null;
    if (colDef.cellKind === "actions") return null;

    return cell;
  }

  /**
   * Build full context for a resolved cell — row data, column def, raw and
   * formatted values. Layout reads (truncation check) happen outside this.
   */
  private resolveContext(cell: HTMLElement): {
    colDef: ColumnDef;
    row: RowData;
    rowIndex: number;
    rowId: string;
    rawValue: unknown;
    formattedValue: string;
  } | null {
    const field = cell.getAttribute("data-col-id");
    if (!field) return null;

    const rowEl = cell.closest(BODY_ROW_SELECTOR) as HTMLElement | null;
    if (!rowEl) return null;

    const columns = this.options.getColumns();
    const colDef = columns.find((c) => c.field === field);
    if (!colDef) return null;

    const displayRows = this.options.getDisplayRows();
    const resolved = this.resolveRow(rowEl, displayRows);
    if (!resolved) return null;

    const { rowIndex, rowId, row } = resolved;
    const rawValue = resolveColumnRawValue(row, rowIndex, colDef);
    const formattedValue = formatColumnValue(rawValue, row, rowIndex, colDef);

    return { colDef, row, rowIndex, rowId, rawValue, formattedValue };
  }

  /**
   * Check if cell text is truncated (only called on hover/focus — never in
   * render loops). Single layout read per hover.
   */
  private isTruncated(cell: HTMLElement): boolean {
    return cell.scrollWidth > cell.clientWidth;
  }

  /**
   * Resolve row data, display index, and id from DOM attributes using the
   * DisplayRowReader.
   *
   * Fast path: `data-row-index` points to a display row whose resolved id
   * matches `data-row-id` — one `getRowData` + one `resolveRowId` call.
   *
   * Fallback: stale index (after sort/filter) — scan display rows by id.
   * Only runs on hover/focus — not in render paths.
   */
  private resolveRow(
    rowEl: HTMLElement,
    displayRows: DisplayRowReader,
  ): { rowIndex: number; rowId: string; row: RowData } | null {
    const indexAttr = rowEl.getAttribute("data-row-index");
    const idAttr = rowEl.getAttribute("data-row-id");

    if (indexAttr !== null) {
      const idx = Number(indexAttr);
      if (idx >= 0 && idx < displayRows.rowCount) {
        const row = displayRows.getRowData(idx);
        if (row !== undefined) {
          const rowId = this.options.resolveRowId(row, idx);
          if (rowId === idAttr) {
            return { rowIndex: idx, rowId, row }; // Fast path: one resolveRowId call.
          }
        }
      }
    }

    // Fallback: scan display rows by id (stale index after sort/filter).
    if (idAttr !== null) {
      for (let i = 0; i < displayRows.rowCount; i++) {
        const row = displayRows.getRowData(i);
        if (row === undefined) continue;
        const rowId = this.options.resolveRowId(row, i);
        if (rowId === idAttr) {
          return { rowIndex: i, rowId, row }; // Reuse the matched rowId.
        }
      }
    }

    return null;
  }
}
