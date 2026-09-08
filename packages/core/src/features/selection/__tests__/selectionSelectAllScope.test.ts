// @vitest-environment jsdom

/**
 * Select-all scope (`rowSelection.selectAllScope`).
 *
 * Header checkbox and Ctrl/Cmd+A share the same universe:
 * - "page" (default): currently displayed rows as explicit ids — never
 *   the store's `all` model when pagination is slicing.
 * - "all": the full matching, unpaginated universe; may use the `all`
 *   model. Counts/events/APIs reflect that universe.
 *
 * Sources stay distinct: header checkbox is `"click"`; Ctrl/Cmd+A is
 * `"keyboard"`. Keyboard works even when the header checkbox is off.
 */

import { describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import type {
  LightFastGridProps,
  LightFastGridSelectionChangedEvent,
  RowData,
  RowSelectionOptions,
} from "../../../types";

const cols = [{ field: "v", sortable: true }];

function makeRows(n: number): RowData[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, v: i }));
}

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function createPaginatedGrid(
  rowSelection: RowSelectionOptions,
  props: Partial<LightFastGridProps> = {},
) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "400px", width: "600px" });
  document.body.appendChild(container);

  const events: LightFastGridSelectionChangedEvent[] = [];
  const grid = new Grid({
    columns: cols,
    rows: makeRows(25),
    getRowId: (row) => row.id,
    pagination: true,
    paginationPageSize: 10,
    suppressRowVirtualization: true,
    rowSelection: {
      mode: "multiple",
      checkboxes: true,
      headerCheckbox: true,
      ...rowSelection,
    },
    onSelectionChanged: (e) => events.push(e),
    ...props,
  });
  grid.mount(container);
  await flushRenders();
  return { grid, container, events };
}

function headerCheckbox(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    ".lfg-header-selection-checkbox",
  );
  expect(input).not.toBeNull();
  return input!;
}

async function clickHeaderCheckbox(container: HTMLElement): Promise<void> {
  headerCheckbox(container).click();
  await Promise.resolve(); // post-native checkbox reconcile (microtask)
  await Promise.resolve(); // async selection event dispatch
}

const pageOneIds = makeRows(10).map((r) => String(r.id)); // r0..r9

describe("selectAllScope: page (default)", () => {
  it("default scope with pagination selects only the current page", async () => {
    const { grid, container, events } = await createPaginatedGrid({});

    await clickHeaderCheckbox(container);

    const ids = grid.getSelectedRowIds();
    expect(new Set(ids)).toEqual(new Set(pageOneIds));
    expect(grid.getSelectedRows()).toHaveLength(10);

    // Event reflects the page-scoped explicit selection.
    expect(events).toHaveLength(1);
    expect(events[0]!.selectedCount).toBe(10);
    expect(events[0]!.source).toBe("click");

    // Page 2: nothing selected, header unchecked.
    grid.nextPage();
    await flushRenders();
    expect(headerCheckbox(container).checked).toBe(false);
    expect(headerCheckbox(container).indeterminate).toBe(false);
    expect(
      grid.getSelectedRowIds().some((id) => !pageOneIds.includes(id)),
    ).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("explicit page scope: select page 1 only, page 2 stays unselected", async () => {
    const { grid, container } = await createPaginatedGrid({
      selectAllScope: "page",
    });

    await clickHeaderCheckbox(container);
    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(pageOneIds));
    expect(headerCheckbox(container).checked).toBe(true);

    // Selecting page 2 adds to the page-1 selection (explicit ids).
    grid.nextPage();
    await flushRenders();
    await clickHeaderCheckbox(container);
    expect(grid.getSelectedRowIds()).toHaveLength(20);

    // Unchecking on page 2 removes only page-2 ids.
    await clickHeaderCheckbox(container);
    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(pageOneIds));

    grid.destroy();
    container.remove();
  });

  it("page scope header state scans current page ids across navigation", async () => {
    const { grid, container } = await createPaginatedGrid({
      selectAllScope: "page",
    });

    // Select a strict subset of page 1 via the runtime API.
    grid.setSelectedRowIds(["r0", "r1"]);
    await flushRenders();
    grid.firstPage();
    await flushRenders();
    expect(headerCheckbox(container).checked).toBe(false);
    expect(headerCheckbox(container).indeterminate).toBe(true);

    // Page 2 contains none of the selected ids → fully unchecked, even
    // though the explicit id count (2) is unrelated to this page.
    grid.nextPage();
    await flushRenders();
    expect(headerCheckbox(container).checked).toBe(false);
    expect(headerCheckbox(container).indeterminate).toBe(false);

    grid.destroy();
    container.remove();
  });
});

