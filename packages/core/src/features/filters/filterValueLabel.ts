import type { ColumnDef } from "../../types";

import type { NormalizedColumnFilterConfig } from "./types";

// Filter selection lists format standalone values without a row context.
// The empty row is safe because filter formatters should only use `value`.
const EMPTY_ROW = {};

export function buildFilterValueLabel(
  col: ColumnDef,
  config: NormalizedColumnFilterConfig,
): ((value: boolean) => string) | undefined {
  if (config.type !== "boolean") return undefined;
  const fmt = col.valueFormatter;
  if (!fmt) return undefined;
  return (v: boolean) =>
    fmt({ value: v, row: EMPTY_ROW, rowIndex: -1, field: col.field, column: col });
}
