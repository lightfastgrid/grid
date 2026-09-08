import { describe, expect, it, vi } from "vitest";

import { createDisplayRowReader } from "../../../rendering/rowViewAccess";
import { GridState } from "../../../state/GridState";
import type { ColumnDef, GridSnapshot, RowData } from "../../../types";
import { resolveSelectedRowsLive } from "../../../utils/rowSelection";
import { applySortModel, normalizeSortModel } from "../../../utils/sortModel";

/** Map display-order rows from a snapshot's RowView. */
function displayRows(snap: GridSnapshot): RowData[] {
  const reader = createDisplayRowReader(snap.rowView);
  return Array.from({ length: reader.rowCount }, (_, i) => reader.getRowData(i)!);
}

describe("sort data pipeline", () => {
  const sortableCols: ColumnDef[] = [
    { field: "v", sortable: true },
  ];

  it("asc sort", () => {
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const out = applySortModel(rows, [{ field: "v", sort: "asc" }], sortableCols);
    expect(out.map((r) => r.v)).toEqual([1, 2, 3]);
  });

  it("desc sort", () => {
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const out = applySortModel(rows, [{ field: "v", sort: "desc" }], sortableCols);
    expect(out.map((r) => r.v)).toEqual([3, 2, 1]);
  });

  it("stable sort for equal values", () => {
    const rows = [
      { v: 1, id: "a" },
      { v: 2, id: "b" },
      { v: 2, id: "c" },
      { v: 1, id: "d" },
    ];
    const out = applySortModel(rows, [{ field: "v", sort: "asc" }], sortableCols);
    expect(out.map((r) => (r as { id: string }).id)).toEqual(["a", "d", "b", "c"]);
  });

  it("raw rows are not mutated", () => {
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const snapshot = rows.slice();
    const out = applySortModel(rows, [{ field: "v", sort: "asc" }], sortableCols);
    expect(rows).toEqual(snapshot);
    expect(out).not.toBe(rows);
  });

  it("null/undefined last in asc and desc", () => {
    const rows = [
      { v: null },
      { v: 2 },
      { v: undefined },
      { v: 1 },
    ];
    const asc = applySortModel(rows, [{ field: "v", sort: "asc" }], sortableCols);
    const desc = applySortModel(rows, [{ field: "v", sort: "desc" }], sortableCols);
    expect(asc.map((r) => r.v)).toEqual([1, 2, null, undefined]);
    expect(desc.map((r) => r.v)).toEqual([2, 1, null, undefined]);
  });

  it("numbers sort numerically", () => {
    const rows = [{ v: 10 }, { v: 2 }, { v: 1 }];
    const out = applySortModel(rows, [{ field: "v", sort: "asc" }], sortableCols);
    expect(out.map((r) => r.v)).toEqual([1, 2, 10]);
  });

  it("strings sort correctly", () => {
    const rows = [{ v: "banana" }, { v: "apple" }, { v: "cherry" }];
    const out = applySortModel(rows, [{ field: "v", sort: "asc" }], sortableCols);
    expect(out.map((r) => r.v)).toEqual(["apple", "banana", "cherry"]);
  });

  it("booleans sort correctly", () => {
    const rows = [{ v: true }, { v: false }, { v: true }];
    const asc = applySortModel(rows, [{ field: "v", sort: "asc" }], sortableCols);
    const desc = applySortModel(rows, [{ field: "v", sort: "desc" }], sortableCols);
    expect(asc.map((r) => r.v)).toEqual([false, true, true]);
    expect(desc.map((r) => r.v)).toEqual([true, true, false]);
  });

  it("custom comparator works", () => {
    const rows = [{ v: "bbbb" }, { v: "a" }, { v: "ccc" }];
    const cols: ColumnDef[] = [{
      field: "v",
      sortable: true,
      sortComparator: (a, b) => String(a).length - String(b).length,
    }];
    const out = applySortModel(rows, [{ field: "v", sort: "asc" }], cols);
    expect(out.map((r) => r.v)).toEqual(["a", "ccc", "bbbb"]);
  });

  it("multi-column sort works", () => {
    const rows = [
      { a: "x", b: 1 },
      { a: "x", b: 3 },
      { a: "y", b: 2 },
      { a: "x", b: 2 },
    ];
    const cols: ColumnDef[] = [
      { field: "a", sortable: true },
      { field: "b", sortable: true },
    ];
    const out = applySortModel(
      rows,
      [
        { field: "a", sort: "asc" },
        { field: "b", sort: "desc" },
      ],
      cols,
    );
    expect(out).toEqual([
      { a: "x", b: 3 },
      { a: "x", b: 2 },
      { a: "x", b: 1 },
      { a: "y", b: 2 },
    ]);
  });

  it("unknown/non-sortable fields are ignored", () => {
    const model = normalizeSortModel(
      [
        { field: "unknown", sort: "asc" },
        { field: "blocked", sort: "desc" },
        { field: "ok", sort: "asc" },
      ],
      [
        { field: "ok", sortable: true },
        { field: "blocked", sortable: false },
      ],
    );
    expect(model).toEqual([{ field: "ok", sort: "asc" }]);
  });

  it("duplicate sort fields are deduped", () => {
    const model = normalizeSortModel(
      [
        { field: "a", sort: "asc" },
        { field: "a", sort: "desc" },
        { field: "b", sort: "asc" },
      ],
      [
        { field: "a", sortable: true },
        { field: "b", sortable: true },
      ],
    );
    expect(model).toEqual([
      { field: "a", sort: "asc" },
      { field: "b", sort: "asc" },
    ]);
  });

  it("selection by row id still resolves after sort", () => {
    const rows: RowData[] = [
      { id: "r1", score: 3 },
      { id: "r2", score: 1 },
      { id: "r3", score: 2 },
    ];
    const state = new GridState({
      rows,
      columns: [
        { field: "id", sortable: false },
        { field: "score", sortable: true },
      ],
    });
    state.setSortModel([{ field: "score", sort: "asc" }]);

    const selected = new Set(["r1"]);
    const sortedRows = state.getSnapshot().data;
    const resolved = resolveSelectedRowsLive(
      {
        getRows: () => sortedRows,
        resolveRowId: (row) => String((row as { id: string }).id),
      },
      (rowId) => selected.has(rowId),
    );

    expect(resolved).toHaveLength(1);
    expect((resolved[0] as { id: string }).id).toBe("r1");
  });

  it("valueGetter sorting works", () => {
    const rows = [
      { raw: 30 },
      { raw: 10 },
      { raw: 20 },
    ];
    const cols: ColumnDef[] = [{
      field: "computed",
      sortable: true,
      valueGetter: ({ row }) => (row as { raw: number }).raw * 2,
    }];
    const out = applySortModel(rows, [{ field: "computed", sort: "asc" }], cols);
    expect(out).toEqual([{ raw: 10 }, { raw: 20 }, { raw: 30 }]);
  });

  it("dot-path field sorting works", () => {
    const rows = [
      { game: { name: "Zelda" } },
      { game: { name: "Asteroids" } },
      { game: { name: "Mario" } },
    ];
    const cols: ColumnDef[] = [
      { field: "game.name", sortable: true },
    ];
    const out = applySortModel(rows, [{ field: "game.name", sort: "asc" }], cols);
    expect(out.map((r) => (r.game as { name: string }).name)).toEqual([
      "Asteroids", "Mario", "Zelda",
    ]);
  });

  it("dot-path handles missing intermediate", () => {
    const rows: RowData[] = [
      { game: { name: "Zelda" } },
      { game: null },
      { other: 1 },
    ];
    const cols: ColumnDef[] = [
      { field: "game.name", sortable: true },
    ];
    const out = applySortModel(rows, [{ field: "game.name", sort: "asc" }], cols);
    expect(out[0]).toBe(rows[0]);
    expect(out[1]).toBe(rows[1]);
    expect(out[2]).toBe(rows[2]);
  });

  it("valueGetter receives correct params", () => {
    const getter = vi.fn(({ row, rowIndex: _rowIndex, field, column }) => {
      expect(field).toBe("x");
      expect(column.field).toBe("x");
      return (row as { n: number }).n;
    });
    const rows = [{ n: 2 }, { n: 1 }];
    const cols: ColumnDef[] = [{
      field: "x",
      sortable: true,
      valueGetter: getter,
    }];
    applySortModel(rows, [{ field: "x", sort: "asc" }], cols);
    expect(getter).toHaveBeenCalled();
  });
});

