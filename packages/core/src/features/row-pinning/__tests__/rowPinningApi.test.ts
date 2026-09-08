// @vitest-environment jsdom
//
// Public row-pinning API surface — covers GridState ownership, Grid.* methods,
// `rowPinning` prop, callback / event bus emission, and the snapshot →
// renderer plumbing. Existing render-detail tests live in
// `rowPinningGrid.test.ts`; this file focuses on the public contract.

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { CSS } from "../../../rendering/const/css-classes";
import { queryCenterPoolRows } from "../../../rendering/helpers/dom/centerPoolRows";
import type {
  LightFastGridRowPinChangedEvent,
  RowData,
  RowPinStateEntry,
} from "../../../types";

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

function makeGrid(opts?: {
  rowPinning?: { top?: string[]; bottom?: string[] };
  onRowPinChanged?: (e: LightFastGridRowPinChangedEvent) => void;
}) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "300px", width: "400px" });
  document.body.appendChild(container);

  const grid = new Grid({
    rows,
    columns: [{ field: "id" }, { field: "name" }],
    getRowId: (row: RowData) => row.id as string,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    rowPinning: opts?.rowPinning,
    onRowPinChanged: opts?.onRowPinChanged,
  });
  grid.mount(container);
  return { grid, container };
}

function getRoot(container: HTMLElement): HTMLElement {
  return container.querySelector(`.${CSS.GRID}`) as HTMLElement;
}

function getTopLayer(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-row-pinned-top-layer");
}
function getBottomLayer(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-row-pinned-bottom-layer");
}

function pinnedIds(layer: HTMLElement | null): string[] {
  if (!layer) return [];
  return Array.from(layer.querySelectorAll<HTMLElement>(`.${CSS.ROW}`))
    .map((r) => r.getAttribute("data-row-id"))
    .filter((id): id is string => id !== null);
}

function centerRowIds(root: HTMLElement): string[] {
  const sc = root.querySelector(`.${CSS.SCROLL_CONTAINER}`)!;
  return queryCenterPoolRows(sc)
    .map((r) => r.getAttribute("data-row-id"))
    .filter((id): id is string => id !== null);
}

