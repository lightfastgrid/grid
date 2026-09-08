import type { Grid } from "@lightfastgrid/core";
import {
  LightFastGrid,
  type ReactLightFastGridHandle,
} from "@lightfastgrid/react";
import {
  BenchmarkShell,
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
  GridHost,
  HEADER_HEIGHT_PX,
  LIGHTFASTGRID_DEFAULT_COL_DEF,
  LIGHTFASTGRID_THEME,
  OVERSCAN_ROWS_PER_SIDE,
  readLightFastGridNeutralFilter,
  readLightFastGridProcessedDisplayedRowCount,
  ROW_HEIGHT_PX,
  type GridBenchmarkDriver,
  type GridBenchmarkMeta,
  type LightFastGridProducerProbe,
  type NeutralFilterModel,
  type PreparedBenchmarkState,
  type QuickSearchExecutionEvidence,
  lightFastGridQuickSearchMountConfig,
  readVisibleStateFromDom,
  resolveLfgQuickSearchModeFromSearch,
  runQuickSearchTypingSession,
  scrollElement,
  toLightFastGridColumns,
  VIEWPORT_HEIGHT_PX,
  VIEWPORT_WIDTH_PX,
  waitAnimationFrames,
  waitForGridEvent,
  waitForLightFastGridQuickSearchSettlement,
  waitForLightFastGridSortVisible,
  waitForPredicate,
  waitWithTimeout,
} from "@lfg-benchmarks/shared";
import { StrictMode, useEffect, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import type { Root } from "react-dom/client";

const META: GridBenchmarkMeta = {
  appId: "lightfastgrid",
  lane: "react",
  appLabel: "LightFastGrid React (local tarball)",
  reactVersion: "19.2.5",
  reactDomVersion: "19.2.5",
  gridPackage: "@lightfastgrid/react",
  gridVersion: __LFG_REACT_VERSION__,
  agGridModules: null,
  agGridTheme: null,
  lightfastgridPackages: {
    core: __LFG_CORE_VERSION__,
    react: __LFG_REACT_VERSION__,
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
    "Installed from locally packed npm tarballs, not workspace source.",
    "Production CSS imported from @lightfastgrid/core/themes/default.css.",
    "mount() measures through waitUntilReady(): first .lfg-row or overlay, then two animation frames.",
    "Completion boundary: accepted grid event, then two animation frames. Quick search also waits until pending is false, then two frames; durationMs ends there.",
    "Displayed row count is the processed/display row model from a benchmark-only GridState snapshot read after timing. It is not the source-row API and does not wait on a stale accessibility count or mutate loading.",
    "Quick Search modes are selected with ?lfgQuickSearchMode=. workerIsolated and mainThreadIsolated differ only by execution.thresholds.quickSearch. workerProductionOptimized uses cache/prewarm. Forced main thread is not a default configuration.",
    "The primary interactive Quick Search test types P→Pa→Pat→Pate→Patel at 120ms without waiting between keystrokes.",
  ],
};

type GridAppProps = {
  readonly state: PreparedBenchmarkState;
  readonly quickFilter: true | { enabled: true; cache: boolean; prewarm: boolean };
  readonly execution: { thresholds: { quickSearch: number } } | undefined;
  readonly onHandle: (handle: ReactLightFastGridHandle | null) => void;
  readonly onHost: (host: HTMLElement | null) => void;
  readonly onReady: () => void;
};

function GridApp({ state, quickFilter, execution, onHandle, onHost, onReady }: GridAppProps) {
  const handleRef = useRef<ReactLightFastGridHandle>(null);
  const columns = useMemo(
    () => toLightFastGridColumns(state.columns),
    [state.columns],
  );

  useEffect(() => {
    onHandle(handleRef.current);
    return () => onHandle(null);
  }, [onHandle, state]);

  return (
    <BenchmarkShell
      title="LightFastGrid"
      status={`${state.scenario} · ${state.rows.length} rows × ${state.columns.length} columns · generated in ${state.generationMs.toFixed(1)} ms`}
    >
      <GridHost
        label="lightfastgrid"
        hostRef={(node) => {
          onHost(node);
        }}
      >
        <LightFastGrid
          ref={handleRef}
          rows={state.rows}
          columns={columns}
          getRowId={getRowId}
          defaultColDef={LIGHTFASTGRID_DEFAULT_COL_DEF}
          columnMenu={{ enabled: false }}
          cellMenu={{ enabled: false }}
          quickFilter={quickFilter}
          execution={execution}
          pagination={false}
          theme={LIGHTFASTGRID_THEME}
          height="100%"
          onGridReady={onReady}
        />
      </GridHost>
    </BenchmarkShell>
  );
}

function requireGrid(handle: ReactLightFastGridHandle | null): Grid {
  const grid = handle?.getInstance() ?? null;
  if (!grid) throw new Error("LightFastGrid is not mounted");
  return grid;
}

function createDriver(root: Root): GridBenchmarkDriver {
  let handle: ReactLightFastGridHandle | null = null;
  let host: HTMLElement | null = null;
  let ready = false;
  let columnCount = 0;
  let rowCount = 0;
  let lastPendingObserved = false;
  let producerProbe: LightFastGridProducerProbe | null = null;
  const modeConfig = () =>
    lightFastGridQuickSearchMountConfig(resolveLfgQuickSearchModeFromSearch(), rowCount);

  const evidence = (): QuickSearchExecutionEvidence => {
    const acceptedText = handle?.getQuickFilterText() ?? "";
    return buildLfgQuickSearchEvidence({
      config: modeConfig(),
      rowCount,
      pendingObserved: lastPendingObserved,
      producer: producerProbe?.producerForAcceptedText(acceptedText) ?? "unknown",
    });
  };

  const attachProducerProbe = (grid: Grid) => {
    producerProbe?.detach();
    producerProbe = attachLightFastGridProducerProbe(grid);
  };

  return {
    async mount(state) {
      ready = false;
      columnCount = state.columns.length;
      rowCount = state.rows.length;
      lastPendingObserved = false;
      producerProbe?.detach();
      producerProbe = null;
      const config = modeConfig();
      await new Promise<void>((resolve) => {
        root.render(
          <StrictMode>
            <GridApp
              state={state}
              quickFilter={config.quickFilter}
              execution={config.execution}
              onHandle={(next) => {
                handle = next;
              }}
              onHost={(next) => {
                host = next;
              }}
              onReady={() => {
                ready = true;
                resolve();
              }}
            />
          </StrictMode>,
        );
      });
    },

    async waitUntilReady() {
      await waitWithTimeout(
        `${META.appLabel} waitUntilReady`,
        waitForPredicate(
          () => Boolean(ready && host?.querySelector(".lfg-row, .lfg-overlay")),
          getProtocolTimeoutMs() * 2,
          { label: `${META.appLabel} waitUntilReady` },
        ),
      );
      await waitAnimationFrames(2);
      attachProducerProbe(requireGrid(handle));
    },

    async sort(field, direction) {
      producerProbe?.beginCommand();
      const grid = requireGrid(handle);
      await waitForGridEvent({
        appLabel: META.appLabel,
        operation: "sort",
        subscribe: (handler) => grid.on("sort:changed", handler),
        afterSubscribe: () => {
          handle!.setSortModel([{ field, sort: direction }]);
        },
      });
      if (!host) throw new Error("LightFastGrid host is not mounted");
      await waitForLightFastGridSortVisible(host, META.appLabel);
    },

    async applyFilterModel(model: NeutralFilterModel) {
      producerProbe?.beginCommand();
      const grid = requireGrid(handle);
      await applyLightFastGridNeutralFilter(grid, model, META.appLabel);
    },

    async clearFilterModel() {
      producerProbe?.beginCommand();
      const grid = requireGrid(handle);
      await clearLightFastGridNeutralFilter(grid, META.appLabel);
    },

    async typeColumnFilter(options) {
      producerProbe?.beginCommand();
      const grid = requireGrid(handle);
      const session = await runQuickSearchTypingSession(
        createLightFastGridColumnFilterTypingAdapter({
          field: options.field,
          setFilterModel: (model) => {
            grid.setFilterModel(model as Parameters<Grid["setFilterModel"]>[0]);
          },
          getFilterModel: () => grid.getFilterModel(),
          subscribeFilterChanged: (handler) => grid.on("filter:changed", handler),
          getDisplayedRowCount: () => readLightFastGridProcessedDisplayedRowCount(grid),
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
      if (!handle) return emptyAcceptedState().filterModel;
      return readLightFastGridNeutralFilter(requireGrid(handle));
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
      const grid = requireGrid(handle);
      const offs: Array<() => void> = [];
      try {
        let pending = false;
        let sawPending = false;
        offs.push(
          grid.on("quick-search-pending:changed", (event) => {
            pending = event.pending;
            if (event.pending) sawPending = true;
          }),
        );
        await waitForGridEvent({
          appLabel: META.appLabel,
          operation: "quickSearch",
          subscribe: (handler) => grid.on("quick-filter:changed", handler),
          afterSubscribe: () => {
            handle!.setQuickFilterText(text);
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
      const grid = requireGrid(handle);
      const session = await runQuickSearchTypingSession(
        createLightFastGridTypingAdapter({
          grid,
          setText: (text) => {
            handle!.setQuickFilterText(text);
          },
          getDisplayedRowCount: () => readLightFastGridProcessedDisplayedRowCount(grid),
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
      const grid = requireGrid(handle);
      const api = handle!;
      const sortActive = api.getSortModel().length > 0;
      const filterActive = Object.keys(api.getFilterModel()).length > 0;
      const searchActive = api.getQuickFilterText().trim().length > 0;
      let pending = false;
      let sawPending = false;
      const offs: Array<() => void> = [];
      try {
        if (searchActive) {
          offs.push(
            grid.on("quick-search-pending:changed", (event) => {
              pending = event.pending;
              if (event.pending) sawPending = true;
            }),
          );
        }
        if (sortActive) {
          await waitForGridEvent({
            appLabel: META.appLabel,
            operation: "clearSort",
            subscribe: (handler) => grid.on("sort:changed", handler),
            afterSubscribe: () => {
              api.clearSort();
            },
          });
        }
        if (filterActive) {
          await waitForGridEvent({
            appLabel: META.appLabel,
            operation: "clearFilters",
            subscribe: (handler) => grid.on("filter:changed", handler),
            afterSubscribe: () => {
              api.clearFilters();
            },
          });
        }
        if (searchActive) {
          await waitForGridEvent({
            appLabel: META.appLabel,
            operation: "clearQuickSearch",
            subscribe: (handler) => grid.on("quick-filter:changed", handler),
            afterSubscribe: () => {
              api.clearQuickFilter();
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
      scrollElement(host, ".lfg-viewport", top, left);
      await waitAnimationFrames(2);
    },

    getVisibleState() {
      const grid = requireGrid(handle);
      return readVisibleStateFromDom({
        host,
        viewportSelector: ".lfg-viewport",
        rowSelector: ".lfg-row",
        rowIdAttribute: "data-row-id",
        displayedRowCount: readLightFastGridProcessedDisplayedRowCount(grid),
        columnCount,
      });
    },

    getAcceptedState() {
      if (!handle) return emptyAcceptedState();
      const filterModel = readLightFastGridNeutralFilter(requireGrid(handle));
      return {
        sort: handle.getSortModel().map((entry) => ({
          field: entry.field,
          direction: entry.sort,
        })),
        filterFields: filterFieldsOf(filterModel),
        filterModel,
        quickSearch: handle.getQuickFilterText() ?? "",
      };
    },

    getDomNodeCount() {
      return countDomNodes(host);
    },

    async destroy() {
      producerProbe?.detach();
      producerProbe = null;
      handle = null;
      host = null;
      ready = false;
      flushSync(() => {
        root.render(
          <StrictMode>
            <BenchmarkShell title="LightFastGrid" status="Destroyed">
              <GridHost label="lightfastgrid" />
            </BenchmarkShell>
          </StrictMode>,
        );
      });
      await waitAnimationFrames(1);
    },

    getReactProfileSummary() {
      return null;
    },
  };
}

export function installBenchmarkProtocol(root: Root): void {
  window.__GRID_BENCHMARK__ = createProtocolRuntime(() => META, () => createDriver(root));
}
