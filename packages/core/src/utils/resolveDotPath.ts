import type { RowData } from "../types";

export function resolveDotPath(row: RowData, parts: string[]): unknown {
  let current: unknown = row;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function resolveFieldValue(row: RowData, field: string): unknown {
  if (field.includes(".")) {
    return resolveDotPath(row, field.split("."));
  }
  return row[field];
}
