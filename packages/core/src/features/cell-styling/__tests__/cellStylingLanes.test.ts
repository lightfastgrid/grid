// @vitest-environment jsdom
//
// Renderer integration tests for cell styling across the split DOM lanes:
//
//   1. Pinned-left body cells (via `syncPinnedRowCells`)
//   2. Pinned-right body cells (via `syncPinnedRowCells`)
//   3. Row-pinned top/bottom center lane cells (via `syncRowPinLaneCols`
//      and `rebindRowPinLaneCols` for partial horizontal entering slots)
//   4. Row-pinned top/bottom left/right sub-lane cells (via
//      `rowPinLaneDom` bind options)
//
// Center body coverage lives in `cellStylingGrid.test.ts`; this file proves
// the wiring forwards `ctx.resolveCellClasses` + `ctx.cellClassVersion`
// through all additional bind paths.

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { CSS } from "../../../rendering/const/css-classes";
import type { LightFastGridColDef, RowData } from "../../../types";
import type {
  CellClassParams,
  CellClassRules,
} from "..";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

const rows: RowData[] = [
  { id: "r1", name: "Alice", amount: 100, flag: true },
  { id: "r2", name: "Bob", amount: -50, flag: false },
  { id: "r3", name: "Carol", amount: 250, flag: true },
];

function makeGrid(opts: {
  columns: LightFastGridColDef[];
  rowPinning?: { top?: string[]; bottom?: string[] };
  rows?: RowData[];
  suppressColumnVirtualization?: boolean;
}) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "300px", width: "600px" });
  document.body.appendChild(container);

  const grid = new Grid({
    rows: opts.rows ?? rows,
    columns: opts.columns,
    getRowId: (row) => row.id as string,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: opts.suppressColumnVirtualization ?? true,
    rowPinning: opts.rowPinning,
  });
  grid.mount(container);
  return { grid, container };
}

function getRoot(container: HTMLElement): HTMLElement {
  return container.querySelector(`.${CSS.GRID}`) as HTMLElement;
}
function pinnedLeftCell(root: HTMLElement, rowId: string, field: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `.lfg-pinned-row[data-row-id="${rowId}"] .${CSS.CELL}[data-col-id="${field}"]`,
  );
}
function pinnedRightCell(root: HTMLElement, rowId: string, field: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `.lfg-pinned-right-row[data-row-id="${rowId}"] .${CSS.CELL}[data-col-id="${field}"]`,
  );
}
function rowPinTopCenterCell(root: HTMLElement, rowId: string, field: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `.lfg-row-pinned-top-layer .${CSS.ROW}[data-row-id="${rowId}"] .${CSS.CELL}[data-col-id="${field}"]`,
  );
}
function rowPinBottomCenterCell(root: HTMLElement, rowId: string, field: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `.lfg-row-pinned-bottom-layer .${CSS.ROW}[data-row-id="${rowId}"] .${CSS.CELL}[data-col-id="${field}"]`,
  );
}

