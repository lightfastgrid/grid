import { isInternalColumn } from "../../internal/internalColumns";
import { CSS } from "../../rendering/const/css-classes";
import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type {
  CellMenuContext,
  CellMenuGridApi,
  CellMenuItem,
  CellMenuOptions,
  CellMenuTriggerButtonConfig,
  ColumnDef,
  RowData,
} from "../../types";
import { FloatingController } from "../floating/FloatingController";
import {
  allocatePopupId,
  connectPopupTrigger,
  disconnectPopupTrigger,
  initializePopupTrigger,
  syncPopupTriggerRole,
} from "../menu/popupSemantics";

import {
  CELL_MENU_TRIGGER_CLASS,
  CELL_MENU_TRIGGER_VISIBLE_CLASS,
} from "./cellMenuDom";
import { createCellMenuPanel } from "./createCellMenuPanel";
import { resolveCellMenuPopupRole } from "./resolveCellMenuPopupRole";

export interface CellMenuControllerOptions {
  gridRoot: HTMLElement;
  viewport: HTMLElement;
  getColumns: () => ColumnDef[];
  getDisplayRows: () => DisplayRowReader;
  resolveRowId: (row: RowData, index: number) => string;
  getCellMenuOptions: () => CellMenuOptions | undefined;
  getCellMenuGridApi: () => CellMenuGridApi;
}

/** Selector matching any body row element (center, pinned-left, pinned-right). */
const BODY_ROW_SELECTOR = `.${CSS.ROW}, .lfg-pinned-row, .lfg-pinned-right-row`;

const DEFAULT_TRIGGER_ICON = "⋮";
const DEFAULT_TRIGGER_ARIA_LABEL = "Open cell menu";

interface CellMenuSession {
  readonly invoker: HTMLElement;
  restoreFocus: boolean;
}

/**
 * Handles cell menu opening via contextmenu event delegation and an optional
 * reusable overlay trigger button.
 *
 * A single `contextmenu` listener on the grid root catches all right-clicks.
 * When trigger includes "button", a single overlay button is created once and
 * repositioned over the currently hovered eligible cell.
 */
export class CellMenuController {
  private root: HTMLElement | null = null;
  private readonly floating: FloatingController;
  private readonly options: CellMenuControllerOptions;
  private readonly popupId = allocatePopupId("cell-menu");
  private popupTrigger: HTMLElement | null = null;
  private session: CellMenuSession | null = null;
  private pendingDisplayRowIndex = -1;
  private pendingField: string | null = null;
  private pendingCell: HTMLElement | null = null;
  private pendingInvoker: HTMLElement | null = null;
  private commandOpenScheduled = false;

  // ── Overlay trigger button state ──────────────────────────────
  private triggerButton: HTMLButtonElement | null = null;
  /** The cell element the trigger button is currently anchored to. */
  private activeCell: HTMLElement | null = null;
  private positionRafId = 0;

  constructor(options: CellMenuControllerOptions) {
    this.options = options;
    this.floating = new FloatingController(options.gridRoot, options.viewport);
  }

  attach(root: HTMLElement): void {
    this.detach();
    this.root = root;
    this.root.addEventListener("contextmenu", this.onContextMenu);
    this.maybeCreateTriggerButton();
  }

  detach(): void {
    this.pendingDisplayRowIndex = -1;
    this.pendingField = null;
    this.pendingCell = null;
    this.pendingInvoker = null;
    this.commandOpenScheduled = false;
    this.session = null;
    try {
      this.floating.destroy();
    } finally {
      this.clearPopupTrigger();
      this.destroyTriggerButton();
      if (this.root) {
        this.root.removeEventListener("contextmenu", this.onContextMenu);
        this.root = null;
      }
    }
  }

  requestOpenAtDisplayIndex(
    displayRowIndex: number,
    field: string,
    cell: HTMLElement,
    invoker: HTMLElement,
  ): boolean {
    if (
      !Number.isSafeInteger(displayRowIndex) ||
      displayRowIndex < 0 ||
      field.length === 0 ||
      !cell.isConnected ||
      !invoker.isConnected ||
      this.options.getCellMenuOptions()?.enabled !== true
    ) {
      return false;
    }
    this.pendingDisplayRowIndex = displayRowIndex;
    this.pendingField = field;
    this.pendingCell = cell;
    this.pendingInvoker = invoker;
    if (!this.commandOpenScheduled) {
      this.commandOpenScheduled = true;
      queueMicrotask(this.flushCommandOpen);
    }
    return true;
  }

