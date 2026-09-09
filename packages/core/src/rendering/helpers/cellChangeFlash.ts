import type { ColumnDef } from "../../types";
import { CSS } from "../const/css-classes";
import type { PooledCell, PooledRow } from "../types/types";

const FLASH_CLASSES = [
  CSS.CELL_CHANGE_FLASH,
  CSS.CELL_CHANGE_FLASH_A,
  CSS.CELL_CHANGE_FLASH_B,
] as const;

export function isCellChangeFlashAnimationName(name: string): boolean {
  return cellChangeFlashGenerationFromName(name) !== undefined;
}

export function cellChangeFlashGenerationFromName(name: string): 0 | 1 | undefined {
  if (name === "lfg-cell-change-flash-a") return 0;
  if (name === "lfg-cell-change-flash-b") return 1;
  return undefined;
}

/**
 * Delegated `animationend` cleanup. Clears flash classes only when the
 * event belongs to this cell's currently active generation. Stale A/B
 * completions, descendant nodes, and unrelated animations are ignored.
 */
export function tryClearCellChangeFlashOnAnimationEnd(
  target: EventTarget | null,
  animationName: string,
): void {
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains(CSS.CELL)) return;
  const gen = cellChangeFlashGenerationFromName(animationName);
  if (gen === undefined) return;
  const genClass = gen === 0 ? CSS.CELL_CHANGE_FLASH_A : CSS.CELL_CHANGE_FLASH_B;
  if (!target.classList.contains(genClass)) return;
  clearCellChangeFlashFromElement(target);
}

export function clearCellChangeFlashFromElement(el: HTMLElement): void {
  el.classList.remove(...FLASH_CLASSES);
}

export function clearCellChangeFlash(cell: PooledCell): void {
  if (
    cell.flashAnim === undefined &&
    !cell.element.classList.contains(CSS.CELL_CHANGE_FLASH)
  ) {
    return;
  }
  cell.flashAnim = undefined;
  clearCellChangeFlashFromElement(cell.element);
}

export function restartCellChangeFlash(cell: PooledCell): void {
  const next: 0 | 1 = cell.flashAnim === 0 ? 1 : 0;
  cell.flashAnim = next;
  const el = cell.element;
  el.classList.remove(...FLASH_CLASSES);
  el.classList.add(
    CSS.CELL_CHANGE_FLASH,
    next === 0 ? CSS.CELL_CHANGE_FLASH_A : CSS.CELL_CHANGE_FLASH_B,
  );
}

export function clearRowCellChangeFlashes(poolRow: PooledRow): void {
  for (let i = 0; i < poolRow.cells.length; i++) {
    const cell = poolRow.cells[i];
    if (cell) clearCellChangeFlash(cell);
  }
  if (poolRow.pinnedCells) {
    for (let i = 0; i < poolRow.pinnedCells.length; i++) {
      const cell = poolRow.pinnedCells[i];
      if (cell) clearCellChangeFlash(cell);
    }
  }
  if (poolRow.rightPinnedCells) {
    for (let i = 0; i < poolRow.rightPinnedCells.length; i++) {
      const cell = poolRow.rightPinnedCells[i];
      if (cell) clearCellChangeFlash(cell);
    }
  }
}

function dirtyFieldTouchesColumn(
  field: string,
  dirtyFields: ReadonlySet<string>,
): boolean {
  if (dirtyFields.has(field)) return true;
  if (field.includes(".")) {
    const prefix = field.split(".")[0]!;
    if (dirtyFields.has(prefix)) return true;
  }
  return false;
}

/**
 * Restart or cancel a transaction cell-change flash on a pooled cell.
 *
 * Direct-field columns flash when this bind's one-shot `flashFields` map
 * targets the column, including when the same accepted sort/filter/search
 * render rebinds the row onto a different pooled slot. Ordinary scrolling
 * and recycling have no flash map, so leftover flashes are cleared and not
 * replayed. Derived `valueGetter` / `valueFormatter` columns still require
 * an already-bound display string change.
 */
export function syncCellChangeFlash(
  cell: PooledCell,
  args: {
    column: ColumnDef;
    wasBoundToSameCell: boolean;
    flashFields: ReadonlySet<string> | undefined;
    prevDisplay: string;
    nextDisplay: string;
  },
): void {
  const derived = args.column.valueGetter !== undefined
    || args.column.valueFormatter !== undefined;
  const flashFields = args.flashFields;

  if (!args.wasBoundToSameCell) {
    if (
      args.column.cellChangeFlash === true &&
      flashFields !== undefined &&
      !derived &&
      dirtyFieldTouchesColumn(args.column.field, flashFields)
    ) {
      restartCellChangeFlash(cell);
      return;
    }
    clearCellChangeFlash(cell);
    return;
  }
  if (args.column.cellChangeFlash !== true || flashFields === undefined) return;
  if (derived) {
    if (args.prevDisplay !== args.nextDisplay) restartCellChangeFlash(cell);
    return;
  }
  if (dirtyFieldTouchesColumn(args.column.field, flashFields)) {
    restartCellChangeFlash(cell);
  }
}
