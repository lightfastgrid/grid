export { RAF_GAP_THRESHOLD_MS, LONG_TASK_THRESHOLD_MS } from "./benchmarkProtocol.ts";
export type {
  BenchmarkLane,
  BenchmarkRow,
  ColumnFilterTypingOptions,
  ColumnFilterTypingSessionResult,
  ColumnKind,
  FilterExecutionEvidence,
  FilterProducer,
  GridBenchmarkAcceptedState,
  GridBenchmarkAppId,
  GridBenchmarkMeta,
  GridBenchmarkPrepareResult,
  GridBenchmarkProtocol,
  GridBenchmarkReactProfileSummary,
  GridBenchmarkRuntimeSample,
  GridBenchmarkVisibleState,
  NeutralColumn,
  NeutralFilterCondition,
  NeutralFilterModel,
  OptionalMetric,
  PrepareScenarioOptions,
  QuickSearchExecutionEvidence,
  QuickSearchProducer,
  QuickSearchTypingOptions,
  QuickSearchTypingSessionResult,
  SortDirection,
  SortExecutionEvidence,
} from "./benchmarkProtocol.ts";
export { columnByField, filterTypeForColumn, getRowId } from "./columns.ts";
export { emptyAcceptedState, acceptedStateWithFilter } from "./acceptedState.ts";
export { countDomNodes, readVisibleStateFromDom, scrollElement } from "./domState.ts";
export {
  readLightFastGridDisplayedRowCount,
  readLightFastGridProcessedDisplayedRowCount,
  LIGHTFASTGRID_BENCHMARK_HEADER_ROWS,
} from "./displayedRowCount.ts";
export { createBundleFixture, type BundleFixture } from "./bundleFixture.ts";
export {
  agGridFilterModelFor,
  AG_GRID_DEFAULT_COL_DEF,
  LIGHTFASTGRID_DEFAULT_COL_DEF,
  LIGHTFASTGRID_THEME,
  toAgGridColDefs,
  toLightFastGridColumns,
} from "./gridColumns.ts";
export { PROTOCOL_TIMEOUT_MS, getProtocolTimeoutMs, waitAnimationFrames, waitForAcceptedThenRender, waitForGridEvent, waitForGridEventThenRender, waitForPredicate, waitWithTimeout, whenEvent } from "./completion.ts";
export {
  AG_GRID_BENCHMARK_HOST_SELECTOR,
  agGridMountDomIsReady,
  agGridMountIsReady,
  agGridMountShellIsClear,
  type AgGridMountApi,
  type AgGridMountReadiness,
} from "./agGridMountReadiness.ts";
export {
  LIGHTFASTGRID_SORT_PENDING_SELECTOR,
  waitForLightFastGridSortVisible,
  observeLightFastGridQuickSearchPending,
  waitForLightFastGridQuickSearchSettlement,
} from "./lightfastgridSettlement.ts";
export { generateRows, type GeneratedDataset } from "./generateRows.ts";
export { BenchmarkShell } from "./BenchmarkShell.tsx";
export { GridHost } from "./GridHost.tsx";
export { createRuntimeObservers } from "./instrumentation.ts";
export { useOptionalReactProfiler } from "./reactProfiler.tsx";
export {
  createProtocolRuntime,
  settleWithoutGridEvent,
  type GridBenchmarkDriver,
  type PreparedBenchmarkState,
} from "./protocolRuntime.ts";
export {
  QUICK_SEARCH_FINAL_TEXT,
  QUICK_SEARCH_TYPING_INTERVAL_MS,
  QUICK_SEARCH_TYPING_PREFIXES,
  baselineTypingEvidence,
  createAgGridColumnFilterTypingAdapter,
  createAgGridTypingAdapter,
  createLightFastGridColumnFilterTypingAdapter,
  createLightFastGridTypingAdapter,
  runBaselineTypingSession,
  runQuickSearchTypingSession,
  type QuickSearchTypingAdapter,
} from "./typingSession.ts";
export {
  LFG_QUICK_SEARCH_MODES,
  LFG_QUICK_SEARCH_WORKER_THRESHOLD,
  buildAgGridQuickSearchEvidence,
  buildLfgQuickSearchEvidence,
  interpretProductionQuickSearchProducer,
  isLfgQuickSearchMode,
  lightFastGridQuickSearchMountConfig,
  resolveLfgQuickSearchModeFromSearch,
  type LfgQuickSearchMode,
  type LfgQuickSearchModeOrDefault,
  type LightFastGridQuickSearchMountConfig,
  type ProductionProducerInterpretation,
} from "./lfgQuickSearchMode.ts";
export {
  attachLightFastGridProducerProbe,
  isQuickSearchProducer,
  type FilterCommandEvidenceSnapshot,
  type FilterCommandProducer,
  type LightFastGridProducerProbe,
  type SortCommandEvidenceSnapshot,
} from "./lightfastgridProducer.ts";
export {
  QUICK_SEARCH_PRIMING_TEXT,
  QUICK_SEARCH_SCENARIO_IDS,
  isolatedQuickSearchPlan,
  isQuickSearchScenarioId,
  type IsolatedQuickSearchStep,
  type QuickSearchScenarioId,
} from "./quickSearchScenarios.ts";
export {
  CANONICAL_PUBLIC_COLUMN_COUNT,
  CANONICAL_PUBLIC_ROW_COUNT,
  CANONICAL_PUBLIC_SCENARIO_NAME,
  assertCanonicalPublicScenario,
  isCanonicalPublicScenario,
} from "./canonicalPublicScenario.ts";
export {
  EMPTY_NEUTRAL_FILTER_MODEL,
  andFilter,
  countRowsMatchingNeutralFilter,
  filterFieldsOf,
  fromAgGridFilterModel,
  fromLightFastGridFilterModel,
  isEmptyNeutralFilter,
  neutralFilterEquals,
  numberBetweenFilter,
  rowMatchesNeutralFilter,
  textContainsFilter,
  toAgGridFilterModel,
  toLightFastGridFilterModel,
} from "./neutralFilter.ts";
export {
  applyAgGridNeutralFilter,
  applyLightFastGridNeutralFilter,
  clearAgGridNeutralFilter,
  clearLightFastGridNeutralFilter,
  readAgGridNeutralFilter,
  readLightFastGridNeutralFilter,
} from "./neutralFilterApply.ts";
export {
  FILTER_COMBINED_MODEL,
  FILTER_NUMBER_MODEL,
  FILTER_SCENARIO_IDS,
  FILTER_TEXT_MODEL,
  FILTER_TYPING_FIELD,
  FILTER_TYPING_FINAL_TEXT,
  FILTER_TYPING_INTERVAL_MS,
  FILTER_TYPING_PREFIXES,
  ORDINARY_COMPETITIVE_OPERATIONS,
  QUICK_SEARCH_ONLY_OPERATIONS,
  FILTER_CLEAR_OPERATIONS,
  FILTER_SCHEDULED_OPERATIONS,
  isolatedFilterPlan,
  filterWorkerClaimsApplicable,
  isFilterClearOperation,
  isFilterOperationId,
  isFilterScheduledOperation,
  isFilterScenarioId,
  isOrdinaryCompetitiveOperation,
  isQuickSearchOnlyOperation,
  requiredOperationsForPurpose,
  type FilterOperationId,
  type FilterScenarioId,
  type IsolatedFilterStep,
  type SlotPurpose,
} from "./filterScenarios.ts";
export {
  LFG_FILTER_WORKER_THRESHOLD,
  LFG_SORT_WORKER_THRESHOLD,
  baselineFilterEvidence,
  buildAgGridFilterEvidence,
  buildLfgFilterEvidence,
  workerRouteConfirmedForProducer,
} from "./filterExecution.ts";
export { assertScenarioAllowed, COLUMN_WIDTH_PX, createColumns, DEFAULT_SCENARIO_NAME, getScenario, getValuePools, isExtremeOptInRequested, listDefaultScenarioNames, listScenarioNames, SCENARIO_SEED } from "./scenarios.ts";
export { GRID_HOST_STYLE, HEADER_HEIGHT_PX, OVERSCAN_ROWS_PER_SIDE, ROW_HEIGHT_PX, VIEWPORT_HEIGHT_PX, VIEWPORT_WIDTH_PX, AG_GRID_VIEWPORT_SELECTOR } from "./viewport.ts";
export { mountVanillaBenchmarkChrome, type VanillaBenchmarkChrome } from "./vanillaHost.ts";
