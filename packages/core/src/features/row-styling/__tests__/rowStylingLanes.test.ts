// @vitest-environment jsdom
//
// Cross-cutting row-styling coverage for the split DOM lanes:
// - column pinning (left / right pinned twin row elements)
// - row pinning (top / bottom center sub-lane + left / right sub-lanes)
// - horizontal virtualization
// - selection class independence

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { CSS } from "../../../rendering/const/css-classes";
import type { ColumnDef, RowData } from "../../../types";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

const baseRows: RowData[] = Array.from({ length: 6 }, (_, i) => ({
  id: `r${i}`,
  name: `name-${i}`,
  flag: i % 2 === 0,
}));

function getRoot(container: HTMLElement): HTMLElement {
  return container.querySelector(`.${CSS.GRID}`) as HTMLElement;
}

function topLayer(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-row-pinned-top-layer");
}
function bottomLayer(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-row-pinned-bottom-layer");
}
function topLeftSubLane(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-row-pinned-top-left-layer");
}
function topRightSubLane(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-row-pinned-top-right-layer");
}
function getLaneRowForId(layer: HTMLElement, rowId: string): HTMLElement | null {
  return layer.querySelector<HTMLElement>(`.${CSS.ROW}[data-row-id="${rowId}"]`);
}

function getCenterRowForId(root: HTMLElement, rowId: string): HTMLElement | null {
  const sc = root.querySelector(`.${CSS.SCROLL_CONTAINER}`)!;
  return sc.querySelector<HTMLElement>(
    `:scope > .${CSS.ROW}[data-row-id="${rowId}"]`,
  );
}

function getPinnedLeftRowForId(root: HTMLElement, rowId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `.lfg-pinned-row[data-row-id="${rowId}"]`,
  );
}
function getPinnedRightRowForId(root: HTMLElement, rowId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `.lfg-pinned-right-row[data-row-id="${rowId}"]`,
  );
}

interface MakeGridOpts {
  rows?: RowData[];
  columns?: ColumnDef[];
  rowPinning?: { top?: string[]; bottom?: string[] };
  rowClass?: string | string[];
  getRowClass?: Parameters<typeof Grid.prototype.setRowStyling>[0]["getRowClass"];
  rowClassRules?: Parameters<typeof Grid.prototype.setRowStyling>[0]["rowClassRules"];
  suppressColumnVirtualization?: boolean;
  rowSelection?: { mode: "single" | "multiple"; checkboxes?: boolean };
}

function makeGrid(opts: MakeGridOpts = {}) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "400px", width: "500px" });
  document.body.appendChild(container);

  const grid = new Grid({
    rows: opts.rows ?? baseRows,
    columns: opts.columns ?? [{ field: "id" }, { field: "name" }, { field: "flag" }],
    getRowId: (row) => row.id as string,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: opts.suppressColumnVirtualization ?? true,
    rowPinning: opts.rowPinning,
    rowClass: opts.rowClass,
    getRowClass: opts.getRowClass,
    rowClassRules: opts.rowClassRules,
    rowSelection: opts.rowSelection,
  });
  grid.mount(container);
  return { grid, container };
}

