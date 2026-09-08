// @vitest-environment jsdom
// Unit tests for center column slot calculation.
// Uses min-width approach: slots are based on the narrowest center column
// to be safe at every horizontal scroll position.

import { describe, expect, it } from "vitest";

import type { ColumnPinningLayout } from "../../../features/column-pinning/columnPinningLayout";
import {
  computeCenterSlotCount,
} from "../calculateColumnPoolSize";

function makeLayout(
  center: { field: string; width?: number }[],
  left: { field: string; width?: number }[] = [],
  right: { field: string; width?: number }[] = [],
): ColumnPinningLayout {
  return {
    leftPinned: left.map((c) => ({ field: c.field, width: c.width })),
    center: center.map((c) => ({ field: c.field, width: c.width })),
    rightPinned: right.map((c) => ({ field: c.field, width: c.width })),
    ordered: [...left, ...center, ...right].map((c) => ({
      field: c.field,
      width: c.width,
    })),
  };
}

function fakeViewport(clientWidth: number): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", {
    value: clientWidth,
    configurable: true,
  });
  return el;
}

describe("computeCenterSlotCount", () => {
  it("returns 0 for no center columns", () => {
    const layout = makeLayout([], [{ field: "left", width: 100 }]);
    expect(computeCenterSlotCount(fakeViewport(800), layout, false)).toBe(0);
  });

  it("returns all center columns when suppressColumnVirtualization is true", () => {
    const center = Array.from({ length: 50 }, (_, i) => ({
      field: `c${i}`,
      width: 100,
    }));
    const layout = makeLayout(center);
    expect(computeCenterSlotCount(fakeViewport(800), layout, true)).toBe(50);
  });

  it("wide/default columns keep reasonable slot count", () => {
    // 5 columns at 200px. minWidth=200, viewport 800.
    // visible = ceil(800/200) = 4, slots = 4+4 = 8, clamped to 5.
    const center = Array.from({ length: 5 }, (_, i) => ({
      field: `c${i}`,
      width: 200,
    }));
    const layout = makeLayout(center);
    expect(computeCenterSlotCount(fakeViewport(800), layout, false)).toBe(5);
  });

  it("wide columns wider than DEFAULT_COL_WIDTH do not over-allocate", () => {
    // 10 columns at 300px (all wider than DEFAULT_COL_WIDTH=150). viewport 900.
    // minWidth = 300 (actual), not 150 (default).
    // visible = ceil(900/300) = 3, slots = 3+4 = 7, clamped to 7.
    const center = Array.from({ length: 10 }, (_, i) => ({
      field: `c${i}`,
      width: 300,
    }));
    const layout = makeLayout(center);
    expect(computeCenterSlotCount(fakeViewport(900), layout, false)).toBe(7);
  });

  it("narrow columns allocate enough slots to cover viewport", () => {
    // 20 columns at 60px. minWidth=60, viewport 800.
    // visible = ceil(800/60) = 14, slots = 14+4 = 18.
    const center = Array.from({ length: 20 }, (_, i) => ({
      field: `c${i}`,
      width: 60,
    }));
    const layout = makeLayout(center);
    expect(computeCenterSlotCount(fakeViewport(800), layout, false)).toBe(18);
  });

  it("pinned left/right widths reduce available center width", () => {
    // Viewport 1000, pinned left 200, right 100 → available 700.
    // 15 columns at 50px. visible = ceil(700/50) = 14, slots = 14+4 = 18, clamped to 15.
    const center = Array.from({ length: 15 }, (_, i) => ({
      field: `c${i}`,
      width: 50,
    }));
    const layout = makeLayout(
      center,
      [{ field: "left", width: 200 }],
      [{ field: "right", width: 100 }],
    );
    expect(computeCenterSlotCount(fakeViewport(1000), layout, false)).toBe(15);
  });

  it("sizeColumnsToFit scenario: many columns at ~48px allocate enough slots", () => {
    // 20 columns at 48px. minWidth=48, viewport 1000.
    // visible = ceil(1000/48) = 21, but only 20 columns → clamped to 20.
    const center = Array.from({ length: 20 }, (_, i) => ({
      field: `c${i}`,
      width: 48,
    }));
    const layout = makeLayout(center);
    expect(computeCenterSlotCount(fakeViewport(1000), layout, false)).toBe(20);
  });

  it("sizeColumnsToFit scenario: enough columns for partial coverage", () => {
    // 30 columns at 60px. minWidth=60, viewport 800.
    // visible = ceil(800/60) = 14, slots = 14+4 = 18.
    const center = Array.from({ length: 30 }, (_, i) => ({
      field: `c${i}`,
      width: 60,
    }));
    const layout = makeLayout(center);
    expect(computeCenterSlotCount(fakeViewport(800), layout, false)).toBe(18);
  });

  it("falls back to DEFAULT_VIEWPORT_HEIGHT when viewport has no layout", () => {
    // null viewport → fallback 600px. 10 columns at 100px.
    // visible = ceil(600/100) = 6, slots = 6+4 = 10.
    const center = Array.from({ length: 10 }, (_, i) => ({
      field: `c${i}`,
      width: 100,
    }));
    const layout = makeLayout(center);
    expect(computeCenterSlotCount(null, layout, false)).toBe(10);
  });

  it("uses default column width when width is undefined", () => {
    // Columns without width use DEFAULT_COL_WIDTH (150).
    // minWidth=150, viewport 800. visible = ceil(800/150) = 6, slots = 6+4 = 10.
    const center = Array.from({ length: 15 }, (_, i) => ({
      field: `c${i}`,
    }));
    const layout = makeLayout(center);
    expect(computeCenterSlotCount(fakeViewport(800), layout, false)).toBe(10);
  });

  it("single center column returns 1", () => {
    const layout = makeLayout([{ field: "only", width: 100 }]);
    expect(computeCenterSlotCount(fakeViewport(800), layout, false)).toBe(1);
  });

  it("buffer does not exceed center column count", () => {
    // 3 columns at 50px. minWidth=50, viewport 800.
    // visible = ceil(800/50) = 16, slots = 16+4 = 20, clamped to 3.
    const center = [
      { field: "a", width: 50 },
      { field: "b", width: 50 },
      { field: "c", width: 50 },
    ];
    const layout = makeLayout(center);
    expect(computeCenterSlotCount(fakeViewport(800), layout, false)).toBe(3);
  });

  // ── Mixed-width edge cases ──────────────────────────────────

  it("mixed widths: early wide, later narrow — allocates based on narrowest", () => {
    // First 5 columns at 200px, next 15 columns at 48px. viewport 800.
    // minWidth = 48, visible = ceil(800/48) = 17, slots = 17+4 = 21, clamped to 20.
    const center = [
      ...Array.from({ length: 5 }, (_, i) => ({ field: `wide${i}`, width: 200 })),
      ...Array.from({ length: 15 }, (_, i) => ({ field: `narrow${i}`, width: 48 })),
    ];
    const layout = makeLayout(center);
    const slots = computeCenterSlotCount(fakeViewport(800), layout, false);
    // Must allocate enough for narrow-column region: ceil(800/48)=17 + 4 = 21,
    // clamped to 20. A scan-from-start approach would only allocate ~8 here.
    expect(slots).toBe(20);
  });

  it("mixed widths with pinned columns reduce available width correctly", () => {
    // Viewport 1000, pinned left 150, right 100 → available 750.
    // Center: 3 wide (300px) + 10 narrow (50px). minWidth=50.
    // visible = ceil(750/50) = 15, slots = 15+4 = 19, clamped to 13.
    const center = [
      ...Array.from({ length: 3 }, (_, i) => ({ field: `wide${i}`, width: 300 })),
      ...Array.from({ length: 10 }, (_, i) => ({ field: `narrow${i}`, width: 50 })),
    ];
    const layout = makeLayout(
      center,
      [{ field: "left", width: 150 }],
      [{ field: "right", width: 100 }],
    );
    expect(computeCenterSlotCount(fakeViewport(1000), layout, false)).toBe(13);
  });

  it("zero-width columns are skipped in min-width calculation", () => {
    // One column with width 0, 11 others at 80px. minWidth = 80 (skip 0).
    // viewport 800. visible = ceil(800/80) = 10, slots = 10+4 = 14, clamped to 12.
    const center = [
      { field: "zero", width: 0 },
      ...Array.from({ length: 11 }, (_, i) => ({ field: `c${i}`, width: 80 })),
    ];
    const layout = makeLayout(center);
    const slots = computeCenterSlotCount(fakeViewport(800), layout, false);
    // The zero-width column is ignored; min is 80. Clamped to center count (12).
    expect(slots).toBe(12);
  });
});
