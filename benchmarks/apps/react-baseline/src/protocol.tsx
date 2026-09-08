import {
  BenchmarkShell,
  countDomNodes,
  baselineFilterEvidence,
  createProtocolRuntime,
  emptyAcceptedState,
  GridHost,
  HEADER_HEIGHT_PX,
  OVERSCAN_ROWS_PER_SIDE,
  ROW_HEIGHT_PX,
  type GridBenchmarkDriver,
  type GridBenchmarkMeta,
  settleWithoutGridEvent,
  VIEWPORT_HEIGHT_PX,
  VIEWPORT_WIDTH_PX,
  waitAnimationFrames,
  baselineTypingEvidence,
  runBaselineTypingSession,
} from "@lfg-benchmarks/shared";
import { StrictMode, useRef } from "react";
import type { Root } from "react-dom/client";

const META: GridBenchmarkMeta = {
  appId: "react-baseline",
  lane: "react",
  appLabel: "React-only baseline",
  reactVersion: "19.2.5",
  reactDomVersion: "19.2.5",
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
    "Used only to understand shared application overhead (React, ReactDOM, host chrome, scenario generator).",
    "Does not render a data grid. Subtracting this total from a grid app is an estimate, not a primary result.",
  ],
};

type BaselineAppProps = {
  readonly scenario: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly generationMs: number;
  readonly onHost: (host: HTMLElement | null) => void;
};

function BaselineApp({
  scenario,
  rowCount,
  columnCount,
  generationMs,
  onHost,
}: BaselineAppProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  return (
    <BenchmarkShell
      title="React baseline"
      status={`${scenario} · ${rowCount} rows × ${columnCount} columns generated in ${generationMs.toFixed(1)} ms · no grid mounted`}
    >
      <div
        ref={(node) => {
          hostRef.current = node;
          onHost(node);
        }}
      >
        <GridHost label="react-baseline">
          <p className="benchmark-status" style={{ padding: 12 }}>
            React baseline host. Rows are generated for protocol parity and are
            not rendered as a grid.
          </p>
        </GridHost>
      </div>
    </BenchmarkShell>
  );
}

function createDriver(root: Root): GridBenchmarkDriver {
  let host: HTMLElement | null = null;
  let displayedRowCount = 0;
  let columnCount = 0;

  return {
    async mount(state) {
      displayedRowCount = state.rows.length;
      columnCount = state.columns.length;
      await new Promise<void>((resolve) => {
        root.render(
          <StrictMode>
            <BaselineApp
              scenario={state.scenario}
              rowCount={state.rows.length}
              columnCount={state.columns.length}
              generationMs={state.generationMs}
              onHost={(next) => {
                host = next;
                resolve();
              }}
            />
          </StrictMode>,
        );
      });
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
      return countDomNodes(host);
    },

    async destroy() {
      host = null;
      root.render(
        <StrictMode>
          <BenchmarkShell title="React baseline" status="Destroyed">
            <GridHost label="react-baseline" />
          </BenchmarkShell>
        </StrictMode>,
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
