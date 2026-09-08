import type {
  ColumnDef,
  ColumnMenuGridApi,
  ColumnMenuOptions,
  ColumnMenuSectionActionContext,
  SortModel,
} from "../../types";
import { FloatingController } from "../floating/FloatingController";
import {
  allocatePopupId,
  POPUP_TRIGGER_OPEN_CLASS,
} from "../menu/popupSemantics";

import { mergeColumnMenuSections } from "./columnMenuCustomSections";
import { MENU_TRIGGER_CLASS } from "./columnMenuDom";
import { createColumnMenuPanel } from "./createColumnMenuPanel";
import type { ColumnMenuContext, ColumnMenuContribution, ColumnMenuSection } from "./types";

function hasVisibleContent(sections: ColumnMenuSection[]): boolean {
  for (const section of sections) {
    if (typeof section.render === "function") return true;
    for (const item of section.items) {
      if (!item.hidden) return true;
    }
  }
  return false;
}

interface ColumnMenuSession {
  readonly trigger: HTMLElement;
  restoreFocus: boolean;
}

export interface ColumnMenuControllerOptions {
  gridRoot: HTMLElement;
  viewport: HTMLElement;
  getColumns: () => ColumnDef[];
  getSortModel: () => SortModel;
  getSelectedColumnIds?: () => string[];
  contributions: ColumnMenuContribution[];
  getMenuApi?: () => ColumnMenuGridApi;
  getColumnMenuOptions?: () => ColumnMenuOptions | undefined;
  onOpenFieldChange?: (openField: string | null) => void;
}

export class ColumnMenuController {
  private root: HTMLElement | null = null;
  private readonly floating: FloatingController;
  private readonly options: ColumnMenuControllerOptions;
  private readonly popupId = allocatePopupId("column-menu");
  private openField: string | null = null;
  private session: ColumnMenuSession | null = null;
  private pendingCommandField: string | null = null;
  private pendingCommandTrigger: HTMLElement | null = null;
  private commandOpenScheduled = false;

  constructor(options: ColumnMenuControllerOptions) {
    this.options = options;
    this.floating = new FloatingController(options.gridRoot, options.viewport);
  }

  attach(root: HTMLElement): void {
    this.detach();
    this.root = root;
    this.root.addEventListener("click", this.onClick);
  }

  detach(): void {
    this.pendingCommandField = null;
    this.pendingCommandTrigger = null;
    this.commandOpenScheduled = false;
    this.session = null;
    try {
      this.floating.destroy();
    } finally {
      this.setOpenField(null);
      if (this.root) {
        this.root.removeEventListener("click", this.onClick);
        this.root = null;
      }
    }
  }

  getOpenField(): string | null {
    return this.openField;
  }

  getOpenPopupId(): string | null {
    return this.openField === null ? null : this.popupId;
  }

  requestOpenFromCommand(field: string, trigger: HTMLElement): boolean {
    if (
      field.length === 0 ||
      !trigger.isConnected ||
      this.options.getColumnMenuOptions?.()?.enabled === false
    ) {
      return false;
    }
    this.pendingCommandField = field;
    this.pendingCommandTrigger = trigger;
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

  private setOpenField(field: string | null): void {
    if (this.openField === field) {
      return;
    }
    this.openField = field;
    this.options.onOpenFieldChange?.(field);
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;

    const menuOptions = this.options.getColumnMenuOptions?.();
    if (menuOptions?.enabled === false) return;

    const target = event.target as Element | null;
    if (!target) return;

    const trigger = target.closest(`.${MENU_TRIGGER_CLASS}`) as HTMLElement | null;
    if (!trigger) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const field = trigger.getAttribute("data-col-id");
    if (!field) return;

    if (this.openField === field) {
      this.floating.close();
      return;
    }

    this.openMenu(field, trigger);
  };

  private readonly flushCommandOpen = (): void => {
    this.commandOpenScheduled = false;
    const field = this.pendingCommandField;
    const trigger = this.pendingCommandTrigger;
    this.pendingCommandField = null;
    this.pendingCommandTrigger = null;
    if (field === null || trigger === null || !trigger.isConnected) return;
    this.openMenu(field, trigger);
  };

  private openMenu(field: string, trigger: HTMLElement): boolean {
    if (this.options.getColumnMenuOptions?.()?.enabled === false) return false;
    if (this.openField === field && this.floating.isOpen()) return true;

    const close = (): void => this.floating.close();

    const sections = this.buildSections(field, close);
    if (!hasVisibleContent(sections)) return false;

    const popupAriaLabel =
      trigger.getAttribute("aria-label")?.trim() || "Column menu";

    const session: ColumnMenuSession = { trigger, restoreFocus: false };
    this.session = session;
    this.floating.open({
      anchorEl: trigger,
      placement: "bottom-center",
      arrow: true,
      closeOnOutsideClick: true,
      closeOnScroll: true,
      closeOnEscape: true,
      onEscape: () => {
        session.restoreFocus = true;
      },
      render: (host) => {
        const { element, cleanup, focusFirst } = createColumnMenuPanel(
          field,
          sections,
          this.popupId,
          popupAriaLabel,
          () => {
            session.restoreFocus = true;
            this.floating.close();
          },
        );
        host.appendChild(element);
        focusFirst();

        return cleanup;
      },
      onClose: () => {
        session.trigger.classList.remove(POPUP_TRIGGER_OPEN_CLASS);
        this.setOpenField(null);
        if (this.session !== session) return;
        this.session = null;
        if (session.restoreFocus && session.trigger.isConnected) {
          session.trigger.focus({ preventScroll: true });
        }
      },
    });

    trigger.classList.add(POPUP_TRIGGER_OPEN_CLASS);
    this.setOpenField(field);
    return true;
  }

  private buildSections(
    field: string,
    close: () => void,
  ): ColumnMenuSection[] {
    const columns = this.options.getColumns();
    const col = columns.find((c) => c.field === field);
    if (!col) return [];

    const ctx: ColumnMenuContext = {
      field,
      column: col,
      columns,
      sortModel: this.options.getSortModel(),
      selectedColumnIds: this.options.getSelectedColumnIds?.() ?? [],
      close,
    };

    const defaultSections: ColumnMenuSection[] = [];
    for (const contribution of this.options.contributions) {
      for (const section of contribution.getSections(ctx)) {
        defaultSections.push(section);
      }
    }

    const menuOptions = this.options.getColumnMenuOptions?.();
    const customSections = menuOptions?.sections;
    if (!customSections || !this.options.getMenuApi) return defaultSections;

    const actionContext: ColumnMenuSectionActionContext = {
      field,
      column: col,
      columns,
      selectedColumnIds: ctx.selectedColumnIds,
      defaultSections,
      grid: this.options.getMenuApi(),
      close,
    };

    const sections = customSections(actionContext);
    return mergeColumnMenuSections(
      defaultSections,
      Array.isArray(sections) ? sections : [],
      actionContext,
    );
  }
}
