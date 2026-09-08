import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type {
  CellShellOverlayRenderContext,
  CellShellOverlayRenderer,
  ColumnDef,
  RowData,
} from "../../types";
import { formatColumnValue, resolveColumnRawValue } from "../../value-access/columnValueAccess";
import { FloatingController } from "../floating/FloatingController";

import { normalizeCellShell } from "./normalizeCellShell";

const OVERLAY_SHELL_SELECTOR = ".lfg-cell-shell[data-overlay-key]";
const HOVER_SHELL_SELECTOR = '.lfg-cell-shell[data-overlay-key][data-overlay-trigger="hover"]';

const DEFAULT_HOVER_OPEN_DELAY = 120;
const DEFAULT_HOVER_CLOSE_DELAY = 180;

export interface CellShellOverlayControllerOptions {
  getColumns: () => ColumnDef[];
  getDisplayRows: () => DisplayRowReader;
  resolveRowId: (row: RowData, index: number) => string;
  getCellShellOverlays: () => Record<string, CellShellOverlayRenderer> | undefined;
}

/**
 * Cell-shell overlay adapter — opens floating popovers from cell-shell
 * triggers (click or hover on button/iconButton/link shells). Delegates
 * positioning and lifecycle to the shared FloatingController. Unrelated to
 * full-grid state overlays (loading/noRows) in features/overlays.
 */
export class CellShellOverlayController {
  private root: HTMLElement | null = null;
  private viewport: HTMLElement | null = null;
  private floating: FloatingController | null = null;
  private readonly options: CellShellOverlayControllerOptions;

  private hoverOpenTimer = 0;
  private hoverCloseTimer = 0;
  private hoverAnchor: HTMLElement | null = null;
  private hoverSnapshot: { rowId: string; colId: string; overlayKey: string } | null = null;

  constructor(options: CellShellOverlayControllerOptions) {
    this.options = options;
  }

  attach(root: HTMLElement, viewport: HTMLElement): void {
    this.detach();
    this.root = root;
    this.viewport = viewport;
    this.floating = new FloatingController(root, viewport);
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("pointerover", this.onPointerOver);
    this.root.addEventListener("pointerout", this.onPointerOut);
    this.viewport.addEventListener("scroll", this.onViewportScroll, { passive: true });
  }

  detach(): void {
    this.clearHoverTimers();
    this.hoverAnchor = null;
    this.hoverSnapshot = null;
    if (this.viewport) {
      this.viewport.removeEventListener("scroll", this.onViewportScroll);
      this.viewport = null;
    }
    if (this.root) {
      this.root.removeEventListener("click", this.onClick);
      this.root.removeEventListener("pointerover", this.onPointerOver);
      this.root.removeEventListener("pointerout", this.onPointerOut);
      this.root = null;
    }
    this.floating?.destroy();
    this.floating = null;
  }

  close(): void {
    this.clearHoverTimers();
    this.hoverAnchor = null;
    this.hoverSnapshot = null;
    this.floating?.close();
  }

  isOpen(): boolean {
    return this.floating?.isOpen() ?? false;
  }

  // ── Click handling (unchanged) ──────────────────────────────────────

  private readonly onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;

    const target = event.target as Element | null;
    if (!target) return;

    const shell = target.closest(OVERLAY_SHELL_SELECTOR) as HTMLElement | null;
    if (!shell) return;

    const trigger = shell.getAttribute("data-overlay-trigger") ?? "click";
    if (trigger !== "click") return;

    const overlayKey = shell.getAttribute("data-overlay-key");
    if (!overlayKey) return;

    const registry = this.options.getCellShellOverlays();
    const renderer = registry?.[overlayKey];
    if (!renderer) return;

    const ctx = this.resolveContext(shell, overlayKey, event);
    if (!ctx) return;

