import type { RowData } from "../types";

/** Narrow row snapshot + identity access for selection helpers (internal only). */
export interface RowAccess {
  getRows(): RowData[];
  resolveRowId(row: RowData, index: number): string;
}
