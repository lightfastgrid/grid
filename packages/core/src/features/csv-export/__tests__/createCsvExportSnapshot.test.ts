import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { RowIdentityService } from "../../../identity/RowIdentityService";
import {
  captureExplicitRowSelection,
  captureIdMembership,
} from "../../../internal/readSnapshots";
import { createIndexedRowOrder } from "../../../row-model/rowOrder";
import { GridState } from "../../../state/GridState";
import type { RowData } from "../../../types";
import { buildColumnPinningLayout } from "../../column-pinning/columnPinningLayout";
import { SelectionStore } from "../../selection/SelectionStore";
import { createCsvExportSnapshot } from "../createCsvExportSnapshot";
import { normalizeCsvExportOptions } from "../normalizeCsvExportOptions";
import { planCsvColumnScope } from "../planCsvColumnScope";
import { planCsvRowScope } from "../planCsvRowScope";
import { resolveCsvCellValue } from "../resolveCsvCellValue";

const PIN_OPTIONS = {
  includePinnedTopRows: true,
  includePinnedBottomRows: true,
};

function sourceIndexes(view: {
  rowCount: number;
  getSourceIndex(displayIndex: number): number;
}): number[] {
  const indexes: number[] = [];
  for (let i = 0; i < view.rowCount; i++) {
    indexes.push(view.getSourceIndex(i));
  }
  return indexes;
}

function assemble(
  state: GridState,
  resolveRowId: (row: RowData, sourceIndex: number) => string,
) {
  const read = state.captureReadSnapshot();
  return createCsvExportSnapshot({
    state: read,
    capabilities: {
      captureLogicalColumnLayoutSnapshot: (input) => ({
        visibleColumns: buildColumnPinningLayout(input.visibleUserColumns).ordered,
        allLeafColumns: input.allUserLeafColumns,
      }),
      captureRowSelectionSnapshot: (universeRowCount) =>
        captureExplicitRowSelection(new Set(), universeRowCount),
      captureColumnSelectionSnapshot: () =>
        captureIdMembership(new Set<string>()),
    },
    resolveRowId,
  });
}

