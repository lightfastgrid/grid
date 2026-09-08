/** Minimum pointer movement (px) before a drag gesture activates. */
export const DRAG_START_THRESHOLD_PX = 5;

/**
 * Returns true once the pointer has moved far enough from the start point
 * to be considered an intentional drag.
 */
export function hasExceededDragThreshold(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
  threshold = DRAG_START_THRESHOLD_PX,
): boolean {
  return Math.hypot(clientX - startX, clientY - startY) >= threshold;
}

/**
 * Attaches pointermove / pointerup / pointercancel listeners to `document`
 * and returns a single cleanup function that removes all three.
 *
 * Call the returned function on pointerup, pointercancel, or detach to avoid
 * listener leaks.
 */
export function attachDragListeners(
  onMove: (e: PointerEvent) => void,
  onUp: (e: PointerEvent) => void,
  onCancel: (e: PointerEvent) => void,
): () => void {
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onCancel);
  return (): void => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
  };
}

/**
 * Installs a one-shot click suppressor on `root` so the click fired by the
 * browser immediately after a pointerup does not trigger selection/sort/etc.
 *
 * The suppressor auto-expires after `maxAgeMs` so a later intentional click
 * is never eaten when the browser does not synthesize a click (common after
 * drag release outside the original target).
 *
 * Returns a cleanup function that removes the listener early (e.g. when the
 * feature is detached before the click fires).
 */
export function suppressNextClick(
  root: HTMLElement,
  maxAgeMs = 400,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const handler = (e: MouseEvent): void => {
    cleanup();
    const t = e.target;
    if (!(t instanceof Node) || !root.contains(t)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  const cleanup = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    root.removeEventListener("click", handler, true);
  };
  root.addEventListener("click", handler, true);
  if (maxAgeMs > 0) {
    timer = setTimeout(cleanup, maxAgeMs);
  }
  return cleanup;
}
