// @vitest-environment jsdom
//
// Pure-helper unit tests for sizeColumnsToFit, plus Grid-level integration
// tests for sizeSelectedColumnsToFit.

import { describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { GridState } from "../../../state/GridState";
import type { ColumnDef, RowData } from "../../../types";
import {
  buildSizeToFitColumns,
  computeReservedWidth,
  computeSizeSelectedToFit,
  computeSizeToFit,
  isSizeToFitEligible,
} from "../sizeColumnsToFit";

// ── isSizeToFitEligible ───────────────────────────────────────

describe("isSizeToFitEligible", () => {
  it("includes a normal visible center column", () => {
    expect(isSizeToFitEligible({ field: "name" })).toBe(true);
  });

  it("excludes hidden columns", () => {
    expect(isSizeToFitEligible({ field: "name", visible: false })).toBe(false);
  });

  it("excludes pinned-left columns", () => {
    expect(isSizeToFitEligible({ field: "name", pinned: "left" })).toBe(false);
  });

  it("excludes pinned-right columns", () => {
    expect(isSizeToFitEligible({ field: "name", pinned: "right" })).toBe(false);
  });

  it("excludes internal selection column", () => {
    expect(
      isSizeToFitEligible({ field: "__lfg_selection__", internal: "selection" }),
    ).toBe(false);
  });

  it("excludes internal row-drag column", () => {
    expect(
      isSizeToFitEligible({ field: "__lfg_row_drag__", internal: "row-drag" }),
    ).toBe(false);
  });

  it("excludes internal combined row-controls column", () => {
    expect(
      isSizeToFitEligible({ field: "__lfg_row_controls__", internal: "row-controls" }),
    ).toBe(false);
  });

  it("excludes action columns", () => {
    expect(
      isSizeToFitEligible({ field: "actions", cellKind: "actions" }),
    ).toBe(false);
  });

  it("excludes columns with suppressSizeToFit", () => {
    expect(
      isSizeToFitEligible({ field: "id", suppressSizeToFit: true }),
    ).toBe(false);
  });

  it("excludes non-resizable columns", () => {
    expect(
      isSizeToFitEligible({ field: "locked", resizable: false }),
    ).toBe(false);
  });

  it("includes column with suppressSizeToFit: false", () => {
    expect(
      isSizeToFitEligible({ field: "id", suppressSizeToFit: false }),
    ).toBe(true);
  });
});

// ── buildSizeToFitColumns ─────────────────────────────────────

describe("buildSizeToFitColumns", () => {
  it("filters out ineligible columns", () => {
    const columns: ColumnDef[] = [
      { field: "__lfg_selection__", internal: "selection", width: 44 },
      { field: "name", width: 200 },
      { field: "amount", width: 100, pinned: "right" },
      { field: "status", width: 150 },
    ];
    const result = buildSizeToFitColumns(columns);
    expect(result.map((c) => c.field)).toEqual(["name", "status"]);
  });
});

// ── computeSizeToFit ──────────────────────────────────────────

describe("computeSizeToFit", () => {
  it("returns empty widths for empty columns", () => {
    expect(computeSizeToFit([], 800)).toEqual({ widths: {} });
  });

  it("returns empty widths for zero target", () => {
    const cols = buildSizeToFitColumns([
      { field: "a", width: 100 },
    ]);
    expect(computeSizeToFit(cols, 0)).toEqual({ widths: {} });
  });

  it("returns empty widths for negative target", () => {
    const cols = buildSizeToFitColumns([
      { field: "a", width: 100 },
    ]);
    expect(computeSizeToFit(cols, -100)).toEqual({ widths: {} });
  });

  it("proportionally expands columns to fill target", () => {
    const cols = buildSizeToFitColumns([
      { field: "a", width: 100 },
      { field: "b", width: 200 },
    ]);
    // Total current = 300, target = 600 → 2x scale.
    const { widths } = computeSizeToFit(cols, 600);
    expect(widths.a).toBe(200);
    expect(widths.b).toBe(400);
  });

  it("proportionally shrinks columns to fit target", () => {
    const cols = buildSizeToFitColumns([
      { field: "a", width: 400 },
      { field: "b", width: 400 },
    ]);
    // Total current = 800, target = 400 → 0.5x scale.
    const { widths } = computeSizeToFit(cols, 400);
    expect(widths.a).toBe(200);
    expect(widths.b).toBe(200);
  });

  it("respects minWidth", () => {
    const cols = buildSizeToFitColumns([
      { field: "a", width: 200, minWidth: 180 },
      { field: "b", width: 200 },
    ]);
    // Target = 200 total. Proportional = 100 each, but a has min 180.
    // a clamps to 180, b gets remaining 20 (but b's min is 48, so b=48).
    const { widths } = computeSizeToFit(cols, 200);
    expect(widths.a).toBeGreaterThanOrEqual(180);
    expect(widths.b).toBeGreaterThanOrEqual(48);
  });

  it("respects maxWidth", () => {
    const cols = buildSizeToFitColumns([
      { field: "a", width: 100, maxWidth: 200 },
      { field: "b", width: 100 },
    ]);
    // Target = 1000. Proportional = 500 each, but a maxes at 200.
    // Remaining 800 - 200 = 800 → b gets 800.
    const { widths } = computeSizeToFit(cols, 1000);
    expect(widths.a).toBe(200);
    expect(widths.b).toBe(800);
  });

  it("rounded widths sum close to target", () => {
    const cols = buildSizeToFitColumns([
      { field: "a", width: 100 },
      { field: "b", width: 100 },
      { field: "c", width: 100 },
    ]);
    const target = 1000;
    const { widths } = computeSizeToFit(cols, target);
    const sum = Object.values(widths).reduce((s, w) => s + w, 0);
    // Should be within ±1 of target due to rounding.
    expect(Math.abs(sum - target)).toBeLessThanOrEqual(1);
  });

  it("all widths are integers", () => {
    const cols = buildSizeToFitColumns([
      { field: "a", width: 137 },
      { field: "b", width: 213 },
      { field: "c", width: 97 },
    ]);
    const { widths } = computeSizeToFit(cols, 999);
    for (const w of Object.values(widths)) {
      expect(Number.isInteger(w)).toBe(true);
    }
  });

  it("handles single column", () => {
    const cols = buildSizeToFitColumns([
      { field: "a", width: 100 },
    ]);
    const { widths } = computeSizeToFit(cols, 500);
    expect(widths.a).toBe(500);
  });

  it("handles all columns at minWidth when target is very small", () => {
    const cols = buildSizeToFitColumns([
      { field: "a", width: 200, minWidth: 100 },
      { field: "b", width: 200, minWidth: 100 },
    ]);
    // Target = 100, but both have min 100 → both get 100.
    const { widths } = computeSizeToFit(cols, 100);
    expect(widths.a).toBe(100);
    expect(widths.b).toBe(100);
  });

  it("handles all columns at maxWidth when target is very large", () => {
    const cols = buildSizeToFitColumns([
      { field: "a", width: 100, maxWidth: 300 },
      { field: "b", width: 100, maxWidth: 300 },
    ]);
    const { widths } = computeSizeToFit(cols, 10000);
    expect(widths.a).toBe(300);
    expect(widths.b).toBe(300);
  });
});

// ── Target width calculation (mirrors Grid.sizeColumnsToFit logic) ────

describe("sizeColumnsToFit target calculation", () => {
  /** Uses the production computeReservedWidth helper. */
  function computeTarget(columns: ColumnDef[], viewportWidth: number): number {
    const eligible = buildSizeToFitColumns(columns);
    const eligibleFields = new Set(eligible.map((c) => c.field));
    return viewportWidth - computeReservedWidth(columns, eligibleFields);
  }

  it("subtracts pinned column widths from viewport", () => {
    const columns: ColumnDef[] = [
      { field: "sel", internal: "selection", width: 44, pinned: "left" },
      { field: "a", width: 200 },
      { field: "b", width: 200 },
      { field: "c", width: 100, pinned: "right" },
    ];
    // viewport=1000, pinned sel=44 + pinned c=100 = 144
    // a and b are eligible → target = 1000 - 144 = 856
    expect(computeTarget(columns, 1000)).toBe(856);
  });

  it("subtracts excluded visible center column widths (selection, actions, suppressSizeToFit)", () => {
    const columns: ColumnDef[] = [
      { field: "sel", internal: "selection", width: 44 },        // excluded: internal
      { field: "act", cellKind: "actions", width: 50 },           // excluded: actions
      { field: "frozen", width: 100, suppressSizeToFit: true },   // excluded: suppressed
      { field: "a", width: 200 },                                 // eligible
      { field: "b", width: 200 },                                 // eligible
    ];
    // viewport=1000, excluded center = sel(44) + act(50) + frozen(100) = 194
    // eligible: a + b → target = 1000 - 194 = 806
    expect(computeTarget(columns, 1000)).toBe(806);
  });

  it("does not subtract hidden columns from target", () => {
    const columns: ColumnDef[] = [
      { field: "hidden", width: 300, visible: false },  // hidden — ignored
      { field: "a", width: 200 },                       // eligible
      { field: "b", width: 200 },                       // eligible
    ];
    // viewport=1000, no visible excluded → target = 1000
    expect(computeTarget(columns, 1000)).toBe(1000);
  });

  it("eligible columns fill only remaining space after exclusions", () => {
    const columns: ColumnDef[] = [
      { field: "sel", internal: "selection", width: 44 },
      { field: "act", cellKind: "actions", width: 50 },
      { field: "pinL", width: 120, pinned: "left" },
      { field: "a", width: 100 },
      { field: "b", width: 100 },
      { field: "pinR", width: 80, pinned: "right" },
    ];
    const target = computeTarget(columns, 1000);
    // excluded: sel(44) + act(50) + pinL(120) + pinR(80) = 294
    // target = 1000 - 294 = 706
    expect(target).toBe(706);

    const eligible = buildSizeToFitColumns(columns);
    const { widths } = computeSizeToFit(eligible, target);
    const sum = Object.values(widths).reduce((s, w) => s + w, 0);
    // Eligible widths should sum to the target (±1 rounding).
    expect(Math.abs(sum - target)).toBeLessThanOrEqual(1);
    // Only eligible fields are in the result.
    expect(Object.keys(widths).sort()).toEqual(["a", "b"]);
  });

  it("subtracts non-resizable visible center column width from target", () => {
    const columns: ColumnDef[] = [
      { field: "locked", width: 80, resizable: false },  // excluded: non-resizable
      { field: "a", width: 200 },                        // eligible
      { field: "b", width: 200 },                        // eligible
    ];
    // viewport=1000, excluded center = locked(80)
    // target = 1000 - 80 = 920
    expect(computeTarget(columns, 1000)).toBe(920);
  });

  it("non-resizable columns do not appear in computed widths", () => {
    const columns: ColumnDef[] = [
      { field: "locked", width: 80, resizable: false },
      { field: "a", width: 100 },
      { field: "b", width: 100 },
    ];
    const target = computeTarget(columns, 1000);
    const eligible = buildSizeToFitColumns(columns);
    const { widths } = computeSizeToFit(eligible, target);

    expect(widths).not.toHaveProperty("locked");
    expect(Object.keys(widths).sort()).toEqual(["a", "b"]);
    const sum = Object.values(widths).reduce((s, w) => s + w, 0);
    expect(Math.abs(sum - target)).toBeLessThanOrEqual(1);
  });
});

// ── GridState integration ─────────────────────────────────────

describe("GridState.setColumnWidths batch", () => {
  it("batch-sets widths in a single revision bump", () => {
    const state = new GridState({
      rows: [{ id: "r1" }],
      columns: [
        { field: "a", width: 100 },
        { field: "b", width: 200 },
        { field: "c", width: 300 },
      ],
    });
    const revBefore = (state as unknown as { revision: number }).revision;
    const changed = state.setColumnWidths({ a: 150, b: 250 });
    const revAfter = (state as unknown as { revision: number }).revision;

    expect(changed).toEqual(["a", "b"]);
    expect(revAfter).toBe(revBefore + 1);
    expect(state.getColumnWidth("a")).toBe(150);
    expect(state.getColumnWidth("b")).toBe(250);
    expect(state.getColumnWidth("c")).toBe(300); // unchanged
  });

  it("returns empty array when no widths change", () => {
    const state = new GridState({
      rows: [{ id: "r1" }],
      columns: [{ field: "a", width: 100 }],
    });
    const changed = state.setColumnWidths({ a: 100 });
    expect(changed).toEqual([]);
  });
});

// ── resetColumnWidths ─────────────────────────────────────────

describe("GridState.resetColumnWidths", () => {
  it("restores original schema widths after resize", () => {
    const state = new GridState({
      rows: [{ id: "r1" }],
      columns: [
        { field: "a", width: 100 },
        { field: "b", width: 200 },
        { field: "c" }, // no explicit width
      ],
    });
    // Simulate resize
    state.setColumnWidths({ a: 50, b: 300 });
    expect(state.getColumnWidth("a")).toBe(50);
    expect(state.getColumnWidth("b")).toBe(300);

    // Reset
    const changed = state.resetColumnWidths();
    expect(changed.sort()).toEqual(["a", "b"]);
    expect(state.getColumnWidth("a")).toBe(100);
    expect(state.getColumnWidth("b")).toBe(200);
    expect(state.getColumnWidth("c")).toBeUndefined(); // stays undefined
  });

  it("returns empty array when widths already match baseline", () => {
    const state = new GridState({
      rows: [{ id: "r1" }],
      columns: [{ field: "a", width: 100 }],
    });
    const changed = state.resetColumnWidths();
    expect(changed).toEqual([]);
  });

  it("baseline updates when setColumns is called with new schema", () => {
    const state = new GridState({
      rows: [{ id: "r1" }],
      columns: [{ field: "a", width: 100 }],
    });
    // Resize
    state.setColumnWidths({ a: 50 });
    // New schema
    state.setColumns([{ field: "a", width: 200 }, { field: "b", width: 300 }]);
    // Resize again
    state.setColumnWidths({ a: 80 });
    // Reset should restore to 200 (new baseline), not 100 (old)
    state.resetColumnWidths();
    expect(state.getColumnWidth("a")).toBe(200);
    expect(state.getColumnWidth("b")).toBe(300);
  });

  it("skips hidden columns — does not mutate or return them", () => {
    const state = new GridState({
      rows: [{ id: "r1" }],
      columns: [
        { field: "a", width: 100 },
        { field: "b", width: 200, visible: false },
      ],
    });
    // Mutate visible column width
    state.setColumnWidths({ a: 50 });

    const changed = state.resetColumnWidths();
    expect(changed).toEqual(["a"]);
    expect(state.getColumnWidth("a")).toBe(100); // restored
    // b should not appear in changed
    expect(changed).not.toContain("b");
  });

  it("single revision bump for all changes", () => {
    const state = new GridState({
      rows: [{ id: "r1" }],
      columns: [
        { field: "a", width: 100 },
        { field: "b", width: 200 },
      ],
    });
    state.setColumnWidths({ a: 50, b: 300 });
    const revBefore = (state as unknown as { revision: number }).revision;
    state.resetColumnWidths();
    const revAfter = (state as unknown as { revision: number }).revision;
    expect(revAfter).toBe(revBefore + 1);
  });
});

// ── computeSizeSelectedToFit ───────────────────────────────────

describe("computeSizeSelectedToFit", () => {
  it("selected columns resize when reserved width is less than viewport", () => {
    const columns: ColumnDef[] = [
      { field: "a", width: 200 },
      { field: "b", width: 200 },
      { field: "c", width: 200 },
    ];
    const eligible = buildSizeToFitColumns(columns).filter(
      (c) => c.field === "a" || c.field === "c",
    );
    // viewport=1000, reserved=200 (b), available=800
    const { widths } = computeSizeSelectedToFit(columns, eligible, 1000);

    expect(Object.keys(widths).sort()).toEqual(["a", "c"]);
    expect(widths).not.toHaveProperty("b");
    const sum = Object.values(widths).reduce((s, w) => s + w, 0);
    expect(Math.abs(sum - 800)).toBeLessThanOrEqual(1);
  });

  it("selected columns shrink to minWidth when reserved width exceeds viewport", () => {
    // 3 unselected columns at 500px each = 1500px reserved.
    // viewport = 1000. available = 1000 - 1500 = -500.
    // Selected columns should get their minWidth.
    const columns: ColumnDef[] = [
      { field: "big1", width: 500 },
      { field: "big2", width: 500 },
      { field: "big3", width: 500 },
      { field: "sel1", width: 200 },
      { field: "sel2", width: 200 },
    ];
    const eligible = buildSizeToFitColumns(columns).filter(
      (c) => c.field === "sel1" || c.field === "sel2",
    );
    const { widths } = computeSizeSelectedToFit(columns, eligible, 1000);

    // Both should be at minWidth (default 48).
    expect(widths.sel1).toBe(48);
    expect(widths.sel2).toBe(48);
    expect(widths).not.toHaveProperty("big1");
    expect(widths).not.toHaveProperty("big2");
    expect(widths).not.toHaveProperty("big3");
  });

  it("unselected columns are never included in returned widths", () => {
    const columns: ColumnDef[] = [
      { field: "a", width: 200 },
      { field: "b", width: 200 },
    ];
    const eligible = buildSizeToFitColumns(columns).filter(
      (c) => c.field === "a",
    );
    const { widths } = computeSizeSelectedToFit(columns, eligible, 1000);

    expect(widths).toHaveProperty("a");
    expect(widths).not.toHaveProperty("b");
  });

  it("selected pinned/action/hidden/non-resizable/suppressSizeToFit columns are ignored", () => {
    const columns: ColumnDef[] = [
      { field: "pinned", width: 200, pinned: "left" },
      { field: "action", width: 200, cellKind: "actions" },
      { field: "hidden", width: 200, visible: false },
      { field: "locked", width: 200, resizable: false },
      { field: "suppressed", width: 200, suppressSizeToFit: true },
      { field: "ok", width: 200 },
    ];
    const allSelected = new Set(["pinned", "action", "hidden", "locked", "suppressed", "ok"]);
    const eligible = buildSizeToFitColumns(columns).filter(
      (c) => allSelected.has(c.field),
    );
    // Only "ok" is eligible.
    expect(eligible.map((c) => c.field)).toEqual(["ok"]);

    const { widths } = computeSizeSelectedToFit(columns, eligible, 1000);
    expect(Object.keys(widths)).toEqual(["ok"]);
  });

  it("no selected eligible columns returns empty widths", () => {
    const columns: ColumnDef[] = [
      { field: "a", width: 200 },
    ];
    const { widths } = computeSizeSelectedToFit(columns, [], 1000);
    expect(widths).toEqual({});
  });

  it("custom minWidth is respected in the min fallback case", () => {
    const columns: ColumnDef[] = [
      { field: "big", width: 2000 },
      { field: "sel", width: 200, minWidth: 100 },
    ];
    const eligible = buildSizeToFitColumns(columns).filter(
      (c) => c.field === "sel",
    );
    // viewport=500, reserved=2000, available=-1500 <= minTotal=100
    const { widths } = computeSizeSelectedToFit(columns, eligible, 500);
    expect(widths.sel).toBe(100);
  });
});

// ── Grid.sizeSelectedColumnsToFit integration ─────────────────

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

describe("Grid.sizeSelectedColumnsToFit integration", () => {
  it("resizes only selected eligible center columns via the runtime API", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "300px", width: "600px" });
    document.body.appendChild(container);

    const rows: RowData[] = [{ id: "r1", a: 1, b: 2, c: 3 }];
    const onResized = vi.fn();

    const grid = new Grid({
      rows,
      columns: [
        { field: "a", width: 200 },
        { field: "b", width: 200 },
        { field: "c", width: 200 },
      ],
      getRowId: (row) => row.id as string,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      columnSelection: { mode: "multiple" },
    });
    grid.on("column:resized", onResized);
    grid.mount(container);
    await flushRenders();

    // JSDOM viewport.clientWidth is 0 — mock getViewportWidth on the
    // renderer so the sizing API has a usable viewport width.
    const renderer = (grid as unknown as { renderer: { getViewportWidth: () => number } }).renderer;
    const origGetViewportWidth = renderer.getViewportWidth.bind(renderer);
    renderer.getViewportWidth = () => 800;

    // Select columns a and c via the runtime API.
    grid.setSelectedColumnIds(["a", "c"]);
    await flushRenders();

    // Call sizeSelectedColumnsToFit.
    grid.sizeSelectedColumnsToFit("api");
    await flushRenders();

    // Only "a" and "c" should have resize events; "b" should not.
    const resizedFields = onResized.mock.calls.map(
      ([e]: [{ field: string }]) => e.field,
    );
    expect(resizedFields).toContain("a");
    expect(resizedFields).toContain("c");
    expect(resizedFields).not.toContain("b");

    renderer.getViewportWidth = origGetViewportWidth;
    grid.destroy();
    container.remove();
  });

  it("no-ops when no columns are selected", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "300px", width: "600px" });
    document.body.appendChild(container);

    const onResized = vi.fn();
    const grid = new Grid({
      rows: [{ id: "r1", a: 1 }] as RowData[],
      columns: [{ field: "a", width: 200 }],
      getRowId: (row) => row.id as string,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      columnSelection: { mode: "multiple" },
    });
    grid.on("column:resized", onResized);
    grid.mount(container);
    await flushRenders();

    // No columns selected — should be a no-op.
    grid.sizeSelectedColumnsToFit("api");
    await flushRenders();

    expect(onResized).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });
});
