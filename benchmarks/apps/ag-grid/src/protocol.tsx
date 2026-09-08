import type { ColDef, GridApi, GridReadyEvent } from "ag-grid-community";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import {
  AG_GRID_BENCHMARK_HOST_SELECTOR,
  AG_GRID_DEFAULT_COL_DEF,
  AG_GRID_VIEWPORT_SELECTOR,
  BenchmarkShell,
  applyAgGridNeutralFilter,
  buildAgGridFilterEvidence,
  buildAgGridQuickSearchEvidence,
  clearAgGridNeutralFilter,
  countDomNodes,
  createAgGridColumnFilterTypingAdapter,
  createAgGridTypingAdapter,
  createProtocolRuntime,
  emptyAcceptedState,
  filterFieldsOf,
  GridHost,
  getProtocolTimeoutMs,
  HEADER_HEIGHT_PX,
  OVERSCAN_ROWS_PER_SIDE,
  ROW_HEIGHT_PX,
  type GridBenchmarkDriver,
  type GridBenchmarkMeta,
  type NeutralFilterModel,
  type PreparedBenchmarkState,
  type QuickSearchExecutionEvidence,
  readAgGridNeutralFilter,
  readVisibleStateFromDom,
  runQuickSearchTypingSession,
  scrollElement,
  toAgGridColDefs,
  VIEWPORT_HEIGHT_PX,
  VIEWPORT_WIDTH_PX,
  waitAnimationFrames,
  waitForGridEvent,
  waitForGridEventThenRender,
  waitForPredicate,
  waitWithTimeout,
  agGridMountIsReady,
  agGridMountShellIsClear,
} from "@lfg-benchmarks/shared";
import { StrictMode, useMemo } from "react";
import { flushSync } from "react-dom";
import type { Root } from "react-dom/client";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  rowHeight: ROW_HEIGHT_PX,
  headerHeight: HEADER_HEIGHT_PX,
  browserColorScheme: "light",
});

const META: GridBenchmarkMeta = {
  appId: "ag-grid",
  lane: "react",
  appLabel: "AG Grid React Community",
  reactVersion: "19.2.5",
  reactDomVersion: "19.2.5",
  gridPackage: "ag-grid-react",
  gridVersion: "36.1.0",
  agGridModules: "AllCommunityModule",
  agGridTheme: "themeQuartz Theming API (not legacy CSS themes)",
  lightfastgridPackages: null,
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
    "AG Grid Community is MIT licensed. This harness does not use Enterprise modules.",
    "AllCommunityModule is the documented full Community bundle, comparable to LightFastGrid's integrated MIT package.",
    "Set Filter is Enterprise and is not used; status columns use text filters.",
    "Completion boundary: AG Grid sort/filter/model events, then two animation frames.",
    "mount() measures through waitUntilReady(): first .ag-row (or empty overlay), then two animation frames.",
    "Repeated remount readiness is the current GridApi displayed-row count and rows inside that API's getGridElement(); firstDataRendered is not used.",
    "The primary interactive Quick Search test types P→Pa→Pat→Pate→Patel at 120ms without waiting between keystrokes.",
    "cacheQuickFilter is true (supported by AG Grid 36.1.0). AG Grid has no LightFastGrid-style Quick Search Worker; this is the single optimized AG baseline per framework.",
  ],
};

function subscribeAgEvent(grid: GridApi, eventName: "sortChanged" | "filterChanged") {
  return (handler: (value?: unknown) => void) => {
    const listener = () => handler();
    grid.addEventListener(eventName, listener);
    return () => grid.removeEventListener(eventName, listener);
  };
}

type GridAppProps = {
  readonly state: PreparedBenchmarkState;
  readonly generation: number;
  readonly onApi: (api: GridApi | null, generation: number) => void;
  readonly onHost: (host: HTMLElement | null, generation: number) => void;
};

function GridApp({ state, generation, onApi, onHost }: GridAppProps) {
  const columnDefs = useMemo(
    () => toAgGridColDefs(state.columns) as ColDef[],
    [state.columns],
  );
  const defaultColDef = useMemo<ColDef>(() => ({ ...AG_GRID_DEFAULT_COL_DEF }), []);

  return (
    <BenchmarkShell
      title="AG Grid Community"
      status={`${state.scenario} · ${state.rows.length} rows × ${state.columns.length} columns · generated in ${state.generationMs.toFixed(1)} ms`}
    >
      <GridHost
        label="ag-grid"
        hostRef={(node) => {
          onHost(node, generation);
        }}
      >
        <AgGridReact
          theme={theme}
          rowData={state.rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(params) => String(params.data.id)}
          animateRows={false}
          cellFlashDuration={0}
          cellFadeDuration={0}
          rowBuffer={OVERSCAN_ROWS_PER_SIDE}
          rowHeight={ROW_HEIGHT_PX}
          headerHeight={HEADER_HEIGHT_PX}
          pagination={false}
          suppressMovableColumns
          cacheQuickFilter
          loadThemeGoogleFonts={false}
          onGridReady={(event: GridReadyEvent) => {
            if (event.api.isDestroyed()) return;
            onApi(event.api, generation);
          }}
          onGridPreDestroyed={() => {
            onApi(null, generation);
          }}
        />
      </GridHost>
    </BenchmarkShell>
  );
}

