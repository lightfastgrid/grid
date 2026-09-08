import type { HeaderControlDescriptor } from "../../rendering/headerControlTypes";
import type { ColumnDef, ColumnMenuOptions } from "../../types";

import { MENU_TRIGGER_CLASS, shouldShowMenuTrigger } from "./columnMenuDom";

export function menuHeaderControl(
  col: ColumnDef,
  menuOptions?: ColumnMenuOptions,
): HeaderControlDescriptor | null {
  if (!shouldShowMenuTrigger(col, menuOptions)) return null;
  return {
    id: "columnMenu",
    layoutRole: "menu",
    className: MENU_TRIGGER_CLASS,
    ariaLabel: `Column menu for ${col.headerName ?? col.field}`,
  };
}
