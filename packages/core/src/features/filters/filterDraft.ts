import type { ColumnFilterCondition, ColumnFilterModel } from "../../types";

import { cloneColumnFilterModel } from "./filterModelEquality";
import type { RawColumnFilterModel } from "./normalizeFilterModel";
import { normalizeColumnFilterModel } from "./normalizeFilterModel";
import type { NormalizedColumnFilterConfig } from "./types";

export interface FilterDraft {
  conditions: ColumnFilterCondition[];
  operator: "and" | "or";
}

export function createFilterDraft(
  applied: ColumnFilterModel | null,
): FilterDraft {
  if (!applied) {
    return { conditions: [], operator: "and" };
  }
  const cloned = cloneColumnFilterModel(applied);
  return {
    conditions: cloned.conditions,
    operator: cloned.operator ?? "and",
  };
}

export function clearFilterDraft(): FilterDraft {
  return { conditions: [], operator: "and" };
}

export function applyFilterDraft(
  draft: FilterDraft,
  config: NormalizedColumnFilterConfig,
): ColumnFilterModel | null {
  const raw: RawColumnFilterModel = {
    operator: draft.operator,
    conditions: draft.conditions,
  };
  return normalizeColumnFilterModel(raw, config);
}

export function resetFilterDraft(): null {
  return null;
}
