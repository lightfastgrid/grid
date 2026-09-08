// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { SELECTION_COLUMN_FIELD } from "../../../internal/selectionColumn";
import { CSS } from "../../../rendering/const/css-classes";
import type { WindowSyncContext } from "../../../rendering/ring-buffer/VirtualWindowSync";
import { VirtualWindowSync } from "../../../rendering/ring-buffer/VirtualWindowSync";
import type { RowData } from "../../../types";
import { DRAG_START_THRESHOLD_PX } from "../ColumnOrderController";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function headerFields(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll(`.${CSS.HEADER_CELL}[data-col-id]`),
  ).map((el) => el.getAttribute("data-col-id") ?? "");
}

function firstRowCellFields(root: HTMLElement): string[] {
  const row = root.querySelector(`.${CSS.ROW}[data-row-index="0"]`);
  if (!row) return [];
  return Array.from(
    row.querySelectorAll<HTMLElement>(`.${CSS.CELL}[data-col-id]`),
    (c) => c.getAttribute("data-col-id") ?? "",
  );
}

function mockHeaderRects(root: HTMLElement): void {
  const cells = Array.from(
    root.querySelectorAll<HTMLElement>(`.${CSS.HEADER_CELL}[data-col-id]`),
  );
  let x = 0;
  const w = 80;
  for (const el of cells) {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: x,
      width: w,
      top: 0,
      right: x + w,
      bottom: 32,
      height: 32,
      x,
      y: 0,
      toJSON: () => "",
    } as DOMRect);
    x += w;
  }
}

/** Find the drag handle for a given column field. */
function getDragHandle(root: HTMLElement, field: string): HTMLElement {
  const handle = root.querySelector<HTMLElement>(
    `.lfg-column-drag-handle[data-col-id="${field}"]`,
  );
  if (!handle) throw new Error(`No drag handle found for field "${field}"`);
  return handle;
}

function nudgeClientX(clientX: number): number {
  return clientX + DRAG_START_THRESHOLD_PX + 1;
}

