import {
  svgIcon,
  svgRectIcon,
} from "./dom.ts";
import { preventToolbarFocusSteal } from "./preventToolbarFocusSteal.ts";

export function iconPlus(): SVGSVGElement {
  return svgIcon(["M12 5v14", "M5 12h14"]);
}

export function iconChevronDown(): SVGSVGElement {
  return svgIcon(["m6 9 6 6 6-6"], { width: 12, height: 12 });
}

export function iconColumns(): SVGSVGElement {
  return svgRectIcon([
    { x: "3", y: "3", width: "7", height: "18", rx: "1" },
    { x: "14", y: "3", width: "7", height: "18", rx: "1" },
  ]);
}

export function iconFilters(): SVGSVGElement {
  return svgIcon(["M22 3H2l8 9.46V19l4 2v-8.54L22 3z"]);
}

export function iconSort(): SVGSVGElement {
  return svgIcon(["m3 8 4-4 4 4", "M7 4v16", "m21 16-4 4-4-4", "M17 20V4"]);
}

export function iconDensity(): SVGSVGElement {
  return svgIcon(["M4 6h16", "M4 12h16", "M4 18h16"]);
}

export function iconExport(): SVGSVGElement {
  return svgIcon([
    "M12 3v12",
    "m8 7 4-4 4 4",
    "M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  ]);
}

export function iconSearch(): SVGSVGElement {
  const svg = svgIcon(["m20 20-3.5-3.5"]);
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "11");
  circle.setAttribute("cy", "11");
  circle.setAttribute("r", "7");
  svg.insertBefore(circle, svg.firstChild);
  return svg;
}

export function iconSettings(): SVGSVGElement {
  return svgIcon([
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  ]);
}

export function iconFullscreen(): SVGSVGElement {
  return svgIcon([
    "M8 3H5a2 2 0 0 0-2 2v3",
    "M16 3h3a2 2 0 0 1 2 2v3",
    "M8 21H5a2 2 0 0 1-2-2v-3",
    "M16 21h3a2 2 0 0 0 2-2v-3",
  ]);
}

export function iconDownload(): SVGSVGElement {
  return svgIcon([
    "M12 3v12",
    "m8 11 4 4 4-4",
    "M4 19h16",
  ]);
}

export function iconExportChevron(): SVGSVGElement {
  return svgIcon(["m9 18 6-6-6-6"], { width: 12, height: 12 });
}

/** Attach mousedown prevent-focus-steal to a control. */
export function bindFocusStealGuard(node: HTMLElement): () => void {
  node.addEventListener("mousedown", preventToolbarFocusSteal);
  return () => node.removeEventListener("mousedown", preventToolbarFocusSteal);
}
