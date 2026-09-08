import type { ColumnDef, QuickFilterOptions } from "../../types";

import { resolveSearchableFields } from "./searchableFieldResolver";

/** Returns searchable columns in original column order. */
export function resolveSearchableColumns(
  columns: readonly ColumnDef[],
  options?: { includeHiddenColumns?: boolean },
): ColumnDef[] {
  const included = new Set(
    resolveSearchableFields(columns, options).descriptors.map((d) => d.field),
  );
  return columns.filter((col) => included.has(col.field));
}

export function resolveSearchableColumnsFromConfig(
  columns: readonly ColumnDef[],
  quickFilter?: boolean | QuickFilterOptions,
): ColumnDef[] {
  const opts = typeof quickFilter === "object" ? quickFilter : undefined;
  return resolveSearchableColumns(columns, {
    includeHiddenColumns: opts?.includeHiddenColumns,
  });
}
