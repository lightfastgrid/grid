/**
 * Sort operation input types.
 *
 * Input shape for the sort {@link ExecutionOperation} wrapper. Bundles
 * the arguments currently passed individually to
 * `executeSortMainThread` so the generic pipeline can hand sort a
 * single `Input` value.
 */

import type { ColumnDef, RowData, SortModel } from "../../../types";
import type {
  ExecutionResultProducer,
  RowIndexExecutionResult,
} from "../types";

import type { SortExecutionContext } from "./sortMainThread";

/**
 * Sort-specific cache boundary.
 *
 * Specialization of `ExecutionOperationCache` for sort inputs and
 * row-index results. `GridState.getSortOperationCache()` provides the
 * adapter, backed by the pair cache in RowModelRuntime.
 */
export interface SortOperationCache {
  /** Return a cached row-index result for `input`, or `null` on miss. */
  tryResolve(input: SortOperationInput): RowIndexExecutionResult | null;

  /** Record a freshly produced sort result for future lookups. */
  record?(
    input: SortOperationInput,
    output: RowIndexExecutionResult,
    producer: ExecutionResultProducer,
  ): void;
}

/** Complete input for a sort operation request. */
export interface SortOperationInput {
  /** Source rows in original order. Never mutated. */
  rows: RowData[];
  /** Active sort model (column + direction entries). */
  sortModel: SortModel;
  /** Column definitions used to resolve comparators and value getters. */
  columns: ColumnDef[];
  /**
   * Optional upstream source indexes to sort (e.g. from filtering).
   * When provided, only these source indexes are sorted — the result
   * contains exactly these indexes in sorted display order.
   * When absent, sorts all rows (0..N-1).
   */
  sourceIndexes?: Uint32Array;
  /** Optional caches (value cache, sort-order pair cache). */
  ctx?: SortExecutionContext;
  /** Optional sort cache boundary (see `GridState.getSortOperationCache`). */
  cache?: SortOperationCache;
}
