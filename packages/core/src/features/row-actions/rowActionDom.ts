import type { CellRendererRegistry, ColumnDef } from "../../types";
import {
  clearPopupTriggerSemantics,
  initializePopupTrigger,
  type PopupRole,
} from "../menu/popupSemantics";

export const ACTION_TRIGGER_CLASS = "lfg-action-trigger";
export const ACTION_CELL_CLASS = "lfg-action-cell";
export const ACTION_MENU_PANEL_CLASS = "lfg-action-menu-panel";
export const ACTION_CUSTOM_PANEL_CLASS = "lfg-action-custom-panel";
export const ACTION_MENU_ITEM_CLASS = "lfg-action-menu-item";
export const ACTION_MENU_ICON_CLASS = "lfg-action-menu-icon";
export const ACTION_MENU_SEPARATOR_CLASS = "lfg-action-menu-separator";

export function isActionColumn(col: ColumnDef): boolean {
  return col.cellKind === "actions";
}

export function resolveRowActionPopupRole(
  actionsKey: string,
  registry: CellRendererRegistry | undefined,
): PopupRole | null {
  if (actionsKey === "") return null;
  const renderer = registry?.[actionsKey];
  if (renderer === undefined) return null;
  return renderer.mode === "custom" ? "dialog" : "menu";
}

export function syncRowActionTriggerPopupSemantics(
  trigger: HTMLButtonElement,
  actionsKey: string,
  registry: CellRendererRegistry | undefined,
  bindingChanged: boolean,
): void {
  const role = resolveRowActionPopupRole(actionsKey, registry);
  if (role === null) {
    clearPopupTriggerSemantics(trigger);
    return;
  }

  if (
    bindingChanged ||
    trigger.getAttribute("aria-haspopup") !== role
  ) {
    initializePopupTrigger(trigger, role);
    return;
  }

  if (!trigger.hasAttribute("aria-expanded")) {
    trigger.setAttribute("aria-expanded", "false");
  }
}

export function isRowActionUiTarget(el: Element): boolean {
  return !!(
    el.closest(`.${ACTION_TRIGGER_CLASS}`) ||
    el.closest(`.${ACTION_MENU_PANEL_CLASS}`)
  );
}
