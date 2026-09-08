import { useEffect, useId, useRef, useState } from "react";

import type { DemoGridGetter } from "../../runtime/types.ts";
import { IconSearch } from "../../shell/ToolbarIcons.tsx";

const SEARCH_DEBOUNCE_MS = 120;

type DemoQuickSearchProps = {
  getGrid: DemoGridGetter;
  /** Challenge choreography only; never writes through to the grid. */
  visualValue?: string;
};

/** Runtime: `setQuickFilterText` only. */
export function DemoQuickSearch({ getGrid, visualValue }: DemoQuickSearchProps) {
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (visualValue !== undefined) return;
    const handle = getGrid();
    if (!handle) return;
    const timer = window.setTimeout(() => {
      const keepFocus = document.activeElement === searchRef.current;
      handle.setQuickFilterText(searchText);
      // Quick-search DOM sync can recycle grid widgets and restore surface
      // focus; put the caret back when the user was still typing here.
      if (keepFocus) {
        searchRef.current?.focus({ preventScroll: true });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [getGrid, searchText, visualValue]);

  return (
    <label className="interactive-demo-search" htmlFor={searchId}>
      <span className="interactive-demo-search-icon" aria-hidden="true">
        <IconSearch />
      </span>
      <input
        ref={searchRef}
        id={searchId}
        type="search"
        value={visualValue ?? searchText}
        placeholder="Search..."
        autoComplete="off"
        onChange={(event) => setSearchText(event.target.value)}
        data-demo-anchor="search"
      />
      <kbd className="interactive-demo-search-kbd">⌘K</kbd>
    </label>
  );
}
