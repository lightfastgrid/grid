// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import { ColumnResizeController } from "../ColumnResizeController";

function mountResizeHandle(): {
  root: HTMLDivElement;
  handle: HTMLDivElement;
  cleanup: () => void;
} {
  const root = document.createElement("div");
  const handle = document.createElement("div");
  handle.className = "lfg-resize-handle";
  handle.setAttribute("data-col-id", "a");
  root.appendChild(handle);
  document.body.appendChild(root);
  return {
    root,
    handle,
    cleanup: () => {
      document.body.removeChild(root);
    },
  };
}

describe("ColumnResizeController", () => {
  it("171: keyboard resize acceptance is O(1) and commits accumulated width later", async () => {
    const commitResize = vi.fn();
    const columns = [
      { field: "a", width: 100, minWidth: 80, maxWidth: 130, resizable: true },
      { field: "b", width: 90, resizable: false },
    ];
    const ctrl = new ColumnResizeController({
      getColumns: () => columns,
      getDisplayRows: () => createArrayDisplayRowReader([]),
      getVisibleRowStart: () => 0,
      getPoolSize: () => 0,
      requestSync: () => {},
      commitResize,
    });
    ctrl.syncCommandColumns(columns);

    expect(ctrl.resizeColumnFromCommand("a", 10)).toBe(true);
    expect(ctrl.resizeColumnFromCommand("a", 10)).toBe(true);
    expect(ctrl.resizeColumnFromCommand("b", 10)).toBe(false);
    expect(ctrl.resizeColumnFromCommand("missing", 10)).toBe(false);
    expect(commitResize).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(commitResize).toHaveBeenCalledOnce();
    expect(commitResize).toHaveBeenCalledWith("a", 120);
  });

  it("detach during active drag removes document listeners without commitResize", () => {
    const commitResize = vi.fn();
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const ctrl = new ColumnResizeController({
      getColumns: () => [{ field: "a", width: 100, resizable: true }],
      getDisplayRows: () => createArrayDisplayRowReader([]),
      getVisibleRowStart: () => 0,
      getPoolSize: () => 3,
      requestSync: () => {},
      commitResize,
    });

    const { root, handle, cleanup } = mountResizeHandle();
    ctrl.attach(root);

    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 42,
      }),
    );

    expect(commitResize).not.toHaveBeenCalled();

    ctrl.detach();
    expect(commitResize).not.toHaveBeenCalled();

    expect(removeSpy).toHaveBeenCalledWith(
      "pointermove",
      expect.any(Function),
    );
    expect(removeSpy).toHaveBeenCalledWith(
      "pointerup",
      expect.any(Function),
    );
    expect(removeSpy).toHaveBeenCalledWith(
      "pointercancel",
      expect.any(Function),
    );

    removeSpy.mockRestore();
    cleanup();
  });

  it("pointerup after drag commits final width once", () => {
    const commitResize = vi.fn();

    const ctrl = new ColumnResizeController({
      getColumns: () => [{ field: "a", width: 100, resizable: true }],
      getDisplayRows: () => createArrayDisplayRowReader([]),
      getVisibleRowStart: () => 0,
      getPoolSize: () => 3,
      requestSync: () => {},
      commitResize,
    });

    const { root, handle, cleanup } = mountResizeHandle();
    ctrl.attach(root);

    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 7,
        clientX: 100,
      }),
    );

    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 7,
        clientX: 120,
      }),
    );

    expect(commitResize).toHaveBeenCalledTimes(1);
    expect(commitResize.mock.calls[0]?.[0]).toBe("a");

    ctrl.detach();
    cleanup();
  });

  it("inverts drag delta for right-pinned columns", () => {
    const commitResize = vi.fn();
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback): number => {
        cb(0);
        return 1;
      });

    const ctrl = new ColumnResizeController({
      getColumns: () => [
        { field: "a", width: 100, resizable: true, pinned: "right" },
      ],
      getDisplayRows: () => createArrayDisplayRowReader([]),
      getVisibleRowStart: () => 0,
      getPoolSize: () => 3,
      requestSync: () => {},
      commitResize,
    });

    const { root, handle, cleanup } = mountResizeHandle();
    ctrl.attach(root);

    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 11,
        clientX: 100,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 11,
        clientX: 120,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 11,
        clientX: 120,
      }),
    );
    expect(commitResize).toHaveBeenLastCalledWith("a", 80);

    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 12,
        clientX: 100,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 12,
        clientX: 80,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 12,
        clientX: 80,
      }),
    );
    expect(commitResize).toHaveBeenLastCalledWith("a", 120);

    rafSpy.mockRestore();
    ctrl.detach();
    cleanup();
  });

  it("keeps normal drag direction for non-right-pinned columns", () => {
    const commitResize = vi.fn();
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback): number => {
        cb(0);
        return 1;
      });

    const ctrl = new ColumnResizeController({
      getColumns: () => [{ field: "a", width: 100, resizable: true }],
      getDisplayRows: () => createArrayDisplayRowReader([]),
      getVisibleRowStart: () => 0,
      getPoolSize: () => 3,
      requestSync: () => {},
      commitResize,
    });

    const { root, handle, cleanup } = mountResizeHandle();
    ctrl.attach(root);

    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 21,
        clientX: 100,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 21,
        clientX: 120,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 21,
        clientX: 120,
      }),
    );
    expect(commitResize).toHaveBeenLastCalledWith("a", 120);

    rafSpy.mockRestore();
    ctrl.detach();
    cleanup();
  });
});
