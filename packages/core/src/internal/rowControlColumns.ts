import type {
  ColumnDef,
  RowDragNormalizedConfig,
  RowSelectionCheckboxColumnConfig,
  RowSelectionConfig,
} from "../types";

import {
  createRowDragColumnDef,
  isRowDragColumn,
} from "./rowDragColumn";
import { createSelectionColumnDef, isSelectionColumn } from "./selectionColumn";

export const ROW_CONTROLS_COLUMN_FIELD = "__lfg_row_controls__" as const;

/**
 * Combined drag + checkbox lane never shrinks below this, even when
 * `checkboxColumn.width` is deliberately narrower than a standalone checkbox.
 * A wider explicit checkbox width is preserved: combinedWidth =
 * Math.max(ROW_CONTROLS_MIN_WIDTH, checkboxColumn.width).
 */
export const ROW_CONTROLS_MIN_WIDTH = 64;

export const ROW_CONTROLS_CELL_CLASS = "lfg-row-controls-cell";
export const ROW_CONTROLS_HEADER_CLASS = "lfg-row-controls-header-cell";
export const ROW_CONTROLS_DRAG_SLOT_CLASS = "lfg-row-controls-drag-slot";
export const ROW_CONTROLS_SELECTION_SLOT_CLASS = "lfg-row-controls-selection-slot";

export function isCombinedRowControlsColumn(
  col: Pick<ColumnDef, "field" | "internal">,
): boolean {
  return col.field === ROW_CONTROLS_COLUMN_FIELD || col.internal === "row-controls";
}

export function resolveRowControlsColumnWidth(checkboxWidth: number): number {
  return Math.max(ROW_CONTROLS_MIN_WIDTH, checkboxWidth);
}

/**
 * Combined left-pinned utility column: drag handle + row checkbox.
 *
 * `checkboxColumn.width` is the requested combined-lane width. It cannot
 * pull the combined column below {@link ROW_CONTROLS_MIN_WIDTH}; a wider
 * request is kept.
 */
export function createRowControlsColumnDef(
  cfg?: RowSelectionCheckboxColumnConfig,
): ColumnDef {
  const width = resolveRowControlsColumnWidth(cfg?.width ?? 44);
  return {
    field: ROW_CONTROLS_COLUMN_FIELD,
    headerName: "",
    width,
    minWidth: width,
    maxWidth: width,
    pinned: "left",
    pinnable: false,
    resizable: false,
    reorderable: false,
    columnMenu: false,
    columnSelectable: false,
    suppressRowClickSelection: true,
    sortable: false,
    filterable: false,
    editable: false,
    visible: true,
    searchable: false,
    floatingFilter: false,
    suppressSizeToFit: true,
    internal: "row-controls",
  };
}

function isInjectedRowControlColumn(
  col: Pick<ColumnDef, "internal">,
): boolean {
  return (
    col.internal === "selection" ||
    col.internal === "row-drag" ||
    col.internal === "row-controls"
  );
}

function wantsSelectionColumn(rowSelection: RowSelectionConfig): boolean {
  return rowSelection.checkboxes && rowSelection.mode !== "none";
}

function isLeftPinnedCheckbox(rowSelection: RowSelectionConfig): boolean {
  return rowSelection.checkboxColumn.pinned === "left";
}

function planRowControlColumns(
  rowSelection: RowSelectionConfig,
  rowDrag: RowDragNormalizedConfig,
): ColumnDef[] {
  const wantSelection = wantsSelectionColumn(rowSelection);
  const wantDrag = rowDrag.enabled;

  if (wantSelection && wantDrag && isLeftPinnedCheckbox(rowSelection)) {
    return [createRowControlsColumnDef(rowSelection.checkboxColumn)];
  }

  const internals: ColumnDef[] = [];
  if (wantDrag) internals.push(createRowDragColumnDef());
  if (wantSelection) {
    internals.push(createSelectionColumnDef(rowSelection.checkboxColumn));
  }
  return internals;
}

function plannedMatchesExisting(
  planned: readonly ColumnDef[],
  existing: readonly ColumnDef[],
): boolean {
  if (planned.length !== existing.length) return false;
  for (let i = 0; i < planned.length; i++) {
    const next = planned[i]!;
    const prev = existing[i]!;
    if (
      next.field !== prev.field ||
      next.internal !== prev.internal ||
      next.width !== prev.width ||
      next.pinned !== prev.pinned
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Single owner for internal row-control columns.
 *
 * Selection and row-drag features must not inject competing columns.
 * User column objects are never mutated; their reference identity is kept.
 */
export function resolveRowControlColumns(
  columns: ColumnDef[],
  rowSelection: RowSelectionConfig,
  rowDrag: RowDragNormalizedConfig,
): ColumnDef[] {
  const existingInternals: ColumnDef[] = [];
  const users: ColumnDef[] = [];
  for (const col of columns) {
    if (isInjectedRowControlColumn(col)) existingInternals.push(col);
    else users.push(col);
  }

  const reservedUserFields = new Set(users.map((col) => col.field));
  const planned = planRowControlColumns(rowSelection, rowDrag).filter(
    (col) => !reservedUserFields.has(col.field),
  );

  if (
    plannedMatchesExisting(planned, existingInternals) &&
    existingInternals.length + users.length === columns.length
  ) {
    return columns;
  }

  if (planned.length === 0) {
    return users.length === columns.length ? columns : users;
  }

  return [...planned, ...users];
}

export function isSelectionHostColumn(
  col: Pick<ColumnDef, "field" | "internal">,
): boolean {
  return isSelectionColumn(col) || isCombinedRowControlsColumn(col);
}

export function isRowDragHostColumn(
  col: Pick<ColumnDef, "field" | "internal">,
): boolean {
  return isRowDragColumn(col) || isCombinedRowControlsColumn(col);
}
