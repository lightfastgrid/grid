import { Grid } from "@lightfastgrid/core";
import {
  applyLightFastGridNeutralFilter,
  attachLightFastGridProducerProbe,
  buildLfgFilterEvidence,
  buildLfgQuickSearchEvidence,
  clearLightFastGridNeutralFilter,
  countDomNodes,
  createLightFastGridColumnFilterTypingAdapter,
  createLightFastGridTypingAdapter,
  createProtocolRuntime,
  emptyAcceptedState,
  filterFieldsOf,
  getProtocolTimeoutMs,
  getRowId,
  HEADER_HEIGHT_PX,
  LIGHTFASTGRID_DEFAULT_COL_DEF,
  LIGHTFASTGRID_THEME,
  mountVanillaBenchmarkChrome,
  OVERSCAN_ROWS_PER_SIDE,
  readLightFastGridNeutralFilter,
  readLightFastGridProcessedDisplayedRowCount,
  ROW_HEIGHT_PX,
  scrollElement,
  toLightFastGridColumns,
  type GridBenchmarkDriver,
  type GridBenchmarkMeta,
  type LightFastGridProducerProbe,
  type NeutralFilterModel,
  type QuickSearchExecutionEvidence,
  type VanillaBenchmarkChrome,
  VIEWPORT_HEIGHT_PX,
  VIEWPORT_WIDTH_PX,
  waitAnimationFrames,
  waitForGridEvent,
  waitForLightFastGridQuickSearchSettlement,
  waitForLightFastGridSortVisible,
  waitForPredicate,
  waitWithTimeout,
  readVisibleStateFromDom,
  lightFastGridQuickSearchMountConfig,
  resolveLfgQuickSearchModeFromSearch,
  runQuickSearchTypingSession,
} from "@lfg-benchmarks/shared/neutral";

const META: GridBenchmarkMeta = {
  appId: "lightfastgrid-vanilla",
  lane: "vanilla",
  appLabel: "LightFastGrid Vanilla Core (local tarball)",
  reactVersion: "n/a",
  reactDomVersion: "n/a",
  gridPackage: "@lightfastgrid/core",
  gridVersion: __LFG_CORE_VERSION__,
  agGridModules: null,
  agGridTheme: null,
  lightfastgridPackages: {
    core: __LFG_CORE_VERSION__,
    react: null,
  },
  viewport: { width: VIEWPORT_WIDTH_PX, height: VIEWPORT_HEIGHT_PX },
  rowHeight: ROW_HEIGHT_PX,
  headerHeight: HEADER_HEIGHT_PX,
  columnWidth: 150,
  overscanRowsPerSide: OVERSCAN_ROWS_PER_SIDE,
  pagination: false,
  pinnedColumns: false,
  customCellRenderers: false,
  animations: false,
  seed: 20260906,
  notes: [
    "Installed from a locally packed Core npm tarball, not workspace source.",
    "Production CSS imported from @lightfastgrid/core/themes/default.css.",
    "Vanilla Grid constructor and mount(host); no React adaptor.",
    "mount() measures through waitUntilReady(): first .lfg-row or overlay, then two animation frames.",
    "Completion boundary: accepted grid event, then two animation frames. Quick search also waits until pending is false, then two frames; durationMs ends there.",
    "Displayed row count is the processed/display row model from a benchmark-only GridState snapshot read after timing. It is not the source-row API and does not wait on a stale accessibility count or mutate loading.",
    "Quick Search modes are selected with ?lfgQuickSearchMode=. workerIsolated and mainThreadIsolated differ only by execution.thresholds.quickSearch. workerProductionOptimized uses cache/prewarm. Forced main thread is not a default configuration.",
    "The primary interactive Quick Search test types P→Pa→Pat→Pate→Patel at 120ms without waiting between keystrokes.",
  ],
};

function requireGrid(grid: Grid | null): Grid {
  if (!grid) throw new Error("LightFastGrid is not mounted");
  return grid;
}

