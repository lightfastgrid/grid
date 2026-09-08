import { describe, expect, it } from "vitest";

import { DEFAULT_COL_WIDTH } from "../../../internal/columnSizing";
import { createSelectionColumnDef } from "../../../internal/selectionColumn";
import type { ColumnDef } from "../../../types";
import { buildColumnPinningGeometry } from "../columnPinningGeometry";
import { buildColumnPinningLayout } from "../columnPinningLayout";

function col(field: string, overrides?: Partial<ColumnDef>): ColumnDef {
  return { field, ...overrides };
}

function layoutFor(cols: ColumnDef[]) {
  return buildColumnPinningLayout(cols);
}

describe("buildColumnPinningGeometry", () => {
  it("no pinned columns => leftPinnedWidth 0, centerWidth equals all column widths", () => {
    const cols = [col("a", { width: 100 }), col("b", { width: 200 })];
    const geo = buildColumnPinningGeometry(layoutFor(cols));

    expect(geo.leftPinnedWidth).toBe(0);
    expect(geo.centerWidth).toBe(300);
    expect(geo.totalWidth).toBe(300);
    expect(geo.leftOffsetsByField.size).toBe(0);
    expect(geo.centerOffsetsByField.get("a")).toBe(0);
    expect(geo.centerOffsetsByField.get("b")).toBe(100);
  });

  it("one left pinned column => left offset 0, center offsets start at 0", () => {
    const cols = [
      col("p", { pinned: "left", width: 80 }),
      col("c1", { width: 120 }),
      col("c2", { width: 200 }),
    ];
    const geo = buildColumnPinningGeometry(layoutFor(cols));

    expect(geo.leftPinnedWidth).toBe(80);
    expect(geo.leftOffsetsByField.get("p")).toBe(0);
    expect(geo.centerOffsetsByField.get("c1")).toBe(0);
    expect(geo.centerOffsetsByField.get("c2")).toBe(120);
    expect(geo.centerWidth).toBe(320);
  });

  it("selection column + pinned user column => selection offset 0, user pinned offset = selection width", () => {
    const selCol = createSelectionColumnDef();
    // Selection column is prepended by injectSelectionColumn, so it appears first in input
    const cols = [selCol, col("user", { pinned: "left", width: 100 }), col("c", { width: 150 })];
    const geo = buildColumnPinningGeometry(layoutFor(cols));

    expect(geo.leftOffsetsByField.get(selCol.field)).toBe(0);
    expect(geo.leftOffsetsByField.get("user")).toBe(selCol.width!);
    expect(geo.leftPinnedWidth).toBe(selCol.width! + 100);
    expect(geo.centerOffsetsByField.get("c")).toBe(0);
  });

  it("multiple pinned columns preserve running offsets", () => {
    const cols = [
      col("p1", { pinned: "left", width: 60 }),
      col("p2", { pinned: "left", width: 90 }),
      col("c1", { width: 100 }),
    ];
    const geo = buildColumnPinningGeometry(layoutFor(cols));

    expect(geo.leftOffsetsByField.get("p1")).toBe(0);
    expect(geo.leftOffsetsByField.get("p2")).toBe(60);
    expect(geo.leftPinnedWidth).toBe(150);
    expect(geo.centerOffsetsByField.get("c1")).toBe(0);
  });

  it("totalWidth equals pinned + center", () => {
    const cols = [
      col("p", { pinned: "left", width: 50 }),
      col("a", { width: 100 }),
      col("b", { width: 200 }),
    ];
    const geo = buildColumnPinningGeometry(layoutFor(cols));

    expect(geo.totalWidth).toBe(50 + 100 + 200);
    expect(geo.totalWidth).toBe(geo.leftPinnedWidth + geo.centerWidth);
  });

  it("width fallback matches existing column width behavior", () => {
    const cols = [col("noWidth", { pinned: "left" }), col("center")];
    const geo = buildColumnPinningGeometry(layoutFor(cols));

    expect(geo.leftPinnedWidth).toBe(DEFAULT_COL_WIDTH);
    expect(geo.centerWidth).toBe(DEFAULT_COL_WIDTH);
    expect(geo.totalWidth).toBe(DEFAULT_COL_WIDTH * 2);
  });

  it("right-pinned columns have their own offset map", () => {
    const cols = [
      col("a", { width: 100 }),
      col("r1", { pinned: "right", width: 80 }),
      col("r2", { pinned: "right", width: 60 }),
    ];
    const geo = buildColumnPinningGeometry(layoutFor(cols));

    expect(geo.rightPinnedWidth).toBe(140);
    expect(geo.rightOffsetsByField.get("r1")).toBe(0);
    expect(geo.rightOffsetsByField.get("r2")).toBe(80);
    expect(geo.centerWidth).toBe(100);
    expect(geo.totalWidth).toBe(100 + 140);
  });

  it("left + center + right all contribute to totalWidth", () => {
    const cols = [
      col("L", { pinned: "left", width: 50 }),
      col("C", { width: 100 }),
      col("R", { pinned: "right", width: 70 }),
    ];
    const geo = buildColumnPinningGeometry(layoutFor(cols));

    expect(geo.leftPinnedWidth).toBe(50);
    expect(geo.centerWidth).toBe(100);
    expect(geo.rightPinnedWidth).toBe(70);
    expect(geo.totalWidth).toBe(220);
  });

  it("override on left-pinned column updates leftPinnedWidth, offsets, and totalWidth", () => {
    const cols = [
      col("p1", { pinned: "left", width: 60 }),
      col("p2", { pinned: "left", width: 90 }),
      col("c", { width: 100 }),
    ];
    const layout = layoutFor(cols);
    const geo = buildColumnPinningGeometry(layout, { field: "p1", width: 200 });

    expect(geo.leftPinnedWidth).toBe(200 + 90);
    expect(geo.leftOffsetsByField.get("p1")).toBe(0);
    expect(geo.leftOffsetsByField.get("p2")).toBe(200);
    expect(geo.centerWidth).toBe(100);
    expect(geo.totalWidth).toBe(200 + 90 + 100);
  });

  it("override on center column updates centerWidth, offsets, and totalWidth", () => {
    const cols = [
      col("p", { pinned: "left", width: 50 }),
      col("c1", { width: 100 }),
      col("c2", { width: 120 }),
    ];
    const layout = layoutFor(cols);
    const geo = buildColumnPinningGeometry(layout, { field: "c1", width: 300 });

    expect(geo.leftPinnedWidth).toBe(50);
    expect(geo.centerWidth).toBe(300 + 120);
    expect(geo.centerOffsetsByField.get("c1")).toBe(0);
    expect(geo.centerOffsetsByField.get("c2")).toBe(300);
    expect(geo.totalWidth).toBe(50 + 300 + 120);
  });

  it("override on right-pinned column updates rightPinnedWidth, offsets, and totalWidth", () => {
    const cols = [
      col("c", { width: 100 }),
      col("r1", { pinned: "right", width: 80 }),
      col("r2", { pinned: "right", width: 60 }),
    ];
    const layout = layoutFor(cols);
    const geo = buildColumnPinningGeometry(layout, { field: "r1", width: 150 });

    expect(geo.rightPinnedWidth).toBe(150 + 60);
    expect(geo.rightOffsetsByField.get("r1")).toBe(0);
    expect(geo.rightOffsetsByField.get("r2")).toBe(150);
    expect(geo.centerWidth).toBe(100);
    expect(geo.totalWidth).toBe(100 + 150 + 60);
  });

  it("input layout and columns are not mutated", () => {
    const cols = [
      col("p", { pinned: "left", width: 80 }),
      col("c", { width: 120 }),
    ];
    const layout = layoutFor(cols);
    const origLeftLen = layout.leftPinned.length;
    const origCenterLen = layout.center.length;
    const origP = { ...layout.leftPinned[0]! };
    const origC = { ...layout.center[0]! };

    buildColumnPinningGeometry(layout);

    expect(layout.leftPinned.length).toBe(origLeftLen);
    expect(layout.center.length).toBe(origCenterLen);
    expect(layout.leftPinned[0]).toEqual(origP);
    expect(layout.center[0]).toEqual(origC);
  });
});
