// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

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

function rowById(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector(`[data-row-id="${id}"]`) as HTMLElement | null;
}

function clickRow(el: HTMLElement, init: MouseEventInit = {}): void {
  el.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    }),
  );
}

describe("row selection resolveRowId cost (no O(n) getRowId on plain/Ctrl clicks)", () => {
  it("plain and Ctrl body clicks do not invoke getRowId for every row", async () => {
    let resolveCount = 0;
    const container = document.createElement("div");
    Object.assign(container.style, { height: "120px", width: "480px" });
    document.body.appendChild(container);

    const n = 8000;
    const rows = Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      k: i,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [{ field: "k" }],
      rowSelection: "multiple",
      suppressRowVirtualization: false,
      getRowId: (r, _i) => {
        resolveCount += 1;
        return (r as { id: string }).id;
      },
    });
    grid.mount(container);
    await flushRenders();

    resolveCount = 0;
    const first = rowById(container, "r0")!;
    expect(first.getAttribute("data-row-index")).toBe("0");
    clickRow(first);
    await flushRenders();
    expect(resolveCount).toBeLessThanOrEqual(40);

    resolveCount = 0;
    const r2 = rowById(container, "r2");
    expect(r2).toBeTruthy();
    clickRow(r2!, { ctrlKey: true });
    await flushRenders();
    expect(resolveCount).toBeLessThanOrEqual(40);

    grid.destroy();
    container.remove();
  });

  it("Shift range invokes getRowId roughly range-sized, not full grid", async () => {
    let resolveCount = 0;
    const container = document.createElement("div");
    Object.assign(container.style, { height: "120px", width: "480px" });
    document.body.appendChild(container);

    const n = 6000;
    const rows = Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      k: i,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [{ field: "k" }],
      rowSelection: "multiple",
      suppressRowVirtualization: false,
      getRowId: (r, _i) => {
        resolveCount += 1;
        return (r as { id: string }).id;
      },
    });
    grid.mount(container);
    await flushRenders();

    resolveCount = 0;
    clickRow(rowById(container, "r1")!);
    await flushRenders();

    resolveCount = 0;
    clickRow(rowById(container, "r4")!, { shiftKey: true });
    await flushRenders();

    expect(grid.getSelectedRowIds().length).toBe(4);
    expect(resolveCount).toBeGreaterThanOrEqual(4);
    expect(resolveCount).toBeLessThan(80);

    grid.destroy();
    container.remove();
  });

  it("data-row-index is set on row roots", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "120px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "a", v: 1 }] as RowData[],
      columns: [{ field: "v" }],
      rowSelection: "single",
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const row = container.querySelector(`.${CSS.ROW}`) as HTMLElement;
    expect(row.getAttribute("data-row-index")).toBe("0");

    grid.destroy();
    container.remove();
  });
});
