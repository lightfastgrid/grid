import type { WorkerFilterPayload } from "./filterWorkerPayload";

export interface FilterWorkerRequest {
  kind: "filter";
  requestId: number;
  payload: WorkerFilterPayload;
}

export interface FilterWorkerSuccess {
  kind: "filter:success";
  requestId: number;
  indexes: Uint32Array;
}

export interface FilterWorkerError {
  kind: "filter:error";
  requestId: number;
  message: string;
}

export type FilterWorkerResponse = FilterWorkerSuccess | FilterWorkerError;
