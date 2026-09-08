// ─── dom/buildRowTemplate.ts — one body row template + cell divs ───

import { CSS } from "../../const/css-classes";

import { createDiv } from "./createDomElement";

/**
 * Row template with `columnSlotCount` cells (horizontal window slots).
 * Layout positions (left/width) are applied during populate/sync.
 *
 * Row-drag handles live inside the internal row-drag body cell, not as
 * overlay siblings of these slots.
 */
export function buildRowTemplate(columnSlotCount: number): HTMLDivElement {
  const row = createDiv(CSS.ROW);

  for (let i = 0; i < columnSlotCount; i++) {
    row.appendChild(createDiv(CSS.CELL));
  }

  return row;
}
