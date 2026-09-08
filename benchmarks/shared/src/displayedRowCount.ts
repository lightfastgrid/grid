/**
 * LightFastGrid has no public displayed-row getter. `getRows()` / `getRowCount()`
 * are source-row APIs and stay wrong after Quick Search.
 *
 * Benchmark correctness reads the processed/display row model from the live
 * Grid instance via a harness-only adapter: TypeScript `private state` is still
 * a runtime field, and packed Core keeps `captureReadSnapshot().fullView.rowCount`
 * (pagination off ⇒ same universe as `rowView`). This is not a public Core API.
 *
 * Do not use this adapter to mutate loading, overlays, filters, search, or rows.
 * Do not fall back to `getRows().length`.
 *
 * `.lfg-grid-surface[aria-rowcount]` remains an accessibility surface. It can
 * stay stale after Worker Quick Search and must not be waited on inside
 * `durationMs`.
 */
export const LIGHTFASTGRID_BENCHMARK_HEADER_ROWS = 1;

type ProcessedRowView = {
  readonly rowCount?: unknown;
};

type LightFastGridStateLike = {
  captureReadSnapshot?: () => {
    readonly fullView?: ProcessedRowView;
    readonly currentPageView?: ProcessedRowView;
  };
  getSnapshot?: () => {
    readonly fullRowView?: ProcessedRowView;
    readonly rowView?: ProcessedRowView;
  };
};

type LightFastGridInstanceLike = {
  readonly state?: LightFastGridStateLike;
};

function rowCountFromView(view: ProcessedRowView | undefined): number | null {
  const count = view?.rowCount;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return null;
  }
  return count;
}

const MISSING_PROCESSED_COUNT =
  "LightFastGrid processed displayed-row count is unavailable from the live Grid instance. Core has no public displayed-row getter; this benchmark adapter requires GridState captureReadSnapshot().fullView.rowCount (or getSnapshot().rowView.rowCount). Do not use getRows().length.";

/**
 * Benchmark-only inspection of the current processed/display row count.
 * React and Vanilla must call this with the live Core `Grid` instance.
 */
export function readLightFastGridProcessedDisplayedRowCount(grid: unknown): number {
  const state = (grid as LightFastGridInstanceLike | null | undefined)?.state;
  const captured = state?.captureReadSnapshot?.();
  const capturedCount =
    rowCountFromView(captured?.fullView) ??
    rowCountFromView(captured?.currentPageView);
  if (capturedCount != null) return capturedCount;

  const snapshot = state?.getSnapshot?.();
  const snapshotCount =
    rowCountFromView(snapshot?.fullRowView) ??
    rowCountFromView(snapshot?.rowView);
  if (snapshotCount != null) return snapshotCount;

  throw new Error(MISSING_PROCESSED_COUNT);
}

/**
 * Accessibility displayed-row count from `.lfg-grid-surface[aria-rowcount]`.
 * Not used for timed Quick Search or protocol correctness.
 */
export function readLightFastGridDisplayedRowCount(
  host: HTMLElement | null,
): number {
  if (!host) {
    throw new Error("LightFastGrid host is not mounted");
  }
  const surface = host.querySelector(".lfg-grid-surface");
  const raw = surface?.getAttribute("aria-rowcount");
  const ariaRowCount = raw == null ? Number.NaN : Number(raw);
  if (!Number.isFinite(ariaRowCount) || ariaRowCount < LIGHTFASTGRID_BENCHMARK_HEADER_ROWS) {
    throw new Error(
      "LightFastGrid displayed row count is unavailable: .lfg-grid-surface[aria-rowcount] is missing or invalid",
    );
  }
  return ariaRowCount - LIGHTFASTGRID_BENCHMARK_HEADER_ROWS;
}
