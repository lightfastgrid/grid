import type {
  ColumnDef,
  ColumnFilterModel,
  ColumnMenuOptions,
  FilterChangeSource,
  RowData,
} from "../../types";
import { FloatingController } from "../floating/FloatingController";
import {
  allocatePopupId,
  applyPopupElementSemantics,
  connectPopupTrigger,
  disconnectPopupTrigger,
  initializePopupTrigger,
  POPUP_TRIGGER_OPEN_CLASS,
} from "../menu/popupSemantics";

import { FILTER_PANEL_CLASS, FILTER_TRIGGER_CLASS } from "./dedicatedFilterDom";
import { resolveFilterColumnLabel } from "./filterControlAccessibleName";
import type { GetSelectionValuesArgs } from "./filterMenuForm";
import { createFilterMenuForm } from "./filterMenuForm";
import type { FilterSelectionValueResult } from "./filterSelectionValues";
import { buildFilterValueLabel } from "./filterValueLabel";
import { hasDedicatedMenu, resolveFilterMenuOptions } from "./resolveFilterMenuOptions";
import type { NormalizedColumnFilterConfig } from "./types";

export interface DedicatedFilterSelectionPreviewRenderContext {
  column: ColumnDef;
  field: string;
  value: string | number | boolean;
  label: string;
  sampleRowIndex: number;
  sampleRow: RowData | undefined;
}

export interface DedicatedFilterControllerOptions {
  gridRoot: HTMLElement;
  viewport: HTMLElement;
  getColumns: () => ColumnDef[];
  getColumnFilterModel: (field: string) => ColumnFilterModel | null;
  setColumnFilterModel: (field: string, model: ColumnFilterModel | null, source?: FilterChangeSource) => void;
  clearColumnFilter: (field: string, source?: FilterChangeSource) => void;
  getFilterConfig?: (field: string) => NormalizedColumnFilterConfig | null;
  getColumnMenuOptions?: () => ColumnMenuOptions | undefined;
  getSelectionValues?: (args: GetSelectionValuesArgs) => FilterSelectionValueResult;
  getRows?: () => RowData[];
  renderSelectionValuePreview?: (ctx: DedicatedFilterSelectionPreviewRenderContext) => HTMLElement | null;
}

export class DedicatedFilterController {
  private root: HTMLElement | null = null;
  private readonly floating: FloatingController;
  private readonly options: DedicatedFilterControllerOptions;
  private openField: string | null = null;
  private activeTrigger: HTMLElement | null = null;
  private activePopupId: string | null = null;
  private columnMap: Map<string, ColumnDef> | null = null;
  private lastColumnsRef: ColumnDef[] | null = null;
  private pendingCommandTrigger: HTMLElement | null = null;
  private commandOpenScheduled = false;
  private restoreFocusOnClose = false;

  constructor(options: DedicatedFilterControllerOptions) {
    this.options = options;
    this.floating = new FloatingController(options.gridRoot, options.viewport);
  }

  attach(root: HTMLElement): void {
    this.detach();
    this.root = root;
    this.root.addEventListener("click", this.onClick);
  }

  detach(): void {
    this.pendingCommandTrigger = null;
    this.commandOpenScheduled = false;
    this.restoreFocusOnClose = false;
    let primaryError: unknown;
    try {
      this.closePanel();
    } catch (error) {
      primaryError = error;
    }
    if (this.root) {
      this.root.removeEventListener("click", this.onClick);
      this.root = null;
    }
    try {
      this.floating.destroy();
    } catch (error) {
      primaryError ??= error;
    }
    this.columnMap = null;
    this.lastColumnsRef = null;
    if (primaryError !== undefined) {
      throw primaryError;
    }
  }

  requestOpenFromCommand(field: string, trigger: HTMLElement): boolean {
    if (field.length === 0 || !trigger.isConnected) return false;
    if (this.openField === field && this.floating.isOpen()) return true;
    this.pendingCommandTrigger = trigger;
    if (!this.commandOpenScheduled) {
      this.commandOpenScheduled = true;
      queueMicrotask(this.flushCommandOpen);
    }
    return true;
  }

