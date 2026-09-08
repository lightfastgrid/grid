/**
 * Worker protocol types for quick-search execution.
 *
 * Snapshot chunks carry searchable/projection field values only —
 * never full `RowData[]` objects. This keeps structured-clone cost
 * proportional to searchable text, not total row size.
 *
 * Dirty-row updates use a transactional patch protocol:
 * `snapshotPatchStart` → `snapshotPatchChunk*` → `snapshotPatchComplete`.
 */

import type { QuickFilterCacheMode } from "../../../types";

// ── Snapshot payload types ──────────────────────────────────────────

export interface SearchProjectionField {
  field: string;
  projectionField?: string;
}

export interface SearchableSnapshotRow {
  rowIndex: number;
  values: string[];
}

export type SnapshotPayloadFormat = "searchable-fields-v1" | "flat-utf8-v1";

// ── Worker request messages ─────────────────────────────────────────

export interface SnapshotStartMessage {
  kind: "quickSearch:snapshotStart";
  generation: number;
  rowCount: number;
  fields: SearchProjectionField[];
  payloadFormat: SnapshotPayloadFormat;
  normalizerSignature: string;
  sourceLayoutRevision: number;
  searchableDataRevision: number;
}

export interface SearchableFieldsSnapshotChunkMessage {
  kind: "quickSearch:snapshotChunk";
  generation: number;
  startIndex: number;
  payloadFormat: "searchable-fields-v1";
  rows: SearchableSnapshotRow[];
}

export interface FlatUtf8SnapshotChunkMessage {
  kind: "quickSearch:snapshotChunk";
  generation: number;
  startIndex: number;
  payloadFormat: "flat-utf8-v1";
  textUtf8: Uint8Array;
  rowOffsets: Uint32Array;
}

export type SnapshotChunkMessage =
  | SearchableFieldsSnapshotChunkMessage
  | FlatUtf8SnapshotChunkMessage;

export interface SnapshotCompleteMessage {
  kind: "quickSearch:snapshotComplete";
  generation: number;
}

export interface SnapshotPatchStartMessage {
  kind: "quickSearch:snapshotPatchStart";
  patchId: number;
  generation: number;
  sourceLayoutRevision: number;
  baseDataRevision: number;
  targetDataRevision: number;
  totalUniqueRows: number;
  totalChunks: number;
}

export interface SnapshotPatchChunkMessage {
  kind: "quickSearch:snapshotPatchChunk";
  patchId: number;
  generation: number;
  chunkSequence: number;
  updates: SearchableSnapshotRow[];
}

export interface SnapshotPatchCompleteMessage {
  kind: "quickSearch:snapshotPatchComplete";
  patchId: number;
  generation: number;
  targetDataRevision: number;
  totalUniqueRows: number;
  totalChunks: number;
}

export interface QueryMessage {
  kind: "quickSearch:query";
  generation: number;
  requestId: number;
  normalizedText: string;
  sourceIndexes: Uint32Array | null;
  /** Monotonic upstream filtered-order version for O(1) cache keying. */
  sourceVersion: number;
  cacheMode: QuickFilterCacheMode;
  sourceLayoutRevision: number;
  searchableDataRevision: number;
}

export interface CancelQueryMessage {
  kind: "quickSearch:cancel";
  requestId?: number;
}

export interface ClearSnapshotMessage {
  kind: "quickSearch:clearSnapshot";
}

export type QuickSearchWorkerRequest =
  | SnapshotStartMessage
  | SnapshotChunkMessage
  | SnapshotCompleteMessage
  | SnapshotPatchStartMessage
  | SnapshotPatchChunkMessage
  | SnapshotPatchCompleteMessage
  | QueryMessage
  | CancelQueryMessage
  | ClearSnapshotMessage;

// ── Worker response messages ────────────────────────────────────────

export interface QuickSearchReadyResponse {
  kind: "quickSearch:ready";
  generation: number;
}

export interface QuickSearchSuccessResponse {
  kind: "quickSearch:success";
  requestId: number;
  indexes: Uint32Array;
}

/**
 * Typed worker error codes. Clients must branch on `code`, never parse
 * `message` text.
 */
export type QuickSearchErrorCode =
  | "snapshot-unavailable"
  | "generation-mismatch"
  | "layout-mismatch"
  | "revision-mismatch"
  | "patch-in-progress"
  | "worker-error";

export interface QuickSearchErrorResponse {
  kind: "quickSearch:error";
  requestId: number;
  code: QuickSearchErrorCode;
  message: string;
}

/**
 * Typed patch rejection reasons. Clients must branch on `reason`, never
 * parse free-form text.
 */
export type QuickSearchPatchRejectReason =
  | "generation-mismatch"
  | "layout-mismatch"
  | "revision-mismatch"
  | "chunk-sequence-mismatch"
  | "incomplete-staging"
  | "staging-limit";

export interface PatchRejectedMessage {
  kind: "quickSearch:patchRejected";
  patchId: number;
  generation: number;
  reason: QuickSearchPatchRejectReason;
}

export type QuickSearchWorkerResponse =
  | QuickSearchReadyResponse
  | QuickSearchSuccessResponse
  | QuickSearchErrorResponse
  | PatchRejectedMessage;

/** Recoverable snapshot-identity mismatches — worker rebuild first. */
export const QUICK_SEARCH_RECOVERABLE_ERROR_CODES: ReadonlySet<QuickSearchErrorCode> =
  new Set([
    "snapshot-unavailable",
    "generation-mismatch",
    "layout-mismatch",
    "revision-mismatch",
  ]);
