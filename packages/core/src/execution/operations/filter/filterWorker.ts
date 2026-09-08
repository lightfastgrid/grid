import { executeWorkerFilterPayload } from "./filterWorkerAlgorithm";
import type {
  FilterWorkerRequest,
  FilterWorkerResponse,
} from "./filterWorkerTypes";

declare const self: {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<FilterWorkerRequest>) => void,
  ): void;
  postMessage(message: FilterWorkerResponse, transfer: Transferable[]): void;
  postMessage(message: FilterWorkerResponse): void;
};

self.addEventListener(
  "message",
  (event: MessageEvent<FilterWorkerRequest>) => {
    const { requestId, payload } = event.data;

    try {
      const result = executeWorkerFilterPayload(payload);
      const response: FilterWorkerResponse = {
        kind: "filter:success",
        requestId,
        indexes: result.indexes,
      };
      self.postMessage(response, [result.indexes.buffer]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const response: FilterWorkerResponse = {
        kind: "filter:error",
        requestId,
        message,
      };
      self.postMessage(response);
    }
  },
);
