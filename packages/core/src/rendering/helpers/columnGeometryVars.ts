/**
 * Column geometry via CSS variables.
 *
 * Each column field gets two CSS custom properties on the grid root:
 *   --col-{token}-left  (px)
 *   --col-{token}-width (px)
 *
 * A <style> element under the grid root maps [data-col-id] attribute
 * selectors to those variables, so cells and header cells auto-position
 * without any inline style.left / style.width writes.
 */

import type { ColumnDef } from "../../types";

const STYLE_ATTR = "data-lfg-col-geo";

/** Convert a field name to a token safe for CSS custom property names. */
export function fieldToCssToken(field: string): string {
  return field.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Escape a string for use inside a CSS `[attr="..."]` selector. */
function escapeCssAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Create or update a `<style>` that maps every column's `data-col-id`
 * to CSS-variable-driven `left` and `width`.
 *
 * Call once on structural column changes (field add/remove/reorder).
 * Width changes are handled purely by updating the CSS variables —
 * this style element does NOT need updating for width-only changes.
 */
export function syncColumnGeometryStyle(
  root: HTMLElement,
  columns: ColumnDef[],
): void {
  let styleEl = root.querySelector<HTMLStyleElement>(
    `style[${STYLE_ATTR}]`,
  );
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.setAttribute(STYLE_ATTR, "");
    root.prepend(styleEl);
  }

  let css = "";
  for (const col of columns) {
    const token = fieldToCssToken(col.field);
    const escaped = escapeCssAttrValue(col.field);
    css += `.lfg-cell[data-col-id="${escaped}"],.lfg-header-cell[data-col-id="${escaped}"],.lfg-floating-filter-cell[data-col-id="${escaped}"]{left:var(--col-${token}-left);width:var(--col-${token}-width)}\n`;
  }
  styleEl.textContent = css;
}
