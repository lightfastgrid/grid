import type { ColumnDef, ColumnMenuOptions } from "../../types";

import { isColumnFilterEligible } from "./filterColumnEligibility";
import { hasDedicatedMenu, resolveFilterMenuOptions } from "./resolveFilterMenuOptions";

export const FILTER_TRIGGER_CLASS = "lfg-column-filter-trigger";
export const FILTER_PANEL_CLASS = "lfg-column-filter-panel";

export function shouldShowFilterTrigger(
  col: ColumnDef,
  menuOptions?: ColumnMenuOptions,
): boolean {
  if (!isColumnFilterEligible(col)) return false;
  if (!col.filterable) return false;
  return hasDedicatedMenu(resolveFilterMenuOptions(menuOptions));
}

/** True when the event target is the dedicated filter trigger or its open panel. */
export function isDedicatedFilterUiTarget(el: Element): boolean {
  return !!(
    el.closest(`.${FILTER_TRIGGER_CLASS}`) ||
    el.closest(`.${FILTER_PANEL_CLASS}`)
  );
}