function createDriver(container: HTMLElement): GridBenchmarkDriver {
  let grid: Grid | null = null;
  let chrome: VanillaBenchmarkChrome | null = null;
  let ready = false;
  let columnCount = 0;
  let rowCount = 0;
  let lastPendingObserved = false;
  let producerProbe: LightFastGridProducerProbe | null = null;
  const modeConfig = () =>
    lightFastGridQuickSearchMountConfig(resolveLfgQuickSearchModeFromSearch(), rowCount);
  const evidence = (): QuickSearchExecutionEvidence => {
    const acceptedText = grid?.getQuickFilterText() ?? "";
    return buildLfgQuickSearchEvidence({
      config: modeConfig(),
      rowCount,
      pendingObserved: lastPendingObserved,
      producer: producerProbe?.producerForAcceptedText(acceptedText) ?? "unknown",
    });
  };
  const attachProducerProbe = (instance: Grid) => {
    producerProbe?.detach();
    producerProbe = attachLightFastGridProducerProbe(instance);
  };

  return {
    async mount(state) {
      ready = false;
      columnCount = state.columns.length;
      rowCount = state.rows.length;
      lastPendingObserved = false;
      const config = modeConfig();
      producerProbe?.detach();
      producerProbe = null;
      chrome?.destroy();
      grid?.destroy();
      grid = null;
      chrome = mountVanillaBenchmarkChrome(container, {
        title: "LightFastGrid Vanilla",
        label: "lightfastgrid-vanilla",
        status: `${state.scenario} · ${state.rows.length} rows × ${state.columns.length} columns · generated in ${state.generationMs.toFixed(1)} ms`,
      });
      await new Promise<void>((resolve) => {
        grid = new Grid({
          rows: state.rows,
          columns: toLightFastGridColumns(state.columns),
          getRowId,
          defaultColDef: LIGHTFASTGRID_DEFAULT_COL_DEF,
          columnMenu: { enabled: false },
          cellMenu: { enabled: false },
          quickFilter: config.quickFilter,
          execution: config.execution,
          pagination: false,
          theme: LIGHTFASTGRID_THEME,
          onGridReady: () => {
            ready = true;
            resolve();
          },
        });
        grid.mount(chrome!.host);
      });
    },

    async waitUntilReady() {
      await waitWithTimeout(
        `${META.appLabel} waitUntilReady`,
        waitForPredicate(
          () => Boolean(ready && chrome?.host.querySelector(".lfg-row, .lfg-overlay")),
          getProtocolTimeoutMs() * 2,
          { label: `${META.appLabel} waitUntilReady` },
        ),
      );
      await waitAnimationFrames(2);
      attachProducerProbe(requireGrid(grid));
    },

    async sort(field, direction) {
      producerProbe?.beginCommand();
      const instance = requireGrid(grid);
      await waitForGridEvent({
        appLabel: META.appLabel,
        operation: "sort",
        subscribe: (handler) => instance.on("sort:changed", handler),
        afterSubscribe: () => {
          instance.setSortModel([{ field, sort: direction }]);
        },
      });
      const host = chrome?.host;
      if (!host) throw new Error("LightFastGrid host is not mounted");
      await waitForLightFastGridSortVisible(host, META.appLabel);
    },

    async applyFilterModel(model: NeutralFilterModel) {
      producerProbe?.beginCommand();
      const instance = requireGrid(grid);
      await applyLightFastGridNeutralFilter(instance, model, META.appLabel);
    },

    async clearFilterModel() {
      producerProbe?.beginCommand();
      const instance = requireGrid(grid);
      await clearLightFastGridNeutralFilter(instance, META.appLabel);
    },

    async typeColumnFilter(options) {
      producerProbe?.beginCommand();
      const instance = requireGrid(grid);
      const session = await runQuickSearchTypingSession(
        createLightFastGridColumnFilterTypingAdapter({
          field: options.field,
          setFilterModel: (model) => {
            instance.setFilterModel(model as Parameters<Grid["setFilterModel"]>[0]);
          },
          getFilterModel: () => instance.getFilterModel(),
          subscribeFilterChanged: (handler) => instance.on("filter:changed", handler),
          getDisplayedRowCount: () => readLightFastGridProcessedDisplayedRowCount(instance),
        }),
        {
          variant: options.variant,
          prefixes: options.prefixes,
          intervalMs: options.intervalMs,
        },
        META.appLabel,
      );
      lastPendingObserved = session.pendingObserved;
      return session;
    },

    getAcceptedFilterModel() {
      if (!grid) return emptyAcceptedState().filterModel;
      return readLightFastGridNeutralFilter(grid);
    },

    getFilterExecutionEvidence() {
      const snapshot = producerProbe?.filterCommandEvidence() ?? {
        producer: "unknown" as const,
        scheduled: false,
      };
      return buildLfgFilterEvidence({
        operation: "filter",
        rowCount,
        producer: snapshot.producer,
        scheduled: snapshot.scheduled,
      });
    },

    getSortExecutionEvidence() {
      const snapshot = producerProbe?.sortCommandEvidence() ?? {
        producer: "unknown" as const,
        scheduled: false,
      };
      return buildLfgFilterEvidence({
        operation: "sort",
        rowCount,
        producer: snapshot.producer,
        scheduled: snapshot.scheduled,
      });
    },

    async quickSearch(text) {
      const instance = requireGrid(grid);
      const offs: Array<() => void> = [];
      try {
        let pending = false;
        let sawPending = false;
        offs.push(
          instance.on("quick-search-pending:changed", (event) => {
            pending = event.pending;
            if (event.pending) sawPending = true;
          }),
        );
        await waitForGridEvent({
          appLabel: META.appLabel,
          operation: "quickSearch",
          subscribe: (handler) => instance.on("quick-filter:changed", handler),
          afterSubscribe: () => {
            instance.setQuickFilterText(text);
          },
        });
        await waitForLightFastGridQuickSearchSettlement({
          appLabel: META.appLabel,
          operation: "quickSearch",
          isPending: () => pending,
          sawPending: () => sawPending,
        });
        lastPendingObserved = sawPending || pending;
      } finally {
        for (const off of offs) off();
      }
    },

    async typeQuickSearch(options) {
      const instance = requireGrid(grid);
      const session = await runQuickSearchTypingSession(
        createLightFastGridTypingAdapter({
          grid: instance,
          setText: (text) => {
            instance.setQuickFilterText(text);
          },
          getDisplayedRowCount: () => readLightFastGridProcessedDisplayedRowCount(instance),
        }),
        options,
        META.appLabel,
      );
      lastPendingObserved = session.pendingObserved;
      return session;
    },

    getQuickSearchExecutionEvidence() {
      return evidence();
    },

    async clearOperations() {
      const instance = requireGrid(grid);
      const sortActive = instance.getSortModel().length > 0;
      const filterActive = Object.keys(instance.getFilterModel()).length > 0;
      const searchActive = instance.getQuickFilterText().trim().length > 0;
      let pending = false;
      let sawPending = false;
      const offs: Array<() => void> = [];
      try {
        if (searchActive) {
          offs.push(
            instance.on("quick-search-pending:changed", (event) => {
              pending = event.pending;
              if (event.pending) sawPending = true;
            }),
          );
        }
        if (sortActive) {
          await waitForGridEvent({
            appLabel: META.appLabel,
            operation: "clearSort",
            subscribe: (handler) => instance.on("sort:changed", handler),
            afterSubscribe: () => {
              instance.clearSort();
            },
          });
        }
        if (filterActive) {
          await waitForGridEvent({
            appLabel: META.appLabel,
            operation: "clearFilters",
            subscribe: (handler) => instance.on("filter:changed", handler),
            afterSubscribe: () => {
              instance.clearFilters();
            },
          });
        }
        if (searchActive) {
          await waitForGridEvent({
            appLabel: META.appLabel,
            operation: "clearQuickSearch",
            subscribe: (handler) => instance.on("quick-filter:changed", handler),
            afterSubscribe: () => {
              instance.clearQuickFilter();
            },
          });
          await waitForLightFastGridQuickSearchSettlement({
            appLabel: META.appLabel,
            operation: "clearOperations",
            isPending: () => pending,
            sawPending: () => sawPending,
          });
        } else {
          await waitAnimationFrames(2);
        }
      } finally {
        for (const off of offs) off();
      }
    },

    async scrollTo(top, left) {
      scrollElement(chrome?.host ?? null, ".lfg-viewport", top, left);
      await waitAnimationFrames(2);
    },

    getVisibleState() {
      const instance = requireGrid(grid);
      return readVisibleStateFromDom({
        host: chrome?.host ?? null,
        viewportSelector: ".lfg-viewport",
        rowSelector: ".lfg-row",
        rowIdAttribute: "data-row-id",
        displayedRowCount: readLightFastGridProcessedDisplayedRowCount(instance),
        columnCount,
      });
    },

    getAcceptedState() {
      if (!grid) return emptyAcceptedState();
      const filterModel = readLightFastGridNeutralFilter(grid);
      return {
        sort: grid.getSortModel().map((entry) => ({
          field: entry.field,
          direction: entry.sort,
        })),
        filterFields: filterFieldsOf(filterModel),
        filterModel,
        quickSearch: grid.getQuickFilterText() ?? "",
      };
    },

    getDomNodeCount() {
      return countDomNodes(chrome?.host ?? null);
    },

    async destroy() {
      producerProbe?.detach();
      producerProbe = null;
      grid?.destroy();
      grid = null;
      ready = false;
      chrome = mountVanillaBenchmarkChrome(container, {
        title: "LightFastGrid Vanilla",
        label: "lightfastgrid-vanilla",
        status: "Destroyed",
      });
      await waitAnimationFrames(1);
    },

    getReactProfileSummary() {
      return null;
    },
  };
}

export function installBenchmarkProtocol(container: HTMLElement): void {
  window.__GRID_BENCHMARK__ = createProtocolRuntime(
    () => META,
    () => createDriver(container),
  );
}
