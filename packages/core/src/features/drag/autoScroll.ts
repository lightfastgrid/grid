import type { AutoScrollAxis } from "./types";

export interface AutoScrollOptions {
  /** Element whose scrollLeft / scrollTop is mutated. */
  getViewport: () => HTMLElement | null;
  /** Which axis (or both) to auto-scroll. */
  axis: AutoScrollAxis;
  /** Current pointer position — read each rAF tick so it stays fresh. */
  getClientPos: () => { x: number; y: number };
  /**
   * Return false to stop the loop (e.g. when drag is no longer active).
   * The loop also stops when getViewport() returns null.
   */
  shouldContinue: () => boolean;
  /** Pixels from the edge that trigger scrolling. Default: 80. */
  zoneSize?: number;
  /** Maximum scroll delta per frame when pointer is at the very edge. Default: 20. */
  maxSpeed?: number;
}

const DEFAULT_ZONE = 80;
const DEFAULT_SPEED = 20;

function edgeDelta(
  distToNearEdge: number,
  distToFarEdge: number,
  zone: number,
  speed: number,
): number {
  if (distToNearEdge > 0 && distToNearEdge < zone) {
    return Math.round((1 - distToNearEdge / zone) * speed);
  }
  if (distToFarEdge > 0 && distToFarEdge < zone) {
    return -Math.round((1 - distToFarEdge / zone) * speed);
  }
  return 0;
}

/**
 * Starts an rAF-based auto-scroll loop. Scrolls `getViewport()` along the
 * requested axis when the pointer is within `zoneSize` px of the viewport edge.
 * Speed increases linearly as the pointer approaches the edge.
 *
 * Returns a stop function — call it on pointerup, pointercancel, or detach.
 * The loop also self-stops when `shouldContinue()` returns false.
 */
export function startAutoScroll(opts: AutoScrollOptions): () => void {
  const zone = opts.zoneSize ?? DEFAULT_ZONE;
  const speed = opts.maxSpeed ?? DEFAULT_SPEED;
  let rafId: number | null = null;

  const tick = (): void => {
    const vp = opts.getViewport();
    if (!vp || !opts.shouldContinue()) {
      rafId = null;
      return;
    }

    const rect = vp.getBoundingClientRect();
    const { x: px, y: py } = opts.getClientPos();
    const { axis } = opts;

    if (axis === "x" || axis === "both") {
      const delta = edgeDelta(
        rect.right - px,
        px - rect.left,
        zone,
        speed,
      );
      if (delta !== 0) vp.scrollLeft = Math.max(0, vp.scrollLeft + delta);
    }

    if (axis === "y" || axis === "both") {
      const delta = edgeDelta(
        rect.bottom - py,
        py - rect.top,
        zone,
        speed,
      );
      if (delta !== 0) vp.scrollTop = Math.max(0, vp.scrollTop + delta);
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
}
