// @vitest-environment jsdom
//
// Public-API integration tests for row styling: `rowClass`, `getRowClass`,
// `rowClassRules`. Verifies the prop → state → snapshot → renderer →
// populateRow chain end-to-end without touching private renderer state.

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { CSS } from "../../../rendering/const/css-classes";
import type { RowData } from "../../../types";
import type { RowClassParams, RowClassRules } from "..";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

const rows: RowData[] = [
  { id: "r1", name: "Alice", flag: true },
  { id: "r2", name: "Bob", flag: false },
  { id: "r3", name: "Carol", flag: true },
];

function makeGrid(opts: {
  rowClass?: string | string[];
  getRowClass?: (params: RowClassParams) => string | string[] | null | undefined | false;
  rowClassRules?: RowClassRules;
}) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "300px", width: "400px" });
  document.body.appendChild(container);

  const grid = new Grid({
    rows,
    columns: [{ field: "id" }, { field: "name" }],
    getRowId: (row) => row.id as string,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    rowClass: opts.rowClass,
    getRowClass: opts.getRowClass,
    rowClassRules: opts.rowClassRules,
  });
  grid.mount(container);
  return { grid, container };
}

function getRoot(container: HTMLElement): HTMLElement {
  return container.querySelector(`.${CSS.GRID}`) as HTMLElement;
}

function getCenterRowByRowId(root: HTMLElement, rowId: string): HTMLElement | null {
  const sc = root.querySelector(`.${CSS.SCROLL_CONTAINER}`);
  if (!sc) return null;
  return sc.querySelector<HTMLElement>(
    `:scope > .${CSS.ROW}[data-row-id="${rowId}"]`,
  );
}

describe("row styling: public API → renderer integration", () => {
  let grid: Grid;
  let container: HTMLElement;

  afterEach(() => {
    grid.destroy();
    container.remove();
  });

  it("initial `rowClass` prop applies to every visible body row", async () => {
    ({ grid, container } = makeGrid({ rowClass: "rowstyle-base" }));
    await flushRenders();

    const root = getRoot(container);
    for (const r of rows) {
      const el = getCenterRowByRowId(root, r.id as string);
      expect(el).not.toBeNull();
      expect(el!.classList.contains("rowstyle-base")).toBe(true);
    }
  });

  it("`getRowClass` receives row, rowIndex, rowId, and Grid", async () => {
    const spy = vi.fn((p: RowClassParams) => `rowstyle-${p.rowId}`);
    ({ grid, container } = makeGrid({ getRowClass: spy }));
    await flushRenders();

    // Each visible row triggers exactly one resolver call per render pass.
    expect(spy).toHaveBeenCalled();
    const firstCall = spy.mock.calls[0]![0];
    expect(firstCall).toMatchObject({
      rowIndex: expect.any(Number),
      rowId: expect.any(String),
    });
    expect(firstCall.row).toBeDefined();
    // Grid instance is the live `Grid` (not null).
    expect(firstCall.grid).toBe(grid);

    const root = getRoot(container);
    for (const r of rows) {
      const el = getCenterRowByRowId(root, r.id as string);
      expect(el!.classList.contains(`rowstyle-${r.id}`)).toBe(true);
    }
  });

  it("`rowClassRules` applies class only when predicate returns true", async () => {
    ({ grid, container } = makeGrid({
      rowClassRules: {
        "rowstyle-flagged": (p) => (p.row as { flag: boolean }).flag === true,
      },
    }));
    await flushRenders();

    const root = getRoot(container);
    expect(getCenterRowByRowId(root, "r1")!.classList.contains("rowstyle-flagged")).toBe(true);
    expect(getCenterRowByRowId(root, "r2")!.classList.contains("rowstyle-flagged")).toBe(false);
    expect(getCenterRowByRowId(root, "r3")!.classList.contains("rowstyle-flagged")).toBe(true);
  });

  // ── React/core prop update flow ────────────────────────────────────────

  it("`setRowStyling` updates classes on a re-render (prop → state → DOM)", async () => {
    ({ grid, container } = makeGrid({ rowClass: "v1" }));
    await flushRenders();

    const root = getRoot(container);
    expect(getCenterRowByRowId(root, "r1")!.classList.contains("v1")).toBe(true);

    // Mutate styling via the public setter (React adapter calls this).
    grid.setRowStyling({ rowClass: "v2" });
    await flushRenders();

    const r1 = getCenterRowByRowId(root, "r1")!;
    expect(r1.classList.contains("v1")).toBe(false);
    expect(r1.classList.contains("v2")).toBe(true);
  });

  it("dropping the row-styling props removes previously applied managed classes", async () => {
    ({ grid, container } = makeGrid({ rowClass: "to-remove" }));
    await flushRenders();
    const root = getRoot(container);
    expect(getCenterRowByRowId(root, "r1")!.classList.contains("to-remove")).toBe(true);

    grid.setRowStyling({});
    await flushRenders();
    const r1 = getCenterRowByRowId(root, "r1")!;
    expect(r1.classList.contains("to-remove")).toBe(false);
    // Core class still present.
    expect(r1.classList.contains(CSS.ROW)).toBe(true);
  });

  // ── Skip-cache correctness ──────────────────────────────────────────────

  it("unrelated state change does NOT re-invoke the row-styling resolver when inputs unchanged", async () => {
    const spy = vi.fn(() => "stable");
    ({ grid, container } = makeGrid({ getRowClass: spy }));
    await flushRenders();
    const callsAfterFirstRender = spy.mock.calls.length;
    expect(callsAfterFirstRender).toBeGreaterThan(0);

    // Selection mutation triggers a render but NOT a styling-version bump.
    grid.setSelectedRowIds(["r1"]);
    await flushRenders();

    // Per-row `lastRowClassVersion` matches → populateRow skips the resolver
    // for each row.
    expect(spy.mock.calls.length).toBe(callsAfterFirstRender);
  });

  it("calling setRowStyling with the same references is a no-op (no render scheduled, no resolver re-run)", async () => {
    const sameRules: RowClassRules = { x: () => true };
    const spy = vi.fn(() => false);
    sameRules.x = spy;
    ({ grid, container } = makeGrid({ rowClassRules: sameRules }));
    await flushRenders();
    const baseline = spy.mock.calls.length;

    // Same references → setRowStyling returns false → no render scheduled.
    grid.setRowStyling({ rowClassRules: sameRules });
    await flushRenders();
    expect(spy.mock.calls.length).toBe(baseline);
  });

  it("bumping the styling version (new resolver ref) re-runs the resolver even when data did not change", async () => {
    const firstSpy = vi.fn(() => "ver-1");
    ({ grid, container } = makeGrid({ getRowClass: firstSpy }));
    await flushRenders();
    const firstSpyCalls = firstSpy.mock.calls.length;
    expect(firstSpyCalls).toBeGreaterThan(0);

    const secondSpy = vi.fn(() => "ver-2");
    grid.setRowStyling({ getRowClass: secondSpy });
    await flushRenders();

    expect(secondSpy).toHaveBeenCalled();
    const root = getRoot(container);
    expect(getCenterRowByRowId(root, "r1")!.classList.contains("ver-1")).toBe(false);
    expect(getCenterRowByRowId(root, "r1")!.classList.contains("ver-2")).toBe(true);
  });
});