describe("public row pinning API", () => {
  let grid: Grid;
  let container: HTMLElement;

  afterEach(() => {
    grid.destroy();
    container.remove();
  });

  // ── Initial `rowPinning` prop ──────────────────────────────────────────

  it("initial rowPinning prop pins top and bottom rows by id", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r1"], bottom: ["r5"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    expect(pinnedIds(getTopLayer(root))).toContain("r1");
    expect(pinnedIds(getBottomLayer(root))).toContain("r5");
  });

  it("pinned rows are removed from the center body", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r1"], bottom: ["r5"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const ids = centerRowIds(root);
    expect(ids).not.toContain("r1");
    expect(ids).not.toContain("r5");
    expect(ids).toContain("r2");
    expect(ids).toContain("r3");
    expect(ids).toContain("r4");
  });

  // ── getRowPinState / setRowPinState ────────────────────────────────────

  it("getRowPinState returns the normalized pin state", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r1"], bottom: ["r5"] },
    }));
    await flushRenders();

    const state = grid.getRowPinState();
    expect(state).toEqual(
      expect.arrayContaining<RowPinStateEntry>([
        { rowId: "r1", pinned: "top" },
        { rowId: "r5", pinned: "bottom" },
      ]),
    );
    expect(state).toHaveLength(2);
  });

  it("setRowPinState replaces state; `pinned: false` unpins", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r1", "r2"] },
    }));
    await flushRenders();

    grid.setRowPinState([
      { rowId: "r1", pinned: "bottom" }, // move r1 top → bottom
      { rowId: "r2", pinned: false },     // explicitly unpin r2
      { rowId: "r3", pinned: "top" },     // pin r3
    ]);
    await flushRenders();

    const root = getRoot(container);
    expect(pinnedIds(getTopLayer(root))).toContain("r3");
    expect(pinnedIds(getBottomLayer(root))).toContain("r1");
    expect(centerRowIds(root)).toContain("r2");

    // r1 (now bottom) and r3 (now top) appear in state; r2 (explicit false) does not.
    expect(grid.getRowPinState()).toEqual(
      expect.arrayContaining<RowPinStateEntry>([
        { rowId: "r1", pinned: "bottom" },
        { rowId: "r3", pinned: "top" },
      ]),
    );
    expect(grid.getRowPinState().some((e) => e.rowId === "r2")).toBe(false);
  });

  it("duplicate ids in setRowPinState resolve last-write-wins", async () => {
    ({ grid, container } = makeGrid());
    await flushRenders();

    grid.setRowPinState([
      { rowId: "r1", pinned: "top" },
      { rowId: "r1", pinned: "bottom" }, // later entry wins
    ]);
    await flushRenders();

    const root = getRoot(container);
    expect(pinnedIds(getBottomLayer(root))).toContain("r1");
    expect(pinnedIds(getTopLayer(root))).not.toContain("r1");
    expect(grid.getRowPinState()).toEqual([
      { rowId: "r1", pinned: "bottom" },
    ]);
  });

  it("same id in both rowPinning.top and rowPinning.bottom normalizes deterministically", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r1"], bottom: ["r1"] }, // bottom wins (last-write)
    }));
    await flushRenders();

    expect(grid.getRowPinState()).toEqual([{ rowId: "r1", pinned: "bottom" }]);

    const root = getRoot(container);
    expect(pinnedIds(getBottomLayer(root))).toContain("r1");
    expect(pinnedIds(getTopLayer(root))).not.toContain("r1");
  });

  // ── pinRow / pinRows / unpinRows / clearRowPinning ─────────────────────

  it("pinRow updates DOM and emits a single onRowPinChanged callback", async () => {
    const onRowPinChanged = vi.fn();
    ({ grid, container } = makeGrid({ onRowPinChanged }));
    await flushRenders();

    grid.pinRow("r1", "top");
    await flushRenders();

    expect(onRowPinChanged).toHaveBeenCalledTimes(1);
    const event = onRowPinChanged.mock.calls[0]![0] as LightFastGridRowPinChangedEvent;
    expect(event.source).toBe("api");
    expect(event.changedRows).toEqual([
      { rowId: "r1", pinned: "top", previousPinned: false },
    ]);
    expect(event.rowPinState).toEqual([{ rowId: "r1", pinned: "top" }]);
    expect(pinnedIds(getTopLayer(getRoot(container)))).toContain("r1");
  });

  it("pinRow with same position is a no-op and does not emit", async () => {
    const onRowPinChanged = vi.fn();
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r1"] },
      onRowPinChanged,
    }));
    await flushRenders();
    onRowPinChanged.mockClear();

    grid.pinRow("r1", "top"); // already top
    await flushRenders();

    expect(onRowPinChanged).not.toHaveBeenCalled();
  });

  it("pinRows batches multiple rows into one event and one render", async () => {
    const onRowPinChanged = vi.fn();
    ({ grid, container } = makeGrid({ onRowPinChanged }));
    await flushRenders();

    grid.pinRows(["r1", "r2", "r3"], "top");
    await flushRenders();

    expect(onRowPinChanged).toHaveBeenCalledTimes(1);
    const event = onRowPinChanged.mock.calls[0]![0] as LightFastGridRowPinChangedEvent;
    expect(event.changedRows.map((c) => c.rowId)).toEqual(["r1", "r2", "r3"]);
    expect(event.changedRows.every((c) => c.pinned === "top")).toBe(true);

    expect(pinnedIds(getTopLayer(getRoot(container)))).toEqual(
      expect.arrayContaining(["r1", "r2", "r3"]),
    );
  });

  it("unpinRows removes the rows and emits one event for the batch", async () => {
    const onRowPinChanged = vi.fn();
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r1", "r2"], bottom: ["r5"] },
      onRowPinChanged,
    }));
    await flushRenders();
    onRowPinChanged.mockClear();

    grid.unpinRows(["r1", "r5", "missing"]);
    await flushRenders();

    expect(onRowPinChanged).toHaveBeenCalledTimes(1);
    const event = onRowPinChanged.mock.calls[0]![0] as LightFastGridRowPinChangedEvent;
    // "missing" was never pinned, so it is not in changedRows.
    expect(event.changedRows.map((c) => c.rowId).sort()).toEqual(["r1", "r5"]);

    const root = getRoot(container);
    expect(pinnedIds(getTopLayer(root))).not.toContain("r1");
    // Bottom layer removed when no rows are bottom-pinned.
    expect(getBottomLayer(root)).toBeNull();
    // r2 still pinned (untouched).
    expect(pinnedIds(getTopLayer(root))).toContain("r2");
  });

  it("clearRowPinning removes all pinned rows and emits one event", async () => {
    const onRowPinChanged = vi.fn();
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r1", "r2"], bottom: ["r5"] },
      onRowPinChanged,
    }));
    await flushRenders();
    onRowPinChanged.mockClear();

    grid.clearRowPinning();
    await flushRenders();

    expect(onRowPinChanged).toHaveBeenCalledTimes(1);
    const event = onRowPinChanged.mock.calls[0]![0] as LightFastGridRowPinChangedEvent;
    expect(event.changedRows).toHaveLength(3);
    expect(event.changedRows.every((c) => c.pinned === false)).toBe(true);
    expect(event.rowPinState).toEqual([]);

    const root = getRoot(container);
    expect(getTopLayer(root)).toBeNull();
    expect(getBottomLayer(root)).toBeNull();
  });

  it("clearRowPinning on an empty state is a no-op (no event)", async () => {
    const onRowPinChanged = vi.fn();
    ({ grid, container } = makeGrid({ onRowPinChanged }));
    await flushRenders();

    grid.clearRowPinning();
    await flushRenders();

    expect(onRowPinChanged).not.toHaveBeenCalled();
  });

  // ── Missing row ids ────────────────────────────────────────────────────

  it("missing row ids remain in state but do not render", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r1", "ghost-id"], bottom: ["nonexistent"] },
    }));
    await flushRenders();

    expect(grid.getRowPinState()).toEqual(
      expect.arrayContaining<RowPinStateEntry>([
        { rowId: "r1", pinned: "top" },
        { rowId: "ghost-id", pinned: "top" },
        { rowId: "nonexistent", pinned: "bottom" },
      ]),
    );

    const root = getRoot(container);
    // Only r1 actually renders; the ghost ids match no row in `rows`.
    expect(pinnedIds(getTopLayer(root))).toEqual(["r1"]);
    // No bottom layer because no real row matched a bottom-pinned id.
    expect(getBottomLayer(root)).toBeNull();
  });

  // ── Source attribution ─────────────────────────────────────────────────

  it("forwards explicit `source` argument through the event", async () => {
    const onRowPinChanged = vi.fn();
    ({ grid, container } = makeGrid({ onRowPinChanged }));
    await flushRenders();

    grid.pinRow("r1", "top", "ui");
    await flushRenders();

    const event = onRowPinChanged.mock.calls[0]![0] as LightFastGridRowPinChangedEvent;
    expect(event.source).toBe("ui");
  });

  // ── Event bus parity ───────────────────────────────────────────────────

  it("emits row-pin:changed on the event bus too", async () => {
    ({ grid, container } = makeGrid());
    await flushRenders();

    const onBus = vi.fn();
    grid.on("row-pin:changed", onBus);

    grid.pinRow("r1", "top");
    await flushRenders();

    expect(onBus).toHaveBeenCalledTimes(1);
    const event = onBus.mock.calls[0]![0] as LightFastGridRowPinChangedEvent;
    expect(event.changedRows[0]!.rowId).toBe("r1");
  });

  // ── Renderer is a pure snapshot consumer ───────────────────────────────

  it("snapshot drives rendering — no private mutation needed", async () => {
    ({ grid, container } = makeGrid());
    await flushRenders();

    // Mutate exclusively through public API.
    grid.pinRow("r1", "top");
    grid.pinRow("r5", "bottom");
    await flushRenders();

    const root = getRoot(container);
    expect(pinnedIds(getTopLayer(root))).toContain("r1");
    expect(pinnedIds(getBottomLayer(root))).toContain("r5");

    // Mutate again — re-render reflects new state.
    grid.unpinRows(["r1"]);
    await flushRenders();
    expect(getTopLayer(root)).toBeNull();
    expect(pinnedIds(getBottomLayer(root))).toContain("r5");
  });
});
