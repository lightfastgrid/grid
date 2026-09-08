import { describe, expect, it } from "vitest";

import { createRowControlsColumnDef } from "../../../internal/rowControlColumns";
import { createRowDragColumnDef } from "../../../internal/rowDragColumn";
import { createSelectionColumnDef } from "../../../internal/selectionColumn";
import type { ColumnDef } from "../../../types";
import { ColumnOrderStore } from "../ColumnOrderStore";

function cols(...fields: string[]): ColumnDef[] {
  return fields.map((field) => ({ field }));
}

describe("ColumnOrderStore", () => {
  it("initial order follows columns after getOrder", () => {
    const store = new ColumnOrderStore();
    const columns = cols("a", "b", "c");
    expect(store.getOrder(columns)).toEqual(["a", "b", "c"]);
  });

  it("move column to insertion slot after last column", () => {
    const store = new ColumnOrderStore();
    const columns = cols("a", "b", "c", "d");
    store.syncColumns(columns);
    const r = store.move("a", 4, columns);
    expect(r?.changed).toBe(true);
    expect(r?.movedColumnId).toBe("a");
    expect(r?.fromIndex).toBe(0);
    expect(r?.toIndex).toBe(3);
    expect(r?.order).toEqual(["b", "c", "d", "a"]);
    expect(store.getOrder(columns)).toEqual(["b", "c", "d", "a"]);
  });

  it("new columns append in incoming order after stored user order", () => {
    const store = new ColumnOrderStore();
    store.syncColumns(cols("a", "b"));
    store.syncColumns(cols("b", "a", "z", "y"));
    expect(store.getOrder(cols("b", "a", "z", "y"))).toEqual(["a", "b", "z", "y"]);
  });

  it("removed columns are dropped from order", () => {
    const store = new ColumnOrderStore();
    store.syncColumns(cols("a", "b", "c"));
    store.syncColumns(cols("b", "c"));
    expect(store.getOrder(cols("b", "c"))).toEqual(["b", "c"]);
  });

  it("internal selection column is ignored in order and move", () => {
    const store = new ColumnOrderStore();
    const sel = createSelectionColumnDef();
    const columns: ColumnDef[] = [sel, ...cols("x", "y")];
    expect(store.getOrder(columns)).toEqual(["x", "y"]);
    expect(store.move(sel.field, 0, columns)).toBeNull();
    const applied = store.applyOrder(columns);
    expect(applied[0]).toBe(sel);
    expect(applied.map((c) => c.field)).toEqual(["__lfg_selection__", "x", "y"]);
  });

  it("internal row-drag column is ignored in order and kept ahead of user columns", () => {
    const store = new ColumnOrderStore();
    const drag = createRowDragColumnDef();
    const sel = createSelectionColumnDef();
    const columns: ColumnDef[] = [drag, sel, ...cols("x", "y")];
    expect(store.getOrder(columns)).toEqual(["x", "y"]);
    expect(store.move(drag.field, 0, columns)).toBeNull();
    const applied = store.applyOrder(columns);
    expect(applied.map((c) => c.field)).toEqual([
      "__lfg_row_drag__",
      "__lfg_selection__",
      "x",
      "y",
    ]);
  });

  it("internal combined row-controls column is ignored in order and kept ahead of user columns", () => {
    const store = new ColumnOrderStore();
    const combined = createRowControlsColumnDef();
    const columns: ColumnDef[] = [combined, ...cols("x", "y")];
    expect(store.getOrder(columns)).toEqual(["x", "y"]);
    expect(store.move(combined.field, 0, columns)).toBeNull();
    const applied = store.applyOrder(columns);
    expect(applied[0]).toBe(combined);
    expect(applied.map((c) => c.field)).toEqual([
      "__lfg_row_controls__",
      "x",
      "y",
    ]);
  });

  it("applyOrder preserves column object references", () => {
    const store = new ColumnOrderStore();
    const a: ColumnDef = { field: "a", width: 1 };
    const b: ColumnDef = { field: "b", width: 2 };
    store.syncColumns([a, b]);
    store.move("b", 0, [a, b]);
    const out = store.applyOrder([a, b]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(b);
    expect(out[1]).toBe(a);
  });

  it("moveMany reorders non-adjacent selection as one block (B,D after F)", () => {
    const store = new ColumnOrderStore();
    const columns = cols("a", "b", "c", "d", "e", "f");
    store.syncColumns(columns);
    const r = store.moveMany(["b", "d"], 6, columns);
    expect(r?.changed).toBe(true);
    expect(r?.movedColumnIds).toEqual(["b", "d"]);
    expect(r?.fromIndices).toEqual([1, 3]);
    expect(r?.toIndex).toBe(4);
    expect(r?.order).toEqual(["a", "c", "e", "f", "b", "d"]);
  });

  it("moveMany B,D before C at insertion slot 2", () => {
    const store = new ColumnOrderStore();
    const columns = cols("a", "b", "c", "d", "e", "f");
    store.syncColumns(columns);
    const r = store.moveMany(["b", "d"], 2, columns);
    expect(r?.order).toEqual(["a", "b", "d", "c", "e", "f"]);
  });

  it("moveMany C,D at insertion inside block is no-op", () => {
    const store = new ColumnOrderStore();
    const columns = cols("a", "b", "c", "d", "e", "f");
    store.syncColumns(columns);
    const r = store.moveMany(["c", "d"], 3, columns);
    expect(r?.changed).toBe(false);
  });

  it("moveMany dedupes and drops unknown fields", () => {
    const store = new ColumnOrderStore();
    store.syncColumns(cols("a", "b", "c"));
    const r = store.moveMany(["z", "c", "c", "a"], 2, cols("a", "b", "c"));
    expect(r?.changed).toBe(true);
    expect(r?.movedColumnIds).toEqual(["a", "c"]);
    expect(r?.order).toEqual(["b", "a", "c"]);
  });

  it("moveMany insertion index follows move() after removals", () => {
    const store = new ColumnOrderStore();
    const columns = cols("a", "b", "c", "d");
    store.syncColumns(columns);
    const r = store.moveMany(["a", "b"], 4, columns);
    expect(r?.changed).toBe(true);
    expect(r?.order).toEqual(["c", "d", "a", "b"]);
  });

  it("moveMany returns changed false when order unchanged", () => {
    const store = new ColumnOrderStore();
    const columns = cols("a", "b", "c");
    store.syncColumns(columns);
    const r = store.moveMany(["b"], 1, columns);
    expect(r?.changed).toBe(false);
    expect(r?.order).toEqual(["a", "b", "c"]);
  });

  it("moveMany ignores internal selection field id", () => {
    const store = new ColumnOrderStore();
    const sel = createSelectionColumnDef();
    const columns: ColumnDef[] = [sel, ...cols("a", "b")];
    store.syncColumns(columns);
    const r = store.moveMany([sel.field, "b"], 0, columns);
    expect(r?.changed).toBe(true);
    expect(r?.movedColumnIds).toEqual(["b"]);
    expect(r?.order).toEqual(["b", "a"]);
  });

  it("moveMany ignores internal row-drag field id", () => {
    const store = new ColumnOrderStore();
    const drag = createRowDragColumnDef();
    const columns: ColumnDef[] = [drag, ...cols("a", "b")];
    store.syncColumns(columns);
    const r = store.moveMany([drag.field, "b"], 0, columns);
    expect(r?.changed).toBe(true);
    expect(r?.movedColumnIds).toEqual(["b"]);
    expect(r?.order).toEqual(["b", "a"]);
  });

  it("clear then getOrder follows columns only", () => {
    const store = new ColumnOrderStore();
    store.syncColumns(cols("a", "b"));
    store.move("b", 0, cols("a", "b"));
    store.clear();
    expect(store.getOrder(cols("a", "b"))).toEqual(["a", "b"]);
  });
});
