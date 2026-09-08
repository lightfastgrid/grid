// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { DomGridFeatureContext } from "../../../internal/layoutTypes";
import type { PooledCell, PooledRow } from "../../../internal/poolTypes";
import type { ColumnDef, RowData } from "../../../types";
import { BodyCellSemanticsReconciler } from "../utils/bodyCellSemantics";
import { RowSemanticsReconciler } from "../utils/rowSemantics";

function cell(field: string, value = field): PooledCell {
  const element = document.createElement("div");
  element.setAttribute("data-col-id", field);
  return { element, value };
}

function row(
  rowIndex: number,
  rowId: string | null,
  cells: PooledCell[],
): PooledRow {
  const element = document.createElement("div");
  for (const pooledCell of cells) {
    element.appendChild(pooledCell.element);
  }
  return {
    element,
    cells,
    rowIndex,
    rowVersion: 1,
    rowId,
  };
}

interface LogicalTriple {
  readonly center: PooledRow;
  readonly left: PooledRow | null;
  readonly right: PooledRow | null;
}

function context(options: {
  readonly columns: ColumnDef[];
  readonly rows: RowData[];
  readonly pool?: PooledRow[];
  readonly pinned?: readonly LogicalTriple[];
}): DomGridFeatureContext {
  const pinned = options.pinned ?? [];
  const root = document.createElement("div");
  return {
    root,
    surface: root,
    viewport: document.createElement("div"),
    getPool: () => options.pool ?? [],
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
      for (const triple of pinned) {
        visit(triple.center);
        if (triple.left !== null) visit(triple.left);
        if (triple.right !== null) visit(triple.right);
      }
    },
    forEachRowPinnedLogicalPoolRow: (visit) => {
      for (const triple of pinned) {
        visit(triple.center, triple.left, triple.right);
      }
    },
    requestSync: () => {},
    requestColumnTransformSync: () => {},
    resolveRowId: (_row, index) => `r${index}`,
    getHeaderRowEl: () => null,
    getPinnedHeaderRowEl: () => null,
    getPinnedRightHeaderRowEl: () => null,
    getDataRevision: () => 0,
    getSelectedColumnIdsForColumnOrder: () => [],
    getSelectedRowCountForRowOrder: () => 0,
    isRowSelectedForRowOrder: () => false,
    getSelectedRowIdsForRowOrder: () => [],
    getSortModel: () => [],
    toggleColumnSort: () => {},
    setColumnSort: () => {},
    pinColumn: () => {},
  };
}

function ownedIds(owner: HTMLElement): string[] {
  return owner.getAttribute("aria-owns")?.split(" ") ?? [];
}

