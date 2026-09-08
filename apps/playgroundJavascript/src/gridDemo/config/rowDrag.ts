import type { RowDragProp } from "@lightfastgrid/core";

/** Shared row-drag setup for the demo. */
export const gridDemoRowDrag: RowDragProp = {
  enabled: true,
  managed: true,
  maxMultiRowDragCount: 10,
  maxMultiRowDragRatio: 0.5,
};
