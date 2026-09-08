import { createMenuPanel } from "../menu/createMenuPanel";
import type { MenuPanelResult } from "../menu/types";

import { applyColumnMenuActionIcons } from "./columnMenuActionIcons";
import { MENU_ITEM_CLASS, MENU_PANEL_CLASS, MENU_SEPARATOR_CLASS } from "./columnMenuDom";
import type { ColumnMenuSection } from "./types";

export type { MenuPanelResult as ColumnMenuPanelResult };

const COLUMN_MENU_CONFIG = {
  panelClass: MENU_PANEL_CLASS,
  itemClass: MENU_ITEM_CLASS,
  iconClass: "lfg-column-menu-icon",
  labelClass: "lfg-column-menu-label",
  separatorClass: MENU_SEPARATOR_CLASS,
} as const;

export function createColumnMenuPanel(
  field: string,
  sections: ColumnMenuSection[],
  popupId: string,
  ariaLabel: string,
  onRequestClose?: (reason: "escape" | "tab") => void,
): MenuPanelResult {
  const result = createMenuPanel(sections, {
    ...COLUMN_MENU_CONFIG,
    onRequestClose,
  }, {
    id: popupId,
    ariaLabel,
    role: "dialog",
  });
  const { element } = result;
  element.setAttribute("data-col-id", field);
  applyColumnMenuActionIcons(element, `.${COLUMN_MENU_CONFIG.iconClass}`);
  return result;
}
