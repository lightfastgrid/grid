import type {
  BenchmarkRow,
  ColumnFilterTypingOptions,
  ColumnFilterTypingSessionResult,
  FilterExecutionEvidence,
  GridBenchmarkAcceptedState,
  GridBenchmarkPrepareResult,
  GridBenchmarkProtocol,
  GridBenchmarkReactProfileSummary,
  GridBenchmarkRuntimeSample,
  GridBenchmarkVisibleState,
  NeutralColumn,
  NeutralFilterModel,
  PrepareScenarioOptions,
  QuickSearchExecutionEvidence,
  QuickSearchTypingOptions,
  QuickSearchTypingSessionResult,
  SortDirection,
  SortExecutionEvidence,
} from "./benchmarkProtocol.ts";
import { waitAnimationFrames } from "./completion.ts";
import { generateRows } from "./generateRows.ts";
import { createRuntimeObservers } from "./instrumentation.ts";
import { textContainsFilter } from "./neutralFilter.ts";
import {
  assertScenarioAllowed,
  createColumns,
  isExtremeOptInRequested,
} from "./scenarios.ts";

export type PreparedBenchmarkState = {
  readonly scenario: string;
  rows: BenchmarkRow[];
  readonly columns: NeutralColumn[];
  readonly generationMs: number;
};

export type GridBenchmarkDriver = {
  mount(state: PreparedBenchmarkState): Promise<void>;
  waitUntilReady(): Promise<void>;
  sort(field: string, direction: SortDirection): Promise<void>;
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
  getReactProfileSummary(): GridBenchmarkReactProfileSummary | null;
};

export function createProtocolRuntime(
  getMeta: GridBenchmarkProtocol["getMeta"],
  createDriver: () => GridBenchmarkDriver,
): GridBenchmarkProtocol {
  let prepared: PreparedBenchmarkState | null = null;
  let driver: GridBenchmarkDriver | null = null;
  let chain: Promise<void> = Promise.resolve();
  const observers = createRuntimeObservers();

  const run = async <T>(work: () => Promise<T> | T): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const requirePrepared = (): PreparedBenchmarkState => {
    if (!prepared) {
      throw new Error("prepareScenario() must complete before this operation");
    }
    return prepared;
  };

  const requireDriver = (): GridBenchmarkDriver => {
    if (!driver) {
      throw new Error("mount() must complete before this operation");
    }
    return driver;
  };

  const releasePreparedDataset = (): void => {
    if (!prepared) return;
    prepared.rows.length = 0;
    prepared = null;
  };

  const protocol: GridBenchmarkProtocol = {
    async prepareScenario(name, options?: PrepareScenarioOptions) {
      return run(async (): Promise<GridBenchmarkPrepareResult> => {
        if (driver) {
          await driver.destroy();
          driver = null;
        }
        releasePreparedDataset();
        const allowExtreme =
          options?.allowExtreme === true || isExtremeOptInRequested();
        const scenario = assertScenarioAllowed(name, allowExtreme);
        const columns = createColumns(scenario.columnCount);
        const dataset = generateRows(name, columns, scenario.rowCount);
        prepared = {
          scenario: name,
          rows: dataset.rows,
          columns,
          generationMs: dataset.generationMs,
        };
        return {
          scenario: name,
          rowCount: dataset.rows.length,
          columnCount: columns.length,
          generationMs: dataset.generationMs,
        };
      });
    },

    async mount() {
      return run(async () => {
        const state = requirePrepared();
        if (driver) {
          await driver.destroy();
        }
        driver = createDriver();
        await driver.mount(state);
        await driver.waitUntilReady();
      });
    },

    async waitUntilReady() {
      return run(async () => {
        await requireDriver().waitUntilReady();
      });
    },

    async sort(field, direction) {
      return run(async () => {
        await requireDriver().sort(field, direction);
      });
    },

    async filter(field, value) {
      return run(async () => {
        await requireDriver().applyFilterModel(textContainsFilter(field, String(value)));
      });
    },

    async applyFilterModel(model) {
      return run(async () => {
        await requireDriver().applyFilterModel(model);
      });
    },

    async clearFilterModel() {
      return run(async () => {
        await requireDriver().clearFilterModel();
      });
    },

    async typeColumnFilter(options) {
      return run(async () => requireDriver().typeColumnFilter(options));
    },

    getAcceptedFilterModel() {
      return requireDriver().getAcceptedFilterModel();
    },

    getFilterExecutionEvidence() {
      return requireDriver().getFilterExecutionEvidence();
    },

    getSortExecutionEvidence() {
      return requireDriver().getSortExecutionEvidence();
    },

    async quickSearch(text) {
      return run(async () => {
        await requireDriver().quickSearch(text);
      });
    },

    async typeQuickSearch(options) {
      return run(async () => requireDriver().typeQuickSearch(options));
    },

    getQuickSearchExecutionEvidence() {
      return requireDriver().getQuickSearchExecutionEvidence();
    },

    async clearOperations() {
      return run(async () => {
        await requireDriver().clearOperations();
      });
    },

    async scrollTo(top, left) {
      return run(async () => {
        await requireDriver().scrollTo(top, left);
      });
    },

    getVisibleState() {
      return requireDriver().getVisibleState();
    },

    getAcceptedState() {
      return requireDriver().getAcceptedState();
    },

    getDomNodeCount() {
      return requireDriver().getDomNodeCount();
    },

    async destroy() {
      return run(async () => {
        if (driver) {
          await driver.destroy();
          driver = null;
        }
      });
    },

    getMeta,

    getReactProfileSummary() {
      return driver?.getReactProfileSummary() ?? null;
    },

    startRuntimeObservers() {
      observers.start();
    },

    stopRuntimeObservers(): GridBenchmarkRuntimeSample | null {
      return observers.stop();
    },
  };

  return protocol;
}

export async function settleWithoutGridEvent(): Promise<void> {
  await waitAnimationFrames(2);
}
