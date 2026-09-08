// Focused tests for row order primitives + index-based sort utility.

import { describe, expect, it, vi } from "vitest";

import type { ColumnDef, RowData, SortModel } from "../../types";
import { applySortModel, applySortModelToRowOrder } from "../../utils/sortModel";
import {
  createIdentityRowOrder,
  createIndexedRowOrder,
  createRowView,
  getRowOrderLength,
  materializeRowOrder,
  type RowOrder,
} from "../rowOrder";

// ── Primitive shape ──────────────────────────────────────────

describe("row order primitives", () => {
  it("createIdentityRowOrder does NOT allocate a Uint32Array", () => {
    const order = createIdentityRowOrder(5);
    expect(order.kind).toBe("identity");
    // Type narrowing — `indexes` only exists on the `indexed` variant.
    if (order.kind === "identity") {
      expect(order.length).toBe(5);
    }
    expect(getRowOrderLength(order)).toBe(5);
  });

  it("createIndexedRowOrder wraps a Uint32Array", () => {
    const idx = new Uint32Array([2, 0, 1]);
    const order = createIndexedRowOrder(idx);
    expect(order.kind).toBe("indexed");
    if (order.kind === "indexed") {
      expect(order.indexes).toBe(idx);
    }
    expect(getRowOrderLength(order)).toBe(3);
  });
});

describe("createRowView", () => {
  const rows: RowData[] = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("identity view maps display index to source index 1:1", () => {
    const view = createRowView(rows, createIdentityRowOrder(rows.length), 7);
    expect(view.generation).toBe(7);
    expect(view.rowCount).toBe(3);
    expect(view.getSourceIndex(0)).toBe(0);
    expect(view.getSourceIndex(2)).toBe(2);
    expect(view.getRow(0)).toBe(rows[0]);
    expect(view.getRow(2)).toBe(rows[2]);
  });

  it("indexed view maps through the Uint32Array", () => {
    const order = createIndexedRowOrder(new Uint32Array([1, 2, 0]));
    const view = createRowView(rows, order, 11);
    expect(view.generation).toBe(11);
    expect(view.rowCount).toBe(3);
    expect(view.getSourceIndex(0)).toBe(1);
    expect(view.getSourceIndex(1)).toBe(2);
    expect(view.getSourceIndex(2)).toBe(0);
    expect(view.getRow(0)).toBe(rows[1]);
    expect(view.getRow(1)).toBe(rows[2]);
    expect(view.getRow(2)).toBe(rows[0]);
  });

  it("out-of-range queries return -1 / undefined", () => {
    const view = createRowView(rows, createIdentityRowOrder(3), 0);
    expect(view.getSourceIndex(-1)).toBe(-1);
    expect(view.getSourceIndex(3)).toBe(-1);
    expect(view.getRow(-1)).toBeUndefined();
    expect(view.getRow(99)).toBeUndefined();
  });

  it("indexed view exposes the same `rows` reference (no copy)", () => {
    const order = createIndexedRowOrder(new Uint32Array([1, 0, 2]));
    const view = createRowView(rows, order, 0);
    expect(view.rows).toBe(rows);
  });
});

describe("materializeRowOrder", () => {
  const rows: RowData[] = [{ n: 1 }, { n: 2 }, { n: 3 }];

  it("identity returns the original rows reference (no copy)", () => {
    const out = materializeRowOrder(rows, createIdentityRowOrder(3));
    expect(out).toBe(rows);
  });

  it("indexed builds a new array in display order", () => {
    const order = createIndexedRowOrder(new Uint32Array([2, 0, 1]));
    const out = materializeRowOrder(rows, order);
    expect(out).not.toBe(rows);
    expect(out).toEqual([rows[2], rows[0], rows[1]]);
  });
});

// ── applySortModelToRowOrder ─────────────────────────────────

