// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import type { RowData } from "../../../types";
import { CSS } from "../../const/css-classes";
import * as columnLayout from "../../helpers/columnLayout";
import * as populateRowModule from "../../helpers/populateRow";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("VirtualWindowSync scroll perf", () => {
  it("micro vertical scroll in same row window does not rebuild column edges (1000 columns)", async () => {
    const buildSpy = vi.spyOn(columnLayout, "buildColumnLeftEdges");

    const colCount = 1000;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `c${i}`,
      width: 120,
    }));

    const rows = Array.from({ length: 50 }, (_, r) => {
      const row: Record<string, unknown> = { id: `r${r}` };
      for (let i = 0; i < colCount; i++) row[`c${i}`] = r;
      return row as RowData;
    });

    const container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows,
      columns,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: false,
      getRowId: (row) => (row as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    expect(buildSpy.mock.calls.length).toBeGreaterThan(0);
    buildSpy.mockClear();

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    for (let i = 0; i < 8; i++) {
      viewport.scrollTop += 12;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();
    }

    expect(buildSpy).not.toHaveBeenCalled();

    buildSpy.mockRestore();
    grid.destroy();
    container.remove();
  });

  it("micro horizontal scroll in same column window does not call populateRow", async () => {
    const populateSpy = vi.spyOn(populateRowModule, "populateRow");
    const colCount = 100;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `h${i}`,
      width: 120,
    }));
    const rows = Array.from({ length: 50 }, (_, r) => {
      const row: Record<string, unknown> = { id: `hr${r}` };
      for (let i = 0; i < colCount; i++) row[`h${i}`] = r;
      return row as RowData;
    });

    const container = document.createElement("div");
    Object.assign(container.style, { height: "300px", width: "400px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows,
      columns,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: false,
      getRowId: (row) => (row as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    populateSpy.mockClear();

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    const base = viewport.scrollLeft;
    for (let i = 0; i < 6; i++) {
      viewport.scrollLeft = base + (i + 1) * 8;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();
    }

    expect(populateSpy).not.toHaveBeenCalled();
    populateSpy.mockRestore();
    grid.destroy();
    container.remove();
  });

  it("horizontal scroll that advances column window uses rebindCells, not populateRow", async () => {
    const populateSpy = vi.spyOn(populateRowModule, "populateRow");
    const rebindSpy = vi.spyOn(populateRowModule, "rebindCells");

    const colCount = 80;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `m${i}`,
      width: 100,
    }));
    const rows = Array.from({ length: 40 }, (_, r) => {
      const row: Record<string, unknown> = { id: `mr${r}` };
      for (let i = 0; i < colCount; i++) row[`m${i}`] = r;
      return row as RowData;
    });

    const container = document.createElement("div");
    Object.assign(container.style, { height: "280px", width: "350px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows,
      columns,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: false,
      getRowId: (row) => (row as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    populateSpy.mockClear();
    rebindSpy.mockClear();

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollLeft = 500;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();
    await flushRenders();

    expect(populateSpy).not.toHaveBeenCalled();
    expect(rebindSpy.mock.calls.length).toBeGreaterThan(0);
    expect(rebindSpy.mock.calls.length).toBeLessThanOrEqual(50);

    rebindSpy.mockRestore();
    populateSpy.mockRestore();
    grid.destroy();
    container.remove();
  });
});
