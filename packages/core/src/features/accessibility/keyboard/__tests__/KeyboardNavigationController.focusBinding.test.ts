// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import type { VisualRowLayout } from "../../../../internal/layoutTypes";
import {
  KeyboardNavigationController,
  type KeyboardNavigationControllerHost,
} from "../KeyboardNavigationController";
import {
  setBodyCellTarget,
  setLeafHeaderTarget,
} from "../keyboardTarget";

const ROW_LAYOUT: VisualRowLayout = {
  topDisplayIndexes: [],
  centerRowCount: 2,
  centerToDisplayIndex: null,
  bottomDisplayIndexes: [],
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("KeyboardNavigationController exact focus binding", () => {
  it("216: follows the focused row identity when its display index changes", () => {
    const surface = document.createElement("div");
    const row = document.createElement("div");
    row.setAttribute("data-row-index", "0");
    const cell = document.createElement("div");
    cell.id = "cell-a-0";
    cell.setAttribute("data-col-id", "a");
    row.appendChild(cell);
    surface.appendChild(row);
    document.body.appendChild(surface);
    const controller = createReadyController({
      surface,
      resolveTargetElement: () => cell,
    });
    expect(controller.syncFocusedBodyTarget(0, "a")).toBe(true);
    controller.syncResolvedActiveDescendant();

    controller.syncRetainedBodyFocusPosition(1, "a");

    expect(controller.getTarget()).toMatchObject({
      kind: "bodyCell",
      displayRowIndex: 1,
      visualRowIndex: 1,
    });
    controller.syncExactFocusBinding();
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(cell.classList.contains("lfg-a11y-active-target")).toBe(false);

    controller.syncRetainedBodyFocusPosition(0, "other");
    expect(controller.getTarget()).toMatchObject({
      kind: "bodyCell",
      displayRowIndex: 1,
    });
  });

  it("215-217: removes a recycled navigation marker and restores only the exact binding", () => {
    const surface = document.createElement("div");
    surface.tabIndex = 0;
    const row = document.createElement("div");
    row.setAttribute("data-row-index", "0");
    const cell = document.createElement("div");
    cell.id = "cell-a-0";
    cell.setAttribute("data-col-id", "a");
    row.appendChild(cell);
    surface.appendChild(row);
    document.body.appendChild(surface);

    let resolvedElement: HTMLElement | null = cell;
    const controller = createReadyController({
      surface,
      resolveTargetElement: () => resolvedElement,
    });
    expect(controller.syncFocusedBodyTarget(0, "a")).toBe(true);
    controller.syncResolvedActiveDescendant();

    expect(surface.getAttribute("aria-activedescendant")).toBe(cell.id);
    expect(cell.classList.contains("lfg-a11y-active-target")).toBe(true);

    row.setAttribute("data-row-index", "1");
    controller.syncExactFocusBinding();

    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(cell.classList.contains("lfg-a11y-active-target")).toBe(false);
    expect(controller.getTarget()).toMatchObject({
      kind: "bodyCell",
      displayRowIndex: 0,
      columnOrdinal: 0,
    });

    const restoredRow = document.createElement("div");
    restoredRow.setAttribute("data-row-index", "0");
    const restoredCell = document.createElement("div");
    restoredCell.id = "cell-a-0-restored";
    restoredCell.setAttribute("data-col-id", "a");
    restoredRow.appendChild(restoredCell);
    surface.appendChild(restoredRow);
    resolvedElement = restoredCell;

    controller.syncResolvedActiveDescendant();

    expect(surface.getAttribute("aria-activedescendant")).toBe(restoredCell.id);
    expect(restoredCell.classList.contains("lfg-a11y-active-target")).toBe(true);
    expect(cell.classList.contains("lfg-a11y-active-target")).toBe(false);
  });

  it("218-219: invalidates a recycled direct widget without publishing its fallback cell", () => {
    const surface = document.createElement("div");
    surface.tabIndex = 0;
    const row = document.createElement("div");
    row.setAttribute("data-row-index", "0");
    const selectionCell = document.createElement("div");
    selectionCell.setAttribute("data-col-id", "__selection__");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.tabIndex = -1;
    selectionCell.appendChild(checkbox);
    const fallbackCell = document.createElement("div");
    fallbackCell.id = "cell-a-0";
    fallbackCell.setAttribute("data-col-id", "a");
    row.append(selectionCell, fallbackCell);
    surface.appendChild(row);
    document.body.appendChild(surface);

    const controller = createReadyController({
      surface,
      focusBodyCell: () => true,
      resolveTargetElement: () => fallbackCell,
      readPointerTarget: (eventTarget, out) => {
        if (eventTarget !== checkbox) return false;
        setBodyCellTarget(out, 0, 0, 0);
        return true;
      },
    });
    expect(controller.syncFocusedBodyTarget(0, "a")).toBe(true);
    controller.syncResolvedActiveDescendant();

    checkbox.focus();
    expect(controller.getMode()).toBe("widget");
    expect(document.activeElement).toBe(checkbox);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(
      fallbackCell.classList.contains("lfg-a11y-active-target"),
    ).toBe(false);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    controller.syncExactFocusBinding();
    expect(document.activeElement).toBe(outside);
    expect(controller.getMode()).toBe("widget");

    checkbox.focus();
    row.setAttribute("data-row-index", "1");
    controller.syncExactFocusBinding();
    expect(document.activeElement).toBe(surface);
    expect(controller.getMode()).toBe("navigation");

    row.setAttribute("data-row-index", "0");
    checkbox.focus();
    outside.focus();
    row.setAttribute("data-row-index", "1");
    controller.syncExactFocusBinding();
    expect(document.activeElement).toBe(outside);
    expect(controller.getMode()).toBe("navigation");

    row.setAttribute("data-row-index", "0");
    checkbox.focus();
    expect(controller.getMode()).toBe("widget");
    row.setAttribute("data-row-index", "1");
    controller.syncExactFocusBinding();

    expect(controller.getMode()).toBe("navigation");
    expect(document.activeElement).toBe(surface);
    expect(checkbox.tabIndex).toBe(-1);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(
      fallbackCell.classList.contains("lfg-a11y-active-target"),
    ).toBe(false);
    expect(controller.getTarget()).toMatchObject({
      kind: "bodyCell",
      displayRowIndex: 0,
    });

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    checkbox.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
  });

  it("218: invalidates a header widget when its physical column slot is rebound", () => {
    const surface = document.createElement("div");
    surface.tabIndex = 0;
    const header = document.createElement("div");
    header.id = "header-a";
    header.setAttribute("data-col-id", "a");
    const trigger = document.createElement("button");
    trigger.tabIndex = -1;
    let resolvedTrigger = trigger;
    header.appendChild(trigger);
    surface.appendChild(header);
    document.body.appendChild(surface);

    const controller = createReadyController({
      surface,
      resolveTargetElement: () => header,
      resolveHeaderWidgetCount: () => 1,
      resolveHeaderWidget: () => resolvedTrigger,
      readPointerTarget: (eventTarget, out) => {
        if (eventTarget !== trigger) return false;
        setLeafHeaderTarget(out, 0);
        return true;
      },
    });

    trigger.focus();
    expect(controller.getMode()).toBe("widget");
    expect(trigger.tabIndex).toBe(0);

    const replacement = document.createElement("button");
    replacement.tabIndex = -1;
    header.appendChild(replacement);
    resolvedTrigger = replacement;
    header.setAttribute("data-col-id", "b");
    controller.syncExactFocusBinding();

    expect(controller.getMode()).toBe("navigation");
    expect(document.activeElement).toBe(surface);
    expect(trigger.tabIndex).toBe(-1);
    expect(replacement.tabIndex).toBe(-1);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(header.classList.contains("lfg-a11y-active-target")).toBe(false);
  });

  it("218: restores a detached focused widget without clearing a synchronous remount", () => {
    const surface = document.createElement("div");
    surface.tabIndex = 0;
    const header = document.createElement("div");
    header.setAttribute("data-col-id", "a");
    const trigger = document.createElement("button");
    trigger.tabIndex = -1;
    header.appendChild(trigger);
    surface.appendChild(header);
    document.body.appendChild(surface);
    const controller = createReadyController({
      surface,
      resolveTargetElement: () => header,
      resolveHeaderWidgetCount: () => 1,
      resolveHeaderWidget: () => trigger,
      readPointerTarget: (eventTarget, out) => {
        if (eventTarget !== trigger) return false;
        setLeafHeaderTarget(out, 0);
        return true;
      },
    });
    trigger.focus();
    expect(controller.getMode()).toBe("widget");

    const replacementSurface = document.createElement("div");
    replacementSurface.tabIndex = 0;
    document.body.appendChild(replacementSurface);
    surface.addEventListener(
      "focus",
      () => {
        controller.detach();
        controller.attach({
          surface: replacementSurface,
          readPageSize: () => 2,
          readWritingDirection: () => "ltr",
        });
        replacementSurface.setAttribute(
          "aria-activedescendant",
          "new-mount-target",
        );
      },
      { once: true },
    );

    trigger.remove();
    controller.syncExactFocusBinding();

    expect(replacementSurface.getAttribute("aria-activedescendant")).toBe(
      "new-mount-target",
    );
    expect(controller.getMode()).toBe("navigation");
  });

  it("218: root-sibling widget refocus restores surface ownership before recycling", () => {
    const surface = document.createElement("div");
    surface.tabIndex = 0;
    const row = document.createElement("div");
    row.setAttribute("data-row-index", "0");
    const cell = document.createElement("div");
    cell.id = "cell-a-0";
    cell.setAttribute("data-col-id", "a");
    row.appendChild(cell);
    surface.appendChild(row);
    const externalWidget = document.createElement("button");
    externalWidget.tabIndex = -1;
    const outside = document.createElement("button");
    document.body.append(surface, externalWidget, outside);
    const controller = createReadyController({
      surface,
      focusBodyCell: () => true,
      resolveTargetElement: () => cell,
      resolveTargetWidgetCount: () => 0,
      resolveVisibleCellMenuTrigger: () => externalWidget,
    });
    expect(controller.syncFocusedBodyTarget(0, "a")).toBe(true);
    controller.syncResolvedActiveDescendant();
    surface.focus();

    const f2 = new KeyboardEvent("keydown", {
      key: "F2",
      bubbles: true,
      cancelable: true,
    });
    surface.dispatchEvent(f2);
    expect(f2.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(externalWidget);
    expect(controller.getMode()).toBe("widget");

    outside.focus();
    externalWidget.focus();
    row.setAttribute("data-row-index", "1");
    controller.syncExactFocusBinding();

    expect(document.activeElement).toBe(surface);
    expect(controller.getMode()).toBe("navigation");
    expect(externalWidget.tabIndex).toBe(-1);
  });

  it("218: recycle does not reclaim focus from outside chrome", () => {
    const surface = document.createElement("div");
    surface.tabIndex = 0;
    const header = document.createElement("div");
    header.setAttribute("data-col-id", "a");
    const trigger = document.createElement("button");
    trigger.tabIndex = -1;
    header.appendChild(trigger);
    surface.appendChild(header);
    const toolbar = document.createElement("input");
    document.body.append(surface, toolbar);
    const controller = createReadyController({
      surface,
      resolveTargetElement: () => header,
      resolveHeaderWidgetCount: () => 1,
      resolveHeaderWidget: () => trigger,
      readPointerTarget: (eventTarget, out) => {
        if (eventTarget !== trigger) return false;
        setLeafHeaderTarget(out, 0);
        return true;
      },
    });
    trigger.focus();
    expect(controller.getMode()).toBe("widget");

    toolbar.focus();
    trigger.remove();
    controller.syncExactFocusBinding();

    expect(document.activeElement).toBe(toolbar);
    expect(controller.getMode()).toBe("navigation");
  });
});

function createReadyController(
  overrides: Partial<KeyboardNavigationControllerHost>,
): KeyboardNavigationController {
  const controller = new KeyboardNavigationController();
  controller.attach({
    readPageSize: () => 2,
    readWritingDirection: () => "ltr",
    ...overrides,
  });
  controller.syncRowLayout(ROW_LAYOUT);
  controller.syncTopology({
    columns: [{ field: "a" }],
    hasFloatingFilterRow: false,
  });
  return controller;
}
