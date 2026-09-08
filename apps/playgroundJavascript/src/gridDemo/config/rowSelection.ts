import type { RowSelectionOptions } from "@lightfastgrid/core";

/** Shared row-selection setup for the demo. */
export const gridDemoRowSelection: RowSelectionOptions = {
  mode: "multiple",
  checkboxes: true,
  headerCheckbox: true,
  selectAllScope: "all",
  enableRowClickSelection: true,
  checkboxColumn: {
    width: 55,
    pinned: "left",
  },
};
