import { describe, expect, it } from "vitest";

import { createSelectionColumnDef } from "../../../internal/selectionColumn";
import type { ColumnDef } from "../../../types";
import { buildColumnPinningLayout } from "../columnPinningLayout";

function col(field: string, overrides?: Partial<ColumnDef>): ColumnDef {
  return { field, ...overrides };
}

describe("buildColumnPinningLayout", () => {
  it("no pinned columns => all user columns in center", () => {
    const cols = [col("a"), col("b"), col("c")];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.leftPinned).toEqual([]);
    expect(layout.center).toEqual(cols);
    expect(layout.rightPinned).toEqual([]);
    expect(layout.ordered).toEqual(cols);
  });

  it("pinned: 'left' columns are in leftPinned", () => {
    const cols = [col("a"), col("b", { pinned: "left" }), col("c")];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.leftPinned).toEqual([col("b", { pinned: "left" })]);
    expect(layout.center).toEqual([col("a"), col("c")]);
  });

  it("selection column with pinned left is placed in leftPinned", () => {
    const selCol = createSelectionColumnDef();
    const cols = [col("a", { pinned: "left" }), selCol, col("b")];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.leftPinned.length).toBe(2);
    expect(layout.leftPinned[0]).toEqual(col("a", { pinned: "left" }));
    expect(layout.leftPinned[1]).toBe(selCol);
    expect(layout.center.map((c) => c.field)).toEqual(["b"]);
  });

  it("pinned: false behaves like center", () => {
    const cols = [col("a", { pinned: false }), col("b", { pinned: "left" })];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.leftPinned).toEqual([col("b", { pinned: "left" })]);
    expect(layout.center).toEqual([col("a", { pinned: false })]);
  });

  it("hidden columns passed through are preserved (visibility filtered upstream)", () => {
    const cols = [
      col("a", { visible: false }),
      col("b", { pinned: "left" }),
      col("c"),
    ];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.center).toEqual([col("a", { visible: false }), col("c")]);
    expect(layout.leftPinned).toEqual([col("b", { pinned: "left" })]);
    expect(layout.ordered.length).toBe(3);
  });

  it("input arrays and column objects are not mutated", () => {
    const a = col("a");
    const b = col("b", { pinned: "left" });
    const cols = [a, b];
    const origA = { ...a };
    const origB = { ...b };
    const origLength = cols.length;

    buildColumnPinningLayout(cols);

    expect(cols.length).toBe(origLength);
    expect(a).toEqual(origA);
    expect(b).toEqual(origB);
  });

  it("ordered returns left pinned first, then center, then right pinned", () => {
    const selCol = createSelectionColumnDef();
    const cols = [col("c"), selCol, col("a", { pinned: "left" }), col("b"), col("r", { pinned: "right" })];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.ordered).toEqual([
      selCol,
      col("a", { pinned: "left" }),
      col("c"),
      col("b"),
      col("r", { pinned: "right" }),
    ]);
    expect(layout.ordered).toEqual([
      ...layout.leftPinned,
      ...layout.center,
      ...layout.rightPinned,
    ]);
  });

  it("columns without pinned property go to center", () => {
    const cols = [col("x"), col("y"), col("z")];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.leftPinned).toEqual([]);
    expect(layout.center).toEqual(cols);
    expect(layout.ordered).toEqual(layout.center);
  });

  it("multiple left-pinned columns preserve input order", () => {
    const cols = [
      col("p1", { pinned: "left" }),
      col("c1"),
      col("p2", { pinned: "left" }),
    ];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.leftPinned.map((c) => c.field)).toEqual(["p1", "p2"]);
    expect(layout.center.map((c) => c.field)).toEqual(["c1"]);
  });

  it("pinned: 'right' columns are in rightPinned", () => {
    const cols = [col("a"), col("b", { pinned: "right" }), col("c")];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.rightPinned).toEqual([col("b", { pinned: "right" })]);
    expect(layout.center).toEqual([col("a"), col("c")]);
    expect(layout.leftPinned).toEqual([]);
  });

  it("multiple right-pinned columns preserve input order", () => {
    const cols = [
      col("r1", { pinned: "right" }),
      col("c1"),
      col("r2", { pinned: "right" }),
    ];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.rightPinned.map((c) => c.field)).toEqual(["r1", "r2"]);
    expect(layout.center.map((c) => c.field)).toEqual(["c1"]);
  });

  it("left and right pinned columns with center", () => {
    const cols = [
      col("L", { pinned: "left" }),
      col("C"),
      col("R", { pinned: "right" }),
    ];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.leftPinned.map((c) => c.field)).toEqual(["L"]);
    expect(layout.center.map((c) => c.field)).toEqual(["C"]);
    expect(layout.rightPinned.map((c) => c.field)).toEqual(["R"]);
    expect(layout.ordered.map((c) => c.field)).toEqual(["L", "C", "R"]);
  });

  it("selection column pinned left goes to leftPinned even with only right-pinned user columns", () => {
    const selCol = createSelectionColumnDef(); // pinned: "left" by default
    const cols = [selCol, col("a"), col("b", { pinned: "right" })];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.leftPinned).toEqual([selCol]);
    expect(layout.center.map((c) => c.field)).toEqual(["a"]);
    expect(layout.rightPinned.map((c) => c.field)).toEqual(["b"]);
  });

  it("selection column pinned false stays in center", () => {
    const selCol = createSelectionColumnDef({ width: 44, pinned: false });
    const cols = [selCol, col("a"), col("b", { pinned: "left" })];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.leftPinned.map((c) => c.field)).toEqual(["b"]);
    expect(layout.center[0]).toBe(selCol);
    expect(layout.center[1]).toEqual(col("a"));
  });

  it("selection column pinned right goes to rightPinned", () => {
    const selCol = createSelectionColumnDef({ width: 44, pinned: "right" });
    const cols = [col("a"), selCol, col("b")];
    const layout = buildColumnPinningLayout(cols);

    expect(layout.leftPinned).toEqual([]);
    expect(layout.center.map((c) => c.field)).toEqual(["a", "b"]);
    expect(layout.rightPinned[0]).toBe(selCol);
  });
});
