import { describe, expect, it, vi } from "vitest";

import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import type { RowData } from "../../../types";
import {
  createRowPinningRenderModelBuilder,
  type RowPinningRenderModel,
  type RowPinState,
} from "..";

const rows: RowData[] = [
  { id: "r1", name: "Alice" },
  { id: "r2", name: "Bob" },
  { id: "r3", name: "Carol" },
  { id: "r4", name: "Dave" },
  { id: "r5", name: "Eve" },
];

const resolveRowId = (row: RowData, _index: number) => String(row.id);

/** Convenience: build a DisplayRowReader from a plain array. */
function readerFrom(data: RowData[]) {
  return createArrayDisplayRowReader(data);
}

/** Materialize the center → display mapping for assertions. */
function centerIndices(model: RowPinningRenderModel): number[] {
  return Array.from({ length: model.centerRowCount }, (_, i) =>
    model.centerToDisplayIndex ? model.centerToDisplayIndex(i) : i,
  );
}

describe("buildRowPinningRenderModel", () => {
  it("active pins partition top/bottom/center correctly", () => {
    const build = createRowPinningRenderModelBuilder();
    const pinState: RowPinState = { r1: "top", r4: "bottom" };
    const model = build(readerFrom(rows), pinState, resolveRowId);

    expect(model.top).toEqual([
      { displayIndex: 0, rowId: "r1", row: rows[0] },
    ]);
    expect(model.bottom).toEqual([
      { displayIndex: 3, rowId: "r4", row: rows[3] },
    ]);
    expect(centerIndices(model)).toEqual([1, 2, 4]);
    expect(model.centerRowCount).toBe(3);
  });

  it("missing row ids do not render", () => {
    const build = createRowPinningRenderModelBuilder();
    const pinState: RowPinState = { nonexistent: "top", ghost: "bottom" };
    const model = build(readerFrom(rows), pinState, resolveRowId);

    expect(model.top).toEqual([]);
    expect(model.bottom).toEqual([]);
    // No pinned id resolved — center mapping is identity.
    expect(model.centerToDisplayIndex).toBeNull();
    expect(centerIndices(model)).toEqual([0, 1, 2, 3, 4]);
    expect(model.centerRowCount).toBe(5);
  });

  it("pinned rows are excluded from center body", () => {
    const build = createRowPinningRenderModelBuilder();
    const pinState: RowPinState = { r2: "top", r3: "top", r5: "bottom" };
    const model = build(readerFrom(rows), pinState, resolveRowId);

    const pinnedIds = [...model.top, ...model.bottom].map((e) => e.rowId);
    expect(model.centerToDisplayIndex).not.toBeNull();
    for (const idx of centerIndices(model)) {
      const row = rows[idx]!;
      const rowId = resolveRowId(row, idx);
      expect(pinnedIds).not.toContain(rowId);
    }
    expect(centerIndices(model)).toEqual([0, 3]);
    expect(model.centerRowCount).toBe(2);
  });

  it("empty row pin state does not call resolveRowId and uses identity mapping", () => {
    const build = createRowPinningRenderModelBuilder();
    const spy = vi.fn(resolveRowId);
    const pinState: RowPinState = {};
    const model = build(readerFrom(rows), pinState, spy);

    expect(spy).not.toHaveBeenCalled();
    expect(model.top).toEqual([]);
    expect(model.bottom).toEqual([]);
    // Identity sentinel — no per-row work in the no-pin fast path.
    expect(model.centerToDisplayIndex).toBeNull();
    expect(model.centerRowCount).toBe(rows.length);
  });

  it("cached call with same inputs does not rescan", () => {
    const build = createRowPinningRenderModelBuilder();
    const spy = vi.fn(resolveRowId);
    const pinState: RowPinState = { r1: "top" };
    const reader = readerFrom(rows);

    const model1 = build(reader, pinState, spy);
    const callCount = spy.mock.calls.length;

    const model2 = build(reader, pinState, spy);

    expect(model2).toBe(model1);
    expect(spy.mock.calls.length).toBe(callCount);
  });

  it("changed pin state invalidates cache", () => {
    const build = createRowPinningRenderModelBuilder();
    const pinState1: RowPinState = { r1: "top" };
    const pinState2: RowPinState = { r1: "bottom" };
    const reader = readerFrom(rows);

    const model1 = build(reader, pinState1, resolveRowId);
    const model2 = build(reader, pinState2, resolveRowId);

    expect(model2).not.toBe(model1);
    expect(model2.top).toEqual([]);
    expect(model2.bottom).toEqual([
      { displayIndex: 0, rowId: "r1", row: rows[0] },
    ]);
  });

  it("changed displayRows reference invalidates cache", () => {
    const build = createRowPinningRenderModelBuilder();
    const pinState: RowPinState = { r1: "top" };

    const model1 = build(readerFrom(rows), pinState, resolveRowId);
    const model2 = build(readerFrom(rows), pinState, resolveRowId);

    expect(model2).not.toBe(model1);
  });

  it("changed resolveRowId reference invalidates cache", () => {
    const build = createRowPinningRenderModelBuilder();
    const pinState: RowPinState = { r1: "top" };
    const reader = readerFrom(rows);

    const resolver1 = (row: RowData, i: number) => resolveRowId(row, i);
    const resolver2 = (row: RowData, i: number) => resolveRowId(row, i);

    const model1 = build(reader, pinState, resolver1);
    const model2 = build(reader, pinState, resolver2);

    expect(model2).not.toBe(model1);
  });

  it("multiple top pins preserve display order", () => {
    const build = createRowPinningRenderModelBuilder();
    const pinState: RowPinState = { r3: "top", r1: "top" };
    const model = build(readerFrom(rows), pinState, resolveRowId);

    expect(model.top.map((e) => e.rowId)).toEqual(["r1", "r3"]);
  });

  it("multiple bottom pins preserve display order", () => {
    const build = createRowPinningRenderModelBuilder();
    const pinState: RowPinState = { r5: "bottom", r2: "bottom" };
    const model = build(readerFrom(rows), pinState, resolveRowId);

    expect(model.bottom.map((e) => e.rowId)).toEqual(["r2", "r5"]);
  });

  it("empty pin state cache does not depend on resolveRowId reference", () => {
    const build = createRowPinningRenderModelBuilder();
    const pinState: RowPinState = {};
    const reader = readerFrom(rows);
    const resolver1 = (row: RowData, i: number) => resolveRowId(row, i);
    const resolver2 = (row: RowData, i: number) => resolveRowId(row, i);

    const model1 = build(reader, pinState, resolver1);
    const model2 = build(reader, pinState, resolver2);

    expect(model2).toBe(model1);
  });

  it("empty pin state cache invalidates when displayRows reference changes", () => {
    const build = createRowPinningRenderModelBuilder();
    const pinState: RowPinState = {};

    const model1 = build(readerFrom(rows), pinState, resolveRowId);
    const model2 = build(readerFrom(rows), pinState, resolveRowId);

    expect(model2).not.toBe(model1);
  });

  it("sorted RowView + pinned row: pinned lane follows sorted display order", () => {
    // Simulate sorted display order: r3, r1, r5, r2, r4
    const sortedRows: RowData[] = [rows[2]!, rows[0]!, rows[4]!, rows[1]!, rows[3]!];
    const build = createRowPinningRenderModelBuilder();
    const pinState: RowPinState = { r1: "top", r4: "bottom" };
    const model = build(readerFrom(sortedRows), pinState, resolveRowId);

    // r1 is at display index 1 in the sorted order
    expect(model.top).toEqual([
      { displayIndex: 1, rowId: "r1", row: rows[0] },
    ]);
    // r4 is at display index 4 in the sorted order
    expect(model.bottom).toEqual([
      { displayIndex: 4, rowId: "r4", row: rows[3] },
    ]);
    // Center should contain display indices 0, 2, 3
    expect(centerIndices(model)).toEqual([0, 2, 3]);
    expect(model.centerRowCount).toBe(3);
  });

  it("skips undefined rows from DisplayRowReader defensively", () => {
    // Create a reader that returns undefined for some display indices
    const build = createRowPinningRenderModelBuilder();
    const pinState: RowPinState = { r1: "top" };
    // Single-element array, so indices 1+ return undefined from getRowData
    const sparseReader = createArrayDisplayRowReader([rows[0]!]);
    // Patch rowCount to simulate a gap (reader says 3 rows but only 1 exists)
    const fakeReader = {
      ...sparseReader,
      get rowCount() { return 3; },
    };
    const model = build(fakeReader, pinState, resolveRowId);

    // r1 at index 0 is pinned top; indices 1 and 2 are undefined → the
    // defensive sparse path excludes them from the center entirely.
    expect(model.top).toEqual([
      { displayIndex: 0, rowId: "r1", row: rows[0] },
    ]);
    expect(model.centerRowCount).toBe(0);
    expect(centerIndices(model)).toEqual([]);
  });

  it("sparse reader: center contains only valid unpinned rows", () => {
    const build = createRowPinningRenderModelBuilder();
    // Reader with rows r1..r3 but claims 5 slots — indices 3, 4 invalid.
    const sparseReader = createArrayDisplayRowReader(rows.slice(0, 3));
    const fakeReader = {
      ...sparseReader,
      get rowCount() { return 5; },
    };
    const spy = vi.fn(resolveRowId);
    const model = build(fakeReader, { r2: "top" }, spy);

    expect(model.top.map((e) => e.rowId)).toEqual(["r2"]);
    expect(model.centerRowCount).toBe(2);
    expect(centerIndices(model)).toEqual([0, 2]);

    // Pin-state changes still reuse the cached index — no rescan.
    const calls = spy.mock.calls.length;
    const model2 = build(fakeReader, { r3: "bottom" }, spy);
    expect(spy.mock.calls.length).toBe(calls);
    expect(model2.bottom.map((e) => e.rowId)).toEqual(["r3"]);
    expect(centerIndices(model2)).toEqual([0, 1]);
  });

  // ── Scan-count guarantees ─────────────────────────────────────────────

  it("first active pin resolves row ids at most once per row", () => {
    const build = createRowPinningRenderModelBuilder();
    const spy = vi.fn(resolveRowId);
    const reader = readerFrom(rows);

    build(reader, { r1: "top" }, spy);

    expect(spy.mock.calls.length).toBe(rows.length);
  });

  it("changing pin state with same DisplayRowReader does not rescan rows", () => {
    const build = createRowPinningRenderModelBuilder();
    const spy = vi.fn(resolveRowId);
    const reader = readerFrom(rows);

    // First active pin builds the row id index — one full scan.
    const model1 = build(reader, { r1: "top" }, spy);
    expect(spy.mock.calls.length).toBe(rows.length);

    // Subsequent pin-state changes reuse the cached index: zero
    // additional resolveRowId calls, and the models are still correct.
    const model2 = build(reader, { r1: "top", r4: "bottom" }, spy);
    const model3 = build(reader, { r3: "top" }, spy);
    const model4 = build(reader, {}, spy);

    expect(spy.mock.calls.length).toBe(rows.length);

    expect(model1.top.map((e) => e.rowId)).toEqual(["r1"]);
    expect(model2.bottom.map((e) => e.rowId)).toEqual(["r4"]);
    expect(centerIndices(model2)).toEqual([1, 2, 4]);
    expect(model3.top.map((e) => e.rowId)).toEqual(["r3"]);
    expect(centerIndices(model3)).toEqual([0, 1, 3, 4]);
    expect(model4.centerToDisplayIndex).toBeNull();
    expect(model4.centerRowCount).toBe(rows.length);
  });

  it("new DisplayRowReader rebuilds the row id index", () => {
    const build = createRowPinningRenderModelBuilder();
    const spy = vi.fn(resolveRowId);

    build(readerFrom(rows), { r1: "top" }, spy);
    expect(spy.mock.calls.length).toBe(rows.length);

    // New reader (e.g. rows/sort changed) — index must rebuild.
    build(readerFrom(rows), { r1: "top" }, spy);
    expect(spy.mock.calls.length).toBe(rows.length * 2);
  });
});
