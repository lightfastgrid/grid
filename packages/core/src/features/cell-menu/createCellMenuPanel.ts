import type {
  CellMenuActionContext,
  CellMenuContext,
  CellMenuItem,
  CellMenuPanelRenderContext,
} from "../../types";
import { createMenuPanel } from "../menu/createMenuPanel";
import type { MenuPanelResult, MenuSection } from "../menu/types";

import {
  CELL_MENU_ICON_CLASS,
  CELL_MENU_ITEM_CLASS,
  CELL_MENU_PANEL_CLASS,
  CELL_MENU_SEPARATOR_CLASS,
} from "./cellMenuDom";
import { resolveCellMenuPopupRole } from "./resolveCellMenuPopupRole";

const CELL_MENU_CONFIG = {
  panelClass: CELL_MENU_PANEL_CLASS,
  itemClass: CELL_MENU_ITEM_CLASS,
  iconClass: CELL_MENU_ICON_CLASS,
  separatorClass: CELL_MENU_SEPARATOR_CLASS,
} as const;

function assertUniqueActionIds(actions: readonly CellMenuItem[]): void {
  const seen = new Set<string>();
  for (const action of actions) {
    if (seen.has(action.id)) {
      throw new Error(
        `Cell menu action ids must be unique within one open menu. Duplicate id: "${action.id}"`,
      );
    }
    seen.add(action.id);
  }
}

export function createCellMenuPanel(
  actions: CellMenuItem[],
  ctx: CellMenuContext,
  onAction: (actionCtx: CellMenuActionContext) => void,
  close: () => void,
  popupId: string,
  onRequestClose?: (reason: "escape" | "tab") => void,
  renderPanel?: (
    host: HTMLElement,
    ctx: CellMenuPanelRenderContext,
  ) => void | (() => void),
): MenuPanelResult {
  assertUniqueActionIds(actions);

  const hasCustomPanel = typeof renderPanel === "function";
  const popupRole = resolveCellMenuPopupRole(
    hasCustomPanel ? { renderPanel } : undefined,
  );
  const sections: MenuSection[] = [
    {
      id: "cell-actions",
      items: actions.map((a) => ({
        ...a,
        action: () =>
          onAction({
            ...ctx,
            actionId: a.id,
            action: a,
            close,
          }),
      })),
    },
  ];

  if (hasCustomPanel) {
    sections.push({
      id: "cell-custom",
      items: [],
      render: (host) => renderPanel(host, { ...ctx, close }),
    });
  }

  return createMenuPanel(
    sections,
    { ...CELL_MENU_CONFIG, onRequestClose },
    {
      id: popupId,
      ariaLabel: `${ctx.column.headerName?.trim() || ctx.field} cell menu`,
      role: popupRole,
    },
  );
}
