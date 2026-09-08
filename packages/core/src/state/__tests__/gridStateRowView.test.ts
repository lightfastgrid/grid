// Focused tests for RowView exposure on GridSnapshot.
//
// Verifies:
// - empty sort produces an identity RowView whose .rows is the raw rows
//   reference and whose source mapping is 1:1
// - active sort produces an indexed RowView that maps display index → source
//   index correctly
// - snapshot.data is always the raw source-rows reference (no materialization)
// - rowView reference is stable across snapshots when inputs are unchanged
// - rowView generation is stable when inputs are unchanged, and bumps when
//   they change
// - multi-column mixed asc/desc round-trips through RowView mapping
// - rowView always reflects the SOURCE rows

import { describe, expect, it } from "vitest";

import { createRowPinningRenderModelBuilder } from "../../features/row-pinning";
import { createDisplayRowReader } from "../../rendering/rowViewAccess";
import type { LightFastGridColDef, RowData } from "../../types";
import { GridState } from "../GridState";

const cols: LightFastGridColDef[] = [
  { field: "score", sortable: true },
  { field: "name", sortable: true },
];

function makeRows(): RowData[] {
  return [
    { id: "r0", score: 3, name: "alice" },
    { id: "r1", score: 1, name: "bob" },
    { id: "r2", score: 2, name: "alice" },
    { id: "r3", score: 2, name: "bob" },
  ];
}

