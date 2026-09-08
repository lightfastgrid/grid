/** Minimal scheduler interface: one pending frame, latest task wins. */
export interface FrameScheduler {
  schedule(cb: () => void): number;
  cancel(handle: number): void;
}

/** Prefer rAF when available (browsers), fall back to setTimeout (Node, tests). */
const defaultScheduler: FrameScheduler = {
  schedule(cb) {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      return globalThis.requestAnimationFrame(() => cb());
    }
    return setTimeout(cb, 16) as unknown as number;
  },
  cancel(handle) {
    if (typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(handle);
      return;
    }
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  },
};

/**
 * Coalesces rapid-fire updates into a single render per animation frame.
 *
 * Calling `schedule(task)` multiple times before the frame fires keeps only
 * the *most recent* task. `cancel()` drops any pending work.
 */
export class RenderScheduler {
  private handle: number | null = null;
  private task: (() => void) | null = null;
  private readonly frames: FrameScheduler;

  constructor(frames: FrameScheduler = defaultScheduler) {
    this.frames = frames;
  }

  schedule(task: () => void): void {
    this.task = task;
    if (this.handle !== null) return;
    this.handle = this.frames.schedule(() => {
      this.handle = null;
      const pending = this.task;
      this.task = null;
      pending?.();
    });
  }

  cancel(): void {
    if (this.handle !== null) {
      this.frames.cancel(this.handle);
      this.handle = null;
    }
    this.task = null;
  }
}