describe("createCsvExportSnapshot", () => {
  it("retains real public CSV column defaults and overrides through projection", () => {
    const state = new GridState({
      rows: [{ raw: "raw", inheritedCsv: "hidden", projectedCsv: "shown" }],
      columns: [
        { field: "inherited" },
        {
          field: "projected",
          exportable: true,
          exportValueField: "projectedCsv",
        },
      ],
      defaultColDef: {
        exportable: false,
        exportValueField: "inheritedCsv",
      },
    });
    const snapshot = assemble(state, (_row, index) => `row-${index}`);
    const planned = planCsvColumnScope(
      snapshot,
      { mode: "all" },
      normalizeCsvExportOptions({}),
    );

    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ kind: "data", field: "projected" });
    const projected = planned[0];
    if (projected?.kind !== "data") throw new Error("expected data column");
    expect(
      resolveCsvCellValue({
        plannedColumn: projected,
        row: snapshot.sourceRows[0]!,
        rowId: "row-0",
        rowIndex: 0,
        sourceRowIndex: 0,
        useValueFormatter: true,
      }),
    ).toBe("shown");
  });

  it("assembles stable source, column, selection, and row-pin references", () => {
    const rows: RowData[] = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ];
    const state = new GridState({
      rows,
      columns: [
        { field: "value", pinned: "right" },
        { field: "id", pinned: "left" },
        { field: "hidden", visible: false },
      ],
      rowPinning: { top: ["a"] },
      columnGroupHeaders: true,
    });
    // Make RowStore owned before capture; the next update must still detach.
    state.replaceRowAtSourceIndex(0, { id: "a", value: 10 }, () => "a");

    const rowSelection = captureExplicitRowSelection(new Set(["a"]), 2);
    const columnSelection = captureIdMembership(new Set(["value"]));
    const read = state.captureReadSnapshot();
    const snapshot = createCsvExportSnapshot({
      state: read,
      capabilities: {
        captureLogicalColumnLayoutSnapshot: (input) => ({
          visibleColumns: buildColumnPinningLayout(input.visibleUserColumns).ordered,
          allLeafColumns: input.allUserLeafColumns,
        }),
        captureRowSelectionSnapshot: () => rowSelection,
        captureColumnSelectionSnapshot: () => columnSelection,
      },
      resolveRowId: (row) => String(row.id),
    });

    expect(snapshot.visibleColumns.map((column) => column.field)).toEqual([
      "id",
      "value",
    ]);
    expect(snapshot.allLeafColumns.map((column) => column.field)).toEqual([
      "value",
      "id",
      "hidden",
    ]);
    expect(snapshot.rowPinState.get("a")).toBe("top");

    state.replaceRowAtSourceIndex(0, { id: "a", value: 20 }, () => "a");
    state.pinRow("a", "bottom");
    state.setColumnPinned("value", false);
    state.setColumnVisible("hidden", true);
    state.setColumns([
      { field: "hidden" },
      { field: "value" },
      { field: "id" },
    ]);

    expect(snapshot.sourceRows[0]).toEqual({ id: "a", value: 10 });
    expect(snapshot.pageView.rows).toBe(snapshot.sourceRows);
    expect(snapshot.rowPinState.get("a")).toBe("top");
    expect(snapshot.visibleColumns.map((column) => column.field)).toEqual([
      "id",
      "value",
    ]);
    expect(snapshot.selectedRowIds.has("a")).toBe(true);
    expect(snapshot.selectedColumnIds.has("value")).toBe(true);
  });

  it("plans all-minus-excluded selection from captured membership", () => {
    const rows: RowData[] = [
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "d" },
    ];
    const state = new GridState({ rows, columns: [{ field: "id" }] });
    const selection = new SelectionStore("multiple");
    selection.selectAll(rows.length);
    selection.toggle("b", rows.length);
    const read = state.captureReadSnapshot();
    const snapshot = createCsvExportSnapshot({
      state: read,
      capabilities: {
        captureLogicalColumnLayoutSnapshot: (input) => ({
          visibleColumns: input.visibleUserColumns,
          allLeafColumns: input.allUserLeafColumns,
        }),
        captureRowSelectionSnapshot: (universeRowCount) =>
          selection.captureReadSnapshot(universeRowCount),
        captureColumnSelectionSnapshot: () =>
          captureIdMembership(new Set<string>()),
      },
      resolveRowId: (row) => String(row.id),
    });
    const plan = planCsvRowScope(
      snapshot,
      { mode: "selected" },
      PIN_OPTIONS,
    );
    const output: number[] = [];
    let complete = false;
    while (!complete) complete = plan.step(output, 1);

    expect(snapshot.selectedRowIds).toMatchObject({
      model: "allMinusExcluded",
      universeRowCount: 4,
      definitelyEmpty: false,
    });
    expect(output).toEqual([0, 2, 3]);
  });

  it("uses the captured full-view universe for all-minus-excluded planning", () => {
    const rows: RowData[] = [
      { id: "old-a" },
      { id: "old-b" },
      { id: "new-c" },
    ];
    const state = new GridState({
      rows,
      columns: [{ field: "id", filter: "text" }],
    });
    state.setFilterModel({
      id: {
        type: "text",
        operator: "and",
        conditions: [{ operator: "contains", value: "new" }],
      },
    });
    state.applyFilteredRowOrder(
      createIndexedRowOrder(Uint32Array.from([2])),
    );
    const selection = new SelectionStore("multiple");
    selection.selectAll(2);
    selection.toggle("old-a", 2);
    selection.toggle("old-b", 2);
    const read = state.captureReadSnapshot();
    expect(read.fullView.rowCount).toBe(1);
    expect(read.fullView.getSourceIndex(0)).toBe(2);
    const captureRowSelectionSnapshot = vi.fn((universeRowCount: number) =>
      selection.captureReadSnapshot(universeRowCount),
    );
    const snapshot = createCsvExportSnapshot({
      state: read,
      capabilities: {
        captureLogicalColumnLayoutSnapshot: (input) => ({
          visibleColumns: input.visibleUserColumns,
          allLeafColumns: input.allUserLeafColumns,
        }),
        captureRowSelectionSnapshot,
        captureColumnSelectionSnapshot: () =>
          captureIdMembership(new Set<string>()),
      },
      resolveRowId: (row) => String(row.id),
    });
    const plan = planCsvRowScope(
      snapshot,
      { mode: "selected" },
      PIN_OPTIONS,
    );
    const output: number[] = [];
    let complete = false;
    while (!complete) complete = plan.step(output, 1);

    expect(snapshot.selectedRowIds).toMatchObject({
      model: "allMinusExcluded",
      universeRowCount: 1,
      definitelyEmpty: false,
    });
    expect(captureRowSelectionSnapshot).toHaveBeenCalledTimes(1);
    expect(captureRowSelectionSnapshot).toHaveBeenCalledWith(
      read.fullView.rowCount,
    );
    expect(output).toEqual([2]);
  });

  it("performs zero row-ID resolution at capture and preserves explicit identity", () => {
    const rows: RowData[] = [{ id: "explicit-a", value: 1 }];
    const state = new GridState({ rows, columns: [{ field: "value" }] });
    const identity = new RowIdentityService();
    const getRowId = vi.fn((row: RowData) => row.id);
    const resolve = vi.fn((row: RowData, index: number) =>
      identity.resolve(row, index, getRowId),
    );

    const snapshot = assemble(state, resolve);
    expect(resolve).not.toHaveBeenCalled();
    expect(getRowId).not.toHaveBeenCalled();

    expect(snapshot.rowIds.getRowIdBySourceIndex(0)).toBe("explicit-a");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(getRowId).toHaveBeenCalledTimes(1);
  });

  it("keeps row-pin snapshots stable across every mutation family", () => {
    const makeState = (): GridState =>
      new GridState({
        rows: [],
        columns: [],
        rowPinning: { top: ["a"], bottom: ["b"] },
      });
    const assertStable = (mutate: (state: GridState) => void): void => {
      const state = makeState();
      const captured = state.captureRowPinReadSnapshot();
      mutate(state);
      expect(captured.size).toBe(2);
      expect(captured.get("a")).toBe("top");
      expect(captured.get("b")).toBe("bottom");
    };

    assertStable((state) => void state.pinRow("a", "bottom"));
    assertStable((state) => void state.pinRows(["a", "c"], "bottom"));
    assertStable((state) => void state.unpinRows(["a", "b"]));
    assertStable((state) =>
      void state.setRowPinState([{ rowId: "c", pinned: "top" }]),
    );
    assertStable((state) => void state.clearRowPinning());
  });

  it("keeps WeakMap fallback identity bound to the captured row reference", () => {
    const original: RowData = { value: "original" };
    const state = new GridState({
      rows: [original],
      columns: [{ field: "value" }],
    });
    const identity = new RowIdentityService();
    const snapshot = assemble(state, (row, index) =>
      identity.resolve(row, index),
    );
    const before = snapshot.rowIds.getRowIdBySourceIndex(0);

    state.replaceRowAtSourceIndex(0, { value: "replacement" }, () => null);

    expect(snapshot.sourceRows[0]).toBe(original);
    expect(snapshot.rowIds.getRowIdBySourceIndex(0)).toBe(before);
    expect(identity.resolve(state.getRows()[0], 0)).not.toBe(before);
  });

  it("resolves a near-end explicit ID only through bounded row-plan steps", () => {
    const rows = Array.from({ length: 1_000 }, (_, index) => ({
      id: `row-${index}`,
    }));
    const state = new GridState({ rows, columns: [{ field: "id" }] });
    const resolve = vi.fn((row: RowData) => String(row.id));
    const snapshot = assemble(state, resolve);
    const plan = planCsvRowScope(
      snapshot,
      { mode: "ids", ids: ["row-999"] },
      PIN_OPTIONS,
    );
    const output: number[] = [];

    expect(resolve).not.toHaveBeenCalled();
    expect(plan.step(output, 1)).toBe(false); // requested-ID dedup phase
    expect(resolve).not.toHaveBeenCalled();
    for (let i = 0; i < 10; i++) plan.step(output, 1);
    expect(resolve).toHaveBeenCalledTimes(10);
    expect(output).toEqual([]);

    let complete = false;
    while (!complete) complete = plan.step(output, 17);
    expect(output).toEqual([999]);
    expect(resolve).toHaveBeenCalledTimes(1_000);
  });

  it("captures pending filter, quick-search, and sort fallback RowViews", () => {
    const rows: RowData[] = [
      { name: "Charlie" },
      { name: "Alice" },
      { name: "Bob" },
      { name: "Diana" },
    ];

    const filterState = new GridState({
      rows,
      columns: [{ field: "name", filter: "text" }],
    });
    filterState.setFilterModel({
      name: {
        type: "text",
        operator: "and",
        conditions: [{ operator: "contains", value: "a" }],
      },
    });
    filterState.markFilterPending();
    filterState.applyFilteredRowOrder(
      createIndexedRowOrder(Uint32Array.from([0, 1, 3])),
    );
    filterState.getSnapshot();
    filterState.setFilterModel({
      name: {
        type: "text",
        operator: "and",
        conditions: [{ operator: "contains", value: "li" }],
      },
    });
    filterState.markFilterPending();
    expect(
      sourceIndexes(filterState.captureReadSnapshot().fullView),
    ).toEqual([0, 1, 3]);

    const quickState = new GridState({
      rows,
      columns: [{ field: "name" }],
      quickFilterText: "a",
    });
    quickState.markQuickSearchPending();
    quickState.applyQuickSearchRowOrder(
      createIndexedRowOrder(Uint32Array.from([0, 1, 3])),
    );
    quickState.getSnapshot();
    quickState.setQuickFilterText("bob");
    quickState.markQuickSearchPending();
    expect(sourceIndexes(quickState.captureReadSnapshot().fullView)).toEqual([
      0,
      1,
      3,
    ]);

    const sortState = new GridState({
      rows,
      columns: [{ field: "name", sortable: true }],
      initialSortModel: [{ field: "name", sort: "asc" }],
    });
    expect(sourceIndexes(sortState.getSnapshot().rowView)).toEqual([1, 2, 0, 3]);
    sortState.setSortModel([{ field: "name", sort: "desc" }]);
    sortState.markSortPending();
    expect(sourceIndexes(sortState.captureReadSnapshot().fullView)).toEqual([
      1,
      2,
      0,
      3,
    ]);
  });

  it("keeps neutral and renderer snapshot plumbing free of CSV dependencies and hot paths", () => {
    const files = [
      new URL(
        "../../../internal/columnLayoutReadSnapshot.ts",
        import.meta.url,
      ),
      new URL("../../../internal/readSnapshots.ts", import.meta.url),
      new URL("../../column-order/ColumnOrderStore.ts", import.meta.url),
      new URL("../../column-order/columnOrderFeature.ts", import.meta.url),
      new URL("../../selection/SelectionStore.ts", import.meta.url),
      new URL(
        "../../column-selection/ColumnSelectionController.ts",
        import.meta.url,
      ),
      new URL("../../../rendering/dom/DomFeatureHost.ts", import.meta.url),
      new URL("../../../rendering/DomGridRenderer.ts", import.meta.url),
      new URL("../../../state/GridState.ts", import.meta.url),
    ];
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(
        /from ["'][^"']*csv-export|import\([^)]*csv-export/u,
      );
    }

    const renderer = readFileSync(
      new URL("../../../rendering/DomGridRenderer.ts", import.meta.url),
      "utf8",
    );
    const scrollPath = renderer.slice(
      renderer.indexOf("private readonly onViewportScroll"),
      renderer.indexOf("constructor(options"),
    );
    expect(scrollPath).not.toMatch(/capture(Logical|Row|Column|Read)/u);

    const virtualWindow = readFileSync(
      new URL(
        "../../../rendering/ring-buffer/VirtualWindowSync.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(virtualWindow).not.toMatch(
      /capture(Logical|Row|Column|Read).*Snapshot/u,
    );

    const adapter = readFileSync(
      new URL("../createCsvExportSnapshot.ts", import.meta.url),
      "utf8",
    );
    expect(adapter).not.toMatch(
      /sourceRows\.(map|forEach|reduce)|new (Array|Map).*sourceRows/u,
    );
  });
});
