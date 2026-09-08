import type { ColumnDef, FilterModel, RowData, SortModel } from "../types";

import type { RowIndexExecutionResult } from "./operations/types";

export type GridTaskKind = "sort" | "filter" | "quickSearch" | "export";

export interface SortTaskRequest {
  kind: "sort";
  rows: RowData[];
  sortModel: SortModel;
  columns: ColumnDef[];
  requestId: number;
}

export type GridTaskRequest = SortTaskRequest;

/**
 * Index-based sort completion result. The execution layer produces a
 * normalized `RowIndexExecutionResult` (`identity` when no sort is active,
 * `indexes` otherwise) from both the main-thread and worker paths; the
 * state/grid layer converts it to a `RowOrder` once on consumption via
 * `rowIndexExecutionResultToRowOrder`.
 *
 * The legacy `{ kind: "rows", rows }` result has been removed: sort execution
 * never materializes a sorted `RowData[]` anymore.
 */
export type SortTaskResult = RowIndexExecutionResult;

/**
 * Completion of a scheduled sort. `result` is the normalized
 * `RowIndexExecutionResult` regardless of which path produced it;
 * `producer` identifies that path (cache / mainThread / worker). Pair
 * cache recording is handled by the operation cache boundary
 * (`SortOperationCache.record`), not by completion metadata.
 */
export interface SortTaskCompletion {
  kind: "sort";
  requestId: number;
  result: SortTaskResult;
  /** Which generic execution path produced the normalized result. */
  producer: "cache" | "mainThread" | "worker";
  sortModel: SortModel;
  sourceRows: RowData[];
}

export type FilterTaskResult = RowIndexExecutionResult;

export interface FilterTaskCompletion {
  kind: "filter";
  requestId: number;
  result: FilterTaskResult;
  producer: "cache" | "mainThread" | "worker";
  filterModel: FilterModel;
  sourceRows: RowData[];
}

export type GridTaskCompletion =
  | SortTaskCompletion
  | FilterTaskCompletion
  | QuickSearchTaskCompletion;

export type QuickSearchTaskResult = RowIndexExecutionResult;

export interface QuickSearchTaskCompletion {
  kind: "quickSearch";
  requestId: number;
  result: QuickSearchTaskResult;
  producer: "cache" | "mainThread" | "worker";
  quickFilterText: string;
  searchableFieldsSignature: string;
  filterModel: FilterModel;
  filteredOrderVersion: number;
  sourceLayoutRevision: number;
  searchableDataRevision: number;
}
