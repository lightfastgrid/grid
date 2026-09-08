import type { ColumnMenuOptions } from "@lightfastgrid/core";

/**
 * Column menu (⋯) + dedicated header filter triggers.
 *
 * Filter UI stays on the dedicated funnel (`placement: "dedicatedMenu"`).
 */
export const gridDemoColumnMenu: ColumnMenuOptions = {
  enabled: true,
  sort: { asc: true, desc: true, clear: true },
  pinning: { pinLeft: true, pinRight: true, unpin: true },
  visibility: { hideColumn: true, hideSelectedColumns: true },
  sizing: {
    autoSizeColumn: true,
    autoSizeSelectedColumns: true,
    sizeColumnsToFit: true,
    sizeSelectedColumnsToFit: true,
    resetColumnWidths: true,
  },
  filter: {
    enabled: true,
    placement: "dedicatedMenu",
    clear: true,
    selectionList: { enabled: true },
  },
};