function createDriver(root: Root): GridBenchmarkDriver {
  let api: GridApi | null = null;
  let host: HTMLElement | null = null;
  let ready = false;
  let displayedRowCount = 0;
  let columnCount = 0;
  let rowCount = 0;
  let mountEpoch = 0;
  let lastFilterCommand: "apply" | "clear" | "type" | null = null;
  const evidence = (): QuickSearchExecutionEvidence =>
    buildAgGridQuickSearchEvidence({ rowCount, cacheQuickFilter: true });

  const requireApi = (): GridApi => {
    if (!api) throw new Error("AG Grid is not mounted");
    return api;
  };

  return {
    async mount(state) {
      const generation = ++mountEpoch;
      ready = false;
      api = null;
      host = null;
      displayedRowCount = state.rows.length;
      columnCount = state.columns.length;
      rowCount = state.rows.length;
      lastFilterCommand = null;
      const assignApi = (next: GridApi | null, gen: number) => {
        if (gen !== mountEpoch) return;
        if (next?.isDestroyed()) {
          if (api === next) api = null;
          return;
        }
        api = next;
      };
      const assignHost = (next: HTMLElement | null, gen: number) => {
        if (gen !== mountEpoch) return;
        host = next;
      };
      root.render(
        <StrictMode>
          <GridApp
            key={generation}
            generation={generation}
            state={state}
            onApi={assignApi}
            onHost={assignHost}
          />
        </StrictMode>,
      );
      const abort = new AbortController();
      try {
        await waitWithTimeout(
          `${META.appLabel} remount displayed rows`,
          waitForPredicate(
            () =>
              agGridMountIsReady({
                generation,
                currentGeneration: mountEpoch,
                api,
                host,
                expectedDisplayedRowCount: displayedRowCount,
              }),
            getProtocolTimeoutMs(),
            { signal: abort.signal, label: `${META.appLabel} remount displayed rows` },
          ),
        );
        ready = true;
      } catch (error) {
        if (generation === mountEpoch) {
          ready = false;
        }
        throw error;
      } finally {
        abort.abort();
      }
    },

    async waitUntilReady() {
      await waitWithTimeout(
        `${META.appLabel} waitUntilReady`,
        waitForPredicate(
          () =>
            Boolean(ready) &&
            agGridMountIsReady({
              generation: mountEpoch,
              currentGeneration: mountEpoch,
              api,
              host,
              expectedDisplayedRowCount: displayedRowCount,
            }),
          getProtocolTimeoutMs() * 2,
          { label: `${META.appLabel} waitUntilReady` },
        ),
      );
      await waitAnimationFrames(2);
    },

    async sort(field, direction) {
      const grid = requireApi();
      await waitForGridEventThenRender({
        appLabel: META.appLabel,
        operation: "sort",
        subscribe: subscribeAgEvent(grid, "sortChanged"),
        afterSubscribe: () => {
          grid.applyColumnState({
            state: [{ colId: field, sort: direction }],
            defaultState: { sort: null },
          });
        },
      });
    },

    async applyFilterModel(model: NeutralFilterModel) {
      lastFilterCommand = "apply";
      const grid = requireApi();
      await applyAgGridNeutralFilter(grid, model, META.appLabel);
      displayedRowCount = grid.getDisplayedRowCount();
    },

    async clearFilterModel() {
      lastFilterCommand = "clear";
      const grid = requireApi();
      await clearAgGridNeutralFilter(grid, META.appLabel);
      displayedRowCount = grid.getDisplayedRowCount();
    },

    async typeColumnFilter(options) {
      lastFilterCommand = "type";
      const grid = requireApi();
      const session = await runQuickSearchTypingSession(
        createAgGridColumnFilterTypingAdapter({
          field: options.field,
          setFilterModel: (model) => {
            void grid.setFilterModel(model);
          },
          getFilterModel: () => grid.getFilterModel(),
          onFilterChanged: () => {
            grid.onFilterChanged();
          },
          addEventListener: (event, listener) => {
            grid.addEventListener(event, listener);
          },
          removeEventListener: (event, listener) => {
            grid.removeEventListener(event, listener);
          },
          getDisplayedRowCount: () => grid.getDisplayedRowCount(),
        }),
        {
          variant: options.variant,
          prefixes: options.prefixes,
          intervalMs: options.intervalMs,
        },
        META.appLabel,
      );
      displayedRowCount = grid.getDisplayedRowCount();
      return session;
    },

    getAcceptedFilterModel() {
      if (!api) return emptyAcceptedState().filterModel;
      return readAgGridNeutralFilter(api);
    },

    getFilterExecutionEvidence() {
      return buildAgGridFilterEvidence({
        operation: "filter",
        rowCount,
        producer: lastFilterCommand === "clear" ? "none" : "unknown",
      });
    },

    getSortExecutionEvidence() {
      return buildAgGridFilterEvidence({ operation: "sort", rowCount });
    },

    async quickSearch(text) {
      const grid = requireApi();
      await waitForGridEventThenRender({
        appLabel: META.appLabel,
        operation: "quickSearch",
        subscribe: subscribeAgEvent(grid, "filterChanged"),
        afterSubscribe: () => {
          grid.setGridOption("quickFilterText", text);
        },
      });
      displayedRowCount = grid.getDisplayedRowCount();
    },

    async typeQuickSearch(options) {
      const grid = requireApi();
      const session = await runQuickSearchTypingSession(
        createAgGridTypingAdapter(grid),
        options,
        META.appLabel,
      );
      displayedRowCount = grid.getDisplayedRowCount();
      return session;
    },

    getQuickSearchExecutionEvidence() {
      return evidence();
    },

    async clearOperations() {
      const grid = requireApi();
      const quickActive = String(grid.getGridOption("quickFilterText") ?? "").length > 0;
      const filterModel = grid.getFilterModel() ?? {};
      const filterActive = Object.keys(filterModel).length > 0;
      const sortActive = grid.getColumnState().some((column) => Boolean(column.sort));

      if (quickActive) {
        await waitForGridEvent({
          appLabel: META.appLabel,
          operation: "clearQuickSearch",
          subscribe: subscribeAgEvent(grid, "filterChanged"),
          afterSubscribe: () => {
            grid.setGridOption("quickFilterText", "");
          },
        });
      }
      if (filterActive) {
        await waitForGridEvent({
          appLabel: META.appLabel,
          operation: "clearFilters",
          subscribe: subscribeAgEvent(grid, "filterChanged"),
          afterSubscribe: async () => {
            await grid.setFilterModel(null);
            grid.onFilterChanged();
          },
        });
      }
      if (sortActive) {
        await waitForGridEvent({
          appLabel: META.appLabel,
          operation: "clearSort",
          subscribe: subscribeAgEvent(grid, "sortChanged"),
          afterSubscribe: () => {
            grid.applyColumnState({ defaultState: { sort: null } });
          },
        });
      }

      displayedRowCount = grid.getDisplayedRowCount();
      await waitAnimationFrames(2);
    },

    async scrollTo(top, left) {
      scrollElement(host, AG_GRID_VIEWPORT_SELECTOR, top, left);
      await waitAnimationFrames(2);
    },

    getVisibleState() {
      if (api) displayedRowCount = api.getDisplayedRowCount();
      return readVisibleStateFromDom({
        host,
        viewportSelector: AG_GRID_VIEWPORT_SELECTOR,
        rowSelector: ".ag-row",
        rowIdAttribute: "row-id",
        displayedRowCount,
        columnCount,
      });
    },

    getAcceptedState() {
      if (!api) return emptyAcceptedState();
      const filterModel = readAgGridNeutralFilter(api);
      return {
        sort: api
          .getColumnState()
          .filter((column) => Boolean(column.sort))
          .map((column) => ({
            field: String(column.colId),
            direction: column.sort === "desc" ? "desc" : "asc",
          })),
        filterFields: filterFieldsOf(filterModel),
        filterModel,
        quickSearch: String(api.getGridOption("quickFilterText") ?? ""),
      };
    },

    getDomNodeCount() {
      return countDomNodes(host);
    },

    async destroy() {
      mountEpoch += 1;
      api = null;
      host = null;
      ready = false;
      flushSync(() => {
        root.render(
          <StrictMode>
            <BenchmarkShell title="AG Grid Community" status="Destroyed">
              <GridHost label="ag-grid" />
            </BenchmarkShell>
          </StrictMode>,
        );
      });
      await waitWithTimeout(
        `${META.appLabel} previous grid teardown`,
        waitForPredicate(
          () => agGridMountShellIsClear(document.querySelector(AG_GRID_BENCHMARK_HOST_SELECTOR)),
          getProtocolTimeoutMs(),
          { label: `${META.appLabel} previous grid teardown` },
        ),
      );
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
