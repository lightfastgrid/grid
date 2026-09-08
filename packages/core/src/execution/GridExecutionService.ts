import type { GetCellValue } from "../features/filters/filterValueAccess";
import type { NormalizedColumnFilterConfig } from "../features/filters/types";
import { defaultNormalizer } from "../features/quick-search/normalizer";
import type { CooperativeHandle } from "../scheduling/CooperativeScheduler";
import type {
  ColumnDef,
  ExecutionOptions,
  FilterModel,
  RowData,
  SortModel,
} from "../types";

import { DEFAULT_CSV_EXPORT_WORKER_CELL_THRESHOLD } from "./operations/csv-export/csvExportOperation";
import type { FilterOperationInput } from "./operations/filter";
import { filterOperation } from "./operations/filter";
import { FILTER_OPERATION_THRESHOLD } from "./operations/filter/filterOperation";
import type { QuickSearchOperationInput } from "./operations/quick-search";
import {
  QUICK_SEARCH_OPERATION_THRESHOLD,
  quickSearchOperation,
} from "./operations/quick-search";
import type { SnapshotSyncConfig } from "./operations/quick-search/QuickSearchSnapshotClient";
import type { QuickSearchWorkerClientAdapter } from "./operations/quick-search/quickSearchWorkerClientAdapter";
import type { SortOperationCache, SortOperationInput } from "./operations/sort";
import { SORT_OPERATION_THRESHOLD, sortOperation } from "./operations/sort";
import type { SortExecutionContext } from "./operations/sort/sortMainThread";
import type { QuickSearchTaskCompletion } from "./GridTaskTypes";
import type { FilterTaskCompletion, SortTaskCompletion } from "./GridTaskTypes";
import { normalizeExecutionThreshold } from "./normalizeExecutionThreshold";
import { OperationExecutionRunner } from "./OperationExecutionRunner";

export const ASYNC_SORT_ROW_THRESHOLD = SORT_OPERATION_THRESHOLD;

/**
 * Grid-facing facade over the generic {@link OperationExecutionRunner}.
 *
 * Schedules sort requests through {@link sortOperation} and adapts the
 * generic runner completion into the `SortTaskCompletion` shape Grid
 * consumes. Threshold/worker/fallback policy lives in the runner.
 */
export class GridExecutionService {
  private readonly runner = new OperationExecutionRunner();
  private sortThreshold = SORT_OPERATION_THRESHOLD;
  private filterThreshold = FILTER_OPERATION_THRESHOLD;
  private quickSearchThreshold = QUICK_SEARCH_OPERATION_THRESHOLD;
  private csvExportThreshold = DEFAULT_CSV_EXPORT_WORKER_CELL_THRESHOLD;
  private quickSearchPrewarmHandle: CooperativeHandle | null = null;
  private quickSearchPrewarmTarget: {
    fieldsSignature: string;
    normalizerSignature: string;
    sourceLayoutRevision: number;
    searchableDataRevision: number;
  } | null = null;

  constructor(execution?: ExecutionOptions) {
    if (execution) this.applyOptions(execution);
  }

  getSortThreshold(): number {
    return this.sortThreshold;
  }

  getFilterThreshold(): number {
    return this.filterThreshold;
  }

  getQuickSearchThreshold(): number {
    return this.quickSearchThreshold;
  }

  getCsvExportThreshold(): number {
    return this.csvExportThreshold;
  }

  getExecutionThreshold(
    name: keyof NonNullable<ExecutionOptions["thresholds"]>,
  ): number {
    switch (name) {
      case "sort":
        return this.sortThreshold;
      case "filter":
        return this.filterThreshold;
      case "quickSearch":
        return this.quickSearchThreshold;
      case "csvExport":
        return this.csvExportThreshold;
    }
  }

  setExecutionOptions(execution?: ExecutionOptions): void {
    this.sortThreshold = SORT_OPERATION_THRESHOLD;
    this.filterThreshold = FILTER_OPERATION_THRESHOLD;
    this.quickSearchThreshold = QUICK_SEARCH_OPERATION_THRESHOLD;
    this.csvExportThreshold = DEFAULT_CSV_EXPORT_WORKER_CELL_THRESHOLD;
    if (execution) this.applyOptions(execution);
  }

  private applyOptions(execution: ExecutionOptions): void {
    this.sortThreshold = normalizeExecutionThreshold(
      execution.thresholds?.sort,
      SORT_OPERATION_THRESHOLD,
    );
    this.filterThreshold = normalizeExecutionThreshold(
      execution.thresholds?.filter,
      FILTER_OPERATION_THRESHOLD,
    );
    this.quickSearchThreshold = normalizeExecutionThreshold(
      execution.thresholds?.quickSearch,
      QUICK_SEARCH_OPERATION_THRESHOLD,
    );
    this.csvExportThreshold = normalizeExecutionThreshold(
      execution.thresholds?.csvExport,
      DEFAULT_CSV_EXPORT_WORKER_CELL_THRESHOLD,
    );
  }