describe("precomputed value resolution", () => {
  it("valueGetter is called once per row, not per comparison", () => {
    const getter = vi.fn(({ row }: { row: RowData }) => (row as { v: number }).v);
    const rows = Array.from({ length: 20 }, (_, i) => ({ v: 20 - i }));
    const cols: ColumnDef[] = [{
      field: "v",
      sortable: true,
      valueGetter: getter,
    }];
    applySortModel(rows, [{ field: "v", sort: "asc" }], cols);
    expect(getter).toHaveBeenCalledTimes(20);
  });

  it("custom comparator receives precomputed values and row objects", () => {
    const cmp = vi.fn((a: unknown, b: unknown, rowA: RowData, rowB: RowData) => {
      expect(typeof a).toBe("number");
      expect(typeof b).toBe("number");
      expect(typeof rowA.v).toBe("number");
      expect(typeof rowB.v).toBe("number");
      return Number(a) - Number(b);
    });
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const cols: ColumnDef[] = [{
      field: "v",
      sortable: true,
      sortComparator: cmp,
    }];
    const out = applySortModel(rows, [{ field: "v", sort: "asc" }], cols);
    expect(out.map((r) => r.v)).toEqual([1, 2, 3]);
    expect(cmp).toHaveBeenCalled();
  });

  it("dot-path is not split per comparison", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      game: { score: 10 - i },
    }));
    const cols: ColumnDef[] = [
      { field: "game.score", sortable: true },
    ];
    const splitSpy = vi.spyOn(String.prototype, "split");
    applySortModel(rows, [{ field: "game.score", sort: "asc" }], cols);
    const dotSplitCalls = splitSpy.mock.calls.filter(
      (call) => String(call[0]) === ".",
    );
    // split(".") should happen once in buildSortEntries, not per row or comparison
    expect(dotSplitCalls.length).toBe(1);
    splitSpy.mockRestore();
  });

  it("multi-column valueGetter called once per row per field", () => {
    const getterA = vi.fn(({ row }: { row: RowData }) => (row as { a: number }).a);
    const getterB = vi.fn(({ row }: { row: RowData }) => (row as { b: number }).b);
    const rows = Array.from({ length: 10 }, (_, i) => ({
      a: i % 3,
      b: 10 - i,
    }));
    const cols: ColumnDef[] = [
      { field: "a", sortable: true, valueGetter: getterA },
      { field: "b", sortable: true, valueGetter: getterB },
    ];
    applySortModel(
      rows,
      [
        { field: "a", sort: "asc" },
        { field: "b", sort: "desc" },
      ],
      cols,
    );
    expect(getterA).toHaveBeenCalledTimes(10);
    expect(getterB).toHaveBeenCalledTimes(10);
  });
});

