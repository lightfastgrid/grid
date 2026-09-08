// @vitest-environment jsdom
//
// Verifies that row action and cell menu dropdown features work for rows that
// live in row-pinned top/bottom lanes (center + left + right sub-lanes), since
// those rows live in separate DOM pools from normal body rows.

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { CSS } from "../../../rendering/const/css-classes";
import type {
  CellMenuActionContext,
  CellMenuContext,
  CellRendererRegistry,
  ColumnDef,
  RowActionClickContext,
  RowData,
} from "../../../types";
import {
  ACTION_TRIGGER_CLASS,
  isRowActionUiTarget,
} from "../../row-actions/rowActionDom";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

const rows: RowData[] = [
  { id: "r1", name: "Alice" },
  { id: "r2", name: "Bob" },
  { id: "r3", name: "Carol" },
  { id: "r4", name: "Dave" },
  { id: "r5", name: "Eve" },
];

const makeRenderer = (overrides?: {
  onAction?: (ctx: RowActionClickContext) => void;
}): CellRendererRegistry => ({
  rowActions: {
    kind: "actions" as const,
    getActions: () => [
      { id: "edit", icon: "✏️", label: "Edit" },
      { id: "delete", icon: "🗑️", label: "Delete" },
    ],
    onAction:
      overrides?.onAction ??
      (() => {
        /* no-op */
      }),
  },
});

const makeCustomRenderer = (
  renderSpy: (host: HTMLElement) => void,
): CellRendererRegistry => ({
  rowActions: {
    kind: "actions" as const,
    mode: "custom",
    render: (ctx) => {
      renderSpy(ctx.host);
    },
  },
});

function getRoot(container: HTMLElement): HTMLElement {
  return container.querySelector(`.${CSS.GRID}`) as HTMLElement;
}

function makeGrid(opts: {
  columns: ColumnDef[];
  rows?: RowData[];
  cellRenderers?: CellRendererRegistry;
  rowPinning?: { top?: string[]; bottom?: string[] };
  cellMenu?: unknown;
}) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "400px", width: "800px" });
  document.body.appendChild(container);

  // `cellMenu` is typed loosely here to avoid pulling the full CellMenuOptions
  // import surface into the test; the Grid constructor narrows it.
  const grid = new Grid({
    rows: opts.rows ?? rows,
    columns: opts.columns,
    cellRenderers: opts.cellRenderers,
    cellMenu: opts.cellMenu as never,
    getRowId: (r: RowData) => r.id as string,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    rowPinning: opts.rowPinning,
  });
  grid.mount(container);
  return { grid, container };
}

function triggerInside(layer: HTMLElement | null): HTMLButtonElement | null {
  if (!layer) return null;
  return layer.querySelector<HTMLButtonElement>(`.${ACTION_TRIGGER_CLASS}`);
}

function topLayer(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-row-pinned-top-layer");
}
function bottomLayer(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-row-pinned-bottom-layer");
}
function topLeftLayer(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-row-pinned-top-left-layer");
}
function floatingPanel(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-floating-layer");
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
}

function contextmenu(el: Element): void {
  el.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, button: 2, cancelable: true }),
  );
}

