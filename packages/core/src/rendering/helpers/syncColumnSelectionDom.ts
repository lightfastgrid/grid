import { isInternalColumn } from "../../internal/internalColumns";
import type { PooledRow } from "../types/types";

const FLOATING_FILTER_CELL_CLASS = "lfg-floating-filter-cell";
const FLOATING_FILTER_ROW_CLASS = "lfg-floating-filter-row";

function syncSelectableColumnCellClass(
  el: HTMLElement,
  isColumnSelected: (field: string) => boolean,
): void {
  if (el.style.display === "none") {
    el.classList.remove("lfg-column-selected");
    return;
  }
  const field = el.getAttribute("data-col-id");
  if (!field || isInternalColumn({ field })) {
    el.classList.remove("lfg-column-selected");
    return;
  }
  el.classList.toggle("lfg-column-selected", isColumnSelected(field));
}

/**
 * Toggles `.lfg-column-selected` on visible header/body/floating-filter cells —
 * no data binding, geometry, or window sync.
 */
export function syncColumnSelectionDom(
  headerRowEl: HTMLDivElement | null,
  pool: PooledRow[],
  isColumnSelected: (field: string) => boolean,
): void {
  if (headerRowEl) {
    for (let i = 0; i < headerRowEl.children.length; i++) {
      const el = headerRowEl.children[i];
      if (!(el instanceof HTMLElement)) continue;
      if (!el.classList.contains("lfg-header-cell")) continue;
      syncSelectableColumnCellClass(el, isColumnSelected);
    }
  }

  for (const poolRow of pool) {
    if (poolRow.rowIndex < 0 || poolRow.element.style.display === "none") {
      continue;
    }
    for (const cell of poolRow.cells) {
      syncSelectableColumnCellClass(cell.element, isColumnSelected);
    }
    if (poolRow.pinnedCells) {
      for (const cell of poolRow.pinnedCells) {
        syncSelectableColumnCellClass(cell.element, isColumnSelected);
      }
    }
    if (poolRow.rightPinnedCells) {
      for (const cell of poolRow.rightPinnedCells) {
        syncSelectableColumnCellClass(cell.element, isColumnSelected);
      }
    }
  }
}

/** Patch column-selection class on floating-filter row cells. */
export function syncFloatingFilterColumnSelectionDom(
  root: HTMLElement | null,
  isColumnSelected: (field: string) => boolean,
): void {
  if (!root) return;
  const rows = root.querySelectorAll(`.${FLOATING_FILTER_ROW_CLASS}`);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (!(row instanceof HTMLElement)) continue;
    for (let i = 0; i < row.children.length; i++) {
      const el = row.children[i];
      if (!(el instanceof HTMLElement)) continue;
      if (!el.classList.contains(FLOATING_FILTER_CELL_CLASS)) continue;
      syncSelectableColumnCellClass(el, isColumnSelected);
    }
  }
}
