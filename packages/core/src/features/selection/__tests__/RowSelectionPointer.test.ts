// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { EAGER_CHANGED_ROW_CAP } from "../../../features/selection/createSelectionChangedEvent";
import { Grid } from "../../../Grid";
import { CSS } from "../../../rendering/const/css-classes";
import { ROW_HEIGHT } from "../../../rendering/helpers/gridConstants";
import type { RowData } from "../../../types";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function firstDataRow(container: HTMLElement): HTMLElement | null {
  return container.querySelector(`.${CSS.ROW}`);
}

function rowById(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector(`[data-row-id="${id}"]`) as HTMLElement | null;
}

function clickRow(
  el: HTMLElement,
  init: MouseEventInit = {},
): void {
  el.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    }),
  );
}

describe("row selection pointer modifiers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("single mode: plain click selected row deselects", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "a" }, { id: "b" }] as RowData[],
      columns: [{ field: "id" }],
      rowSelection: "single",
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const ra = rowById(container, "a")!;
    clickRow(ra);
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["a"]);

    clickRow(ra);
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("multiple mode: plain click selected row deselects only that row", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: "a", n: 0 },
        { id: "b", n: 1 },
      ] as RowData[],
      columns: [{ field: "n" }],
      rowSelection: "multiple",
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    clickRow(rowById(container, "a")!);
    clickRow(rowById(container, "b")!, { ctrlKey: true });
    await flushRenders();
    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(["a", "b"]));

    clickRow(rowById(container, "a")!);
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["b"]);

    grid.destroy();
    container.remove();
  });

  it("multiple mode: plain click another row replaces previous selection", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: "a", n: 0 },
        { id: "b", n: 1 },
      ] as RowData[],
      columns: [{ field: "n" }],
      rowSelection: "multiple",
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    clickRow(rowById(container, "a")!);
    await flushRenders();
    clickRow(rowById(container, "b")!);
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["b"]);

    grid.destroy();
    container.remove();
  });

  it("multiple mode: Ctrl/Cmd click toggles rows independently", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: "a", n: 0 },
        { id: "b", n: 1 },
        { id: "c", n: 2 },
      ] as RowData[],
      columns: [{ field: "n" }],
      rowSelection: "multiple",
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    clickRow(rowById(container, "a")!);
    await flushRenders();
    clickRow(rowById(container, "c")!, { metaKey: true });
    await flushRenders();
    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(["a", "c"]));

    clickRow(rowById(container, "a")!, { ctrlKey: true });
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["c"]);

    grid.destroy();
    container.remove();
  });

  it("multiple mode: Shift+click selects contiguous range from anchor", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "240px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: ["r0", "r1", "r2", "r3", "r4"].map((id) => ({ id, n: id })) as RowData[],
      columns: [{ field: "n" }],
      rowSelection: "multiple",
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    clickRow(rowById(container, "r1")!);
    await flushRenders();
    clickRow(rowById(container, "r4")!, { shiftKey: true });
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["r1", "r2", "r3", "r4"]);

    grid.destroy();
    container.remove();
  });

  it("multiple mode: Ctrl+Shift adds range to existing selection", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "240px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: ["r0", "r1", "r2", "r3", "r4"].map((id) => ({ id, n: id })) as RowData[],
      columns: [{ field: "n" }],
      rowSelection: "multiple",
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    clickRow(rowById(container, "r0")!);
    await flushRenders();
    clickRow(rowById(container, "r4")!, { ctrlKey: true });
    await flushRenders();
    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(["r0", "r4"]));

    clickRow(rowById(container, "r2")!, { ctrlKey: true, shiftKey: true });
    await flushRenders();
    expect(new Set(grid.getSelectedRowIds())).toEqual(
      new Set(["r0", "r2", "r3", "r4"]),
    );

    grid.destroy();
    container.remove();
  });

  it("checkbox sets anchor so subsequent Shift+body-click ranges from it", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: "a", n: 0 },
        { id: "b", n: 1 },
      ] as RowData[],
      columns: [{ field: "n" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        enableRowClickSelection: true,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    (rowById(container, "a")!.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement).click();
    (rowById(container, "b")!.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement).click();
    await flushRenders();
    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(["a", "b"]));

    // Shift+body-click on b: anchor is b (set by last checkbox click),
    // so range b–b replaces selection with just b.
    clickRow(rowById(container, "b")!, { shiftKey: true });
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["b"]);

    grid.destroy();
    container.remove();
  });

  it("single mode ignores Ctrl/Shift (same as plain)", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: "a", n: 0 },
        { id: "b", n: 1 },
      ] as RowData[],
      columns: [{ field: "n" }],
      rowSelection: "single",
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    clickRow(rowById(container, "a")!);
    await flushRenders();
    clickRow(rowById(container, "b")!, { ctrlKey: true, shiftKey: true });
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["b"]);

    grid.destroy();
    container.remove();
  });

  it("plain checkbox click toggles one row", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: "r1", n: 0 },
        { id: "r2", n: 1 },
        { id: "r3", n: 2 },
      ] as RowData[],
      columns: [{ field: "n" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        enableRowClickSelection: false,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const cb1 = rowById(container, "r1")!.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement;
    cb1.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    // Toggle off
    cb1.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("Shift+checkbox selects inclusive range from anchor", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: "r1", n: 0 },
        { id: "r2", n: 1 },
        { id: "r3", n: 2 },
        { id: "r4", n: 3 },
        { id: "r5", n: 4 },
        { id: "r6", n: 5 },
      ] as RowData[],
      columns: [{ field: "n" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        enableRowClickSelection: false,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    // Click checkbox on r1 → sets anchor
    const cb1 = rowById(container, "r1")!.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement;
    cb1.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();

    // Shift+click checkbox on r6 → select range r1–r6
    const cb6 = rowById(container, "r6")!.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement;
    cb6.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        shiftKey: true,
      }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedRowIds())).toEqual(
      new Set(["r1", "r2", "r3", "r4", "r5", "r6"]),
    );

    grid.destroy();
    container.remove();
  });

  it("Ctrl+Shift+checkbox adds range to existing selection", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: "r1", n: 0 },
        { id: "r2", n: 1 },
        { id: "r3", n: 2 },
        { id: "r4", n: 3 },
        { id: "r5", n: 4 },
      ] as RowData[],
      columns: [{ field: "n" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        enableRowClickSelection: false,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    // Plain checkbox on r1
    const cb1 = rowById(container, "r1")!.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement;
    cb1.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();

    // Plain checkbox on r4 → toggles r4, sets new anchor
    const cb4 = rowById(container, "r4")!.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement;
    cb4.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();
    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(["r1", "r4"]));

    // Ctrl+Shift+checkbox on r2 → adds range r2–r4 to existing
    const cb2 = rowById(container, "r2")!.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement;
    cb2.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        shiftKey: true,
        ctrlKey: true,
      }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedRowIds())).toEqual(
      new Set(["r1", "r2", "r3", "r4"]),
    );

    grid.destroy();
    container.remove();
  });

  it("Shift+checkbox with no anchor behaves like plain toggle", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: "r1", n: 0 },
        { id: "r2", n: 1 },
        { id: "r3", n: 2 },
      ] as RowData[],
      columns: [{ field: "n" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        enableRowClickSelection: false,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    // Shift+click checkbox on r2 with no prior anchor → toggles r2
    const cb2 = rowById(container, "r2")!.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement;
    cb2.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        shiftKey: true,
      }),
    );
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["r2"]);

    // Now anchor is set at r2 — Shift+click r3 should range r2–r3
    const cb3 = rowById(container, "r3")!.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement;
    cb3.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        shiftKey: true,
      }),
    );
    await flushRenders();
    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(["r2", "r3"]));

    grid.destroy();
    container.remove();
  });

  it("Escape clear still clears row selection (input feature)", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "x", n: 1 }] as RowData[],
      columns: [{ field: "n" }],
      rowSelection: "single",
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const surface = container.querySelector(".lfg-grid-surface") as HTMLElement;
    const row = firstDataRow(container)!;
    row.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
    );
    clickRow(row);
    await flushRenders();
    // Pointer focus targets the surface; the Escape keydown still bubbles to the
    // input listener delegated on the outer root.
    expect(document.activeElement).toBe(surface);

    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("virtualization: shift range restores row selected class after scroll", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "120px", width: "400px" });
    document.body.appendChild(container);

    const rows = Array.from({ length: 80 }, (_, i) => ({
      id: `s${i}`,
      n: i,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [{ field: "n" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        enableRowClickSelection: true,
      },
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    clickRow(rowById(container, "s0")!);
    await flushRenders();

    viewport.scrollTop = 25 * ROW_HEIGHT;
    await flushRenders();
    await flushRenders();
    const s10 = rowById(container, "s10");
    expect(s10).toBeTruthy();
    clickRow(s10!, { shiftKey: true });
    await flushRenders();

    expect(grid.getSelectedRowIds().length).toBe(11);
    expect(new Set(grid.getSelectedRowIds())).toEqual(
      new Set(Array.from({ length: 11 }, (_, i) => `s${i}`)),
    );

    viewport.scrollTop = 0;
    await flushRenders();
    await flushRenders();
    const s0el = rowById(container, "s0");
    expect(s0el?.classList.contains("lfg-row-selected")).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("large shift range: changedRowIds can exceed eager cap; changedRows stays empty", async () => {
    const onSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "400px" });
    document.body.appendChild(container);

    const rows = Array.from({ length: 320 }, (_, i) => ({
      id: `z${i}`,
      n: i,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [{ field: "n" }],
      rowSelection: "multiple",
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
      onSelectionChanged,
    });
    grid.mount(container);
    await flushRenders();

    clickRow(rowById(container, "z0")!);
    await flushRenders();
    onSelectionChanged.mockClear();

    clickRow(rowById(container, "z319")!, { shiftKey: true });
    await flushRenders();

    expect(onSelectionChanged).toHaveBeenCalledTimes(1);
    const e = onSelectionChanged.mock.calls[0]![0];
    expect(e.changedRowIds.length).toBeGreaterThan(EAGER_CHANGED_ROW_CAP);
    expect(e.changedRows.length).toBe(0);

    grid.destroy();
    container.remove();
  });

  it("shift-click preserves anchor: click r1, shift r3, shift r5 => r1-r5", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "400px" });
    document.body.appendChild(container);

    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i + 1}`, v: i })) as RowData[];
    const grid = new Grid({
      rows,
      columns: [{ field: "v" }],
      getRowId: (r) => (r as { id: string }).id,
      rowSelection: { mode: "multiple", enableRowClickSelection: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    clickRow(rowById(container, "r1")!);
    clickRow(rowById(container, "r3")!, { shiftKey: true });
    clickRow(rowById(container, "r5")!, { shiftKey: true });
    await flushRenders();

    expect(new Set(grid.getSelectedRowIds())).toEqual(
      new Set(["r1", "r2", "r3", "r4", "r5"]),
    );

    grid.destroy();
    container.remove();
  });

  it("shift-click keeps expanded Shift range: click r2, shift r5, shift r4 => r2-r5", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "400px" });
    document.body.appendChild(container);

    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i + 1}`, v: i })) as RowData[];
    const grid = new Grid({
      rows,
      columns: [{ field: "v" }],
      getRowId: (r) => (r as { id: string }).id,
      rowSelection: { mode: "multiple", enableRowClickSelection: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    clickRow(rowById(container, "r2")!);
    clickRow(rowById(container, "r5")!, { shiftKey: true });
    clickRow(rowById(container, "r4")!, { shiftKey: true });
    await flushRenders();

    expect(new Set(grid.getSelectedRowIds())).toEqual(
      new Set(["r2", "r3", "r4", "r5"]),
    );

    grid.destroy();
    container.remove();
  });

  it("ctrl-click sets anchor, shift-click ranges from it", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "400px" });
    document.body.appendChild(container);

    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i + 1}`, v: i })) as RowData[];
    const grid = new Grid({
      rows,
      columns: [{ field: "v" }],
      getRowId: (r) => (r as { id: string }).id,
      rowSelection: { mode: "multiple", enableRowClickSelection: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    clickRow(rowById(container, "r1")!);
    clickRow(rowById(container, "r5")!, { ctrlKey: true });
    clickRow(rowById(container, "r3")!, { shiftKey: true });
    await flushRenders();

    expect(new Set(grid.getSelectedRowIds())).toEqual(
      new Set(["r3", "r4", "r5"]),
    );

    grid.destroy();
    container.remove();
  });

  it("shift+ctrl repeated range keeps original anchor", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "400px" });
    document.body.appendChild(container);

    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i + 1}`, v: i })) as RowData[];
    const grid = new Grid({
      rows,
      columns: [{ field: "v" }],
      getRowId: (r) => (r as { id: string }).id,
      rowSelection: { mode: "multiple", enableRowClickSelection: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    clickRow(rowById(container, "r2")!);
    clickRow(rowById(container, "r3")!, { shiftKey: true, ctrlKey: true });
    clickRow(rowById(container, "r5")!, { shiftKey: true, ctrlKey: true });
    await flushRenders();

    expect(new Set(grid.getSelectedRowIds())).toEqual(
      new Set(["r2", "r3", "r4", "r5"]),
    );

    grid.destroy();
    container.remove();
  });
});
