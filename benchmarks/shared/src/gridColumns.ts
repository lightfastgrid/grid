import { filterTypeForColumn } from "./columns.ts";
import type { NeutralColumn } from "./benchmarkProtocol.ts";

export function toLightFastGridColumns(columns: readonly NeutralColumn[]) {
  return columns.map((column) => ({
    field: column.field,
    headerName: column.headerName,
    width: column.width,
    sortable: true as const,
    filterable: true as const,
    filter: filterTypeForColumn(column),
    searchable: true as const,
    resizable: false,
    reorderable: false,
    pinnable: false,
  }));
}

export const LIGHTFASTGRID_DEFAULT_COL_DEF = {
  sortable: true,
  filterable: true,
  searchable: true,
  resizable: false,
} as const;

export const LIGHTFASTGRID_THEME = {
  base: "light",
  density: "standard",
} as const;

export function toAgGridColDefs(columns: readonly NeutralColumn[]) {
  return columns.map((column) => {
    const kind = filterTypeForColumn(column);
    return {
      field: column.field,
      headerName: column.headerName,
      width: column.width,
      sortable: true,
      filter:
        kind === "number"
          ? "agNumberColumnFilter"
          : kind === "date"
            ? "agDateColumnFilter"
            : "agTextColumnFilter",
      resizable: false,
      suppressMovable: true,
      floatingFilter: false,
      pinned: null,
    };
  });
}

export function agGridFilterModelFor(
  column: NeutralColumn,
  value: string | number,
) {
  const kind = filterTypeForColumn(column);
  if (kind === "number") {
    return { filterType: "number", type: "equals", filter: Number(value) };
  }
  if (kind === "date") {
    return {
      filterType: "date",
      type: "equals",
      dateFrom: String(value),
    };
  }
  return { filterType: "text", type: "contains", filter: String(value) };
}

export const AG_GRID_DEFAULT_COL_DEF = {
  sortable: true,
  resizable: false,
  suppressHeaderMenuButton: true,
} as const;
