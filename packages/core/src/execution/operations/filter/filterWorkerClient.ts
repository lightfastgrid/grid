import type { WorkerFilterPayload } from "./filterWorkerPayload";
import type {
  FilterWorkerRequest,
  FilterWorkerResponse,
} from "./filterWorkerTypes";

export class FilterWorkerClient {
  private worker: Worker | null = null;
  private activeRequestId: number | null = null;
  private destroyed = false;

  private onSuccess:
    | ((requestId: number, indexes: Uint32Array) => void)
    | null = null;
  private onError:
    | ((requestId: number, error: Error) => void)
    | null = null;

  execute(
    requestId: number,
    payload: WorkerFilterPayload,
    onSuccess: (requestId: number, indexes: Uint32Array) => void,
    onError: (requestId: number, error: Error) => void,
  ): void {
    if (this.destroyed) {
      onError(requestId, new Error("FilterWorkerClient destroyed"));
      return;
    }

    this.activeRequestId = requestId;
    this.onSuccess = onSuccess;
    this.onError = onError;

    if (!this.worker) {
      try {
        if (typeof Worker === "undefined") {
          onError(requestId, new Error("Worker unavailable"));
          this.clearActive();
          return;
        }
        this.worker = new Worker(
          new URL("./filterWorker.ts", import.meta.url),
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

    const request: FilterWorkerRequest = {
      kind: "filter",
      requestId,
      payload,
    };
    this.worker.postMessage(request);
  }

  cancel(): void {
    this.clearActive();
  }

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

  private clearActive(): void {
    this.activeRequestId = null;
    this.onSuccess = null;
    this.onError = null;
  }

  private readonly handleMessage = (
    event: MessageEvent<FilterWorkerResponse>,
  ): void => {
    const response = event.data;
    if (response.requestId !== this.activeRequestId) return;

    if (response.kind === "filter:success") {
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
    this.teardownWorker();

    if (id !== null) {
      cb?.(id, new Error(event.message || "Worker error"));
    }
  };
}