describe("column order feature (grid wiring)", () => {
  it("row selection checkbox stays first header column when columnOrder is enabled", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "500px" });
    document.body.appendChild(container);

    const grid = new Grid({
      columnOrder: true,
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
      },
      columns: [
        { field: "a", width: 80 },
        { field: "b", width: 80 },
      ],
      rows: [{ id: "1", a: 1, b: 2 } as RowData],
      getRowId: (r) => (r as { id: string }).id,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    expect(headerFields(root)).toEqual([SELECTION_COLUMN_FIELD, "a", "b"]);
    expect(root.querySelector(".lfg-header-selection-checkbox")).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("defaultColDef reorderable false blocks drag unless column overrides true", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "500px" });
    document.body.appendChild(container);

    const grid = new Grid({
      columnOrder: true,
      defaultColDef: { reorderable: false },
      columns: [
        { field: "a", width: 80, reorderable: true },
        { field: "b", width: 80 },
      ],
      rows: [{ id: "1", a: 1, b: 2 } as RowData],
      getRowId: (r) => (r as { id: string }).id,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    mockHeaderRects(root);

    const bHeader = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="b"]`,
    );
    expect(bHeader).toBeTruthy();
    bHeader!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 30,
        clientX: 120,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 30,
        clientX: 400,
      }),
    );
    await flushRenders();
    expect(headerFields(root)).toEqual(["a", "b"]);

    const aHandle = getDragHandle(root, "a");
    aHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 31,
        clientX: 40,
        clientY: 0,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 31,
        clientX: nudgeClientX(40),
        clientY: 0,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 31,
        clientX: 250,
        clientY: 0,
      }),
    );
    await flushRenders();

    expect(headerFields(root)).toEqual(["b", "a"]);

    grid.destroy();
    container.remove();
  });

  it("regression: drag reorder updates DOM and VirtualWindowSync with re-transformed columns (not requestSync-only stale currentColumns)", async () => {
    const syncSpy = vi.spyOn(VirtualWindowSync.prototype, "sync");
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "500px" });
    document.body.appendChild(container);

    const grid = new Grid({
      columnOrder: true,
      columns: [
        { field: "a", width: 80 },
        { field: "b", width: 80 },
        { field: "c", width: 80 },
      ],
      rows: [{ id: "1", a: "A", b: "B", c: "C" } as RowData],
      getRowId: (r) => (r as { id: string }).id,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    mockHeaderRects(root);

    getDragHandle(root, "a").dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientX: 40,
        clientY: 0,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        clientX: nudgeClientX(40),
        clientY: 0,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 1,
        clientX: 250,
        clientY: 0,
      }),
    );

    await flushRenders();

    expect(headerFields(root)).toEqual(["b", "c", "a"]);
    expect(firstRowCellFields(root)).toEqual(["b", "c", "a"]);

    const sawReorderedContext = syncSpy.mock.calls.some((call) => {
      const ctx = call[0] as WindowSyncContext;
      return ctx.columns.map((c) => c.field).join(",") === "b,c,a";
    });
    expect(sawReorderedContext).toBe(true);

    syncSpy.mockRestore();
    grid.destroy();
    container.remove();
  });

  it("multi column selection: B and D move after F keeps selection on headers", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "240px", width: "900px" });
    document.body.appendChild(container);

    const grid = new Grid({
      columnOrder: true,
      columnSelection: { mode: "multiple" },
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
      },
      columns: ["a", "b", "c", "d", "e", "f"].map((field) => ({
        field,
        width: 72,
      })),
      rows: [
        {
          id: "1",
          a: 1,
          b: 2,
          c: 3,
          d: 4,
          e: 5,
          f: 6,
        } as RowData,
      ],
      getRowId: (r) => (r as { id: string }).id,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const bHdr = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="b"]`,
    );
    const dHdr = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="d"]`,
    );
    expect(bHdr).toBeTruthy();
    expect(dHdr).toBeTruthy();

    bHdr!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    dHdr!.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        button: 0,
        metaKey: true,
      }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(new Set(["b", "d"]));

    mockHeaderRects(root);

    getDragHandle(root, "d").dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 20,
        clientX: 80 * 4 + 40,
        clientY: 0,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 20,
        clientX: nudgeClientX(80 * 4 + 40),
        clientY: 0,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 20,
        clientX: 80 * 6 + 40,
        clientY: 0,
      }),
    );

    await flushRenders();

    const noSel = (id: string) => id !== SELECTION_COLUMN_FIELD;
    expect(headerFields(root).filter(noSel)).toEqual([
      "a",
      "c",
      "e",
      "f",
      "b",
      "d",
    ]);
    expect(firstRowCellFields(root).filter(noSel)).toEqual([
      "a",
      "c",
      "e",
      "f",
      "b",
      "d",
    ]);

    expect(
      root.querySelector(
        `.${CSS.HEADER_CELL}.lfg-column-selected[data-col-id="b"]`,
      ),
    ).toBeTruthy();
    expect(
      root.querySelector(
        `.${CSS.HEADER_CELL}.lfg-column-selected[data-col-id="d"]`,
      ),
    ).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("multi column selection: drag E and F to insertion slot 2 (before C)", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "240px", width: "900px" });
    document.body.appendChild(container);

    const grid = new Grid({
      columnOrder: true,
      columnSelection: { mode: "multiple" },
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
      },
      columns: ["a", "b", "c", "d", "e", "f"].map((field) => ({
        field,
        width: 72,
      })),
      rows: [
        {
          id: "1",
          a: 1,
          b: 2,
          c: 3,
          d: 4,
          e: 5,
          f: 6,
        } as RowData,
      ],
      getRowId: (r) => (r as { id: string }).id,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    root
      .querySelector<HTMLElement>(`.${CSS.HEADER_CELL}[data-col-id="e"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    root
      .querySelector<HTMLElement>(`.${CSS.HEADER_CELL}[data-col-id="f"]`)!
      .dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          button: 0,
          metaKey: true,
        }),
      );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(new Set(["e", "f"]));

    mockHeaderRects(root);

    getDragHandle(root, "e").dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 21,
        clientX: 80 * 4 + 40,
        clientY: 0,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 21,
        clientX: nudgeClientX(80 * 4 + 40),
        clientY: 0,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 21,
        clientX: 220,
        clientY: 0,
      }),
    );

    await flushRenders();

    const noSel = (id: string) => id !== SELECTION_COLUMN_FIELD;
    expect(headerFields(root).filter(noSel)).toEqual([
      "a",
      "b",
      "e",
      "f",
      "c",
      "d",
    ]);
    expect(firstRowCellFields(root).filter(noSel)).toEqual([
      "a",
      "b",
      "e",
      "f",
      "c",
      "d",
    ]);
    expect(
      root.querySelector(
        `.${CSS.HEADER_CELL}.lfg-column-selected[data-col-id="e"]`,
      ),
    ).toBeTruthy();
    expect(
      root.querySelector(
        `.${CSS.HEADER_CELL}.lfg-column-selected[data-col-id="f"]`,
      ),
    ).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("body cells receive opacity preview via generated stylesheet during drag, cleared on pointerup", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "600px" });
    document.body.appendChild(container);

    const grid = new Grid({
      columnOrder: true,
      columns: [
        { field: "a", width: 80 },
        { field: "b", width: 80 },
        { field: "c", width: 80 },
      ],
      rows: [{ id: "1", a: "A", b: "B", c: "C" } as RowData],
      getRowId: (r) => (r as { id: string }).id,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    mockHeaderRects(root);

    // No style element before drag.
    expect(
      document.head.querySelector("style[data-lfg-col-order-preview]"),
    ).toBeNull();

    getDragHandle(root, "a").dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 5001,
        clientX: 40,
        clientY: 0,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 5001,
        clientX: nudgeClientX(40),
        clientY: 0,
      }),
    );

    // Style element injected synchronously after drag threshold crossed.
    const styleEl = document.head.querySelector(
      "style[data-lfg-col-order-preview]",
    );
    expect(styleEl).toBeTruthy();
    expect(styleEl?.textContent).toContain('data-col-id="a"');
    expect(styleEl?.textContent).toContain(".lfg-cell");

    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 5001,
        clientX: nudgeClientX(40),
      }),
    );
    await flushRenders();

    // Style element removed after drag ends.
    expect(
      document.head.querySelector("style[data-lfg-col-order-preview]"),
    ).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("column header pointer tap + click selects without drag threshold", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "600px" });
    document.body.appendChild(container);

    const grid = new Grid({
      columnOrder: true,
      columnSelection: { mode: "multiple" },
      columns: [
        { field: "a", width: 80 },
        { field: "b", width: 80 },
      ],
      rows: [{ id: "1", a: 1, b: 2 } as RowData],
      getRowId: (r) => (r as { id: string }).id,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const aHdr = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="a"]`,
    );
    expect(aHdr).toBeTruthy();
    aHdr!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 7001,
        clientX: 120,
        clientY: 0,
      }),
    );
    aHdr!.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        pointerId: 7001,
        clientX: 120,
        clientY: 0,
      }),
    );
    aHdr!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toContain("a");

    grid.destroy();
    container.remove();
  });

  it("after real column drag, following header click is suppressed so selection does not toggle", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "600px" });
    document.body.appendChild(container);

    const grid = new Grid({
      columnOrder: true,
      columnSelection: { mode: "multiple" },
      columns: [
        { field: "a", width: 80 },
        { field: "b", width: 80 },
      ],
      rows: [{ id: "1", a: 1, b: 2 } as RowData],
      getRowId: (r) => (r as { id: string }).id,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    mockHeaderRects(root);

    const bHdr = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="b"]`,
    );
    expect(bHdr).toBeTruthy();
    bHdr!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();
    expect(grid.getSelectedColumnIds()).toContain("b");

    getDragHandle(root, "b").dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 7002,
        clientX: 200,
        clientY: 0,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 7002,
        clientX: nudgeClientX(200),
        clientY: 0,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 7002,
        clientX: 20,
        clientY: 0,
      }),
    );
    await flushRenders();

    expect(headerFields(root).filter((id) => id !== SELECTION_COLUMN_FIELD)).toEqual([
      "b",
      "a",
    ]);

    const selectedAfterDrag = new Set(grid.getSelectedColumnIds());
    expect(selectedAfterDrag.has("b")).toBe(true);

    const bHdrAfter = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="b"]`,
    );
    expect(bHdrAfter).toBeTruthy();
    bHdrAfter!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(selectedAfterDrag);

    grid.destroy();
    container.remove();
  });
});
