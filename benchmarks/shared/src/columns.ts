import type { NeutralColumn } from "./benchmarkProtocol.ts";

export function filterTypeForColumn(
  column: NeutralColumn,
): "text" | "number" | "date" {
  if (column.kind === "number") return "number";
  if (column.kind === "date") return "date";
  return "text";
}

export function columnByField(
  columns: readonly NeutralColumn[],
  field: string,
): NeutralColumn {
  const column = columns.find((entry) => entry.field === field);
  if (!column) {
    throw new Error(`Unknown column field "${field}"`);
  }
  return column;
}

export function getRowId(row: { readonly id?: unknown }): string {
  return String(row.id);
}
