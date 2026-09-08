import { describe, expect, it } from "vitest";

import { createDisplayRowReader } from "../../../rendering/rowViewAccess";
import {
  createIdentityRowOrder,
  createIndexedRowOrder,
} from "../../../row-model/rowOrder";
import { GridState } from "../../../state/GridState";
import type { GridSnapshot, LightFastGridColDef, RowData } from "../../../types";
import {
  computePaginationState,
  normalizePageSizeOptions,
  paginateRowOrder,
} from "../paginationModel";

const cols: LightFastGridColDef[] = [{ field: "v", sortable: true }];

function makeRows(n: number): RowData[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i), v: i }));
}

/** Display-order `v` values from a snapshot's RowView. */
function displayValues(snap: GridSnapshot): number[] {
  const reader = createDisplayRowReader(snap.rowView);
  return Array.from(
    { length: reader.rowCount },
    (_, i) => reader.getRowData(i)!.v as number,
  );
}

describe("paginateRowOrder", () => {
  it("slices identity orders into an indexed page", () => {
    const page = paginateRowOrder(createIdentityRowOrder(25), 1, 10);
    expect(page.kind).toBe("indexed");
    if (page.kind === "indexed") {
      expect(Array.from(page.indexes)).toEqual(
        [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      );
    }
  });

  it("slices indexed orders without copying (subarray view)", () => {
    const indexes = new Uint32Array([4, 3, 2, 1, 0]);
    const order = createIndexedRowOrder(indexes);
    const page = paginateRowOrder(order, 1, 2);
    expect(page.kind).toBe("indexed");
    if (page.kind === "indexed") {
      expect(Array.from(page.indexes)).toEqual([2, 1]);
      expect(page.indexes.buffer).toBe(indexes.buffer);
    }
  });

  it("returns the input order reference when the page covers all rows", () => {
    const identity = createIdentityRowOrder(5);
    expect(paginateRowOrder(identity, 0, 10)).toBe(identity);
    const indexed = createIndexedRowOrder(new Uint32Array([1, 0]));
    expect(paginateRowOrder(indexed, 0, 2)).toBe(indexed);
  });

  it("clamps the final partial page", () => {
    const page = paginateRowOrder(createIdentityRowOrder(25), 2, 10);
    if (page.kind === "indexed") {
      expect(Array.from(page.indexes)).toEqual([20, 21, 22, 23, 24]);
    }
  });
});

describe("computePaginationState", () => {
  it("computes counts and one-based start/end rows", () => {
    expect(computePaginationState(true, 1, 10, 25)).toEqual({
      enabled: true,
      pageIndex: 1,
      pageSize: 10,
      pageCount: 3,
      totalRows: 25,
      startRow: 11,
      endRow: 20,
    });
  });

  it("empty rows: pageCount 0 and zero start/end", () => {
    expect(computePaginationState(true, 3, 10, 0)).toEqual({
      enabled: true,
      pageIndex: 0,
      pageSize: 10,
      pageCount: 0,
      totalRows: 0,
      startRow: 0,
      endRow: 0,
    });
  });

  it("clamps out-of-range page indexes", () => {
    expect(computePaginationState(true, 99, 10, 25).pageIndex).toBe(2);
    expect(computePaginationState(true, -5, 10, 25).pageIndex).toBe(0);
  });
});

describe("normalizePageSizeOptions", () => {
  it("defaults and always includes the page size", () => {
    expect(normalizePageSizeOptions(undefined, 100)).toEqual(
      [25, 50, 100, 250, 500, 1000],
    );
    expect(normalizePageSizeOptions(undefined, 75)).toEqual(
      [25, 50, 75, 100, 250, 500, 1000],
    );
    expect(normalizePageSizeOptions([10, 20], 15)).toEqual([10, 15, 20]);
  });
});

describe("pagination row-model stage (GridState)", () => {
  it("pagination disabled keeps current rowView behavior", () => {
    const state = new GridState({ columns: cols, rows: makeRows(25) });

    const snap1 = state.getSnapshot();
    expect(snap1.pagination).toBeUndefined();
    expect(snap1.rowView.rowCount).toBe(25);

    // Stable rowView across unchanged snapshots (no-pagination fast path).
    const snap2 = state.getSnapshot();
    expect(snap2.rowView).toBe(snap1.rowView);
  });

  it("slices rows by pageIndex/pageSize", () => {
    const state = new GridState({
      columns: cols,
      rows: makeRows(25),
      pagination: true,
      paginationPageSize: 10,
    });

    const snap = state.getSnapshot();
    expect(snap.pagination).toMatchObject({
      enabled: true,
      pageIndex: 0,
      pageSize: 10,
      pageCount: 3,
      totalRows: 25,
      startRow: 1,
      endRow: 10,
    });
    expect(displayValues(snap)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("setPageIndex updates rowView and clamps", () => {
    const state = new GridState({
      columns: cols,
      rows: makeRows(25),
      pagination: true,
      paginationPageSize: 10,
    });

    expect(state.setPageIndex(2)).toBe(true);
    const snap = state.getSnapshot();
    expect(displayValues(snap)).toEqual([20, 21, 22, 23, 24]);
    expect(snap.pagination).toMatchObject({
      pageIndex: 2,
      startRow: 21,
      endRow: 25,
    });

    expect(state.setPageIndex(2)).toBe(false); // same page
    expect(state.setPageIndex(99)).toBe(false); // clamps to current
    expect(state.getPaginationState().pageIndex).toBe(2);
  });

  it("setPageSize updates rowView and clamps pageIndex", () => {
    const state = new GridState({
      columns: cols,
      rows: makeRows(25),
      pagination: true,
      paginationPageSize: 10,
    });
    state.setPageIndex(2);

    expect(state.setPageSize(25)).toBe(true);
    const paginationState = state.getPaginationState();
    expect(paginationState.pageSize).toBe(25);
    expect(paginationState.pageCount).toBe(1);
    expect(paginationState.pageIndex).toBe(0); // clamped from 2

    const snap = state.getSnapshot();
    expect(snap.rowView.rowCount).toBe(25);
  });

  it("setPageSize(75) adds the custom size to the options", () => {
    const state = new GridState({
      columns: cols,
      rows: makeRows(25),
      pagination: true,
    });
    expect(state.getPageSizeOptions()).not.toContain(75);

    expect(state.setPageSize(75)).toBe(true);
    expect(state.getPageSizeOptions()).toEqual(
      [25, 50, 75, 100, 250, 500, 1000],
    );
    expect(state.getPaginationState().pageSize).toBe(75);
  });

  it("row count changes clamp pageIndex", () => {
    const state = new GridState({
      columns: cols,
      rows: makeRows(25),
      pagination: true,
      paginationPageSize: 10,
    });
    state.setPageIndex(2);

    state.setRows(makeRows(12)); // pageCount drops to 2
    expect(state.getPaginationState().pageIndex).toBe(1);
    expect(displayValues(state.getSnapshot())).toEqual([10, 11]);
  });

  it("pagination composes after sorting", () => {
    const state = new GridState({
      columns: cols,
      rows: makeRows(25),
      pagination: true,
      paginationPageSize: 10,
    });
    state.setSortModel([{ field: "v", sort: "desc" }]);

    expect(displayValues(state.getSnapshot())).toEqual(
      [24, 23, 22, 21, 20, 19, 18, 17, 16, 15],
    );
    state.setPageIndex(2);
    expect(displayValues(state.getSnapshot())).toEqual([4, 3, 2, 1, 0]);
  });

  it("snapshot pagination total derives from the upstream order length", () => {
    const state = new GridState({
      columns: cols,
      rows: makeRows(25),
      pagination: true,
      paginationPageSize: 10,
    });
    state.setSortModel([{ field: "v", sort: "asc" }]);
    expect(state.getSnapshot().pagination).toMatchObject({
      totalRows: 25,
      pageCount: 3,
    });
  });

  it("paginated rowView is stable across unchanged snapshots", () => {
    const state = new GridState({
      columns: cols,
      rows: makeRows(25),
      pagination: true,
      paginationPageSize: 10,
    });
    state.setPageIndex(1);

    const snap1 = state.getSnapshot();
    const snap2 = state.getSnapshot();
    expect(snap2.rowView).toBe(snap1.rowView);
  });

  it("empty rows report pageCount 0 and zero start/end rows", () => {
    const state = new GridState({
      columns: cols,
      rows: [],
      pagination: true,
      paginationPageSize: 10,
    });

    expect(state.getPaginationState()).toEqual({
      enabled: true,
      pageIndex: 0,
      pageSize: 10,
      pageCount: 0,
      totalRows: 0,
      startRow: 0,
      endRow: 0,
    });
    expect(state.getSnapshot().rowView.rowCount).toBe(0);
  });

  it("defaults: pageSize 100 and options include a custom page size", () => {
    const state = new GridState({ columns: cols, rows: [], pagination: true });
    expect(state.getPaginationState().pageSize).toBe(100);
    expect(state.getPageSizeOptions()).toEqual([25, 50, 100, 250, 500, 1000]);

    const custom = new GridState({
      columns: cols,
      rows: [],
      pagination: true,
      paginationPageSize: 75,
    });
    expect(custom.getPageSizeOptions()).toEqual(
      [25, 50, 75, 100, 250, 500, 1000],
    );
  });

  describe("setPaginationConfig", () => {
    it("enables and disables pagination at runtime", () => {
      const state = new GridState({ columns: cols, rows: makeRows(25) });
      expect(state.getSnapshot().pagination).toBeUndefined();

      expect(
        state.setPaginationConfig({ enabled: true, pageSize: 10 }),
      ).toBe(true);
      expect(state.getSnapshot().pagination).toMatchObject({
        enabled: true,
        pageSize: 10,
        pageCount: 3,
      });
      expect(state.getSnapshot().rowView.rowCount).toBe(10);

      expect(state.setPaginationConfig({ enabled: false })).toBe(true);
      expect(state.getSnapshot().pagination).toBeUndefined();
      expect(state.getSnapshot().rowView.rowCount).toBe(25);
    });

    it("returns false when the normalized config is unchanged", () => {
      const state = new GridState({
        columns: cols,
        rows: makeRows(25),
        pagination: true,
        paginationPageSize: 10,
      });
      expect(
        state.setPaginationConfig({ enabled: true, pageSize: 10 }),
      ).toBe(false);
      // Identical defaults expressed differently still no-op.
      expect(
        state.setPaginationConfig({
          enabled: true,
          pageSize: 10,
          pageSizeOptions: [25, 50, 100, 250, 500, 1000],
        }),
      ).toBe(false);
    });

    it("clamps pageIndex when the config shrinks the page count", () => {
      const state = new GridState({
        columns: cols,
        rows: makeRows(25),
        pagination: true,
        paginationPageSize: 10,
      });
      state.setPageIndex(2);
      state.setPaginationConfig({ enabled: true, pageSize: 25 });
      expect(state.getPaginationState().pageIndex).toBe(0);
    });
  });
});
