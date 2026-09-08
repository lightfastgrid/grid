import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type {
  ColumnDef,
  LightFastGridCellShellActionEvent,
  RowData,
} from "../../types";
import { formatColumnValue, resolveColumnRawValue } from "../../value-access/columnValueAccess";

import {
  CELL_SHELL_ACTION_SELECTOR,
  CELL_SHELL_GROUP_ACTION_SELECTOR,
} from "./cellShellActionDom";

export interface CellShellActionControllerOptions {
  getColumns: () => ColumnDef[];
  getDisplayRows: () => DisplayRowReader;
  resolveRowId: (row: RowData, index: number) => string;
  onCellShellAction: (e: LightFastGridCellShellActionEvent) => void;
}

/**
 * One delegated click listener at the grid root that fires
 * {@link LightFastGridCellShellActionEvent} for button / iconButton / link
 * shells configured with an `actionKey`. No per-cell listeners.
 *
 * Row / column context is resolved from existing DOM attributes:
 * the shell's `data-action`, the enclosing `.lfg-cell`'s `data-col-id`, and
 * the row element's `data-row-id` / `data-row-index` — the same attributes the
 * row-action and selection controllers already rely on.
 */
export class CellShellActionController {
  private root: HTMLElement | null = null;
  private readonly options: CellShellActionControllerOptions;

  constructor(options: CellShellActionControllerOptions) {
    this.options = options;
  }

  attach(root: HTMLElement): void {
    this.detach();
    this.root = root;
    this.root.addEventListener("click", this.onClick);
  }

  detach(): void {
    if (this.root) {
      this.root.removeEventListener("click", this.onClick);
      this.root = null;
    }
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;

    const target = event.target as Element | null;
    if (!target) return;

    const shell = (
      target.closest(CELL_SHELL_GROUP_ACTION_SELECTOR) ??
      target.closest(CELL_SHELL_ACTION_SELECTOR)
    ) as HTMLElement | null;
    if (!shell) return;

    const actionKey = shell.getAttribute("data-action");
    if (!actionKey) return;

    const cellEl = shell.closest(".lfg-cell") as HTMLElement | null;
    const colId = cellEl?.getAttribute("data-col-id");
    if (!colId) return;

    const rowEl = shell.closest("[data-row-id]") as HTMLElement | null;
    const rowId = rowEl?.getAttribute("data-row-id");
    if (!rowId) return;

    const lookup = this.resolveRow(rowEl, rowId);
    if (!lookup) return;
    const { row, rowIndex } = lookup;

    const column = this.options.getColumns().find((c) => c.field === colId);
    if (!column) return;

    const value = resolveColumnRawValue(row, rowIndex, column);
    const formattedValue = formatColumnValue(value, row, rowIndex, column);

    event.preventDefault();
    event.stopImmediatePropagation();

    this.options.onCellShellAction({
      actionKey,
      rowId,
      rowIndex,
      field: colId,
      column,
      row,
      value,
      formattedValue,
      originalEvent: event,
    });
  };

  /**
   * Resolve row data + display index from the row element. Fast path uses
   * `data-row-index` when it still maps to `rowId`; otherwise scans display
   * rows by id (handles stale DOM after sort/filter). Click-path only.
   */
  private resolveRow(
    rowEl: HTMLElement | null,
    rowId: string,
  ): { row: RowData; rowIndex: number } | null {
    const displayRows = this.options.getDisplayRows();

    const idxAttr = rowEl?.getAttribute("data-row-index") ?? null;
    if (idxAttr !== null) {
      const idx = Number(idxAttr);
      if (Number.isInteger(idx) && idx >= 0 && idx < displayRows.rowCount) {
        const candidate = displayRows.getRowData(idx);
        if (
          candidate !== undefined &&
          this.options.resolveRowId(candidate, idx) === rowId
        ) {
          return { row: candidate, rowIndex: idx };
        }
      }
    }

    for (let i = 0; i < displayRows.rowCount; i++) {
      const row = displayRows.getRowData(i);
      if (row === undefined) continue;
      if (this.options.resolveRowId(row, i) === rowId) {
        return { row, rowIndex: i };
      }
    }

    return null;
  }
}
