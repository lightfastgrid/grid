import type { ColumnDef, RowDragNormalizedConfig } from "../types";

export const ROW_DRAG_COLUMN_FIELD = "__lfg_row_drag__" as const;

/** Fixed utility-column width. Not a public option — keeps the handle from overlapping adjacent cells. */
export const ROW_DRAG_COLUMN_WIDTH = 36;

export const ROW_DRAG_CELL_CLASS = "lfg-row-drag-cell";
export const ROW_DRAG_HEADER_CLASS = "lfg-row-drag-header";
export const ROW_DRAG_HANDLE_CLASS = "lfg-row-drag-handle";

export function isRowDragColumn(
  col: Pick<ColumnDef, "field" | "internal">,
): boolean {
  return col.field === ROW_DRAG_COLUMN_FIELD || col.internal === "row-drag";
}

/**
 * Build the internal row-drag utility column.
 *
 * Width is a single internal constant applied to width / minWidth / maxWidth.
 * Always left-pinned. Not a user-configurable column.
 */
export function createRowDragColumnDef(): ColumnDef {
  return {
    field: ROW_DRAG_COLUMN_FIELD,
    headerName: "",
    width: ROW_DRAG_COLUMN_WIDTH,
    minWidth: ROW_DRAG_COLUMN_WIDTH,
    maxWidth: ROW_DRAG_COLUMN_WIDTH,
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
    internal: "row-drag",
  };
}

/**
 * Prepend the internal row-drag column without mutating `userColumns`.
 * Injected only while `rowDrag.enabled === true`.
 */
export function injectRowDragColumn(
  userColumns: ColumnDef[],
  rowDrag: RowDragNormalizedConfig,
): ColumnDef[] {
  if (!rowDrag.enabled) return userColumns;

  if (userColumns.some((c) => c.field === ROW_DRAG_COLUMN_FIELD)) {
    return userColumns;
  }

  return [createRowDragColumnDef(), ...userColumns];
}
