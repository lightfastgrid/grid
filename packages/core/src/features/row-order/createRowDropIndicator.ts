/**
 * Row-reorder drop indicator DOM.
 *
 * Mounted on `.lfg-grid-surface` so one horizontal rail can span
 * left-pinned + center + right-pinned lanes. Flex row (cap → beam → cap)
 * so the stroke never paints through the end rings. No badge — caps only.
 */

export type RowDropPlacement = "before" | "after";

export type RowDropIndicatorView = {
  root: HTMLDivElement;
  rail: HTMLElement;
  beam: HTMLElement;
  capStart: HTMLElement;
  capEnd: HTMLElement;
};

export type SyncRowDropIndicatorOptions = {
  visible: boolean;
  /** Seam Y relative to the grid surface (top edge of the indicator). */
  topPx: number;
  placement: RowDropPlacement;
  statusText?: string;
};

const ROOT_CLASS = "lfg-row-drop-indicator";

export function createRowDropIndicator(): RowDropIndicatorView {
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-atomic", "true");
  root.style.display = "none";

  const rail = document.createElement("div");
  rail.className = "lfg-row-drop-indicator-rail";
  rail.setAttribute("aria-hidden", "true");

  const capStart = document.createElement("span");
  capStart.className =
    "lfg-row-drop-indicator-cap lfg-row-drop-indicator-cap-start";

  const beam = document.createElement("span");
  beam.className = "lfg-row-drop-indicator-beam";

  const capEnd = document.createElement("span");
  capEnd.className =
    "lfg-row-drop-indicator-cap lfg-row-drop-indicator-cap-end";

  rail.append(capStart, beam, capEnd);
  root.append(rail);

  return {
    root,
    rail,
    beam,
    capStart,
    capEnd,
  };
}

export function syncRowDropIndicator(
  view: RowDropIndicatorView,
  opts: SyncRowDropIndicatorOptions,
): void {
  const { root } = view;

  if (!opts.visible) {
    root.style.display = "none";
    root.removeAttribute("data-placement");
    root.removeAttribute("data-active");
    root.style.removeProperty("top");
    return;
  }

  root.style.display = "block";
  root.style.top = `${opts.topPx}px`;
  root.dataset.placement = opts.placement;
  root.dataset.active = "true";
  root.setAttribute(
    "aria-label",
    opts.statusText ??
      (opts.placement === "after" ? "Drop after row" : "Drop before row"),
  );
}
