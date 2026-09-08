/**
 * One-handle scheduler for accessibility reconciliation.
 *
 * Ordinary requests coalesce to one frame. Layout-sensitive requests wait for
 * two consecutive quiet frames. Viewport scrolling cancels any in-flight quiet
 * loop and does not schedule work on the scroll caller stack. Quiet-frame
 * settle begins only after scroll-end notification, so continuous scrolling
 * does not pay a plugin RAF or timer every frame. A frame callback is
 * allocated once per mount, never per scroll.
 */
export class ReconcileScheduler {
  private handle = 0;
  private pending = false;
  private settling = false;
  private quietFrameCount = 0;
  private activeGeneration = 0;
  private frameCallback: FrameRequestCallback = () => {};

  constructor(private readonly run: () => void) {}

  activate(generation: number): void {
    this.cancel();
    this.activeGeneration = generation;
    this.frameCallback = () => this.onFrame(generation);
  }

  request(): void {
    this.pending = true;
    this.schedule();
  }

  /** Queue work after two quiet frames so renderer-owned bindings are current. */
  requestAfterLayout(): void {
    this.pending = true;
    this.settling = true;
    this.quietFrameCount = 0;
    this.schedule();
  }

  /**
   * O(1), allocation-free viewport-scroll notification.
   * Cancels any quiet-frame RAF. Does not schedule timers or frames — settle
   * starts only from {@link notifyScrollEnd}.
   */
  notifyScroll(): void {
    this.pending = true;
    this.settling = true;
    this.quietFrameCount = 0;
    if (this.handle !== 0) {
      cancelAnimationFrame(this.handle);
      this.handle = 0;
    }
  }

  /**
   * Begin the two quiet-frame settle loop after scrolling ends.
   * Invoked from the viewport `scrollend` listener (or test dispatch).
   */
  notifyScrollEnd(): void {
    if (this.activeGeneration === 0) return;
    if (!this.pending) return;
    this.settling = true;
    this.quietFrameCount = 0;
    this.schedule();
  }

  private schedule(): void {
    if (this.handle !== 0 || this.activeGeneration === 0) return;
    this.handle = requestAnimationFrame(this.frameCallback);
  }

  private onFrame(generation: number): void {
    if (generation !== this.activeGeneration) return;
    this.handle = 0;

    if (this.settling) {
      this.quietFrameCount += 1;
      if (this.quietFrameCount < 2) {
        this.schedule();
        return;
      }
      this.settling = false;
      this.quietFrameCount = 0;
    }

    this.runPending();
  }

  private runPending(): void {
    if (!this.pending) return;
    this.pending = false;
    this.run();
  }

  /** Run any pending reconcile now (synchronously) and clear the frame. */
  flush(): void {
    if (this.handle !== 0) {
      cancelAnimationFrame(this.handle);
      this.handle = 0;
    }
    if (this.pending) {
      this.settling = false;
      this.quietFrameCount = 0;
      this.runPending();
    }
  }

  /** Drop any pending reconcile without running it. */
  cancel(): void {
    if (this.handle !== 0) {
      cancelAnimationFrame(this.handle);
      this.handle = 0;
    }
    this.pending = false;
    this.settling = false;
    this.quietFrameCount = 0;
  }

  deactivate(): void {
    this.cancel();
    this.activeGeneration = 0;
    this.frameCallback = () => {};
  }
}
