// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HEADER_ACTION_TRIGGER_CLASS,
  HEADER_ACTIONS_CLASS,
} from "../../../features/header-actions/headerActionDom";
import { Grid } from "../../../Grid";
import { SELECTION_COLUMN_FIELD } from "../../../internal/selectionColumn";
import { GridState } from "../../../state/GridState";
import type {
  HeaderActionRenderContext,
  HeaderActionRendererRegistry,
  LightFastGridColDef,
  RowData,
} from "../../../types";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function makeGrid(
  columns: LightFastGridColDef[],
  opts?: Record<string, unknown>,
) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "320px", width: "640px" });
  document.body.appendChild(container);

  const grid = new Grid({
    rows: [{ id: "r1", a: 1, b: 2, left: 3, right: 4 }] as RowData[],
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

function headerCell(root: HTMLElement, field: string): HTMLElement | null {
  return root.querySelector(
    `.lfg-header-cell[data-col-id="${field}"]`,
  ) as HTMLElement | null;
}

function headerAction(
  root: HTMLElement,
  field: string,
  actionId = "inspect",
): HTMLButtonElement | null {
  return headerCell(root, field)?.querySelector(
    `.${HEADER_ACTION_TRIGGER_CLASS}[data-header-action-id="${actionId}"]`,
  ) as HTMLButtonElement | null;
}

function headerControls(root: HTMLElement, field: string): HTMLElement | null {
  return headerCell(root, field)?.querySelector(".lfg-header-controls") ?? null;
}

function menuTrigger(root: HTMLElement, field: string): HTMLButtonElement | null {
  return headerCell(root, field)?.querySelector(
    ".lfg-column-menu-trigger",
  ) as HTMLButtonElement | null;
}

function floatingHost(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-floating") as HTMLElement | null;
}

function click(el: Element): void {
  el.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
  );
}

function makeHeaderRenderer(
  render: (ctx: HeaderActionRenderContext) => void | (() => void),
): HeaderActionRendererRegistry {
  return {
    inspectPanel: {
      kind: "header-action",
      mode: "custom",
      render,
    },
  };
}

describe("header action triggers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("copies headerActions into effective column definitions", () => {
    const headerActions = [
      { id: "inspect", rendererKey: "inspectPanel", icon: "i" },
    ];
    const state = new GridState({
      rows: [{ a: 1 }],
      columns: [{ field: "a", headerActions }],
    });

    expect(state.getSnapshot().columns[0]?.headerActions).toBe(headerActions);
  });

  it("merges headerControls from defaultColDef unless column overrides it", () => {
    const state = new GridState({
      rows: [{ a: 1, b: 2 }],
      defaultColDef: {
        headerControls: { order: ["columnMenu", "headerActions"] },
      },
      columns: [
        { field: "a" },
        { field: "b", headerControls: { order: ["headerActions", "columnMenu"] } },
      ],
    });

    expect(state.getSnapshot().columns[0]?.headerControls).toEqual({
      order: ["columnMenu", "headerActions"],
    });
    expect(state.getSnapshot().columns[1]?.headerControls).toEqual({
      order: ["headerActions", "columnMenu"],
    });
  });

  it("renders center header action buttons beside the column menu trigger", async () => {
    const { grid, container, root } = makeGrid([
      {
        field: "a",
        headerActions: [
          {
            id: "inspect",
            rendererKey: "inspectPanel",
            icon: "!",
            ariaLabel: "Inspect column",
            className: "custom-action",
          },
        ],
      },
    ]);
    await flushRenders();

    const action = headerAction(root(), "a");
    expect(action).toBeTruthy();
    expect(action?.dataset.colId).toBe("a");
    expect(action?.dataset.headerActionId).toBe("inspect");
    expect(action?.dataset.headerActionRendererKey).toBe("inspectPanel");
    expect(action?.getAttribute("aria-label")).toBe("Inspect column");
    expect(action?.textContent).toBe("!");
    expect(action?.classList.contains("custom-action")).toBe(true);
    expect(menuTrigger(root(), "a")).toBeTruthy();
    expect(headerControls(root(), "a")?.children).toHaveLength(2);
    expect(
      headerCell(root(), "a")?.style.getPropertyValue(
        "--lfg-header-control-count",
      ),
    ).toBe("2");

    grid.destroy();
    container.remove();
  });

  it("omits hidden actions and marks disabled actions", async () => {
    const { grid, container, root } = makeGrid([
      {
        field: "a",
        headerActions: [
          { id: "hidden", rendererKey: "hiddenPanel", hidden: true },
          { id: "disabled", rendererKey: "disabledPanel", disabled: true },
        ],
      },
    ]);
    await flushRenders();

    expect(headerAction(root(), "a", "hidden")).toBeNull();
    const disabled = headerAction(root(), "a", "disabled");
    expect(disabled).toBeTruthy();
    expect(disabled?.textContent).toBe("⋮");
    expect(disabled?.disabled).toBe(true);
    expect(disabled?.getAttribute("aria-disabled")).toBe("true");

    grid.destroy();
    container.remove();
  });

  it("removes stale header action buttons when columns are rebound", async () => {
    const { grid, container, root } = makeGrid([
      {
        field: "a",
        headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
      },
    ]);
    await flushRenders();
    expect(headerAction(root(), "a")).toBeTruthy();

    grid.setColumns([{ field: "b" }]);
    await flushRenders();

    expect(headerCell(root(), "a")).toBeNull();
    expect(headerAction(root(), "b")).toBeNull();
    expect(headerControls(root(), "b")).toBeTruthy();
    expect(
      headerCell(root(), "b")?.querySelector(`.${HEADER_ACTIONS_CLASS}`),
    ).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("renders header actions in pinned-left and pinned-right headers", async () => {
    const { grid, container, root } = makeGrid([
      {
        field: "left",
        pinned: "left",
        headerActions: [{ id: "inspect", rendererKey: "inspectLeft" }],
      },
      { field: "b" },
      {
        field: "right",
        pinned: "right",
        headerActions: [{ id: "inspect", rendererKey: "inspectRight" }],
      },
    ]);
    await flushRenders();

    expect(
      root().querySelector(
        `.lfg-pinned-header-row ` +
          `.${HEADER_ACTION_TRIGGER_CLASS}[data-col-id="left"]`,
      ),
    ).toBeTruthy();
    expect(
      root().querySelector(
        `.lfg-pinned-right-header-row ` +
          `.${HEADER_ACTION_TRIGGER_CLASS}[data-col-id="right"]`,
      ),
    ).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("does not render header actions in the selection checkbox column", async () => {
    const { grid, container, root } = makeGrid(
      [
        {
          field: "a",
          headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        },
      ],
      {
        rowSelection: {
          mode: "multiple",
          checkboxes: true,
          headerCheckbox: true,
        },
      },
    );
    await flushRenders();

    expect(
      headerCell(root(), SELECTION_COLUMN_FIELD)?.querySelector(
        `.${HEADER_ACTION_TRIGGER_CLASS}`,
      ),
    ).toBeNull();
    expect(headerControls(root(), SELECTION_COLUMN_FIELD)).toBeNull();
    expect(headerAction(root(), "a")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it('headerControls.order ["headerActions", "columnMenu"] renders action before menu', async () => {
    const { grid, container, root } = makeGrid([
      {
        field: "a",
        headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        headerControls: { order: ["headerActions", "columnMenu"] },
      },
    ]);
    await flushRenders();

    const controls = headerControls(root(), "a");
    expect(controls?.children[0]?.classList.contains(HEADER_ACTION_TRIGGER_CLASS)).toBe(
      true,
    );
    expect(controls?.children[1]?.classList.contains("lfg-column-menu-trigger")).toBe(
      true,
    );

    grid.destroy();
    container.remove();
  });

  it('headerControls.order ["columnMenu", "headerActions"] renders menu before action', async () => {
    const { grid, container, root } = makeGrid([
      {
        field: "a",
        headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        headerControls: { order: ["columnMenu", "headerActions"] },
      },
    ]);
    await flushRenders();

    const controls = headerControls(root(), "a");
    expect(controls?.children[0]?.classList.contains("lfg-column-menu-trigger")).toBe(
      true,
    );
    expect(controls?.children[1]?.classList.contains(HEADER_ACTION_TRIGGER_CLASS)).toBe(
      true,
    );

    grid.destroy();
    container.remove();
  });

  it("columnMenu false hides menu even when headerControls.order includes it", async () => {
    const { grid, container, root } = makeGrid([
      {
        field: "a",
        columnMenu: false,
        headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        headerControls: { order: ["columnMenu", "headerActions"] },
      },
    ]);
    await flushRenders();

    expect(menuTrigger(root(), "a")).toBeNull();
    expect(headerControls(root(), "a")?.children).toHaveLength(1);
    expect(headerAction(root(), "a")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("hidden header actions are excluded from count and layout", async () => {
    const { grid, container, root } = makeGrid([
      {
        field: "a",
        headerActions: [
          { id: "hidden", rendererKey: "hiddenPanel", hidden: true },
        ],
      },
    ]);
    await flushRenders();

    expect(headerAction(root(), "a", "hidden")).toBeNull();
    expect(menuTrigger(root(), "a")).toBeTruthy();
    expect(headerControls(root(), "a")?.children).toHaveLength(1);
    expect(
      headerCell(root(), "a")?.style.getPropertyValue(
        "--lfg-header-control-count",
      ),
    ).toBe("1");

    grid.destroy();
    container.remove();
  });

  it("does not sort or select a column when a header action is clicked", async () => {
    const onSortChanged = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        {
          field: "a",
          sortable: true,
          headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        },
      ],
      {
        columnSelection: true,
        onSortChanged,
      },
    );
    await flushRenders();

    click(headerAction(root(), "a")!);
    await flushRenders();

    expect(grid.getSortModel()).toEqual([]);
    expect(onSortChanged).not.toHaveBeenCalled();
    expect(grid.getSelectedColumnIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("clicking header action opens a custom dropdown", async () => {
    const { grid, container, root } = makeGrid(
      [
        {
          field: "a",
          headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        },
      ],
      {
        headerRenderers: makeHeaderRenderer((ctx) => {
          const el = document.createElement("div");
          el.textContent = `Panel ${ctx.field}`;
          ctx.host.appendChild(el);
        }),
      },
    );
    await flushRenders();

    click(headerAction(root(), "a")!);

    expect(floatingHost(root())?.textContent).toContain("Panel a");

    grid.destroy();
    container.remove();
  });

  it("render receives field, column, columns, selectedColumnIds, grid, and close", async () => {
    const render = vi.fn((ctx: HeaderActionRenderContext) => {
      const el = document.createElement("button");
      el.textContent = "Close";
      el.addEventListener("click", ctx.close);
      ctx.host.appendChild(el);
    });
    const { grid, container, root } = makeGrid(
      [
        {
          field: "a",
          headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        },
        { field: "b" },
      ],
      {
        columnSelection: true,
        headerRenderers: makeHeaderRenderer(render),
      },
    );
    await flushRenders();
    click(headerCell(root(), "b")!);
    await flushRenders();

    click(headerAction(root(), "a")!);

    expect(render).toHaveBeenCalledTimes(1);
    const ctx = render.mock.calls[0]![0];
    expect(ctx.host).toBe(floatingHost(root()));
    expect(ctx.field).toBe("a");
    expect(ctx.column.field).toBe("a");
    expect(ctx.columns.map((c) => c.field)).toEqual(["a", "b"]);
    expect(ctx.selectedColumnIds).toEqual(["b"]);
    expect(ctx.grid.getColumns().map((c) => c.field)).toEqual(["a", "b"]);
    expect(ctx.grid.getSelectedColumnIds()).toEqual(["b"]);
    expect(typeof ctx.close).toBe("function");

    ctx.close();
    expect(floatingHost(root())?.textContent).toBe("");

    grid.destroy();
    container.remove();
  });

  it("cleanup runs when the header action dropdown closes", async () => {
    const cleanup = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        {
          field: "a",
          headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        },
      ],
      {
        headerRenderers: makeHeaderRenderer((ctx) => {
          ctx.host.appendChild(document.createElement("div"));
          return cleanup;
        }),
      },
    );
    await flushRenders();

    click(headerAction(root(), "a")!);
    expect(cleanup).not.toHaveBeenCalled();

    click(headerAction(root(), "a")!);
    expect(cleanup).toHaveBeenCalledTimes(1);

    grid.destroy();
    container.remove();
  });

  it("same trigger toggles close", async () => {
    const render = vi.fn((ctx: HeaderActionRenderContext) => {
      const el = document.createElement("div");
      el.textContent = "Panel";
      ctx.host.appendChild(el);
    });
    const { grid, container, root } = makeGrid(
      [
        {
          field: "a",
          headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        },
      ],
      { headerRenderers: makeHeaderRenderer(render) },
    );
    await flushRenders();

    click(headerAction(root(), "a")!);
    expect(floatingHost(root())?.textContent).toContain("Panel");

    click(headerAction(root(), "a")!);
    expect(floatingHost(root())?.textContent).toBe("");
    expect(render).toHaveBeenCalledTimes(1);

    grid.destroy();
    container.remove();
  });

  it("another header action closes the previous dropdown and opens the next", async () => {
    const cleanup = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        {
          field: "a",
          headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        },
        {
          field: "b",
          headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        },
      ],
      {
        headerRenderers: makeHeaderRenderer((ctx) => {
          const el = document.createElement("div");
          el.textContent = `Panel ${ctx.field}`;
          ctx.host.appendChild(el);
          return cleanup;
        }),
      },
    );
    await flushRenders();

    click(headerAction(root(), "a")!);
    expect(floatingHost(root())?.textContent).toContain("Panel a");

    click(headerAction(root(), "b")!);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(floatingHost(root())?.textContent).toContain("Panel b");

    grid.destroy();
    container.remove();
  });

  it("disabled header action does not open", async () => {
    const render = vi.fn();
    const { grid, container, root } = makeGrid(
      [
        {
          field: "a",
          headerActions: [
            { id: "inspect", rendererKey: "inspectPanel", disabled: true },
          ],
        },
      ],
      { headerRenderers: makeHeaderRenderer(render) },
    );
    await flushRenders();

    click(headerAction(root(), "a")!);

    expect(render).not.toHaveBeenCalled();
    expect(floatingHost(root())).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("opens from pinned-left and pinned-right header action triggers", async () => {
    const { grid, container, root } = makeGrid(
      [
        {
          field: "left",
          pinned: "left",
          headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        },
        { field: "b" },
        {
          field: "right",
          pinned: "right",
          headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        },
      ],
      {
        headerRenderers: makeHeaderRenderer((ctx) => {
          const el = document.createElement("div");
          el.textContent = `Panel ${ctx.field}`;
          ctx.host.appendChild(el);
        }),
      },
    );
    await flushRenders();

    const pinnedLeftTrigger = root().querySelector(
      `.lfg-pinned-header-row ` +
        `.${HEADER_ACTION_TRIGGER_CLASS}[data-col-id="left"]`,
    )!;
    click(pinnedLeftTrigger);
    expect(floatingHost(root())?.textContent).toContain("Panel left");

    const pinnedRightTrigger = root().querySelector(
      `.lfg-pinned-right-header-row ` +
        `.${HEADER_ACTION_TRIGGER_CLASS}[data-col-id="right"]`,
    )!;
    click(pinnedRightTrigger);
    expect(floatingHost(root())?.textContent).toContain("Panel right");

    grid.destroy();
    container.remove();
  });

  it("existing column menu trigger still works independently", async () => {
    const { grid, container, root } = makeGrid(
      [
        {
          field: "a",
          headerActions: [{ id: "inspect", rendererKey: "inspectPanel" }],
        },
      ],
      {
        headerRenderers: makeHeaderRenderer((ctx) => {
          ctx.host.appendChild(document.createElement("div"));
        }),
      },
    );
    await flushRenders();

    const trigger = menuTrigger(root(), "a");
    expect(trigger).toBeTruthy();

    click(trigger!);

    expect(root().querySelector(".lfg-column-menu-panel")).toBeTruthy();

    grid.destroy();
    container.remove();
  });
});
