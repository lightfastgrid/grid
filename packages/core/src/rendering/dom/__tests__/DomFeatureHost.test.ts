// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { columnOrderFeature } from "../../../features/column-order/columnOrderFeature";
import { columnSelectionFeature } from "../../../features/column-selection/columnSelectionFeature";
import {
  makeSnapshot,
  membership,
} from "../../../features/csv-export/__tests__/support";
import { normalizeCsvExportOptions } from "../../../features/csv-export/normalizeCsvExportOptions";
import { planCsvColumnScope } from "../../../features/csv-export/planCsvColumnScope";
import { rowControlsFeature } from "../../../features/row-controls/rowControlsFeature";
import { selectionFeature } from "../../../features/selection/selectionFeature";
import type {
  DomGridFeature,
  ExactFocusBindingCapability,
  FocusCapability,
  SelectionCapability,
} from "../../../features/types";
import type { PooledRow } from "../../../internal/poolTypes";
import { captureAllMinusExcludedRowSelection } from "../../../internal/readSnapshots";
import { SELECTION_COLUMN_FIELD } from "../../../internal/selectionColumn";
import type { DomFeatureHostDeps } from "../../../rendering/dom/DomFeatureHost";
import { DomFeatureHost } from "../../../rendering/dom/DomFeatureHost";
import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import type { ColumnDef } from "../../../types";
import { normalizeColumnOrder } from "../../../utils/columnOrderConfig";
import { normalizeColumnSelection } from "../../../utils/columnSelectionConfig";
import { normalizeRowDrag } from "../../../utils/rowDragConfig";
import { normalizeRowSelection } from "../../../utils/rowSelectionConfig";

function minimalDeps(
  rowSelection = normalizeRowSelection({
    mode: "multiple",
    checkboxes: true,
    headerCheckbox: true,
  }),
): DomFeatureHostDeps {
  return {
    getPool: () => [],
    getColumns: () => [],
    getDisplayRows: () => createArrayDisplayRowReader([]),
    getSourceRows: () => [],
    getVisibleRowStart: () => 0,
    getColumnOrderConfig: () => normalizeColumnOrder(undefined),
    getRowDragConfig: () => normalizeRowDrag(undefined),
    getRowSelectionConfig: () => rowSelection,
    resolveRowId: () => "x",
    getHeaderRowEl: () => null,
    getPinnedHeaderRowEl: () => null,
    getPinnedRightHeaderRowEl: () => null,
    getDataRevision: () => 0,
    requestSync: () => {},
    requestColumnTransformSync: () => {},
    commitResize: vi.fn(),
    notifySelectionChanged: vi.fn(),
    getColumnSelectionConfig: () => normalizeColumnSelection(undefined),
    notifyColumnSelectionChanged: vi.fn(),
    notifyColumnOrderChanged: vi.fn(),
    syncColumnSelectionClasses: () => {},
    getSortModel: () => [],
    isSortPending: () => false,
    toggleColumnSort: () => {},
    setColumnSort: () => {},
    pinColumn: () => {},
  };
}