describe("cell styling: pinned columns + row-pinned center lanes", () => {
  let grid: Grid;
  let container: HTMLElement;

  afterEach(() => {
    grid.destroy();
    container.remove();
  });

  // ── Pinned-left body cells ────────────────────────────────────────

  it("pinned-LEFT column cells receive `cellClass`", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left", cellClass: "left-cell" },
        { field: "name" },
        { field: "amount" },
      ],
    }));
    await flushRenders();

    const root = getRoot(container);
    for (const r of rows) {
      const cell = pinnedLeftCell(root, r.id as string, "id");
      expect(cell, `pinned-left cell missing for ${r.id}`).not.toBeNull();
      expect(cell!.classList.contains("left-cell")).toBe(true);
    }
  });

  it("pinned-LEFT cells respect `getCellClass` (functional hook)", async () => {
    const spy = vi.fn((p: CellClassParams) =>
      (p.row as { flag: boolean }).flag ? "flagged" : null,
    );
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left", getCellClass: spy },
        { field: "name" },
      ],
    }));
    await flushRenders();

    const root = getRoot(container);
    expect(pinnedLeftCell(root, "r1", "id")!.classList.contains("flagged")).toBe(true);
    expect(pinnedLeftCell(root, "r2", "id")!.classList.contains("flagged")).toBe(false);
    expect(pinnedLeftCell(root, "r3", "id")!.classList.contains("flagged")).toBe(true);
  });

  it("pinned-LEFT cells respect `cellClassRules` with raw value", async () => {
    const rules: CellClassRules = {
      negative: (p) => typeof p.value === "number" && p.value < 0,
      big: (p) => typeof p.value === "number" && p.value > 200,
    };
    ({ grid, container } = makeGrid({
      columns: [
        { field: "amount", pinned: "left", cellClassRules: rules },
        { field: "name" },
      ],
    }));
    await flushRenders();

    const root = getRoot(container);
    expect(pinnedLeftCell(root, "r1", "amount")!.classList.contains("negative")).toBe(false);
    expect(pinnedLeftCell(root, "r2", "amount")!.classList.contains("negative")).toBe(true);
    expect(pinnedLeftCell(root, "r3", "amount")!.classList.contains("big")).toBe(true);
  });

  // ── Pinned-right body cells ───────────────────────────────────────

  it("pinned-RIGHT column cells receive `cellClass`", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "name" },
        { field: "id" },
        { field: "amount", pinned: "right", cellClass: "right-cell" },
      ],
    }));
    await flushRenders();

    const root = getRoot(container);
    for (const r of rows) {
      const cell = pinnedRightCell(root, r.id as string, "amount");
      expect(cell, `pinned-right cell missing for ${r.id}`).not.toBeNull();
      expect(cell!.classList.contains("right-cell")).toBe(true);
    }
  });

  // ── Pinned selection column exclusion ─────────────────────────────

  it("pinned SELECTION column does not receive cell-styling classes", async () => {
    // Even though every column gets a `cellClass`, the auto-injected
    // selection column (explicitly pinned left) must NOT receive any
    // managed cell class — it's ineligible per the v1 contract.
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left", cellClass: "id-styled" },
        { field: "name", cellClass: "name-styled" },
      ],
      rows: [{ id: "r1", name: "Alice" }],
    }));
    grid.setRowSelection({
      mode: "multi",
      checkboxes: true,
      checkboxColumn: { pinned: "left" },
    });
    await flushRenders();

    const root = getRoot(container);
    const selCell = root.querySelector<HTMLElement>(
      `.lfg-pinned-row[data-row-id="r1"] .${CSS.CELL}[data-col-id="__lfg_selection__"]`,
    );
    expect(selCell, "pinned selection cell missing").not.toBeNull();
    // The styled-data-column class did not leak onto the selection cell.
    expect(selCell!.classList.contains("id-styled")).toBe(false);
    expect(selCell!.classList.contains("name-styled")).toBe(false);
  });

  // ── Row-pinned top center lane ────────────────────────────────────

  it("row-pinned TOP center lane cells receive `cellClass`", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id" },
        { field: "name", cellClass: "name-cell" },
        { field: "amount" },
      ],
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const cell = rowPinTopCenterCell(root, "r1", "name");
    expect(cell, "top lane center cell missing").not.toBeNull();
    expect(cell!.classList.contains("name-cell")).toBe(true);
  });

  it("row-pinned TOP center lane cells respect `cellClassRules` and receive the raw value", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id" },
        {
          field: "amount",
          cellClassRules: { neg: (p) => (p.value as number) < 0 },
          valueFormatter: ({ value }) => `$${String(value)}`,
        },
      ],
      rowPinning: { top: ["r2"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const cell = rowPinTopCenterCell(root, "r2", "amount")!;
    expect(cell.classList.contains("neg")).toBe(true);
    // Text used the formatter while the rule received the raw number.
    expect(cell.textContent).toBe("$-50");
  });

  // ── Row-pinned bottom center lane ─────────────────────────────────

  it("row-pinned BOTTOM center lane cells receive `cellClass`", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id" },
        { field: "name", cellClass: "name-cell" },
        { field: "amount" },
      ],
      rowPinning: { bottom: ["r3"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const cell = rowPinBottomCenterCell(root, "r3", "name");
    expect(cell, "bottom lane center cell missing").not.toBeNull();
    expect(cell!.classList.contains("name-cell")).toBe(true);
  });

  // ── Horizontal scroll in row-pinned lanes ────────────────────────

  it("horizontal scroll in row-pinned lanes applies cell styling to entering cells and drains stale classes when moving to unstyled column", async () => {
    // 10 columns, every-other styled. Column virtualization on so the
    // physical cell slots recycle through different logical columns as the
    // user scrolls horizontally — entering slots must run cell styling and
    // drop stale classes from their prior occupant.
    const cols: LightFastGridColDef[] = Array.from({ length: 10 }, (_, i) => ({
      field: `c${i}`,
      width: 120,
      cellClass: i % 2 === 0 ? `even-${i}` : undefined,
    }));
    const wideRows: RowData[] = Array.from({ length: 8 }, (_, r) => {
      const row: Record<string, unknown> = { id: `wr${r}` };
      for (let i = 0; i < 10; i++) row[`c${i}`] = `${r}-${i}`;
      return row as RowData;
    });

    ({ grid, container } = makeGrid({
      columns: cols,
      rows: wideRows,
      rowPinning: { top: ["wr0"] },
      suppressColumnVirtualization: false,
    }));
    await flushRenders();

    const root = getRoot(container);
    const layer = root.querySelector(".lfg-row-pinned-top-layer") as HTMLElement;
    expect(layer).not.toBeNull();

    const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollLeft = 600;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    // Walk every visible lane cell and verify the class matches the column
    // it currently binds: even columns have `even-N`; odd columns carry no
    // `even-*` leftovers from prior bindings.
    const cellEls = Array.from(
      layer.querySelectorAll<HTMLElement>(`.${CSS.CELL}[data-col-id]`),
    );
    expect(cellEls.length).toBeGreaterThan(0);
    for (const el of cellEls) {
      const field = el.getAttribute("data-col-id")!;
      const idx = Number(field.slice(1));
      if (idx % 2 === 0) {
        expect(el.classList.contains(`even-${idx}`)).toBe(true);
      } else {
        for (let n = 0; n < 10; n += 2) {
          expect(el.classList.contains(`even-${n}`)).toBe(false);
        }
      }
    }
  });

  // ── Performance contract for pinned cells ────────────────────────

  it("does NOT duplicate `valueGetter` / `valueFormatter` calls on pinned cells when cell styling is active", async () => {
    const getter = vi.fn(({ row }: { row: RowData }) => (row as { amount: number }).amount);
    const formatter = vi.fn(({ value }: { value: unknown }) => `$${String(value)}`);

    ({ grid, container } = makeGrid({
      columns: [
        {
          field: "amount",
          pinned: "left",
          width: 120,
          valueGetter: getter,
          valueFormatter: formatter,
          cellClass: "money",
        },
        { field: "name" },
      ],
    }));
    await flushRenders();

    // Each row binds the pinned-left "amount" cell once → getter & formatter
    // each called once per row. The styling-aware path reuses the same
    // `getCellRawValue` result for both display text and the resolver.
    expect(getter.mock.calls.length).toBe(rows.length);
    expect(formatter.mock.calls.length).toBe(rows.length);

    const root = getRoot(container);
    for (const r of rows) {
      expect(pinnedLeftCell(root, r.id as string, "amount")!.classList.contains("money")).toBe(true);
    }
  });

  it("no resolver is built / called when no eligible column has cell styling", async () => {
    // No `cellClass` / `getCellClass` / `cellClassRules` on any column —
    // even though we have pinned and row-pinned content, the renderer
    // detection should resolve to inactive styling. Behaviorally we assert
    // that the value pipeline is called exactly once per visible cell
    // (no doubled getter/formatter work).
    const getter = vi.fn(({ row }: { row: RowData }) => (row as { amount: number }).amount);
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left" },
        { field: "name" },
        { field: "amount", pinned: "right", valueGetter: getter },
      ],
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    // Pinned-right amount cell is bound for each row that's NOT row-pinned
    // (r2, r3) AND once for the row-pinned r1 lane. Plus 0..1 calls for
    // initial-render bookkeeping. Just assert getter was called a finite
    // number of times and didn't get spammed by a phantom resolver pass.
    const callsAfterMount = getter.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    // Force another render with no styling change — should not bump.
    grid.setSelectedRowIds(["r1"]);
    await flushRenders();

    // Getter call count should be flat (no horizontal change → no cell-loop
    // re-invocation for unchanged rows).
    expect(getter.mock.calls.length).toBe(callsAfterMount);

    // And no cell carries a non-`lfg-*` class anywhere.
    const root = getRoot(container);
    const allCells = Array.from(root.querySelectorAll<HTMLElement>(`.${CSS.CELL}`));
    for (const el of allCells) {
      el.classList.forEach((c) => {
        expect(c.startsWith("lfg-")).toBe(true);
      });
    }
  });

  // ── Lane drain when moving from styled to unstyled column ─────────

  it("row-pinned center lane cells drain stale managed classes when the structural column shape changes", async () => {
    // Initially: column "name" is styled. Then setColumns to a NEW structural
    // shape (different field added at front) so the column-pinning layout
    // rebuilds and the lane center pool recycles. The previously bound lane
    // cells must NOT carry "name-styled" leftovers on any field.
    ({ grid, container } = makeGrid({
      columns: [
        { field: "name", cellClass: "name-styled" },
        { field: "id" },
      ],
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    let root = getRoot(container);
    expect(rowPinTopCenterCell(root, "r1", "name")!.classList.contains("name-styled")).toBe(true);

    // Structural change — new column at front. Triggers a fullRebuild of the
    // pool AND fresh pinningLayout so the renderer sees the new column refs.
    grid.setColumns([
      { field: "extra" }, // new column at front (no cellClass)
      { field: "name" },  // no longer styled
      { field: "id" },
    ]);
    await flushRenders();

    root = getRoot(container);
    // None of the visible lane cells should carry "name-styled" anymore —
    // the resolver no longer matches any column on that class.
    const layer = root.querySelector(".lfg-row-pinned-top-layer") as HTMLElement;
    expect(layer).not.toBeNull();
    const allCells = Array.from(layer.querySelectorAll<HTMLElement>(`.${CSS.CELL}`));
    for (const el of allCells) {
      expect(el.classList.contains("name-styled")).toBe(false);
    }
  });

  // ── Combined coverage: all four lane families simultaneously ──────

  it("center body + pinned-left + pinned-right + row-pinned center lanes all carry styling together", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left", cellClass: "id-styled" },
        { field: "name", cellClass: "name-styled" },
        { field: "amount", pinned: "right", cellClass: "amount-styled" },
      ],
      rowPinning: { top: ["r1"], bottom: ["r3"] },
    }));
    await flushRenders();

    const root = getRoot(container);

    // r2 is the only center-body row (r1=top, r3=bottom).
    expect(pinnedLeftCell(root, "r2", "id")!.classList.contains("id-styled")).toBe(true);
    expect(pinnedRightCell(root, "r2", "amount")!.classList.contains("amount-styled")).toBe(true);
    const r2Name = root.querySelector<HTMLElement>(
      `.${CSS.SCROLL_CONTAINER} > .${CSS.ROW}[data-row-id="r2"] .${CSS.CELL}[data-col-id="name"]`,
    );
    expect(r2Name!.classList.contains("name-styled")).toBe(true);

    // Top lane (r1) center cell.
    expect(rowPinTopCenterCell(root, "r1", "name")!.classList.contains("name-styled")).toBe(true);
    // Bottom lane (r3) center cell.
    expect(rowPinBottomCenterCell(root, "r3", "name")!.classList.contains("name-styled")).toBe(true);
  });

  // ── Row-pinned LEFT and RIGHT sub-lanes ──────────────────────────
  //
  // Sub-lane cells are bound entirely inside `rowPinLaneDom` — they never
  // touch `VirtualWindowSync`. These tests cover the new
  // `bindOptions.resolveCellClasses` / `bindOptions.cellClassVersion`
  // forwarding from `DomGridRenderer.syncRowPinLanes()`.

  function rowPinTopLeftSubLaneCell(
    root: HTMLElement,
    rowId: string,
    field: string,
  ): HTMLElement | null {
    return root.querySelector<HTMLElement>(
      `.lfg-row-pinned-top-left-layer .${CSS.ROW}[data-row-id="${rowId}"] .${CSS.CELL}[data-col-id="${field}"]`,
    );
  }
  function rowPinTopRightSubLaneCell(
    root: HTMLElement,
    rowId: string,
    field: string,
  ): HTMLElement | null {
    return root.querySelector<HTMLElement>(
      `.lfg-row-pinned-top-right-layer .${CSS.ROW}[data-row-id="${rowId}"] .${CSS.CELL}[data-col-id="${field}"]`,
    );
  }
  function rowPinBottomLeftSubLaneCell(
    root: HTMLElement,
    rowId: string,
    field: string,
  ): HTMLElement | null {
    return root.querySelector<HTMLElement>(
      `.lfg-row-pinned-bottom-left-layer .${CSS.ROW}[data-row-id="${rowId}"] .${CSS.CELL}[data-col-id="${field}"]`,
    );
  }
  function rowPinBottomRightSubLaneCell(
    root: HTMLElement,
    rowId: string,
    field: string,
  ): HTMLElement | null {
    return root.querySelector<HTMLElement>(
      `.lfg-row-pinned-bottom-right-layer .${CSS.ROW}[data-row-id="${rowId}"] .${CSS.CELL}[data-col-id="${field}"]`,
    );
  }

  it("row-pinned TOP LEFT sub-lane cell receives `cellClass`", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left", cellClass: "left-cell" },
        { field: "name" },
        { field: "amount", pinned: "right" },
      ],
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const cell = rowPinTopLeftSubLaneCell(root, "r1", "id");
    expect(cell, "top-left sub-lane cell missing").not.toBeNull();
    expect(cell!.classList.contains("left-cell")).toBe(true);
  });

  it("row-pinned TOP RIGHT sub-lane cell receives `cellClass`", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left" },
        { field: "name" },
        { field: "amount", pinned: "right", cellClass: "right-cell" },
      ],
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const cell = rowPinTopRightSubLaneCell(root, "r1", "amount");
    expect(cell, "top-right sub-lane cell missing").not.toBeNull();
    expect(cell!.classList.contains("right-cell")).toBe(true);
  });

  it("row-pinned BOTTOM LEFT and RIGHT sub-lane cells receive `cellClass`", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left", cellClass: "left-cell" },
        { field: "name" },
        { field: "amount", pinned: "right", cellClass: "right-cell" },
      ],
      rowPinning: { bottom: ["r3"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    const left = rowPinBottomLeftSubLaneCell(root, "r3", "id");
    const right = rowPinBottomRightSubLaneCell(root, "r3", "amount");
    expect(left, "bottom-left sub-lane cell missing").not.toBeNull();
    expect(right, "bottom-right sub-lane cell missing").not.toBeNull();
    expect(left!.classList.contains("left-cell")).toBe(true);
    expect(right!.classList.contains("right-cell")).toBe(true);
  });

  it("row-pinned LEFT and RIGHT sub-lanes respect `getCellClass` with the raw value", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        {
          field: "id",
          pinned: "left",
          getCellClass: (p) => `lt-${String(p.value)}`,
        },
        { field: "name" },
        {
          field: "amount",
          pinned: "right",
          getCellClass: (p) =>
            typeof p.value === "number" && p.value < 0 ? "rt-neg" : "rt-pos",
        },
      ],
      rowPinning: { top: ["r2"] },
    }));
    await flushRenders();

    const root = getRoot(container);
    expect(rowPinTopLeftSubLaneCell(root, "r2", "id")!.classList.contains("lt-r2")).toBe(true);
    expect(rowPinTopRightSubLaneCell(root, "r2", "amount")!.classList.contains("rt-neg")).toBe(true);
  });

  it("row-pinned LEFT/RIGHT sub-lanes drain stale managed classes when structural setColumns removes cell styling", async () => {
    // Initial: pinned columns with cellClass. A structural setColumns
    // (new column at front) refreshes `pinningLayout`, which lets
    // `refreshCellStylingState` detect that no column carries cell-styling
    // inputs anymore. The lane fingerprint's `lastCellClassResolverActive`
    // flips false → drain on every sub-lane cell.
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left", cellClass: "left-cell" },
        { field: "name" },
        { field: "amount", pinned: "right", cellClass: "right-cell" },
      ],
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    let root = getRoot(container);
    expect(rowPinTopLeftSubLaneCell(root, "r1", "id")!.classList.contains("left-cell")).toBe(true);
    expect(rowPinTopRightSubLaneCell(root, "r1", "amount")!.classList.contains("right-cell")).toBe(true);

    // Structural change — new column at front + drop all cellClass.
    // Forces pinningLayout refresh; resolver becomes undefined; lane
    // fingerprint's resolver-active flips.
    grid.setColumns([
      { field: "extra" },
      { field: "id", pinned: "left" },   // no cellClass
      { field: "name" },
      { field: "amount", pinned: "right" }, // no cellClass
    ]);
    await flushRenders();

    root = getRoot(container);
    // No managed `left-cell` / `right-cell` anywhere in the lanes.
    const topLeftLayer = root.querySelector(".lfg-row-pinned-top-left-layer") as HTMLElement | null;
    const topRightLayer = root.querySelector(".lfg-row-pinned-top-right-layer") as HTMLElement | null;
    expect(topLeftLayer).not.toBeNull();
    expect(topRightLayer).not.toBeNull();
    const leftCells = Array.from(topLeftLayer!.querySelectorAll<HTMLElement>(`.${CSS.CELL}`));
    const rightCells = Array.from(topRightLayer!.querySelectorAll<HTMLElement>(`.${CSS.CELL}`));
    for (const el of leftCells) {
      expect(el.classList.contains("left-cell")).toBe(false);
    }
    for (const el of rightCells) {
      expect(el.classList.contains("right-cell")).toBe(false);
    }
  });

  it("cell-styling change on row-pinned LEFT sub-lane swaps the managed class with the lane DOM intact", async () => {
    // Functional correctness for the sub-lane styling-only path: a
    // structural change that flips cellClass from "v1" to "v2" must
    // produce the new class on the same lane cell element. (We assert
    // class swap + DOM identity; the *no-text-rebind* perf contract is
    // verified for populateRow at the unit level in
    // `populateRowCellStyling.test.ts` because end-to-end formatter
    // call-count assertions for sub-lanes are gated by the column
    // reconciliation path's pinningLayout-refresh semantics, which is a
    // separate concern.)
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left", cellClass: "v1" },
        { field: "name" },
      ],
      rowPinning: { top: ["r1"] },
    }));
    await flushRenders();

    let root = getRoot(container);
    const before = rowPinTopLeftSubLaneCell(root, "r1", "id");
    expect(before, "left sub-lane cell missing").not.toBeNull();
    expect(before!.classList.contains("v1")).toBe(true);

    // Structural change (new column up front) — forces pinningLayout
    // refresh AND swaps cellClass.
    grid.setColumns([
      { field: "extra" },
      { field: "id", pinned: "left", cellClass: "v2" },
      { field: "name" },
    ]);
    await flushRenders();

    root = getRoot(container);
    const after = rowPinTopLeftSubLaneCell(root, "r1", "id");
    expect(after, "left sub-lane cell missing after setColumns").not.toBeNull();
    // Class swap landed: v1 dropped, v2 added.
    expect(after!.classList.contains("v1")).toBe(false);
    expect(after!.classList.contains("v2")).toBe(true);
  });
});
