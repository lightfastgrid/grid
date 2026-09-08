/**
 * Tooltip DOM element — plain text only.
 *
 * Creates a single `.lfg-tooltip` element. Content is set via `textContent`
 * (never `innerHTML`) so user-supplied strings cannot inject markup.
 */

import { applyTooltipElementSemantics } from "./tooltipSemantics";

const TOOLTIP_CLASS = "lfg-tooltip";

export function createTooltipElement(
  ownerDocument: Document,
  text: string,
  tooltipId: string,
): HTMLDivElement {
  if (ownerDocument.getElementById(tooltipId) !== null) {
    throw new Error("Tooltip id is already connected");
  }
  const el = ownerDocument.createElement("div");
  el.className = TOOLTIP_CLASS;
  el.textContent = text;
  applyTooltipElementSemantics(el, tooltipId);
  return el;
}
