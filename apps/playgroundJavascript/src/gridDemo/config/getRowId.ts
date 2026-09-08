import type { RowData } from "@lightfastgrid/core";

/** Prefer a row-only getRowId callback. */
export function gridDemoGetRowId(row: RowData): string {
  const id = row.id;
  return typeof id === "string" ? id : String(id);
}
