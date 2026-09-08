import type { ColumnDef, ColumnFilterInput } from "../../types";

import { isColumnFilterEligible } from "./filterColumnEligibility";
import { resolveColumnFilterConfig } from "./normalizeColumnFilterConfig";
import type { NormalizedColumnFilterConfig } from "./types";

export interface ResolveColumnFilterConfigsInput {
  columns: readonly (Pick<ColumnDef, "field" | "internal" | "cellKind"> & {
    filterable?: boolean;
    filter?: ColumnFilterInput;
  })[];
  defaultFilterable?: boolean;
  defaultFilter?: ColumnFilterInput;
}

export function resolveColumnFilterConfigs(
  input: ResolveColumnFilterConfigsInput,
): ReadonlyMap<string, NormalizedColumnFilterConfig> {
  const result = new Map<string, NormalizedColumnFilterConfig>();
  for (const col of input.columns) {
    if (!isColumnFilterEligible(col)) continue;
    const config = resolveColumnFilterConfig({
      columnFilterable: col.filterable,
      columnFilter: col.filter,
      defaultFilterable: input.defaultFilterable,
      defaultFilter: input.defaultFilter,
    });
    if (config) {
      result.set(col.field, config);
    }
  }
  return result;
}