  closeFromCommand(): boolean {
    if (!this.floating.isOpen()) return false;
    if (this.session !== null) this.session.restoreFocus = true;
    this.floating.close();
    return true;
  }

  isOpen(): boolean {
    return this.floating.isOpen();
  }

  /**
   * Returns the one visible overlay trigger only when it belongs to the exact
   * logical cell. This interaction-time lookup performs no layout read, DOM
   * discovery, column scan, or row-model scan.
   */
  resolveVisibleTrigger(
    displayRowIndex: number,
    field: string,
    cell: HTMLElement,
  ): HTMLElement | null {
    const trigger = this.triggerButton;
    const activeCell = this.activeCell;
    if (
      trigger === null ||
      activeCell !== cell ||
      !trigger.isConnected ||
      !cell.isConnected ||
      !trigger.classList.contains(CELL_MENU_TRIGGER_VISIBLE_CLASS) ||
      cell.getAttribute("data-col-id") !== field
    ) {
      return null;
    }
    const row = cell.parentElement;
    const rowIndex = row?.getAttribute("data-row-index");
    if (
      row === null ||
      !row.matches(BODY_ROW_SELECTOR) ||
      rowIndex === null ||
      Number(rowIndex) !== displayRowIndex ||
      !Number.isSafeInteger(displayRowIndex) ||
      displayRowIndex < 0
    ) {
      return null;
    }
    return trigger;
  }

  // ── Contextmenu event handler ─────────────────────────────────

  private readonly onContextMenu = (e: MouseEvent): void => {
    const opts = this.options.getCellMenuOptions();
    if (!opts?.enabled) return;

    const trigger = opts.trigger ?? "contextmenu";
    if (trigger !== "contextmenu" && trigger !== "contextmenu-and-button") return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    const resolved = this.resolveCell(target);
    if (!resolved) return;

    const ctx = this.buildContext(resolved.row, resolved.field, resolved.colDef);
    if (!ctx) return;

    const visibleActions = this.getVisibleActions(opts, ctx);
    if (visibleActions.length === 0 && typeof opts.renderPanel !== "function") {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    this.openMenu(resolved.cell, opts, ctx, visibleActions, null);
  };

  // ── Trigger button lifecycle ──────────────────────────────────

  private needsTriggerButton(opts: CellMenuOptions | undefined): boolean {
    if (!opts?.enabled) return false;
    const trigger = opts.trigger ?? "contextmenu";
    return trigger === "button" || trigger === "contextmenu-and-button";
  }

  private maybeCreateTriggerButton(): void {
    const opts = this.options.getCellMenuOptions();
    if (!this.needsTriggerButton(opts)) return;
    if (!this.root) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.tabIndex = -1;
    btn.className = CELL_MENU_TRIGGER_CLASS;
    btn.style.position = "absolute";
    btn.style.zIndex = "10";
    btn.style.pointerEvents = "auto";
    // Start hidden off-screen.
    btn.style.transform = "translate3d(-9999px, -9999px, 0)";

    this.triggerButton = btn;
    this.applyTriggerButtonConfig(opts?.triggerButton);
    initializePopupTrigger(btn, resolveCellMenuPopupRole(opts));

    btn.addEventListener("click", this.onTriggerClick);
    btn.addEventListener("pointerdown", this.onTriggerPointerDown);

    this.root.appendChild(btn);

    // Listen for pointer movement to track active cell.
    this.root.addEventListener("pointermove", this.onPointerMove);
    this.root.addEventListener("pointerleave", this.onPointerLeave);

    // Hide overlay on any grid scroll (vertical or horizontal).
    this.options.viewport.addEventListener("scroll", this.onViewportScroll, { passive: true });
  }

  private destroyTriggerButton(): void {
    if (this.positionRafId) {
      cancelAnimationFrame(this.positionRafId);
      this.positionRafId = 0;
    }
    if (this.triggerButton) {
      this.triggerButton.removeEventListener("click", this.onTriggerClick);
      this.triggerButton.removeEventListener("pointerdown", this.onTriggerPointerDown);
      this.triggerButton.remove();
      this.triggerButton = null;
    }
    this.options.viewport.removeEventListener("scroll", this.onViewportScroll);
    if (this.root) {
      this.root.removeEventListener("pointermove", this.onPointerMove);
      this.root.removeEventListener("pointerleave", this.onPointerLeave);
    }
    this.activeCell = null;
  }

  private syncTriggerPopupRole(): void {
    const btn = this.triggerButton;
    if (!btn) return;
    syncPopupTriggerRole(btn, resolveCellMenuPopupRole(this.options.getCellMenuOptions()));
  }

  private applyTriggerButtonConfig(config?: CellMenuTriggerButtonConfig): void {
    const btn = this.triggerButton;
    if (!btn) return;

    const icon = config?.icon ?? DEFAULT_TRIGGER_ICON;
    const ariaLabel = config?.ariaLabel ?? DEFAULT_TRIGGER_ARIA_LABEL;

    btn.textContent = icon;
    btn.setAttribute("aria-label", ariaLabel);

    // Reset to base class, then append custom.
    btn.className = CELL_MENU_TRIGGER_CLASS;
    if (this.activeCell) {
      btn.classList.add(CELL_MENU_TRIGGER_VISIBLE_CLASS);
    }
    if (config?.className) {
      for (const classToken of config.className.trim().split(/\s+/)) {
        if (classToken.length > 0) {
          btn.classList.add(classToken);
        }
      }
    }
  }

  // ── Pointer tracking for trigger button ───────────────────────

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.triggerButton) return;

