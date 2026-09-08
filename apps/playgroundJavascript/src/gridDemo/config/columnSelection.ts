import type { ColumnSelectionOptions } from "@lightfastgrid/core";

/**
 * Column selection stays enabled for runtime APIs / Columns panel / keyboard.
 */
export const gridDemoColumnSelection: ColumnSelectionOptions = {
  mode: "multiple",
  enableHeaderClickSelection: true,
  clearOnOutsideClick: false,
};
