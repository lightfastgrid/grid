// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { startAutoScroll } from "../autoScroll";
import {
  attachDragListeners,
  hasExceededDragThreshold,
  suppressNextClick,
} from "../DragSession";

// ─── hasExceededDragThreshold ───────────────────────────────────────────────

describe("hasExceededDragThreshold", () => {
  it("returns false when movement is below threshold", () => {
    expect(hasExceededDragThreshold(100, 100, 103, 100)).toBe(false);
    expect(hasExceededDragThreshold(100, 100, 100, 103)).toBe(false);
  });

  it("returns true when movement meets threshold", () => {
    // default threshold = 5; hypot(5,0) = 5
    expect(hasExceededDragThreshold(100, 100, 105, 100)).toBe(true);
  });

  it("returns true when movement exceeds threshold", () => {
    expect(hasExceededDragThreshold(0, 0, 10, 10)).toBe(true);
  });

  it("respects a custom threshold argument", () => {
    expect(hasExceededDragThreshold(0, 0, 9, 0, 10)).toBe(false);
    expect(hasExceededDragThreshold(0, 0, 10, 0, 10)).toBe(true);
  });
});

// ─── attachDragListeners ────────────────────────────────────────────────────

describe("attachDragListeners", () => {
  it("forwards pointermove to onMove callback", () => {
    const onMove = vi.fn();
    const onUp = vi.fn();
    const onCancel = vi.fn();
    const detach = attachDragListeners(onMove, onUp, onCancel);

    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1 }),
    );
    expect(onMove).toHaveBeenCalledTimes(1);

    detach();
  });

  it("forwards pointerup to onUp callback", () => {
    const onMove = vi.fn();
    const onUp = vi.fn();
    const onCancel = vi.fn();
    const detach = attachDragListeners(onMove, onUp, onCancel);

    document.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }),
    );
    expect(onUp).toHaveBeenCalledTimes(1);

    detach();
  });

  it("forwards pointercancel to onCancel callback", () => {
    const onMove = vi.fn();
    const onUp = vi.fn();
    const onCancel = vi.fn();
    const detach = attachDragListeners(onMove, onUp, onCancel);

    document.dispatchEvent(
      new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);

    detach();
  });

  it("detach removes all three listeners — no callbacks fire after detach", () => {
    const onMove = vi.fn();
    const onUp = vi.fn();
    const onCancel = vi.fn();
    const detach = attachDragListeners(onMove, onUp, onCancel);

    detach();

    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));

    expect(onMove).not.toHaveBeenCalled();
    expect(onUp).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

// ─── suppressNextClick ──────────────────────────────────────────────────────

describe("suppressNextClick", () => {
  it("prevents the next click inside root from propagating", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const outerClick = vi.fn();
    document.addEventListener("click", outerClick);

    suppressNextClick(root);
    root.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(outerClick).not.toHaveBeenCalled();

    document.removeEventListener("click", outerClick);
    document.body.removeChild(root);
  });

  it("does not suppress clicks outside root", () => {
    const root = document.createElement("div");
    const outside = document.createElement("div");
    document.body.appendChild(root);
    document.body.appendChild(outside);
    const outerClick = vi.fn();
    document.addEventListener("click", outerClick);

    suppressNextClick(root);
    outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(outerClick).toHaveBeenCalledTimes(1);

    document.removeEventListener("click", outerClick);
    document.body.removeChild(root);
    document.body.removeChild(outside);
  });

  it("only suppresses one click — subsequent clicks propagate normally", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const outerClick = vi.fn();
    document.addEventListener("click", outerClick);

    suppressNextClick(root);
    root.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    root.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(outerClick).toHaveBeenCalledTimes(1);

    document.removeEventListener("click", outerClick);
    document.body.removeChild(root);
  });

  it("cleanup function removes the listener before any click fires", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const outerClick = vi.fn();
    document.addEventListener("click", outerClick);

    const cleanup = suppressNextClick(root);
    cleanup();
    root.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(outerClick).toHaveBeenCalledTimes(1);

    document.removeEventListener("click", outerClick);
    document.body.removeChild(root);
  });

  it("expires so a late intentional click is not suppressed", async () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.appendChild(root);
    const outerClick = vi.fn();
    document.addEventListener("click", outerClick);

    suppressNextClick(root, 50);
    await vi.advanceTimersByTimeAsync(60);
    root.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(outerClick).toHaveBeenCalledTimes(1);

    document.removeEventListener("click", outerClick);
    document.body.removeChild(root);
    vi.useRealTimers();
  });
});