    // Don't reposition while menu is open.
    if (this.floating.isOpen()) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    // If hovering over the trigger button itself, keep it shown.
    if (this.triggerButton.contains(target)) return;

    const resolved = this.resolveCell(target);
    if (!resolved) {
      this.hideTriggerButton();
      return;
    }

    // Same cell — no update needed.
    if (resolved.cell === this.activeCell) return;

    this.activeCell = resolved.cell;
    this.scheduleTriggerPosition(resolved.cell);
  };

  private readonly onPointerLeave = (): void => {
    // Don't hide while menu is open — the menu manages its own lifecycle.
    if (this.floating.isOpen()) return;
    this.hideTriggerButton();
  };

  /**
   * On any grid scroll: immediately hide the overlay and cancel pending work.
   * No layout reads — just class/style updates and state clearing.
   * The open floating menu is closed separately by FloatingController's own
   * scroll listener.
   */
  private readonly onViewportScroll = (): void => {
    if (this.positionRafId) {
      cancelAnimationFrame(this.positionRafId);
      this.positionRafId = 0;
    }
    this.hideTriggerButton();
  };

  private scheduleTriggerPosition(cell: HTMLElement): void {
    if (this.positionRafId) {
      cancelAnimationFrame(this.positionRafId);
    }
    this.positionRafId = requestAnimationFrame(() => {
      this.positionRafId = 0;
      this.positionTriggerButton(cell);
    });
  }

  private positionTriggerButton(cell: HTMLElement): void {
    const btn = this.triggerButton;
    if (!btn || !this.root) return;

    const opts = this.options.getCellMenuOptions();
    const placement = opts?.triggerButton?.placement ?? "right-center";

    const rootRect = this.root.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();

    // Compute position relative to grid root.
    const cellTop = cellRect.top - rootRect.top;
    const cellLeft = cellRect.left - rootRect.left;

    // Use approximate button dimensions (avoid forced layout read of the button).
    const btnWidth = 24;
    const btnHeight = 24;

    let x: number;
    const y = cellTop + (cellRect.height - btnHeight) / 2;

    if (placement === "left-center") {
      x = cellLeft + 4;
    } else {
      // right-center (default)
      x = cellLeft + cellRect.width - btnWidth - 4;
    }

    // Clamp inside grid root.
    x = Math.max(0, Math.min(x, rootRect.width - btnWidth));

    btn.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    btn.classList.add(CELL_MENU_TRIGGER_VISIBLE_CLASS);
    this.syncTriggerPopupRole();
  }

  private hideTriggerButton(): void {
    if (this.triggerButton) {
      this.triggerButton.classList.remove(CELL_MENU_TRIGGER_VISIBLE_CLASS);
      this.triggerButton.style.transform = "translate3d(-9999px, -9999px, 0)";
    }
    this.activeCell = null;
  }

  // ── Trigger button click ──────────────────────────────────────

  private readonly onTriggerPointerDown = (e: PointerEvent): void => {
    // Prevent row selection from the button click.
    e.preventDefault();
    e.stopPropagation();
  };

  private readonly onTriggerClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();

    const cell = this.activeCell;
    if (!cell) return;

    const opts = this.options.getCellMenuOptions();
    if (!opts?.enabled) return;

    const resolved = this.resolveCell(cell);
    if (!resolved) {
      this.hideTriggerButton();
      return;
    }

    const ctx = this.buildContext(resolved.row, resolved.field, resolved.colDef);
    if (!ctx) {
      this.hideTriggerButton();
      return;
    }

    const visibleActions = this.getVisibleActions(opts, ctx);
    if (visibleActions.length === 0 && typeof opts.renderPanel !== "function") {
      return;
    }

    this.syncTriggerPopupRole();
    this.openMenu(
      resolved.cell,
      opts,
      ctx,
      visibleActions,
      this.triggerButton,
    );
  };

  // ── Shared menu open ──────────────────────────────────────────

  private openMenu(
    anchorCell: HTMLElement,
    opts: CellMenuOptions,
    ctx: CellMenuContext,
    visibleActions: CellMenuItem[],
    popupTrigger: HTMLElement | null,
    invoker: HTMLElement = popupTrigger ?? anchorCell,
  ): void {
    const placement = opts.placement ?? "bottom-start";

    const session: CellMenuSession = { invoker, restoreFocus: false };
    this.session = session;
    const closeForSession = (): void => {
      if (this.session !== session) return;
      session.restoreFocus = true;
      this.floating.close();
    };
    this.floating.open({
      anchorEl: anchorCell,
      placement,
      arrow: true,
      closeOnOutsideClick: true,
      closeOnEscape: true,
      onEscape: () => {
        session.restoreFocus = true;
      },
      closeOnScroll: true,
      render: (host) => {
        const { element, cleanup, focusFirst } = createCellMenuPanel(
          visibleActions,
          ctx,
          (actionCtx) => {
            opts.onAction?.(actionCtx);
          },
          closeForSession,
          this.popupId,
          () => {
            if (this.session !== session) return;
            session.restoreFocus = true;
            this.floating.close();
          },
          opts.renderPanel,
        );
        host.appendChild(element);
        focusFirst();
        return cleanup;
      },
      onClose: () => {
        const preserveTrigger =
          session.restoreFocus &&
          session.invoker === this.triggerButton &&
          this.activeCell?.isConnected === true;
        this.clearPopupTrigger();
        if (!preserveTrigger) this.hideTriggerButton();
        if (this.session !== session) return;
        this.session = null;
        if (session.restoreFocus && session.invoker.isConnected) {
          session.invoker.focus({ preventScroll: true });
        }
      },
    });

    this.popupTrigger = popupTrigger;
    if (popupTrigger !== null) {
      connectPopupTrigger(
        popupTrigger,
        resolveCellMenuPopupRole(opts),
        this.popupId,
      );
    }
  }

  private readonly flushCommandOpen = (): void => {
    this.commandOpenScheduled = false;
    const displayRowIndex = this.pendingDisplayRowIndex;
    const field = this.pendingField;
    const cell = this.pendingCell;
    const invoker = this.pendingInvoker;
    this.pendingDisplayRowIndex = -1;
    this.pendingField = null;
    this.pendingCell = null;
    this.pendingInvoker = null;
    if (
      field === null ||
      cell === null ||
      invoker === null ||
      !cell.isConnected ||
      !invoker.isConnected
    ) {
      return;
    }
    const opts = this.options.getCellMenuOptions();
    if (!opts?.enabled) return;
    const colDef = this.options.getColumns().find(
      (column) => column.field === field,
    );
    if (
      colDef === undefined ||
      isInternalColumn(colDef) ||
      colDef.cellKind === "actions"
    ) {
      return;
    }
    const ctx = this.buildContextAtDisplayIndex(
      displayRowIndex,
      field,
      colDef,
    );
    if (ctx === null) return;
    const visibleActions = this.getVisibleActions(opts, ctx);
    if (visibleActions.length === 0 && typeof opts.renderPanel !== "function") {
      return;
    }
    this.openMenu(cell, opts, ctx, visibleActions, cell, invoker);
  };

  private clearPopupTrigger(): void {
    const trigger = this.popupTrigger;
    this.popupTrigger = null;
    if (trigger !== null) {
      disconnectPopupTrigger(trigger, this.popupId);
    }
  }

  // ── Cell resolution (shared between contextmenu and button) ───

  /**
   * Given an event target, walk up the DOM to find an eligible body cell.
   * Returns null if the target is not inside an eligible cell.
   */
  private resolveCell(target: HTMLElement): {
    cell: HTMLElement;
    row: HTMLElement;
    field: string;
    colDef: ColumnDef;
  } | null {
    const cell = target.closest(`.${CSS.CELL}`) as HTMLElement | null;
    if (!cell) return null;

    const row = cell.closest(BODY_ROW_SELECTOR) as HTMLElement | null;
    if (!row) return null;

    // Exclude header cells.
    if (row.closest(`.${CSS.HEADER}`)) return null;

    const field = cell.getAttribute("data-col-id");
    if (!field) return null;

    const columns = this.options.getColumns();
    const colDef = columns.find((c) => c.field === field);
    if (!colDef) return null;

    // Exclude special cell kinds.
    if (isInternalColumn(colDef)) return null;
    if (colDef.cellKind === "actions") return null;

    return { cell, row, field, colDef };
  }

  /**
   * Build a CellMenuContext from a resolved cell.
   *
   * Uses the DisplayRowReader to resolve the row at the display index
   * from the DOM `data-row-index` attribute. Validates that the resolved
   * row's id matches `data-row-id` to guard against stale DOM.
   */
  private buildContext(
    row: HTMLElement,
    field: string,
    colDef: ColumnDef,
  ): CellMenuContext | null {
    const rowIndexAttr = row.getAttribute("data-row-index");
    if (rowIndexAttr === null) return null;

    const displayRows = this.options.getDisplayRows();
    const resolved = this.resolveRowFromDisplayReader(row, displayRows);
    if (!resolved) return null;

    const { rowIndex, rowData, rowId } = resolved;

    const value = colDef.valueGetter
      ? colDef.valueGetter({ row: rowData, column: colDef, field, rowIndex })
      : (rowData as Record<string, unknown>)[field];

    return {
      row: rowData,
      rowIndex,
      rowId,
      column: colDef,
      field,
      value,
      grid: this.options.getCellMenuGridApi(),
    };
  }

  private buildContextAtDisplayIndex(
    rowIndex: number,
    field: string,
    colDef: ColumnDef,
  ): CellMenuContext | null {
    const rowData = this.options.getDisplayRows().getRowData(rowIndex);
    if (rowData === undefined) return null;
    const rowId = this.options.resolveRowId(rowData, rowIndex);
    const value = colDef.valueGetter
      ? colDef.valueGetter({ row: rowData, column: colDef, field, rowIndex })
      : (rowData as Record<string, unknown>)[field];
    return {
      row: rowData,
      rowIndex,
      rowId,
      column: colDef,
      field,
      value,
      grid: this.options.getCellMenuGridApi(),
    };
  }

  private getVisibleActions(opts: CellMenuOptions, ctx: CellMenuContext): CellMenuItem[] {
    const allActions = opts.getActions?.(ctx) ?? [];
    return allActions.filter((a) => !a.hidden);
  }

  // ── Row resolution via DisplayRowReader ───────────────────────

  /**
   * Resolve row data, display index, and row id from DOM attributes using
   * the DisplayRowReader.
   *
   * Fast path: `data-row-index` points to a display row whose resolved id
   * matches `data-row-id` — one `getRowData` + one `resolveRowId` call.
   *
   * Fallback: stale index (after sort/filter) — scan display rows by id.
   * Kept outside hot render paths; only runs on user interaction (right-click
   * or button click) when DOM is stale.
   */
  private resolveRowFromDisplayReader(
    rowEl: HTMLElement,
    displayRows: DisplayRowReader,
  ): { rowIndex: number; rowData: RowData; rowId: string } | null {
    const indexAttr = rowEl.getAttribute("data-row-index");
    const idAttr = rowEl.getAttribute("data-row-id");

    if (indexAttr !== null) {
      const idx = Number(indexAttr);
      if (idx >= 0 && idx < displayRows.rowCount) {
        const rowData = displayRows.getRowData(idx);
        if (rowData !== undefined) {
          const rowId = this.options.resolveRowId(rowData, idx);
          if (rowId === idAttr) {
            return { rowIndex: idx, rowData, rowId };
          }
        }
      }
    }

    // Fallback: scan display rows by id. This handles stale DOM after
    // sort/filter where the display index no longer matches the row id.
    // Only runs on user interaction — not in render paths.
    if (idAttr !== null) {
      for (let i = 0; i < displayRows.rowCount; i++) {
        const rowData = displayRows.getRowData(i);
        if (rowData === undefined) continue;
        const rowId = this.options.resolveRowId(rowData, i);
        if (rowId === idAttr) {
          return { rowIndex: i, rowData, rowId };
        }
      }
    }

    return null;
  }
}
