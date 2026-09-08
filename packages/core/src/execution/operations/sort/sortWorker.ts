/**
 * Sort worker script.
 *
 * Runs {@link executeWorkerSortPayload} in a dedicated Web Worker.
 * Receives {@link SortWorkerRequest} messages, executes the pure sort
 * algorithm, and posts back {@link SortWorkerResponse} messages.
 *
 * The worker transfers the `indexes.buffer` back to the main thread
 * for zero-copy handoff.
 *
 * No DOM, Grid, renderer, feature, ColumnDef, or RowData imports.
 */

import { executeWorkerSortPayload } from "./sortWorkerAlgorithm";
import type { SortWorkerRequest, SortWorkerResponse } from "./sortWorkerTypes";

// Worker global scope — `self` is typed loosely here because the
// project's tsconfig does not include the WebWorker lib. At runtime
// this file executes inside a dedicated worker where `self` is the
// worker global scope and `postMessage` / `addEventListener` are
// available.
declare const self: {
  addEventListener(type: "message", listener: (event: MessageEvent<SortWorkerRequest>) => void): void;
  postMessage(message: SortWorkerResponse, transfer: Transferable[]): void;
  postMessage(message: SortWorkerResponse): void;
};

self.addEventListener("message", (event: MessageEvent<SortWorkerRequest>) => {
  const request = event.data;

  const { requestId, payload } = request;

  try {
    const result = executeWorkerSortPayload(payload);
    const response: SortWorkerResponse = {
      kind: "sort:success",
      requestId,
      indexes: result.indexes,
    };
    // Transfer the ArrayBuffer for zero-copy handoff.
    self.postMessage(response, [result.indexes.buffer]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const response: SortWorkerResponse = {
      kind: "sort:error",
      requestId,
      message,
    };
    self.postMessage(response);
  }
});
