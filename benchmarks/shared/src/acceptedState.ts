import type {
  GridBenchmarkAcceptedState,
  NeutralFilterModel,
  SortDirection,
} from "./benchmarkProtocol.ts";
import { EMPTY_NEUTRAL_FILTER_MODEL, filterFieldsOf } from "./neutralFilter.ts";

export function emptyAcceptedState(): GridBenchmarkAcceptedState {
  return {
    sort: [],
    filterFields: [],
    filterModel: EMPTY_NEUTRAL_FILTER_MODEL,
    quickSearch: "",
  };
}

export function acceptedStateWithFilter(
  model: NeutralFilterModel,
  rest?: Partial<GridBenchmarkAcceptedState>,
): GridBenchmarkAcceptedState {
  return {
    sort: rest?.sort ?? [],
    filterFields: filterFieldsOf(model),
    filterModel: model,
    quickSearch: rest?.quickSearch ?? "",
  };
}

export function acceptedSort(
  field: string,
  direction: SortDirection,
): GridBenchmarkAcceptedState["sort"][number] {
  return { field, direction };
}
