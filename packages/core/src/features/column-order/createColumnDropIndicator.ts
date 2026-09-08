/**
 * Column-reorder drop indicator DOM.
 *
 * Mounted on `.lfg-grid-surface` so the rail can span header + body.
 * The rail is a flex column (cap → beam → cap) so the stroke can never
 * paint through the end rings.
 */

export type ColumnDropPlacement = "before" | "after";

export type ColumnDropIndicatorView = {
  root: HTMLDivElement;
  badge: HTMLElement;
  badgeTitle: HTMLElement;
  badgeDetail: HTMLElement;
  rail: HTMLElement;
  beam: HTMLElement;
  capStart: HTMLElement;
  capEnd: HTMLElement;
};

export type SyncColumnDropIndicatorOptions = {
  visible: boolean;
  /** Center X of the insertion seam, relative to the grid surface. */
  leftPx: number;
  /**
   * Top edge of the badge, relative to the grid surface.
   * Should sit in the upper-middle of the full header band (leaf + filters).
   */
  badgeTopPx: number;
  placement: ColumnDropPlacement;
  title?: string;
  detail?: string;
  statusText?: string;
};

const ROOT_CLASS = "lfg-column-drop-indicator";

export function createColumnDropIndicator(): ColumnDropIndicatorView {
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-atomic", "true");
  root.style.display = "none";

  // Flex column: top ring, growing beam, bottom ring — no absolute overlap.
  const rail = document.createElement("div");
  rail.className = "lfg-column-drop-indicator-rail";
  rail.setAttribute("aria-hidden", "true");

  const capStart = document.createElement("span");
  capStart.className =
    "lfg-column-drop-indicator-cap lfg-column-drop-indicator-cap-start";

  const beam = document.createElement("span");
  beam.className = "lfg-column-drop-indicator-beam";

  const capEnd = document.createElement("span");
  capEnd.className =
    "lfg-column-drop-indicator-cap lfg-column-drop-indicator-cap-end";

  rail.append(capStart, beam, capEnd);

  const badge = document.createElement("div");
  badge.className = "lfg-column-drop-indicator-badge";
  badge.setAttribute("aria-hidden", "true");

  const icon = document.createElement("span");
  icon.className = "lfg-column-drop-indicator-badge-icon";

  const text = document.createElement("span");
  text.className = "lfg-column-drop-indicator-badge-text";

  const badgeTitle = document.createElement("span");
  badgeTitle.className = "lfg-column-drop-indicator-badge-title";
  badgeTitle.textContent = "Insert";

  const badgeDetail = document.createElement("span");
  badgeDetail.className = "lfg-column-drop-indicator-badge-detail";

  text.append(badgeTitle, badgeDetail);
  badge.append(icon, text);
  root.append(rail, badge);

  return {
    root,
    badge,
    badgeTitle,
    badgeDetail,
    rail,
    beam,
    capStart,
    capEnd,
  };
}

export function syncColumnDropIndicator(
  view: ColumnDropIndicatorView,
  opts: SyncColumnDropIndicatorOptions,
): void {
  const { root, badge, badgeTitle, badgeDetail } = view;

  if (!opts.visible) {
    root.style.display = "none";
    root.removeAttribute("data-placement");
    root.removeAttribute("data-active");
    root.style.removeProperty("--lfg-column-drop-badge-y");
    badge.style.removeProperty("top");
    return;
  }

  // Prefer caller Y; keep a modest floor so 0 never pins to the rim.
  const badgeTop = Math.max(opts.badgeTopPx, 12);

  root.style.display = "block";
  root.style.left = `${opts.leftPx}px`;
  root.dataset.placement = opts.placement;
  root.dataset.active = "true";

  root.style.setProperty("--lfg-column-drop-badge-y", `${badgeTop}px`);
  badge.style.top = `${badgeTop}px`;

  const title = opts.title ?? "Insert";
  const detail = opts.detail ?? "";
  if (badgeTitle.textContent !== title) badgeTitle.textContent = title;
  if (badgeDetail.textContent !== detail) badgeDetail.textContent = detail;
  badgeDetail.hidden = detail.length === 0;

  const status =
    opts.statusText ?? (detail ? `${title} ${detail}` : title);
  root.setAttribute("aria-label", status);
}
