import { describe, expect, it, vi } from "vitest";

import type { ColumnDef, RowData } from "../../../types";
import { RowValueCache } from "..";

function makeRows(): RowData[] {
  return [
    { id: "r0", score: 3, name: "alice" },
    { id: "r1", score: 1, name: "bob" },
    { id: "r2", score: 2, name: "carol" },
  ];
}

const plainCol: ColumnDef = { field: "score" };

describe("RowValueCache", () => {
  it("builds values lazily only when requested", () => {
    const cache = new RowValueCache();
    const rows = makeRows();

    const entry = cache.getSortValues(rows, 1, "score", plainCol);
    expect(entry.values).toEqual([3, 1, 2]);
    expect(entry.nullFlags).toEqual(new Uint8Array([0, 0, 0]));
  });

  it("reuses values for same rows/epoch/field/valueGetter", () => {
    const cache = new RowValueCache();
    const rows = makeRows();

    const first = cache.getSortValues(rows, 1, "score", plainCol);
    const second = cache.getSortValues(rows, 1, "score", plainCol);
    expect(second).toBe(first);
  });

  it("rebuilds when epoch changes", () => {
    const cache = new RowValueCache();
    const rows = makeRows();

    const first = cache.getSortValues(rows, 1, "score", plainCol);
    const second = cache.getSortValues(rows, 2, "score", plainCol);
    expect(second).not.toBe(first);
    expect(second.values).toEqual([3, 1, 2]);
  });

  it("rebuilds when rows reference changes", () => {
    const cache = new RowValueCache();
    const rows1 = makeRows();
    const rows2 = makeRows();

    const first = cache.getSortValues(rows1, 1, "score", plainCol);
    const second = cache.getSortValues(rows2, 1, "score", plainCol);
    expect(second).not.toBe(first);
  });

  it("rebuilds when valueGetter reference changes", () => {
    const cache = new RowValueCache();
    const rows = makeRows();
    const getter1 = vi.fn(({ row }: { row: RowData }) => row.score);
    const getter2 = vi.fn(({ row }: { row: RowData }) => row.score);
    const col1: ColumnDef = { field: "score", valueGetter: getter1 };
    const col2: ColumnDef = { field: "score", valueGetter: getter2 };

    const first = cache.getSortValues(rows, 1, "score", col1);
    const second = cache.getSortValues(rows, 1, "score", col2);
    expect(second).not.toBe(first);
    expect(getter1).toHaveBeenCalledTimes(3);
    expect(getter2).toHaveBeenCalledTimes(3);
  });

  it("supports dot-path field values", () => {
    const cache = new RowValueCache();
    const rows: RowData[] = [
      { meta: { depth: 3 } },
      { meta: { depth: 1 } },
      { meta: { depth: 2 } },
    ];
    const col: ColumnDef = { field: "meta.depth" };

    const entry = cache.getSortValues(rows, 1, "meta.depth", col);
    expect(entry.values).toEqual([3, 1, 2]);
  });

  it("valueGetter receives source rowIndex", () => {
    const cache = new RowValueCache();
    const rows = makeRows();
    const getter = vi.fn(
      ({ row, rowIndex }: { row: RowData; rowIndex: number }) =>
        (row.score as number) + rowIndex,
    );
    const col: ColumnDef = { field: "computed", valueGetter: getter };

    const entry = cache.getSortValues(rows, 1, "computed", col);
    expect(entry.values).toEqual([3, 2, 4]);
    for (const call of getter.mock.calls) {
      const [{ row, rowIndex }] = call;
      expect(rows[rowIndex]).toBe(row);
    }
  });

  it("marks null and undefined values in nullFlags", () => {
    const cache = new RowValueCache();
    const rows: RowData[] = [
      { v: 1 },
      { v: null },
      { v: undefined },
      { v: 0 },
    ];
    const col: ColumnDef = { field: "v" };

    const entry = cache.getSortValues(rows, 1, "v", col);
    expect(entry.nullFlags).toEqual(new Uint8Array([0, 1, 1, 0]));
  });

  it("caches multiple fields independently", () => {
    const cache = new RowValueCache();
    const rows = makeRows();
    const nameCol: ColumnDef = { field: "name" };

    const scoreEntry = cache.getSortValues(rows, 1, "score", plainCol);
    const nameEntry = cache.getSortValues(rows, 1, "name", nameCol);
    expect(scoreEntry.values).toEqual([3, 1, 2]);
    expect(nameEntry.values).toEqual(["alice", "bob", "carol"]);

    // Both remain cached
    expect(cache.getSortValues(rows, 1, "score", plainCol)).toBe(scoreEntry);
    expect(cache.getSortValues(rows, 1, "name", nameCol)).toBe(nameEntry);
  });

  it("clear() drops all entries", () => {
    const cache = new RowValueCache();
    const rows = makeRows();

    const first = cache.getSortValues(rows, 1, "score", plainCol);
    cache.clear();
    const second = cache.getSortValues(rows, 1, "score", plainCol);
    expect(second).not.toBe(first);
  });

  it("setRowContext clears stale entries eagerly when rows/epoch change", () => {
    const cache = new RowValueCache();
    const rows1 = makeRows();
    cache.setRowContext(rows1, 1);

    // Build and cache an entry
    const entry1 = cache.getSortValues(rows1, 1, "score", plainCol);
    expect(entry1.values).toEqual([3, 1, 2]);

    // Change row context — old entries must be cleared immediately
    const rows2 = [{ id: "x", score: 9, name: "new" }];
    cache.setRowContext(rows2, 2);

    // Next access builds a fresh entry; old values are not reused
    const entry2 = cache.getSortValues(rows2, 2, "score", plainCol);
    expect(entry2).not.toBe(entry1);
    expect(entry2.values).toEqual([9]);
  });

  it("setRowContext with same rows/epoch does not clear entries", () => {
    const cache = new RowValueCache();
    const rows = makeRows();
    cache.setRowContext(rows, 1);

    const entry = cache.getSortValues(rows, 1, "score", plainCol);
    cache.setRowContext(rows, 1);

    // Same context — entry survives
    expect(cache.getSortValues(rows, 1, "score", plainCol)).toBe(entry);
  });
});
