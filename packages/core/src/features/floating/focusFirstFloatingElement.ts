const INTERACTIVE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[tabindex]",
].join(",");

function isAvailableInteractiveElement(element: HTMLElement): boolean {
  if (element.tabIndex < 0) return false;
  if (element.hasAttribute("disabled")) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  return true;
}

/**
 * Focus freshly rendered floating content without overriding a renderer that
 * deliberately selected its own initial descendant.
 */
export function focusFirstFloatingElement(host: HTMLElement): boolean {
  const activeElement = host.ownerDocument.activeElement;
  if (activeElement !== null && host.contains(activeElement)) return true;

  const candidates = host.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR);
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    if (!isAvailableInteractiveElement(candidate)) continue;
    candidate.focus({ preventScroll: true });
    if (host.ownerDocument.activeElement === candidate) return true;
  }
  return false;
}
