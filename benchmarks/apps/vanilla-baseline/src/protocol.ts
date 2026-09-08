import {
  countDomNodes,
  baselineFilterEvidence,
  createProtocolRuntime,
  emptyAcceptedState,
  HEADER_HEIGHT_PX,
  mountVanillaBenchmarkChrome,
  OVERSCAN_ROWS_PER_SIDE,
  ROW_HEIGHT_PX,
  settleWithoutGridEvent,
  type GridBenchmarkDriver,
  type GridBenchmarkMeta,
  type VanillaBenchmarkChrome,
  VIEWPORT_HEIGHT_PX,
  VIEWPORT_WIDTH_PX,
  waitAnimationFrames,
  baselineTypingEvidence,
  runBaselineTypingSession,
} from "@lfg-benchmarks/shared/neutral";

const META: GridBenchmarkMeta = {
  appId: "vanilla-baseline",
  lane: "vanilla",
  appLabel: "Framework-free Vanilla baseline",
  reactVersion: "n/a",
  reactDomVersion: "n/a",
  gridPackage: "none",
  gridVersion: "n/a",
  agGridModules: null,
  agGridTheme: null,
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
    "Used only to understand shared Vanilla application overhead (host chrome, scenario generator, protocol runtime).",
    "Does not render a data grid. Does not depend on React, ReactDOM, LightFastGrid, or AG Grid.",
    "Subtracting this total from a Vanilla grid app is an estimate, not a primary result.",
    "Never subtract this baseline from a React app, or the React baseline from a Vanilla app.",
  ],
};

function createDriver(container: HTMLElement): GridBenchmarkDriver {
  let chrome: VanillaBenchmarkChrome | null = null;
  let displayedRowCount = 0;
  let columnCount = 0;

  return {
    async mount(state) {
      displayedRowCount = state.rows.length;
      columnCount = state.columns.length;
      chrome?.destroy();
      chrome = mountVanillaBenchmarkChrome(container, {
        title: "Vanilla baseline",
        label: "vanilla-baseline",
        status: `${state.scenario} · ${state.rows.length} rows × ${state.columns.length} columns generated in ${state.generationMs.toFixed(1)} ms · no grid mounted`,
      });
      const note = document.createElement("p");
      note.className = "benchmark-status";
      note.style.padding = "12px";
      note.textContent =
        "Vanilla baseline host. Rows are generated for protocol parity and are not rendered as a grid.";
      chrome.host.append(note);
    },

    async waitUntilReady() {
      await settleWithoutGridEvent();
    },

    async sort() {
      await settleWithoutGridEvent();
    },

    async applyFilterModel() {
      await settleWithoutGridEvent();
    },

    async clearFilterModel() {
      await settleWithoutGridEvent();
    },

    async typeColumnFilter(options) {
      return runBaselineTypingSession({
        variant: options.variant,
        prefixes: options.prefixes,
        intervalMs: options.intervalMs,
      });
    },

    getAcceptedFilterModel() {
      return emptyAcceptedState().filterModel;
    },

    getFilterExecutionEvidence() {
      return baselineFilterEvidence("filter");
    },

    getSortExecutionEvidence() {
      return baselineFilterEvidence("sort");
    },

    async quickSearch() {
      await settleWithoutGridEvent();
    },

    async typeQuickSearch(options) {
      return runBaselineTypingSession(options);
    },

    getQuickSearchExecutionEvidence() {
      return baselineTypingEvidence();
    },

    async clearOperations() {
      await settleWithoutGridEvent();
    },

    async scrollTo() {
      await waitAnimationFrames(2);
    },

    getVisibleState() {
      return {
        displayedRowCount,
        renderedRowCount: 0,
        firstRenderedRowId: null,
        lastRenderedRowId: null,
        scrollTop: 0,
        scrollLeft: 0,
        columnCount,
      };
    },

    getAcceptedState() {
      return emptyAcceptedState();
    },

    getDomNodeCount() {
      return countDomNodes(chrome?.host ?? null);
    },

    async destroy() {
      chrome = mountVanillaBenchmarkChrome(container, {
        title: "Vanilla baseline",
        label: "vanilla-baseline",
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