  scheduleSort(
    rows: RowData[],
    sortModel: SortModel,
    columns: ColumnDef[],
    onComplete: (completion: SortTaskCompletion) => void,
    ctx?: SortExecutionContext,
    cache?: SortOperationCache,
    sourceIndexes?: Uint32Array,
  ): number {
    const input: SortOperationInput = { rows, sortModel, columns, sourceIndexes, ctx, cache };

    return this.runner.schedule(sortOperation, input, (completion) => {
      onComplete({
        kind: "sort",
        requestId: completion.requestId,
        result: completion.output,
        producer: completion.producer,
        sortModel,
        sourceRows: rows,
      });
    }, this.sortThreshold);
  }

  cancelSort(): void {
    this.runner.cancel(sortOperation.name);
  }

  isSortLatest(requestId: number): boolean {
    return this.runner.isLatest(sortOperation.name, requestId);
  }

  scheduleFilter(
    rows: RowData[],
    filterModel: FilterModel,
    columnsByField: ReadonlyMap<string, NormalizedColumnFilterConfig>,
    onComplete: (completion: FilterTaskCompletion) => void,
    getCellValue?: GetCellValue,
    sourceIndexes?: readonly number[] | Uint32Array,
  ): number {
    const input: FilterOperationInput = {
      rows,
      filterModel,
      columnsByField,
      getCellValue,
      sourceIndexes,
    };

    return this.runner.schedule(filterOperation, input, (completion) => {
      onComplete({
        kind: "filter",
        requestId: completion.requestId,
        result: completion.output,
        producer: completion.producer,
        filterModel,
        sourceRows: rows,
      });
    }, this.filterThreshold);
  }

  cancelFilter(): void {
    this.runner.cancel(filterOperation.name);
  }

  scheduleQuickSearch(
    input: QuickSearchOperationInput,
    onComplete: (completion: QuickSearchTaskCompletion) => void,
  ): number {
    return this.runner.schedule(quickSearchOperation, input, (completion) => {
      onComplete({
        kind: "quickSearch",
        requestId: completion.requestId,
        result: completion.output,
        producer: completion.producer,
        quickFilterText: input.quickFilterText,
        searchableFieldsSignature: input.searchableFieldsSignature,
        filterModel: input.filterModel,
        filteredOrderVersion: input.filteredOrderVersion,
        sourceLayoutRevision: input.sourceLayoutRevision,
        searchableDataRevision: input.searchableDataRevision,
      });
    }, this.quickSearchThreshold);
  }

  cancelQuickSearch(): void {
    this.runner.cancel(quickSearchOperation.name);
  }

  /**
   * Schedule background worker snapshot sync for stable large datasets.
   * Best-effort only — never blocks callers and does not mark pending.
   */
  prewarmQuickSearchSnapshot(config: SnapshotSyncConfig): void {
    const normalizer = config.normalizer ?? defaultNormalizer;
    const pending = this.quickSearchPrewarmTarget;
    const sameTarget =
      pending !== null &&
      pending.fieldsSignature === config.fieldsSignature &&
      pending.normalizerSignature === normalizer.signature &&
      pending.sourceLayoutRevision === config.sourceLayoutRevision &&
      pending.searchableDataRevision === config.searchableDataRevision;

    if (sameTarget) {
      return;
    }

    this.cancelQuickSearchPrewarm();

    const worker = quickSearchOperation.worker;
    if (!worker) return;

    this.quickSearchPrewarmTarget = {
      fieldsSignature: config.fieldsSignature,
      normalizerSignature: normalizer.signature,
      sourceLayoutRevision: config.sourceLayoutRevision,
      searchableDataRevision: config.searchableDataRevision,
    };

    try {
      const client = this.runner.getOrCreateWorkerClient(
        quickSearchOperation.name,
        () => worker.createClient(),
      ) as QuickSearchWorkerClientAdapter;
      this.quickSearchPrewarmHandle = client.prewarmSnapshot(config);
    } catch {
      this.quickSearchPrewarmTarget = null;
    }
  }

  cancelQuickSearchPrewarm(): void {
    this.quickSearchPrewarmHandle?.cancel();
    this.quickSearchPrewarmHandle = null;
    this.quickSearchPrewarmTarget = null;
  }

  /**
   * Drop the quick-search worker snapshot on explicit feature disable.
   * Edits during the disabled window are intentionally untracked (§9),
   * so a retained snapshot could be served stale on re-enable; clearing
   * forces the next sync to start a fresh generation. Never constructs
   * a worker — a client that was never created has nothing to clear.
   */
  clearQuickSearchWorkerSnapshot(): void {
    const client = this.runner.getWorkerClientIfCreated(
      quickSearchOperation.name,
    ) as QuickSearchWorkerClientAdapter | undefined;
    client?.clearSnapshot();
  }

  isQuickSearchLatest(requestId: number): boolean {
    return this.runner.isLatest(quickSearchOperation.name, requestId);
  }

  isFilterLatest(requestId: number): boolean {
    return this.runner.isLatest(filterOperation.name, requestId);
  }

  destroy(): void {
    this.cancelSort();
    this.cancelFilter();
    this.cancelQuickSearch();
    this.cancelQuickSearchPrewarm();
    this.runner.destroy();
  }
}
