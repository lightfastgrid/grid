// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { PooledCell } from "../../../internal/poolTypes";
import type { DisplayRowReader } from "../../../rendering/rowViewAccess";
import type {
  CellShellConfig,
  ColumnDef,
  LightFastGridCellShellActionEvent,
  RowData,
} from "../../../types";
import { CellShellActionController } from "../CellShellActionController";
import { isCellShellActionTarget } from "../cellShellActionDom";
import { bindCellShell } from "../CellShellManager";

const COLUMN: ColumnDef = { field: "actionsCol" };
const ROWS: RowData[] = [{ id: "r1", actionsCol: "hello" }];

function reader(rows: RowData[]): DisplayRowReader {
  return {
    get rowCount() {
      return rows.length;
    },
    getRowData: (i) => rows[i],
    getSourceIndex: (i) => i,
    getRow: (i) => {
      const row = rows[i];
      return row ? { displayIndex: i, sourceIndex: i, row } : null;
    },
  };
}

/**
 * Build a realistic root → row → cell → shell tree using the real
 * CellShellManager so the shell carries the same `data-action` it does in
 * production.
 */
function buildTree(config: CellShellConfig): {
  root: HTMLElement;
  cell: PooledCell;
  shellRoot: HTMLElement;
} {
  const root = document.createElement("div");

  const rowEl = document.createElement("div");
  rowEl.className = "lfg-row";
  rowEl.setAttribute("data-row-id", "r1");
  rowEl.setAttribute("data-row-index", "0");

  const cellEl = document.createElement("div");
  cellEl.className = "lfg-cell";
  cellEl.setAttribute("data-col-id", "actionsCol");

  const cell: PooledCell = { element: cellEl, value: "" };
  bindCellShell(
    cell,
    {
      row: ROWS[0]!,
      rowId: "r1",
      rowIndex: 0,
      column: COLUMN,
      field: "actionsCol",
      value: "hello",
      formattedValue: "hello",
    },
    config,
  );

  rowEl.appendChild(cellEl);
  root.appendChild(rowEl);
  document.body.appendChild(root);

  return { root, cell, shellRoot: cell.shellRoot! };
}

function makeController(
  root: HTMLElement,
  onCellShellAction: (e: LightFastGridCellShellActionEvent) => void,
): CellShellActionController {
  const controller = new CellShellActionController({
    getColumns: () => [COLUMN],
    getDisplayRows: () => reader(ROWS),
    resolveRowId: (row) => (row as { id: string }).id,
    onCellShellAction,
  });
  controller.attach(root);
  return controller;
}

function clickLeft(el: Element): MouseEvent {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  el.dispatchEvent(ev);
  return ev;
}

