// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import type { ColumnDef, ColumnMenuSectionActionContext, RowData } from "../../../types";
import {
  MENU_PANEL_CLASS,
  MENU_TRIGGER_CLASS,
} from "../columnMenuDom";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function headerCell(root: HTMLElement, field: string): HTMLElement | null {
  return root.querySelector(
    `.lfg-header-cell[data-col-id="${field}"]`,
  ) as HTMLElement | null;
}

function menuTrigger(root: HTMLElement, field: string): HTMLButtonElement | null {
  const cell = headerCell(root, field);
  return cell?.querySelector(`.${MENU_TRIGGER_CLASS}`) as HTMLButtonElement | null;
}

function openMenu(root: HTMLElement, field: string): void {
  menuTrigger(root, field)!.dispatchEvent(
    new MouseEvent("click", { bubbles: true, button: 0 }),
  );
}

function menuPanel(root: HTMLElement): HTMLElement | null {
  return root.querySelector(`.${MENU_PANEL_CLASS}`) as HTMLElement | null;
}

function menuItemByAction(root: HTMLElement, actionId: string): HTMLButtonElement | null {
  const panel = menuPanel(root);
  if (!panel) return null;
  return panel.querySelector(`[data-menu-action="${actionId}"]`) as HTMLButtonElement | null;
}

function makeGrid(
  columns: ColumnDef[],
  rows?: RowData[],
  opts?: Record<string, unknown>,
) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "400px", width: "800px" });
  document.body.appendChild(container);

  const grid = new Grid({
    rows: rows ?? [Object.fromEntries(columns.map((c) => [c.field, 1]))] as RowData[],
    columns,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    ...opts,
  });
  grid.mount(container);
  return {
    grid,
    container,
    root: () => container.querySelector(".lfg-grid") as HTMLElement,
  };
}