describe("GridSnapshot.rowView", () => {
  it("empty sort: identity RowView preserves raw rows reference", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    const snap = state.getSnapshot();

    expect(snap.rowView.rows).toBe(rows);
    expect(snap.rowView.rowCount).toBe(rows.length);
    expect(snap.rowView.getSourceIndex(0)).toBe(0);
    expect(snap.rowView.getSourceIndex(3)).toBe(3);
    expect(snap.rowView.getRow(0)).toBe(rows[0]);
    expect(snap.rowView.getRow(2)).toBe(rows[2]);

    // Compatibility `data` must also be the raw rows reference for identity.
    expect(snap.data).toBe(rows);
  });

  it("active sort: indexed RowView maps display → source correctly", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const snap = state.getSnapshot();

    // Sort asc by score: r1(1), r2(2), r3(2), r0(3).
    expect(snap.rowView.rowCount).toBe(4);
    expect(snap.rowView.getSourceIndex(0)).toBe(1);
    expect(snap.rowView.getSourceIndex(1)).toBe(2);
    expect(snap.rowView.getSourceIndex(2)).toBe(3);
    expect(snap.rowView.getSourceIndex(3)).toBe(0);

    // .getRow walks through the source rows array.
    expect(snap.rowView.getRow(0)).toBe(rows[1]);
    expect(snap.rowView.getRow(3)).toBe(rows[0]);

    // rowView.rows is the SOURCE rows reference.
    expect(snap.rowView.rows).toBe(rows);

    // snapshot.data is the raw source-rows reference (no materialization).
    expect(snap.data).toBe(rows);
  });

  it("rowView reference and generation are stable across snapshots when unchanged", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);

    const first = state.getSnapshot().rowView;
    const second = state.getSnapshot().rowView;
    expect(second).toBe(first);
    expect(second.generation).toBe(first.generation);
  });

  it("rowView generation bumps when sort model changes", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const asc = state.getSnapshot().rowView;

    state.setSortModel([{ field: "score", sort: "desc" }]);
    const desc = state.getSnapshot().rowView;

    expect(desc).not.toBe(asc);
    expect(desc.generation).toBeGreaterThan(asc.generation);

    // Mapping reflects the new order: desc → r0(3), r2(2), r3(2), r1(1).
    expect(desc.getSourceIndex(0)).toBe(0);
    expect(desc.getSourceIndex(3)).toBe(1);
  });

  it("rowView generation bumps when source rows change", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    const before = state.getSnapshot().rowView;

    state.setRows([{ id: "x", score: 9 }]);
    const after = state.getSnapshot().rowView;

    expect(after).not.toBe(before);
    expect(after.generation).toBeGreaterThan(before.generation);
    expect(after.rowCount).toBe(1);
    expect(after.getRow(0)).toEqual({ id: "x", score: 9 });
  });

  it("multi-column mixed asc/desc maps through RowView correctly", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([
      { field: "name", sort: "asc" },
      { field: "score", sort: "desc" },
    ]);
    const snap = state.getSnapshot();

    // alice:3 (r0), alice:2 (r2), bob:2 (r3), bob:1 (r1)
    expect(snap.rowView.getSourceIndex(0)).toBe(0);
    expect(snap.rowView.getSourceIndex(1)).toBe(2);
    expect(snap.rowView.getSourceIndex(2)).toBe(3);
    expect(snap.rowView.getSourceIndex(3)).toBe(1);

    // Display order via RowView: alice:3, alice:2, bob:2, bob:1
    const reader = createDisplayRowReader(snap.rowView);
    expect(
      Array.from({ length: reader.rowCount }, (_, i) => {
        const r = reader.getRowData(i)!;
        return `${r.name}:${r.score}`;
      }),
    ).toEqual(["alice:3", "alice:2", "bob:2", "bob:1"]);

    // snapshot.data is always the source rows reference.
    expect(snap.data).toBe(rows);
  });

  it("out-of-range queries return -1 / undefined on RowView", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const view = state.getSnapshot().rowView;

    expect(view.getSourceIndex(-1)).toBe(-1);
    expect(view.getSourceIndex(view.rowCount)).toBe(-1);
    expect(view.getRow(-1)).toBeUndefined();
    expect(view.getRow(view.rowCount)).toBeUndefined();
  });

  it("rowView is stable across unrelated state changes (selection, drag, widths)", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const before = state.getSnapshot().rowView;

    state.setRowSelection({ mode: "single" });
    state.setColumnSelection({ mode: "single" });
    state.setRowDrag({ enabled: true });
    state.setColumnWidth("score", 220);

    const after = state.getSnapshot().rowView;
    expect(after).toBe(before);
    expect(after.generation).toBe(before.generation);
  });

  // ── No-sort identity stability ──────────────────────────────────────

  it("no-sort: rowView reference is stable across repeated snapshots", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    const first = state.getSnapshot().rowView;
    const second = state.getSnapshot().rowView;
    const third = state.getSnapshot().rowView;
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("no-sort: rowView generation stays stable across unrelated state changes", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    const before = state.getSnapshot().rowView;

    state.setRowSelection({ mode: "single" });
    state.setColumnSelection({ mode: "single" });
    state.setRowDrag({ enabled: true });
    state.setColumnWidth("score", 220);

    const after = state.getSnapshot().rowView;
    expect(after).toBe(before);
    expect(after.generation).toBe(before.generation);
  });

  it("no-sort: rowView bumps when setRows() gets a new rows reference", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    const before = state.getSnapshot().rowView;

    const newRows = [{ id: "x", score: 42, name: "new" }];
    state.setRows(newRows);
    const after = state.getSnapshot().rowView;

    expect(after).not.toBe(before);
    expect(after.generation).toBeGreaterThan(before.generation);
    expect(after.rows).toBe(newRows);
    expect(after.rowCount).toBe(1);
  });

  // ── snapshot.data is the raw source-rows reference ──

  it("sorted snapshot.data is always the raw source-rows reference", () => {
    const rows = makeRows();
    const state = new GridState({ columns: cols, rows });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const snap = state.getSnapshot();

    // snapshot.data is the raw source rows, not display order.
    expect(snap.data).toBe(rows);
    expect(snap.data.map((r) => r.id)).toEqual(["r0", "r1", "r2", "r3"]);

    // Display order is available via rowView / DisplayRowReader.
    const reader = createDisplayRowReader(snap.rowView);
    expect(
      Array.from({ length: reader.rowCount }, (_, i) => reader.getRowData(i)!.id),
    ).toEqual(["r1", "r2", "r3", "r0"]);
  });

  it("row pinning render model partitions sorted RowView into pinned and center rows", () => {
    const rows = makeRows();
    const state = new GridState({
      columns: cols,
      rows,
      rowPinning: { top: ["r1"], bottom: ["r0"] },
    });
    state.setSortModel([{ field: "score", sort: "asc" }]);
    const snap = state.getSnapshot();

    // snap.data is the raw source rows reference.
    expect(snap.data).toBe(rows);

    // Feed sorted snapshot into the render model builder via DisplayRowReader
    // — this is exactly what the renderer does to partition pinned rows.
    const buildModel = createRowPinningRenderModelBuilder();
    const resolveRowId = (row: RowData) => String(row.id);
    const reader = createDisplayRowReader(snap.rowView);
    const model = buildModel(reader, snap.rowPinState!, resolveRowId);

    // Top-pinned r1 appears at sorted display index 0.
    expect(model.top).toEqual([
      { displayIndex: 0, rowId: "r1", row: rows[1] },
    ]);
    // Bottom-pinned r0 appears at sorted display index 3.
    expect(model.bottom).toEqual([
      { displayIndex: 3, rowId: "r0", row: rows[0] },
    ]);
    // Center contains the remaining rows in sorted order.
    expect(model.centerRowCount).toBe(2);
    expect(
      Array.from({ length: model.centerRowCount }, (_, i) =>
        model.centerToDisplayIndex!(i),
      ),
    ).toEqual([1, 2]);
  });

  // ── No-rows stability ──────────────────────────────────────────────

  it("no rows prop: rowView is stable across repeated snapshots", () => {
    const state = new GridState({ columns: cols });
    const first = state.getSnapshot().rowView;
    const second = state.getSnapshot().rowView;
    expect(second).toBe(first);
    expect(second.generation).toBe(first.generation);
    expect(first.rowCount).toBe(0);
  });
});
