import type { ColumnFilterModel } from "@lightfastgrid/core";

import type { DemoGridGetter } from "../../../runtime/types.ts";

import {
  buildDemoFilterRows,
  type DemoFilterableColumn,
  type DemoFilterRow,
  readSelectOptions,
} from "./filterPanelModel.ts";

export function readDemoFilterRows(getGrid: DemoGridGetter): DemoFilterRow[] {
  const grid = getGrid();
  if (!grid) return [];
  return buildDemoFilterRows({
    filterModel: grid.getFilterModel(),
    columns: grid.getColumns(),
  });
}

export function listFilterableColumns(
  getGrid: DemoGridGetter,
): DemoFilterableColumn[] {
  const grid = getGrid();
  if (!grid) return [];
  const columns: DemoFilterableColumn[] = [];
  for (const column of grid.getColumns()) {
    if (column.internal) continue;
    const config = grid.getColumnFilterConfig(column.field);
    if (!config) continue;
    columns.push({
      field: column.field,
      label: column.headerName?.trim() || column.field,
      type: config.type,
      defaultOperator: config.defaultOperator,
      selectOptions: readSelectOptions(column.floatingFilter),
    });
  }
  return columns;
}

export function clearAllDemoFilters(getGrid: DemoGridGetter): void {
  getGrid()?.clearFilters("api");
}

export function clearDemoColumnFilter(
  getGrid: DemoGridGetter,
  field: string,
): void {
  getGrid()?.clearColumnFilter(field, "api");
}

export function writeDemoColumnFilter(
  getGrid: DemoGridGetter,
  field: string,
  model: ColumnFilterModel | null,
): void {
  const grid = getGrid();
  if (!grid) return;
  if (model === null) {
    grid.clearColumnFilter(field, "api");
    return;
  }
  grid.setColumnFilterModel(field, model, "api");
}
