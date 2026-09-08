/**
 * CSV Export V1 Worker entry (Stage 4B).
 *
 * Owns one stateful encoder runtime. Encoded byte buffers transfer directly;
 * all other protocol responses use structured clone without a transfer list.
 */

import type {
  CsvWorkerResponse,
} from "./csvExportProtocol";
import { getCsvEncodedChunkTransferList } from "./csvExportProtocol";
import { CsvExportWorkerRuntime } from "./csvExportWorkerRuntime";

declare const self: {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: CsvWorkerResponse, transfer: Transferable[]): void;
  postMessage(message: CsvWorkerResponse): void;
};

const runtime = new CsvExportWorkerRuntime((response) => {
  if (response.kind === "csv:encodedChunk") {
    self.postMessage(response, getCsvEncodedChunkTransferList(response));
  } else {
    self.postMessage(response);
  }
});

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  runtime.handleMessage(event.data);
});
