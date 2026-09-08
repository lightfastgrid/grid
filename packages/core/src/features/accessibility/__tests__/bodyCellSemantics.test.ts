// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { addAriaDescribedByToken } from "../../../internal/ariaIdReferenceTokens";
import type { DomGridFeatureContext } from "../../../internal/layoutTypes";
import type { PooledCell, PooledRow } from "../../../internal/poolTypes";
import type { ColumnDef, FocusedCell, RowData } from "../../../types";
import { BodyCellSemanticsReconciler } from "../utils/bodyCellSemantics";

function makeCell(field: string, value: string): PooledCell {
  const element = document.createElement("div");
  element.className = "lfg-cell";
  element.setAttribute("data-col-id", field);
  return { element, value };
}

function makePoolRow(
  rowIndex: number,
  rowId: string | null,
  cells: PooledCell[],
): PooledRow {
  return {
    element: document.createElement("div"),
    cells,
    rowIndex,
    rowVersion: 1,
    rowId,
  };
}

function makeContext(options: {
  columns: ColumnDef[];
  rows: RowData[];
  pool: PooledRow[];
  columnSelectionEnabled?: boolean;
  selectedFields?: readonly string[];
  focusedCell?: FocusedCell | null;
  pinnedPoolRows?: PooledRow[];
}): DomGridFeatureContext {
  const selected = new Set(options.selectedFields ?? []);
  // Unit mock: surface and root are the same element (the real separation is
  // covered by the F16A integration/surface tests).
  const root = document.createElement("div");
  return {
    root,
    surface: root,
    viewport: document.createElement("div"),
    getPool: () => options.pool,
    getColumns: () => options.columns,
    getDisplayRows: () => ({
      rowCount: options.rows.length,
      getRowData: (index) => options.rows[index],
      getSourceIndex: (index) => index,
      getRow: () => null,
    }),
    getSourceRows: () => options.rows,
    getVisibleRowStart: () => 0,
    forEachRowPinnedLanePoolRow: (visit) => {
      for (const row of options.pinnedPoolRows ?? []) visit(row);
    },
    requestSync: () => {},
    requestColumnTransformSync: () => {},
    syncColumnSelectionClasses: () => {},
    resolveRowId: (_row, index) => `r${index}`,
    getHeaderRowEl: () => null,
    getPinnedHeaderRowEl: () => null,
    getPinnedRightHeaderRowEl: () => null,
    getDataRevision: () => 0,
    getSelectedColumnIdsForColumnOrder: () => [...selected],
    getColumnSelectionConfig: () => ({
      enabled: options.columnSelectionEnabled ?? false,
      mode: "multiple",
      enableHeaderClickSelection: true,
      clearOnOutsideClick: false,
    }),
    isColumnSelected: (field) => selected.has(field),
    getFocusedCell: () => options.focusedCell ?? null,
    getSelectedRowCountForRowOrder: () => 0,
    isRowSelectedForRowOrder: () => false,
    getSelectedRowIdsForRowOrder: () => [],
    getSortModel: () => [],
    toggleColumnSort: () => {},
    setColumnSort: () => {},
    pinColumn: () => {},
  };
}

