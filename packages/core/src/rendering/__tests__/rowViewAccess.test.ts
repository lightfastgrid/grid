import { describe, expect, it, vi } from "vitest";

import type { RowView } from "../../row-model/rowOrder";
import {
  createIdentityRowOrder,
  createIndexedRowOrder,
  createRowView,
} from "../../row-model/rowOrder";
import type { RowData } from "../../types";
import {
  createArrayDisplayRowReader,
  createDisplayRowReader,
} from "../rowViewAccess";

const rows: RowData[] = [
  { name: "Alice", score: 10 },
  { name: "Bob", score: 20 },
  { name: "Carol", score: 30 },
];

describe("DisplayRowReader", () => {
  describe("identity order", () => {
    const view = createRowView(rows, createIdentityRowOrder(rows.length), 1);
    const reader = createDisplayRowReader(view);

    it("rowCount matches source length", () => {
      expect(reader.rowCount).toBe(3);
    });

    it("getRow returns displayIndex, sourceIndex, and row (identity: display === source)", () => {
      const entry = reader.getRow(0);
      expect(entry).not.toBeNull();
      expect(entry!.displayIndex).toBe(0);
      expect(entry!.sourceIndex).toBe(0);
      expect(entry!.row).toBe(rows[0]);

      const entry1 = reader.getRow(1);
      expect(entry1).not.toBeNull();
      expect(entry1!.displayIndex).toBe(1);
      expect(entry1!.sourceIndex).toBe(1);
      expect(entry1!.row).toBe(rows[1]);

      const entry2 = reader.getRow(2);
      expect(entry2).not.toBeNull();
      expect(entry2!.displayIndex).toBe(2);
      expect(entry2!.sourceIndex).toBe(2);
      expect(entry2!.row).toBe(rows[2]);
    });

    it("getRow returns null for out-of-range index", () => {
      expect(reader.getRow(-1)).toBeNull();
      expect(reader.getRow(3)).toBeNull();
    });

    it("getRowData returns just the row object", () => {
      expect(reader.getRowData(0)).toBe(rows[0]);
      expect(reader.getRowData(2)).toBe(rows[2]);
    });

    it("getRowData returns undefined for out-of-range index", () => {
      expect(reader.getRowData(-1)).toBeUndefined();
      expect(reader.getRowData(3)).toBeUndefined();
    });

    it("getSourceIndex returns identity mapping", () => {
      expect(reader.getSourceIndex(0)).toBe(0);
      expect(reader.getSourceIndex(1)).toBe(1);
      expect(reader.getSourceIndex(2)).toBe(2);
    });

    it("getSourceIndex returns -1 for out-of-range index", () => {
      expect(reader.getSourceIndex(-1)).toBe(-1);
      expect(reader.getSourceIndex(3)).toBe(-1);
    });
  });

  describe("indexed order", () => {
    // Display order: Carol (2), Alice (0), Bob (1)
    const indexes = new Uint32Array([2, 0, 1]);
    const view = createRowView(rows, createIndexedRowOrder(indexes), 2);
    const reader = createDisplayRowReader(view);

    it("rowCount matches index array length", () => {
      expect(reader.rowCount).toBe(3);
    });

    it("getRow returns correct displayIndex, sourceIndex, and row for indexed order", () => {
      const entry0 = reader.getRow(0);
      expect(entry0).not.toBeNull();
      expect(entry0!.displayIndex).toBe(0);
      expect(entry0!.sourceIndex).toBe(2);
      expect(entry0!.row).toBe(rows[2]); // Carol

      const entry1 = reader.getRow(1);
      expect(entry1).not.toBeNull();
      expect(entry1!.displayIndex).toBe(1);
      expect(entry1!.sourceIndex).toBe(0);
      expect(entry1!.row).toBe(rows[0]); // Alice

      const entry2 = reader.getRow(2);
      expect(entry2).not.toBeNull();
      expect(entry2!.displayIndex).toBe(2);
      expect(entry2!.sourceIndex).toBe(1);
      expect(entry2!.row).toBe(rows[1]); // Bob
    });

    it("getRow returns null for out-of-range index", () => {
      expect(reader.getRow(-1)).toBeNull();
      expect(reader.getRow(3)).toBeNull();
    });

    it("getRowData maps display index through index array", () => {
      expect(reader.getRowData(0)).toBe(rows[2]); // Carol
      expect(reader.getRowData(1)).toBe(rows[0]); // Alice
      expect(reader.getRowData(2)).toBe(rows[1]); // Bob
    });

    it("getRowData returns undefined for out-of-range index", () => {
      expect(reader.getRowData(-1)).toBeUndefined();
      expect(reader.getRowData(100)).toBeUndefined();
    });

    it("getSourceIndex maps display to source index", () => {
      expect(reader.getSourceIndex(0)).toBe(2);
      expect(reader.getSourceIndex(1)).toBe(0);
      expect(reader.getSourceIndex(2)).toBe(1);
    });

    it("getSourceIndex returns -1 for out-of-range index", () => {
      expect(reader.getSourceIndex(-1)).toBe(-1);
      expect(reader.getSourceIndex(3)).toBe(-1);
    });
  });

  describe("empty rows", () => {
    const emptyView = createRowView([], createIdentityRowOrder(0), 0);
    const reader = createDisplayRowReader(emptyView);

    it("rowCount is zero", () => {
      expect(reader.rowCount).toBe(0);
    });

    it("getRow returns null for index 0", () => {
      expect(reader.getRow(0)).toBeNull();
    });

    it("getRowData returns undefined for index 0", () => {
      expect(reader.getRowData(0)).toBeUndefined();
    });

    it("getSourceIndex returns -1 for index 0", () => {
      expect(reader.getSourceIndex(0)).toBe(-1);
    });
  });

  describe("invalid sourceIndex guard", () => {
    it("getRow returns null when RowView.getSourceIndex yields -1", () => {
      const fakeView: RowView = {
        generation: 1,
        rows,
        rowCount: 1,
        getSourceIndex: () => -1,
        getRow: () => rows[0],
      };
      const reader = createDisplayRowReader(fakeView);
      expect(reader.getRow(0)).toBeNull();
    });

    it("getRowData returns undefined when RowView.getSourceIndex yields -1", () => {
      const fakeView: RowView = {
        generation: 1,
        rows,
        rowCount: 1,
        getSourceIndex: () => -1,
        getRow: () => rows[0],
      };
      const reader = createDisplayRowReader(fakeView);
      expect(reader.getRowData(0)).toBeUndefined();
    });

    it("getRow returns null when RowView.getRow yields undefined", () => {
      const fakeView: RowView = {
        generation: 1,
        rows,
        rowCount: 1,
        getSourceIndex: () => 0,
        getRow: () => undefined,
      };
      const reader = createDisplayRowReader(fakeView);
      expect(reader.getRow(0)).toBeNull();
    });
  });

  describe("hot-path allocation avoidance", () => {
    it("getRowData does not call getRow on the reader (no entry allocation)", () => {
      const view = createRowView(rows, createIdentityRowOrder(rows.length), 1);
      const reader = createDisplayRowReader(view);
      const getRowSpy = vi.spyOn(reader, "getRow");

      reader.getRowData(0);
      reader.getRowData(1);
      reader.getRowData(2);

      expect(getRowSpy).not.toHaveBeenCalled();
    });
  });
});

