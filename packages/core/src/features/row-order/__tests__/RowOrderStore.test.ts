import { describe, expect, it } from "vitest";

import { RowOrderStore } from "../RowOrderStore";

function makeStore(ids: string[]): RowOrderStore {
  const s = new RowOrderStore();
  s.syncRowIds(ids);
  return s;
}

describe("RowOrderStore.move", () => {
  it("moves a row forward", () => {
    const s = makeStore(["a", "b", "c", "d"]);
    const result = s.move("a", 2);
    expect(result).toMatchObject({ changed: true, fromIndex: 0, toIndex: 2 });
    expect(result!.order).toEqual(["b", "c", "a", "d"]);
    expect(s.getOrder()).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a row backward", () => {
    const s = makeStore(["a", "b", "c", "d"]);
    const result = s.move("d", 1);
    expect(result).toMatchObject({ changed: true, fromIndex: 3, toIndex: 1 });
    expect(result!.order).toEqual(["a", "d", "b", "c"]);
  });

  it("returns changed:false for a no-op (same index)", () => {
    const s = makeStore(["a", "b", "c"]);
    const result = s.move("b", 1);
    expect(result).toMatchObject({ changed: false, fromIndex: 1, toIndex: 1 });
    expect(s.getOrder()).toEqual(["a", "b", "c"]);
  });

  it("returns null for an unknown rowId", () => {
    const s = makeStore(["a", "b"]);
    expect(s.move("z", 0)).toBeNull();
  });

  it("clamps toIndex to valid range (too high)", () => {
    const s = makeStore(["a", "b", "c"]);
    const result = s.move("a", 99);
    expect(result).toMatchObject({ changed: true, toIndex: 2 });
    expect(result!.order).toEqual(["b", "c", "a"]);
  });

  it("clamps toIndex to valid range (negative)", () => {
    const s = makeStore(["a", "b", "c"]);
    const result = s.move("c", -5);
    expect(result).toMatchObject({ changed: true, toIndex: 0 });
    expect(result!.order).toEqual(["c", "a", "b"]);
  });
});

describe("RowOrderStore.applyOrder", () => {
  it("reorders rows according to stored order", () => {
    const s = makeStore(["c", "a", "b"]);
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = s.applyOrder(rows, (r) => r.id);
    expect(result.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("appends rows not in stored order at the end", () => {
    const s = makeStore(["b", "a"]);
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = s.applyOrder(rows, (r) => r.id);
    expect(result.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("returns rows unchanged when order is empty", () => {
    const s = new RowOrderStore();
    const rows = [{ id: "a" }, { id: "b" }];
    expect(s.applyOrder(rows, (r) => r.id)).toBe(rows);
  });
});

// ─── RowOrderStore.moveMany ───────────────────────────────────────────────────

describe("RowOrderStore.moveMany", () => {
  function makeStore(ids: string[]): RowOrderStore {
    const s = new RowOrderStore();
    s.syncRowIds(ids);
    return s;
  }

  it("returns null when store is empty", () => {
    const s = new RowOrderStore();
    expect(s.moveMany(["a"], 1)).toBeNull();
  });

  it("returns null when no row ids match", () => {
    const s = makeStore(["a", "b", "c"]);
    expect(s.moveMany(["x", "y"], 1)).toBeNull();
  });

  it("deduplicates row ids", () => {
    const s = makeStore(["a", "b", "c"]);
    const result = s.moveMany(["a", "a", "a"], 2);
    expect(result?.movedRowIds).toEqual(["a"]);
  });

  it("moves a single row forward (insertion-slot semantics: before original position 2)", () => {
    // toIndex=2 means "before the row originally at index 2 (c)".
    // a is at index 0, so adjusted slot = 2-1 = 1 in withoutMoving=[b,c,d] → [b,a,c,d].
    const s = makeStore(["a", "b", "c", "d"]);
    const result = s.moveMany(["a"], 2);
    expect(result?.changed).toBe(true);
    expect(result?.order).toEqual(["b", "a", "c", "d"]);
  });

  it("moves contiguous rows as a block forward", () => {
    const s = makeStore(["a", "b", "c", "d", "e"]);
    const result = s.moveMany(["b", "c"], 4);
    expect(result?.changed).toBe(true);
    expect(result?.order).toEqual(["a", "d", "b", "c", "e"]);
    expect(result?.movedRowIds).toEqual(["b", "c"]);
  });

  it("moves non-contiguous rows as block (ordered by current position)", () => {
    const s = makeStore(["a", "b", "c", "d", "e"]);
    // Move a and c (non-contiguous) to index 4
    const result = s.moveMany(["c", "a"], 4); // input order irrelevant; data order wins
    expect(result?.changed).toBe(true);
    // a and c should appear in their original relative order: a, c
    expect(result?.order).toEqual(["b", "d", "a", "c", "e"]);
    expect(result?.movedRowIds).toEqual(["a", "c"]);
  });

  it("returns changed:false for no-op (block already at target)", () => {
    const s = makeStore(["a", "b", "c"]);
    // b is at index 1; moving to index 1 is no-op
    const result = s.moveMany(["b"], 1);
    expect(result?.changed).toBe(false);
  });

  it("adjusts insertion index when moving rows are before target", () => {
    // Moving a (index 0) to slot 3: adjusted = 3 - 1 = 2 in withoutMoving
    // withoutMoving = [b, c, d] → insert at 2 → [b, c, a, d]
    const s = makeStore(["a", "b", "c", "d"]);
    const result = s.moveMany(["a"], 3);
    expect(result?.changed).toBe(true);
    expect(result?.order).toEqual(["b", "c", "a", "d"]);
  });

  it("returns correct fromIndices", () => {
    const s = makeStore(["a", "b", "c", "d"]);
    const result = s.moveMany(["a", "c"], 4);
    expect(result?.fromIndices).toEqual([0, 2]);
  });
});

describe("RowOrderStore.hasOrder / isCurrentOrder / clear", () => {
  it("hasOrder returns false before syncRowIds", () => {
    expect(new RowOrderStore().hasOrder()).toBe(false);
  });

  it("hasOrder returns true after syncRowIds", () => {
    const s = makeStore(["a"]);
    expect(s.hasOrder()).toBe(true);
  });

  it("isCurrentOrder returns true when order matches", () => {
    const s = makeStore(["a", "b"]);
    expect(s.isCurrentOrder(["a", "b"])).toBe(true);
  });

  it("isCurrentOrder returns false when order differs", () => {
    const s = makeStore(["a", "b"]);
    expect(s.isCurrentOrder(["b", "a"])).toBe(false);
  });

  it("clear resets order", () => {
    const s = makeStore(["a", "b"]);
    s.clear();
    expect(s.hasOrder()).toBe(false);
    expect(s.getOrder()).toEqual([]);
  });
});
