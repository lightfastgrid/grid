import { describe, expect, it } from "vitest";

import type { VisualRowLayout } from "../../../internal/layoutTypes";
import type { FocusNavigationContext } from "../focusNavigation";
import { resolveNavigationTarget } from "../focusNavigation";

/** Identity layout: visual index === display index (no pinning). */
function identityLayout(rowCount: number): VisualRowLayout {
  return {
    topDisplayIndexes: [],
    centerRowCount: rowCount,
    centerToDisplayIndex: null,
    bottomDisplayIndexes: [],
  };
}

function ctx(
  rowCount = 5,
  fields: string[] = ["a", "b", "c"],
  pageSize = 10,
): FocusNavigationContext {
  return {
    rowLayout: identityLayout(rowCount),
    focusableFields: fields,
    pageSize,
  };
}

describe("resolveNavigationTarget", () => {
  it("null current focuses the first row + first field for any direction", () => {
    expect(resolveNavigationTarget(null, "down", ctx())).toEqual({
      rowIndex: 0,
      field: "a",
    });
    expect(resolveNavigationTarget(null, "up", ctx())).toEqual({
      rowIndex: 0,
      field: "a",
    });
  });

  it("returns null with no rows or no focusable fields", () => {
    expect(resolveNavigationTarget(null, "down", ctx(0))).toBeNull();
    expect(resolveNavigationTarget(null, "down", ctx(5, []))).toBeNull();
  });

  it("moves up/down/left/right and clamps at boundaries", () => {
    const c = ctx();
    const at = { rowIndex: 1, field: "b" };

    expect(resolveNavigationTarget(at, "up", c)).toEqual({ rowIndex: 0, field: "b" });
    expect(resolveNavigationTarget(at, "down", c)).toEqual({ rowIndex: 2, field: "b" });
    expect(resolveNavigationTarget(at, "left", c)).toEqual({ rowIndex: 1, field: "a" });
    expect(resolveNavigationTarget(at, "right", c)).toEqual({ rowIndex: 1, field: "c" });

    // Clamped moves return null (no movement → no event/preventDefault).
    expect(
      resolveNavigationTarget({ rowIndex: 0, field: "a" }, "up", c),
    ).toBeNull();
    expect(
      resolveNavigationTarget({ rowIndex: 0, field: "a" }, "left", c),
    ).toBeNull();
    expect(
      resolveNavigationTarget({ rowIndex: 4, field: "c" }, "down", c),
    ).toBeNull();
    expect(
      resolveNavigationTarget({ rowIndex: 4, field: "c" }, "right", c),
    ).toBeNull();
  });

  it("home/end move within the current row", () => {
    const c = ctx();
    const at = { rowIndex: 2, field: "b" };
    expect(resolveNavigationTarget(at, "home", c)).toEqual({ rowIndex: 2, field: "a" });
    expect(resolveNavigationTarget(at, "end", c)).toEqual({ rowIndex: 2, field: "c" });
    expect(
      resolveNavigationTarget({ rowIndex: 2, field: "a" }, "home", c),
    ).toBeNull();
  });

  it("firstCell/lastCell jump to the grid corners", () => {
    const c = ctx();
    const at = { rowIndex: 2, field: "b" };
    expect(resolveNavigationTarget(at, "firstCell", c)).toEqual({
      rowIndex: 0,
      field: "a",
    });
    expect(resolveNavigationTarget(at, "lastCell", c)).toEqual({
      rowIndex: 4,
      field: "c",
    });
  });

  it("pageUp/pageDown move by pageSize and clamp", () => {
    const c = ctx(50, ["a"], 10);
    expect(
      resolveNavigationTarget({ rowIndex: 25, field: "a" }, "pageUp", c),
    ).toEqual({ rowIndex: 15, field: "a" });
    expect(
      resolveNavigationTarget({ rowIndex: 25, field: "a" }, "pageDown", c),
    ).toEqual({ rowIndex: 35, field: "a" });

    // Clamping near the edges.
    expect(
      resolveNavigationTarget({ rowIndex: 3, field: "a" }, "pageUp", c),
    ).toEqual({ rowIndex: 0, field: "a" });
    expect(
      resolveNavigationTarget({ rowIndex: 45, field: "a" }, "pageDown", c),
    ).toEqual({ rowIndex: 49, field: "a" });
    expect(
      resolveNavigationTarget({ rowIndex: 0, field: "a" }, "pageUp", c),
    ).toBeNull();
  });

  it("unknown current field falls back to the first field", () => {
    const c = ctx();
    expect(
      resolveNavigationTarget({ rowIndex: 1, field: "removed" }, "right", c),
    ).toEqual({ rowIndex: 1, field: "b" });
  });

  describe("visual row order with pinned rows", () => {
    // Display order: r0..r4 (indexes 0..4). r2 pinned top, r4 pinned
    // bottom. Visual order: [r2] top, [r0, r1, r3] center, [r4] bottom.
    const pinnedLayout: VisualRowLayout = {
      topDisplayIndexes: [2],
      centerRowCount: 3,
      centerToDisplayIndex: (centerIndex) => [0, 1, 3][centerIndex]!,
      bottomDisplayIndexes: [4],
    };
    const pinnedCtx: FocusNavigationContext = {
      rowLayout: pinnedLayout,
      focusableFields: ["a"],
      pageSize: 10,
    };

    it("ArrowDown from the top-pinned row enters the first center row", () => {
      // current = display index 2 (the top-pinned row).
      expect(
        resolveNavigationTarget({ rowIndex: 2, field: "a" }, "down", pinnedCtx),
      ).toEqual({ rowIndex: 0, field: "a" });
    });

    it("ArrowUp from the first center row enters the top-pinned row", () => {
      expect(
        resolveNavigationTarget({ rowIndex: 0, field: "a" }, "up", pinnedCtx),
      ).toEqual({ rowIndex: 2, field: "a" });
    });

    it("ArrowDown from the last center row enters the bottom-pinned row", () => {
      // display index 3 is the last center row.
      expect(
        resolveNavigationTarget({ rowIndex: 3, field: "a" }, "down", pinnedCtx),
      ).toEqual({ rowIndex: 4, field: "a" });
    });

    it("ArrowUp from the bottom-pinned row enters the last center row", () => {
      expect(
        resolveNavigationTarget({ rowIndex: 4, field: "a" }, "up", pinnedCtx),
      ).toEqual({ rowIndex: 3, field: "a" });
    });

    it("clamps at the top-pinned (first) and bottom-pinned (last) edges", () => {
      expect(
        resolveNavigationTarget({ rowIndex: 2, field: "a" }, "up", pinnedCtx),
      ).toBeNull();
      expect(
        resolveNavigationTarget({ rowIndex: 4, field: "a" }, "down", pinnedCtx),
      ).toBeNull();
    });

    it("center rows step in visual order, skipping the pinned display index", () => {
      // r1 (display 1) → next center is r3 (display 3), not r2 (pinned).
      expect(
        resolveNavigationTarget({ rowIndex: 1, field: "a" }, "down", pinnedCtx),
      ).toEqual({ rowIndex: 3, field: "a" });
    });
  });

  describe("visual column order with pinned columns", () => {
    // focusableFields arrive already in visual order from the
    // controller: left-pinned, then center, then right-pinned.
    const c: FocusNavigationContext = {
      rowLayout: identityLayout(3),
      focusableFields: ["L", "x", "y", "R"], // L left-pinned, R right-pinned
      pageSize: 10,
    };

    it("ArrowRight/ArrowLeft traverse pinned and center columns in order", () => {
      expect(
        resolveNavigationTarget({ rowIndex: 0, field: "L" }, "right", c),
      ).toEqual({ rowIndex: 0, field: "x" });
      expect(
        resolveNavigationTarget({ rowIndex: 0, field: "y" }, "right", c),
      ).toEqual({ rowIndex: 0, field: "R" });
      expect(
        resolveNavigationTarget({ rowIndex: 0, field: "x" }, "left", c),
      ).toEqual({ rowIndex: 0, field: "L" });
    });

    it("home/end land on the pinned-left / pinned-right edges", () => {
      expect(
        resolveNavigationTarget({ rowIndex: 0, field: "y" }, "home", c),
      ).toEqual({ rowIndex: 0, field: "L" });
      expect(
        resolveNavigationTarget({ rowIndex: 0, field: "x" }, "end", c),
      ).toEqual({ rowIndex: 0, field: "R" });
    });
  });
});