    const hasActionKey = shell.hasAttribute("data-action");
    if (!hasActionKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    this.clearHoverTimers();
    this.hoverAnchor = null;

    this.openOverlay(shell, ctx, renderer);
  };

  // ── Hover handling ──────────────────────────────────────────────────

  private readonly onPointerOver = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;

    const target = event.target as Node | null;
    if (!target) return;

    if (this.floating && this.floating.containsTarget(target)) {
      this.clearCloseTimer();
      return;
    }

    const shell = (target as Element).closest(HOVER_SHELL_SELECTOR) as HTMLElement | null;
    if (!shell) return;

    if (this.hoverAnchor === shell) {
      this.clearCloseTimer();
      return;
    }

    this.clearHoverTimers();

    if (this.hoverAnchor && this.hoverAnchor !== shell) {
      this.floating?.close();
      this.hoverAnchor = null;
    }

    const overlayKey = shell.getAttribute("data-overlay-key");
    if (!overlayKey) return;

    const registry = this.options.getCellShellOverlays();
    const renderer = registry?.[overlayKey];
    if (!renderer) return;

    const shellConfig = this.getShellOverlayConfig(shell);
    const openDelay = clampDelay(shellConfig?.hoverOpenDelayMs, DEFAULT_HOVER_OPEN_DELAY);

    const snapshotRowId = shell.closest("[data-row-id]")?.getAttribute("data-row-id") ?? "";
    const snapshotColId = shell.closest(".lfg-cell")?.getAttribute("data-col-id") ?? "";
    this.hoverSnapshot = { rowId: snapshotRowId, colId: snapshotColId, overlayKey };

