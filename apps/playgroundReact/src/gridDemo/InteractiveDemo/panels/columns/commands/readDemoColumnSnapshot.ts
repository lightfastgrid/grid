import type { DemoGridGetter } from "../../../runtime/types.ts";

import {
  buildDemoColumnList,
  type DemoColumnListSnapshot,
} from "./listDemoColumns.ts";

/**
 * Read live column list + selection for the Columns panel.
 * Uses public handle APIs: `getColumns`, visibility/pin state, selection.
 */
export function readDemoColumnSnapshot(
  getGrid: DemoGridGetter,
): DemoColumnListSnapshot {
  const grid = getGrid();
  if (!grid) {
    return {
      columns: [],
      hiddenCount: 0,
      totalCount: 0,
      selectedColumnIds: [],
    };
  }

  return buildDemoColumnList({
    columns: grid.getColumns(),
    visibilityState: grid.getColumnVisibilityState(),
    pinState: grid.getColumnPinState(),
    selectedColumnIds: grid.getSelectedColumnIds(),
  });
}
