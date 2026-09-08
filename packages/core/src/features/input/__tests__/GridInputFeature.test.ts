// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { CSS } from "../../../rendering/const/css-classes";
import type { RowData } from "../../../types";

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

function firstDataRow(container: HTMLElement): HTMLElement | null {
  return container.querySelector(`.${CSS.ROW}`);
}

function pointerDown(el: Element): PointerEvent {
  const event = new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  el.dispatchEvent(event);
  return event;
}

/** Dispatch Escape from the currently focused element (real key path). */
function escapeFromFocus(): void {
  const focused = document.activeElement;
  expect(focused).toBeTruthy();
  focused!.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("grid input feature (keyboard)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("grid surface is focusable (tabIndex 0) after mount; outer root is not", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const surface = container.querySelector(".lfg-grid-surface") as HTMLElement;
    expect(surface.tabIndex).toBe(0);
    expect(root.hasAttribute("tabindex")).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("after pointer + click on data row, grid root is focused and Escape clears row selection with keyboard source", async () => {
    const onSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "r1", a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      rowSelection: "single",
      getRowId: (r) => (r as { id: string }).id,
      onSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const surface = container.querySelector(".lfg-grid-surface") as HTMLElement;
    const row = firstDataRow(container)!;

    const focusSpy = vi.spyOn(surface, "focus");
    expect(pointerDown(row).defaultPrevented).toBe(true);
    expect(focusSpy).toHaveBeenCalledWith(
      expect.objectContaining({ preventScroll: true, focusVisible: false }),
    );
    row.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();
    expect(document.activeElement).toBe(surface);

    onSelectionChanged.mockClear();
    escapeFromFocus();
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual([]);
    expect(onSelectionChanged).toHaveBeenCalledTimes(1);
    expect(onSelectionChanged.mock.calls[0]![0].source).toBe("keyboard");

    grid.destroy();
    container.remove();
  });

  it("after pointer + click on column header, grid root is focused and Escape clears column selection with keyboard source", async () => {
    const onColumnSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      columnSelection: true,
      onColumnSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const surface = container.querySelector(".lfg-grid-surface") as HTMLElement;
    const h = headerCell(root, "a")!;

    expect(pointerDown(h).defaultPrevented).toBe(true);
    h.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await flushRenders();
    expect(document.activeElement).toBe(surface);

    onColumnSelectionChanged.mockClear();
    escapeFromFocus();
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual([]);
    expect(onColumnSelectionChanged).toHaveBeenCalledTimes(1);
    expect(onColumnSelectionChanged.mock.calls[0]![0].source).toBe("keyboard");

    grid.destroy();
    container.remove();
  });

  it("row selection checkbox: Escape still clears row selection (keyboard source)", async () => {
    const onSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "r1", v: 1 }] as RowData[],
      columns: [{ field: "v" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        enableRowClickSelection: false,
      },
      getRowId: (r) => (r as { id: string }).id,
      onSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    // Checkbox is in center row (unpinned by default)
    const cb = container.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement;
    expect(cb).toBeTruthy();

    expect(pointerDown(cb).defaultPrevented).toBe(false);
    cb.click();
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    onSelectionChanged.mockClear();
    escapeFromFocus();
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual([]);
    expect(onSelectionChanged).toHaveBeenCalledTimes(1);
    expect(onSelectionChanged.mock.calls[0]![0].source).toBe("keyboard");

    grid.destroy();
    container.remove();
  });

  it("header selection checkbox: Escape still clears row selection (keyboard source)", async () => {
    const onSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "280px", width: "480px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: "h0", v: 0 },
        { id: "h1", v: 1 },
      ] as RowData[],
      columns: [{ field: "v" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
      },
      getRowId: (r) => (r as { id: string }).id,
      onSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const headerCb = container.querySelector(
      ".lfg-header-selection-checkbox",
    ) as HTMLInputElement;
    expect(headerCb).toBeTruthy();

    expect(pointerDown(headerCb).defaultPrevented).toBe(false);
    headerCb.click();
    await flushRenders();
    expect(grid.getSelectedRowIds().length).toBeGreaterThan(0);

    onSelectionChanged.mockClear();
    escapeFromFocus();
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual([]);
    expect(onSelectionChanged).toHaveBeenCalledTimes(1);
    expect(onSelectionChanged.mock.calls[0]![0].source).toBe("keyboard");

    grid.destroy();
    container.remove();
  });

  it("Escape clears both row and column selection once each when both are selected", async () => {
    const onSelectionChanged = vi.fn();
    const onColumnSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "r1", a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      rowSelection: "single",
      getRowId: (r) => (r as { id: string }).id,
      columnSelection: true,
      onSelectionChanged,
      onColumnSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const surface = container.querySelector(".lfg-grid-surface") as HTMLElement;
    const row = firstDataRow(container)!;
    const h = headerCell(root, "a")!;

    pointerDown(row);
    row.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    pointerDown(h);
    h.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await flushRenders();
    expect(document.activeElement).toBe(surface);

    onSelectionChanged.mockClear();
    onColumnSelectionChanged.mockClear();
    escapeFromFocus();
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual([]);
    expect(grid.getSelectedColumnIds()).toEqual([]);
    expect(onSelectionChanged).toHaveBeenCalledTimes(1);
    expect(onColumnSelectionChanged).toHaveBeenCalledTimes(1);
    expect(onSelectionChanged.mock.calls[0]![0].source).toBe("keyboard");
    expect(onColumnSelectionChanged.mock.calls[0]![0].source).toBe("keyboard");

    grid.destroy();
    container.remove();
  });

  it("Escape emits nothing when nothing is selected (focused root)", async () => {
    const onSelectionChanged = vi.fn();
    const onColumnSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "r1", a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      rowSelection: "single",
      getRowId: (r) => (r as { id: string }).id,
      columnSelection: true,
      onSelectionChanged,
      onColumnSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const surface = container.querySelector(".lfg-grid-surface") as HTMLElement;
    surface.focus();
    expect(document.activeElement).toBe(surface);

    escapeFromFocus();
    await flushRenders();

    expect(onSelectionChanged).not.toHaveBeenCalled();
    expect(onColumnSelectionChanged).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });

  it("Escape inside text input does not clear grid selection", async () => {
    const onSelectionChanged = vi.fn();
    const onColumnSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "r1", a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      rowSelection: "single",
      getRowId: (r) => (r as { id: string }).id,
      columnSelection: true,
      onSelectionChanged,
      onColumnSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const row = firstDataRow(container)!;
    pointerDown(row);
    row.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    const h = headerCell(root, "a")!;
    pointerDown(h);
    h.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await flushRenders();

    const input = document.createElement("input");
    input.type = "text";
    root.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    onSelectionChanged.mockClear();
    onColumnSelectionChanged.mockClear();

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual(["r1"]);
    expect(grid.getSelectedColumnIds()).toEqual(["a"]);
    expect(onSelectionChanged).not.toHaveBeenCalled();
    expect(onColumnSelectionChanged).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });

  it("Escape inside textarea, select, or contenteditable does not clear grid selection", async () => {
    for (const kind of ["textarea", "select", "contenteditable"] as const) {
      const onSelectionChanged = vi.fn();
      const onColumnSelectionChanged = vi.fn();
      const container = document.createElement("div");
      Object.assign(container.style, { height: "260px", width: "440px" });
      document.body.appendChild(container);

      const grid = new Grid({
        rows: [{ id: "r1", a: 1 }] as RowData[],
        columns: [{ field: "a" }],
        rowSelection: "single",
        getRowId: (r) => (r as { id: string }).id,
        columnSelection: true,
        onSelectionChanged,
        onColumnSelectionChanged,
        suppressRowVirtualization: true,
        suppressColumnVirtualization: true,
      });
      grid.mount(container);
      await flushRenders();

      const root = container.querySelector(".lfg-grid") as HTMLElement;
      const row = firstDataRow(container)!;
      pointerDown(row);
      row.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
      const h = headerCell(root, "a")!;
      pointerDown(h);
      h.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      await flushRenders();

      let editorEl: HTMLElement;
      if (kind === "textarea") {
        editorEl = document.createElement("textarea");
      } else if (kind === "select") {
        editorEl = document.createElement("select");
        editorEl.appendChild(document.createElement("option"));
      } else {
        editorEl = document.createElement("div");
        editorEl.setAttribute("contenteditable", "true");
      }
      root.appendChild(editorEl);
      editorEl.focus();
      expect(document.activeElement).toBe(editorEl);

      onSelectionChanged.mockClear();
      onColumnSelectionChanged.mockClear();

      editorEl.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await flushRenders();

      expect(grid.getSelectedRowIds()).toEqual(["r1"]);
      expect(grid.getSelectedColumnIds()).toEqual(["a"]);
      expect(onSelectionChanged).not.toHaveBeenCalled();
      expect(onColumnSelectionChanged).not.toHaveBeenCalled();

      grid.destroy();
      container.remove();
    }
  });

  it("grid.clearSelection still emits source api", async () => {
    const onSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "r1", a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      rowSelection: "single",
      getRowId: (r) => (r as { id: string }).id,
      onSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const row = firstDataRow(container)!;
    pointerDown(row);
    row.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();
    onSelectionChanged.mockClear();

    grid.clearSelection();
    await flushRenders();

    expect(onSelectionChanged).toHaveBeenCalledTimes(1);
    expect(onSelectionChanged.mock.calls[0]![0].source).toBe("api");

    grid.destroy();
    container.remove();
  });

  it("grid.clearColumnSelection still emits source api", async () => {
    const onColumnSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      columnSelection: true,
      onColumnSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const h = headerCell(root, "a")!;
    pointerDown(h);
    h.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await flushRenders();
    onColumnSelectionChanged.mockClear();

    grid.clearColumnSelection();
    await flushRenders();

    expect(onColumnSelectionChanged).toHaveBeenCalledTimes(1);
    expect(onColumnSelectionChanged.mock.calls[0]![0].source).toBe("api");

    grid.destroy();
    container.remove();
  });
});
