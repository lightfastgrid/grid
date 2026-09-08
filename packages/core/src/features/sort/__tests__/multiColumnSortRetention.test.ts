// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import { createDisplayRowReader } from "../../../rendering/rowViewAccess";
import { GridState } from "../../../state/GridState";
import type { GridSnapshot, RowData } from "../../../types";

function displayRows(snap: GridSnapshot): RowData[] {
  const reader = createDisplayRowReader(snap.rowView);
  return Array.from({ length: reader.rowCount }, (_, i) => reader.getRowData(i)!);
}

describe("multi-column sort retention", () => {
  it("GridState keeps and applies two sort fields with ties", () => {
    const rows = [
      { status: "Active", bankBalance: 10 },
      { status: "Active", bankBalance: 30 },
      { status: "Pending", bankBalance: 20 },
      { status: "Active", bankBalance: 5 },
    ];
    const state = new GridState({
      rows,
      columns: [
        { field: "status", sortable: true },
        { field: "bankBalance", sortable: true },
      ],
      defaultColDef: { sortable: true },
    });

    const changed = state.setSortModel([
      { field: "status", sort: "asc" },
      { field: "bankBalance", sort: "desc" },
    ]);
    expect(changed).toBe(true);
    expect(state.getSortModel()).toEqual([
      { field: "status", sort: "asc" },
      { field: "bankBalance", sort: "desc" },
    ]);

    const ordered = displayRows(state.getSnapshot()).map((r) => r.bankBalance);
    expect(ordered).toEqual([30, 10, 5, 20]);
  });

  it("panel-style append keeps both fields with demo chrome flags", () => {
    const grid = new Grid({
      rows: [
        { id: "1", status: "Active", bankBalance: 10 },
        { id: "2", status: "Active", bankBalance: 30 },
        { id: "3", status: "Pending", bankBalance: 20 },
        { id: "4", status: "Active", bankBalance: 5 },
      ],
      columns: [
        { field: "status", sortable: true },
        { field: "bankBalance", sortable: true },
      ],
      getRowId: (r) => String((r as { id: string }).id),
      defaultColDef: { sortable: true },
      columnSelection: {
        mode: "multiple",
        enableHeaderClickSelection: true,
      },
      rowDrag: { enabled: true, managed: true },
    });

    grid.setSortModel([{ field: "status", sort: "asc" }]);
    const current = grid.getSortModel().map((entry) => ({ ...entry }));
    grid.setSortModel([...current, { field: "bankBalance", sort: "desc" }]);
    expect(grid.getSortModel()).toEqual([
      { field: "status", sort: "asc" },
      { field: "bankBalance", sort: "desc" },
    ]);
    grid.destroy();
  });
});
