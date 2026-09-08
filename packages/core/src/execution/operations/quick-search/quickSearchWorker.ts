/**
 * Quick-search worker script.
 *
 * Instantiates a {@link QuickSearchWorkerRuntime} and routes incoming
 * protocol messages into it. Responses are posted back via the worker
 * global `postMessage`.
 *
 * Unlike sort/filter workers, quick-search is stateful: the runtime
 * owns a reusable snapshot store and query engine across requests.
 *
 * No DOM, Grid, feature, ColumnDef, or RowData imports.
 */

import type { QuickSearchWorkerRequest, QuickSearchWorkerResponse } from "./quickSearchProtocol";
import { QuickSearchWorkerRuntime } from "./quickSearchWorkerRuntime";

declare const self: {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<QuickSearchWorkerRequest>) => void,
  ): void;
  postMessage(message: QuickSearchWorkerResponse, transfer: Transferable[]): void;
  postMessage(message: QuickSearchWorkerResponse): void;
};

const runtime = new QuickSearchWorkerRuntime((response) => {
  if (response.kind === "quickSearch:success") {
    self.postMessage(response, [response.indexes.buffer]);
  } else {
    self.postMessage(response);
  }
});

self.addEventListener("message", (event: MessageEvent<QuickSearchWorkerRequest>) => {
  runtime.handleMessage(event.data);
});
