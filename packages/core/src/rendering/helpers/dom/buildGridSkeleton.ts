// ─── dom/buildGridSkeleton.ts — grid shell DOM (root, viewport, scroll, header) ───
//
// Scroll container holds:
//   1) Column header (.lfg-header) — CSS position: sticky; top: 0 pins it to
//      the viewport while vertically scrolling; it shares min-width with rows
//      so horizontal scroll keeps headers aligned with cells.
//   2) Pooled data rows (.lfg-row) — absolutely positioned + translateY.

import { applyGridTheme } from "../../../themes";
import type { ResolvedGridTheme } from "../../../themes/types";
import type { GridSkeleton } from "../../../types";
import { CSS } from "../../const/css-classes";

import { createDiv } from "./createDomElement";

export function buildGridSkeleton(resolved: ResolvedGridTheme): GridSkeleton {
  // 1. Root — outer layout and delegated-listener host. It owns no grid role
  // and no tabindex; those belong to the neutral surface below.
  const root = createDiv(CSS.GRID, undefined, {
    [CSS.GRID_THEME]: resolved.dataTheme,
  });
  applyGridTheme(root, resolved);

  // 2. Grid surface — the neutral, viewport-only composite-grid boundary. The
  // accessibility plugin owns `role="grid"` and composite ARIA here; the base
  // skeleton owns the focus tabindex. Auxiliary layers (pagination, overlay,
  // floating popups, root controls) stay outside it as siblings under the root.
  const surface = createDiv(CSS.GRID_SURFACE);
  /** Focus target for grid-level keyboard handling (e.g. Escape) after pointer interaction. */
  surface.tabIndex = 0;

  // 3. Viewport — the scrollable window (overflow: auto)
  const viewport = createDiv(CSS.VIEWPORT);

  // 4. Scroll container — tall div inside viewport
  const scrollContainer = createDiv(CSS.SCROLL_CONTAINER);

  // 5. Header — first child; sticky top (see default.css). `role="rowgroup"`
  // is applied by the accessibility plugin.
  const header = createDiv(CSS.HEADER);

  scrollContainer.appendChild(header);
  viewport.appendChild(scrollContainer);
  surface.appendChild(viewport);
  root.appendChild(surface);

  return { root, surface, header, viewport, scrollContainer };
}
