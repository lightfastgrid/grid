import type { HeaderControlDescriptor } from "../../rendering/headerControlTypes";
import type { ColumnDef, ColumnMenuOptions } from "../../types";

import { FILTER_TRIGGER_CLASS, shouldShowFilterTrigger } from "./dedicatedFilterDom";

export function filterHeaderControl(
  col: ColumnDef,
  menuOptions?: ColumnMenuOptions,
): HeaderControlDescriptor | null {
  if (!shouldShowFilterTrigger(col, menuOptions)) return null;
  return {
    id: "columnFilter",
    layoutRole: "menu",
    className: FILTER_TRIGGER_CLASS,
    ariaLabel: `Filter ${col.headerName ?? col.field}`,
    ariaHaspopup: "dialog",
    ariaExpanded: "false",
  };
}