// ─── startAutoScroll ────────────────────────────────────────────────────────

function makeViewport(
  left: number,
  right: number,
  top = 0,
  bottom = 400,
): HTMLElement {
  const vp = document.createElement("div");
  vi.spyOn(vp, "getBoundingClientRect").mockReturnValue({
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => "",
  } as DOMRect);
  return vp;
}

async function flushRaf(n = 2): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

describe("startAutoScroll", () => {
  it("scrolls right (x) when pointer is near the right edge", async () => {
    const vp = makeViewport(0, 400);
    let stopped = false;
    const stop = startAutoScroll({
      axis: "x",
      getViewport: () => vp,
      getClientPos: () => ({ x: 390, y: 0 }), // 10px from right edge (zone=80)
      shouldContinue: () => !stopped,
    });

    await flushRaf(3);
    expect(vp.scrollLeft).toBeGreaterThan(0);

    stopped = true;
    stop();
  });

  it("scrolls left (x) when pointer is near the left edge", async () => {
    const vp = makeViewport(0, 400);
    vp.scrollLeft = 200;
    let stopped = false;
    const stop = startAutoScroll({
      axis: "x",
      getViewport: () => vp,
      getClientPos: () => ({ x: 10, y: 0 }), // 10px from left edge
      shouldContinue: () => !stopped,
    });

    await flushRaf(3);
    expect(vp.scrollLeft).toBeLessThan(200);

    stopped = true;
    stop();
  });

  it("scrolls down (y) when pointer is near the bottom edge", async () => {
    const vp = makeViewport(0, 400, 0, 400);
    let stopped = false;
    const stop = startAutoScroll({
      axis: "y",
      getViewport: () => vp,
      getClientPos: () => ({ x: 0, y: 390 }), // 10px from bottom
      shouldContinue: () => !stopped,
    });

    await flushRaf(3);
    expect(vp.scrollTop).toBeGreaterThan(0);

    stopped = true;
    stop();
  });

  it("scrolls up (y) when pointer is near the top edge", async () => {
    const vp = makeViewport(0, 400, 0, 400);
    vp.scrollTop = 200;
    let stopped = false;
    const stop = startAutoScroll({
      axis: "y",
      getViewport: () => vp,
      getClientPos: () => ({ x: 0, y: 10 }), // 10px from top
      shouldContinue: () => !stopped,
    });

    await flushRaf(3);
    expect(vp.scrollTop).toBeLessThan(200);

    stopped = true;
    stop();
  });

  it("does not scroll when pointer is in the middle of the viewport", async () => {
    const vp = makeViewport(0, 400);
    let stopped = false;
    const stop = startAutoScroll({
      axis: "x",
      getViewport: () => vp,
      getClientPos: () => ({ x: 200, y: 0 }), // center — no edge pressure
      shouldContinue: () => !stopped,
    });

    await flushRaf(3);
    expect(vp.scrollLeft).toBe(0);

    stopped = true;
    stop();
  });

  it("stop function cancels the loop — no more scrolling after stop", async () => {
    const vp = makeViewport(0, 400);
    let stopped = false;
    const stop = startAutoScroll({
      axis: "x",
      getViewport: () => vp,
      getClientPos: () => ({ x: 390, y: 0 }),
      shouldContinue: () => !stopped,
    });

    stop();
    await flushRaf(3);
    expect(vp.scrollLeft).toBe(0);
    stopped = true;
  });

  it("self-stops when shouldContinue returns false", async () => {
    const vp = makeViewport(0, 400);
    const stop = startAutoScroll({
      axis: "x",
      getViewport: () => vp,
      getClientPos: () => ({ x: 390, y: 0 }),
      shouldContinue: () => false, // never runs body
    });

    await flushRaf(3);
    expect(vp.scrollLeft).toBe(0);
    stop();
  });

  it("self-stops when getViewport returns null", async () => {
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    let vp: HTMLElement | null = makeViewport(0, 400);
    const stop = startAutoScroll({
      axis: "x",
      getViewport: () => vp,
      getClientPos: () => ({ x: 390, y: 0 }),
      shouldContinue: () => true,
    });

    // Null the viewport so the loop self-cancels next tick.
    vp = null;
    await flushRaf(2);

    // stop() should be a no-op (loop already stopped internally).
    stop();
    cancelSpy.mockRestore();
  });
});
