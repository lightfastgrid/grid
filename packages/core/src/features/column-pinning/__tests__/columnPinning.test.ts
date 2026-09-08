// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import type { ColumnDef, RowData } from "../../../types";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
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

describe("column pinning API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pinColumn left moves column to left pinned lane", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "b" },
    ]);
    await flushRenders();

    grid.pinColumn("a", "left");
    await flushRenders();

    const pinnedHeader = root().querySelector(".lfg-pinned-header-row");
    expect(pinnedHeader).toBeTruthy();
    expect(pinnedHeader!.querySelector('[data-col-id="a"]')).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("pinColumn right moves column to right pinned lane", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "b" },
    ]);
    await flushRenders();

    grid.pinColumn("a", "right");
    await flushRenders();

    const pinnedRightHeader = root().querySelector(".lfg-pinned-right-header-row");
    expect(pinnedRightHeader).toBeTruthy();
    expect(pinnedRightHeader!.querySelector('[data-col-id="a"]')).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("pinColumn false unpins the column", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a", pinned: "left" },
      { field: "b" },
    ]);
    await flushRenders();

    expect(root().querySelector(".lfg-pinned-header-row")).toBeTruthy();

    grid.pinColumn("a", false);
    await flushRenders();

    expect(root().querySelector(".lfg-pinned-header-row")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("pinColumn emits column-pin:changed event", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    grid.pinColumn("a", "left");
    await flushRenders();

    expect(onColumnPinChanged).toHaveBeenCalledWith(
      expect.objectContaining({ field: "a", pinned: "left" }),
    );

    grid.destroy();
    container.remove();
  });

  it("pinColumn ignores pinnable: false columns", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a", pinnable: false }, { field: "b" }],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    grid.pinColumn("a", "left");
    await flushRenders();

    expect(onColumnPinChanged).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });

  it("no pin handle elements exist in header cells", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a" },
      { field: "b" },
    ]);
    await flushRenders();

    expect(root().querySelector(".lfg-pin-handle")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("unpinColumn unpins a pinned column", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a", pinned: "left" }, { field: "b" }],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    grid.unpinColumn("a");
    await flushRenders();

    expect(onColumnPinChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "a",
        pinned: false,
        previousPinned: "left",
      }),
    );

    grid.destroy();
    container.remove();
  });
});

