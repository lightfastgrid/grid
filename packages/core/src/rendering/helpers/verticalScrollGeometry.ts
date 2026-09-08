export interface VerticalContentGeometry {
  centerRowCount: number;
  rowHeight: number;
  headerHeight: number;
  headerAddonHeight: number;
  topPinnedHeight: number;
  bottomPinnedHeight: number;
}

export interface VerticalScrollClampInput extends VerticalContentGeometry {
  previousCenterRowCount: number;
  currentScrollTop: number;
  cachedViewportHeight: number;
}

/** Shared vertical content-height contract for the scroll container. */
export function calculateVerticalContentHeight(
  geometry: VerticalContentGeometry,
): number {
  return geometry.headerHeight
    + geometry.headerAddonHeight
    + geometry.topPinnedHeight
    + geometry.centerRowCount * geometry.rowHeight
    + geometry.bottomPinnedHeight;
}

/**
 * Return the largest valid vertical scroll offset for known geometry.
 *
 * A non-positive or non-finite cached viewport height means the mount/resize
 * measurement is not available yet. Returning zero is the conservative
 * deterministic fallback: a row-count reduction cannot leave the viewport
 * below the new content while geometry is temporarily unknown.
 */
export function calculateMaximumValidScrollTop(
  geometry: VerticalContentGeometry,
  cachedViewportHeight: number,
): number {
  if (!(cachedViewportHeight > 0) || !Number.isFinite(cachedViewportHeight)) {
    return 0;
  }
  return Math.max(
    0,
    calculateVerticalContentHeight(geometry) - cachedViewportHeight,
  );
}

/** Preserve valid positions; reset stale out-of-range positions to the top. */
export function clampScrollTopAfterRowCountReduction(
  input: VerticalScrollClampInput,
): number {
  const currentScrollTop = Math.max(0, input.currentScrollTop);
  if (input.centerRowCount >= input.previousCenterRowCount) {
    return currentScrollTop;
  }
  const maximumScrollTop = calculateMaximumValidScrollTop(
    input,
    input.cachedViewportHeight,
  );
  return currentScrollTop <= maximumScrollTop ? currentScrollTop : 0;
}
