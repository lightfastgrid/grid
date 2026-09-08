import type { SortOrderPairCache } from "../../../row-model/SortOrderCache";
import type { RowValueCache } from "../../../row-model/value-cache";
import type { ColumnDef, RowData, SortModel } from "../../../types";
import type { ApplySortOptions } from "../../../utils/sortModel";
import { applySortModelToRowOrder } from "../../../utils/sortModel";
import type { RowIndexExecutionResult } from "../types";
import { rowOrderToRowIndexExecutionResult } from "../types";

export interface SortExecutionContext {
  valueCache?: RowValueCache;
  rowEpoch?: number;
  sortOrderPairCache?: SortOrderPairCache | null;
  onSortOrderPairCache?: (cache: SortOrderPairCache) => void;
}

/**
 * Sort the given rows according to `sortModel` and return the result as a
 * normalized `RowIndexExecutionResult` (`identity` when no sort is active,
 * `indexes` otherwise). Never materializes a sorted `RowData[]`. The
 * state/grid layer converts the result to a `RowOrder` once on consumption.
 *
 * When a `SortExecutionContext` is provided, delegates value extraction to
 * `RowValueCache` and checks `SortOrderPairCache` for single-column
 * asc↔desc cache hits — avoiding the full sort when the cache is warm.
 */
export function executeSortMainThread(
  rows: RowData[],
  sortModel: SortModel,
  columns: ColumnDef[],
  ctx?: SortExecutionContext,
  sourceIndexes?: Uint32Array,
): RowIndexExecutionResult {
  let sortOptions: ApplySortOptions | undefined;
  if (ctx || sourceIndexes) {
    sortOptions = {
      valueCache: ctx?.valueCache,
      rowEpoch: ctx?.rowEpoch,
      sortOrderPairCache: ctx?.sortOrderPairCache,
      onSortOrderPairCache: ctx?.onSortOrderPairCache,
      sourceIndexes,
    };
  }
  const rowOrder = applySortModelToRowOrder(
    rows,
    sortModel,
    columns,
    ctx?.valueCache,
    ctx?.rowEpoch,
    sortOptions,
  );
  return rowOrderToRowIndexExecutionResult(rowOrder);
}
