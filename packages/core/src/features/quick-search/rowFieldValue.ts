import type { RowData } from "../../types";

/**
 * Read a row value by flat or dot-path field name.
 *
 * Checks the exact key first so literal flat keys like `"game.bought"`
 * resolve before falling through to nested dot-path traversal.
 */
export function readRowFieldValue(row: RowData, field: string): unknown {
  if (field.indexOf(".") === -1) return row[field];
  if (field in row) return row[field];
  const parts = field.split(".");
  let current: unknown = row;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
