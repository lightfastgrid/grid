// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import type { ColumnDef, RowData } from "../../../types";
import { EditingController, type EditingDeps } from "../EditingController";
import type { EditCommitChange } from "../editingTypes";

function setup(options: {
  activation?: "auto" | "toggle" | "edit";
  editable?: ColumnDef["editable"];
  editor?: ColumnDef["editor"];
  value?: unknown;
  throwOnCommit?: Error;
} = {}) {
  let rows: RowData[] = [{ id: "r1", active: options.value ?? true }];
  const column: ColumnDef = {
    field: "active",
    editable: options.editable ?? true,
    cellShell: "checkbox",
    editor: options.editor ?? {
      type: "checkbox",
      activation: options.activation ?? "toggle",
    },
  };
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  const row = document.createElement("div");
  row.className = "lfg-row";
  row.dataset.rowIndex = "0";
  row.dataset.rowId = "r1";
  const cell = document.createElement("div");
  cell.className = "lfg-cell";
  cell.dataset.colId = "active";
  const shell = document.createElement("span");
  shell.className = "lfg-cell-shell lfg-cell-shell-checkbox";
  const label = document.createElement("label");
  label.className = "lfg-cell-shell-checkbox-label";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "lfg-cell-shell-checkbox-input";
  input.checked = rows[0]!.active === true;
  label.append(input, "Active");
  shell.appendChild(label);
  cell.appendChild(shell);
  row.appendChild(cell);
  root.appendChild(row);
  document.body.append(root, viewport);

  const commitEdit = vi.fn((change: EditCommitChange) => {
    if (options.throwOnCommit !== undefined) throw options.throwOnCommit;
    rows = [change.updatedRow];
  });
  const deps: EditingDeps = {
    getColumns: () => [column],
    getDisplayRows: () => createArrayDisplayRowReader(rows),
    resolveRowId: (value) => String(value.id),
    getFocusedCell: () => null,
    setFocusedCell: vi.fn(),
    findCellElement: () => cell,
    commitEdit,
    onEditStarted: vi.fn(),
    onEditCommitted: vi.fn(),
    onEditCanceled: vi.fn(),
  };
  const controller = new EditingController(deps);
  controller.attach(root, viewport);
  return { controller, deps, root, cell, shell, label, input, commitEdit };
}

describe("boolean pointer activation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("commits once for a direct input click and once for an associated-label click", () => {
    const h = setup();
    h.input.click();
    expect(h.commitEdit).toHaveBeenCalledTimes(1);
    expect(h.commitEdit.mock.calls[0]![0].newValue).toBe(false);

    h.label.click();
    expect(h.commitEdit).toHaveBeenCalledTimes(2);
    expect(h.commitEdit.mock.calls[1]![0].newValue).toBe(true);
    expect(h.controller.getEditingCell()).toBeNull();
  });

  it("treats two native clicks as two commits and the dblclick event as inert", () => {
    const h = setup();
    h.input.click();
    h.input.click();
    h.input.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(h.commitEdit).toHaveBeenCalledTimes(2);
    expect(h.commitEdit.mock.calls.map(([change]) => change.newValue)).toEqual([
      false,
      true,
    ]);
    expect(h.controller.getEditingCell()).toBeNull();
  });

  it("does not activate shell padding or cell background", () => {
    const h = setup();
    h.shell.click();
    h.cell.click();
    expect(h.commitEdit).not.toHaveBeenCalled();
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
  ])("rejects modified clicks and restores native state", (modifier) => {
    const h = setup();
    h.input.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, ...modifier }),
    );
    expect(h.commitEdit).not.toHaveBeenCalled();
    expect(h.input.checked).toBe(true);
  });

  it("rejects non-primary clicks", () => {
    const h = setup();
    h.input.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 1 }),
    );
    expect(h.commitEdit).not.toHaveBeenCalled();
    expect(h.input.checked).toBe(true);
  });

  it("restores state when current editability rejects the operation", () => {
    const h = setup({ editable: () => false });
    h.input.click();
    expect(h.commitEdit).not.toHaveBeenCalled();
    expect(h.input.checked).toBe(true);
  });

  it("keeps edit-gated single click non-mutating and opens the editor on dblclick", () => {
    const h = setup({ activation: "edit" });
    h.input.click();
    expect(h.commitEdit).not.toHaveBeenCalled();
    expect(h.input.checked).toBe(true);

    h.input.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(h.controller.getEditingCell()).toEqual({ rowId: "r1", field: "active" });
    expect(h.cell.querySelector(".lfg-cell-editor-host input")).not.toBeNull();
  });

  it("does not treat a checkbox shell as boolean when an explicit non-checkbox editor wins", () => {
    const h = setup({ editor: "text" });
    h.input.click();

    expect(h.commitEdit).not.toHaveBeenCalled();
    expect(h.input.checked).toBe(true);
    expect(h.controller.getBooleanCellKeyboardMode({
      rowIndex: 0,
      field: "active",
    })).toBeNull();
  });

  it("removes delegated listeners on destroy", () => {
    const h = setup();
    h.controller.destroy();
    h.input.click();
    expect(h.commitEdit).not.toHaveBeenCalled();
  });
});
