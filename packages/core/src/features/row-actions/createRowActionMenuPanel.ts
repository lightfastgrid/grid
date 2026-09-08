import type { RowActionItem } from "../../types";
import { createMenuPanel } from "../menu/createMenuPanel";
import type { MenuPanelResult } from "../menu/types";

import {
  ACTION_MENU_ICON_CLASS,
  ACTION_MENU_ITEM_CLASS,
  ACTION_MENU_PANEL_CLASS,
  ACTION_MENU_SEPARATOR_CLASS,
} from "./rowActionDom";

const ROW_ACTION_MENU_CONFIG = {
  panelClass: ACTION_MENU_PANEL_CLASS,
  itemClass: ACTION_MENU_ITEM_CLASS,
  iconClass: ACTION_MENU_ICON_CLASS,
  separatorClass: ACTION_MENU_SEPARATOR_CLASS,
} as const;

export function createRowActionMenuPanel(
  actions: RowActionItem[],
  onAction: (actionId: string, action: RowActionItem) => void,
  popupId: string,
  ariaLabel: string,
  onRequestClose?: (reason: "escape" | "tab") => void,
): MenuPanelResult {
  const items = actions.map((a) => ({
    ...a,
    action: () => onAction(a.id, a),
  }));

  return createMenuPanel(
    [{ id: "row-actions", items }],
    { ...ROW_ACTION_MENU_CONFIG, onRequestClose },
    {
      id: popupId,
      ariaLabel,
      role: "menu",
    },
  );
}