describe("row styling across lanes and pinning interactions", () => {
  let grid: Grid;
  let container: HTMLElement;

  afterEach(() => {
    grid.destroy();
    container.remove();
  });

  // ── Row-pinned top + bottom center lanes ────────────────────────────

  it("rowClassRules class appears on a row pinned TOP", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r0"] }, // r0 has flag === true
      rowClassRules: { "is-flagged": (p) => (p.row as { flag: boolean }).flag === true },
    }));
    await flushRenders();

    const root = getRoot(container);
    const laneRow = getLaneRowForId(topLayer(root)!, "r0")!;
    expect(laneRow).not.toBeNull();
    expect(laneRow.classList.contains("is-flagged")).toBe(true);
  });

  it("rowClassRules class appears on a row pinned BOTTOM", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { bottom: ["r4"] }, // r4 has flag === true
      rowClassRules: { "is-flagged": (p) => (p.row as { flag: boolean }).flag === true },
    }));
    await flushRenders();

    const root = getRoot(container);
    const laneRow = getLaneRowForId(bottomLayer(root)!, "r4")!;
    expect(laneRow).not.toBeNull();
    expect(laneRow.classList.contains("is-flagged")).toBe(true);
  });

  // ── Row-pinned LEFT / RIGHT sub-lanes ───────────────────────────────

  it("same class appears on pinned-LEFT sub-lane row of a row-pinned row", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left" },
        { field: "name" },
        { field: "flag" },
      ],
      rowPinning: { top: ["r0"] },
      rowClassRules: { "is-flagged": (p) => (p.row as { flag: boolean }).flag === true },
      suppressColumnVirtualization: false,
    }));
    await flushRenders();

    const root = getRoot(container);
    const leftLane = topLeftSubLane(root)!;
    expect(leftLane).not.toBeNull();
    const row = getLaneRowForId(leftLane, "r0")!;
    expect(row).not.toBeNull();
    expect(row.classList.contains("is-flagged")).toBe(true);
  });

  it("same class appears on pinned-RIGHT sub-lane row when right-pinned columns exist", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id" },
        { field: "name" },
        { field: "flag", pinned: "right" },
      ],
      rowPinning: { top: ["r0"] },
      rowClassRules: { "is-flagged": (p) => (p.row as { flag: boolean }).flag === true },
      suppressColumnVirtualization: false,
    }));
    await flushRenders();

    const root = getRoot(container);
    const rightLane = topRightSubLane(root)!;
    expect(rightLane).not.toBeNull();
    const row = getLaneRowForId(rightLane, "r0")!;
    expect(row).not.toBeNull();
    expect(row.classList.contains("is-flagged")).toBe(true);
  });

  // ── Column pinning for non-row-pinned (normal body) rows ────────────

  it("normal body row's pinned-LEFT twin element receives the same managed row class", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left" },
        { field: "name" },
      ],
      getRowClass: (p) => `rowstyle-${p.rowId}`,
      suppressColumnVirtualization: false,
    }));
    await flushRenders();

    const root = getRoot(container);
    // Center row gets `rowstyle-r0`.
    expect(getCenterRowForId(root, "r0")!.classList.contains("rowstyle-r0")).toBe(true);
    // Pinned-left twin row element gets the SAME class.
    const pinned = getPinnedLeftRowForId(root, "r0")!;
    expect(pinned).not.toBeNull();
    expect(pinned.classList.contains("rowstyle-r0")).toBe(true);
  });

  it("normal body row's pinned-RIGHT twin element also receives the same managed row class", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id" },
        { field: "name", pinned: "right" },
      ],
      getRowClass: (p) => `rowstyle-${p.rowId}`,
      suppressColumnVirtualization: false,
    }));
    await flushRenders();

    const root = getRoot(container);
    expect(getCenterRowForId(root, "r0")!.classList.contains("rowstyle-r0")).toBe(true);
    const pinned = getPinnedRightRowForId(root, "r0")!;
    expect(pinned).not.toBeNull();
    expect(pinned.classList.contains("rowstyle-r0")).toBe(true);
  });

  // ── Horizontal scroll preserves styling ─────────────────────────────

  it("horizontal scroll does NOT remove row styling on visible rows", async () => {
    const wideCols: ColumnDef[] = Array.from({ length: 30 }, (_, i) => ({
      field: `c${i}`,
      width: 100,
    }));
    const wideRows: RowData[] = Array.from({ length: 6 }, (_, r) => {
      const row: Record<string, unknown> = { id: `r${r}` };
      for (let i = 0; i < 30; i++) row[`c${i}`] = `${r}-${i}`;
      return row as RowData;
    });
    ({ grid, container } = makeGrid({
      rows: wideRows,
      columns: wideCols,
      rowClass: "stable-class",
      suppressColumnVirtualization: false,
    }));
    await flushRenders();

    const root = getRoot(container);
    expect(getCenterRowForId(root, "r0")!.classList.contains("stable-class")).toBe(true);

    const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    for (let s = 100; s <= 1500; s += 200) {
      viewport.scrollLeft = s;
      viewport.dispatchEvent(new Event("scroll"));
    }
    await flushRenders();

    // Same row element, same managed class — h-scroll cell rebinds do not
    // touch row-level classes.
    expect(getCenterRowForId(root, "r0")!.classList.contains("stable-class")).toBe(true);
  });

  // ── Column pin / unpin preserves styling ────────────────────────────

  it("column pin/unpin does NOT remove row styling", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id" },
        { field: "name" },
        { field: "flag" },
      ],
      rowClass: "persistent",
      suppressColumnVirtualization: false,
    }));
    await flushRenders();

    const root = getRoot(container);
    expect(getCenterRowForId(root, "r0")!.classList.contains("persistent")).toBe(true);

    // Pin "name" left — triggers column layout rebuild + cell re-bind.
    grid.pinColumn("name", "left");
    await flushRenders();
    // Center row still styled.
    expect(getCenterRowForId(root, "r0")!.classList.contains("persistent")).toBe(true);
    // Pinned-left twin also gets it.
    expect(getPinnedLeftRowForId(root, "r0")!.classList.contains("persistent")).toBe(true);

    // Unpin — back to all-center; styling preserved.
    grid.unpinColumn("name");
    await flushRenders();
    expect(getCenterRowForId(root, "r0")!.classList.contains("persistent")).toBe(true);
  });

  // ── Row pin clear: no stale managed class on recycled center rows ───

  it("swapping which row is pinned recycles the lane row and drops the previous row's managed class", async () => {
    // Direct recycle path: the same single-slot top lane DOM rebinds from r0
    // to r1. The managed-class diff helper must remove `rowstyle-r0` from the
    // lane row element and add `rowstyle-r1` — no stale class survives.
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r0"] },
      getRowClass: (p) => `rowstyle-${p.rowId}`,
    }));
    await flushRenders();

    const root = getRoot(container);
    const laneBefore = topLayer(root)!;
    const laneRowBefore = getLaneRowForId(laneBefore, "r0")!;
    expect(laneRowBefore.classList.contains("rowstyle-r0")).toBe(true);

    // Swap pinning — same row count keeps the lane structure stable so the
    // existing PooledRow rebinds in place.
    grid.setRowPinState([{ rowId: "r1", pinned: "top" }]);
    await flushRenders();

    // Lane element identity preserved (no rebuild) — same single slot, new
    // entry. The lane row element now binds r1.
    const laneAfter = topLayer(root)!;
    expect(laneAfter).toBe(laneBefore);
    const laneRowAfter = laneAfter.querySelector<HTMLElement>(`.${CSS.ROW}`)!;
    expect(laneRowAfter).toBe(laneRowBefore);
    expect(laneRowAfter.getAttribute("data-row-id")).toBe("r1");
    expect(laneRowAfter.classList.contains("rowstyle-r1")).toBe(true);
    // Stale class from previous bind is gone.
    expect(laneRowAfter.classList.contains("rowstyle-r0")).toBe(false);
  });

  it("clearing row pinning unmounts lane DOM and leaves no stale managed class anywhere in the lane tree", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r0"], bottom: ["r5"] },
      getRowClass: (p) => `rowstyle-${p.rowId}`,
    }));
    await flushRenders();

    const root = getRoot(container);
    // Sanity: lanes exist and carry the expected managed class.
    expect(getLaneRowForId(topLayer(root)!, "r0")!.classList.contains("rowstyle-r0")).toBe(true);
    expect(getLaneRowForId(bottomLayer(root)!, "r5")!.classList.contains("rowstyle-r5")).toBe(true);

    grid.clearRowPinning();
    await flushRenders();

    // Lane DOM gone — no managed-class leftovers can hide inside it.
    expect(topLayer(root)).toBeNull();
    expect(bottomLayer(root)).toBeNull();
    expect(root.querySelector(".lfg-row-pinned-top-left-layer")).toBeNull();
    expect(root.querySelector(".lfg-row-pinned-top-right-layer")).toBeNull();
    expect(root.querySelector(".lfg-row-pinned-bottom-left-layer")).toBeNull();
    expect(root.querySelector(".lfg-row-pinned-bottom-right-layer")).toBeNull();

    // Any center body row that is currently bound carries its OWN class and
    // not the formerly-pinned rows' classes (verifies no cross-contamination
    // through pool recycling for the rows that are bound after the clear).
    const sc = root.querySelector(`.${CSS.SCROLL_CONTAINER}`)!;
    const centerRows = Array.from(
      sc.querySelectorAll<HTMLElement>(`:scope > .${CSS.ROW}[data-row-id]`),
    );
    for (const el of centerRows) {
      const id = el.getAttribute("data-row-id")!;
      expect(el.classList.contains(`rowstyle-${id}`)).toBe(true);
      // None of the OTHER rows' classes leaked onto this row.
      for (const other of baseRows) {
        if (other.id === id) continue;
        expect(el.classList.contains(`rowstyle-${other.id as string}`)).toBe(false);
      }
    }
  });

  // ── Row pin transition: lane → center, lane DOM unmounted cleanly ───

  it("pinning then unpinning a single row leaves no stale lane DOM and applies fresh class to center row", async () => {
    ({ grid, container } = makeGrid({
      getRowClass: (p) => `rowstyle-${p.rowId}`,
    }));
    await flushRenders();

    const root = getRoot(container);
    expect(getCenterRowForId(root, "r2")!.classList.contains("rowstyle-r2")).toBe(true);

    grid.pinRow("r2", "top");
    await flushRenders();
    const laneRow = getLaneRowForId(topLayer(root)!, "r2")!;
    expect(laneRow).not.toBeNull();
    expect(laneRow.classList.contains("rowstyle-r2")).toBe(true);
    // Center no longer contains r2 while it's pinned.
    expect(getCenterRowForId(root, "r2")).toBeNull();

    grid.unpinRows(["r2"]);
    await flushRenders();
    expect(topLayer(root)).toBeNull();
    expect(getCenterRowForId(root, "r2")!.classList.contains("rowstyle-r2")).toBe(true);
  });

  // ── Selection class + styling class coexist ─────────────────────────

  it("selected row keeps `lfg-row-selected` AND the managed styling class", async () => {
    ({ grid, container } = makeGrid({
      rowSelection: { mode: "single" },
      rowClass: "styled",
    }));
    await flushRenders();

    grid.setSelectedRowIds(["r0"]);
    await flushRenders();

    const root = getRoot(container);
    const row = getCenterRowForId(root, "r0")!;
    expect(row.classList.contains("lfg-row-selected")).toBe(true);
    expect(row.classList.contains("styled")).toBe(true);

    // Toggling selection off must NOT remove the managed styling class.
    grid.clearSelection();
    await flushRenders();
    expect(row.classList.contains("lfg-row-selected")).toBe(false);
    expect(row.classList.contains("styled")).toBe(true);
  });

  // ── Runtime styling change flushes through to row-pinned lanes ────────
  //
  // Regression coverage for the lane-fingerprint cache bug: lane fingerprint
  // used to ignore `rowClassVersion`, so a runtime `setRowStyling(...)` call
  // would skip the entire lane rebind path and leave old managed classes on
  // the pinned-row DOM. The fix adds `lastRowClassVersion` to the
  // PinnedRowLaneState fingerprint so populateRow's managed-class diff runs
  // on each lane pool row when the version bumps.

  it("top row-pinned lane swaps old managed class for new after setRowStyling", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r0"] },
      rowClass: "old-class",
    }));
    await flushRenders();

    const root = getRoot(container);
    const laneBefore = topLayer(root)!;
    const laneRowBefore = getLaneRowForId(laneBefore, "r0")!;
    expect(laneRowBefore.classList.contains("old-class")).toBe(true);

    grid.setRowStyling({ rowClass: "new-class" });
    await flushRenders();

    // Lane element identity preserved — no DOM rebuild for a styling-only change.
    const laneAfter = topLayer(root)!;
    expect(laneAfter).toBe(laneBefore);
    const laneRowAfter = laneAfter.querySelector<HTMLElement>(`.${CSS.ROW}`)!;
    expect(laneRowAfter).toBe(laneRowBefore);

    expect(laneRowAfter.classList.contains("new-class")).toBe(true);
    expect(laneRowAfter.classList.contains("old-class")).toBe(false);
  });

  it("bottom row-pinned lane swaps old managed class for new after setRowStyling", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { bottom: ["r5"] },
      rowClass: "old-bottom",
    }));
    await flushRenders();

    const root = getRoot(container);
    const laneBefore = bottomLayer(root)!;
    const laneRowBefore = getLaneRowForId(laneBefore, "r5")!;
    expect(laneRowBefore.classList.contains("old-bottom")).toBe(true);

    grid.setRowStyling({ rowClass: "new-bottom" });
    await flushRenders();

    const laneAfter = bottomLayer(root)!;
    expect(laneAfter).toBe(laneBefore);
    const laneRowAfter = laneAfter.querySelector<HTMLElement>(`.${CSS.ROW}`)!;
    expect(laneRowAfter).toBe(laneRowBefore);

    expect(laneRowAfter.classList.contains("new-bottom")).toBe(true);
    expect(laneRowAfter.classList.contains("old-bottom")).toBe(false);
  });

  it("row-pinned LEFT sub-lane swaps old managed class for new after setRowStyling", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left" },
        { field: "name" },
        { field: "flag" },
      ],
      rowPinning: { top: ["r0"] },
      rowClass: "old-left",
      suppressColumnVirtualization: false,
    }));
    await flushRenders();

    const root = getRoot(container);
    const leftLaneBefore = topLeftSubLane(root)!;
    const leftRowBefore = getLaneRowForId(leftLaneBefore, "r0")!;
    expect(leftRowBefore.classList.contains("old-left")).toBe(true);

    grid.setRowStyling({ rowClass: "new-left" });
    await flushRenders();

    const leftLaneAfter = topLeftSubLane(root)!;
    expect(leftLaneAfter).toBe(leftLaneBefore);
    const leftRowAfter = leftLaneAfter.querySelector<HTMLElement>(`.${CSS.ROW}`)!;
    expect(leftRowAfter).toBe(leftRowBefore);

    expect(leftRowAfter.classList.contains("new-left")).toBe(true);
    expect(leftRowAfter.classList.contains("old-left")).toBe(false);
  });

  it("row-pinned RIGHT sub-lane swaps old managed class for new after setRowStyling", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id" },
        { field: "name" },
        { field: "flag", pinned: "right" },
      ],
      rowPinning: { top: ["r0"] },
      rowClass: "old-right",
      suppressColumnVirtualization: false,
    }));
    await flushRenders();

    const root = getRoot(container);
    const rightLaneBefore = topRightSubLane(root)!;
    const rightRowBefore = getLaneRowForId(rightLaneBefore, "r0")!;
    expect(rightRowBefore.classList.contains("old-right")).toBe(true);

    grid.setRowStyling({ rowClass: "new-right" });
    await flushRenders();

    const rightLaneAfter = topRightSubLane(root)!;
    expect(rightLaneAfter).toBe(rightLaneBefore);
    const rightRowAfter = rightLaneAfter.querySelector<HTMLElement>(`.${CSS.ROW}`)!;
    expect(rightRowAfter).toBe(rightRowBefore);

    expect(rightRowAfter.classList.contains("new-right")).toBe(true);
    expect(rightRowAfter.classList.contains("old-right")).toBe(false);
  });

  // Performance contract for the styling-only render path: no DOM rebuild,
  // lane + row element identity preserved, new class swapped in cleanly,
  // AND no cell-rebind work runs. The renderer short-circuits the full
  // render pipeline for snapshots where only `rowStylingVersion` differs;
  // it walks the visible pool rows and applies the managed-class diff
  // directly — never calling `populateRow`'s cell loop, never bumping
  // `columnVersion`, never re-running `syncPinnedRowCells`.

  it("setRowStyling does NOT re-invoke valueFormatter for center body rows", async () => {
    // Center body row whose column is NOT pinned anywhere — exercises the
    // styling-only fast path's center-pool walk.
    const nameFormatter = vi.fn(({ value }: { value: unknown }) => String(value ?? ""));

    ({ grid, container } = makeGrid({
      columns: [
        { field: "id" },
        { field: "name", valueFormatter: nameFormatter },
        { field: "flag" },
      ],
      rowClass: "old",
    }));
    await flushRenders();

    const callsAfterMount = nameFormatter.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    const root = getRoot(container);
    const rowBefore = getCenterRowForId(root, "r0")!;
    expect(rowBefore.classList.contains("old")).toBe(true);

    grid.setRowStyling({ rowClass: "new" });
    await flushRenders();

    // Styling-only render path bypassed populateRow entirely — formatter
    // was NOT called again.
    expect(nameFormatter.mock.calls.length).toBe(callsAfterMount);

    // Same row DOM, class swapped.
    expect(getCenterRowForId(root, "r0")).toBe(rowBefore);
    expect(rowBefore.classList.contains("old")).toBe(false);
    expect(rowBefore.classList.contains("new")).toBe(true);
  });

  it("setRowStyling does NOT re-invoke valueFormatter for top row-pinned center lane cells", async () => {
    const nameFormatter = vi.fn(({ value }: { value: unknown }) => String(value ?? ""));

    ({ grid, container } = makeGrid({
      columns: [
        { field: "id" },
        { field: "name", valueFormatter: nameFormatter },
        { field: "flag" },
      ],
      rowPinning: { top: ["r0"] },
      rowClass: "old",
    }));
    await flushRenders();

    const callsAfterMount = nameFormatter.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    const root = getRoot(container);
    const laneRowBefore = getLaneRowForId(topLayer(root)!, "r0")!;

    grid.setRowStyling({ rowClass: "new" });
    await flushRenders();

    // No cell rebind on top lane center cells.
    expect(nameFormatter.mock.calls.length).toBe(callsAfterMount);

    // Lane row identity preserved, class swapped.
    expect(getLaneRowForId(topLayer(root)!, "r0")).toBe(laneRowBefore);
    expect(laneRowBefore.classList.contains("old")).toBe(false);
    expect(laneRowBefore.classList.contains("new")).toBe(true);
  });

  it("setRowStyling does NOT re-invoke valueFormatter for bottom row-pinned center lane cells", async () => {
    const nameFormatter = vi.fn(({ value }: { value: unknown }) => String(value ?? ""));

    ({ grid, container } = makeGrid({
      columns: [
        { field: "id" },
        { field: "name", valueFormatter: nameFormatter },
        { field: "flag" },
      ],
      rowPinning: { bottom: ["r5"] },
      rowClass: "old",
    }));
    await flushRenders();

    const callsAfterMount = nameFormatter.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    const root = getRoot(container);
    const laneRowBefore = getLaneRowForId(bottomLayer(root)!, "r5")!;

    grid.setRowStyling({ rowClass: "new" });
    await flushRenders();

    expect(nameFormatter.mock.calls.length).toBe(callsAfterMount);

    expect(getLaneRowForId(bottomLayer(root)!, "r5")).toBe(laneRowBefore);
    expect(laneRowBefore.classList.contains("old")).toBe(false);
    expect(laneRowBefore.classList.contains("new")).toBe(true);
  });

  it("setRowStyling does NOT re-invoke valueGetter for row-pinned center cells", async () => {
    // valueGetter spy — confirms the styling-only path also avoids
    // re-running the cell-value pipeline upstream of valueFormatter.
    const nameGetter = vi.fn((p: { row: RowData }) => (p.row as { name: string }).name);

    ({ grid, container } = makeGrid({
      columns: [
        { field: "id" },
        { field: "name", valueGetter: nameGetter },
        { field: "flag" },
      ],
      rowPinning: { top: ["r0"] },
      rowClass: "old",
    }));
    await flushRenders();

    const callsAfterMount = nameGetter.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    grid.setRowStyling({ rowClass: "new" });
    await flushRenders();

    expect(nameGetter.mock.calls.length).toBe(callsAfterMount);
  });

  it("top row-pinned center lane preserves DOM identity on styling-only update", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r0"] },
      rowClass: "old",
    }));
    await flushRenders();

    const root = getRoot(container);
    const laneBefore = topLayer(root)!;
    const rowBefore = getLaneRowForId(laneBefore, "r0")!;

    grid.setRowStyling({ rowClass: "new" });
    await flushRenders();

    expect(topLayer(root)).toBe(laneBefore);
    expect(laneBefore.querySelector(`.${CSS.ROW}`)).toBe(rowBefore);
    expect(rowBefore.classList.contains("new")).toBe(true);
    expect(rowBefore.classList.contains("old")).toBe(false);
  });

  it("row-pinned LEFT and RIGHT sub-lane row identity is preserved across styling-only updates", async () => {
    ({ grid, container } = makeGrid({
      columns: [
        { field: "id", pinned: "left" },
        { field: "name" },
        { field: "flag", pinned: "right" },
      ],
      rowPinning: { top: ["r0"] },
      rowClass: "old",
      suppressColumnVirtualization: false,
    }));
    await flushRenders();

    const root = getRoot(container);
    const leftLaneBefore = topLeftSubLane(root)!;
    const rightLaneBefore = topRightSubLane(root)!;
    const leftRowBefore = getLaneRowForId(leftLaneBefore, "r0")!;
    const rightRowBefore = getLaneRowForId(rightLaneBefore, "r0")!;

    grid.setRowStyling({ rowClass: "new" });
    await flushRenders();

    // Both sub-lanes keep their element + row identity (lane reuse path).
    expect(topLeftSubLane(root)).toBe(leftLaneBefore);
    expect(topRightSubLane(root)).toBe(rightLaneBefore);
    expect(leftLaneBefore.querySelector(`.${CSS.ROW}`)).toBe(leftRowBefore);
    expect(rightLaneBefore.querySelector(`.${CSS.ROW}`)).toBe(rightRowBefore);

    // Both row elements swapped class.
    expect(leftRowBefore.classList.contains("new")).toBe(true);
    expect(leftRowBefore.classList.contains("old")).toBe(false);
    expect(rightRowBefore.classList.contains("new")).toBe(true);
    expect(rightRowBefore.classList.contains("old")).toBe(false);
  });

  it("setRowStyling flushes simultaneously to top, bottom, and center body lanes — single render path", async () => {
    ({ grid, container } = makeGrid({
      rowPinning: { top: ["r0"], bottom: ["r5"] },
      rowClass: "vA",
    }));
    await flushRenders();

    const root = getRoot(container);
    const topRow = getLaneRowForId(topLayer(root)!, "r0")!;
    const bottomRow = getLaneRowForId(bottomLayer(root)!, "r5")!;
    const centerRow = getCenterRowForId(root, "r1")!;
    expect(topRow.classList.contains("vA")).toBe(true);
    expect(bottomRow.classList.contains("vA")).toBe(true);
    expect(centerRow.classList.contains("vA")).toBe(true);

    grid.setRowStyling({ rowClass: "vB" });
    await flushRenders();

    // All three lane families pick up the new class on the same render path.
    expect(topRow.classList.contains("vA")).toBe(false);
    expect(topRow.classList.contains("vB")).toBe(true);
    expect(bottomRow.classList.contains("vA")).toBe(false);
    expect(bottomRow.classList.contains("vB")).toBe(true);
    expect(centerRow.classList.contains("vA")).toBe(false);
    expect(centerRow.classList.contains("vB")).toBe(true);
  });
});