describe("sort cache in GridState", () => {
  it("getSnapshot twice with active sort does not call comparator twice", () => {
    const cmp = vi.fn((a: unknown, b: unknown) => Number(a) - Number(b));
    const state = new GridState({
      columns: [{ field: "v", sortable: true, sortComparator: cmp }],
      rows: [{ v: 3 }, { v: 1 }, { v: 2 }],
    });
    state.setSortModel([{ field: "v", sort: "asc" }]);

    const snap1 = state.getSnapshot();
    const callCount1 = cmp.mock.calls.length;
    expect(callCount1).toBeGreaterThan(0);

    const snap2 = state.getSnapshot();
    expect(cmp.mock.calls.length).toBe(callCount1);
    expect(snap1.data).toBe(snap2.data);
  });

  it("setRowSelection does not recompute sorted rows", () => {
    const cmp = vi.fn((a: unknown, b: unknown) => Number(a) - Number(b));
    const state = new GridState({
      columns: [{ field: "v", sortable: true, sortComparator: cmp }],
      rows: [{ v: 3 }, { v: 1 }, { v: 2 }],
    });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    const snap1 = state.getSnapshot();
    const callCount1 = cmp.mock.calls.length;

    state.setRowSelection("multiple");
    const snap2 = state.getSnapshot();
    expect(cmp.mock.calls.length).toBe(callCount1);
    expect(snap2.data).toBe(snap1.data);
  });

  it("setColumnSelection does not recompute sorted rows", () => {
    const cmp = vi.fn((a: unknown, b: unknown) => Number(a) - Number(b));
    const state = new GridState({
      columns: [{ field: "v", sortable: true, sortComparator: cmp }],
      rows: [{ v: 3 }, { v: 1 }, { v: 2 }],
    });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    const snap1 = state.getSnapshot();
    const callCount1 = cmp.mock.calls.length;

    state.setColumnSelection({ mode: "multiple" });
    const snap2 = state.getSnapshot();
    expect(cmp.mock.calls.length).toBe(callCount1);
    expect(snap2.data).toBe(snap1.data);
  });

  it("setRowDrag does not recompute sorted rows", () => {
    const cmp = vi.fn((a: unknown, b: unknown) => Number(a) - Number(b));
    const state = new GridState({
      columns: [{ field: "v", sortable: true, sortComparator: cmp }],
      rows: [{ v: 3 }, { v: 1 }, { v: 2 }],
    });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    const snap1 = state.getSnapshot();
    const callCount1 = cmp.mock.calls.length;

    state.setRowDrag(true);
    const snap2 = state.getSnapshot();
    expect(cmp.mock.calls.length).toBe(callCount1);
    expect(snap2.data).toBe(snap1.data);
  });

  it("setColumnWidth does not recompute sorted rows", () => {
    const cmp = vi.fn((a: unknown, b: unknown) => Number(a) - Number(b));
    const state = new GridState({
      columns: [{ field: "v", sortable: true, sortComparator: cmp, width: 100 }],
      rows: [{ v: 3 }, { v: 1 }, { v: 2 }],
    });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    const snap1 = state.getSnapshot();
    const callCount1 = cmp.mock.calls.length;

    state.setColumnWidth("v", 200);
    const snap2 = state.getSnapshot();
    expect(cmp.mock.calls.length).toBe(callCount1);
    expect(snap2.data).toBe(snap1.data);
  });

  it("setRows recomputes sorted rows", () => {
    const cmp = vi.fn((a: unknown, b: unknown) => Number(a) - Number(b));
    const state = new GridState({
      columns: [{ field: "v", sortable: true, sortComparator: cmp }],
      rows: [{ v: 3 }, { v: 1 }, { v: 2 }],
    });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    state.getSnapshot();
    const callCount1 = cmp.mock.calls.length;

    state.setRows([{ v: 5 }, { v: 4 }]);
    const snap2 = state.getSnapshot();
    expect(cmp.mock.calls.length).toBeGreaterThan(callCount1);
    expect(displayRows(snap2).map((r) => r.v)).toEqual([4, 5]);
  });

  it("setSortModel recomputes sorted rows (custom comparator bypasses pair cache)", () => {
    const cmp = vi.fn((a: unknown, b: unknown) => Number(a) - Number(b));
    const state = new GridState({
      columns: [{ field: "v", sortable: true, sortComparator: cmp }],
      rows: [{ v: 3 }, { v: 1 }, { v: 2 }],
    });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    state.getSnapshot();
    const callCount1 = cmp.mock.calls.length;

    state.setSortModel([{ field: "v", sort: "desc" }]);
    const snap2 = state.getSnapshot();
    // Custom sortComparator bypasses SortOrderPairCache — must recompute
    // via a full sort, so the comparator is called again.
    expect(cmp.mock.calls.length).toBeGreaterThan(callCount1);
    expect(displayRows(snap2).map((r) => r.v)).toEqual([3, 2, 1]);
  });

  it("initialSortModel is normalized", () => {
    const state = new GridState({
      columns: [
        { field: "a", sortable: true },
        { field: "b", sortable: false },
      ],
      rows: [{ a: 2, b: 1 }, { a: 1, b: 2 }],
      initialSortModel: [
        { field: "b", sort: "asc" },
        { field: "a", sort: "desc" },
      ],
    });
    expect(state.getSortModel()).toEqual([
      { field: "a", sort: "desc" },
    ]);
    expect(displayRows(state.getSnapshot()).map((r) => r.a)).toEqual([2, 1]);
  });

  it("empty sortModel returns raw rows by reference", () => {
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const state = new GridState({
      columns: [{ field: "v" }],
      rows,
    });
    expect(state.getSnapshot().data).toBe(rows);
  });

  it("changing column comparator invalidates cache", () => {
    const cmp1 = vi.fn((a: unknown, b: unknown) => Number(a) - Number(b));
    const cmp2 = vi.fn((a: unknown, b: unknown) => Number(b) - Number(a));
    const state = new GridState({
      columns: [{ field: "v", sortable: true, sortComparator: cmp1 }],
      rows: [{ v: 3 }, { v: 1 }, { v: 2 }],
    });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    state.getSnapshot();

    state.setColumns([{ field: "v", sortable: true, sortComparator: cmp2 }]);
    const snap2 = state.getSnapshot();
    expect(cmp2).toHaveBeenCalled();
    expect(displayRows(snap2).map((r) => r.v)).toEqual([3, 2, 1]);
  });

  it("changing column valueGetter invalidates cache", () => {
    const getter1 = vi.fn(({ row }: { row: RowData }) => (row as { v: number }).v);
    const state = new GridState({
      columns: [{ field: "v", sortable: true, valueGetter: getter1 }],
      rows: [{ v: 3 }, { v: 1 }, { v: 2 }],
    });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    state.getSnapshot();
    const callCount1 = getter1.mock.calls.length;

    const getter2 = vi.fn(({ row }: { row: RowData }) => -(row as { v: number }).v);
    state.setColumns([{ field: "v", sortable: true, valueGetter: getter2 }]);
    state.getSnapshot();
    expect(getter2).toHaveBeenCalled();
    expect(getter1.mock.calls.length).toBe(callCount1);
  });
});
