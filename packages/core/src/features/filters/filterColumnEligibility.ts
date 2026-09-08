import { isInternalColumn } from "../../internal/internalColumns";
import type { ColumnDef, ColumnFilterInput } from "../../types";

export type FilterColumnIdentity = Pick<
  ColumnDef,
  "field" | "internal" | "cellKind"
>;

/** System and action columns are UI chrome, not filterable data columns. */
export function isColumnFilterEligible(column: FilterColumnIdentity): boolean {
  return !isInternalColumn(column) && column.cellKind !== "actions";
}

export interface ResolveColumnFilterableInput {
  column: FilterColumnIdentity;
  columnFilterable?: boolean;
  columnFilter?: ColumnFilterInput;
  defaultFilterable?: boolean;
  defaultFilter?: ColumnFilterInput;
}

/** Resolve effective filterability after applying column eligibility. */
export function resolveColumnFilterable(
  input: ResolveColumnFilterableInput,
): boolean {
  if (!isColumnFilterEligible(input.column)) return false;
  if (input.columnFilterable !== undefined) return input.columnFilterable;
  if (input.columnFilter !== undefined) return input.columnFilter !== false;
  if (input.defaultFilterable !== undefined) return input.defaultFilterable;
  if (input.defaultFilter !== undefined) return input.defaultFilter !== false;
  return false;
}