describe("CellShellActionController", () => {
  it("fires callback with row/column/action context for a button shell", () => {
    const { root, shellRoot } = buildTree({
      kind: "button",
      actionKey: "edit",
      text: { literal: "Edit" },
    });
    const spy = vi.fn();
    makeController(root, spy);

    clickLeft(shellRoot);

    expect(spy).toHaveBeenCalledTimes(1);
    const e = spy.mock.calls[0]![0] as LightFastGridCellShellActionEvent;
    expect(e.actionKey).toBe("edit");
    expect(e.rowId).toBe("r1");
    expect(e.rowIndex).toBe(0);
    expect(e.field).toBe("actionsCol");
    expect(e.column).toBe(COLUMN);
    expect(e.row).toBe(ROWS[0]);
    expect(e.value).toBe("hello");
    expect(e.formattedValue).toBe("hello");
    expect(e.originalEvent).toBeInstanceOf(MouseEvent);
  });

  it("fires callback for an iconButton shell", () => {
    const { root, shellRoot } = buildTree({
      kind: "iconButton",
      actionKey: "remove",
      icon: "🗑",
    });
    const spy = vi.fn();
    makeController(root, spy);

    clickLeft(shellRoot);

    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as LightFastGridCellShellActionEvent).actionKey).toBe(
      "remove",
    );
  });

  it("fires callback for a link shell when clicking a child element", () => {
    const { root, shellRoot } = buildTree({
      kind: "link",
      actionKey: "open",
      text: { literal: "Open" },
    });
    const spy = vi.fn();
    makeController(root, spy);

    // Click the inner label span, not the shell root — closest() must resolve.
    const label = shellRoot.querySelector(".lfg-cell-shell-label")!;
    clickLeft(label);

    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as LightFastGridCellShellActionEvent).actionKey).toBe(
      "open",
    );
  });

  it("does not fire for a shell without actionKey", () => {
    const { root, shellRoot } = buildTree({ kind: "button", text: { literal: "x" } });
    const spy = vi.fn();
    makeController(root, spy);

    clickLeft(shellRoot);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stops propagation so a later root listener (selection) never sees the click", () => {
    const { root, shellRoot } = buildTree({
      kind: "button",
      actionKey: "edit",
      text: { literal: "Edit" },
    });
    const actionSpy = vi.fn();
    // Controller attaches its listener first…
    makeController(root, actionSpy);
    // …then a stand-in for the selection controller on the same root.
    const selectionSpy = vi.fn();
    root.addEventListener("click", selectionSpy);

    clickLeft(shellRoot);

    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect(selectionSpy).not.toHaveBeenCalled();
  });

  it("creates no per-cell listeners when shells are built", () => {
    const cellEl = document.createElement("div");
    const addSpy = vi.spyOn(cellEl, "addEventListener");
    const cell: PooledCell = { element: cellEl, value: "" };

    bindCellShell(
      cell,
      {
        row: ROWS[0]!,
        rowId: "r1",
        rowIndex: 0,
        column: COLUMN,
        field: "actionsCol",
        value: "hello",
        formattedValue: "hello",
      },
      { kind: "button", actionKey: "edit", text: { literal: "Edit" } },
    );

    expect(addSpy).not.toHaveBeenCalled();
  });

  it("does not swallow click when action DOM lacks row/cell context", () => {
    const root = document.createElement("div");

    // Shell with data-action but no enclosing .lfg-cell or [data-row-id]
    const orphanShell = document.createElement("span");
    orphanShell.className = "lfg-cell-shell";
    orphanShell.setAttribute("data-action", "edit");
    root.appendChild(orphanShell);
    document.body.appendChild(root);

    const actionSpy = vi.fn();
    makeController(root, actionSpy);

    const laterSpy = vi.fn();
    root.addEventListener("click", laterSpy);

    clickLeft(orphanShell);

    expect(actionSpy).not.toHaveBeenCalled();
    // Click must NOT be swallowed — later listeners still fire.
    expect(laterSpy).toHaveBeenCalledTimes(1);
  });

  it("fires correct actionKey when clicking a buttonGroup child", () => {
    const { root } = buildTree({
      kind: "buttonGroup",
      parts: [
        { kind: "iconButton", icon: "👁", text: { literal: "View" }, actionKey: "view" },
        { kind: "button", text: { literal: "Edit" }, actionKey: "edit" },
      ],
    });
    const spy = vi.fn();
    makeController(root, spy);

    const buttons = root.querySelectorAll(".lfg-cell-shell-group-button");
    clickLeft(buttons[1]!);

    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as LightFastGridCellShellActionEvent).actionKey).toBe("edit");
  });

  it("fires correct actionKey when clicking icon inside a buttonGroup child", () => {
    const { root } = buildTree({
      kind: "buttonGroup",
      parts: [
        { kind: "iconButton", icon: "👁", text: { literal: "View" }, actionKey: "view" },
      ],
    });
    const spy = vi.fn();
    makeController(root, spy);

    const icon = root.querySelector(".lfg-cell-shell-group-button-icon")!;
    clickLeft(icon);

    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as LightFastGridCellShellActionEvent).actionKey).toBe("view");
  });

  it("row selection skip helper recognizes buttonGroup child with actionKey", () => {
    const { root } = buildTree({
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "Go" }, actionKey: "go" },
      ],
    });
    const btn = root.querySelector(".lfg-cell-shell-group-button")!;
    expect(isCellShellActionTarget(btn)).toBe(true);
  });

  it("row selection skip helper recognizes buttonGroup child without actionKey", () => {
    const { root } = buildTree({
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "Plain" } },
      ],
    });
    const btn = root.querySelector(".lfg-cell-shell-group-button")!;
    expect(btn.hasAttribute("data-action")).toBe(false);
    expect(isCellShellActionTarget(btn)).toBe(true);
  });

  it("detach removes the delegated listener", () => {
    const { root, shellRoot } = buildTree({
      kind: "button",
      actionKey: "edit",
      text: { literal: "Edit" },
    });
    const spy = vi.fn();
    const controller = makeController(root, spy);

    controller.detach();
    clickLeft(shellRoot);

    expect(spy).not.toHaveBeenCalled();
  });
});
