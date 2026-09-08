import type { DemoGridGetter } from "../../runtime/types.ts";
import { el } from "../../shell/dom.ts";
import { bindFocusStealGuard,iconSearch } from "../../shell/ToolbarIcons.ts";

const SEARCH_DEBOUNCE_MS = 120;

/**
 * Mount the quick-search input with `setQuickFilterText`.
 * Vanilla DOM port of React DemoQuickSearch.tsx.
 */
export function mountDemoQuickSearch(
  host: HTMLElement,
  getGrid: DemoGridGetter,
): () => void {
  const cleanups: (() => void)[] = [];

  const label = el("label", "interactive-demo-search");
  const iconSpan = el("span", "interactive-demo-search-icon");
  iconSpan.setAttribute("aria-hidden", "true");
  iconSpan.append(iconSearch());
  label.append(iconSpan);

  const input = el("input");
  input.type = "search";
  input.placeholder = "Search...";
  input.autocomplete = "off";
  const unguard = bindFocusStealGuard(input);
  cleanups.push(unguard);

  let searchText = "";
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const onInput = () => {
    searchText = input.value;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const handle = getGrid();
      if (!handle) return;
      const keepFocus = document.activeElement === input;
      handle.setQuickFilterText(searchText);
      if (keepFocus) {
        input.focus({ preventScroll: true });
      }
    }, SEARCH_DEBOUNCE_MS);
  };
  input.addEventListener("input", onInput);
  cleanups.push(() => input.removeEventListener("input", onInput));
  label.append(input);

  const kbd = el("kbd", "interactive-demo-search-kbd", "⌘K");
  label.append(kbd);

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      input.focus();
    }
  };
  window.addEventListener("keydown", onKeyDown);
  cleanups.push(() => window.removeEventListener("keydown", onKeyDown));

  host.append(label);

  return () => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    for (const fn of cleanups) fn();
    label.remove();
  };
}
