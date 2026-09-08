import type { QuickSearchDependencyPlan } from "../../../features/quick-search/quickSearchDependencyPlan";
import type {
  ColumnDef,
  FilterModel,
  QuickFilterCacheMode,
  QuickFilterOptions,
  RowData,
} from "../../../types";

import type { SnapshotTransferInput } from "./QuickSearchSnapshotClient";

export interface QuickSearchOperationInput {
  rows: RowData[];
  quickFilterText: string;
  quickFilter?: boolean | QuickFilterOptions;
  quickFilterCacheMode?: QuickFilterCacheMode;
  columns: ColumnDef[];
  /**
   * Cached dependency plan from GridState. Worker eligibility and payload
   * construction must consume this reference — never rebuild descriptors
   * during query scheduling.
   */
  dependencyPlan: QuickSearchDependencyPlan;
  /** Upstream filtered order; omitted = full dataset in identity order. */
  sourceIndexes?: Uint32Array;
  /** Searchable-field resolution signature for staleness guards. */
  searchableFieldsSignature: string;
  /** Filter model snapshot at schedule time. */
  filterModel: FilterModel;
  /** Monotonic version of the upstream filtered order at schedule time. */
  filteredOrderVersion: number;
  /** RowStore source-layout revision at schedule time. */
  sourceLayoutRevision: number;
  /** GridState searchable-data revision at schedule time. */
  searchableDataRevision: number;
  /**
   * Deferred dirty-index transfer provider for the large worker-eligible
   * path. Invoked at most once from `worker.buildPayload()` — after
   * OperationExecutionRunner has cancelled prior worker work — never
   * during main-thread execution, ineligibility fallback, or prewarm.
   */
  prepareWorkerTransfer?: () => SnapshotTransferInput | undefined;
}