describe("DomFeatureHost", () => {
  it("runs exact focus binding validation after focused-cell visual sync", () => {
    const calls: string[] = [];
    const feature: DomGridFeature &
      FocusCapability &
      ExactFocusBindingCapability = {
      name: "focus-binding",
      attach: (ctx) => {
        ctx.setExactFocusBindingActive?.(true);
      },
      detach: () => {},
      getFocusedCell: () => null,
      setFocusedCell: () => {},
      clearFocusedCell: () => {},
      moveFocusedCell: () => false,
      setFocusedCellAtDisplayIndex: () => false,
      syncFocusState: () => {
        calls.push("focused-cell");
      },
      syncExactFocusBinding: () => {
        calls.push("exact-binding");
      },
    };
    const host = new DomFeatureHost({
      ...minimalDeps(),
      featuresOverride: [feature],
    });
    host.attach(
      document.createElement("div"),
      document.createElement("div"),
      document.createElement("div"),
    );

    host.syncFocusState();

    expect(calls).toEqual(["focused-cell", "exact-binding"]);
  });

  it("forwards row-pinned logical lane identities without projection", () => {
    const makeRow = (): PooledRow => ({
      element: document.createElement("div"),
      cells: [],
      rowIndex: 0,
      rowVersion: 0,
      rowId: "r0",
    });
    const center = makeRow();
    const left = makeRow();
    const right = makeRow();
    const observed: (PooledRow | null)[] = [];
    const feature: DomGridFeature = {
      name: "logical-row-observer",
      attach: (ctx) => {
        ctx.forEachRowPinnedLogicalPoolRow?.(
          (observedCenter, observedLeft, observedRight) => {
            observed.push(observedCenter, observedLeft, observedRight);
          },
        );
      },
      detach: () => {},
    };
    const host = new DomFeatureHost({
      ...minimalDeps(),
      featuresOverride: [feature],
      forEachRowPinnedLogicalPoolRow: (visit) =>
        visit(center, left, right),
    });

    host.attach(
      document.createElement("div"),
      document.createElement("div"),
      document.createElement("div"),
    );

    expect(observed).toEqual([center, left, right]);
  });

  it("augments columns with selection column when checkboxes are on", () => {
    const host = new DomFeatureHost(minimalDeps());
    const user: ColumnDef[] = [{ field: "name", headerName: "Name" }];
    const copy = [...user];
    const out = host.transformColumns(user);

    expect(out).not.toBe(user);
    expect(out[0]?.field).toBe("__lfg_selection__");
    expect(out[1]).toBe(user[0]);
    expect(out[1]?.field).toBe("name");
    expect(user).toEqual(copy);
  });

  it("places the row-drag column before the selection column when both are enabled", () => {
    const host = new DomFeatureHost({
      ...minimalDeps(),
      getRowDragConfig: () => normalizeRowDrag({ enabled: true }),
    });
    const user: ColumnDef[] = [{ field: "name" }];
    const out = host.transformColumns(user);
    expect(out.map((column) => column.field)).toEqual([
      "__lfg_row_drag__",
      SELECTION_COLUMN_FIELD,
      "name",
    ]);
    expect(out[2]).toBe(user[0]);
  });

  it("combines left-pinned checkboxes and row drag into one row-controls column", () => {
    const host = new DomFeatureHost({
      ...minimalDeps(
        normalizeRowSelection({
          mode: "multiple",
          checkboxes: true,
          checkboxColumn: { pinned: "left" },
        }),
      ),
      getRowDragConfig: () => normalizeRowDrag({ enabled: true }),
    });
    const user: ColumnDef[] = [{ field: "name" }];
    const out = host.transformColumns(user);
    expect(out.map((column) => column.field)).toEqual([
      "__lfg_row_controls__",
      "name",
    ]);
    expect(out[1]).toBe(user[0]);
  });

  it("does not duplicate selection column if already present", () => {
    const host = new DomFeatureHost(minimalDeps());
    const withSel: ColumnDef[] = [
      { field: "__lfg_selection__", internal: "selection" },
      { field: "a" },
    ];
    const out = host.transformColumns(withSel);
    expect(out.filter((c) => c.field === "__lfg_selection__")).toHaveLength(1);
  });

  it("captures runtime column order, pinned lanes, and applicable internal columns", () => {
    let selection = normalizeRowSelection({
      mode: "multiple",
      checkboxes: true,
    });
    const orderConfig = normalizeColumnOrder({ enabled: true });
    const orderFeature = columnOrderFeature({
      getColumnOrderConfig: () => orderConfig,
    });
    const host = new DomFeatureHost({
      ...minimalDeps(selection),
      getColumnOrderConfig: () => orderConfig,
      featuresOverride: [
        orderFeature,
        rowControlsFeature({
          getRowSelectionConfig: () => selection,
          getRowDragConfig: () => normalizeRowDrag(undefined),
        }),
        selectionFeature({ getConfig: () => selection }),
      ],
    });
    const allUserLeafColumns: ColumnDef[] = [
      { field: "center-a" },
      { field: "right", pinned: "right" },
      { field: "left", pinned: "left" },
      { field: "center-b" },
      { field: "hidden", visible: false },
    ];
    const visibleUserColumns = allUserLeafColumns.filter(
      (column) => column.visible !== false,
    );
    orderFeature.columnOrderStore.syncColumns(allUserLeafColumns);
    orderFeature.columnOrderStore.move("center-b", 0, allUserLeafColumns);

    const captured = host.captureLogicalColumnLayoutSnapshot({
      visibleUserColumns,
      allUserLeafColumns,
    });

    expect(captured.visibleColumns.map((column) => column.field)).toEqual([
      "left",
      SELECTION_COLUMN_FIELD,
      "center-b",
      "center-a",
      "right",
    ]);
    expect(captured.allLeafColumns.map((column) => column.field)).toEqual([
      SELECTION_COLUMN_FIELD,
      "center-a",
      "right",
      "left",
      "center-b",
      "hidden",
    ]);
    const csvSnapshot = makeSnapshot({
      visibleColumns: captured.visibleColumns,
      allLeafColumns: captured.allLeafColumns,
      selectedColumnIds: membership(["center-a", "center-b"]),
    });
    const selectedPlan = planCsvColumnScope(
      csvSnapshot,
      { mode: "selected" },
      normalizeCsvExportOptions({}),
    );
    expect(
      selectedPlan.map((column) =>
        column.kind === "data" ? column.field : "#row",
      ),
    ).toEqual(["center-b", "center-a"]);
    const defaultVisible = planCsvColumnScope(
      csvSnapshot,
      { mode: "visible" },
      normalizeCsvExportOptions({}),
    );
    expect(
      defaultVisible.map((column) =>
        column.kind === "data" ? column.field : "#row",
      ),
    ).toEqual(["left", "center-b", "center-a", "right"]);
    const withInternal = planCsvColumnScope(
      csvSnapshot,
      { mode: "visible" },
      normalizeCsvExportOptions({ includeInternalColumns: true }),
    );
    expect(
      withInternal.map((column) =>
        column.kind === "data" ? column.field : "#row",
      ),
    ).toEqual([
      "left",
      SELECTION_COLUMN_FIELD,
      "center-b",
      "center-a",
      "right",
    ]);

    orderFeature.columnOrderStore.move("center-a", 0, allUserLeafColumns);
    selection = normalizeRowSelection({ mode: "multiple" });
    const recaptured = host.captureLogicalColumnLayoutSnapshot({
      visibleUserColumns,
      allUserLeafColumns,
    });
    expect(
      recaptured.visibleColumns.some(
        (column) => column.field === SELECTION_COLUMN_FIELD,
      ),
    ).toBe(false);
    expect(captured.visibleColumns.map((column) => column.field)).toEqual([
      "left",
      SELECTION_COLUMN_FIELD,
      "center-b",
      "center-a",
      "right",
    ]);
  });

  it("omits the internal selection column when checkbox selection is disabled", () => {
    const selection = normalizeRowSelection({ mode: "multiple" });
    const host = new DomFeatureHost({
      ...minimalDeps(selection),
      featuresOverride: [selectionFeature({ getConfig: () => selection })],
    });
    const columns: ColumnDef[] = [{ field: "a" }];
    const captured = host.captureLogicalColumnLayoutSnapshot({
      visibleUserColumns: columns,
      allUserLeafColumns: columns,
    });
    expect(captured.visibleColumns.map((column) => column.field)).toEqual(["a"]);
    expect(captured.allLeafColumns.map((column) => column.field)).toEqual(["a"]);
  });

  it("selection APIs are safe before attach", () => {
    const host = new DomFeatureHost(minimalDeps());
    expect(host.isRowSelected("any")).toBe(false);
    expect(host.getSelectedRowIds()).toEqual([]);
    expect(host.clearSelection()).toBeNull();
    expect(() => host.syncSelectionMode()).not.toThrow();
    expect(() => host.refreshHeaderSelectionState()).not.toThrow();
    expect(host.captureRowSelectionSnapshot(7)).toMatchObject({
      definitelyEmpty: true,
      universeRowCount: 7,
    });
    expect(host.captureColumnSelectionSnapshot().size).toBe(0);
  });

  it("forwards snapshot-stable row and column membership capabilities", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const columns: ColumnDef[] = [{ field: "a" }, { field: "b" }];
    const rowSelection = normalizeRowSelection({ mode: "multiple" });
    const columnSelection = normalizeColumnSelection({ mode: "multiple" });
    const host = new DomFeatureHost({
      ...minimalDeps(rowSelection),
      getColumns: () => columns,
      getDisplayRows: () => createArrayDisplayRowReader(rows),
      getFullDisplayRows: () => createArrayDisplayRowReader(rows),
      getSourceRows: () => rows,
      getColumnSelectionConfig: () => columnSelection,
      resolveRowId: (row) => String(row.id),
      featuresOverride: [
        selectionFeature({ getConfig: () => rowSelection }),
        columnSelectionFeature({
          getColumnSelectionConfig: () => columnSelection,
        }),
      ],
    });
    const root = document.createElement("div");
    const surface = document.createElement("div");
    const viewport = document.createElement("div");
    surface.appendChild(viewport);
    root.appendChild(surface);
    host.attach(root, viewport, surface);

    host.setSelectedRowIds(["a", "b"]);
    host.setSelectedColumnIds(["a", "b"]);
    const selectedRows = host.captureRowSelectionSnapshot(rows.length);
    const selectedColumns = host.captureColumnSelectionSnapshot();

    host.setSelectedRowIds(["c"]);
    host.setSelectedColumnIds(["b"]);

    expect(selectedRows.definitelyEmpty).toBe(false);
    expect(selectedRows.has("a")).toBe(true);
    expect(selectedRows.has("c")).toBe(false);
    expect(selectedColumns.size).toBe(2);
    expect(selectedColumns.has("a")).toBe(true);
    host.detach();
  });

  it("forwards the authoritative row-selection universe unchanged", () => {
    const captureSelectionSnapshot = vi.fn((universeRowCount: number) =>
      captureAllMinusExcludedRowSelection(
        new Set(["old-a", "old-b"]),
        universeRowCount,
      ),
    );
    const capability: DomGridFeature & SelectionCapability = {
      name: "selection-capture-test",
      attach: () => {},
      detach: () => {},
      isRowSelected: () => false,
      getSelectedIds: () => [],
      getSelectedCount: () => 0,
      captureSelectionSnapshot,
      clearSelection: () => null,
      setSelectedIds: () => null,
      syncSelectionMode: () => {},
      refreshHeaderSelectionState: () => {},
      toggleRowSelectionAtDisplayIndex: () => false,
      selectRowAtDisplayIndex: () => false,
      extendRowSelectionStep: () => false,
      toggleAllRowSelection: () => false,
    };
    const oldRows = [{ id: "old-a" }, { id: "old-b" }];
    const host = new DomFeatureHost({
      ...minimalDeps(),
      getDisplayRows: () => createArrayDisplayRowReader(oldRows),
      getFullDisplayRows: () => createArrayDisplayRowReader(oldRows),
      featuresOverride: [capability],
    });

    const captured = host.captureRowSelectionSnapshot(3);

    expect(captureSelectionSnapshot).toHaveBeenCalledTimes(1);
    expect(captureSelectionSnapshot).toHaveBeenCalledWith(3);
    expect(captured).toMatchObject({
      model: "allMinusExcluded",
      universeRowCount: 3,
      definitelyEmpty: false,
    });
    expect(captured.has("new-c")).toBe(true);
  });

  it("uses no-op resize layout control when resize feature is absent", () => {
    const rowSelection = normalizeRowSelection({
      mode: "multiple",
      checkboxes: true,
      headerCheckbox: true,
    });
    const host = new DomFeatureHost({
      ...minimalDeps(rowSelection),
      featuresOverride: [
        selectionFeature({
          getConfig: () => rowSelection,
          onSelectionChanged: vi.fn(),
        }),
      ],
    });
    expect(host.getResizeOverride()).toBeNull();
    const ctrl = host.getResizeLayoutControl();
    expect(ctrl.isLayoutOnly("k")).toBe(false);
    expect(() => ctrl.updateLayoutKey("k")).not.toThrow();
    expect(() => ctrl.resetLayoutKey()).not.toThrow();
  });

  it("with columnOrder disabled, user column order and refs pass through before selection inject", () => {
    const host = new DomFeatureHost(minimalDeps());
    const a: ColumnDef = { field: "a" };
    const b: ColumnDef = { field: "b" };
    const user: ColumnDef[] = [b, a];
    const out = host.transformColumns(user);
    expect(out[0]?.field).toBe("__lfg_selection__");
    expect(out[1]).toBe(b);
    expect(out[2]).toBe(a);
  });

  it("with columnOrder enabled, reorder applies before selection column injection", () => {
    const rowSelection = normalizeRowSelection({
      mode: "multiple",
      checkboxes: true,
      headerCheckbox: true,
    });
    const orderFeat = columnOrderFeature({
      getColumnOrderConfig: () => ({ enabled: true }),
    });
    const host = new DomFeatureHost({
      ...minimalDeps(rowSelection),
      featuresOverride: [
        orderFeat,
        rowControlsFeature({
          getRowSelectionConfig: () => rowSelection,
          getRowDragConfig: () => normalizeRowDrag(undefined),
        }),
        selectionFeature({
          getConfig: () => rowSelection,
          onSelectionChanged: vi.fn(),
        }),
      ],
    });
    const a: ColumnDef = { field: "a" };
    const b: ColumnDef = { field: "b" };
    const c: ColumnDef = { field: "c" };
    const user = [a, b, c];
    orderFeat.columnOrderStore.move("c", 0, user);
    const out = host.transformColumns(user);
    expect(out.map((col) => col.field)).toEqual([
      "__lfg_selection__",
      "c",
      "a",
      "b",
    ]);
  });

  it("columnOrder respects visible-only columns: hidden fields dropped from order before transform", () => {
    const rowSelection = normalizeRowSelection({
      mode: "multiple",
      checkboxes: true,
      headerCheckbox: true,
    });
    const orderFeat = columnOrderFeature({
      getColumnOrderConfig: () => ({ enabled: true }),
    });
    const host = new DomFeatureHost({
      ...minimalDeps(rowSelection),
      featuresOverride: [
        orderFeat,
        rowControlsFeature({
          getRowSelectionConfig: () => rowSelection,
          getRowDragConfig: () => normalizeRowDrag(undefined),
        }),
        selectionFeature({
          getConfig: () => rowSelection,
          onSelectionChanged: vi.fn(),
        }),
      ],
    });
    const a: ColumnDef = { field: "a" };
    const b: ColumnDef = { field: "b" };
    const c: ColumnDef = { field: "c" };
    orderFeat.columnOrderStore.syncColumns([a, b, c]);
    orderFeat.columnOrderStore.move("c", 0, [a, b, c]);
    const visibleSubset = [a, c];
    const out = host.transformColumns(visibleSubset);
    expect(out.map((col) => col.field)).toEqual([
      "__lfg_selection__",
      "c",
      "a",
    ]);
  });
});
