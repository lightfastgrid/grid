/**
 * CSV Export V1 - browser module-Worker transport adapter (Stage 4E).
 *
 * Worker construction occurs only when this factory is invoked. The adapter
 * owns message/error listeners and removes them before terminating the Worker.
 * It performs no prewarm, task selection, projection, or Grid integration.
 */

import type { CsvWorkerRequest } from "./csvExportProtocol";
import type { CsvExportWorkerTransport } from "./csvExportWorkerClient";

export interface CsvExportBrowserWorker extends EventTarget {
  postMessage(message: CsvWorkerRequest): void;
  postMessage(message: CsvWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export type CsvExportBrowserWorkerFactory = () => CsvExportBrowserWorker;

function createBrowserWorker(): CsvExportBrowserWorker {
  return new Worker(
    new URL("./csvExportWorker.ts", import.meta.url),
    { type: "module" },
  );
}

class BrowserCsvExportWorkerTransport implements CsvExportWorkerTransport {
  private readonly messageListeners = new Set<EventListener>();
  private readonly errorListeners = new Set<EventListener>();
  private terminated = false;

  constructor(private readonly worker: CsvExportBrowserWorker) {}

  post(message: CsvWorkerRequest, transfer?: Transferable[]): void {
    if (this.terminated) {
      throw new Error("CSV Worker transport terminated");
    }
    if (transfer === undefined) {
      this.worker.postMessage(message);
    } else {
      this.worker.postMessage(message, transfer);
    }
  }

  subscribe(handler: (message: unknown) => void): () => void {
    if (this.terminated) return () => undefined;
    const listener: EventListener = (event) => {
      if (this.terminated || !(event instanceof MessageEvent)) return;
      handler(event.data);
    };
    this.messageListeners.add(listener);
    this.worker.addEventListener("message", listener);
    return this.createUnsubscribe("message", listener, this.messageListeners);
  }

  subscribeError(handler: (error: unknown) => void): () => void {
    if (this.terminated) return () => undefined;
    const listener: EventListener = (event) => {
      if (this.terminated) return;
      if (typeof ErrorEvent !== "undefined" && event instanceof ErrorEvent) {
        const workerError: unknown = event.error;
        if (workerError !== undefined && workerError !== null) {
          handler(workerError);
          return;
        }
        if (event.message.length > 0) {
          handler(new Error(event.message));
          return;
        }
      }
      handler(event);
    };
    this.errorListeners.add(listener);
    this.worker.addEventListener("error", listener);
    return this.createUnsubscribe("error", listener, this.errorListeners);
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    for (const listener of this.messageListeners) {
      this.worker.removeEventListener("message", listener);
    }
    for (const listener of this.errorListeners) {
      this.worker.removeEventListener("error", listener);
    }
    this.messageListeners.clear();
    this.errorListeners.clear();
    this.worker.terminate();
  }

  private createUnsubscribe(
    type: "message" | "error",
    listener: EventListener,
    listeners: Set<EventListener>,
  ): () => void {
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      if (!listeners.delete(listener)) return;
      this.worker.removeEventListener(type, listener);
    };
  }
}

/** Lazily construct the real module Worker and its transport ownership. */
export function createCsvExportWorkerTransport(
  createWorker: CsvExportBrowserWorkerFactory = createBrowserWorker,
): CsvExportWorkerTransport {
  const worker = createWorker();
  return new BrowserCsvExportWorkerTransport(worker);
}