describe("applySortModelToRowOrder", () => {
  const cols: ColumnDef[] = [
    { field: "name" },
    { field: "score" },
    { field: "active" },
    { field: "meta.depth" },
    { field: "computed" },
  ];

  it("empty sort model returns identity order (no Uint32Array allocated)", () => {
    const rows: RowData[] = [{ name: "a" }, { name: "b" }];
    const order = applySortModelToRowOrder(rows, [], cols);
    expect(order.kind).toBe("identity");
    if (order.kind === "identity") expect(order.length).toBe(2);
  });

  it("sort model whose entries all resolve to unknown columns returns identity", () => {
    const rows: RowData[] = [{ name: "a" }, { name: "b" }];
    const model: SortModel = [{ field: "doesNotExist", sort: "asc" }];
    const order = applySortModelToRowOrder(rows, model, cols);
    expect(order.kind).toBe("identity");
  });

  it("single-column asc returns the expected source-index permutation", () => {
    const rows: RowData[] = [
      { name: "charlie" },
      { name: "alice" },
      { name: "bob" },
    ];
    const order = applySortModelToRowOrder(
      rows,
      [{ field: "name", sort: "asc" }],
      cols,
    );
    expect(order.kind).toBe("indexed");
    if (order.kind === "indexed") {
      expect(order.indexes).toBeInstanceOf(Uint32Array);
      // alice(1), bob(2), charlie(0)
      expect(Array.from(order.indexes)).toEqual([1, 2, 0]);
    }
  });

  it("single-column desc returns the expected reversed permutation", () => {
    const rows: RowData[] = [{ score: 2 }, { score: 1 }, { score: 3 }];
    const order = applySortModelToRowOrder(
      rows,
      [{ field: "score", sort: "desc" }],
      cols,
    );
    if (order.kind === "indexed") {
      // 3(2), 2(0), 1(1)
      expect(Array.from(order.indexes)).toEqual([2, 0, 1]);
    } else {
      throw new Error("expected indexed order");
    }
  });

  it("null / undefined remain last in both asc and desc", () => {
    const rows: RowData[] = [
      { score: 2 },
      { score: null },
      { score: 1 },
      { score: undefined },
      { score: 3 },
    ];
    const asc = applySortModelToRowOrder(
      rows,
      [{ field: "score", sort: "asc" }],
      cols,
    );
    if (asc.kind !== "indexed") throw new Error("expected indexed order");
    // Source indexes for present values in asc order: 2(score=1), 0(2), 4(3),
    // then nulls in original position order: 1, 3.
    expect(Array.from(asc.indexes)).toEqual([2, 0, 4, 1, 3]);

    const desc = applySortModelToRowOrder(
      rows,
      [{ field: "score", sort: "desc" }],
      cols,
    );
    if (desc.kind !== "indexed") throw new Error("expected indexed order");
    // Present in desc: 4(3), 0(2), 2(1). Nulls still last in original order: 1, 3.
    expect(Array.from(desc.indexes)).toEqual([4, 0, 2, 1, 3]);
  });

  it("dot-path field sorts on nested value", () => {
    const rows: RowData[] = [
      { meta: { depth: 3 } },
      { meta: { depth: 1 } },
      { meta: { depth: 2 } },
    ];
    const order = applySortModelToRowOrder(
      rows,
      [{ field: "meta.depth", sort: "asc" }],
      cols,
    );
    if (order.kind !== "indexed") throw new Error("expected indexed order");
    expect(Array.from(order.indexes)).toEqual([1, 2, 0]);
  });

  it("valueGetter receives the correct SOURCE rowIndex", () => {
    const getter = vi.fn(
      ({ row, rowIndex }: { row: RowData; rowIndex: number }) =>
        (row.score as number) + rowIndex,
    );
    const customCols: ColumnDef[] = [{ field: "computed", valueGetter: getter }];
    const rows: RowData[] = [{ score: 100 }, { score: 50 }, { score: 25 }];
    // Computed values (score + sourceIndex): [100, 51, 27]
    // Asc by computed → 27(2), 51(1), 100(0)
    const order = applySortModelToRowOrder(
      rows,
      [{ field: "computed", sort: "asc" }],
      customCols,
    );
    if (order.kind !== "indexed") throw new Error("expected indexed order");
    expect(Array.from(order.indexes)).toEqual([2, 1, 0]);

    // Every call's rowIndex must equal the row's position in the source array.
    for (const call of getter.mock.calls) {
      const [{ row, rowIndex }] = call;
      expect(rows[rowIndex]).toBe(row);
    }
  });

  it("custom sortComparator still wins over default compare", () => {
    // Reverse-string comparator so "abc" > "abd" > "aaa" by trailing char.
    const reverseChar = (a: unknown, b: unknown): number => {
      const sa = String(a);
      const sb = String(b);
      return sa[sa.length - 1]!.localeCompare(sb[sb.length - 1]!);
    };
    const customCols: ColumnDef[] = [
      { field: "name", sortComparator: reverseChar },
    ];
    const rows: RowData[] = [{ name: "xyz" }, { name: "abc" }, { name: "qqb" }];
    // Last chars: z, c, b → asc order: b(2), c(1), z(0)
    const order = applySortModelToRowOrder(
      rows,
      [{ field: "name", sort: "asc" }],
      customCols,
    );
    if (order.kind !== "indexed") throw new Error("expected indexed order");
    expect(Array.from(order.indexes)).toEqual([2, 1, 0]);
  });

  it("multi-column sort with mixed asc/desc compares in model order", () => {
    const rows: RowData[] = [
      { name: "alice", score: 1 },
      { name: "alice", score: 3 },
      { name: "bob", score: 2 },
      { name: "alice", score: 2 },
    ];
    const order = applySortModelToRowOrder(
      rows,
      [
        { field: "name", sort: "asc" },
        { field: "score", sort: "desc" },
      ],
      cols,
    );
    if (order.kind !== "indexed") throw new Error("expected indexed order");
    // Asc by name → all "alice" first then "bob".
    // Within alice, desc by score → 3(1), 2(3), 1(0). Then bob(2).
    expect(Array.from(order.indexes)).toEqual([1, 3, 0, 2]);
  });

  it("stable tie-break uses the original source index", () => {
    // All rows compare equal on the sort key — the resulting order must be
    // the source order [0,1,2,3,4].
    const rows: RowData[] = [
      { name: "same" },
      { name: "same" },
      { name: "same" },
      { name: "same" },
      { name: "same" },
    ];
    const order = applySortModelToRowOrder(
      rows,
      [{ field: "name", sort: "asc" }],
      cols,
    );
    if (order.kind !== "indexed") throw new Error("expected indexed order");
    expect(Array.from(order.indexes)).toEqual([0, 1, 2, 3, 4]);
  });

  it("boolean compare puts false before true in asc", () => {
    const rows: RowData[] = [
      { active: true },
      { active: false },
      { active: true },
      { active: false },
    ];
    const order = applySortModelToRowOrder(
      rows,
      [{ field: "active", sort: "asc" }],
      cols,
    );
    if (order.kind !== "indexed") throw new Error("expected indexed order");
    // false(1), false(3), true(0), true(2) (stable within groups)
    expect(Array.from(order.indexes)).toEqual([1, 3, 0, 2]);
  });

  it("does not mutate the source rows array", () => {
    const rows: RowData[] = [{ score: 3 }, { score: 1 }, { score: 2 }];
    const snapshot = rows.map((r) => r.score);
    applySortModelToRowOrder(
      rows,
      [{ field: "score", sort: "asc" }],
      cols,
    );
    expect(rows.map((r) => r.score)).toEqual(snapshot);
  });
});

