// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VisualRowLayout } from "../../../../internal/layoutTypes";
import type { ColumnDef } from "../../../../types";
import {
  KeyboardNavigationController,
  type KeyboardNavigationControllerHost,
} from "../KeyboardNavigationController";
import { setBodyCellTarget } from "../keyboardTarget";

const ROW_LAYOUT: VisualRowLayout = {
  topDisplayIndexes: [],
  centerRowCount: 3,
  centerToDisplayIndex: null,
  bottomDisplayIndexes: [],
};

function key(
  target: HTMLElement,
  value: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function setup(
  overrides: Partial<KeyboardNavigationControllerHost> = {},
  columns: readonly ColumnDef[] = [
    { field: "a", sortable: true },
    { field: "b", sortable: true },
  ],
): {
  controller: KeyboardNavigationController;
  surface: HTMLDivElement;
  cell: HTMLDivElement;
} {
  const surface = document.createElement("div");
  surface.tabIndex = 0;
  const cell = document.createElement("div");
  cell.id = "cell-a";
  surface.appendChild(cell);
  document.body.appendChild(surface);
  const controller = new KeyboardNavigationController();
  controller.attach({
    surface,
    readPageSize: () => 2,
    readWritingDirection: () => "ltr",
    resolveTargetElement: () => cell,
    ...overrides,
  });
  controller.syncRowLayout(ROW_LAYOUT);
  controller.syncTopology({ columns, hasFloatingFilterRow: false });
  return { controller, surface, cell };
}

describe("Accessibility V2 K5 commands", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("157: leaf Enter, Space, and Shift+Enter submit exact sort modes", () => {
    const toggleSort = vi.fn(() => true);
    const { controller, surface } = setup({ toggleSort });
    controller.syncRowLayout({
      topDisplayIndexes: [],
      centerRowCount: 0,
      centerToDisplayIndex: null,
      bottomDisplayIndexes: [],
    });
    controller.move("firstTarget");

    expect(key(surface, "Enter").defaultPrevented).toBe(true);
    expect(key(surface, "Enter", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(key(surface, " ").defaultPrevented).toBe(true);
    expect(toggleSort.mock.calls).toEqual([
      ["a", false],
      ["a", true],
      ["a", false],
    ]);
  });

  it("158-161: row and column selection shortcuts call only scalar owners", () => {
    const toggleRowSelection = vi.fn(() => true);
    const selectRow = vi.fn(() => true);
    const extendRowSelection = vi.fn(() => true);
    const toggleAllRows = vi.fn(() => true);
    const toggleColumnSelection = vi.fn(() => true);
    const focusBodyCell = vi.fn(() => true);
    const { controller, surface } = setup({
      toggleRowSelection,
      selectRow,
      extendRowSelection,
      toggleAllRows,
      toggleColumnSelection,
      focusBodyCell,
    });
    controller.syncFocusedBodyTarget(1, "a");

    expect(key(surface, " ").defaultPrevented).toBe(true);
    expect(toggleRowSelection).toHaveBeenCalledWith(1);
    expect(toggleColumnSelection).not.toHaveBeenCalled();

    expect(key(surface, " ", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(selectRow).toHaveBeenCalledWith(1);

    expect(key(surface, "ArrowDown", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(extendRowSelection).toHaveBeenCalledWith(1, 2);
    expect(focusBodyCell).toHaveBeenCalledWith(2, "a");

    expect(key(surface, "a", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(toggleAllRows).toHaveBeenCalledTimes(1);
    expect(key(surface, " ", { metaKey: true }).defaultPrevented).toBe(true);
    expect(toggleColumnSelection).toHaveBeenCalledWith("a");
  });

  it("162: the internal selection leaf invokes select-all without sort", () => {
    const toggleAllRows = vi.fn(() => true);
    const toggleSort = vi.fn(() => true);
    const { controller, surface } = setup(
      { toggleAllRows, toggleSort },
      [{ field: "select", internal: "selection" }],
    );
    controller.syncRowLayout({
      topDisplayIndexes: [],
      centerRowCount: 0,
      centerToDisplayIndex: null,
      bottomDisplayIndexes: [],
    });
    controller.move("firstTarget");

    expect(key(surface, "Enter").defaultPrevented).toBe(true);
    expect(toggleAllRows).toHaveBeenCalledTimes(1);
    expect(toggleSort).not.toHaveBeenCalled();
  });

  it("163-166: edit entry, invalid commit, Escape, and data-column Tab stay coordinated", () => {
    let editing = false;
    let commitSucceeds = false;
    const startCellEdit = vi.fn(() => {
      editing = true;
      return true;
    });
    const stopCellEdit = vi.fn((commit: boolean) => {
      if (commit && !commitSucceeds) return false;
      editing = false;
      return true;
    });
    const focusBodyCell = vi.fn(() => true);
    const { controller, surface } = setup({
      isCellEditing: () => editing,
      startCellEdit,
      stopCellEdit,
      focusBodyCell,
    });
    controller.syncFocusedBodyTarget(1, "a");

    expect(key(surface, "x").defaultPrevented).toBe(true);
    expect(startCellEdit).toHaveBeenCalledWith(1, "a", expect.any(HTMLElement), "x");
    expect(controller.getMode()).toBe("edit");

    const editor = document.createElement("input");
    surface.appendChild(editor);
    editor.focus();
    expect(key(editor, "Enter").defaultPrevented).toBe(true);
    expect(controller.getMode()).toBe("edit");

    commitSucceeds = true;
    expect(key(editor, "Tab").defaultPrevented).toBe(true);
    expect(controller.getTarget()).toMatchObject({
      kind: "bodyCell",
      displayRowIndex: 1,
      columnOrdinal: 1,
    });
    expect(focusBodyCell).toHaveBeenCalledWith(1, "b");
    expect(controller.getMode()).toBe("navigation");

    editing = true;
    controller.setMode("edit");
    expect(key(editor, "Escape").defaultPrevented).toBe(true);
    expect(stopCellEdit).toHaveBeenLastCalledWith(false);
    expect(controller.getMode()).toBe("navigation");
  });

  it("167-170: widget prefix traversal is retained and native activation passes through", () => {
    const first = document.createElement("button");
    const second = document.createElement("button");
    const third = document.createElement("button");
    first.disabled = true;
    const widgets = [first, second, third];
    let actionCount = 0;
    first.addEventListener("click", () => actionCount++);
    second.addEventListener("click", () => actionCount++);
    const { controller, surface } = setup({
      startCellEdit: () => false,
      resolveTargetWidgetCount: () => widgets.length,
      resolveTargetWidget: (_row, _field, index) => widgets[index] ?? null,
    });
    surface.append(first, second, third);
    controller.syncFocusedBodyTarget(1, "a");

    expect(key(surface, "Enter").defaultPrevented).toBe(true);
    expect(controller.getMode()).toBe("widget");
    expect(document.activeElement).toBe(second);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);

    expect(key(second, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(third);
    expect(actionCount).toBe(0);

    expect(key(third, "Enter").defaultPrevented).toBe(false);
    expect(actionCount).toBe(0);

    expect(key(third, "Escape").defaultPrevented).toBe(true);
    expect(controller.getMode()).toBe("navigation");
    expect(document.activeElement).toBe(surface);
    expect(actionCount).toBe(0);
  });

  it("212: a stale direct-focus adoption cannot publish after owner reentrancy", () => {
    const widget = document.createElement("button");
    const controllerRef: { current: KeyboardNavigationController | null } = {
      current: null,
    };
    const result = setup({
      focusBodyCell: () => {
        controllerRef.current?.detach();
        return true;
      },
      readPointerTarget: (_target, out) => {
        setBodyCellTarget(out, 0, 0, 0);
        return true;
      },
      resolveTargetWidgetCount: () => 1,
      resolveTargetWidget: () => widget,
    });
    const controller = result.controller;
    controllerRef.current = controller;
    result.cell.appendChild(widget);

    widget.focus();

    expect(controller.getMode()).toBe("navigation");
    expect(controller.getTarget().kind).toBe("none");
    expect(controller.getPlan()).toBeNull();
  });
});

describe("Accessibility V2 K6 commands", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("171: direct and separator resize commands submit exact 10px deltas", () => {
    const resizeColumn = vi.fn(() => true);
    const handle = document.createElement("div");
    handle.tabIndex = -1;
    const { controller, surface } = setup({
      resizeColumn,
      resolveResizeHandle: () => handle,
    });
    surface.appendChild(handle);
    controller.syncRowLayout({
      topDisplayIndexes: [],
      centerRowCount: 0,
      centerToDisplayIndex: null,
      bottomDisplayIndexes: [],
    });
    controller.move("firstTarget");

    expect(
      key(surface, "ArrowRight", { altKey: true, shiftKey: true })
        .defaultPrevented,
    ).toBe(true);
    expect(
      key(surface, "ArrowLeft", { altKey: true, shiftKey: true })
        .defaultPrevented,
    ).toBe(true);
    expect(key(surface, "F2").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(handle);
    expect(key(handle, "ArrowRight").defaultPrevented).toBe(true);
    expect(key(handle, "ArrowLeft").defaultPrevented).toBe(true);
    expect(resizeColumn.mock.calls).toEqual([
      ["a", 10],
      ["a", -10],
      ["a", 10],
      ["a", -10],
    ]);
  });

  it("197: F2 traverses retained leaf-header controls and skips disabled controls", () => {
    const disabled = document.createElement("button");
    disabled.disabled = true;
    const action = document.createElement("button");
    const menu = document.createElement("button");
    const handle = document.createElement("div");
    handle.className = "lfg-resize-handle";
    handle.setAttribute("aria-hidden", "true");
    const widgets = [disabled, action, menu, handle];
    const resizeColumn = vi.fn(() => true);
    const { controller, surface } = setup({
      resolveHeaderWidgetCount: () => widgets.length,
      resolveHeaderWidget: (_kind, _field, index) => widgets[index] ?? null,
      resizeColumn,
    });
    surface.append(...widgets);
    controller.syncRowLayout({
      topDisplayIndexes: [],
      centerRowCount: 0,
      centerToDisplayIndex: null,
      bottomDisplayIndexes: [],
    });
    controller.move("firstTarget");

    expect(key(surface, "F2").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(action);
    expect(widgets.map((widget) => widget.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(key(action, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(menu);
    expect(key(menu, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(handle);
    expect(handle.getAttribute("aria-hidden")).toBeNull();
    expect(key(handle, "ArrowRight").defaultPrevented).toBe(true);
    expect(resizeColumn).toHaveBeenCalledWith("a", 10);
    expect(key(handle, "Escape").defaultPrevented).toBe(true);
    expect(handle.getAttribute("aria-hidden")).toBe("true");
    expect(widgets.every((widget) => widget.tabIndex === -1)).toBe(true);
  });

  it("198: F2 enters retained floating-filter controls and preserves native keys", () => {
    const disabled = document.createElement("input");
    disabled.disabled = true;
    const input = document.createElement("input");
    const menu = document.createElement("button");
    const widgets = [disabled, input, menu];
    const { controller, surface } = setup({
      resolveHeaderWidgetCount: (kind) =>
        kind === "floatingFilter" ? widgets.length : 0,
      resolveHeaderWidget: (kind, _field, index) =>
        kind === "floatingFilter" ? (widgets[index] ?? null) : null,
    });
    surface.append(...widgets);
    controller.syncRowLayout({
      topDisplayIndexes: [],
      centerRowCount: 0,
      centerToDisplayIndex: null,
      bottomDisplayIndexes: [],
    });
    controller.syncTopology({
      columns: [
        { field: "a", sortable: true },
        { field: "b", sortable: true },
      ],
      hasFloatingFilterRow: true,
    });
    controller.move("firstTarget");
    expect(key(surface, "ArrowDown").defaultPrevented).toBe(true);

    expect(key(surface, "F2").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(key(input, "ArrowRight").defaultPrevented).toBe(false);
    expect(key(input, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(menu);
    expect(key(menu, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(surface);
  });

  it("172: popup keys choose retained column, filter, and body targets", () => {
    const columnTrigger = document.createElement("button");
    const filterTrigger = document.createElement("button");
    const requestOpenColumnMenu = vi.fn(() => true);
    const requestOpenDedicatedFilter = vi.fn(() => true);
    const requestOpenCellMenu = vi.fn(() => true);
    const { controller, surface, cell } = setup({
      resolveColumnMenuTrigger: () => columnTrigger,
      resolveDedicatedFilterTrigger: () => filterTrigger,
      requestOpenColumnMenu,
      requestOpenDedicatedFilter,
      requestOpenCellMenu,
    });
    surface.append(columnTrigger, filterTrigger);
    controller.syncRowLayout({
      topDisplayIndexes: [],
      centerRowCount: 0,
      centerToDisplayIndex: null,
      bottomDisplayIndexes: [],
    });
    controller.move("firstTarget");

    expect(key(surface, "ArrowDown", { altKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(requestOpenColumnMenu).toHaveBeenCalledWith("a", columnTrigger);

    controller.syncTopology({
      columns: [
        { field: "a", sortable: true },
        { field: "b", sortable: true },
      ],
      hasFloatingFilterRow: true,
    });
    expect(key(surface, "ArrowDown").defaultPrevented).toBe(true);
    expect(key(surface, "Enter").defaultPrevented).toBe(true);
    expect(requestOpenDedicatedFilter).toHaveBeenCalledWith("a", filterTrigger);

    controller.syncRowLayout(ROW_LAYOUT);
    controller.syncFocusedBodyTarget(1, "a");
    expect(key(surface, "F10", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(requestOpenCellMenu).toHaveBeenCalledWith(1, "a", cell, surface);
  });

  it("177 and 182: Escape honors popup, tooltip, then selection precedence", () => {
    const closeOpenPopup = vi.fn(() => true);
    const dismissKeyboardTooltip = vi.fn(() => true);
    const clearRowSelection = vi.fn(() => true);
    const clearColumnSelection = vi.fn(() => true);
    const { controller, surface } = setup({
      closeOpenPopup,
      dismissKeyboardTooltip,
      clearRowSelection,
      clearColumnSelection,
    });
    controller.syncFocusedBodyTarget(1, "a");
    const originalTarget = { ...controller.getTarget() };

    expect(key(surface, "Escape").defaultPrevented).toBe(true);
    expect(dismissKeyboardTooltip).not.toHaveBeenCalled();
    expect(clearRowSelection).not.toHaveBeenCalled();

    closeOpenPopup.mockReturnValue(false);
    expect(key(surface, "Escape").defaultPrevented).toBe(true);
    expect(dismissKeyboardTooltip).toHaveBeenCalledOnce();
    expect(clearRowSelection).not.toHaveBeenCalled();
    expect(controller.getTarget()).toEqual(originalTarget);

    dismissKeyboardTooltip.mockReturnValue(false);
    expect(key(surface, "Escape").defaultPrevented).toBe(true);
    expect(clearRowSelection).toHaveBeenCalledOnce();
    expect(clearColumnSelection).toHaveBeenCalledOnce();
    expect(controller.getTarget()).toEqual(originalTarget);
  });

  it("179: column movement submits one visual delta with RTL parity", () => {
    let direction: "ltr" | "rtl" = "ltr";
    const moveColumn = vi.fn(() => true);
    const { controller, surface } = setup({
      moveColumn,
      readWritingDirection: () => direction,
    });
    controller.syncRowLayout({
      topDisplayIndexes: [],
      centerRowCount: 0,
      centerToDisplayIndex: null,
      bottomDisplayIndexes: [],
    });
    controller.move("firstTarget");

    expect(
      key(surface, "ArrowRight", { ctrlKey: true, shiftKey: true })
        .defaultPrevented,
    ).toBe(true);
    direction = "rtl";
    expect(
      key(surface, "ArrowRight", { metaKey: true, shiftKey: true })
        .defaultPrevented,
    ).toBe(true);
    expect(moveColumn.mock.calls).toEqual([
      ["a", 1],
      ["a", -1],
    ]);
  });

  it("180: row movement submits one adjacent center row and stops at pinned boundaries", () => {
    const moveRow = vi.fn(() => true);
    const { controller, surface } = setup({ moveRow });
    controller.syncRowLayout({
      topDisplayIndexes: [100],
      centerRowCount: 2,
      centerToDisplayIndex: null,
      bottomDisplayIndexes: [200],
    });

    controller.syncFocusedBodyTarget(0, "a");
    expect(
      key(surface, "ArrowDown", { altKey: true, shiftKey: true })
        .defaultPrevented,
    ).toBe(true);
    expect(moveRow).toHaveBeenCalledWith(0, 1);

    moveRow.mockClear();
    controller.syncFocusedBodyTarget(1, "a");
    expect(
      key(surface, "ArrowDown", { altKey: true, shiftKey: true })
        .defaultPrevented,
    ).toBe(false);
    controller.syncFocusedBodyTarget(100, "a");
    expect(
      key(surface, "ArrowDown", { altKey: true, shiftKey: true })
        .defaultPrevented,
    ).toBe(false);
    expect(moveRow).not.toHaveBeenCalled();
  });

  it("178: native form and editable targets bypass grid command handling", () => {
    const toggleSort = vi.fn(() => true);
    const { surface } = setup({ toggleSort });
    const targets: HTMLElement[] = [
      document.createElement("input"),
      document.createElement("select"),
      document.createElement("textarea"),
      document.createElement("div"),
    ];
    targets[3]!.contentEditable = "true";
    surface.append(...targets);

    for (const target of targets) {
      expect(key(target, "ArrowDown", { altKey: true }).defaultPrevented).toBe(
        false,
      );
    }
    expect(toggleSort).not.toHaveBeenCalled();
  });
});
