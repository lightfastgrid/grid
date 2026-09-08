// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { DomGridFeatureContext } from "../../../internal/layoutTypes";
import { CSS } from "../../../rendering/const/css-classes";
import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import type { CellMenuOptions, ColumnDef, RowData } from "../../../types";
import { normalizeColumnOrder } from "../../../utils/columnOrderConfig";
import { normalizeColumnSelection } from "../../../utils/columnSelectionConfig";
import { normalizeRowDrag } from "../../../utils/rowDragConfig";
import { normalizeRowSelection } from "../../../utils/rowSelectionConfig";
import type { DomGridFeatureFactoryContext } from "../../registry";
import { BUILT_IN_FEATURE_FACTORIES } from "../../registry";

function makeSourceRows(): RowData[] {
  return [
    { id: "1", name: "Alice" },
    { id: "2", name: "Bob" },
  ];
}

function makeColumns(): ColumnDef[] {
  return [{ field: "id" }, { field: "name" }];
}

function buildRow(rowId: string, displayIndex: number, fields: string[]): HTMLElement {
  const row = document.createElement("div");
  row.className = CSS.ROW;
  row.dataset.rowId = rowId;
  row.dataset.rowIndex = String(displayIndex);
  for (const field of fields) {
    const cell = document.createElement("div");
    cell.className = CSS.CELL;
    cell.dataset.colId = field;
    row.appendChild(cell);
  }
  return row;
}

function fireContextMenu(target: HTMLElement): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function minimalRegistryContext(
  sourceRows: RowData[],
  getCellMenuOptions: () => CellMenuOptions,
): DomGridFeatureFactoryContext {
  return {
    getColumns: makeColumns,
    getColumnOrderConfig: () => normalizeColumnOrder(undefined),
    getRowSelectionConfig: () => normalizeRowSelection(undefined),
    getColumnSelectionConfig: () => normalizeColumnSelection(undefined),
    getRowDragConfig: () => normalizeRowDrag(undefined),
    getDisplayRows: () => createArrayDisplayRowReader(sourceRows),
    getSourceRows: () => sourceRows,
    resolveRowId: (row, index) =>
      String((row as Record<string, unknown>).id ?? index),
    commitResize: () => {},
    getSortModel: () => [],
    isSortPending: () => false,
    toggleColumnSort: () => {},
    setColumnSort: () => {},
    pinColumn: () => {},
    getCellMenuOptions,
  };
}

function minimalAttachContext(
  root: HTMLElement,
  viewport: HTMLElement,
  sourceRows: RowData[],
): DomGridFeatureContext {
  return {
    root,
    surface: root,
    viewport,
    getPool: () => [],
    getColumns: makeColumns,
    getDisplayRows: () => createArrayDisplayRowReader(sourceRows),
    getSourceRows: () => sourceRows,
    getVisibleRowStart: () => 0,
    requestSync: () => {},
    requestColumnTransformSync: () => {},
    resolveRowId: (row, index) =>
      String((row as Record<string, unknown>).id ?? index),
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

describe("cell menu production getRows() adapters", () => {
  it("registry fallback shallow-copies source rows when getCellMenuGridApi is omitted", () => {
    const sourceRows = makeSourceRows();
    let firstCapture: RowData[] | null = null;
    let secondCapture: RowData[] | null = null;
    let openCount = 0;
    const factory = BUILT_IN_FEATURE_FACTORIES.find(
      (entry) => entry.name === "cell-menu",
    )!;
    const feature = factory.create(
      minimalRegistryContext(sourceRows, () => ({
        enabled: true,
        trigger: "contextmenu",
        getActions: (ctx) => {
          const captured = ctx.grid.getRows();
          if (openCount === 0) {
            firstCapture = captured;
            captured.reverse();
          } else {
            secondCapture = captured;
          }
          openCount += 1;
          return [{ id: "copy", label: "Copy" }];
        },
      })),
    );
    expect(feature).not.toBeNull();

    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);
    feature!.attach(minimalAttachContext(root, viewport, sourceRows));
    const row = buildRow("1", 0, ["id", "name"]);
    root.appendChild(row);

    fireContextMenu(row.querySelector('[data-col-id="name"]') as HTMLElement);

    expect(firstCapture).not.toBeNull();
    expect(firstCapture).not.toBe(sourceRows);
    expect(firstCapture!.map((row) => row.name)).toEqual(["Bob", "Alice"]);
    expect(firstCapture![0]).toBe(sourceRows[1]);
    expect(sourceRows.map((row) => row.name)).toEqual(["Alice", "Bob"]);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    fireContextMenu(row.querySelector('[data-col-id="name"]') as HTMLElement);

    expect(secondCapture).not.toBeNull();
    expect(secondCapture).not.toBe(firstCapture);
    expect(secondCapture!.map((row) => row.name)).toEqual(["Alice", "Bob"]);
    expect(secondCapture![0]).toBe(sourceRows[0]);

    feature!.detach();
  });
});
