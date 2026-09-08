import type { ColDef, GridApi } from "ag-grid-community";
import {
  AllCommunityModule,
  createGrid,
  ModuleRegistry,
  themeQuartz,
} from "ag-grid-community";
import {
  AG_GRID_DEFAULT_COL_DEF,
  AG_GRID_VIEWPORT_SELECTOR,
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
  getProtocolTimeoutMs,
  HEADER_HEIGHT_PX,
  mountVanillaBenchmarkChrome,
  OVERSCAN_ROWS_PER_SIDE,
  readAgGridNeutralFilter,
  readVisibleStateFromDom,
  ROW_HEIGHT_PX,
  scrollElement,
  toAgGridColDefs,
  type GridBenchmarkDriver,
  type GridBenchmarkMeta,
  type NeutralFilterModel,
  type QuickSearchExecutionEvidence,
  type VanillaBenchmarkChrome,
  VIEWPORT_HEIGHT_PX,
  VIEWPORT_WIDTH_PX,
  waitAnimationFrames,
  waitForGridEvent,
  waitForGridEventThenRender,
  waitForPredicate,
  waitWithTimeout,
  runQuickSearchTypingSession,
} from "@lfg-benchmarks/shared/neutral";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  rowHeight: ROW_HEIGHT_PX,
  headerHeight: HEADER_HEIGHT_PX,
  browserColorScheme: "light",
});

const META: GridBenchmarkMeta = {
  appId: "ag-grid-vanilla",
  lane: "vanilla",
  appLabel: "AG Grid Community Vanilla",
  reactVersion: "n/a",
  reactDomVersion: "n/a",
  gridPackage: "ag-grid-community",
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
    "Uses the documented Vanilla createGrid API. ag-grid-react is not a dependency.",
    "Set Filter is Enterprise and is not used; status columns use text filters.",
    "Completion boundary: AG Grid sort/filter/model events, then two animation frames.",
    "mount() measures through waitUntilReady(): first .ag-row (or empty overlay), then two animation frames.",
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

function createDriver(container: HTMLElement): GridBenchmarkDriver {
  let api: GridApi | null = null;
  let chrome: VanillaBenchmarkChrome | null = null;
  let ready = false;
  let displayedRowCount = 0;
  let columnCount = 0;
  let rowCount = 0;
  let lastFilterCommand: "apply" | "clear" | "type" | null = null;
  const evidence = (): QuickSearchExecutionEvidence =>
    buildAgGridQuickSearchEvidence({ rowCount, cacheQuickFilter: true });

  const requireApi = (): GridApi => {
    if (!api) throw new Error("AG Grid is not mounted");
    return api;
  };

  return {
    async mount(state) {
      ready = false;
      displayedRowCount = state.rows.length;
      columnCount = state.columns.length;
      rowCount = state.rows.length;
      lastFilterCommand = null;
      api?.destroy();
      api = null;
      chrome?.destroy();
      chrome = mountVanillaBenchmarkChrome(container, {
        title: "AG Grid Community Vanilla",
        label: "ag-grid-vanilla",
        status: `${state.scenario} · ${state.rows.length} rows × ${state.columns.length} columns · generated in ${state.generationMs.toFixed(1)} ms`,
      });
      await waitWithTimeout(
        `${META.appLabel} mount first data rendered`,
        new Promise<void>((resolve) => {
          api = createGrid(chrome!.host, {
            theme,
            rowData: state.rows,
            columnDefs: toAgGridColDefs(state.columns) as ColDef[],
            defaultColDef: { ...AG_GRID_DEFAULT_COL_DEF },
            getRowId: (params) => String(params.data.id),
            animateRows: false,
            cellFlashDuration: 0,
            cellFadeDuration: 0,
            rowBuffer: OVERSCAN_ROWS_PER_SIDE,
            rowHeight: ROW_HEIGHT_PX,
            headerHeight: HEADER_HEIGHT_PX,
            pagination: false,
            suppressMovableColumns: true,
            cacheQuickFilter: true,
            loadThemeGoogleFonts: false,
            onFirstDataRendered: () => {
              ready = true;
              resolve();
            },
          });
        }),
      );
    },

    async waitUntilReady() {
      await waitWithTimeout(
        `${META.appLabel} waitUntilReady`,
        waitForPredicate(
          () =>
            Boolean(ready && (chrome?.host.querySelector(".ag-row") || displayedRowCount === 0)),
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
      scrollElement(chrome?.host ?? null, AG_GRID_VIEWPORT_SELECTOR, top, left);
      await waitAnimationFrames(2);
    },

    getVisibleState() {
      if (api) displayedRowCount = api.getDisplayedRowCount();
      return readVisibleStateFromDom({
        host: chrome?.host ?? null,
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
      return countDomNodes(chrome?.host ?? null);
    },

    async destroy() {
      api?.destroy();
      api = null;
      ready = false;
      chrome = mountVanillaBenchmarkChrome(container, {
        title: "AG Grid Community Vanilla",
        label: "ag-grid-vanilla",
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
