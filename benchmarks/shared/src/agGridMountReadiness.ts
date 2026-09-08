export const AG_GRID_BENCHMARK_HOST_SELECTOR = '[data-benchmark-host="ag-grid"]';

export type AgGridMountApi = {
  getDisplayedRowCount(): number;
  isDestroyed?(): boolean;
  getGridElement?(): { querySelector(selector: string): unknown } | null | undefined;
};

export type AgGridMountReadiness = {
  readonly generation: number;
  readonly currentGeneration: number;
  readonly api: AgGridMountApi | null;
  readonly host: { querySelector(selector: string): unknown } | null;
  readonly expectedDisplayedRowCount: number;
};

export function agGridMountDomIsReady(
  scope: { querySelector(selector: string): unknown } | null | undefined,
  expectedDisplayedRowCount: number,
): boolean {
  if (!scope) return false;
  if (expectedDisplayedRowCount === 0) {
    return Boolean(
      scope.querySelector(".ag-overlay-no-rows-wrapper, .ag-overlay, .ag-overlay-wrapper"),
    );
  }
  return Boolean(scope.querySelector(".ag-row"));
}

/**
 * `firstDataRendered` is not a reliable repeated React remount signal.
 * Readiness is the current mount generation's living API, expected
 * displayed-row count, and rows (or empty overlay) inside that API's
 * `getGridElement()`. A previous grid's host DOM cannot satisfy a newer
 * generation when `getGridElement()` exists.
 */
export function agGridMountIsReady(options: AgGridMountReadiness): boolean {
  if (options.generation !== options.currentGeneration) return false;
  const api = options.api;
  if (!api || api.isDestroyed?.()) return false;
  if (api.getDisplayedRowCount() !== options.expectedDisplayedRowCount) {
    return false;
  }
  const gridRoot = api.getGridElement?.();
  if (gridRoot) {
    return agGridMountDomIsReady(gridRoot, options.expectedDisplayedRowCount);
  }
  return agGridMountDomIsReady(options.host, options.expectedDisplayedRowCount);
}

/** True when this harness host exists and no AG Grid root remains inside it. */
export function agGridMountShellIsClear(
  host: { querySelector(selector: string): unknown } | null | undefined,
): boolean {
  if (!host) return false;
  return !host.querySelector(".ag-root-wrapper, .ag-root");
}
