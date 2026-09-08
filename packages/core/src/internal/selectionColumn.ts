import type { ColumnDef, RowSelectionCheckboxColumnConfig, RowSelectionConfig } from "../types";

export const SELECTION_COLUMN_FIELD = "__lfg_selection__" as const;

export function isSelectionColumn(
  col: Pick<ColumnDef, "field" | "internal">,
): boolean {
  return col.field === SELECTION_COLUMN_FIELD || col.internal === "selection";
}

/**
 * Build the internal selection column ColumnDef.
 *
 * Only `width` and `pinned` come from the user-facing config.
 * Everything else is hardcoded — the checkbox column is a fixed
 * system column, not a normal data column.
 */
export function createSelectionColumnDef(cfg?: RowSelectionCheckboxColumnConfig): ColumnDef {
  const width = cfg?.width ?? 44;
  return {
    field: SELECTION_COLUMN_FIELD,
    headerName: "",
    width,
    minWidth: width,
    maxWidth: width,
    pinned: cfg?.pinned ?? "left",
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
    internal: "selection",
  };
}

/**
 * Prepend the internal selection column without mutating `userColumns`.
 */
export function injectSelectionColumn(
  userColumns: ColumnDef[],
  rowSelection: RowSelectionConfig,
): ColumnDef[] {
  const want = rowSelection.checkboxes && rowSelection.mode !== "none";
  if (!want) return userColumns;

  if (userColumns.some((c) => c.field === SELECTION_COLUMN_FIELD)) {
    return userColumns;
  }

  return [createSelectionColumnDef(rowSelection.checkboxColumn), ...userColumns];
}
