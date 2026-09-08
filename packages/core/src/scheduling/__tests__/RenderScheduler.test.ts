import { describe, expect, it, vi } from 'vitest';

import type { FrameScheduler } from '../RenderScheduler';
import { RenderScheduler } from '../RenderScheduler';

/**
 * Synchronous manual scheduler: keeps queued tasks until `flush()` is called.
 * Avoids relying on real timers or rAF — tests stay deterministic.
 */
function createManualScheduler() {
  const pending = new Map<number, () => void>();
  let nextHandle = 1;
  const scheduler: FrameScheduler = {
    schedule(cb) {
      const handle = nextHandle++;
      pending.set(handle, cb);
      return handle;
    },
    cancel(handle) {
      pending.delete(handle);
    },
  };
  return {
    scheduler,
    flush() {
      for (const cb of [...pending.values()]) cb();
      pending.clear();
    },
    size: () => pending.size,
  };
}

describe('RenderScheduler', () => {
  it('runs the scheduled task after the frame', () => {
    const manual = createManualScheduler();
    const scheduler = new RenderScheduler(manual.scheduler);
    const spy = vi.fn();
    scheduler.schedule(spy);
    expect(spy).not.toHaveBeenCalled();
    manual.flush();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('batches multiple schedules into a single frame', () => {
    const manual = createManualScheduler();
    const scheduler = new RenderScheduler(manual.scheduler);
    const spy = vi.fn();
    scheduler.schedule(spy);
    scheduler.schedule(spy);
    scheduler.schedule(spy);
    expect(manual.size()).toBe(1);
    manual.flush();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest task when schedule() is called repeatedly', () => {
    const manual = createManualScheduler();
    const scheduler = new RenderScheduler(manual.scheduler);
    const a = vi.fn();
    const b = vi.fn();
    scheduler.schedule(a);
    scheduler.schedule(b);
    manual.flush();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('cancel drops a pending task', () => {
    const manual = createManualScheduler();
    const scheduler = new RenderScheduler(manual.scheduler);
    const spy = vi.fn();
    scheduler.schedule(spy);
    scheduler.cancel();
    manual.flush();
    expect(spy).not.toHaveBeenCalled();
  });
});
