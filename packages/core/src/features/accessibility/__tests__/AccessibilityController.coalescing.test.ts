// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { AccessibilityController } from "../AccessibilityController";

describe("AccessibilityController scroll settling", () => {
  it("performs zero semantic work for thousands of scrolls before two quiet frames", () => {
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

    const root = document.createElement("div");
    root.tabIndex = 0;
    const viewport = document.createElement("div");
    const rowPosition = vi.fn(() => true);
    const headerBinding = vi.fn(() => true);
    const rootRead = vi.fn(() => ({
      role: "grid" as const,
      ariaRowCount: 1,
      ariaColCount: 1,
      ariaMultiselectable: false,
      ariaBusy: false,
    }));
    const controller = new AccessibilityController();
    controller.attach({
      root,
      viewport,
      rowgroup: null,
      readSnapshot: rootRead,
      syncRowStructure: vi.fn(),
      syncRowPosition: rowPosition,
      syncHeaderTopology: vi.fn(),
      syncHeaderBinding: headerBinding,
      syncHeaderSort: vi.fn(),
      syncHeaderSelection: vi.fn(),
      syncHeaderMenu: vi.fn(),
      syncActiveDescendant: vi.fn(),
      clearSemantics: vi.fn(),
    });
    controller.flushReconcile();
    vi.clearAllMocks();
    callbacks.length = 0;

    for (let index = 0; index < 5_000; index += 1) {
      viewport.dispatchEvent(new Event("scroll"));
      expect(callbacks).toHaveLength(0);
    }
    expect(rowPosition).not.toHaveBeenCalled();
    expect(headerBinding).not.toHaveBeenCalled();
    expect(rootRead).not.toHaveBeenCalled();

    viewport.dispatchEvent(new Event("scrollend"));
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!(0);
    expect(rowPosition).not.toHaveBeenCalled();
    callbacks.shift()!(0);
    expect(rowPosition).toHaveBeenCalledTimes(1);
    expect(headerBinding).toHaveBeenCalledTimes(1);
    expect(rootRead).not.toHaveBeenCalled();

    controller.detach();
  });
});
