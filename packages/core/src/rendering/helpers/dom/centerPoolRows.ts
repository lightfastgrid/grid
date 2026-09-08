import { CSS } from "../../const/css-classes";

/**
 * Center (non-pinned) pool rows — direct `.lfg-row` children of the scroll
 * container. Accepts any `Element` (only `querySelector*` is used) so callers
 * passing a `root.querySelector(...)` result need no cast.
 */
export function queryCenterPoolRows(
  scrollContainer: Element,
): HTMLElement[] {
  const rowSelector = `:scope > .${CSS.ROW}:not([style*="display: none"])`;
  return Array.from(scrollContainer.querySelectorAll<HTMLElement>(rowSelector));
}
