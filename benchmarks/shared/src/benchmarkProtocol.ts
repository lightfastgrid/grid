export type SortDirection = "asc" | "desc";

export type ColumnKind = "id" | "text" | "number" | "date" | "status";

export type NeutralTextFilterCondition = {
  readonly field: string;
  readonly kind: "text";
  readonly operator: "contains";
  readonly value: string;
};

export type NeutralNumberFilterCondition = {
  readonly field: string;
  readonly kind: "number";
  readonly operator: "between";
  readonly minimum: number;
  readonly maximum: number;
  readonly inclusive: true;
};

export type NeutralFilterCondition = NeutralTextFilterCondition | NeutralNumberFilterCondition;

export type NeutralFilterModel = {
  readonly logic: "and";
  readonly conditions: readonly NeutralFilterCondition[];
};

export type NeutralColumn = {
  readonly field: string;
  readonly headerName: string;
  readonly kind: ColumnKind;
  readonly width: number;
  readonly sortable: true;
  readonly filterable: true;
  readonly searchable: true;
  readonly pool?: string;
  readonly min?: number;
  readonly max?: number;
};

export type BenchmarkRow = {
  readonly id: string;
  readonly [field: string]: string | number;
};

export type GridBenchmarkPrepareResult = {
  readonly scenario: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly generationMs: number;
};

export type GridBenchmarkVisibleState = {
  readonly displayedRowCount: number;
  readonly renderedRowCount: number;
  readonly firstRenderedRowId: string | null;
  readonly lastRenderedRowId: string | null;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly columnCount: number;
};

export type GridBenchmarkAcceptedState = {
  readonly sort: ReadonlyArray<{
    readonly field: string;
    readonly direction: SortDirection;
  }>;
  readonly filterFields: readonly string[];
  readonly filterModel: NeutralFilterModel;
  readonly quickSearch: string;
};

export type OptionalMetric<T> =
  | ({ readonly supported: true } & T)
  | { readonly supported: false; readonly reason: string };

export const RAF_GAP_THRESHOLD_MS = 20;
export const LONG_TASK_THRESHOLD_MS = 50;

export type BenchmarkLane = "react" | "vanilla";

export type GridBenchmarkAppId =
  | "lightfastgrid"
  | "ag-grid"
  | "react-baseline"
  | "lightfastgrid-vanilla"
  | "ag-grid-vanilla"
  | "vanilla-baseline";

export type GridBenchmarkMeta = {
  readonly appId: GridBenchmarkAppId;
  readonly lane: BenchmarkLane;
  readonly appLabel: string;
  readonly reactVersion: string;
  readonly reactDomVersion: string;
  readonly gridPackage: string;
  readonly gridVersion: string;
  readonly agGridModules: string | null;
  readonly agGridTheme: string | null;
  readonly lightfastgridPackages: {
    readonly core: string;
    readonly react: string | null;
  } | null;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly rowHeight: number;
  readonly headerHeight: number;
  readonly columnWidth: number;
  readonly overscanRowsPerSide: number;
  readonly pagination: false;
  readonly pinnedColumns: false;
  readonly customCellRenderers: false;
  readonly animations: false;
  readonly seed: number;
  readonly notes: readonly string[];
};

export type GridBenchmarkReactProfileSummary = {
  readonly commitCount: number;
  readonly totalActualDurationMs: number;
  readonly maxActualDurationMs: number;
};

export type GridBenchmarkRuntimeSample = {
  readonly longTask: OptionalMetric<{
    readonly count: number;
    readonly totalMs: number;
    readonly maxMs: number;
    readonly over50msCount: number;
  }>;
  readonly rafGaps: OptionalMetric<{
    readonly count: number;
    readonly maxMs: number;
    readonly thresholdMs: number;
  }>;
  readonly heap: OptionalMetric<{
    readonly usedBytes: number;
  }>;
};

export type QuickSearchTypingVariant = "burst" | "settledIncremental";

export type QuickSearchTypingOptions = {
  readonly variant: QuickSearchTypingVariant;
  readonly prefixes?: readonly string[];
  readonly intervalMs?: number;
};

export type QuickSearchAcceptedQueryEvent = {
  readonly text: string;
  readonly atMs: number;
};

export type QuickSearchPrefixSettlement = {
  readonly prefix: string;
  readonly durationMs: number;
  readonly displayedRowCount: number;
  readonly acceptedText: string;
};

export type QuickSearchPrefixDispatch = {
  readonly prefix: string;
  readonly scheduledAtMs: number;
  readonly dispatchAtMs: number;
  readonly dispatchDelayMs: number;
};

export type QuickSearchPendingTransition = {
  readonly pending: boolean;
  readonly atMs: number;
};

