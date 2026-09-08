/**
 * Cooperative scheduler for yielding long-running work to the event loop.
 *
 * Prefers `scheduler.postTask` → `MessageChannel` → `setTimeout(0)`.
 * Each scheduled continuation can be cancelled before it fires.
 * Generic — no quick-search or renderer business logic.
 */

export type CooperativePriority = "user-blocking" | "user-visible" | "background";

export interface CooperativeScheduleOptions {
  priority?: CooperativePriority;
}

export interface CooperativeHandle {
  cancel(): void;
}

export interface CooperativeSchedulerBackend {
  schedule(cb: () => void, options?: CooperativeScheduleOptions): CooperativeHandle;
}

function createPostTaskBackend(): CooperativeSchedulerBackend | null {
  const s = (globalThis as Record<string, unknown>).scheduler;
  if (
    typeof s === "object" &&
    s !== null &&
    typeof (s as Record<string, unknown>).postTask === "function"
  ) {
    const sched = s as { postTask(cb: () => void, opts?: { priority?: string; signal?: AbortSignal }): Promise<void> };
    return {
      schedule(cb, options) {
        const ctrl = new AbortController();
        const priority = options?.priority ?? "user-visible";
        sched.postTask(cb, { priority, signal: ctrl.signal }).catch(() => {});
        return { cancel: () => ctrl.abort() };
      },
    };
  }
  return null;
}

function createMessageChannelBackend(): CooperativeSchedulerBackend | null {
  if (typeof MessageChannel !== "function") return null;
  return {
    schedule(cb) {
      let cancelled = false;
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        if (!cancelled) cb();
        ch.port1.close();
      };
      ch.port2.postMessage(null);
      return {
        cancel() {
          cancelled = true;
          ch.port1.close();
        },
      };
    },
  };
}

function createSetTimeoutBackend(): CooperativeSchedulerBackend {
  return {
    schedule(cb) {
      const id = setTimeout(cb, 0);
      return {
        cancel() {
          clearTimeout(id);
        },
      };
    },
  };
}

export function resolveCooperativeBackend(): CooperativeSchedulerBackend {
  return (
    createPostTaskBackend() ??
    createMessageChannelBackend() ??
    createSetTimeoutBackend()
  );
}

export class CooperativeScheduler {
  private readonly backend: CooperativeSchedulerBackend;

  constructor(backend?: CooperativeSchedulerBackend) {
    this.backend = backend ?? resolveCooperativeBackend();
  }

  schedule(cb: () => void, options?: CooperativeScheduleOptions): CooperativeHandle {
    return this.backend.schedule(cb, options);
  }
}
