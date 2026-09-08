import type { RowData } from "@lightfastgrid/core";

/** Reads the stable id assigned by datasetTransforms.mjs. */
export function gridDemoGetRowId(row: RowData): string {
  const id = row.id;
  return typeof id === "string" ? id : String(id);
}