    this.hoverOpenTimer = window.setTimeout(() => {
      this.hoverOpenTimer = 0;
      if (!this.validateHoverSnapshot(shell)) return;
      const ctx = this.resolveContext(shell, overlayKey, event);
      if (!ctx) return;
      this.hoverAnchor = shell;
      this.openOverlay(shell, ctx, renderer);
    }, openDelay);
  };

  private readonly onPointerOut = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;

    const related = event.relatedTarget as Node | null;

    if (related) {
      if (this.floating && this.floating.containsTarget(related)) return;
      if (this.hoverAnchor && this.hoverAnchor.contains(related)) return;
    }

    if (this.hoverOpenTimer) {
      this.clearOpenTimer();
      return;
    }

    if (!this.hoverAnchor) return;

    const shellConfig = this.getShellOverlayConfig(this.hoverAnchor);
    const closeDelay = clampDelay(shellConfig?.hoverCloseDelayMs, DEFAULT_HOVER_CLOSE_DELAY);

    this.clearCloseTimer();
    this.hoverCloseTimer = window.setTimeout(() => {
      this.hoverCloseTimer = 0;
      this.hoverAnchor = null;
      this.floating?.close();
    }, closeDelay);
  };

  // ── Shared helpers ──────────────────────────────────────────────────

  private openOverlay(
    shell: HTMLElement,
    ctx: Omit<CellShellOverlayRenderContext, "host">,
    renderer: CellShellOverlayRenderer,
  ): void {
    const shellConfig = normalizeCellShell(ctx.column.cellShell);
    const overlayConfig = shellConfig?.overlay;
    const placement = overlayConfig?.placement ?? "bottom-start";
    const matchAnchorWidth = overlayConfig?.matchAnchorWidth ?? false;
    const closeOnScroll = overlayConfig?.closeOnScroll !== false;

    this.floating!.open({
      anchorEl: shell,
      placement,
      matchAnchorWidth,
      closeOnScroll,
      closeOnOutsideClick: true,
      closeOnEscape: true,
      render: (host) => {
        const fullCtx: CellShellOverlayRenderContext = { ...ctx, host };
        return renderer.render(fullCtx);
      },
      onClose: () => {
        if (this.hoverAnchor === shell) {
          this.hoverAnchor = null;
        }
      },
    });
  }

  private resolveContext(
    shell: HTMLElement,
    overlayKey: string,
    originalEvent?: MouseEvent | PointerEvent,
  ): Omit<CellShellOverlayRenderContext, "host"> | null {
    const cellEl = shell.closest(".lfg-cell") as HTMLElement | null;
    const colId = cellEl?.getAttribute("data-col-id");
    if (!colId) return null;

    const rowEl = shell.closest("[data-row-id]") as HTMLElement | null;
    const rowId = rowEl?.getAttribute("data-row-id");
    if (!rowId) return null;

    const lookup = this.resolveRow(rowEl, rowId);
    if (!lookup) return null;
    const { row, rowIndex } = lookup;

    const column = this.options.getColumns().find((c) => c.field === colId);
    if (!column) return null;

    const value = resolveColumnRawValue(row, rowIndex, column);
    const formattedValue = formatColumnValue(value, row, rowIndex, column);

    return {
      overlayKey,
      rowId,
      rowIndex,
      field: colId,
      column,
      row,
      value,
      formattedValue,
      anchor: shell,
      originalEvent: originalEvent as MouseEvent | PointerEvent,
      close: () => this.floating?.close(),
    };
  }

  private getShellOverlayConfig(shell: HTMLElement) {
    const cellEl = shell.closest(".lfg-cell") as HTMLElement | null;
    const colId = cellEl?.getAttribute("data-col-id");
    if (!colId) return undefined;
    const column = this.options.getColumns().find((c) => c.field === colId);
    if (!column) return undefined;
    return normalizeCellShell(column.cellShell)?.overlay;
  }

  private clearHoverTimers(): void {
    this.clearOpenTimer();
    this.clearCloseTimer();
  }

  private clearOpenTimer(): void {
    if (this.hoverOpenTimer) {
      clearTimeout(this.hoverOpenTimer);
      this.hoverOpenTimer = 0;
    }
  }

  private clearCloseTimer(): void {
    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = 0;
    }
  }

  private validateHoverSnapshot(shell: HTMLElement): boolean {
    if (!this.hoverSnapshot) return false;
    if (!shell.isConnected) return false;
    if (shell.getAttribute("data-overlay-key") !== this.hoverSnapshot.overlayKey) return false;
    const rowEl = shell.closest("[data-row-id]");
    if (rowEl?.getAttribute("data-row-id") !== this.hoverSnapshot.rowId) return false;
    const cellEl = shell.closest(".lfg-cell");
    if (cellEl?.getAttribute("data-col-id") !== this.hoverSnapshot.colId) return false;
    return true;
  }

  private readonly onViewportScroll = (): void => {
    this.clearHoverTimers();
    this.hoverSnapshot = null;
    if (this.hoverAnchor) {
      const shellConfig = this.getShellOverlayConfig(this.hoverAnchor);
      if (shellConfig?.closeOnScroll === false) return;
      this.hoverAnchor = null;
      this.floating?.close();
    }
  };

  private resolveRow(
    rowEl: HTMLElement | null,
    rowId: string,
  ): { row: RowData; rowIndex: number } | null {
    const displayRows = this.options.getDisplayRows();

    const idxAttr = rowEl?.getAttribute("data-row-index") ?? null;
    if (idxAttr !== null) {
      const idx = Number(idxAttr);
      if (Number.isInteger(idx) && idx >= 0 && idx < displayRows.rowCount) {
        const candidate = displayRows.getRowData(idx);
        if (
          candidate !== undefined &&
          this.options.resolveRowId(candidate, idx) === rowId
        ) {
          return { row: candidate, rowIndex: idx };
        }
      }
    }

    for (let i = 0; i < displayRows.rowCount; i++) {
      const row = displayRows.getRowData(i);
      if (row === undefined) continue;
      if (this.options.resolveRowId(row, i) === rowId) {
        return { row, rowIndex: i };
      }
    }

    return null;
  }
}

function clampDelay(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Math.max(0, value);
}
