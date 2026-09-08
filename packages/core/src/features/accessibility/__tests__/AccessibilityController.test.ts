// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  ACCESSIBILITY_DIRTY_HEADER_MENU,
  ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY,
  ACCESSIBILITY_DIRTY_ROOT,
  ACCESSIBILITY_DIRTY_ROW_POSITION,
  ACCESSIBILITY_DIRTY_ROW_STRUCTURE,
  AccessibilityController,
} from "../AccessibilityController";

function createHost() {
  const root = document.createElement("div");
  root.tabIndex = 0;
  const viewport = document.createElement("div");
  return {
    root,
    viewport,
    rowgroup: null,
    readSnapshot: vi.fn(() => ({
      role: "grid" as const,
      ariaRowCount: 42,
      ariaColCount: 7,
      ariaMultiselectable: true,
      ariaBusy: true,
    })),
    syncRowStructure: vi.fn(),
    syncRowPosition: vi.fn(() => true),
    syncHeaderTopology: vi.fn(),
    syncHeaderBinding: vi.fn(() => true),
    syncHeaderSort: vi.fn(),
    syncHeaderSelection: vi.fn(),
    syncHeaderMenu: vi.fn(),
    syncActiveDescendant: vi.fn(),
    clearSemantics: vi.fn(),
  };
}

describe("AccessibilityController", () => {
  it("applies all initial scopes and preserves base-shell focusability", () => {
    const host = createHost();
    const controller = new AccessibilityController();

    controller.attach(host);

    expect(host.root.getAttribute("role")).toBe("grid");
    expect(host.root.getAttribute("aria-rowcount")).toBe("42");
    expect(host.root.getAttribute("aria-multiselectable")).toBe("true");
    expect(host.root.getAttribute("aria-busy")).toBe("true");
    expect(host.root.tabIndex).toBe(0);
    expect(host.root.getAttribute("aria-activedescendant")).toBeNull();
    expect(host.syncRowStructure).toHaveBeenCalledTimes(1);
    expect(host.syncHeaderTopology).toHaveBeenCalledTimes(1);

    controller.detach();
    expect(host.root.getAttribute("role")).toBeNull();
    expect(host.root.tabIndex).toBe(0);
    expect(host.clearSemantics).toHaveBeenCalledTimes(1);
  });

  it("runs only the requested independent scope", () => {
    const host = createHost();
    const controller = new AccessibilityController();
    controller.attach(host);
    controller.flushReconcile();
    vi.clearAllMocks();

    controller.requestReconcile(ACCESSIBILITY_DIRTY_HEADER_MENU, false);
    controller.flushReconcile();

    expect(host.syncHeaderMenu).toHaveBeenCalledTimes(1);
    expect(host.syncRowStructure).not.toHaveBeenCalled();
    expect(host.syncRowPosition).not.toHaveBeenCalled();
    expect(host.syncHeaderTopology).not.toHaveBeenCalled();
    controller.detach();
  });

  it("does not let an immediate root update drain pending structural work", () => {
    const host = createHost();
    const controller = new AccessibilityController();
    controller.attach(host);
    controller.flushReconcile();
    vi.clearAllMocks();

    controller.requestReconcile(
      ACCESSIBILITY_DIRTY_ROW_STRUCTURE |
        ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY,
    );
    controller.reconcileImmediate(ACCESSIBILITY_DIRTY_ROOT);

    expect(host.readSnapshot).toHaveBeenCalledTimes(1);
    expect(host.syncRowStructure).not.toHaveBeenCalled();
    expect(host.syncHeaderTopology).not.toHaveBeenCalled();

    controller.flushReconcile();
    expect(host.syncRowStructure).toHaveBeenCalledTimes(1);
    expect(host.syncHeaderTopology).toHaveBeenCalledTimes(1);
    controller.detach();
  });

  it("makes delayed work from a detached mount inert", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    );
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {
      callbacks.length = 0;
    });
    const first = createHost();
    const second = createHost();
    const controller = new AccessibilityController();

    controller.attach(first);
    controller.flushReconcile();
    first.viewport.dispatchEvent(new Event("scroll"));
    first.viewport.dispatchEvent(new Event("scrollend"));
    const stale = callbacks.shift()!;
    controller.detach();
    controller.attach(second);
    controller.flushReconcile();
    vi.clearAllMocks();

    stale(0);
    expect(first.syncRowPosition).not.toHaveBeenCalled();
    expect(second.syncRowPosition).not.toHaveBeenCalled();
    expect(second.root.getAttribute("role")).toBe("grid");
    controller.detach();
  });

  it("defers callback-triggered immediate requests instead of reconciling recursively", () => {
    const host = createHost();
    const controller = new AccessibilityController();
    controller.attach(host);
    controller.flushReconcile();
    vi.clearAllMocks();
    let depth = 0;
    let maxDepth = 0;
    host.syncRowPosition.mockImplementation(() => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      controller.requestReconcile(ACCESSIBILITY_DIRTY_HEADER_MENU, false);
      controller.flushReconcile();
      depth -= 1;
      return true;
    });

    controller.requestReconcile(ACCESSIBILITY_DIRTY_ROW_POSITION, false);
    controller.flushReconcile();

    expect(maxDepth).toBe(1);
    expect(host.syncRowPosition).toHaveBeenCalledTimes(1);
    expect(host.syncHeaderMenu).not.toHaveBeenCalled();

    controller.flushReconcile();
    expect(host.syncHeaderMenu).toHaveBeenCalledTimes(1);
    controller.detach();
  });
});
