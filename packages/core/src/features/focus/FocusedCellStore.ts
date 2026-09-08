/**
 * Focused-cell store.
 *
 * Holds the single focused cell by stable identity (`rowId` + `field`).
 * The display/source indexes are positional metadata refreshed by the
 * controller when the row model changes — index updates alone are not
 * identity changes and never produce a change result.
 *
 * Pure data: no DOM, no events, no feature imports.
 */

import type { FocusedCell } from "../../types";

export interface FocusedCellChange {
  previous: FocusedCell | null;
}

export class FocusedCellStore {
  private cell: FocusedCell | null = null;

  get(): FocusedCell | null {
    return this.cell;
  }

  /**
   * Set the focused cell. Returns the change (with the previous cell)
   * or `null` when the identity (`rowId` + `field`) is unchanged —
   * positional metadata is still refreshed silently in that case.
   */
  set(cell: FocusedCell): FocusedCellChange | null {
    const previous = this.cell;
    if (
      previous !== null &&
      previous.rowId === cell.rowId &&
      previous.field === cell.field
    ) {
      this.cell = cell; // silent index refresh
      return null;
    }
    this.cell = cell;
    return { previous };
  }

  /** Clear the focused cell. Returns `null` when nothing was focused. */
  clear(): FocusedCellChange | null {
    if (this.cell === null) return null;
    const previous = this.cell;
    this.cell = null;
    return { previous };
  }

  /** Silently refresh positional metadata for the current identity. */
  updatePosition(rowIndex: number, sourceIndex: number): void {
    if (this.cell === null) return;
    if (this.cell.rowIndex === rowIndex && this.cell.sourceIndex === sourceIndex) {
      return;
    }
    this.cell = { ...this.cell, rowIndex, sourceIndex };
  }
}
