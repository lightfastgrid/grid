/**
 * Lazy worker client for sort execution.
 *
 * Manages the lifecycle of a single dedicated Web Worker that runs
 * the pure sort algorithm. The worker is created lazily on first
 * {@link SortWorkerClient.execute} call and reused across subsequent
 * requests.
 *
 * Stale responses (from cancelled or superseded requests) are silently
 * ignored. If Worker is unavailable or construction fails, the client
 * falls back to calling `onError` so the caller can use main-thread
 * sorting.
 *
 * This class is internal — not exported publicly. It is the sort
 * operation's `OperationWorkerClient`: created via
 * `sortOperation.worker.createClient()` and owned by
 * `WorkerTaskExecutor`, with the runner falling back to the
 * main-thread async path on error.
 */

import type { WorkerSortPayload } from "./sortWorkerPayload";
import type { SortWorkerRequest, SortWorkerResponse } from "./sortWorkerTypes";

// ── Public API ────────────────────────────────────────────────────────

export class SortWorkerClient {
  private worker: Worker | null = null;
  private activeRequestId: number | null = null;
  private destroyed = false;

  // Callbacks for the currently active request.
  private onSuccess: ((requestId: number, indexes: Uint32Array) => void) | null = null;
  private onError: ((requestId: number, error: Error) => void) | null = null;

  /**
   * Post a sort request to the worker.
   *
   * If a previous request is still active, its response will be
   * silently ignored when it arrives (superseded by the new request).
   *
   * If Worker is unavailable or construction fails, `onError` is
   * called synchronously.
   */
  execute(
    requestId: number,
    payload: WorkerSortPayload,
    onSuccess: (requestId: number, indexes: Uint32Array) => void,
    onError: (requestId: number, error: Error) => void,
  ): void {
    if (this.destroyed) {
      onError(requestId, new Error("SortWorkerClient destroyed"));
      return;
    }

    // Track the new request — any response for a previous requestId
    // will be discarded in handleMessage/handleError.
    this.activeRequestId = requestId;
    this.onSuccess = onSuccess;
    this.onError = onError;

    // Lazy-create the worker on first execute().
    if (!this.worker) {
      try {
        if (typeof Worker === "undefined") {
          onError(requestId, new Error("Worker unavailable"));
          this.clearActive();
          return;
        }
        this.worker = new Worker(
          new URL("./sortWorker.ts", import.meta.url),
          { type: "module" },
        );
        this.worker.onmessage = this.handleMessage;
        this.worker.onerror = this.handleError;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError(requestId, error);
        this.clearActive();
        return;
      }
    }

    const request: SortWorkerRequest = {
      kind: "sort",
      requestId,
      payload,
    };
    this.worker.postMessage(request);
  }

  /**
   * Cancel the active request. Any response for the cancelled
   * requestId will be silently ignored.
   */
  cancel(): void {
    this.clearActive();
  }

  /**
   * Terminate the worker and release all resources.
   *
   * After destroy, any subsequent `execute()` calls will immediately
   * call `onError`.
   */
  destroy(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.clearActive();
    this.destroyed = true;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private clearActive(): void {
    this.activeRequestId = null;
    this.onSuccess = null;
    this.onError = null;
  }

  private readonly handleMessage = (event: MessageEvent<SortWorkerResponse>): void => {
    const response = event.data;
    if (response.requestId !== this.activeRequestId) return; // stale

    if (response.kind === "sort:success") {
      const cb = this.onSuccess;
      const id = this.activeRequestId;
      this.clearActive();
      cb?.(id, response.indexes);
    } else {
      const cb = this.onError;
      const id = this.activeRequestId;
      this.clearActive();
      cb?.(id, new Error(response.message));
    }
  };

  /**
   * Tear down the current worker without marking the client as
   * destroyed. The next `execute()` call will lazily create a fresh
   * Worker instance.
   */
  private teardownWorker(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }

  private readonly handleError = (event: ErrorEvent): void => {
    const cb = this.onError;
    const id = this.activeRequestId;
    this.clearActive();

    // Always tear down the worker on error — it may be in a broken
    // state (module load failure, uncaught exception). The next
    // execute() will lazily create a fresh Worker.
    this.teardownWorker();

    if (id !== null) {
      cb?.(id, new Error(event.message || "Worker error"));
    }
  };
}