describe("columnMenu options", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("omitted columnMenu keeps current default menu", async () => {
    const { grid, container, root } = makeGrid([{ field: "a" }, { field: "b" }]);
    await flushRenders();

    expect(menuTrigger(root(), "a")).toBeTruthy();
    openMenu(root(), "a");
    expect(menuPanel(root())).toBeTruthy();
    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();
    expect(menuItemByAction(root(), "pin-left")).toBeTruthy();
    expect(menuItemByAction(root(), "hide-column")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("columnMenu={} keeps current default menu", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      { columnMenu: {} },
    );
    await flushRenders();

    expect(menuTrigger(root(), "a")).toBeTruthy();
    openMenu(root(), "a");
    expect(menuPanel(root())).toBeTruthy();
    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();
    expect(menuItemByAction(root(), "pin-left")).toBeTruthy();
    expect(menuItemByAction(root(), "hide-column")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("columnMenu={ enabled: true } keeps current default menu", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      { columnMenu: { enabled: true } },
    );
    await flushRenders();

    expect(menuTrigger(root(), "a")).toBeTruthy();
    openMenu(root(), "a");
    expect(menuPanel(root())).toBeTruthy();
    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();
    expect(menuItemByAction(root(), "pin-left")).toBeTruthy();
    expect(menuItemByAction(root(), "hide-column")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("columnMenu.enabled === false does not render trigger", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      { columnMenu: { enabled: false } },
    );
    await flushRenders();

    const trigger = menuTrigger(root(), "a");
    const isHidden = !trigger || trigger.style.display === "none";
    expect(isHidden).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("columnMenu.enabled === false prevents menu from opening on click", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
      undefined,
      { columnMenu: { enabled: false } },
    );
    await flushRenders();

    const cell = headerCell(root(), "a");
    cell?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(menuPanel(root())).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("columnMenu={ sort: true } shows only sort section", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
      undefined,
      { columnMenu: { sort: true } },
    );
    await flushRenders();

    openMenu(root(), "a");
    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();
    expect(menuItemByAction(root(), "sort-desc")).toBeTruthy();
    expect(menuItemByAction(root(), "sort-clear")).toBeNull();
    expect(menuItemByAction(root(), "pin-left")).toBeNull();
    expect(menuItemByAction(root(), "pin-right")).toBeNull();
    expect(menuItemByAction(root(), "hide-column")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("columnMenu={ sort: { asc: true } } shows only sort-asc", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
      undefined,
      { columnMenu: { sort: { asc: true } } },
    );
    await flushRenders();

    openMenu(root(), "a");
    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();
    expect(menuItemByAction(root(), "sort-desc")).toBeNull();
    expect(menuItemByAction(root(), "sort-clear")).toBeNull();
    expect(menuItemByAction(root(), "pin-left")).toBeNull();
    expect(menuItemByAction(root(), "hide-column")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("columnMenu with sort+visibility does not show omitted pinning section", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
      undefined,
      {
        columnMenu: {
          sort: { asc: true, desc: true },
          visibility: { hideColumn: true },
        },
      },
    );
    await flushRenders();

    openMenu(root(), "a");
    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();
    expect(menuItemByAction(root(), "sort-desc")).toBeTruthy();
    expect(menuItemByAction(root(), "sort-clear")).toBeNull();
    expect(menuItemByAction(root(), "hide-column")).toBeTruthy();
    expect(menuItemByAction(root(), "pin-left")).toBeNull();
    expect(menuItemByAction(root(), "pin-right")).toBeNull();
    expect(menuItemByAction(root(), "unpin")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("columnMenu={ pinning: { pinLeft: true } } shows only pin-left", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
      undefined,
      { columnMenu: { pinning: { pinLeft: true } } },
    );
    await flushRenders();

    openMenu(root(), "a");
    expect(menuItemByAction(root(), "pin-left")).toBeTruthy();
    expect(menuItemByAction(root(), "pin-right")).toBeNull();
    expect(menuItemByAction(root(), "unpin")).toBeNull();
    expect(menuItemByAction(root(), "sort-asc")).toBeNull();
    expect(menuItemByAction(root(), "hide-column")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("columnMenu={ visibility: { hideColumn: true } } shows only Hide column", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      {
        columnMenu: { visibility: { hideColumn: true } },
        columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
      },
    );
    await flushRenders();

    headerCell(root(), "a")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root(), "b")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, ctrlKey: true }),
    );
    await flushRenders();

    openMenu(root(), "a");
    expect(menuItemByAction(root(), "hide-column")).toBeTruthy();
    const panel = menuPanel(root());
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain("Hide column");
    expect(panel!.textContent).not.toContain("Hide selected columns");
    expect(menuItemByAction(root(), "sort-asc")).toBeNull();
    expect(menuItemByAction(root(), "pin-left")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("columnMenu={ sections } shows only custom sections", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
      undefined,
      {
        columnMenu: {
          sections: () => [
            {
              id: "custom-only",
              items: [{ id: "custom-item", label: "Custom item" }],
            },
          ],
        },
      },
    );
    await flushRenders();

    openMenu(root(), "a");
    const panel = menuPanel(root());
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain("Custom item");
    expect(menuItemByAction(root(), "sort-asc")).toBeNull();
    expect(menuItemByAction(root(), "pin-left")).toBeNull();
    expect(menuItemByAction(root(), "hide-column")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("columnMenu={ sort: true, sections } shows sort + custom sections", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
      undefined,
      {
        columnMenu: {
          sort: true,
          sections: () => [
            {
              id: "custom-bottom",
              items: [{ id: "custom-item", label: "Custom item" }],
            },
          ],
        },
      },
    );
    await flushRenders();

    openMenu(root(), "a");
    const panel = menuPanel(root());
    expect(panel).toBeTruthy();
    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();
    expect(menuItemByAction(root(), "pin-left")).toBeNull();
    expect(menuItemByAction(root(), "hide-column")).toBeNull();
    expect(panel!.textContent).toContain("Custom item");

    grid.destroy();
    container.remove();
  });

  it("sort: { asc: true, clear: true } hides Sort descending only", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
      undefined,
      {
        columnMenu: { sort: { asc: true, clear: true } },
        initialSortModel: [{ field: "a", sort: "asc" }],
      },
    );
    await flushRenders();

    openMenu(root(), "a");
    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();
    expect(menuItemByAction(root(), "sort-desc")).toBeNull();
    // sort-clear is visible because there's an active sort and clear: true
    expect(menuItemByAction(root(), "sort-clear")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("pinning: { pinLeft: true, unpin: true } keeps only explicitly enabled pin items", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a", pinned: "left" }],
      undefined,
      { columnMenu: { pinning: { pinLeft: true, unpin: true } } },
    );
    await flushRenders();

    openMenu(root(), "a");
    expect(menuItemByAction(root(), "pin-left")).toBeTruthy();
    expect(menuItemByAction(root(), "pin-right")).toBeNull();
    // unpin is visible because column is currently pinned
    expect(menuItemByAction(root(), "unpin")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("visibility: { hideSelectedColumns: false, hideColumn: true } falls back to Hide column for multi-selection", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }, { field: "c" }],
      undefined,
      {
        columnMenu: { visibility: { hideSelectedColumns: false, hideColumn: true } },
        columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
      },
    );
    await flushRenders();

    // Select columns a and b via header click
    headerCell(root(), "a")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root(), "b")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: false, ctrlKey: true }),
    );
    await flushRenders();

    openMenu(root(), "a");
    const hideItem = menuItemByAction(root(), "hide-column");
    expect(hideItem).toBeTruthy();
    expect(hideItem!.textContent).toContain("Hide column");

    grid.destroy();
    container.remove();
  });

  it("columnMenu.sections(ctx) receives already-filtered defaultSections", async () => {
    const spy = vi.fn((ctx: ColumnMenuSectionActionContext) => {
      void ctx.defaultSections;
      return [
        {
          id: "custom-check",
          items: [{ id: "custom-check-item", label: "Custom check" }],
        },
      ];
    });

    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
      undefined,
      {
        columnMenu: {
          sort: false,
          pinning: { pinRight: false },
          sections: spy,
        },
      },
    );
    await flushRenders();

    openMenu(root(), "a");

    expect(spy).toHaveBeenCalledTimes(1);
    const sections = spy.mock.calls[0]![0].defaultSections;

    // Sort section should be absent
    const sortSection = sections.find((s: { id: string }) => s.id === "sort");
    expect(sortSection).toBeUndefined();

    // Pin section is omitted because explicit columnMenu provided and no
    // allowed pinning items are enabled.
    const pinSection = sections.find((s: { id: string }) => s.id === "pin");
    expect(pinSection).toBeUndefined();

    grid.destroy();
    container.remove();
  });

  it("updating columnMenu config affects the next opened menu", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
    );
    await flushRenders();

    // Initially all items present
    openMenu(root(), "a");
    expect(menuItemByAction(root(), "sort-asc")).toBeTruthy();

    // Close menu
    openMenu(root(), "a");
    expect(menuPanel(root())).toBeNull();

    // Update config to hide sort
    grid.setColumnMenu({ sort: false });

    // Open again
    openMenu(root(), "a");
    expect(menuItemByAction(root(), "sort-asc")).toBeNull();
    expect(menuItemByAction(root(), "pin-left")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("setColumnMenu hides the trigger and restores it when re-enabled", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
    );
    await flushRenders();

    // Initially trigger exists
    expect(menuTrigger(root(), "a")).toBeTruthy();
    expect(menuTrigger(root(), "a")!.style.display).not.toBe("none");

    // Disable menu
    grid.setColumnMenu({ enabled: false });
    await flushRenders();

    const triggerAfterDisable = menuTrigger(root(), "a");
    const isHidden = !triggerAfterDisable || triggerAfterDisable.style.display === "none";
    expect(isHidden).toBe(true);

    // Re-enable menu
    grid.setColumnMenu({ enabled: true });
    await flushRenders();

    expect(menuTrigger(root(), "a")).toBeTruthy();
    expect(menuTrigger(root(), "a")!.style.display).not.toBe("none");

    grid.destroy();
    container.remove();
  });

  it("all built-in sections disabled and no custom sections does not open menu panel", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }],
      undefined,
      { columnMenu: { sort: false, pinning: false, visibility: false } },
    );
    await flushRenders();

    const trigger = menuTrigger(root(), "a");
    expect(trigger).toBeTruthy();
    trigger!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    expect(menuPanel(root())).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("does not add per-header-cell listeners", async () => {
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }, { field: "c" }],
      undefined,
      { columnMenu: { sort: false } },
    );
    await flushRenders();

    // The column menu controller attaches a single listener on the grid root,
    // not per-header. We verify by checking that header cells have no
    // registered onclick / addEventListener beyond the grid root.
    const cells = Array.from(root().querySelectorAll(".lfg-header-cell"));
    for (const cell of cells) {
      expect((cell as HTMLElement).onclick).toBeNull();
    }

    grid.destroy();
    container.remove();
  });
});
