/**
 * Main-thread executor for execution operations.
 *
 * Runs an operation's main-thread path either immediately (small work)
 * or deferred via requestAnimationFrame + setTimeout (large fallback
 * work). Deferred handles are tracked per operation name so a newer
 * request cancels the previous one.
 *
 * Owned by {@link OperationExecutionRunner}, which decides when to
 * execute immediately versus deferred.
 */

import type {
  ExecutionOperation,
  ExecutionOperationName,
  WorkerEligibility,
} from "./operations/types";

interface DeferredHandles {
  rafId: number;
  timerId: ReturnType<typeof setTimeout> | null;
}

interface AsyncHandle {
  cancel(): void;
}

export class MainThreadTaskExecutor {
  private readonly pending = new Map<ExecutionOperationName, DeferredHandles>();
  private readonly asyncHandles = new Map<ExecutionOperationName, AsyncHandle>();

  /**
   * Execute the operation synchronously: run the main-thread path,
   * normalize, and record the result in the operation cache.
   */
  executeNow<
    Input,
    MainOutput,
    WorkerPayload,
    WorkerOutput,
    NormalizedOutput,
    Eligibility extends WorkerEligibility,
  >(
    operation: ExecutionOperation<
      Input,
      MainOutput,
      WorkerPayload,
      WorkerOutput,
      NormalizedOutput,
      Eligibility
    >,
    input: Input,
  ): NormalizedOutput {
    const output = operation.mainThread.execute(input);
    const normalized = operation.normalizeMainOutput(output, input);
    operation.cache?.record?.(input, normalized, "mainThread");
    return normalized;
  }

  /**
   * Schedule a deferred main-thread execution (rAF, then a zero
   * timeout) for large fallback work. Cancels any deferred work
   * already pending for the same operation name. `isLatest` is checked
   * before and after the sort so stale requests never complete.
   */
  scheduleDeferred<
    Input,
    MainOutput,
    WorkerPayload,
    WorkerOutput,
    NormalizedOutput,
    Eligibility extends WorkerEligibility,
  >(
    operationName: ExecutionOperationName,
    requestId: number,
    operation: ExecutionOperation<
      Input,
      MainOutput,
      WorkerPayload,
      WorkerOutput,
      NormalizedOutput,
      Eligibility
    >,
    input: Input,
    isLatest: (requestId: number) => boolean,
    onComplete: (requestId: number, output: NormalizedOutput) => void,
  ): void {
    this.cancel(operationName);

    const handles: DeferredHandles = { rafId: 0, timerId: null };
    this.pending.set(operationName, handles);

    const run = (): void => {
      handles.timerId = null;
      this.pending.delete(operationName);
      if (!isLatest(requestId)) return;
      const output = this.executeNow(operation, input);
      if (!isLatest(requestId)) return;
      onComplete(requestId, output);
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      handles.rafId = globalThis.requestAnimationFrame(() => {
        handles.rafId = 0;
        if (!isLatest(requestId)) {
          this.pending.delete(operationName);
          return;
        }
        handles.timerId = setTimeout(run, 0);
      });
    } else {
      handles.timerId = setTimeout(run, 0);
    }
  }

  /**
   * Schedule a cooperative async main-thread execution for operations
   * that expose `executeAsync`. Cancels any deferred or async work
   * already pending for the same operation name.
   */
  scheduleAsync<
    Input,
    MainOutput,
    WorkerPayload,
    WorkerOutput,
    NormalizedOutput,
    Eligibility extends WorkerEligibility,
  >(
    operationName: ExecutionOperationName,
    requestId: number,
    operation: ExecutionOperation<
      Input,
      MainOutput,
      WorkerPayload,
      WorkerOutput,
      NormalizedOutput,
      Eligibility
    >,
    input: Input,
    isLatest: (requestId: number) => boolean,
    onComplete: (requestId: number, output: NormalizedOutput) => void,
  ): void {
    this.cancel(operationName);

    const executeAsync = operation.mainThread.executeAsync;
    if (!executeAsync) {
      this.scheduleDeferred(
        operationName,
        requestId,
        operation,
        input,
        isLatest,
        onComplete,
      );
      return;
    }

    const handle = executeAsync(input, (output) => {
      this.asyncHandles.delete(operationName);
      if (!isLatest(requestId)) return;
      const normalized = operation.normalizeMainOutput(output, input);
      operation.cache?.record?.(input, normalized, "mainThread");
      onComplete(requestId, normalized);
    });
    this.asyncHandles.set(operationName, handle);
  }

  /** Cancel pending deferred work for the given operation name. */
  cancel(operationName: ExecutionOperationName): void {
    const asyncHandle = this.asyncHandles.get(operationName);
    if (asyncHandle) {
      asyncHandle.cancel();
      this.asyncHandles.delete(operationName);
    }

    const handles = this.pending.get(operationName);
    if (!handles) return;
    if (handles.rafId !== 0) {
      if (typeof globalThis.cancelAnimationFrame === "function") {
        globalThis.cancelAnimationFrame(handles.rafId);
      }
      handles.rafId = 0;
    }
    if (handles.timerId !== null) {
      clearTimeout(handles.timerId);
      handles.timerId = null;
    }
    this.pending.delete(operationName);
  }

  /** Cancel all pending deferred work. */
  destroy(): void {
    for (const operationName of [...this.pending.keys()]) {
      this.cancel(operationName);
    }
  }
}
