// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { editingFeature } from "../../../features/editing/editingFeature";
import { hasEditingCapability } from "../../../features/types";
import { RowIdentityService } from "../../../identity/RowIdentityService";
import type { DomFeatureHostDeps } from "../../../rendering/dom/DomFeatureHost";
import { DomFeatureHost } from "../../../rendering/dom/DomFeatureHost";
import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import type { ColumnDef, PooledRow, RowData } from "../../../types";
import { normalizeColumnOrder } from "../../../utils/columnOrderConfig";
import { normalizeColumnSelection } from "../../../utils/columnSelectionConfig";
import { normalizeRowDrag } from "../../../utils/rowDragConfig";
import { normalizeRowSelection } from "../../../utils/rowSelectionConfig";

// ── Helpers ────────────────────────────────────────────────────────

const rows: RowData[] = [
  { id: "r0", name: "Alice", age: 30, active: true },
  { id: "r1", name: "Bob", age: 25, active: false },
];

const testColumns: ColumnDef[] = [
  { field: "name", editable: true },
  { field: "age", editable: true },
  { field: "active", editable: true, editor: "checkbox" },
];

function buildPoolDom() {
  const root = document.createElement("div");
  const surface = document.createElement("div");
  const viewport = document.createElement("div");
  surface.appendChild(viewport);
  root.appendChild(surface);
  document.body.appendChild(root);

  const pool: PooledRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rowEl = document.createElement("div") as HTMLDivElement;
    rowEl.className = "lfg-row";
    rowEl.setAttribute("data-row-id", `r${i}`);
    rowEl.setAttribute("data-row-index", String(i));

    const cells = [];
    for (const field of ["name", "age", "active"]) {
      const cell = document.createElement("div") as HTMLDivElement;
      cell.className = "lfg-cell";
      cell.setAttribute("data-col-id", field);
      rowEl.appendChild(cell);
      cells.push({ element: cell, value: "" });
    }

    viewport.appendChild(rowEl);

    pool.push({
      element: rowEl,
      cells,
      rowIndex: i,
      rowVersion: 0,
      rowId: `r${i}`,
    });
  }

  return { root, surface, viewport, pool };
}

function findCellInDom(container: HTMLElement, rowId: string, field: string): HTMLElement | null {
  const rowEl = container.querySelector<HTMLElement>(`.lfg-row[data-row-id="${rowId}"]`);
  if (!rowEl) return null;
  return rowEl.querySelector<HTMLElement>(`.lfg-cell[data-col-id="${field}"]`);
}

function minimalDeps(pool: PooledRow[], overrides?: Partial<DomFeatureHostDeps>): DomFeatureHostDeps {
  const commitCellEdit = vi.fn();
  return {
    getPool: () => pool,
    getColumns: () => testColumns,
    getDisplayRows: () => createArrayDisplayRowReader(rows),
    getSourceRows: () => rows,
    getVisibleRowStart: () => 0,
    getColumnOrderConfig: () => normalizeColumnOrder(undefined),
    getRowDragConfig: () => normalizeRowDrag(undefined),
    getRowSelectionConfig: () => normalizeRowSelection(undefined),
    resolveRowId: (row: RowData) => String(row.id),
    getHeaderRowEl: () => null,
    getPinnedHeaderRowEl: () => null,
    getPinnedRightHeaderRowEl: () => null,
    getDataRevision: () => 0,
    requestSync: () => {},
    requestColumnTransformSync: () => {},
    commitResize: vi.fn(),
    getColumnSelectionConfig: () => normalizeColumnSelection(undefined),
    syncColumnSelectionClasses: () => {},
    getSortModel: () => [],
    isSortPending: () => false,
    toggleColumnSort: () => {},
    setColumnSort: () => {},
    pinColumn: () => {},
    commitCellEdit,
    ...overrides,
  };
}

