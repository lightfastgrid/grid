/**
 * Message types for the sort worker boundary.
 *
 * These types define the structured-clone-safe contract between
 * {@link SortWorkerClient} and the sort worker script. They are
 * intentionally kept in a small shared file so both sides can import
 * them without pulling in Grid, ColumnDef, or renderer code.
 */

import type { WorkerSortPayload } from "./sortWorkerPayload";

// ── Request ───────────────────────────────────────────────────────────

/** Message posted from the main thread to the sort worker. */
export interface SortWorkerRequest {
  kind: "sort";
  requestId: number;
  payload: WorkerSortPayload;
}

// ── Response ──────────────────────────────────────────────────────────

/** Successful sort result posted from the worker back to main thread. */
export interface SortWorkerSuccess {
  kind: "sort:success";
  requestId: number;
  indexes: Uint32Array;
}

/** Error result posted from the worker back to main thread. */
export interface SortWorkerError {
  kind: "sort:error";
  requestId: number;
  message: string;
}

/** Discriminated union of all worker responses. */
export type SortWorkerResponse = SortWorkerSuccess | SortWorkerError;