export type QuickSearchTypingSessionResult = {
  readonly variant: QuickSearchTypingVariant;
  readonly prefixes: readonly string[];
  readonly intervalMs: number;
  readonly inputTimestampsMs: readonly number[];
  readonly scheduledTimestampsMs: readonly number[];
  readonly dispatchTimestampsMs: readonly number[];
  readonly dispatchDelaysMs: readonly number[];
  readonly prefixDispatches: readonly QuickSearchPrefixDispatch[];
  readonly acceptedQueryEvents: readonly QuickSearchAcceptedQueryEvent[];
  readonly pendingTransitions: readonly QuickSearchPendingTransition[];
  readonly firstKeystrokeToFinalPaintMs: number;
  readonly finalKeystrokeToFinalPaintMs: number;
  readonly cadenceWaitMs: number;
  readonly pendingObserved: boolean;
  readonly supersededAcceptedCount: number;
  readonly finalText: string;
  readonly finalDisplayedRowCount: number;
  readonly prefixSettlements: readonly QuickSearchPrefixSettlement[];
};

export type QuickSearchExecutionMode =
  | "workerIsolated"
  | "mainThreadIsolated"
  | "workerProductionOptimized"
  | "agGridBaseline"
  | "productDefault"
  | "notApplicable";

export type QuickSearchProducer = "worker" | "mainThread" | "cache" | "unknown";

export type FilterProducer = QuickSearchProducer | "none";

export type QuickSearchExecutionEvidence = {
  readonly product: "lightfastgrid" | "ag-grid" | "baseline";
  readonly mode: QuickSearchExecutionMode;
  readonly rowCount: number;
  readonly quickSearchThreshold: number | null;
  readonly cache: boolean | "auto" | null;
  readonly prewarm: boolean | "auto" | null;
  readonly pendingObserved: boolean;
  readonly workerEligibleByCount: boolean | null;
  readonly producer: QuickSearchProducer;
  readonly workerRouteConfirmed: boolean | null;
  readonly forcedMainThread: boolean;
  readonly cacheQuickFilter: boolean | null;
  readonly notes: readonly string[];
};

export type ColumnFilterTypingOptions = {
  readonly field: string;
  readonly variant: QuickSearchTypingVariant;
  readonly prefixes?: readonly string[];
  readonly intervalMs?: number;
};

export type ColumnFilterTypingSessionResult = QuickSearchTypingSessionResult;

export type FilterExecutionEvidence = {
  readonly product: "lightfastgrid" | "ag-grid" | "baseline";
  readonly operation: "filter" | "sort";
  readonly producer: FilterProducer;
  readonly scheduled: boolean;
  readonly rowCount: number;
  readonly workerThreshold: number | null;
  readonly workerRouteConfirmed: boolean | null;
  readonly notes: readonly string[];
};

export type SortExecutionEvidence = FilterExecutionEvidence;

export type PrepareScenarioOptions = {
  readonly allowExtreme?: boolean;
};

export interface GridBenchmarkProtocol {
  prepareScenario(
    name: string,
    options?: PrepareScenarioOptions,
  ): Promise<GridBenchmarkPrepareResult>;
  mount(): Promise<void>;
  waitUntilReady(): Promise<void>;
  sort(field: string, direction: SortDirection): Promise<void>;
  filter(field: string, value: string | number): Promise<void>;
  applyFilterModel(model: NeutralFilterModel): Promise<void>;
  clearFilterModel(): Promise<void>;
  typeColumnFilter(options: ColumnFilterTypingOptions): Promise<ColumnFilterTypingSessionResult>;
  getAcceptedFilterModel(): NeutralFilterModel;
  getFilterExecutionEvidence(): FilterExecutionEvidence;
  getSortExecutionEvidence(): SortExecutionEvidence;
  quickSearch(text: string): Promise<void>;
  typeQuickSearch(options: QuickSearchTypingOptions): Promise<QuickSearchTypingSessionResult>;
  getQuickSearchExecutionEvidence(): QuickSearchExecutionEvidence;
  clearOperations(): Promise<void>;
  scrollTo(top: number, left: number): Promise<void>;
  getVisibleState(): GridBenchmarkVisibleState;
  getAcceptedState(): GridBenchmarkAcceptedState;
  getDomNodeCount(): number;
  destroy(): Promise<void>;
  getMeta(): GridBenchmarkMeta;
  getReactProfileSummary(): GridBenchmarkReactProfileSummary | null;
  startRuntimeObservers(): void;
  stopRuntimeObservers(): GridBenchmarkRuntimeSample | null;
}

declare global {
  interface Window {
    __GRID_BENCHMARK__?: GridBenchmarkProtocol;
  }
}

export {};
