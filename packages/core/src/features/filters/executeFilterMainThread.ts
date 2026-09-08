import type { FilterModel, RowData } from "../../types";

import { compileFilterModelCached } from "./compileFilterPredicate";
import { buildFilterTypedValueCache } from "./filterTypedValueCache";
import type { GetCellValue } from "./filterValueAccess";
import { defaultGetCellValue } from "./filterValueAccess";
import type { NormalizedColumnFilterConfig } from "./types";

export interface ExecuteFilterMainThreadInput {
  rows: readonly RowData[];
  filterModel: FilterModel;
  columnsByField: ReadonlyMap<string, NormalizedColumnFilterConfig>;
  getCellValue?: GetCellValue;
  sourceIndexes?: readonly number[] | Uint32Array;
}

export interface FilterExecutionResult {
  indexes: Uint32Array;
}

export function executeFilterMainThread(
  input: ExecuteFilterMainThreadInput,
): FilterExecutionResult {
  const { rows, filterModel, columnsByField } = input;
  const getCellValue = input.getCellValue ?? defaultGetCellValue;

  if (Object.keys(filterModel).length === 0) {
    return buildIdentityResult(rows.length, input.sourceIndexes);
  }

  const cache = buildFilterTypedValueCache({
    rows,
    filterModel,
    columnsByField,
    getCellValue,
    sourceIndexes: input.sourceIndexes,
  });

  const predicate = compileFilterModelCached({
    filterModel,
    columnsByField,
    cache,
  });

  if (predicate === null) {
    return buildIdentityResult(rows.length, input.sourceIndexes);
  }

  const source = input.sourceIndexes;
  const scanLength = source ? source.length : rows.length;

  const buf = new Uint32Array(scanLength);
  let count = 0;

  for (let i = 0; i < scanLength; i++) {
    const idx = source ? source[i]! : i;
    if (predicate(idx)) {
      buf[count++] = idx;
    }
  }

  return { indexes: count === scanLength ? buf : buf.slice(0, count) };
}

function buildIdentityResult(
  rowCount: number,
  sourceIndexes?: readonly number[] | Uint32Array,
): FilterExecutionResult {
  if (sourceIndexes) {
    return { indexes: new Uint32Array(sourceIndexes) };
  }
  const all = new Uint32Array(rowCount);
  for (let i = 0; i < rowCount; i++) all[i] = i;
  return { indexes: all };
}
