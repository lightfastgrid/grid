import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { VisualRowLayout } from "../../../../internal/layoutTypes";
import {
  KeyboardNavigationController,
  type KeyboardNavigationControllerHost,
} from "../KeyboardNavigationController";

const LAYOUT: VisualRowLayout = {
  topDisplayIndexes: [2],
  centerRowCount: 3,
  centerToDisplayIndex: (index) => [0, 1, 3][index]!,
  bottomDisplayIndexes: [4],
};

const EMPTY_LAYOUT: VisualRowLayout = {
  topDisplayIndexes: [],
  centerRowCount: 0,
  centerToDisplayIndex: null,
  bottomDisplayIndexes: [],
};

function host(
  overrides: Partial<KeyboardNavigationControllerHost> = {},
): KeyboardNavigationControllerHost {
  return {
    readPageSize: () => 2,
    readWritingDirection: () => "ltr",
    ...overrides,
  };
}

function attachReady(controller: KeyboardNavigationController): void {
  controller.attach(host());
  controller.syncRowLayout(LAYOUT);
  controller.syncTopology({
    columns: [{ field: "a" }, { field: "b" }],
    hasFloatingFilterRow: false,
  });
}

describe("Accessibility V2 retained keyboard controller", () => {
  it("148: attach/detach resets retained state and makes stale dispatch inert", () => {
    const controller = new KeyboardNavigationController();
    controller.attach(host({
      readPageSize: () => {
        controller.detach();
        return 2;
      },
    }));
    controller.syncRowLayout(LAYOUT);
    controller.syncTopology({ columns: [{ field: "a" }], hasFloatingFilterRow: false });

    expect(controller.move("right").moved).toBe(false);
    expect(controller.getTarget().kind).toBe("none");
    expect(controller.getPlan()).toBeNull();
  });

  it("149: a nested newer move supersedes the older dispatch", () => {
    const controller = new KeyboardNavigationController();
    let nested = false;
    const readPageSize = vi.fn(() => {
      if (!nested) {
        nested = true;
        controller.move("right");
      }
      return 2;
    });
    controller.attach(host({ readPageSize }));
    controller.syncRowLayout(LAYOUT);
    controller.syncTopology({
      columns: [{ field: "a" }, { field: "b" }],
      hasFloatingFilterRow: false,
    });

    expect(controller.move("right").moved).toBe(false);
    expect(controller.getTarget()).toMatchObject({
      kind: "bodyCell",
      displayRowIndex: 2,
      columnOrdinal: 0,
    });
    expect(readPageSize).toHaveBeenCalledTimes(2);
  });

  it("clears only its own dispatch ownership when a scalar getter throws", () => {
    const failure = new Error("page size failed");
    const controller = new KeyboardNavigationController();
    controller.attach(host({ readPageSize: () => { throw failure; } }));
    controller.syncRowLayout(LAYOUT);
    controller.syncTopology({ columns: [{ field: "a" }], hasFloatingFilterRow: false });

    expect(() => controller.move("right")).toThrow(failure);
    controller.attach(host());
    controller.syncRowLayout(LAYOUT);
    controller.syncTopology({ columns: [{ field: "a" }], hasFloatingFilterRow: false });
    expect(controller.move("right").moved).toBe(true);
  });

  it("retains the target identity and remaps its field across topology changes", () => {
    const controller = new KeyboardNavigationController();
    attachReady(controller);
    const target = controller.getTarget();
    expect(controller.syncFocusedBodyTarget(1, "b")).toBe(true);
    expect(target).toMatchObject({
      kind: "bodyCell",
      visualRowIndex: 2,
      columnOrdinal: 1,
    });

    controller.syncTopology({
      columns: [{ field: "b" }, { field: "a" }],
      hasFloatingFilterRow: false,
    });
    expect(controller.getTarget()).toBe(target);
    expect(target.columnOrdinal).toBe(0);
  });

  it("normalizes a retained body target when the visual layout changes", () => {
    const controller = new KeyboardNavigationController();
    attachReady(controller);
    controller.syncFocusedBodyTarget(4, "a");
    expect(controller.getTarget().visualRowIndex).toBe(4);

    controller.syncRowLayout({
      topDisplayIndexes: [],
      centerRowCount: 5,
      centerToDisplayIndex: null,
      bottomDisplayIndexes: [],
    });
    expect(controller.getTarget().visualRowIndex).toBe(4);
  });

  it("keeps mode and read identities retained", () => {
    const controller = new KeyboardNavigationController();
    attachReady(controller);
    const target = controller.getTarget();
    const plan = controller.getPlan();

    controller.setMode("widget");
    expect(controller.getMode()).toBe("widget");
    expect(controller.getTarget()).toBe(target);
    expect(controller.getPlan()).toBe(plan);
  });

  it("150: caches owner capability references at attach", () => {
    const first = vi.fn(() => true);
    const replacement = vi.fn(() => true);
    const controllerHost = host({ focusBodyCell: first });
    const controller = new KeyboardNavigationController();
    controller.attach(controllerHost);
    controller.syncRowLayout(LAYOUT);
    controller.syncTopology({
      columns: [{ field: "a" }],
      hasFloatingFilterRow: false,
    });
    expect(controller.syncFocusedBodyTarget(1, "a")).toBe(true);

    controllerHost.focusBodyCell = replacement;
    expect(controller.publishBodyFocus()).toBe(true);
    expect(first).toHaveBeenCalledWith(1, "a");
    expect(replacement).not.toHaveBeenCalled();
  });

  it("151: unsupported and stale owner capabilities are inert", () => {
    const controller = new KeyboardNavigationController();
    attachReady(controller);
    controller.syncFocusedBodyTarget(1, "a");
    expect(controller.publishBodyFocus()).toBe(false);

    const replacingAction = vi.fn(() => {
      controller.detach();
      return true;
    });
    controller.attach(host({ focusBodyCell: replacingAction }));
    controller.syncRowLayout(LAYOUT);
    controller.syncTopology({
      columns: [{ field: "a" }],
      hasFloatingFilterRow: false,
    });
    controller.syncFocusedBodyTarget(1, "a");
    expect(controller.publishBodyFocus()).toBe(false);
    expect(replacingAction).toHaveBeenCalledTimes(1);
    expect(controller.publishBodyFocus()).toBe(false);
  });

  it("dispatches scalar selection and sort owner actions without target objects", () => {
    const toggleRowSelection = vi.fn(() => true);
    const toggleAllRows = vi.fn(() => true);
    const toggleColumnSelection = vi.fn(() => true);
    const toggleSort = vi.fn(() => true);
    const controller = new KeyboardNavigationController();
    controller.attach(host({
      toggleRowSelection,
      toggleAllRows,
      toggleColumnSelection,
      toggleSort,
    }));
    controller.syncRowLayout(LAYOUT);
    controller.syncTopology({
      columns: [{ field: "a", sortable: true }],
      hasFloatingFilterRow: false,
    });
    controller.syncFocusedBodyTarget(1, "a");

    expect(controller.toggleTargetRowSelection()).toBe(true);
    expect(toggleRowSelection).toHaveBeenCalledWith(1);
    expect(controller.toggleAllRowSelection()).toBe(true);
    expect(toggleAllRows).toHaveBeenCalledWith();
    expect(controller.toggleTargetColumnSelection()).toBe(true);
    expect(toggleColumnSelection).toHaveBeenCalledWith("a");
    expect(controller.toggleTargetSort(false)).toBe(false);
    expect(toggleSort).not.toHaveBeenCalled();

    controller.syncRowLayout(EMPTY_LAYOUT);
    controller.move("firstTarget");
    expect(controller.getTarget().kind).toBe("leafHeader");
    expect(controller.toggleTargetSort(true)).toBe(true);
    expect(toggleSort).toHaveBeenCalledWith("a", true);
  });

  it("K4 owns surface listeners plus scoped Widget-mode bridges and no registry lookup", () => {
    const source = readFileSync(
      new URL("../KeyboardNavigationController.ts", import.meta.url),
      "utf8",
    );
    expect(source.match(/addEventListener\(/g)).toHaveLength(7);
    expect(source.match(/removeEventListener\(/g)).toHaveLength(7);
    expect(source).toContain(
      'this.surface?.addEventListener("focusin", this.onFocusIn)',
    );
    expect(source).toContain(
      'widget?.addEventListener("keydown", this.onKeyDown)',
    );
    expect(source).toContain(
      'this.externalBodyWidget?.removeEventListener("keydown", this.onKeyDown)',
    );
    expect(source).toContain(
      'widget?.addEventListener("focusout", this.onActiveWidgetFocusOut)',
    );
    expect(source).toContain(
      'widget?.addEventListener("focus", this.onActiveWidgetFocus)',
    );
    expect(source).toContain(
      '"focusout",\n      this.onActiveWidgetFocusOut',
    );
    expect(source).not.toMatch(/addEventListener\(["']scroll/);
    expect(source).not.toMatch(
      /from\s+["'][^"']*\/(selection|editing|menu|tooltips|resize|row-order)\//,
    );
    expect(source).not.toMatch(/findCapability|features\.|registry/);
  });
});
