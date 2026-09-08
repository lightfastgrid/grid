import type { DemoGridGetter } from "../../../runtime/types.ts";

import { readDemoColumnSnapshot } from "./readDemoColumnSnapshot.ts";

/** Show every user column. */
export function showAllDemoColumns(getGrid: DemoGridGetter): void {
  getGrid()?.showAllColumns("api");
}

/** Hide currently selected columns (column selection, not checkboxes). */
export function hideSelectedDemoColumns(getGrid: DemoGridGetter): void {
  const grid = getGrid();
  if (!grid) return;
  const selected = grid.getSelectedColumnIds();
  if (selected.length === 0) return;
  grid.hideColumns(selected, "api");
}

/** Auto-size currently visible columns. */
export function autoSizeVisibleDemoColumns(getGrid: DemoGridGetter): void {
  const grid = getGrid();
  if (!grid) return;
  const visibleFields = readDemoColumnSnapshot(getGrid)
    .columns.filter((column) => column.visible)
    .map((column) => column.field);
  if (visibleFields.length === 0) return;
  grid.autoSizeColumns(visibleFields, "api");
}

export function fitDemoColumnsToGrid(getGrid: DemoGridGetter): void {
  getGrid()?.sizeColumnsToFit("api");
}

export function resetDemoColumnWidths(getGrid: DemoGridGetter): void {
  getGrid()?.resetColumnWidths("api");
}

/** Unpin every user column. */
export function clearAllDemoColumnPinning(getGrid: DemoGridGetter): void {
  getGrid()?.clearColumnPinning("api");
}