describe("BodyCellSemanticsReconciler", () => {
  it("publishes global indexes and stable physical semantics across lanes", () => {
    const left = makeCell("left", "L");
    const center = makeCell("center", "C");
    const right = makeCell("right", "R");
    const row = makePoolRow(0, "row-user-fragment", [center]);
    row.pinnedCells = [left];
    row.rightPinnedCells = [right];
    const ctx = makeContext({
      columns: [
        { field: "center", headerName: "Center" },
        { field: "right", headerName: "Right", pinned: "right" },
        { field: "left", headerName: "Left", pinned: "left" },
      ],
      rows: [{ left: "L", center: "C", right: "R" }],
      pool: [row],
    });
    const reconciler = new BodyCellSemanticsReconciler();

    reconciler.syncStructure(ctx);

    expect(left.element.getAttribute("role")).toBe("gridcell");
    expect(left.element.getAttribute("aria-colindex")).toBe("1");
    expect(center.element.getAttribute("aria-colindex")).toBe("2");
    expect(right.element.getAttribute("aria-colindex")).toBe("3");
    expect(center.element.getAttribute("tabindex")).toBe("-1");
    expect(center.element.getAttribute("aria-label")).toBe("Center: C");

    const ids = [left, center, right].map((cell) => cell.element.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(id).toMatch(/^lfg-a11y-\d+-cell-\d+$/);
      expect(id).not.toContain("row-user-fragment");
      expect(id).not.toContain("center");
    }

    row.rowId = "next-row";
    row.rowIndex = 0;
    center.value = "Next";
    expect(reconciler.syncPosition(ctx)).toBe(true);
    expect([left, center, right].map((cell) => cell.element.id)).toEqual(ids);
  });

  it("keeps a physical id while horizontal recycling changes its logical field", () => {
    const cell = makeCell("a", "A");
    const row = makePoolRow(0, "r0", [cell]);
    const ctx = makeContext({
      columns: [
        { field: "a", headerName: "First" },
        { field: "b", headerName: "Second" },
      ],
      rows: [{ a: "A", b: "B" }],
      pool: [row],
    });
    const reconciler = new BodyCellSemanticsReconciler();
    reconciler.syncStructure(ctx);
    const physicalId = cell.element.id;

    cell.element.setAttribute("data-col-id", "b");
    cell.value = "B";
    expect(reconciler.syncPosition(ctx)).toBe(true);

    expect(cell.element.id).toBe(physicalId);
    expect(cell.element.getAttribute("aria-colindex")).toBe("2");
    expect(cell.element.getAttribute("aria-label")).toBe("Second: B");
  });

  it("uses formatted values and invokes custom callbacks once per changed binding", () => {
    const getCellAriaLabel = vi.fn(
      () => "Account",
    );
    const getCellAriaDescribedBy = vi.fn(() => " detail-one   detail-two ");
    const cell = makeCell("name", "Visible Name");
    const row = makePoolRow(0, "r0", [cell]);
    const ctx = makeContext({
      columns: [{
        field: "name",
        headerName: "Name",
        getCellAriaLabel,
        cellAriaDescribedBy: "fallback",
        getCellAriaDescribedBy,
      }],
      rows: [{ name: "raw" }],
      pool: [row],
    });
    const reconciler = new BodyCellSemanticsReconciler();

    reconciler.syncStructure(ctx);
    expect(getCellAriaLabel).toHaveBeenCalledTimes(1);
    expect(getCellAriaLabel).toHaveBeenCalledWith(
      expect.objectContaining({
        row: ctx.getDisplayRows().getRowData(0),
        rowId: "r0",
        rowIndex: 0,
        sourceIndex: 0,
        field: "name",
        formattedValue: "Visible Name",
      }),
    );
    expect(cell.element.getAttribute("aria-label")).toBe(
      "Visible Name Account",
    );
    expect(cell.element.getAttribute("aria-describedby")).toBe(
      "detail-one   detail-two",
    );

    expect(reconciler.syncPosition(ctx)).toBe(true);
    expect(getCellAriaLabel).toHaveBeenCalledTimes(1);
    expect(getCellAriaDescribedBy).toHaveBeenCalledTimes(1);

    cell.value = "Changed";
    row.rowVersion += 1;
    expect(reconciler.syncPosition(ctx)).toBe(true);
    expect(getCellAriaLabel).toHaveBeenCalledTimes(2);
    expect(cell.element.getAttribute("aria-label")).toContain("Changed");
  });

  it("falls back safely for blank and throwing callback results", () => {
    const blank = makeCell("blank", "One");
    const throwing = makeCell("throwing", "Two");
    const row = makePoolRow(0, "r0", [blank, throwing]);
    const ctx = makeContext({
      columns: [
        {
          field: "blank",
          headerName: "Blank",
          getCellAriaLabel: () => " ",
          cellAriaDescribedBy: "blank-description",
          getCellAriaDescribedBy: () => null,
        },
        {
          field: "throwing",
          headerName: "Throwing",
          getCellAriaLabel: () => {
            throw new Error("label");
          },
          cellAriaDescribedBy: "throwing-description",
          getCellAriaDescribedBy: () => {
            throw new Error("description");
          },
        },
      ],
      rows: [{ blank: 1, throwing: 2 }],
      pool: [row],
    });

    new BodyCellSemanticsReconciler().syncStructure(ctx);

    expect(blank.element.getAttribute("aria-label")).toBe("Blank: One");
    expect(blank.element.getAttribute("aria-describedby")).toBe(
      "blank-description",
    );
    expect(throwing.element.getAttribute("aria-label")).toBe(
      "Throwing: Two",
    );
    expect(throwing.element.getAttribute("aria-describedby")).toBe(
      "throwing-description",
    );
  });

  it("updates application descriptions without erasing a tooltip token", () => {
    let description = "first-help";
    const cell = makeCell("name", "Visible Name");
    const row = makePoolRow(0, "r0", [cell]);
    const ctx = makeContext({
      columns: [{
        field: "name",
        getCellAriaDescribedBy: () => description,
      }],
      rows: [{ name: "raw" }],
      pool: [row],
    });
    const reconciler = new BodyCellSemanticsReconciler();
    reconciler.syncStructure(ctx);
    addAriaDescribedByToken(cell.element, "lfg-tooltip-999");

    description = "second-help";
    row.rowVersion += 1;
    expect(reconciler.syncPosition(ctx)).toBe(true);

    expect(cell.element.getAttribute("aria-describedby")).toBe(
      "second-help lfg-tooltip-999",
    );

    reconciler.clear(ctx);
    expect(cell.element.getAttribute("aria-describedby")).toBe(
      "lfg-tooltip-999",
    );
  });

  it("keeps owner-local interactive descendants exposed", () => {
    const selection = makeCell("__lfg_selection__", "");
    const action = makeCell("actions", "");
    const link = makeCell("link", "Visible Link");
    link.shellKind = "link";
    const row = makePoolRow(0, "r0", [selection, action, link]);
    const ctx = makeContext({
      columns: [
        { field: "__lfg_selection__", internal: "selection" },
        { field: "actions", cellKind: "actions" },
        { field: "link", headerName: "Link" },
      ],
      rows: [{}],
      pool: [row],
    });

    new BodyCellSemanticsReconciler().syncStructure(ctx);

    for (const cell of [selection, action, link]) {
      expect(cell.element.getAttribute("role")).toBe("gridcell");
      expect(cell.element.getAttribute("aria-label")).toBeNull();
    }
  });

  it("publishes column-selection state and clears it when disabled", () => {
    const first = makeCell("a", "A");
    const second = makeCell("b", "B");
    const row = makePoolRow(0, "r0", [first, second]);
    const options: Parameters<typeof makeContext>[0] = {
      columns: [{ field: "a" }, { field: "b" }],
      rows: [{}],
      pool: [row],
      columnSelectionEnabled: true,
      selectedFields: ["b"],
    };
    const ctx = makeContext(options);
    const reconciler = new BodyCellSemanticsReconciler();

    reconciler.syncStructure(ctx);
    expect(first.element.getAttribute("aria-selected")).toBe("false");
    expect(second.element.getAttribute("aria-selected")).toBe("true");

    options.columnSelectionEnabled = false;
    expect(reconciler.syncPosition(ctx)).toBe(true);
    expect(first.element.getAttribute("aria-selected")).toBeNull();
    expect(second.element.getAttribute("aria-selected")).toBeNull();
  });

  it("tracks the focused physical cell and clears virtualized targets", () => {
    const cell = makeCell("name", "Name");
    const row = makePoolRow(0, "r0", [cell]);
    const options: Parameters<typeof makeContext>[0] = {
      columns: [{ field: "name" }],
      rows: [{ name: "Name" }],
      pool: [row],
      focusedCell: {
        rowId: "r0",
        rowIndex: 0,
        sourceIndex: 0,
        field: "name",
      },
    };
    const ctx = makeContext(options);
    const reconciler = new BodyCellSemanticsReconciler();

    reconciler.syncStructure(ctx);
    expect(ctx.root.getAttribute("aria-activedescendant")).toBe(cell.element.id);

    row.rowId = "r1";
    row.rowIndex = 0;
    options.focusedCell = {
      rowId: "r1",
      rowIndex: 0,
      sourceIndex: 0,
      field: "name",
    };
    reconciler.syncActiveDescendant(ctx);
    expect(ctx.root.getAttribute("aria-activedescendant")).toBe(cell.element.id);

    options.focusedCell = {
      rowId: "r0",
      rowIndex: 0,
      sourceIndex: 0,
      field: "name",
    };
    reconciler.syncActiveDescendant(ctx);
    expect(ctx.root.getAttribute("aria-activedescendant")).toBeNull();

    options.focusedCell = null;
    reconciler.syncActiveDescendant(ctx);
    expect(ctx.root.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("keeps idle physical ids but clears binding semantics and fully clears on detach", () => {
    const cell = makeCell("a", "A");
    const row = makePoolRow(0, "r0", [cell]);
    const ctx = makeContext({
      columns: [{ field: "a" }],
      rows: [{}],
      pool: [row],
    });
    const reconciler = new BodyCellSemanticsReconciler();
    reconciler.syncStructure(ctx);
    const id = cell.element.id;

    row.rowId = null;
    row.rowIndex = -1;
    cell.element.style.display = "none";
    expect(reconciler.syncPosition(ctx)).toBe(true);
    expect(cell.element.id).toBe(id);
    expect(cell.element.getAttribute("tabindex")).toBe("-1");
    expect(cell.element.getAttribute("role")).toBeNull();
    expect(cell.element.getAttribute("aria-colindex")).toBeNull();

    reconciler.clear(ctx);
    expect(cell.element.hasAttribute("id")).toBe(false);
    expect(cell.element.hasAttribute("tabindex")).toBe(false);
  });

  it("does not allocate states from positional reconciliation", () => {
    const first = makeCell("a", "A");
    const pool = [makePoolRow(0, "r0", [first])];
    const ctx = makeContext({
      columns: [{ field: "a" }],
      rows: [{ a: "A" }, { a: "B" }],
      pool,
    });
    const reconciler = new BodyCellSemanticsReconciler();
    reconciler.syncStructure(ctx);

    const second = makeCell("a", "B");
    pool.push(makePoolRow(1, "r1", [second]));
    expect(reconciler.syncPosition(ctx)).toBe(false);
    expect(second.element.hasAttribute("id")).toBe(false);
  });

  it("writes only cells whose accepted binding or selection changed", () => {
    const first = makeCell("value", "First");
    const second = makeCell("value", "Second");
    const rows = [
      makePoolRow(0, "r0", [first]),
      makePoolRow(1, "r1", [second]),
    ];
    const ctx = makeContext({
      columns: [{ field: "value", headerName: "Value" }],
      rows: [{ value: "First" }, { value: "Second" }],
      pool: rows,
    });
    const reconciler = new BodyCellSemanticsReconciler();
    reconciler.syncStructure(ctx);
    const firstSet = vi.spyOn(first.element, "setAttribute");
    const firstRemove = vi.spyOn(first.element, "removeAttribute");
    const secondSet = vi.spyOn(second.element, "setAttribute");
    const secondRemove = vi.spyOn(second.element, "removeAttribute");

    second.value = "Changed";
    rows[1]!.rowVersion += 1;
    expect(reconciler.syncPosition(ctx)).toBe(true);

    expect(firstSet).not.toHaveBeenCalled();
    expect(firstRemove).not.toHaveBeenCalled();
    expect(secondSet).toHaveBeenCalled();
    expect(secondRemove).not.toHaveBeenCalled();
    expect(second.element.getAttribute("aria-label")).toBe("Value: Changed");
  });

  it("does not publish stale semantics after callback-driven detach", () => {
    const getCellAriaDescribedBy = vi.fn(() => "stale-description");
    const cell = makeCell("name", "Visible");
    const row = makePoolRow(0, "r0", [cell]);
    const getCellAriaLabel = vi.fn(() => {
      reconciler.clear(ctx);
      return "Stale label";
    });
    const ctx = makeContext({
      columns: [{
        field: "name",
        getCellAriaLabel,
        getCellAriaDescribedBy,
      }],
      rows: [{ name: "Visible" }],
      pool: [row],
    });
    const reconciler = new BodyCellSemanticsReconciler();

    reconciler.syncStructure(ctx);

    expect(getCellAriaLabel).toHaveBeenCalledTimes(1);
    expect(getCellAriaDescribedBy).not.toHaveBeenCalled();
    expect(cell.element.hasAttribute("id")).toBe(false);
    expect(cell.element.hasAttribute("role")).toBe(false);
    expect(cell.element.hasAttribute("aria-label")).toBe(false);
  });
});
