import type { ColumnSelectionOptions } from "@lightfastgrid/core";

/**
 * Column selection stays enabled for runtime APIs / Columns panel / keyboard.
 * Header-click selection is off so header click + Shift+click multi-sort work
 * without conflicting with header selection.
 */
export const gridDemoColumnSelection: ColumnSelectionOptions = {
  mode: "multiple",
  enableHeaderClickSelection: true,
  clearOnOutsideClick: false,
};
