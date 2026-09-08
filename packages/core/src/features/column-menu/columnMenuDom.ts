import { isInternalColumn } from "../../internal/internalColumns";
import type { ColumnDef, ColumnMenuOptions } from "../../types";

export const MENU_TRIGGER_CLASS = "lfg-column-menu-trigger";
export const MENU_PANEL_CLASS = "lfg-column-menu-panel";
export const MENU_ITEM_CLASS = "lfg-column-menu-item";
export const MENU_SEPARATOR_CLASS = "lfg-column-menu-separator";

export function shouldShowMenuTrigger(col: ColumnDef, menuOptions?: ColumnMenuOptions): boolean {
  if (menuOptions?.enabled === false) return false;
  if (col.columnMenu === false) return false;
  return !isInternalColumn(col);
}

export function isColumnMenuUiTarget(el: Element): boolean {
  return !!(
    el.closest(`.${MENU_TRIGGER_CLASS}`) ||
    el.closest(`.${MENU_PANEL_CLASS}`)
  );
}
