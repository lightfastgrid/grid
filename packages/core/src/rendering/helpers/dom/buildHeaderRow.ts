// ─── dom/buildHeaderRow.ts — header row + header cells DOM ───

import { CSS } from "../../const/css-classes";

import { createDiv } from "./createDomElement";

/**
 * Header row with `columnSlotCount` cells for horizontal virtualization.
 * Labels and geometry are set in DomGridRenderer (`syncHeaderRowSlots`).
 */
export function buildHeaderSlotRow(columnSlotCount: number): HTMLDivElement {
  const row = createDiv(CSS.HEADER_ROW);

  for (let i = 0; i < columnSlotCount; i++) {
    row.appendChild(createDiv(CSS.HEADER_CELL));
  }

  return row;
}
