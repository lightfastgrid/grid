import { executeFilterMainThread } from "../../../features/filters/executeFilterMainThread";
import type { RowIndexExecutionResult } from "../types";

import type { FilterOperationInput } from "./types";

export function executeFilterOperation(
  input: FilterOperationInput,
): RowIndexExecutionResult {
  const { rows, filterModel, columnsByField, getCellValue, sourceIndexes } =
    input;

  const activeFields = Object.keys(filterModel);
  if (activeFields.length === 0) {
    if (sourceIndexes) {
      return { kind: "indexes", indexes: new Uint32Array(sourceIndexes) };
    }
    return { kind: "identity", rowCount: rows.length };
  }

  const result = executeFilterMainThread({
    rows,
    filterModel,
    columnsByField,
    getCellValue,
    sourceIndexes,
  });

  return { kind: "indexes", indexes: result.indexes };
}
