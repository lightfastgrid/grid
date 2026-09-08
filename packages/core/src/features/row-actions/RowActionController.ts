import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type {
  ActionCellRenderer,
  CellRendererRegistry,
  ColumnDef,
  RowActionClickContext,
  RowActionContext,
  RowActionGridApi,
  RowActionRenderContext,
  RowData,
} from "../../types";
import { FloatingController } from "../floating/FloatingController";
import { focusFirstFloatingElement } from "../floating/focusFirstFloatingElement";
import {
  allocatePopupId,
  applyPopupElementSemantics,
  connectPopupTrigger,
  disconnectPopupTrigger,
  type PopupRole,
} from "../menu/popupSemantics";

import { createRowActionMenuPanel } from "./createRowActionMenuPanel";
import {
  ACTION_CUSTOM_PANEL_CLASS,
  ACTION_TRIGGER_CLASS,
} from "./rowActionDom";

export interface RowActionControllerOptions {
  gridRoot: HTMLElement;
  viewport: HTMLElement;
  getColumns: () => ColumnDef[];
  getDisplayRows: () => DisplayRowReader;
  resolveRowId: (row: RowData, index: number) => string;
  getCellRenderers: () => CellRendererRegistry | undefined;
  getRowActionGridApi: () => RowActionGridApi;
}

interface RowActionSession {
  readonly invoker: HTMLElement;
  restoreFocus: boolean;
}

export class RowActionController {
  private root: HTMLElement | null = null;
  private readonly floating: FloatingController;
  private readonly options: RowActionControllerOptions;
  private readonly popupId = allocatePopupId("row-action");
  private openKey: string | null = null;
  private openTrigger: HTMLElement | null = null;
  private session: RowActionSession | null = null;

  constructor(options: RowActionControllerOptions) {
    this.options = options;
    this.floating = new FloatingController(options.gridRoot, options.viewport);
  }

  attach(root: HTMLElement): void {
    this.detach();
    this.root = root;
    this.root.addEventListener("click", this.onClick);
  }

  detach(): void {
    try {
      this.floating.destroy();
    } finally {
      this.session = null;
      this.clearOpenTrigger();
      this.openKey = null;
      if (this.root) {
        this.root.removeEventListener("click", this.onClick);
        this.root = null;
      }
    }
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;

    const target = event.target as Element | null;
    if (!target) return;

    const trigger = target.closest(`.${ACTION_TRIGGER_CLASS}`) as HTMLElement | null;
    if (!trigger) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    this.openFromTrigger(trigger, trigger, undefined, true);
  };