describe("row pinning + dropdown / menu interactions", () => {
  let grid: Grid;
  let container: HTMLElement;

  afterEach(() => {
    grid.destroy();
    container.remove();
  });

  // ── Row action dropdown ────────────────────────────────────────────────

  it("row action dropdown opens from top-pinned center lane", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      cellRenderers: makeRenderer(),
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const trigger = triggerInside(topLayer(root));
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute("data-row-id")).toBe("r1");
    expect(trigger!.getAttribute("data-actions-key")).toBe("rowActions");

    click(trigger!);
    expect(floatingPanel(root)).not.toBeNull();
  });

  it("row action dropdown opens from bottom-pinned center lane", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      cellRenderers: makeRenderer(),
      rowPinning: { bottom: ["r5"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const trigger = triggerInside(bottomLayer(root));
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute("data-row-id")).toBe("r5");

    click(trigger!);
    expect(floatingPanel(root)).not.toBeNull();
  });

  it("row action dropdown opens from top-pinned LEFT sub-lane when action column is pinned left", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        {
          field: "actions",
          cellKind: "actions",
          actionsKey: "rowActions",
          pinned: "left",
        },
        { field: "name" },
      ],
      cellRenderers: makeRenderer(),
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const trigger = triggerInside(topLeftLayer(root));
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute("data-row-id")).toBe("r1");

    click(trigger!);
    expect(floatingPanel(root)).not.toBeNull();
  });

  it("custom row action renderer opens from row-pinned row", async () => {
    const renderSpy = vi.fn((host: HTMLElement) => {
      const el = document.createElement("div");
      el.className = "test-custom-dropdown";
      el.textContent = "custom-content";
      host.appendChild(el);
    });

    ({ grid, container } = makeGrid({
      columns: [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      cellRenderers: makeCustomRenderer(renderSpy),
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const trigger = triggerInside(topLayer(root));
    expect(trigger).not.toBeNull();

    click(trigger!);
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".test-custom-dropdown")?.textContent).toBe("custom-content");
  });

  it("onAction receives the correct pinned row and rowIndex", async () => {
    const onAction = vi.fn();
    ({ grid, container } = makeGrid({
      columns: [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      cellRenderers: makeRenderer({ onAction }),
      rowPinning: { bottom: ["r5"] }, // dataIndex 4
    }));
    await flushRenders();

    const root = getRoot(container);
    const trigger = triggerInside(bottomLayer(root))!;
    click(trigger);

    const item = root.querySelector(".lfg-floating-layer button") as HTMLElement;
    expect(item).not.toBeNull();
    click(item);

    expect(onAction).toHaveBeenCalledTimes(1);
    const ctx = onAction.mock.calls[0]![0] as RowActionClickContext;
    expect(ctx.rowId).toBe("r5");
    expect(ctx.rowIndex).toBe(4);
    expect(ctx.row.id).toBe("r5");
  });

  // ── Selection isolation ────────────────────────────────────────────────

  it("clicking action trigger in pinned row does not select the row", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      cellRenderers: makeRenderer(),
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const trigger = triggerInside(topLayer(root))!;
    expect(isRowActionUiTarget(trigger)).toBe(true);

    click(trigger);
    expect(grid.getSelectedRowIds()).toEqual([]);
  });

  // ── Floating host is outside the lane DOM ──────────────────────────────

  it("floating panel mounts in .lfg-floating-layer, not inside the lane", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "name" },
        { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
      ],
      cellRenderers: makeRenderer(),
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const trigger = triggerInside(topLayer(root))!;
    click(trigger);

    const panel = floatingPanel(root)!;
    expect(panel).not.toBeNull();
    // Floating host is a direct (or grand-) child of the grid root, NOT a
    // descendant of the row-pinned lane layers.
    expect(topLayer(root)!.contains(panel)).toBe(false);
    expect(panel.closest(".lfg-row-pinned-top-layer")).toBeNull();
    expect(panel.closest(".lfg-row-pinned-bottom-layer")).toBeNull();
    expect(panel.closest(".lfg-row-pinned-top-left-layer")).toBeNull();
  });

  // ── Cell menu ───────────────────────────────────────────────────────────

  function makeCellMenu() {
    const onAction = vi.fn();
    return {
      onAction,
      cellMenu: {
        enabled: true,
        trigger: "contextmenu" as const,
        getActions: (ctx: CellMenuContext) => [
          { id: "copy", label: `Copy "${String(ctx.value ?? "")}"`, icon: "📋" },
        ],
        onAction: (ctx: CellMenuActionContext) => onAction(ctx),
      },
    };
  }

  it("cell menu opens from a normal data cell inside a top-pinned row", async () => {
    const { onAction, cellMenu } = makeCellMenu();
    ({ grid, container } = makeGrid({
      columns: [{ field: "name" }, { field: "id" }],
      cellRenderers: makeRenderer(),
      cellMenu,
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const layer = topLayer(root)!;
    const cell = layer.querySelector(`.${CSS.CELL}[data-col-id="name"]`) as HTMLElement;
    expect(cell).not.toBeNull();
    contextmenu(cell);

    const panel = floatingPanel(root);
    expect(panel).not.toBeNull();

    const btn = panel!.querySelector("button") as HTMLElement;
    expect(btn).not.toBeNull();
    click(btn);

    expect(onAction).toHaveBeenCalledTimes(1);
    const ctx = onAction.mock.calls[0]![0] as CellMenuActionContext;
    expect(ctx.rowId).toBe("r1");
    expect(ctx.field).toBe("name");
  });

  it("cell menu opens from a normal data cell inside a bottom-pinned row", async () => {
    const { onAction, cellMenu } = makeCellMenu();
    ({ grid, container } = makeGrid({
      columns: [{ field: "name" }, { field: "id" }],
      cellRenderers: makeRenderer(),
      cellMenu,
      rowPinning: { bottom: ["r5"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const layer = bottomLayer(root)!;
    const cell = layer.querySelector(`.${CSS.CELL}[data-col-id="name"]`) as HTMLElement;
    expect(cell).not.toBeNull();
    contextmenu(cell);

    const panel = floatingPanel(root);
    expect(panel).not.toBeNull();
    const btn = panel!.querySelector("button") as HTMLElement;
    click(btn);

    expect(onAction).toHaveBeenCalledTimes(1);
    const ctx = onAction.mock.calls[0]![0] as CellMenuActionContext;
    expect(ctx.rowId).toBe("r5");
  });
});