describe("Accessibility V2 Section 7 pinned-lane ownership", () => {
  it("owns the complete left-center-right sequence with rotated center slots", () => {
    const left = cell("left");
    const centerA = cell("b");
    const centerB = cell("a");
    const right = cell("right");
    const centerRow = row(0, "r0", [centerA, centerB]);
    centerRow.pinnedElement = document.createElement("div");
    centerRow.pinnedCells = [left];
    centerRow.rightPinnedElement = document.createElement("div");
    centerRow.rightPinnedCells = [right];
    const ctx = context({
      columns: [
        { field: "a" },
        { field: "right", pinned: "right" },
        { field: "left", pinned: "left" },
        { field: "b" },
      ],
      rows: [{ left: "L", a: "A", b: "B", right: "R" }],
      pool: [centerRow],
    });
    const cells = new BodyCellSemanticsReconciler();

    cells.syncStructure(ctx);

    expect(ownedIds(centerRow.element)).toEqual([
      left.element.id,
      centerB.element.id,
      centerA.element.id,
      right.element.id,
    ]);
    expect(centerRow.element.contains(centerA.element)).toBe(true);
    expect(ownedIds(centerRow.element)).toContain(centerA.element.id);
  });

  it("performs zero ownership writes for vertical recycle and rewrites a rotated horizontal binding", () => {
    const left = cell("left");
    const first = cell("b");
    const second = cell("a");
    const centerRow = row(0, "r0", [first, second]);
    centerRow.pinnedElement = document.createElement("div");
    centerRow.pinnedCells = [left];
    const ctx = context({
      columns: [
        { field: "left", pinned: "left" },
        { field: "a" },
        { field: "b" },
      ],
      rows: [{}, {}],
      pool: [centerRow],
    });
    const cells = new BodyCellSemanticsReconciler();
    cells.syncStructure(ctx);
    const initial = centerRow.element.getAttribute("aria-owns");
    const setAttribute = vi.spyOn(centerRow.element, "setAttribute");
    const removeAttribute = vi.spyOn(centerRow.element, "removeAttribute");

    centerRow.rowId = "r1";
    centerRow.rowIndex = 1;
    centerRow.rowVersion += 1;
    expect(cells.syncPosition(ctx)).toBe(true);
    expect(centerRow.element.getAttribute("aria-owns")).toBe(initial);
    expect(setAttribute).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();

    first.element.setAttribute("data-col-id", "a");
    second.element.setAttribute("data-col-id", "b");
    centerRow.rowVersion += 1;
    expect(cells.syncPosition(ctx)).toBe(true);
    expect(ownedIds(centerRow.element)).toEqual([
      left.element.id,
      first.element.id,
      second.element.id,
    ]);
    expect(setAttribute).toHaveBeenCalledTimes(1);
    expect(removeAttribute).not.toHaveBeenCalled();
  });

  it("uses row-pinned center rows as owners and satellite rows as presentation", () => {
    const leftRow = row(0, "r0", [cell("left")]);
    const centerRow = row(0, "r0", [cell("center")]);
    const rightRow = row(0, "r0", [cell("right")]);
    const ctx = context({
      columns: [
        { field: "center" },
        { field: "right", pinned: "right" },
        { field: "left", pinned: "left" },
      ],
      rows: [{ left: "L", center: "C", right: "R" }],
      pinned: [{ center: centerRow, left: leftRow, right: rightRow }],
    });
    const rowSemantics = new RowSemanticsReconciler();
    const bodyCells = new BodyCellSemanticsReconciler();

    rowSemantics.syncStructure(ctx, {
      getRowSelectionMode: () => "multiple",
      isRowSelected: () => true,
    });
    bodyCells.syncStructure(ctx);

    expect(centerRow.element.getAttribute("role")).toBe("row");
    expect(centerRow.element.getAttribute("aria-rowindex")).toBe("2");
    expect(centerRow.element.getAttribute("aria-selected")).toBe("true");
    expect(leftRow.element.getAttribute("role")).toBe("presentation");
    expect(rightRow.element.getAttribute("role")).toBe("presentation");
    expect(leftRow.element.hasAttribute("aria-rowindex")).toBe(false);
    expect(rightRow.element.hasAttribute("aria-selected")).toBe(false);
    expect(ownedIds(centerRow.element)).toEqual([
      leftRow.cells[0]!.element.id,
      centerRow.cells[0]!.element.id,
      rightRow.cells[0]!.element.id,
    ]);
  });

  it("omits ownership for unsplit rows and clears ownership on idle and detach", () => {
    const center = cell("value");
    const centerRow = row(0, "r0", [center]);
    const ctx = context({
      columns: [{ field: "value" }],
      rows: [{ value: "A" }],
      pool: [centerRow],
    });
    const cells = new BodyCellSemanticsReconciler();
    cells.syncStructure(ctx);
    expect(centerRow.element.hasAttribute("aria-owns")).toBe(false);

    const left = cell("left");
    centerRow.pinnedElement = document.createElement("div");
    centerRow.pinnedCells = [left];
    const splitCtx = context({
      columns: [
        { field: "left", pinned: "left" },
        { field: "value" },
      ],
      rows: [{ left: "L", value: "A" }],
      pool: [centerRow],
    });
    cells.syncStructure(splitCtx);
    expect(centerRow.element.hasAttribute("aria-owns")).toBe(true);

    centerRow.pinnedCells = undefined;
    centerRow.pinnedElement = undefined;
    cells.syncStructure(splitCtx);
    expect(centerRow.element.hasAttribute("aria-owns")).toBe(false);

    centerRow.pinnedElement = document.createElement("div");
    centerRow.pinnedCells = [left];
    cells.syncStructure(splitCtx);
    expect(centerRow.element.hasAttribute("aria-owns")).toBe(true);

    centerRow.rowId = null;
    centerRow.rowIndex = -1;
    expect(cells.syncPosition(splitCtx)).toBe(true);
    expect(centerRow.element.hasAttribute("aria-owns")).toBe(false);

    centerRow.rowId = "r0";
    centerRow.rowIndex = 0;
    cells.syncStructure(splitCtx);
    expect(centerRow.element.hasAttribute("aria-owns")).toBe(true);
    cells.clear(splitCtx);
    expect(centerRow.element.hasAttribute("aria-owns")).toBe(false);
  });

  it("fails closed for duplicate logical cell bindings", () => {
    const duplicated = cell("left");
    const centerRow = row(0, "r0", [cell("center")]);
    centerRow.pinnedElement = document.createElement("div");
    centerRow.pinnedCells = [duplicated, duplicated];
    const ctx = context({
      columns: [
        { field: "left", pinned: "left" },
        { field: "center" },
      ],
      rows: [{}],
      pool: [centerRow],
    });
    const cells = new BodyCellSemanticsReconciler();

    cells.syncStructure(ctx);

    expect(centerRow.element.hasAttribute("aria-owns")).toBe(false);
    expect(cells.syncPosition(ctx)).toBe(false);
  });

  it("fails closed when row-pinned lane bindings do not describe one logical row", () => {
    const leftRow = row(0, "other", [cell("left")]);
    const centerRow = row(0, "r0", [cell("center")]);
    const ctx = context({
      columns: [
        { field: "left", pinned: "left" },
        { field: "center" },
      ],
      rows: [{}],
      pinned: [{ center: centerRow, left: leftRow, right: null }],
    });
    const cells = new BodyCellSemanticsReconciler();

    cells.syncStructure(ctx);

    expect(centerRow.element.hasAttribute("aria-owns")).toBe(false);
    expect(cells.syncPosition(ctx)).toBe(false);
  });

  it("retains reusable scratch and retries after an ownership DOM write throws", () => {
    const centerRow = row(0, "r0", [cell("center")]);
    centerRow.pinnedElement = document.createElement("div");
    centerRow.pinnedCells = [cell("left")];
    const ctx = context({
      columns: [
        { field: "left", pinned: "left" },
        { field: "center" },
      ],
      rows: [{}],
      pool: [centerRow],
    });
    const cells = new BodyCellSemanticsReconciler();
    const failure = new Error("ownership write failed");
    const setAttribute = vi
      .spyOn(centerRow.element, "setAttribute")
      .mockImplementationOnce(() => {
        throw failure;
      });

    expect(() => cells.syncStructure(ctx)).toThrow(failure);
    setAttribute.mockRestore();

    expect(() => cells.syncStructure(ctx)).not.toThrow();
    expect(ownedIds(centerRow.element)).toEqual([
      centerRow.pinnedCells[0]!.element.id,
      centerRow.cells[0]!.element.id,
    ]);
  });
});