// ── Compatibility wrapper ─────────────────────────────────────

describe("applySortModel (compatibility wrapper)", () => {
  const cols: ColumnDef[] = [{ field: "score" }];

  it("returns the original rows reference when no sort active", () => {
    const rows: RowData[] = [{ score: 1 }, { score: 2 }];
    const out = applySortModel(rows, [], cols);
    expect(out).toBe(rows);
  });

  it("produces the same materialized row order as before", () => {
    const rows: RowData[] = [
      { score: 3 },
      { score: 1 },
      { score: 5 },
      { score: 2 },
    ];
    const out = applySortModel(
      rows,
      [{ field: "score", sort: "asc" }],
      cols,
    );
    expect(out).not.toBe(rows);
    expect(out.map((r) => r.score)).toEqual([1, 2, 3, 5]);
    // Wrapper materializes using the same Uint32Array order under the hood.
    const order = applySortModelToRowOrder(
      rows,
      [{ field: "score", sort: "asc" }],
      cols,
    );
    if (order.kind === "indexed") {
      const fromOrder = Array.from(order.indexes).map((i) => rows[i]);
      expect(out).toEqual(fromOrder);
    }
  });
});

describe("RowOrder type narrowing", () => {
  it("identity and indexed variants narrow correctly", () => {
    const identity: RowOrder = createIdentityRowOrder(3);
    const indexed: RowOrder = createIndexedRowOrder(new Uint32Array([0, 1, 2]));
    if (identity.kind === "identity") expect(identity.length).toBe(3);
    if (indexed.kind === "indexed") expect(indexed.indexes.length).toBe(3);
  });
});