  requestOpenAtDisplayIndex(
    displayRowIndex: number,
    field: string,
    trigger: HTMLElement,
    invoker: HTMLElement,
  ): boolean {
    if (
      !Number.isSafeInteger(displayRowIndex) ||
      displayRowIndex < 0 ||
      trigger.getAttribute("data-row-index") !== String(displayRowIndex) ||
      trigger.getAttribute("data-col-id") !== field ||
      !trigger.classList.contains(ACTION_TRIGGER_CLASS) ||
      !trigger.isConnected ||
      this.root === null ||
      !this.root.contains(trigger) ||
      !invoker.isConnected
    ) {
      return false;
    }
    return this.openFromTrigger(
      trigger,
      invoker,
      displayRowIndex,
      false,
    );
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

  private openFromTrigger(
    trigger: HTMLElement,
    invoker: HTMLElement,
    expectedDisplayRowIndex: number | undefined,
    toggle: boolean,
  ): boolean {
    const rowId = trigger.getAttribute("data-row-id");
    const colId = trigger.getAttribute("data-col-id");
    const actionsKey = trigger.getAttribute("data-actions-key");
    if (!rowId || !colId || !actionsKey) return false;

    const openKey = this.createOpenKey(rowId, colId, actionsKey);

    if (this.openKey === openKey && this.floating.isOpen()) {
      if (toggle) this.floating.close();
      return true;
    }

    const registry = this.options.getCellRenderers();
    if (!registry) return false;

    const renderer: ActionCellRenderer | undefined = registry[actionsKey];
    if (!renderer) return false;

    const rowLookup = this.resolveRow(
      trigger,
      rowId,
      expectedDisplayRowIndex,
    );
    if (!rowLookup) return false;
    const { row, rowIndex } = rowLookup;
    const columns = this.options.getColumns();
    const column = columns.find((c) => c.field === colId);
    if (!column) return false;

    const gridApi = this.options.getRowActionGridApi();
    const popupAriaLabel =
      trigger.getAttribute("aria-label")?.trim() || "Row actions";
    const session: RowActionSession = { invoker, restoreFocus: false };

    if (renderer.mode === "custom") {
      const close = (): void => {
        session.restoreFocus = true;
        this.floating.close();
      };

      this.session = session;
      try {
        this.floating.open({
          anchorEl: trigger,
          placement: column.actionTrigger?.placement ?? "bottom-end",
          arrow: column.actionTrigger?.arrow !== false,
          closeOnOutsideClick: true,
          closeOnScroll: true,
          closeOnEscape: true,
          onEscape: () => {
            session.restoreFocus = true;
          },
          render: (host) => {
            const panel = document.createElement("div");
            panel.className = ACTION_CUSTOM_PANEL_CLASS;
            applyPopupElementSemantics(panel, {
              id: this.popupId,
              role: "dialog",
              ariaLabel: popupAriaLabel,
            });
            host.appendChild(panel);
            const renderCtx: RowActionRenderContext = {
              host: panel,
              row,
              rowIndex,
              rowId,
              column,
              grid: gridApi,
              close,
            };
            const cleanup = renderer.render(renderCtx);
            focusFirstFloatingElement(panel);
            return () => {
              if (typeof cleanup === "function") {
                cleanup();
              }
              panel.remove();
            };
          },
          onClose: () => {
            this.clearOpenTrigger();
            this.openKey = null;
            this.completeSession(session);
          },
        });
      } catch (error) {
        this.abandonFailedSession(session);
        throw error;
      }

      this.openKey = openKey;
      this.setOpenTrigger(trigger, "dialog");
      return true;
    }

    const ctx: RowActionContext = {
      row,
      rowIndex,
      rowId,
      column,
      grid: gridApi,
    };

    const actions = renderer.getActions(ctx);
    const visibleActions = actions.filter((a) => !a.hidden);
    if (visibleActions.length === 0) return false;

    const close = (): void => {
      session.restoreFocus = true;
      this.floating.close();
    };

    const { element, cleanup, focusFirst } = createRowActionMenuPanel(
      visibleActions,
      (actionId, action) => {
        const clickCtx: RowActionClickContext = {
          actionId,
          action,
          row,
          rowIndex,
          rowId,
          column,
          grid: gridApi,
          close,
        };
        renderer.onAction(clickCtx);
      },
      this.popupId,
      popupAriaLabel,
      () => {
        session.restoreFocus = true;
        this.floating.close();
      },
    );

    this.session = session;
    try {
      this.floating.open({
        anchorEl: trigger,
        placement: column.actionTrigger?.placement ?? "bottom-end",
        arrow: column.actionTrigger?.arrow !== false,
        closeOnOutsideClick: true,
        closeOnScroll: true,
        closeOnEscape: true,
        onEscape: () => {
          session.restoreFocus = true;
        },
        render: (host) => {
          host.appendChild(element);
          focusFirst();
          return cleanup;
        },
        onClose: () => {
          this.clearOpenTrigger();
          this.openKey = null;
          this.completeSession(session);
        },
      });
    } catch (error) {
      this.abandonFailedSession(session);
      throw error;
    }

    this.openKey = openKey;
    this.setOpenTrigger(trigger, "menu");
    return true;
  }

  private setOpenTrigger(trigger: HTMLElement, role: PopupRole): void {
    this.openTrigger = trigger;
    connectPopupTrigger(trigger, role, this.popupId);
  }

  private clearOpenTrigger(): void {
    const trigger = this.openTrigger;
    this.openTrigger = null;
    if (trigger !== null) {
      disconnectPopupTrigger(trigger, this.popupId);
    }
  }

  private completeSession(session: RowActionSession): void {
    if (this.session !== session) return;
    this.session = null;
    if (session.restoreFocus && session.invoker.isConnected) {
      session.invoker.focus({ preventScroll: true });
    }
  }

  private abandonFailedSession(session: RowActionSession): void {
    if (this.session === session) {
      this.session = null;
    }
  }

  private createOpenKey(rowId: string, colId: string, actionsKey: string): string {
    return `${rowId}\u0000${colId}\u0000${actionsKey}`;
  }

  /**
   * Resolve row data and display index from trigger DOM attributes using
   * the DisplayRowReader.
   *
   * Fast path: `data-row-index` points to a display row whose resolved id
   * matches `data-row-id` — one `getRowData` + one `resolveRowId` call.
   *
   * Fallback: stale index (after sort/filter) — scan display rows by id.
   * Only runs on user click — not in render paths.
   */
  private resolveRow(
    trigger: HTMLElement,
    rowId: string,
    expectedDisplayRowIndex?: number,
  ): { row: RowData; rowIndex: number } | null {
    const displayRows = this.options.getDisplayRows();

    const idxAttr = trigger.getAttribute("data-row-index");
    if (idxAttr !== null) {
      const idx = Number(idxAttr);
      if (Number.isInteger(idx) && idx >= 0 && idx < displayRows.rowCount) {
        const candidate = displayRows.getRowData(idx);
        if (candidate !== undefined) {
          if (this.options.resolveRowId(candidate, idx) === rowId) {
            return { row: candidate, rowIndex: idx };
          }
        }
      }
    }

    // Keyboard commands originate from a current retained physical binding.
    // If that exact O(1) lookup is stale, fail closed instead of scanning rows
    // on the keydown caller stack.
    if (expectedDisplayRowIndex !== undefined) return null;

    // Fallback: scan display rows by id. Handles stale DOM after
    // sort/filter where the display index no longer matches the row id.
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
