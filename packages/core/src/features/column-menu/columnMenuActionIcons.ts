/**
 * Lightweight Lucide-style stroke icons for built-in column-menu actions.
 *
 * Paths are copied from Lucide (ISC) and rendered as inline SVG — no icon
 * package, no absolute asset URLs, no sprite sheets.
 *
 * Mapping (Lucide names):
 * - sort-asc → arrow-up-narrow-wide
 * - sort-desc → arrow-down-wide-narrow
 * - sort-clear → x
 * - pin-left / pin-right → pin (orientation via CSS)
 * - unpin → pin-off
 * - hide-column → eye-off
 * - auto-size-column → move-horizontal
 * - auto-size-selected-columns → maximize-2
 * - size-columns-to-fit → columns-3
 * - size-selected-columns-to-fit → between-horizontal-start
 * - reset-column-widths → rotate-ccw
 */

const SVG_NS = "http://www.w3.org/2000/svg";

type IconPath = { d: string };
type IconRect = {
  x: string;
  y: string;
  width: string;
  height: string;
  rx?: string;
};
type IconNode = IconPath | IconRect;

function isRect(node: IconNode): node is IconRect {
  return "width" in node;
}

/** Lucide path/rect nodes keyed by `data-menu-action`. */
const COLUMN_MENU_ACTION_ICONS: Readonly<Record<string, readonly IconNode[]>> = {
  "sort-asc": [
    { d: "m3 8 4-4 4 4" },
    { d: "M7 4v16" },
    { d: "M11 12h4" },
    { d: "M11 16h7" },
    { d: "M11 20h10" },
  ],
  "sort-desc": [
    { d: "m3 16 4 4 4-4" },
    { d: "M7 20V4" },
    { d: "M11 4h10" },
    { d: "M11 8h7" },
    { d: "M11 12h4" },
  ],
  "sort-clear": [
    { d: "M18 6 6 18" },
    { d: "m6 6 12 12" },
  ],
  "pin-left": [
    { d: "M12 17v5" },
    {
      d: "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
    },
  ],
  "pin-right": [
    { d: "M12 17v5" },
    {
      d: "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
    },
  ],
  unpin: [
    { d: "M12 17v5" },
    { d: "M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" },
    { d: "m2 2 20 20" },
    {
      d: "M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11",
    },
  ],
  "hide-column": [
    {
      d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
    },
    { d: "M14.084 14.158a3 3 0 0 1-4.242-4.242" },
    {
      d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
    },
    { d: "m2 2 20 20" },
  ],
  "auto-size-column": [
    { d: "m18 8 4 4-4 4" },
    { d: "M2 12h20" },
    { d: "m6 8-4 4 4 4" },
  ],
  "auto-size-selected-columns": [
    { d: "M15 3h6v6" },
    { d: "m21 3-7 7" },
    { d: "m3 21 7-7" },
    { d: "M9 21H3v-6" },
  ],
  "size-columns-to-fit": [
    { x: "3", y: "3", width: "18", height: "18", rx: "2" },
    { d: "M9 3v18" },
    { d: "M15 3v18" },
  ],
  "size-selected-columns-to-fit": [
    { x: "8", y: "3", width: "13", height: "7", rx: "1" },
    { d: "m2 9 3 3-3 3" },
    { x: "8", y: "14", width: "13", height: "7", rx: "1" },
  ],
  "reset-column-widths": [
    { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" },
    { d: "M3 3v5h5" },
  ],
};

/** Create a 16×16 Lucide stroke SVG for a built-in column-menu action, or null. */
export function createColumnMenuActionIcon(
  actionId: string,
): SVGSVGElement | null {
  const nodes = COLUMN_MENU_ACTION_ICONS[actionId];
  if (!nodes) return null;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("lfg-column-menu-icon-svg");

  for (const node of nodes) {
    if (isRect(node)) {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", node.x);
      rect.setAttribute("y", node.y);
      rect.setAttribute("width", node.width);
      rect.setAttribute("height", node.height);
      if (node.rx) rect.setAttribute("rx", node.rx);
      svg.appendChild(rect);
      continue;
    }
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", node.d);
    svg.appendChild(path);
  }

  return svg;
}

/** Replace glyph text with Lucide SVGs on built-in column-menu items. */
export function applyColumnMenuActionIcons(
  panel: HTMLElement,
  iconSelector = ".lfg-column-menu-icon",
): void {
  const items = panel.querySelectorAll<HTMLElement>("[data-menu-action]");
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const actionId = item.getAttribute("data-menu-action");
    if (!actionId) continue;
    const svg = createColumnMenuActionIcon(actionId);
    if (!svg) continue;
    const icon = item.querySelector(iconSelector);
    if (!(icon instanceof HTMLElement)) continue;
    icon.textContent = "";
    icon.appendChild(svg);
  }
}
