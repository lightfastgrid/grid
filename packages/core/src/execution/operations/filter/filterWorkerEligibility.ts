import type { GetCellValue } from "../../../features/filters/filterValueAccess";
import type { NormalizedColumnFilterConfig } from "../../../features/filters/types";
import type { FilterModel } from "../../../types";

export interface WorkerFilterFieldEntry {
  field: string;
  config: NormalizedColumnFilterConfig;
}

export interface WorkerFilterEligibility {
  eligible: boolean;
  fields: WorkerFilterFieldEntry[];
  reason?: string;
}

export function resolveWorkerFilterEligibility(
  filterModel: FilterModel,
  columnsByField: ReadonlyMap<string, NormalizedColumnFilterConfig>,
  getCellValue?: GetCellValue,
): WorkerFilterEligibility {
  const activeFields = Object.keys(filterModel);

  if (activeFields.length === 0) {
    return { eligible: false, fields: [], reason: "empty-filter" };
  }

  if (getCellValue !== undefined) {
    return { eligible: false, fields: [], reason: "custom-getCellValue" };
  }

  const fields: WorkerFilterFieldEntry[] = [];

  for (const field of activeFields) {
    const config = columnsByField.get(field);
    if (!config) continue;
    fields.push({ field, config });
  }

  if (fields.length === 0) {
    return { eligible: false, fields: [], reason: "no-resolvable-fields" };
  }

  return { eligible: true, fields };
}