  closeFromCommand(): boolean {
    if (!this.floating.isOpen()) return false;
    this.restoreFocusOnClose = true;
    this.closePanel();
    return true;
  }

  isOpen(): boolean {
    return this.floating.isOpen();
  }

  syncPlacementState(): void {
    if (!this.openField) return;
    const resolved = resolveFilterMenuOptions(this.options.getColumnMenuOptions?.());
    if (!hasDedicatedMenu(resolved)) {
      this.closePanel();
    }
  }

  private closePanel(): void {
    if (
      this.openField === null &&
      this.activeTrigger === null &&
      this.activePopupId === null
    ) {
      return;
    }
    const trigger = this.activeTrigger;
    const popupId = this.activePopupId;
    this.openField = null;
    this.activeTrigger = null;
    this.activePopupId = null;
    let primaryError: unknown;
    if (trigger !== null && popupId !== null) {
      try {
        trigger.classList.remove(POPUP_TRIGGER_OPEN_CLASS);
        disconnectPopupTrigger(trigger, popupId);
      } catch (error) {
        primaryError = error;
      }
    }
    try {
      this.floating.close();
    } catch (error) {
      primaryError ??= error;
    }
    if (primaryError !== undefined) {
      throw primaryError;
    }
  }

  private closeOwnedRelation(
    trigger: HTMLElement,
    popupId: string,
  ): void {
    if (this.activePopupId === popupId) {
      this.openField = null;
      this.activeTrigger = null;
      this.activePopupId = null;
    }
    disconnectPopupTrigger(trigger, popupId);
    trigger.classList.remove(POPUP_TRIGGER_OPEN_CLASS);
  }

  private readonly flushCommandOpen = (): void => {
    this.commandOpenScheduled = false;
    const trigger = this.pendingCommandTrigger;
    this.pendingCommandTrigger = null;
    if (trigger === null || !trigger.isConnected) return;
    trigger.click();
  };

  private resetFailedTrigger(trigger: HTMLElement): void {
    if (trigger.getAttribute("aria-controls") === null) {
      initializePopupTrigger(trigger, "dialog");
    }
  }

  private cleanupFailedOpen(
    trigger: HTMLElement,
    popupId: string,
    primaryError?: unknown,
  ): void {
    let error = primaryError;
    try {
      this.closeOwnedRelation(trigger, popupId);
    } catch (cleanupError) {
      error ??= cleanupError;
    }
    try {
      this.floating.close();
    } catch (cleanupError) {
      error ??= cleanupError;
    }
    try {
      this.resetFailedTrigger(trigger);
    } catch (cleanupError) {
      error ??= cleanupError;
    }
    if (error !== undefined) {
      throw error;
    }
  }

