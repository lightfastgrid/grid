// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import type { ColumnDef, RowData } from "../../../types";
import type { EditingDeps } from "../EditingController";
import { EditingController } from "../EditingController";
import type { EditCommitChange } from "../editingTypes";

// ── Helpers ────────────────────────────────────────────────────────

function col(field: string, overrides: Partial<ColumnDef> = {}): ColumnDef {
  return { field, editable: true, ...overrides } as ColumnDef;
}

const rows: RowData[] = [
  { id: "r0", name: "Alice", age: 30, active: true, status: "a", joined: "2024-01-15" },
  { id: "r1", name: "Bob", age: 25, active: false, status: "b", joined: "2024-06-01" },
];

function makeCell(rowIndex: number, field: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "lfg-row";
  row.setAttribute("data-row-id", `r${rowIndex}`);
  row.setAttribute("data-row-index", String(rowIndex));
  const cell = document.createElement("div");
  cell.className = "lfg-cell";
  cell.setAttribute("data-col-id", field);
  row.appendChild(cell);
  return cell;
}

function makeDeps(overrides: Partial<EditingDeps> = {}): EditingDeps {
  return {
    getColumns: () => [
      col("name"),
      col("age"),
      col("active", { editor: "checkbox" }),
      col("status", { editor: { type: "select", options: ["a", "b", "c"] } }),
      col("joined", { editor: "date" }),
      col("readonly", { editable: false }),
      col("internal_col", { editable: true, internal: "selection" }),
    ],
    getDisplayRows: () => createArrayDisplayRowReader(rows),
    resolveRowId: (row) => String(row.id),
    getFocusedCell: () => null,
    setFocusedCell: vi.fn(),
    findCellElement: vi.fn(() => null),
    commitEdit: vi.fn(),
    onEditStarted: vi.fn(),
    onEditCommitted: vi.fn(),
    onEditCanceled: vi.fn(),
    ...overrides,
  };
}