describe("selectAllScope: all", () => {
  it("selects all rows across pages and reflects the full universe", async () => {
    const { grid, container, events } = await createPaginatedGrid({
      selectAllScope: "all",
    });

    await clickHeaderCheckbox(container);

    // Runtime APIs enumerate the whole universe, not just the page.
    const ids = grid.getSelectedRowIds();
    expect(ids).toHaveLength(25);
    expect(ids).toContain("r0");
    expect(ids).toContain("r24"); // page 3 row
    expect(grid.getSelectedRows()).toHaveLength(25);

    // Event selectedCount covers the full selected universe.
    expect(events).toHaveLength(1);
    expect(events[0]!.selectedCount).toBe(25);
    expect(events[0]!.changeKind).toBe("selectAll");

    // Page 2 appears selected by design: header checked.
    grid.nextPage();
    await flushRenders();
    expect(headerCheckbox(container).checked).toBe(true);
    expect(headerCheckbox(container).indeterminate).toBe(false);

    // Toggling off from page 2 clears everything.
    await clickHeaderCheckbox(container);
    expect(grid.getSelectedRowIds()).toEqual([]);
    expect(events[events.length - 1]!.selectedCount).toBe(0);

    grid.destroy();
    container.remove();
  });

  it("without pagination, page and all scopes behave the same", async () => {
    for (const selectAllScope of ["page", "all"] as const) {
      const { grid, container } = await createPaginatedGrid(
        { selectAllScope },
        { pagination: false },
      );

      await clickHeaderCheckbox(container);
      expect(grid.getSelectedRowIds()).toHaveLength(25);
      expect(headerCheckbox(container).checked).toBe(true);

      await clickHeaderCheckbox(container);
      expect(grid.getSelectedRowIds()).toEqual([]);

      grid.destroy();
      container.remove();
    }
  });
});

function pressSelectAll(
  container: HTMLElement,
  init: KeyboardEventInit = {},
): void {
  const surface = container.querySelector<HTMLElement>(".lfg-grid-surface");
  expect(surface).not.toBeNull();
  surface!.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      ...init,
    }),
  );
}

describe("Ctrl/Cmd+A honors selectAllScope", () => {
  it("keyboard + page scope selects only the current page with source keyboard", async () => {
    const { grid, container, events } = await createPaginatedGrid({
      selectAllScope: "page",
    });
    grid.setFocusedCell({ rowIndex: 0, field: "v" }, "keyboard");

    pressSelectAll(container);
    await Promise.resolve();
    await Promise.resolve();

    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(pageOneIds));
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("keyboard");
    expect(events[0]!.changeKind).toBe("selectAll");
    expect(events[0]!.selectedCount).toBe(10);
    expect(events[0]!.selectionType).toBe("explicit");

    grid.destroy();
    container.remove();
  });

  it("keyboard + all scope selects the unpaginated universe with source keyboard", async () => {
    const { grid, container, events } = await createPaginatedGrid({
      selectAllScope: "all",
    });
    grid.setFocusedCell({ rowIndex: 0, field: "v" }, "keyboard");

    pressSelectAll(container);
    await Promise.resolve();
    await Promise.resolve();

    expect(grid.getSelectedRowIds()).toHaveLength(25);
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("keyboard");
    expect(events[0]!.changeKind).toBe("selectAll");
    expect(events[0]!.selectedCount).toBe(25);
    expect(events[0]!.selectionType).toBe("all");

    grid.destroy();
    container.remove();
  });

  it("keyboard + page scope clears the current page and preserves other pages", async () => {
    const { grid, container, events } = await createPaginatedGrid({
      selectAllScope: "page",
    });
    grid.setFocusedCell({ rowIndex: 0, field: "v" }, "keyboard");

    await clickHeaderCheckbox(container);
    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(pageOneIds));
    expect(events[0]!.source).toBe("click");

    grid.nextPage();
    await flushRenders();
    await clickHeaderCheckbox(container);
    expect(grid.getSelectedRowIds()).toHaveLength(20);

    grid.setFocusedCell({ rowIndex: 0, field: "v" }, "keyboard");
    pressSelectAll(container);
    await Promise.resolve();
    await Promise.resolve();

    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(pageOneIds));
    const last = events[events.length - 1]!;
    expect(last.source).toBe("keyboard");
    expect(last.changeKind).toBe("clear");
    expect(last.selectedCount).toBe(10);
    expect(last.selectionType).toBe("explicit");

    grid.destroy();
    container.remove();
  });

  it("Ctrl/Cmd+A works without a header checkbox as long as mode is multiple", async () => {
    const { grid, container, events } = await createPaginatedGrid({
      mode: "multiple",
      checkboxes: false,
      headerCheckbox: false,
      selectAllScope: "page",
    });
    expect(
      container.querySelector(".lfg-header-selection-checkbox"),
    ).toBeNull();
    grid.setFocusedCell({ rowIndex: 0, field: "v" }, "keyboard");

    pressSelectAll(container, { ctrlKey: false, metaKey: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(pageOneIds));
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("keyboard");
    expect(events[0]!.selectedCount).toBe(10);

    grid.destroy();
    container.remove();
  });
});
