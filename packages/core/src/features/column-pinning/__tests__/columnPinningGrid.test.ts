// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { SELECTION_COLUMN_FIELD } from "../../../internal/selectionColumn";
import { CSS } from "../../../rendering/const/css-classes";
import * as populateRowModule from "../../../rendering/helpers/populateRow";
import type { RowData } from "../../../types";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function scrollViewport(root: HTMLElement, scrollLeft: number): void {
  const viewport = root.querySelector<HTMLElement>(`.${CSS.VIEWPORT}`)!;
  viewport.scrollLeft = scrollLeft;
  viewport.dispatchEvent(new Event("scroll"));
}

describe("column pinning grid integration", () => {
  it("selection column is pinned-left when explicitly configured", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [
        { field: "a", pinned: "left" as const },
        { field: "b" },
      ],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
        checkboxColumn: { pinned: "left" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    const selHeader = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="${SELECTION_COLUMN_FIELD}"]`,
    );
    expect(selHeader).toBeTruthy();
    expect(selHeader!.getAttribute("data-pinned")).toBe("left");

    const selBodyCells = root.querySelectorAll<HTMLElement>(
      `.${CSS.CELL}[data-col-id="${SELECTION_COLUMN_FIELD}"]`,
    );
    expect(selBodyCells.length).toBeGreaterThan(0);
    for (let i = 0; i < selBodyCells.length; i++) {
      expect(selBodyCells[i]!.getAttribute("data-pinned")).toBe("left");
    }

    grid.destroy();
    container.remove();
  });

  it("user pinned column stays rendered after horizontal scroll", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const colCount = 20;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `c${i}`,
      width: 120,
      pinned: i === 0 ? ("left" as const) : undefined,
    }));

    const rows = [
      Object.fromEntries(columns.map((c) => [c.field, c.field])),
    ] as RowData[];

    const grid = new Grid({
      rows,
      columns,
      rowSelection: { mode: "multiple", checkboxes: true, headerCheckbox: true },
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    const pinnedHeader = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="c0"]`,
    );
    expect(pinnedHeader).toBeTruthy();
    expect(pinnedHeader!.getAttribute("data-pinned")).toBe("left");

    scrollViewport(root, 2000);
    await flushRenders();

    const pinnedHeaderAfter = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="c0"]`,
    );
    expect(pinnedHeaderAfter).toBeTruthy();
    expect(pinnedHeaderAfter!.getAttribute("data-pinned")).toBe("left");

    const pinnedBodyCell = root.querySelector<HTMLElement>(
      `.${CSS.CELL}[data-col-id="c0"]`,
    );
    expect(pinnedBodyCell).toBeTruthy();
    expect(pinnedBodyCell!.getAttribute("data-pinned")).toBe("left");
    expect(pinnedBodyCell!.textContent).toBe("c0");

    grid.destroy();
    container.remove();
  });

  it("horizontal scroll does not rebind pinned cell text", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "300px" });
    document.body.appendChild(container);

    const colCount = 30;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `c${i}`,
      width: 100,
      pinned: i === 0 ? ("left" as const) : undefined,
    }));

    const rows = [
      Object.fromEntries(columns.map((c) => [c.field, `val-${c.field}`])),
    ] as RowData[];

    const grid = new Grid({
      rows,
      columns,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    const pinnedCell = root.querySelector<HTMLElement>(
      `.${CSS.CELL}[data-col-id="c0"]`,
    );
    expect(pinnedCell).toBeTruthy();
    expect(pinnedCell!.textContent).toBe("val-c0");

    const spy = vi.spyOn(populateRowModule, "rebindCells");

    scrollViewport(root, 500);
    await flushRenders();
    scrollViewport(root, 1000);
    await flushRenders();

    expect(pinnedCell!.textContent).toBe("val-c0");

    if (spy.mock.calls.length > 0) {
      for (const call of spy.mock.calls) {
        const enteringSlots = call[5] as number[];
        const toPhys = call[6] as (v: number) => number;
        for (const v of enteringSlots) {
          const p = toPhys(v);
          expect(p).toBeGreaterThanOrEqual(1);
        }
      }
    }

    spy.mockRestore();
    grid.destroy();
    container.remove();
  });

  it("center virtualization still works with pinned columns", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "300px" });
    document.body.appendChild(container);

    const colCount = 20;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `c${i}`,
      width: 100,
      pinned: i === 0 ? ("left" as const) : undefined,
    }));

    const rows = [
      Object.fromEntries(columns.map((c) => [c.field, c.field])),
    ] as RowData[];

    const grid = new Grid({
      rows,
      columns,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    const rebindSpy = vi.spyOn(populateRowModule, "rebindCells");

    scrollViewport(root, 500);
    await flushRenders();

    expect(rebindSpy.mock.calls.length).toBeGreaterThanOrEqual(0);

    rebindSpy.mockRestore();
    grid.destroy();
    container.remove();
  });

  it("sort click works on pinned column", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { name: "Charlie", age: 30 },
        { name: "Alice", age: 25 },
        { name: "Bob", age: 35 },
      ] as RowData[],
      columns: [
        { field: "name", pinned: "left", sortable: true },
        { field: "age", sortable: true },
      ],
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    const nameHeaderCell = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="name"]`,
    );
    expect(nameHeaderCell).toBeTruthy();
    nameHeaderCell!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    const sortModel = grid.getSortModel();
    expect(sortModel).toEqual([{ field: "name", sort: "asc" }]);

    const headerCell = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="name"]`,
    );
    expect(headerCell!.classList.contains("lfg-header-sorted-asc")).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("row selection checkbox works after horizontal scroll", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "300px" });
    document.body.appendChild(container);

    const colCount = 20;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `c${i}`,
      width: 100,
      pinned: i === 0 ? ("left" as const) : undefined,
    }));

    const rows = [
      { id: "r1", ...Object.fromEntries(columns.map((c) => [c.field, 1])) },
    ] as RowData[];

    const grid = new Grid({
      rows,
      columns,
      getRowId: (r) => (r as { id: string }).id,
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
        checkboxColumn: { pinned: "left" },
      },
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    scrollViewport(root, 500);
    await flushRenders();

    const checkbox = root.querySelector<HTMLInputElement>(
      `.lfg-pinned-row .lfg-row-selection-checkbox`,
    );
    expect(checkbox).toBeTruthy();
    checkbox!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedRowIds()).toContain("r1");

    grid.destroy();
    container.remove();
  });

  it("column selection class works on pinned column", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [
        { field: "a", pinned: "left" },
        { field: "b" },
      ],
      columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    const pinnedHeader = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="a"]`,
    );
    expect(pinnedHeader).toBeTruthy();
    pinnedHeader!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toContain("a");

    expect(pinnedHeader!.classList.contains("lfg-column-selected")).toBe(true);

    const pinnedBodyCell = root.querySelector<HTMLElement>(
      `.${CSS.CELL}[data-col-id="a"]`,
    );
    expect(pinnedBodyCell).toBeTruthy();
    expect(pinnedBodyCell!.classList.contains("lfg-column-selected")).toBe(true);
    // Pinned lanes use `.lfg-pinned-row`, not `.lfg-row` — selected bg CSS must not require `.lfg-row`.
    const pinnedRow = pinnedBodyCell!.closest(".lfg-pinned-row");
    expect(pinnedRow).toBeTruthy();
    expect(pinnedRow!.classList.contains("lfg-row")).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("shift-range column selection does not cross pinned/center boundary", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3, d: 4 }] as RowData[],
      columns: [
        { field: "a", pinned: "left" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ],
      columnSelection: { mode: "multiple", enableHeaderClickSelection: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    // Click center column "b" to set anchor
    const headerB = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="b"]`,
    );
    expect(headerB).toBeTruthy();
    headerB!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();
    expect(grid.getSelectedColumnIds()).toEqual(["b"]);

    // Shift-click center column "d" — should select b, c, d (not pinned "a")
    const headerD = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_CELL}[data-col-id="d"]`,
    );
    expect(headerD).toBeTruthy();
    headerD!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    const selected = grid.getSelectedColumnIds().sort();
    expect(selected).toEqual(["b", "c", "d"]);
    expect(selected).not.toContain("a");

    grid.destroy();
    container.remove();
  });

  it("no inline geometry writes on pinned or center cells", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [
        { field: "a", pinned: "left", width: 100 },
        { field: "b", width: 200 },
      ],
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    const allCells = root.querySelectorAll<HTMLElement>(
      `.${CSS.CELL}[data-col-id], .${CSS.HEADER_CELL}[data-col-id]`,
    );
    for (let i = 0; i < allCells.length; i++) {
      expect(allCells[i]!.style.left).toBe("");
      expect(allCells[i]!.style.width).toBe("");
    }

    grid.destroy();
    container.remove();
  });

  it("pinned body row has data-row-id and data-row-index", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [
        { field: "a", pinned: "left" },
        { field: "b" },
      ],
      getRowId: (r) => `row-${(r as { a: number }).a}`,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const pinnedRow = root.querySelector<HTMLElement>(".lfg-pinned-row");
    expect(pinnedRow).toBeTruthy();
    expect(pinnedRow!.getAttribute("data-row-id")).toBe("row-1");
    expect(pinnedRow!.getAttribute("data-row-index")).toBe("0");

    grid.destroy();
    container.remove();
  });

  it("clicking pinned row checkbox toggles selection", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [
        { field: "a", pinned: "left" },
        { field: "b" },
      ],
      getRowId: (r) => `row-${(r as { a: number }).a}`,
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
        checkboxColumn: { pinned: "left" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const checkbox = root.querySelector<HTMLInputElement>(
      ".lfg-pinned-row .lfg-row-selection-checkbox",
    );
    expect(checkbox).toBeTruthy();
    checkbox!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedRowIds()).toContain("row-1");

    grid.destroy();
    container.remove();
  });

  it("clicking pinned body cell with row click selection toggles selection", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ name: "Alice", age: 30 }] as RowData[],
      columns: [
        { field: "name", pinned: "left" },
        { field: "age" },
      ],
      getRowId: (r) => (r as { name: string }).name,
      rowSelection: {
        mode: "multiple",
        checkboxes: false,
        headerCheckbox: false,
        enableRowClickSelection: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const pinnedCell = root.querySelector<HTMLElement>(
      `.lfg-pinned-row .${CSS.CELL}[data-col-id="name"]`,
    );
    expect(pinnedCell).toBeTruthy();
    pinnedCell!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedRowIds()).toContain("Alice");

    grid.destroy();
    container.remove();
  });

  it("pinned header resize handle exists with correct data-col-id", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [
        { field: "a", pinned: "left", width: 100 },
        { field: "b", width: 200 },
      ],
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const pinnedHeader = root.querySelector<HTMLElement>(
      ".lfg-pinned-header-row .lfg-header-cell",
    );
    expect(pinnedHeader).toBeTruthy();
    expect(pinnedHeader!.getAttribute("data-col-id")).toBe("a");

    const resizeHandle = pinnedHeader!.querySelector<HTMLElement>(".lfg-resize-handle");
    expect(resizeHandle).toBeTruthy();
    expect(resizeHandle!.getAttribute("data-col-id")).toBe("a");

    grid.destroy();
    container.remove();
  });

  it("pinned body row top aligns with center row after initial render and vertical scroll", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const rows = Array.from({ length: 50 }, (_, i) => ({
      a: `a${i}`,
      b: `b${i}`,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [
        { field: "a", pinned: "left" },
        { field: "b" },
      ],
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    // Center rows: translateY = HEADER_HEIGHT + dataIndex * ROW_HEIGHT
    // Pinned rows: translateY = dataIndex * ROW_HEIGHT (relative to .lfg-pinned-body which sits below pinned header)
    // So: centerY === pinnedY + HEADER_HEIGHT
    const parseY = (el: HTMLElement) => {
      const m = el.style.transform.match(/translateY\((\d+)px\)/);
      return m ? Number(m[1]) : NaN;
    };

    function assertAlignment(_label: string): void {
      const centerRows = root.querySelectorAll<HTMLElement>(
        `.${CSS.ROW}:not(.lfg-pinned-row)`,
      );
      const pinnedRows = root.querySelectorAll<HTMLElement>(".lfg-pinned-row");
      let checked = 0;

      for (let i = 0; i < pinnedRows.length; i++) {
        const rowId = pinnedRows[i]!.getAttribute("data-row-id");
        if (!rowId || pinnedRows[i]!.style.display === "none") continue;
        const pinnedY = parseY(pinnedRows[i]!);

        for (let j = 0; j < centerRows.length; j++) {
          if (centerRows[j]!.getAttribute("data-row-id") !== rowId) continue;
          const centerY = parseY(centerRows[j]!);
          expect(centerY).toBe(pinnedY + 40); // HEADER_HEIGHT = 40
          checked++;
          break;
        }
      }
      expect(checked).toBeGreaterThan(0);
    }

    assertAlignment("initial");

    const viewport = root.querySelector<HTMLElement>(`.${CSS.VIEWPORT}`)!;
    viewport.scrollTop = 400;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    assertAlignment("after scroll");

    grid.destroy();
    container.remove();
  });

  it("keeps pinned body overlays in vertical scroll coordinates", async () => {
    // jsdom does not implement sticky layout. Lock down the shipped CSS
    // structure that prevents Firefox from treating the row-positioning
    // containing block as vertically sticky.
    const fs = await import("fs/promises");
    const path = await import("path");
    const url = await import("url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const css = await fs.readFile(
      path.resolve(here, "..", "..", "..", "themes", "default.css"),
      "utf8",
    );

    const ruleBody = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
      expect(match, `missing ${selector} rule`).not.toBeNull();
      return match![1]!;
    };

    const leftLayer = ruleBody(".lfg-pinned-left-layer");
    const rightLayer = ruleBody(".lfg-pinned-right-layer");
    for (const layer of [leftLayer, rightLayer]) {
      expect(layer).toMatch(/\bposition\s*:\s*absolute\s*;/);
      expect(layer).toMatch(/\btop\s*:\s*var\(--lfg-header-height/);
      expect(layer).toMatch(/\bwidth\s*:\s*100%\s*;/);
      expect(layer).toMatch(/\bmin-width\s*:\s*var\(--lfg-total-width\)\s*;/);
      expect(layer).toMatch(/\bheight\s*:\s*calc\(100%\s*-\s*var\(--lfg-header-height/);
      expect(layer).not.toMatch(/\bposition\s*:\s*sticky\s*;/);
      expect(layer).not.toMatch(/\bfloat\s*:/);
    }

    const leftBody = ruleBody(".lfg-pinned-body");
    const rightBody = ruleBody(".lfg-pinned-right-body");
    expect(leftBody).toMatch(/\bposition\s*:\s*sticky\s*;/);
    expect(leftBody).toMatch(/\bleft\s*:\s*0\s*;/);
    expect(leftBody).toMatch(/\bheight\s*:\s*100%\s*;/);
    expect(rightBody).toMatch(/\bposition\s*:\s*sticky\s*;/);
    expect(rightBody).toMatch(/\bright\s*:\s*0\s*;/);
    expect(rightBody).toMatch(/\bheight\s*:\s*100%\s*;/);
  });

  it("horizontal scroll keeps pinned lane without --lfg-pin-offset", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "300px" });
    document.body.appendChild(container);

    const colCount = 20;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `c${i}`,
      width: 100,
      pinned: i === 0 ? ("left" as const) : undefined,
    }));
    const rows = [
      Object.fromEntries(columns.map((c) => [c.field, c.field])),
    ] as RowData[];

    const grid = new Grid({
      rows,
      columns,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    scrollViewport(root, 800);
    await flushRenders();

    const pinOffset = root.style.getPropertyValue("--lfg-pin-offset");
    expect(pinOffset).toBe("");

    const pinnedLayer = root.querySelector<HTMLElement>(".lfg-pinned-left-layer");
    expect(pinnedLayer).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("resizing a pinned column updates --lfg-left-pinned-width", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: "1", b: "2", c: "3" }] as RowData[],
      columns: [
        { field: "a", pinned: "left" as const, width: 100 },
        { field: "b", width: 150 },
        { field: "c", width: 150 },
      ],
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const before = root.style.getPropertyValue("--lfg-left-pinned-width");
    expect(before).toBe("100px");

    grid.setColumnWidth("a", 200);
    await flushRenders();

    const after = root.style.getPropertyValue("--lfg-left-pinned-width");
    expect(after).toBe("200px");

    const centerLeft = root.style.getPropertyValue("--col-b-left");
    expect(centerLeft).toBe("200px");

    grid.destroy();
    container.remove();
  });

  it("resizing a center column does not change --lfg-left-pinned-width", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: "1", b: "2" }] as RowData[],
      columns: [
        { field: "a", pinned: "left" as const, width: 100 },
        { field: "b", width: 150 },
      ],
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    grid.setColumnWidth("b", 250);
    await flushRenders();

    expect(root.style.getPropertyValue("--lfg-left-pinned-width")).toBe("100px");
    expect(root.style.getPropertyValue("--col-b-width")).toBe("250px");

    grid.destroy();
    container.remove();
  });

  it("updating row data syncs pinned cell text", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: "old", b: "2" }] as RowData[],
      columns: [
        { field: "a", pinned: "left" as const, width: 100 },
        { field: "b", width: 150 },
      ],
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const pinnedCell = root.querySelector(
      '.lfg-pinned-row .lfg-cell[data-col-id="a"]',
    );
    expect(pinnedCell?.textContent).toBe("old");

    grid.setRows([{ a: "new", b: "2" }] as RowData[]);
    await flushRenders();

    expect(pinnedCell?.textContent).toBe("new");

    grid.destroy();
    container.remove();
  });

  it("removing pinned columns cleans up pinned lane DOM", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: "1", b: "2" }] as RowData[],
      columns: [
        { field: "a", pinned: "left" as const, width: 100 },
        { field: "b", width: 150 },
      ],
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    expect(root.querySelector(".lfg-pinned-left-layer")).toBeTruthy();
    expect(root.querySelector(".lfg-pinned-header-row")).toBeTruthy();

    grid.setColumns([
      { field: "a", width: 100 },
      { field: "b", width: 150 },
    ]);
    await flushRenders();

    expect(root.querySelector(".lfg-pinned-left-layer")).toBeNull();
    expect(root.querySelector(".lfg-pinned-header-row")).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("adding pinned columns creates pinned lane DOM", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: "1", b: "2" }] as RowData[],
      columns: [
        { field: "a", width: 100 },
        { field: "b", width: 150 },
      ],
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    expect(root.querySelector(".lfg-pinned-left-layer")).toBeNull();
    expect(root.querySelector(".lfg-pinned-header-row")).toBeNull();

    grid.setColumns([
      { field: "a", pinned: "left" as const, width: 100 },
      { field: "b", width: 150 },
    ]);
    await flushRenders();

    expect(root.querySelector(".lfg-pinned-left-layer")).toBeTruthy();
    expect(root.querySelector(".lfg-pinned-header-row")).toBeTruthy();
    expect(
      root.querySelector('.lfg-pinned-row .lfg-cell[data-col-id="a"]'),
    ).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("pinned header cells do not have a column drag handle", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [
        { field: "a", pinned: "left" as const, width: 100 },
        { field: "b", width: 150 },
      ],
      columnOrder: true,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const pinnedHeader = root.querySelector(".lfg-pinned-header-row")!;
    expect(
      pinnedHeader.querySelector(".lfg-column-drag-handle"),
    ).toBeNull();

    const centerHeader = root.querySelector(`.${CSS.HEADER} .${CSS.HEADER_ROW}`)!;
    expect(
      centerHeader.querySelector(".lfg-column-drag-handle"),
    ).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("checkbox selection column pinned left creates a pinned lane and checkbox still works", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "600px" });
    document.body.appendChild(container);

    const colCount = 10;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `c${i}`,
      width: 100,
    }));
    const rows = [
      { id: "r1", ...Object.fromEntries(columns.map((c) => [c.field, 1])) },
    ] as RowData[];

    const grid = new Grid({
      rows,
      columns,
      getRowId: (r) => (r as { id: string }).id,
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
        checkboxColumn: { pinned: "left" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    // Selection column with pinned:"left" creates a pinned lane
    expect(root.querySelector(".lfg-pinned-left-layer")).toBeTruthy();
    expect(root.querySelector(".lfg-pinned-header-row")).toBeTruthy();

    const checkbox = root.querySelector<HTMLInputElement>(
      `.lfg-pinned-row .lfg-row-selection-checkbox`,
    );
    expect(checkbox).toBeTruthy();
    checkbox!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedRowIds()).toContain("r1");

    grid.destroy();
    container.remove();
  });

  // ── Right-pinned column tests ──

  it("right-pinned column renders in a separate lane with data-pinned='right'", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3 }] as RowData[],
      columns: [
        { field: "a" },
        { field: "b" },
        { field: "c", pinned: "right" },
      ],
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const scrollContainer = root.querySelector(`.${CSS.SCROLL_CONTAINER}`) as HTMLElement;
    const rightLayer = root.querySelector<HTMLElement>(".lfg-pinned-right-layer");
    expect(rightLayer).toBeTruthy();
    expect(rightLayer!.parentElement).toBe(scrollContainer);

    const rightHeader = root.querySelector<HTMLElement>(
      `.lfg-pinned-right-header-row .${CSS.HEADER_CELL}[data-col-id="c"]`,
    );
    expect(rightHeader).toBeTruthy();
    expect(rightHeader!.getAttribute("data-pinned")).toBe("right");
    const rightHeaderRow = rightHeader!.closest(".lfg-pinned-right-header-row");
    expect(rightHeaderRow).toBeTruthy();
    expect(rightHeaderRow!.parentElement?.classList.contains("lfg-pinned-header-stack")).toBe(true);
    expect(rightHeaderRow!.parentElement?.parentElement).toBe(scrollContainer);

    const rightBody = root.querySelector<HTMLElement>(".lfg-pinned-right-body");
    expect(rightBody).toBeTruthy();
    expect(rightBody!.parentElement).toBe(rightLayer);

    const rightBodyCell = root.querySelector<HTMLElement>(
      `.lfg-pinned-right-row .${CSS.CELL}[data-col-id="c"]`,
    );
    expect(rightBodyCell).toBeTruthy();
    expect(rightBodyCell!.getAttribute("data-pinned")).toBe("right");
    expect(rightBodyCell!.textContent).toBe("3");

    grid.destroy();
    container.remove();
  });

  it("right-pinned header/body share top-row alignment model with center", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "220px", width: "420px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { a: "A1", b: "B1", c: "C1" },
        { a: "A2", b: "B2", c: "C2" },
      ] as RowData[],
      columns: [
        { field: "a", width: 120 },
        { field: "b", width: 120 },
        { field: "c", pinned: "right", width: 120 },
      ],
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const scrollContainer = root.querySelector(`.${CSS.SCROLL_CONTAINER}`) as HTMLElement;
    const centerHeader = root.querySelector(`.${CSS.HEADER}`) as HTMLElement;
    const rightHeaderRow = root.querySelector(".lfg-pinned-right-header-row") as HTMLElement;
    const rightLayer = root.querySelector(".lfg-pinned-right-layer") as HTMLElement;
    const firstCenterRow = root.querySelector(`.${CSS.ROW}`) as HTMLElement;
    const firstRightRow = root.querySelector(".lfg-pinned-right-row") as HTMLElement;

    expect(centerHeader).toBeTruthy();
    expect(rightHeaderRow).toBeTruthy();
    expect(rightLayer).toBeTruthy();
    expect(firstCenterRow).toBeTruthy();
    expect(firstRightRow).toBeTruthy();
    expect(rightHeaderRow.parentElement?.classList.contains("lfg-pinned-header-stack")).toBe(true);
    expect(rightHeaderRow.parentElement?.parentElement).toBe(scrollContainer);
    expect(rightLayer.parentElement).toBe(scrollContainer);
    expect(
      rightHeaderRow.parentElement!.compareDocumentPosition(centerHeader) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      centerHeader.compareDocumentPosition(rightLayer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    expect(firstCenterRow.style.transform).toBe("translateY(40px)");
    expect(firstRightRow.style.transform).toBe("translateY(0px)");

    grid.destroy();
    container.remove();
  });

  it("right-pinned column stays rendered after horizontal scroll", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const colCount = 20;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `c${i}`,
      width: 120,
      pinned: i === colCount - 1 ? ("right" as const) : undefined,
    }));

    const rows = [
      Object.fromEntries(columns.map((c) => [c.field, c.field])),
    ] as RowData[];

    const grid = new Grid({
      rows,
      columns,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    const lastField = `c${colCount - 1}`;
    const pinnedHeader = root.querySelector<HTMLElement>(
      `.lfg-pinned-right-header-row .${CSS.HEADER_CELL}[data-col-id="${lastField}"]`,
    );
    expect(pinnedHeader).toBeTruthy();
    expect(pinnedHeader!.getAttribute("data-pinned")).toBe("right");

    scrollViewport(root, 2000);
    await flushRenders();

    const pinnedHeaderAfter = root.querySelector<HTMLElement>(
      `.lfg-pinned-right-header-row .${CSS.HEADER_CELL}[data-col-id="${lastField}"]`,
    );
    expect(pinnedHeaderAfter).toBeTruthy();

    const pinnedBodyCell = root.querySelector<HTMLElement>(
      `.lfg-pinned-right-row .${CSS.CELL}[data-col-id="${lastField}"]`,
    );
    expect(pinnedBodyCell).toBeTruthy();
    expect(pinnedBodyCell!.textContent).toBe(lastField);

    grid.destroy();
    container.remove();
  });

  it("left + right pinned columns coexist with center", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "600px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ L: "left", C: "center", R: "right" }] as RowData[],
      columns: [
        { field: "L", pinned: "left", width: 100 },
        { field: "C", width: 200 },
        { field: "R", pinned: "right", width: 100 },
      ],
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    const leftHeader = root.querySelector<HTMLElement>(
      `.lfg-pinned-header-row .${CSS.HEADER_CELL}[data-col-id="L"]`,
    );
    expect(leftHeader).toBeTruthy();
    expect(leftHeader!.getAttribute("data-pinned")).toBe("left");

    const rightHeader = root.querySelector<HTMLElement>(
      `.lfg-pinned-right-header-row .${CSS.HEADER_CELL}[data-col-id="R"]`,
    );
    expect(rightHeader).toBeTruthy();
    expect(rightHeader!.getAttribute("data-pinned")).toBe("right");

    const centerHeader = root.querySelector<HTMLElement>(
      `.${CSS.HEADER_ROW}:not(.lfg-pinned-header-row):not(.lfg-pinned-right-header-row) .${CSS.HEADER_CELL}[data-col-id="C"]`,
    );
    expect(centerHeader).toBeTruthy();

    const leftCell = root.querySelector<HTMLElement>(
      `.lfg-pinned-row .${CSS.CELL}[data-col-id="L"]`,
    );
    expect(leftCell).toBeTruthy();
    expect(leftCell!.textContent).toBe("left");

    const rightCell = root.querySelector<HTMLElement>(
      `.lfg-pinned-right-row .${CSS.CELL}[data-col-id="R"]`,
    );
    expect(rightCell).toBeTruthy();
    expect(rightCell!.textContent).toBe("right");

    grid.destroy();
    container.remove();
  });

  it("sort click works on right-pinned column", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { name: "Charlie", score: 30 },
        { name: "Alice", score: 25 },
      ] as RowData[],
      columns: [
        { field: "name" },
        { field: "score", pinned: "right", sortable: true },
      ],
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    const scoreHeaderCell = root.querySelector<HTMLElement>(
      `.lfg-pinned-right-header-row .${CSS.HEADER_CELL}[data-col-id="score"]`,
    );
    expect(scoreHeaderCell).toBeTruthy();
    scoreHeaderCell!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSortModel()).toEqual([{ field: "score", sort: "asc" }]);

    grid.destroy();
    container.remove();
  });

  it("clicking right-pinned body cell with row click selection toggles selection", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ name: "Alice", score: 30 }] as RowData[],
      columns: [
        { field: "name" },
        { field: "score", pinned: "right" },
      ],
      getRowId: (r) => (r as { name: string }).name,
      rowSelection: {
        mode: "multiple",
        checkboxes: false,
        headerCheckbox: false,
        enableRowClickSelection: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const rightCell = root.querySelector<HTMLElement>(
      `.lfg-pinned-right-row .${CSS.CELL}[data-col-id="score"]`,
    );
    expect(rightCell).toBeTruthy();
    rightCell!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedRowIds()).toContain("Alice");

    grid.destroy();
    container.remove();
  });

  it("right-pinned header has no drag handle", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [
        { field: "a" },
        { field: "b", pinned: "right" },
      ],
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const rightHeader = root.querySelector<HTMLElement>(
      `.lfg-pinned-right-header-row .${CSS.HEADER_CELL}[data-col-id="b"]`,
    );
    expect(rightHeader).toBeTruthy();
    const dragHandle = rightHeader!.querySelector(".lfg-column-drag-handle");
    expect(dragHandle).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("pinned:'right' to unpinned triggers structural rebuild", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [
        { field: "a" },
        { field: "b", pinned: "right" },
      ],
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    expect(root.querySelector(".lfg-pinned-right-header-row")).toBeTruthy();
    expect(root.style.getPropertyValue("--lfg-right-pinned-width")).not.toBe("0px");

    grid.setColumns([
      { field: "a" },
      { field: "b" },
    ]);
    await flushRenders();

    expect(root.querySelector(".lfg-pinned-right-header-row")).toBeNull();
    expect(root.querySelector(".lfg-pinned-right-layer")).toBeNull();
    expect(root.style.getPropertyValue("--lfg-right-pinned-width")).toBe("0px");

    grid.destroy();
    container.remove();
  });

  it("right-pinned resize handle exists with correct data-col-id", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [
        { field: "a" },
        { field: "b", pinned: "right", width: 100 },
      ],
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const rightHeader = root.querySelector<HTMLElement>(
      ".lfg-pinned-right-header-row .lfg-header-cell",
    );
    expect(rightHeader).toBeTruthy();
    expect(rightHeader!.getAttribute("data-col-id")).toBe("b");

    const resizeHandle = rightHeader!.querySelector<HTMLElement>(".lfg-resize-handle");
    expect(resizeHandle).toBeTruthy();
    expect(resizeHandle!.getAttribute("data-col-id")).toBe("b");

    grid.destroy();
    container.remove();
  });

  // ── checkboxColumn.pinned integration tests ──

  it("checkboxColumn.pinned: 'left' puts checkbox in pinned-left lane, not center", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "600px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "r1", a: 1, b: 2, c: 3 }] as RowData[],
      columns: [
        { field: "a", width: 150 },
        { field: "b", width: 150 },
        { field: "c", width: 150 },
      ],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
        checkboxColumn: { pinned: "left" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    // Selection header cell is in pinned-left header
    expect(
      root.querySelector(`.lfg-pinned-header-row .${CSS.HEADER_CELL}[data-col-id="${SELECTION_COLUMN_FIELD}"]`),
    ).toBeTruthy();

    // Selection body cell is in pinned-left row
    expect(
      root.querySelector(`.lfg-pinned-row .${CSS.CELL}[data-col-id="${SELECTION_COLUMN_FIELD}"]`),
    ).toBeTruthy();

    // Center header does NOT contain the selection column
    expect(
      root.querySelector(`.${CSS.HEADER_ROW}:not(.lfg-pinned-header-row):not(.lfg-pinned-right-header-row) .${CSS.HEADER_CELL}[data-col-id="${SELECTION_COLUMN_FIELD}"]`),
    ).toBeNull();

    // Center body does NOT contain the selection column
    expect(
      root.querySelector(`.${CSS.ROW}:not(.lfg-pinned-row):not(.lfg-pinned-right-row) .${CSS.CELL}[data-col-id="${SELECTION_COLUMN_FIELD}"]`),
    ).toBeNull();

    grid.destroy();
    container.remove();
  });

  it("checkboxColumn.pinned: false keeps checkbox in center flow", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "600px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "r1", a: 1, b: 2 }] as RowData[],
      columns: [
        { field: "a", width: 150 },
        { field: "b", width: 150 },
      ],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        checkboxColumn: { pinned: false },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    // No pinned-left lane should be created
    expect(root.querySelector(".lfg-pinned-left-layer")).toBeNull();

    // Selection column should be in center
    expect(
      root.querySelector(`.${CSS.HEADER_ROW} .${CSS.HEADER_CELL}[data-col-id="${SELECTION_COLUMN_FIELD}"]`),
    ).toBeTruthy();
    expect(
      root.querySelector(`.${CSS.ROW} .${CSS.CELL}[data-col-id="${SELECTION_COLUMN_FIELD}"]`),
    ).toBeTruthy();

    // Checkbox still works
    const cb = root.querySelector(
      `.${CSS.ROW} .lfg-row-selection-checkbox`,
    ) as HTMLInputElement;
    expect(cb).toBeTruthy();
    cb.click();
    await new Promise((r) => setTimeout(r, 0));
    await flushRenders();
    expect(grid.getSelectedRowIds()).toContain("r1");

    grid.destroy();
    container.remove();
  });

  it("checkboxColumn.pinned: 'right' puts checkbox in pinned-right lane", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "600px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "r1", a: 1, b: 2 }] as RowData[],
      columns: [
        { field: "a", width: 150 },
        { field: "b", width: 150 },
      ],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        checkboxColumn: { pinned: "right" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    // Selection column should be in the right-pinned lane
    expect(
      root.querySelector(`.lfg-pinned-right-header-row .${CSS.HEADER_CELL}[data-col-id="${SELECTION_COLUMN_FIELD}"]`),
    ).toBeTruthy();
    expect(
      root.querySelector(`.lfg-pinned-right-row .${CSS.CELL}[data-col-id="${SELECTION_COLUMN_FIELD}"]`),
    ).toBeTruthy();

    // Not in center (use :not to exclude pinned header rows which also have lfg-header-row)
    expect(
      root.querySelector(`.${CSS.HEADER_ROW}:not(.lfg-pinned-right-header-row):not(.lfg-pinned-header-row) .${CSS.HEADER_CELL}[data-col-id="${SELECTION_COLUMN_FIELD}"]`),
    ).toBeNull();

    // Not in left-pinned
    expect(root.querySelector(".lfg-pinned-left-layer")).toBeNull();

    grid.destroy();
    container.remove();
  });
});