describe("column pin state model API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("default pinned columns work from column defs", async () => {
    const { grid, container } = makeGrid([
      { field: "a", pinned: "left" },
      { field: "b", pinned: "right" },
      { field: "c" },
    ]);
    await flushRenders();

    const state = grid.getColumnPinState();
    expect(state).toEqual([
      { field: "a", pinned: "left" },
      { field: "b", pinned: "right" },
      { field: "c", pinned: false },
    ]);

    grid.destroy();
    container.remove();
  });

  it("getColumnPinState returns current pin state", async () => {
    const { grid, container } = makeGrid([
      { field: "a" },
      { field: "b" },
      { field: "c" },
    ]);
    await flushRenders();

    grid.pinColumn("b", "left");
    await flushRenders();

    const state = grid.getColumnPinState();
    const bState = state.find((s) => s.field === "b");
    expect(bState).toEqual({ field: "b", pinned: "left" });

    grid.destroy();
    container.remove();
  });

  it("setColumnPinState pins multiple columns in one call", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container, root } = makeGrid(
      [{ field: "a" }, { field: "b" }, { field: "c" }],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    grid.setColumnPinState([
      { field: "a", pinned: "left" },
      { field: "c", pinned: "right" },
    ]);
    await flushRenders();

    expect(onColumnPinChanged).toHaveBeenCalledTimes(1);

    const event = onColumnPinChanged.mock.calls[0][0];
    expect(event.changedColumns).toHaveLength(2);
    expect(event.changedColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "a", pinned: "left" }),
        expect.objectContaining({ field: "c", pinned: "right" }),
      ]),
    );

    const pinnedLeft = root().querySelector(".lfg-pinned-header-row");
    expect(pinnedLeft?.querySelector('[data-col-id="a"]')).toBeTruthy();

    const pinnedRight = root().querySelector(".lfg-pinned-right-header-row");
    expect(pinnedRight?.querySelector('[data-col-id="c"]')).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("setColumnPinState unpins omitted columns", async () => {
    const { grid, container, root } = makeGrid([
      { field: "a", pinned: "left" },
      { field: "b", pinned: "right" },
      { field: "c" },
    ]);
    await flushRenders();

    expect(root().querySelector(".lfg-pinned-header-row")).toBeTruthy();

    grid.setColumnPinState([{ field: "c", pinned: "left" }]);
    await flushRenders();

    const state = grid.getColumnPinState();
    expect(state.find((s) => s.field === "a")?.pinned).toBe(false);
    expect(state.find((s) => s.field === "b")?.pinned).toBe(false);
    expect(state.find((s) => s.field === "c")?.pinned).toBe("left");

    grid.destroy();
    container.remove();
  });

  it("clearColumnPinning unpins all pinnable columns", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container } = makeGrid(
      [
        { field: "a", pinned: "left" },
        { field: "b", pinned: "right" },
        { field: "c" },
      ],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    grid.clearColumnPinning();
    await flushRenders();

    expect(onColumnPinChanged).toHaveBeenCalledTimes(1);

    const state = grid.getColumnPinState();
    expect(state.every((s) => s.pinned === false)).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("pinnable: false columns are ignored by setColumnPinState", async () => {
    const { grid, container } = makeGrid([
      { field: "a", pinnable: false },
      { field: "b" },
    ]);
    await flushRenders();

    grid.setColumnPinState([
      { field: "a", pinned: "left" },
      { field: "b", pinned: "left" },
    ]);
    await flushRenders();

    const state = grid.getColumnPinState();
    expect(state.find((s) => s.field === "a")?.pinned).toBe(false);
    expect(state.find((s) => s.field === "b")?.pinned).toBe("left");

    grid.destroy();
    container.remove();
  });

  it("event source defaults to api", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    grid.pinColumn("a", "left");
    await flushRenders();

    expect(onColumnPinChanged.mock.calls[0][0].source).toBe("api");

    grid.destroy();
    container.remove();
  });

  it("event source can be overridden", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a" }, { field: "b" }],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    grid.pinColumn("a", "left", "ui");
    await flushRenders();

    expect(onColumnPinChanged.mock.calls[0][0].source).toBe("ui");

    grid.destroy();
    container.remove();
  });

  it("batch update emits one event not one per column", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a" }, { field: "b" }, { field: "c" }],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    grid.setColumnPinState([
      { field: "a", pinned: "left" },
      { field: "b", pinned: "right" },
    ]);
    await flushRenders();

    expect(onColumnPinChanged).toHaveBeenCalledTimes(1);
    expect(onColumnPinChanged.mock.calls[0][0].changedColumns).toHaveLength(2);

    grid.destroy();
    container.remove();
  });

  it("setColumnPinState with no changes does not emit event", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a", pinned: "left" }, { field: "b" }],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    grid.setColumnPinState([{ field: "a", pinned: "left" }]);
    await flushRenders();

    expect(onColumnPinChanged).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });

  it("getColumnPinState excludes internal selection column", async () => {
    const { grid, container } = makeGrid(
      [{ field: "a" }],
      [{ id: "r1", a: 1 }] as RowData[],
      {
        getRowId: (r: RowData) => (r as { id: string }).id,
        rowSelection: { mode: "multiple", checkboxes: true },
      },
    );
    await flushRenders();

    const state = grid.getColumnPinState();
    const fields = state.map((s) => s.field);
    expect(fields).not.toContain("__lfg_selection__");
    expect(fields).toContain("a");

    grid.destroy();
    container.remove();
  });

  it("columnPinState in event reflects final state after batch", async () => {
    const onColumnPinChanged = vi.fn();
    const { grid, container } = makeGrid(
      [{ field: "a" }, { field: "b" }, { field: "c" }],
      undefined,
      { onColumnPinChanged },
    );
    await flushRenders();

    grid.setColumnPinState([
      { field: "a", pinned: "left" },
      { field: "c", pinned: "right" },
    ]);
    await flushRenders();

    const event = onColumnPinChanged.mock.calls[0][0];
    expect(event.columnPinState).toEqual(
      expect.arrayContaining([
        { field: "a", pinned: "left" },
        { field: "b", pinned: false },
        { field: "c", pinned: "right" },
      ]),
    );

    grid.destroy();
    container.remove();
  });
});