  private resolveColumn(field: string): ColumnDef | undefined {
    const columns = this.options.getColumns();
    if (columns !== this.lastColumnsRef) {
      this.lastColumnsRef = columns;
      this.columnMap = new Map<string, ColumnDef>();
      for (const col of columns) {
        this.columnMap.set(col.field, col);
      }
    }
    return this.columnMap!.get(field);
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;

    const target = event.target as Element | null;
    if (!target) return;

    const trigger = target.closest(`.${FILTER_TRIGGER_CLASS}`) as HTMLElement | null;
    if (!trigger) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const fromFloatingFilter = trigger.closest(".lfg-floating-filter-cell") !== null;
    const resolved = resolveFilterMenuOptions(this.options.getColumnMenuOptions?.());
    if (!fromFloatingFilter && !hasDedicatedMenu(resolved)) return;

    const field = trigger.getAttribute("data-col-id");
    if (!field) return;

    if (this.openField === field) {
      this.closePanel();
      return;
    }

    const col = this.resolveColumn(field);
    if (!col) return;

    const config = this.options.getFilterConfig?.(field) ?? null;
    if (!config) return;

    const activeModel = this.options.getColumnFilterModel(field);
    const popupId = allocatePopupId("dedicated-filter");
    const close = (): void => {
      this.closePanel();
    };

    const formatBooleanLabel = buildFilterValueLabel(col, config);

    // Close previous panel (A) before opening new one (B).
    if (this.openField) {
      this.closePanel();
    }
    const renderState: { panel: HTMLDivElement | null } = {
      panel: null,
    };
    try {
      this.floating.open({
        anchorEl: trigger,
        placement: "bottom-center",
        arrow: true,
        closeOnOutsideClick: true,
        closeOnScroll: true,
        closeOnEscape: true,
        onEscape: () => {
          this.restoreFocusOnClose = true;
        },
        render: (host) => {
          const panel = document.createElement("div");
          renderState.panel = panel;
          panel.className = FILTER_PANEL_CLASS;
          panel.setAttribute("data-col-id", field);
          applyPopupElementSemantics(panel, {
            id: popupId,
            role: "dialog",
            ariaLabel:
              `Filter ${resolveFilterColumnLabel(col.field, col.headerName)}`,
          });

          const { element, cleanup: formCleanup } = createFilterMenuForm({
            field,
            headerName: col.headerName,
            config,
            currentModel: activeModel,
            setColumnFilterModel: this.options.setColumnFilterModel,
            clearColumnFilter: this.options.clearColumnFilter,
            close,
            formatBooleanLabel,
            showConditions: resolved.conditionDedicatedMenu || (fromFloatingFilter && resolved.conditionMainMenu),
            showSelectionList: resolved.selectionDedicatedMenu || (fromFloatingFilter && resolved.selectionMainMenu),
            getSelectionValues: (resolved.selectionDedicatedMenu || (fromFloatingFilter && resolved.selectionMainMenu))
              ? this.options.getSelectionValues : undefined,
            renderSelectionValuePreview: (resolved.selectionDedicatedMenu || (fromFloatingFilter && resolved.selectionMainMenu))
              && this.options.renderSelectionValuePreview
              ? (previewCtx) => this.options.renderSelectionValuePreview!({
                  ...previewCtx,
                  column: col,
                  sampleRow: this.options.getRows?.()[previewCtx.sampleRowIndex],
                })
              : undefined,
          });
          panel.appendChild(element);
          host.appendChild(panel);

          const focusableSelector =
            "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [contenteditable='true'], [tabindex]:not([tabindex='-1'])";
          const onPanelKeyDown = (keyboardEvent: KeyboardEvent): void => {
            if (keyboardEvent.key === "Escape") {
              this.restoreFocusOnClose = true;
              this.closePanel();
              keyboardEvent.preventDefault();
              keyboardEvent.stopPropagation();
              return;
            }
            if (keyboardEvent.key !== "Tab") return;
            const controls = panel.querySelectorAll<HTMLElement>(
              focusableSelector,
            );
            const boundary = controls.length === 0 ||
              (keyboardEvent.shiftKey
                ? keyboardEvent.target === controls[0]
                : keyboardEvent.target === controls[controls.length - 1]);
            if (boundary) {
              this.restoreFocusOnClose = true;
              this.closePanel();
            }
          };
          panel.addEventListener("keydown", onPanelKeyDown);
          panel.querySelector<HTMLElement>(focusableSelector)?.focus({
            preventScroll: true,
          });

          return () => {
            panel.removeEventListener("keydown", onPanelKeyDown);
            formCleanup();
          };
        },
        onClose: () => {
          this.closeOwnedRelation(trigger, popupId);
          const restoreFocus = this.restoreFocusOnClose;
          this.restoreFocusOnClose = false;
          if (restoreFocus && trigger.isConnected) {
            trigger.focus({ preventScroll: true });
          }
        },
      });

      const panel = renderState.panel;
      if (
        panel === null ||
        !this.options.gridRoot.contains(trigger) ||
        !this.options.gridRoot.contains(panel)
      ) {
        this.cleanupFailedOpen(trigger, popupId);
        return;
      }

      this.openField = field;
      this.activeTrigger = trigger;
      this.activePopupId = popupId;
      connectPopupTrigger(trigger, "dialog", popupId);
      trigger.classList.add(POPUP_TRIGGER_OPEN_CLASS);
    } catch (error) {
      this.cleanupFailedOpen(trigger, popupId, error);
    }
  };
}