describe("cellEditing integration", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("editingFeature exposes EditingCapability", () => {
    const feature = editingFeature({
      getFocusedCell: () => null,
      setFocusedCell: () => {},
      commitCellEdit: () => {},
    });
    expect(hasEditingCapability(feature)).toBe(true);
  });

  it("DomFeatureHost detects and delegates editing capability", () => {
    const { root, surface, viewport, pool } = buildPoolDom();
    const commitCellEdit = vi.fn();

    const feature = editingFeature({
      getFocusedCell: () => null,
      setFocusedCell: () => {},
      commitCellEdit,
    });

    const host = new DomFeatureHost({
      ...minimalDeps(pool),
      featuresOverride: [feature],
    });

    host.attach(root, viewport, surface);

    expect(host.getEditingCell()).toBeNull();

    const started = host.startEdit({ rowIndex: 0, field: "name" });
    expect(started).toBe(true);
    expect(host.getEditingCell()).toEqual({ rowId: "r0", field: "name" });

    const cell = findCellInDom(root, "r0", "name");
    expect(cell?.classList.contains("lfg-cell-editing")).toBe(true);
    expect(cell?.querySelector(".lfg-cell-editor-host")).not.toBeNull();

    const stopped = host.stopEdit({ commit: false });
    expect(stopped).toBe(true);
    expect(host.getEditingCell()).toBeNull();

    host.detach();
  });

  it("dblclick on cell starts editing in integrated feature host", () => {
    const { root, surface, viewport, pool } = buildPoolDom();
    const commitCellEdit = vi.fn();

    const feature = editingFeature({
      getFocusedCell: () => null,
      setFocusedCell: () => {},
      commitCellEdit,
    });

    const host = new DomFeatureHost({
      ...minimalDeps(pool),
      featuresOverride: [feature],
    });

    host.attach(root, viewport, surface);

    const cell = findCellInDom(root, "r0", "name")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(host.getEditingCell()).toEqual({ rowId: "r0", field: "name" });

    host.stopEdit({ commit: false });
    host.detach();
  });

  it("Enter commits and Escape cancels in integrated host", () => {
    const { root, surface, viewport, pool } = buildPoolDom();
    const commitCellEdit = vi.fn();

    const feature = editingFeature({
      getFocusedCell: () => null,
      setFocusedCell: () => {},
      commitCellEdit,
    });

    const host = new DomFeatureHost({
      ...minimalDeps(pool),
      featuresOverride: [feature],
    });

    host.attach(root, viewport, surface);

    host.startEdit({ rowIndex: 0, field: "name" });
    expect(host.getEditingCell()).not.toBeNull();

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.getEditingCell()).toBeNull();

    host.startEdit({ rowIndex: 0, field: "name" });
    expect(host.getEditingCell()).not.toBeNull();

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(host.getEditingCell()).toBeNull();

    host.detach();
  });

  it("commitCellEdit is called with correct data on Enter", () => {
    const { root, surface, viewport, pool } = buildPoolDom();
    const commitCellEdit = vi.fn();

    const feature = editingFeature({
      getFocusedCell: () => null,
      setFocusedCell: () => {},
      commitCellEdit,
    });

    const host = new DomFeatureHost({
      ...minimalDeps(pool),
      featuresOverride: [feature],
    });

    host.attach(root, viewport, surface);

    host.startEdit({ rowIndex: 0, field: "name" });

    const editorInput = root.querySelector(".lfg-cell-editor-host input") as HTMLInputElement;
    editorInput.value = "Charlie";

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(commitCellEdit).toHaveBeenCalledOnce();
    const change = commitCellEdit.mock.calls[0][0];
    expect(change.rowId).toBe("r0");
    expect(change.field).toBe("name");
    expect(change.oldValue).toBe("Alice");
    expect(change.newValue).toBe("Charlie");

    host.detach();
  });

  it("syncEditingState re-mounts editor after cell recycle", () => {
    const { root, surface, viewport, pool } = buildPoolDom();
    const commitCellEdit = vi.fn();

    const feature = editingFeature({
      getFocusedCell: () => null,
      setFocusedCell: () => {},
      commitCellEdit,
    });

    const host = new DomFeatureHost({
      ...minimalDeps(pool),
      featuresOverride: [feature],
    });

    host.attach(root, viewport, surface);
    host.startEdit({ rowIndex: 0, field: "name" });

    const oldCell = findCellInDom(root, "r0", "name")!;
    expect(oldCell.querySelector(".lfg-cell-editor-host")).not.toBeNull();

    host.syncEditingState();
    expect(host.getEditingCell()).toEqual({ rowId: "r0", field: "name" });

    host.stopEdit({ commit: false });
    host.detach();
  });

  it("RowIdentityService.transferIdentity preserves auto IDs", () => {
    const service = new RowIdentityService();
    const original = { name: "Alice" };
    const clone = { name: "Bob" };

    const id = service.resolve(original, 0);
    expect(id).toMatch(/^auto:\d+$/);

    service.transferIdentity(original, clone);
    const cloneId = service.resolve(clone, 0);
    expect(cloneId).toBe(id);
  });

  it("commitCellEdit includes sourceIndex in commit change", () => {
    const { root, surface, viewport, pool } = buildPoolDom();
    const commitCellEdit = vi.fn();

    const feature = editingFeature({
      getFocusedCell: () => null,
      setFocusedCell: () => {},
      commitCellEdit,
    });

    const host = new DomFeatureHost({
      ...minimalDeps(pool),
      featuresOverride: [feature],
    });

    host.attach(root, viewport, surface);

    host.startEdit({ rowIndex: 0, field: "name" });
    const editorInput = root.querySelector(".lfg-cell-editor-host input") as HTMLInputElement;
    editorInput.value = "Diana";

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(commitCellEdit).toHaveBeenCalledOnce();
    const change = commitCellEdit.mock.calls[0][0];
    expect(change.sourceIndex).toBe(0);
    expect(change.field).toBe("name");
    expect(change.oldValue).toBe("Alice");
    expect(change.newValue).toBe("Diana");

    host.detach();
  });
});
