/** Settings panel icons — vanilla SVG port of React settingsPanelIcons.tsx */

import { svgIcon } from "../../shell/dom.ts";

const ICON_OPTS = { width: 14, height: 14 } as const;

function withStrokeWidth(svg: SVGSVGElement, width: number): SVGSVGElement {
  svg.setAttribute("stroke-width", String(width));
  return svg;
}

export function iconGroupedHeaders(): SVGSVGElement {
  return withStrokeWidth(
    svgIcon(
      ["M12 3 4 7v10l8 4 8-4V7l-8-4Z", "M12 12 4 8", "m12 12 8-4", "M12 12v10"],
      ICON_OPTS,
    ),
    1.75,
  );
}

export function iconFloatingFilters(): SVGSVGElement {
  return withStrokeWidth(
    svgIcon(
      [
        "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
        "M3.3 7 12 12l8.7-5",
        "M12 22V12",
      ],
      ICON_OPTS,
    ),
    1.75,
  );
}

export function iconPagination(): SVGSVGElement {
  return withStrokeWidth(
    svgIcon(
      ["M12 2 4 6l8 4 8-4-8-4Z", "m4 12 8 4 8-4", "m4 18 8 4 8-4"],
      ICON_OPTS,
    ),
    1.75,
  );
}

export function iconThemeLight(): SVGSVGElement {
  const svg = withStrokeWidth(
    svgIcon(
      [
        "M12 2v2",
        "M12 20v2",
        "m4.9 4.9 1.4 1.4",
        "m17.7 17.7 1.4 1.4",
        "M2 12h2",
        "M20 12h2",
        "m4.9 19.1 1.4-1.4",
        "m17.7 6.3 1.4-1.4",
      ],
      ICON_OPTS,
    ),
    1.75,
  );
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "4");
  svg.insertBefore(circle, svg.firstChild);
  return svg;
}

export function iconThemeDark(): SVGSVGElement {
  return withStrokeWidth(
    svgIcon(["M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"], ICON_OPTS),
    1.75,
  );
}

export function iconThemeSystem(): SVGSVGElement {
  const svg = withStrokeWidth(
    svgIcon(["M12 3v18", "M12 3a9 9 0 0 1 0 18"], ICON_OPTS),
    1.75,
  );
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "9");
  svg.insertBefore(circle, svg.firstChild);
  return svg;
}

export function iconResetDemo(): SVGSVGElement {
  return withStrokeWidth(
    svgIcon(["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"], ICON_OPTS),
    1.75,
  );
}
