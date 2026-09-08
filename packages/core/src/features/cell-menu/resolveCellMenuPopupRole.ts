import type { CellMenuOptions } from "../../types";
import type { PopupRole } from "../menu/popupSemantics";

/** Resolves the ARIA popup role for a cell-menu surface from current options. */
export function resolveCellMenuPopupRole(
  options: Pick<CellMenuOptions, "renderPanel"> | undefined,
): PopupRole {
  return typeof options?.renderPanel === "function" ? "dialog" : "menu";
}
