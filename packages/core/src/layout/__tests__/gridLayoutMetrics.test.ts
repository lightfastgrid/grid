import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRID_LAYOUT_METRICS,
  type GridLayoutMetrics,
} from "../gridLayoutMetrics";

describe("GridLayoutMetrics", () => {
  it("DEFAULT_GRID_LAYOUT_METRICS has rowHeight 40", () => {
    expect(DEFAULT_GRID_LAYOUT_METRICS.rowHeight).toBe(40);
  });

  it("DEFAULT_GRID_LAYOUT_METRICS has headerHeight 40", () => {
    expect(DEFAULT_GRID_LAYOUT_METRICS.headerHeight).toBe(40);
  });

  it("is assignable as GridLayoutMetrics", () => {
    const metrics: GridLayoutMetrics = DEFAULT_GRID_LAYOUT_METRICS;
    expect(metrics.rowHeight).toBe(40);
    expect(metrics.headerHeight).toBe(40);
  });

  it("gridConstants aliases match default metrics", async () => {
    const { HEADER_HEIGHT, ROW_HEIGHT } = await import(
      "../../rendering/helpers/gridConstants"
    );
    expect(ROW_HEIGHT).toBe(DEFAULT_GRID_LAYOUT_METRICS.rowHeight);
    expect(HEADER_HEIGHT).toBe(DEFAULT_GRID_LAYOUT_METRICS.headerHeight);
  });
});
