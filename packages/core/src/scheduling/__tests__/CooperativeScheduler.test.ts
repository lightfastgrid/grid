import { describe, expect, it, vi } from 'vitest';

import type { CooperativeScheduleOptions,CooperativeSchedulerBackend } from '../CooperativeScheduler';
import { CooperativeScheduler } from '../CooperativeScheduler';

function createManualBackend(): CooperativeSchedulerBackend & {
  flush(): void;
  pending(): number;
} {
  const queue: Array<{ cb: () => void; cancelled: boolean }> = [];
  return {
    schedule(cb) {
      const entry = { cb, cancelled: false };
      queue.push(entry);
      return {
        cancel() {
          entry.cancelled = true;
        },
      };
    },
    flush() {
      const snapshot = queue.splice(0);
      for (const entry of snapshot) {
        if (!entry.cancelled) entry.cb();
      }
    },
    pending() {
      return queue.filter((e) => !e.cancelled).length;
    },
  };
}

describe('CooperativeScheduler', () => {
  // ── 5. Scheduled continuation runs ──────────────────────────────────

  it('runs a scheduled continuation', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const spy = vi.fn();

    scheduler.schedule(spy);
    expect(spy).not.toHaveBeenCalled();

    backend.flush();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // ── 6. Cancellation prevents continuation from running ──────────────

  it('cancellation prevents the continuation from running', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const spy = vi.fn();

    const handle = scheduler.schedule(spy);
    handle.cancel();

    backend.flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it('cancelling one handle does not affect others', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const a = vi.fn();
    const b = vi.fn();

    const handleA = scheduler.schedule(a);
    scheduler.schedule(b);
    handleA.cancel();

    backend.flush();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  // ── 7. Fallback behavior is testable ────────────────────────────────

  it('supports injected backend for testable fallback', () => {
    const spy = vi.fn();
    let captured: (() => void) | null = null;
    const backend: CooperativeSchedulerBackend = {
      schedule(cb) {
        captured = cb;
        return { cancel() { captured = null; } };
      },
    };
    const scheduler = new CooperativeScheduler(backend);

    scheduler.schedule(spy);
    expect(captured).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();

    captured!();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('multiple continuations schedule independently', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const calls: number[] = [];

    scheduler.schedule(() => calls.push(1));
    scheduler.schedule(() => calls.push(2));
    scheduler.schedule(() => calls.push(3));

    expect(backend.pending()).toBe(3);
    backend.flush();
    expect(calls).toEqual([1, 2, 3]);
  });

  it('cancel after flush is a safe no-op', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const spy = vi.fn();

    const handle = scheduler.schedule(spy);
    backend.flush();
    expect(spy).toHaveBeenCalledTimes(1);

    expect(() => handle.cancel()).not.toThrow();
  });

  // ── Priority support ────────────────────────────────────────────────

  it('passes priority option through to the backend', () => {
    const received: Array<CooperativeScheduleOptions | undefined> = [];
    const backend: CooperativeSchedulerBackend = {
      schedule(cb, options) {
        received.push(options);
        cb();
        return { cancel() {} };
      },
    };
    const scheduler = new CooperativeScheduler(backend);

    scheduler.schedule(() => {}, { priority: 'background' });
    scheduler.schedule(() => {}, { priority: 'user-blocking' });
    scheduler.schedule(() => {});

    expect(received).toEqual([
      { priority: 'background' },
      { priority: 'user-blocking' },
      undefined,
    ]);
  });

  it('defaults priority when not specified', () => {
    const received: Array<CooperativeScheduleOptions | undefined> = [];
    const backend: CooperativeSchedulerBackend = {
      schedule(cb, options) {
        received.push(options);
        cb();
        return { cancel() {} };
      },
    };
    const scheduler = new CooperativeScheduler(backend);

    scheduler.schedule(() => {});
    expect(received[0]).toBeUndefined();
  });
});