function setupAttached(overrides: Partial<EditingDeps> = {}) {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  document.body.appendChild(root);
  document.body.appendChild(viewport);
  const cell = makeCell(0, "name");
  root.appendChild(cell.parentElement!);
  const deps = makeDeps({
    findCellElement: vi.fn(() => cell),
    ...overrides,
  });
  const ctrl = new EditingController(deps);
  ctrl.attach(root, viewport);
  return { ctrl, deps, root, viewport, cell };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("EditingController", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // ── startEdit ────────────────────────────────────────────────

  describe("startEdit", () => {
    it("rejects missing row", () => {
      const { ctrl } = setupAttached();
      const started = ctrl.startEdit({ rowIndex: 99, field: "name" });
      expect(started).toBe(false);
    });

    it("rejects missing field/column", () => {
      const { ctrl } = setupAttached();
      const started = ctrl.startEdit({ rowIndex: 0, field: "nonexistent" });
      expect(started).toBe(false);
    });

    it("rejects ineligible column", () => {
      const { ctrl } = setupAttached();
      const started = ctrl.startEdit({ rowIndex: 0, field: "readonly" });
      expect(started).toBe(false);
    });

    it("rejects internal column", () => {
      const { ctrl } = setupAttached();
      const started = ctrl.startEdit({ rowIndex: 0, field: "internal_col" });
      expect(started).toBe(false);
    });

    it("mounts exactly one editor host and one pooled editor", () => {
      const { ctrl, cell } = setupAttached();
      const started = ctrl.startEdit({ rowIndex: 0, field: "name" });
      expect(started).toBe(true);

      const hosts = cell.querySelectorAll(".lfg-cell-editor-host");
      expect(hosts).toHaveLength(1);
      expect(hosts[0]!.children).toHaveLength(1);
      expect((hosts[0] as HTMLElement).hidden).toBe(false);
      expect(cell.classList.contains("lfg-cell-editing")).toBe(true);
    });

    it("seeds editor with current value", () => {
      const { ctrl } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });
      const host = document.querySelector(".lfg-cell-editor-host")!;
      const input = host.querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("Alice");
    });

    it("seeds editor with charSeed when provided", () => {
      const { ctrl } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name", charSeed: "x" });
      const host = document.querySelector(".lfg-cell-editor-host")!;
      const input = host.querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("x");
    });

    it("resolves target by rowId", () => {
      const { ctrl, deps } = setupAttached();
      const started = ctrl.startEdit({ rowId: "r0", field: "name" });
      expect(started).toBe(true);
      expect(deps.onEditStarted).toHaveBeenCalledWith(
        expect.objectContaining({ rowId: "r0", rowIndex: 0, field: "name" }),
      );
    });

    it("fires onEditStarted", () => {
      const { ctrl, deps } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });
      expect(deps.onEditStarted).toHaveBeenCalledOnce();
    });

    it("returns false when findCellElement returns null", () => {
      const { ctrl } = setupAttached({
        findCellElement: vi.fn(() => null),
      });
      const started = ctrl.startEdit({ rowIndex: 0, field: "name" });
      expect(started).toBe(false);
    });
  });

  // ── Starting second edit commits first ───────────────────────

  describe("starting second edit commits first", () => {
    it("commits first edit before starting second", () => {
      const cell0 = makeCell(0, "name");
      const cell1 = makeCell(1, "name");
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell0.parentElement!);
      r.appendChild(cell1.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      let findReturn = cell0;
      const deps = makeDeps({
        findCellElement: vi.fn(() => findReturn),
      });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "name" });
      expect(c.getEditingCell()).toEqual({ rowId: "r0", field: "name" });

      findReturn = cell1;
      c.startEdit({ rowIndex: 1, field: "name" });
      expect(deps.onEditCommitted).toHaveBeenCalledTimes(1);
      expect(c.getEditingCell()).toEqual({ rowId: "r1", field: "name" });
    });
  });

  // ── stopEdit returns boolean ─────────────────────────────────

  describe("stopEdit returns boolean", () => {
    it("returns true when no active edit", () => {
      const { ctrl } = setupAttached();
      expect(ctrl.stopEdit({ commit: true })).toBe(true);
    });

    it("returns true on successful commit", () => {
      const { ctrl } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });
      expect(ctrl.stopEdit({ commit: true })).toBe(true);
    });

    it("returns true on cancel", () => {
      const { ctrl } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });
      expect(ctrl.stopEdit({ commit: false })).toBe(true);
    });

    it("returns false on parse failure", () => {
      const cell = makeCell(0, "status");
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      const deps = makeDeps({ findCellElement: vi.fn(() => cell) });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "status" });
      const select = cell.querySelector(".lfg-cell-editor-host select") as HTMLSelectElement;
      const badOpt = document.createElement("option");
      badOpt.value = "invalid_xyz";
      badOpt.textContent = "Bad";
      select.appendChild(badOpt);
      select.value = "invalid_xyz";

      expect(c.stopEdit({ commit: true })).toBe(false);
    });
  });

  // ── Invalid edit blocks new edit (Issue 1) ───────────────────

  describe("invalid edit blocks new edit", () => {
    it("active select edit with invalid value blocks starting another edit", () => {
      const statusCell = makeCell(0, "status");
      const nameCell = makeCell(1, "name");
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(statusCell.parentElement!);
      r.appendChild(nameCell.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      let currentFindCell: HTMLElement | null = statusCell;
      const deps = makeDeps({
        findCellElement: vi.fn(() => currentFindCell),
      });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "status" });
      expect(c.getEditingCell()).toEqual({ rowId: "r0", field: "status" });

      const select = statusCell.querySelector(".lfg-cell-editor-host select") as HTMLSelectElement;
      const badOpt = document.createElement("option");
      badOpt.value = "invalid_xyz";
      badOpt.textContent = "Bad";
      select.appendChild(badOpt);
      select.value = "invalid_xyz";

      currentFindCell = nameCell;
      const started = c.startEdit({ rowIndex: 1, field: "name" });

      expect(started).toBe(false);
      expect(c.getEditingCell()).toEqual({ rowId: "r0", field: "status" });
      expect(statusCell.classList.contains("lfg-cell-editing")).toBe(true);
      expect(statusCell.classList.contains("lfg-cell-editor-invalid")).toBe(true);
      expect(nameCell.querySelector(".lfg-cell-editor-host")).toBeNull();
      expect(deps.onEditStarted).toHaveBeenCalledTimes(1);
    });
  });

  // ── stopEdit cancel ──────────────────────────────────────────

  describe("stop cancel", () => {
    it("unmounts editor and emits cancel", () => {
      const { ctrl, deps, cell } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });
      ctrl.stopEdit({ commit: false });

      expect(ctrl.getEditingCell()).toBeNull();
      const host = cell.querySelector(".lfg-cell-editor-host") as HTMLElement;
      expect(host.hidden).toBe(true);
      expect(host.children).toHaveLength(0);
      expect(cell.classList.contains("lfg-cell-editing")).toBe(false);
      expect(deps.onEditCanceled).toHaveBeenCalledOnce();
    });
  });

  // ── stopEdit commit changed ──────────────────────────────────

  describe("Enter commit changed", () => {
    it("calls commitEdit once with updated row and metadata", () => {
      const { ctrl, deps } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });

      const input = document.querySelector(".lfg-cell-editor-host input") as HTMLInputElement;
      input.value = "Charlie";

      ctrl.stopEdit({ commit: true });

      expect(deps.commitEdit).toHaveBeenCalledOnce();
      const change = (deps.commitEdit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as EditCommitChange;
      expect(change.rowId).toBe("r0");
      expect(change.field).toBe("name");
      expect(change.oldValue).toBe("Alice");
      expect(change.newValue).toBe("Charlie");
      expect(change.updatedRow).toEqual({ id: "r0", name: "Charlie", age: 30, active: true, status: "a", joined: "2024-01-15" });
      expect(change.topLevelField).toBe("name");

      expect(deps.onEditCommitted).toHaveBeenCalledWith(
        expect.objectContaining({ changed: true }),
      );
    });
  });

  // ── same-value commit ────────────────────────────────────────

  describe("same-value commit", () => {
    it("emits committed changed=false and does not call commitEdit", () => {
      const { ctrl, deps } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });
      // value stays "Alice"
      ctrl.stopEdit({ commit: true });

      expect(deps.commitEdit).not.toHaveBeenCalled();
      expect(deps.onEditCommitted).toHaveBeenCalledWith(
        expect.objectContaining({ changed: false }),
      );
    });
  });

  // ── Parse failure ────────────────────────────────────────────

  describe("parse failure keeps editor open", () => {
    it("publishes a pertinent error, keeps focus, and clears on correction", () => {
      const cell = makeCell(0, "status");
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      const deps = makeDeps({ findCellElement: vi.fn(() => cell) });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "status" });
      const select = cell.querySelector(".lfg-cell-editor-host select") as HTMLSelectElement;
      const badOpt = document.createElement("option");
      badOpt.value = "invalid_xyz";
      badOpt.textContent = "Bad";
      select.appendChild(badOpt);
      select.value = "invalid_xyz";

      c.stopEdit({ commit: true });

      expect(c.getEditingCell()).toEqual({ rowId: "r0", field: "status" });
      expect(cell.classList.contains("lfg-cell-editor-invalid")).toBe(true);
      expect(select.getAttribute("aria-invalid")).toBe("true");
      const errorId = select.getAttribute("aria-errormessage");
      expect(errorId).toMatch(/^lfg-editor-error-[1-9]\d*$/);
      const error = document.getElementById(errorId!);
      expect(error?.textContent).toBe("Unknown option: invalid_xyz");
      expect(error?.hidden).toBe(false);
      expect(document.activeElement).toBe(select);
      expect(deps.commitEdit).not.toHaveBeenCalled();
      expect(deps.onEditCommitted).not.toHaveBeenCalled();
      expect(deps.onEditCanceled).not.toHaveBeenCalled();

      select.value = "a";
      expect(c.stopEdit({ commit: true })).toBe(true);
      expect(select.hasAttribute("aria-invalid")).toBe(false);
      expect(select.hasAttribute("aria-errormessage")).toBe(false);
      expect(document.getElementById(errorId!)).toBeNull();
      expect(cell.classList.contains("lfg-cell-editor-invalid")).toBe(false);
    });

    it("enforces required text and clears its error on cancel", () => {
      const { ctrl, cell } = setupAttached({
        getColumns: () => [
          col("name", { editor: { type: "text", required: true } }),
        ],
      });
      expect(ctrl.startEdit({ rowIndex: 0, field: "name" })).toBe(true);
      const input = cell.querySelector<HTMLInputElement>(
        ".lfg-cell-editor-host input",
      )!;
      input.value = "  ";

      expect(ctrl.stopEdit({ commit: true })).toBe(false);
      expect(input.getAttribute("aria-required")).toBe("true");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const errorId = input.getAttribute("aria-errormessage")!;
      expect(document.getElementById(errorId)?.textContent).toBe(
        "Value is required",
      );

      expect(ctrl.stopEdit({ commit: false })).toBe(true);
      expect(input.hasAttribute("aria-invalid")).toBe(false);
      expect(input.hasAttribute("aria-errormessage")).toBe(false);
      expect(document.getElementById(errorId)).toBeNull();
    });
  });

  // ── Commit resolves row by rowId (Issue 2) ───────────────────

  describe("commit resolves row by rowId, not stale rowIndex", () => {
    it("uses current row data and resolved index after reorder", () => {
      const cell = makeCell(0, "name");
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      const reorderedRows: RowData[][] = [
        [
          { id: "r0", name: "Alice", age: 30, active: true, status: "a" },
          { id: "r1", name: "Bob", age: 25, active: false, status: "b" },
        ],
      ];

      const deps = makeDeps({
        findCellElement: vi.fn(() => cell),
        getDisplayRows: () => createArrayDisplayRowReader(reorderedRows[0]!),
      });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "name" });

      const input = cell.querySelector(".lfg-cell-editor-host input") as HTMLInputElement;
      input.value = "Updated";

      reorderedRows[0] = [
        { id: "r1", name: "Bob", age: 25, active: false, status: "b" },
        { id: "r0", name: "Alice", age: 30, active: true, status: "a" },
      ];

      c.stopEdit({ commit: true });

      expect(deps.commitEdit).toHaveBeenCalledOnce();
      const change = (deps.commitEdit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as EditCommitChange;
      expect(change.rowId).toBe("r0");
      expect(change.rowIndex).toBe(1);
      expect(change.updatedRow).toEqual({ id: "r0", name: "Updated", age: 30, active: true, status: "a" });
    });

    it("cancels when rowId cannot be found during commit", () => {
      const cell = makeCell(0, "name");
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      let currentRows: RowData[] = [
        { id: "r0", name: "Alice", age: 30, active: true, status: "a" },
      ];
      const deps = makeDeps({
        findCellElement: vi.fn(() => cell),
        getDisplayRows: () => createArrayDisplayRowReader(currentRows),
      });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "name" });
      currentRows = [];

      c.stopEdit({ commit: true });

      expect(c.getEditingCell()).toBeNull();
      expect(deps.commitEdit).not.toHaveBeenCalled();
      expect(deps.onEditCanceled).toHaveBeenCalledOnce();
    });
  });

  // ── Escape cancels ───────────────────────────────────────────

  describe("Escape cancels", () => {
    it("Escape key cancels active edit", () => {
      const { ctrl, deps, root } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });

      root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(ctrl.getEditingCell()).toBeNull();
      expect(deps.onEditCanceled).toHaveBeenCalledOnce();
    });
  });

  // ── Blur commits ─────────────────────────────────────────────

  describe("blur commits", () => {
    it("focusout commits active edit", () => {
      const { ctrl, deps, root } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });

      root.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
      expect(ctrl.getEditingCell()).toBeNull();
      expect(deps.onEditCommitted).toHaveBeenCalledOnce();
    });

    it("date editor defers blur commit when relatedTarget is null (native picker)", () => {
      vi.useFakeTimers();
      const cell = makeCell(0, "joined");
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      const deps = makeDeps({ findCellElement: vi.fn(() => cell) });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "joined" });
      expect(c.getEditingCell()).not.toBeNull();

      r.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
      expect(c.getEditingCell()).not.toBeNull();

      // Move focus outside the editor so the deferred check commits
      const outside = document.createElement("button");
      outside.tabIndex = -1;
      document.body.appendChild(outside);
      outside.focus();

      vi.advanceTimersByTime(200);
      expect(c.getEditingCell()).toBeNull();

      c.destroy();
      vi.useRealTimers();
    });

    it("date editor cancels deferred blur if focus returns to editor", () => {
      vi.useFakeTimers();
      const cell = makeCell(0, "joined");
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      const deps = makeDeps({ findCellElement: vi.fn(() => cell) });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "joined" });
      const input = cell.querySelector("input") as HTMLInputElement;

      r.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
      expect(c.getEditingCell()).not.toBeNull();

      // Simulate focus returning to the date input (picker closed, focus back)
      input.focus();

      vi.advanceTimersByTime(200);
      // Edit should still be active because focus is back in the editor
      expect(c.getEditingCell()).not.toBeNull();

      c.destroy();
      vi.useRealTimers();
    });

    it("non-date editor commits immediately on blur with null relatedTarget", () => {
      const { ctrl, deps, root } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });

      root.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
      expect(ctrl.getEditingCell()).toBeNull();
      expect(deps.onEditCommitted).toHaveBeenCalledOnce();
    });
  });

  // ── Select change commits ────────────────────────────────────

  describe("select change commits", () => {
    it("change event on select commits", () => {
      const cell = makeCell(0, "status");
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      const deps = makeDeps({ findCellElement: vi.fn(() => cell) });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "status" });
      expect(c.getEditingCell()).not.toBeNull();

      const select = cell.querySelector("select") as HTMLSelectElement;
      select.value = "c";
      select.dispatchEvent(new Event("change", { bubbles: true }));

      expect(c.getEditingCell()).toBeNull();
      expect(deps.onEditCommitted).toHaveBeenCalledOnce();
    });
  });

  // ── Change from unrelated control is ignored (Issue 4) ───────

  describe("change from unrelated control is ignored", () => {
    it("change event from a separate control under root does not commit", () => {
      const cell = makeCell(0, "status");
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      const otherSelect = document.createElement("select");
      r.appendChild(otherSelect);

      const deps = makeDeps({ findCellElement: vi.fn(() => cell) });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "status" });
      expect(c.getEditingCell()).not.toBeNull();

      otherSelect.dispatchEvent(new Event("change", { bubbles: true }));

      expect(c.getEditingCell()).toEqual({ rowId: "r0", field: "status" });
      expect(deps.onEditCommitted).not.toHaveBeenCalled();
    });
  });

  // ── Checkbox presentation activation ─────────────────────────

  describe("checkbox presentation activation", () => {
    it("single click on the exact checkbox input commits without an editor", () => {
      const cell = makeCell(0, "active");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = true;
      input.className = "lfg-cell-shell-checkbox-input";
      cell.appendChild(input);
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      const deps = makeDeps({
        findCellElement: vi.fn(() => cell),
        getColumns: () => [
          col("active", { editor: "checkbox", cellShell: "checkbox" }),
        ],
      });
      const c = new EditingController(deps);
      c.attach(r, v);

      input.click();

      expect(deps.commitEdit).toHaveBeenCalledOnce();
      const change = (deps.commitEdit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as EditCommitChange;
      expect(change.oldValue).toBe(true);
      expect(change.newValue).toBe(false);
      expect(c.getEditingCell()).toBeNull();
      expect(cell.querySelector(".lfg-cell-editor-host")).toBeNull();
      expect(deps.onEditStarted).not.toHaveBeenCalled();
    });

    it("does not activate shell padding or the cell background", () => {
      const cell = makeCell(0, "active");
      const shell = document.createElement("span");
      shell.className = "lfg-cell-shell-checkbox";
      cell.appendChild(shell);
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      const deps = makeDeps({ findCellElement: vi.fn(() => cell) });
      const c = new EditingController(deps);
      c.attach(r, v);

      shell.click();
      cell.click();
      expect(deps.commitEdit).not.toHaveBeenCalled();
    });

    it("restores the authoritative value when commit fails or throws", () => {
      const cell = makeCell(0, "active");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = true;
      input.className = "lfg-cell-shell-checkbox-input";
      cell.appendChild(input);
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      const error = new Error("commit failed");
      const deps = makeDeps({
        findCellElement: vi.fn(() => cell),
        getColumns: () => [
          col("active", { editor: "checkbox", cellShell: "checkbox" }),
        ],
        commitEdit: vi.fn(() => {
          throw error;
        }),
      });
      const c = new EditingController(deps);
      c.attach(r, v);

      input.checked = false;
      const event = new MouseEvent("click", { bubbles: true, button: 0 });
      Reflect.defineProperty(event, "target", { value: input });
      const handler: unknown = Reflect.get(c, "handleClick");
      if (typeof handler !== "function") {
        throw new Error("Expected delegated click handler");
      }
      expect(() => Reflect.apply(handler, c, [event])).toThrow(error);
      expect(input.checked).toBe(true);
      expect(c.getEditingCell()).toBeNull();
    });
  });

  // ── Double-click starts ──────────────────────────────────────

  describe("double-click starts", () => {
    it("dblclick on cell starts edit", () => {
      const { ctrl, deps, cell } = setupAttached();
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      expect(ctrl.getEditingCell()).toEqual({ rowId: "r0", field: "name" });
      expect(deps.onEditStarted).toHaveBeenCalledOnce();
    });
  });

  // ── Printable key starts with typed character ────────────────

  describe("printable key starts", () => {
    it("ignores keys already consumed by the accessibility owner", () => {
      const { ctrl, root, deps } = setupAttached({
        getFocusedCell: () => ({ rowIndex: 0, field: "name" }),
      });
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();
      root.dispatchEvent(event);
      expect(ctrl.getEditingCell()).toBeNull();
      expect(deps.onEditStarted).not.toHaveBeenCalled();
    });

    it("supports F2 for edit-gated cells and rejects toggle-mode editor mounting", () => {
      const editCell = makeCell(0, "active");
      const root = document.createElement("div");
      const viewport = document.createElement("div");
      root.appendChild(editCell.parentElement!);
      const mode = { current: "edit" as "edit" | "toggle" };
      const deps = makeDeps({
        getFocusedCell: () => ({ rowIndex: 0, field: "active" }),
        getColumns: () => [
          col("active", {
            cellShell: "checkbox",
            editor: { type: "checkbox", activation: mode.current },
          }),
        ],
        findCellElement: () => editCell,
      });
      const ctrl = new EditingController(deps);
      ctrl.attach(root, viewport);

      const editEvent = new KeyboardEvent("keydown", {
        key: "F2",
        bubbles: true,
        cancelable: true,
      });
      root.dispatchEvent(editEvent);
      expect(editEvent.defaultPrevented).toBe(true);
      expect(ctrl.getEditingCell()).toEqual({ rowId: "r0", field: "active" });
      ctrl.stopEdit({ commit: false });

      mode.current = "toggle";
      const toggleEvent = new KeyboardEvent("keydown", {
        key: "F2",
        bubbles: true,
        cancelable: true,
      });
      root.dispatchEvent(toggleEvent);
      expect(ctrl.getEditingCell()).toBeNull();
      expect(editCell.querySelector(".lfg-cell-editor-host:not([hidden])")).toBeNull();
    });

    it("printable key on focused cell starts edit seeded with character", () => {
      const { ctrl, root } = setupAttached({
        getFocusedCell: () => ({ rowIndex: 0, field: "name" }),
      });

      root.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));

      expect(ctrl.getEditingCell()).toEqual({ rowId: "r0", field: "name" });
      const input = document.querySelector(".lfg-cell-editor-host input") as HTMLInputElement;
      expect(input.value).toBe("x");
    });

    it("does not start for ctrl+key", () => {
      const { ctrl, root } = setupAttached({
        getFocusedCell: () => ({ rowIndex: 0, field: "name" }),
      });

      root.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true }));
      expect(ctrl.getEditingCell()).toBeNull();
    });
  });

  // ── Keyboard guard: unrelated inputs ─────────────────────────

  describe("keyboard guard for unrelated inputs", () => {
    it("printable key from unrelated input inside root does not start edit", () => {
      const { ctrl, root } = setupAttached({
        getFocusedCell: () => ({ rowIndex: 0, field: "name" }),
      });

      const unrelatedInput = document.createElement("input");
      root.appendChild(unrelatedInput);
      unrelatedInput.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));

      expect(ctrl.getEditingCell()).toBeNull();
    });

    it("Enter from unrelated input inside root does not start edit", () => {
      const { ctrl, root } = setupAttached({
        getFocusedCell: () => ({ rowIndex: 0, field: "name" }),
      });

      const unrelatedInput = document.createElement("input");
      root.appendChild(unrelatedInput);
      unrelatedInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      expect(ctrl.getEditingCell()).toBeNull();
    });

    it("printable key from unrelated select inside root does not start edit", () => {
      const { ctrl, root } = setupAttached({
        getFocusedCell: () => ({ rowIndex: 0, field: "name" }),
      });

      const unrelatedSelect = document.createElement("select");
      root.appendChild(unrelatedSelect);
      unrelatedSelect.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

      expect(ctrl.getEditingCell()).toBeNull();
    });

    it("printable key from unrelated textarea inside root does not start edit", () => {
      const { ctrl, root } = setupAttached({
        getFocusedCell: () => ({ rowIndex: 0, field: "name" }),
      });

      const textarea = document.createElement("textarea");
      root.appendChild(textarea);
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));

      expect(ctrl.getEditingCell()).toBeNull();
    });

    it("Enter commits active edit even when target is the editor input", () => {
      const { ctrl, deps, cell } = setupAttached({
        getFocusedCell: () => ({ rowIndex: 0, field: "name" }),
      });

      ctrl.startEdit({ rowIndex: 0, field: "name" });
      const editorInput = cell.querySelector(".lfg-cell-editor-host input") as HTMLInputElement;
      editorInput.value = "Changed";

      editorInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      expect(ctrl.getEditingCell()).toBeNull();
      expect(deps.onEditCommitted).toHaveBeenCalledOnce();
    });
  });

  // ── Enter on focused cell starts ─────────────────────────────

  describe("Enter on focused cell", () => {
    it("Enter starts edit on focused editable cell", () => {
      const { ctrl, deps, root } = setupAttached({
        getFocusedCell: () => ({ rowIndex: 0, field: "name" }),
      });

      root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      expect(ctrl.getEditingCell()).toEqual({ rowId: "r0", field: "name" });
      expect(deps.onEditStarted).toHaveBeenCalledOnce();
    });
  });

  // ── Scroll commits ───────────────────────────────────────────

  describe("scroll commits", () => {
    it("viewport scroll commits active edit", () => {
      const { ctrl, deps, viewport } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });

      viewport.dispatchEvent(new Event("scroll"));
      expect(ctrl.getEditingCell()).toBeNull();
      expect(deps.onEditCommitted).toHaveBeenCalledOnce();
    });
  });

  // ── syncAfterRender ──────────────────────────────────────────

  describe("syncAfterRender", () => {
    it("commits when cell disappears", () => {
      let cellVisible: HTMLElement | null;
      const cell = makeCell(0, "name");
      cellVisible = cell;
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      const deps = makeDeps({
        findCellElement: vi.fn(() => cellVisible),
      });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "name" });
      expect(c.getEditingCell()).not.toBeNull();

      cellVisible = null;
      c.syncAfterRender();

      expect(c.getEditingCell()).toBeNull();
      expect(deps.onEditCommitted).toHaveBeenCalledOnce();
    });

    it("re-mounts editor into new cell element after recycle", () => {
      const cell1 = makeCell(0, "name");
      const cell2 = makeCell(0, "name");
      let currentCell = cell1;
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell1.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      const deps = makeDeps({
        findCellElement: vi.fn(() => currentCell),
      });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "name" });
      expect(cell1.querySelector(".lfg-cell-editor-host")).not.toBeNull();

      r.appendChild(cell2.parentElement!);
      currentCell = cell2;
      c.syncAfterRender();

      expect(cell2.querySelector(".lfg-cell-editor-host")).not.toBeNull();
      expect(cell2.classList.contains("lfg-cell-editing")).toBe(true);
      expect(cell1.classList.contains("lfg-cell-editing")).toBe(false);
      expect(c.getEditingCell()).toEqual({ rowId: "r0", field: "name" });
    });

    it("moves the same invalid editor and error node after recycle", () => {
      const cell1 = makeCell(0, "status");
      const cell2 = makeCell(0, "status");
      let currentCell = cell1;
      const root = document.createElement("div");
      const viewport = document.createElement("div");
      root.appendChild(cell1.parentElement!);
      document.body.appendChild(root);
      document.body.appendChild(viewport);

      const deps = makeDeps({
        getColumns: () => [
          col("status", {
            editor: {
              type: "select",
              options: ["a", "b"],
              required: true,
            },
          }),
        ],
        findCellElement: vi.fn(() => currentCell),
      });
      const controller = new EditingController(deps);
      controller.attach(root, viewport);
      controller.startEdit({ rowIndex: 0, field: "status" });

      const select = cell1.querySelector<HTMLSelectElement>(
        ".lfg-cell-editor-host select",
      )!;
      const invalid = document.createElement("option");
      invalid.value = "invalid";
      select.appendChild(invalid);
      select.value = "invalid";
      expect(controller.stopEdit({ commit: true })).toBe(false);
      const errorId = select.getAttribute("aria-errormessage")!;
      const error = document.getElementById(errorId)!;

      root.appendChild(cell2.parentElement!);
      currentCell = cell2;
      controller.syncAfterRender();

      expect(
        cell2.querySelector(".lfg-cell-editor-host select"),
      ).toBe(select);
      expect(cell2.querySelector(".lfg-editor-error")).toBe(error);
      expect(select.getAttribute("aria-errormessage")).toBe(errorId);
      expect(select.getAttribute("aria-required")).toBe("true");
      expect(error.textContent).toBe("Unknown option: invalid");
      expect(cell1.classList).not.toContain("lfg-cell-editor-invalid");
      expect(cell2.classList).toContain("lfg-cell-editor-invalid");
      expect(document.querySelectorAll(`#${errorId}`)).toHaveLength(1);

      controller.stopEdit({ commit: false });
    });
  });

  // ── No per-cell listeners ────────────────────────────────────

  describe("no per-cell listeners", () => {
    it("all listeners are on root or viewport, not individual cells", () => {
      const cell = makeCell(0, "name");
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      const addSpy = vi.spyOn(cell, "addEventListener");

      const deps = makeDeps({ findCellElement: vi.fn(() => cell) });
      const c = new EditingController(deps);
      c.attach(r, v);
      c.startEdit({ rowIndex: 0, field: "name" });
      c.stopEdit({ commit: false });

      expect(addSpy).not.toHaveBeenCalled();
    });
  });

  // ── Pooled editor reuse ──────────────────────────────────────

  describe("pooled editor reuse", () => {
    it("reuses same editor element across start/stop cycles", () => {
      const { ctrl, cell } = setupAttached();

      ctrl.startEdit({ rowIndex: 0, field: "name" });
      const firstInput = cell.querySelector(".lfg-cell-editor-host input")!;
      ctrl.stopEdit({ commit: false });

      ctrl.startEdit({ rowIndex: 0, field: "name" });
      const secondInput = cell.querySelector(".lfg-cell-editor-host input")!;

      expect(secondInput).toBe(firstInput);
    });
  });

  // ── destroy ──────────────────────────────────────────────────

  describe("destroy", () => {
    it("cleans up active edit and detaches listeners", () => {
      const { ctrl } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });
      ctrl.destroy();
      expect(ctrl.getEditingCell()).toBeNull();
    });
  });

  // ── getEditingCell ───────────────────────────────────────────

  describe("getEditingCell", () => {
    it("returns null when not editing", () => {
      const { ctrl } = setupAttached();
      expect(ctrl.getEditingCell()).toBeNull();
    });
  });

  // ── Deferred teardown for changed commits ───────────────────

  describe("deferred teardown on changed commit", () => {
    it("keeps editor host visible until deferred frame fires", async () => {
      const { ctrl, cell } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });

      const input = cell.querySelector(".lfg-cell-editor-host input") as HTMLInputElement;
      input.value = "Changed";
      ctrl.stopEdit({ commit: true });

      const host = cell.querySelector(".lfg-cell-editor-host") as HTMLElement;
      expect(host.hidden).toBe(false);
      expect(host.children.length).toBeGreaterThan(0);

      await new Promise<void>((r) => requestAnimationFrame(() => r()));

      expect(host.hidden).toBe(true);
      expect(host.children.length).toBe(0);
    });

    it("clears editing store immediately after changed commit", () => {
      const { ctrl } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });

      const input = document.querySelector(".lfg-cell-editor-host input") as HTMLInputElement;
      input.value = "Changed";
      ctrl.stopEdit({ commit: true });

      expect(ctrl.getEditingCell()).toBeNull();
    });

    it("starting a new edit flushes pending deferred teardown", () => {
      const cell0 = makeCell(0, "name");
      const cell1 = makeCell(1, "name");
      const r = document.createElement("div");
      const v = document.createElement("div");
      r.appendChild(cell0.parentElement!);
      r.appendChild(cell1.parentElement!);
      document.body.appendChild(r);
      document.body.appendChild(v);

      let findReturn = cell0;
      const deps = makeDeps({
        findCellElement: vi.fn(() => findReturn),
      });
      const c = new EditingController(deps);
      c.attach(r, v);

      c.startEdit({ rowIndex: 0, field: "name" });
      const input0 = cell0.querySelector(".lfg-cell-editor-host input") as HTMLInputElement;
      input0.value = "Changed";
      c.stopEdit({ commit: true });

      const host0 = cell0.querySelector(".lfg-cell-editor-host") as HTMLElement;
      expect(host0.hidden).toBe(false);

      findReturn = cell1;
      c.startEdit({ rowIndex: 1, field: "name" });

      expect(host0.hidden).toBe(true);
      expect(host0.children.length).toBe(0);

      c.destroy();
    });

    it("cancel and unchanged commit still teardown immediately", () => {
      const { ctrl, cell } = setupAttached();

      ctrl.startEdit({ rowIndex: 0, field: "name" });
      ctrl.stopEdit({ commit: false });
      const host = cell.querySelector(".lfg-cell-editor-host") as HTMLElement;
      expect(host.hidden).toBe(true);

      ctrl.startEdit({ rowIndex: 0, field: "name" });
      ctrl.stopEdit({ commit: true });
      expect(host.hidden).toBe(true);
    });

    it("no-op stopEdit after changed commit does not flush deferred teardown", async () => {
      const { ctrl, cell } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });

      const input = cell.querySelector(".lfg-cell-editor-host input") as HTMLInputElement;
      input.value = "Changed";
      ctrl.stopEdit({ commit: true });

      const host = cell.querySelector(".lfg-cell-editor-host") as HTMLElement;
      expect(host.hidden).toBe(false);

      ctrl.stopEdit({ commit: true });
      expect(host.hidden).toBe(false);

      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      expect(host.hidden).toBe(true);
    });

    it("focusout after changed commit does not flush deferred teardown", async () => {
      const { ctrl, cell, root } = setupAttached();
      ctrl.startEdit({ rowIndex: 0, field: "name" });

      const input = cell.querySelector(".lfg-cell-editor-host input") as HTMLInputElement;
      input.value = "Changed";
      ctrl.stopEdit({ commit: true });

      const host = cell.querySelector(".lfg-cell-editor-host") as HTMLElement;
      expect(host.hidden).toBe(false);

      root.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
      expect(host.hidden).toBe(false);

      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      expect(host.hidden).toBe(true);
    });
  });
});
