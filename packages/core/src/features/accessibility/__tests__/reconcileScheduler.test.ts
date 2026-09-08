// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReconcileScheduler } from "../reconcileScheduler";

function installRafQueue(): {
  readonly callbacks: FrameRequestCallback[];
  readonly restore: () => void;
} {
  const callbacks: FrameRequestCallback[] = [];
  const raf = vi
    .spyOn(globalThis, "requestAnimationFrame")
    .mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
  const cancel = vi
    .spyOn(globalThis, "cancelAnimationFrame")
    .mockImplementation(() => {
      callbacks.length = 0;
    });
  return {
    callbacks,
    restore: () => {
      raf.mockRestore();
      cancel.mockRestore();
    },
  };
}

function runNext(callbacks: FrameRequestCallback[]): void {
  const callback = callbacks.shift();
  expect(callback).toBeDefined();
  callback!(0);
}

describe("ReconcileScheduler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("coalesces ordinary requests into one frame", () => {
    const queue = installRafQueue();
    const run = vi.fn();
    const scheduler = new ReconcileScheduler(run);
    scheduler.activate(1);

    scheduler.request();
    scheduler.request();
    scheduler.request();

    expect(queue.callbacks).toHaveLength(1);
    runNext(queue.callbacks);
    expect(run).toHaveBeenCalledTimes(1);
    queue.restore();
  });

  it("waits for two quiet frames after layout", () => {
    const queue = installRafQueue();
    const run = vi.fn();
    const scheduler = new ReconcileScheduler(run);
    scheduler.activate(1);

    scheduler.requestAfterLayout();
    runNext(queue.callbacks);
    expect(run).not.toHaveBeenCalled();
    runNext(queue.callbacks);
    expect(run).toHaveBeenCalledTimes(1);
    queue.restore();
  });

  it("waits for two quiet frames after scrolling ends", () => {
    const queue = installRafQueue();
    const run = vi.fn();
    const scheduler = new ReconcileScheduler(run);
    scheduler.activate(1);

    scheduler.notifyScroll();
    expect(queue.callbacks).toHaveLength(0);
    scheduler.notifyScrollEnd();
    expect(queue.callbacks).toHaveLength(1);
    runNext(queue.callbacks);
    expect(run).not.toHaveBeenCalled();
    runNext(queue.callbacks);
    expect(run).toHaveBeenCalledTimes(1);
    queue.restore();
  });

  it("does not schedule a settle RAF during continuous scroll bursts", () => {
    const queue = installRafQueue();
    const run = vi.fn();
    const scheduler = new ReconcileScheduler(run);
    scheduler.activate(1);

    for (let index = 0; index < 100; index += 1) {
      scheduler.notifyScroll();
      expect(queue.callbacks).toHaveLength(0);
    }
    expect(run).not.toHaveBeenCalled();

    scheduler.notifyScrollEnd();
    expect(queue.callbacks).toHaveLength(1);
    runNext(queue.callbacks);
    expect(run).not.toHaveBeenCalled();
    runNext(queue.callbacks);
    expect(run).toHaveBeenCalledTimes(1);
    queue.restore();
  });

  it("resets quiet-frame progress when scrolling resumes", () => {
    const queue = installRafQueue();
    const run = vi.fn();
    const scheduler = new ReconcileScheduler(run);
    scheduler.activate(1);

    scheduler.notifyScroll();
    scheduler.notifyScrollEnd();
    runNext(queue.callbacks);
    expect(run).not.toHaveBeenCalled();

    scheduler.notifyScroll();
    expect(queue.callbacks).toHaveLength(0);
    scheduler.notifyScrollEnd();
    runNext(queue.callbacks);
    expect(run).not.toHaveBeenCalled();
    runNext(queue.callbacks);
    expect(run).toHaveBeenCalledTimes(1);
    queue.restore();
  });

  it("makes callbacks from an older mount generation inert", () => {
    const queue = installRafQueue();
    const run = vi.fn();
    const scheduler = new ReconcileScheduler(run);
    scheduler.activate(1);
    scheduler.request();
    const stale = queue.callbacks.shift()!;

    scheduler.activate(2);
    scheduler.request();
    stale(0);
    expect(run).not.toHaveBeenCalled();

    runNext(queue.callbacks);
    expect(run).toHaveBeenCalledTimes(1);
    queue.restore();
  });
});