describe("createArrayDisplayRowReader", () => {
  it("rowCount matches array length", () => {
    const reader = createArrayDisplayRowReader(rows);
    expect(reader.rowCount).toBe(3);
  });

  it("getRow returns displayIndex === sourceIndex (identity mapping)", () => {
    const reader = createArrayDisplayRowReader(rows);
    const entry = reader.getRow(1);
    expect(entry).not.toBeNull();
    expect(entry!.displayIndex).toBe(1);
    expect(entry!.sourceIndex).toBe(1);
    expect(entry!.row).toBe(rows[1]);
  });

  it("getRow returns null for out-of-range index", () => {
    const reader = createArrayDisplayRowReader(rows);
    expect(reader.getRow(-1)).toBeNull();
    expect(reader.getRow(3)).toBeNull();
  });

  it("getRowData returns the row object", () => {
    const reader = createArrayDisplayRowReader(rows);
    expect(reader.getRowData(0)).toBe(rows[0]);
    expect(reader.getRowData(2)).toBe(rows[2]);
  });

  it("getRowData returns undefined for out-of-range index", () => {
    const reader = createArrayDisplayRowReader(rows);
    expect(reader.getRowData(-1)).toBeUndefined();
    expect(reader.getRowData(3)).toBeUndefined();
  });

  it("getSourceIndex returns identity for in-range, -1 for out-of-range", () => {
    const reader = createArrayDisplayRowReader(rows);
    expect(reader.getSourceIndex(0)).toBe(0);
    expect(reader.getSourceIndex(2)).toBe(2);
    expect(reader.getSourceIndex(-1)).toBe(-1);
    expect(reader.getSourceIndex(3)).toBe(-1);
  });

  it("rowCount is zero for empty array", () => {
    const reader = createArrayDisplayRowReader([]);
    expect(reader.rowCount).toBe(0);
    expect(reader.getRow(0)).toBeNull();
  });
});
