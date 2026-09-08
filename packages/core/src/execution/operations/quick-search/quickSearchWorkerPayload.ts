/**
 * Lightweight worker payload for quick-search execution.
 *
 * `buildPayload` is O(1) relative to row and column count — it captures
 * references and metadata only. Snapshot extraction is owned by
 * {@link QuickSearchWorkerClient} + {@link QuickSearchSnapshotClient}
 * at runtime, and by {@link executeQuickSearchWorkerPayload} for
 * parity tests.
 */

import { defaultNormalizer } from "../../../features/quick-search/normalizer";
import type { SearchableFieldDescriptor } from "../../../features/quick-search/searchableFieldResolver";
import type { QuickFilterCacheMode, RowData } from "../../../types";

import type { SnapshotTransferInput } from "./QuickSearchSnapshotClient";

export interface QuickSearchWorkerPayload {
  /** Raw rows — snapshot extraction is deferred to the worker client. */
  rows: RowData[];
  /** Searchable field descriptors with worker-eligibility metadata. */
  descriptors: readonly SearchableFieldDescriptor[];
  fieldsSignature: string;
  /** Already normalized query text. */
  normalizedText: string;
  /** Upstream filtered order; null = full dataset. */
  sourceIndexes: Uint32Array | null;
  /** Monotonic filtered-order version for O(1) cache keying. */
  sourceVersion: number;
  cacheMode: QuickFilterCacheMode;
  normalizerSignature: string;
  /** Captured at schedule time — not yet posted on worker protocol messages. */
  sourceLayoutRevision: number;
  /** Captured at schedule time — not yet posted on worker protocol messages. */
  searchableDataRevision: number;
  /**
   * Adapter-only main-thread lifecycle metadata for transactional patching.
   *
   * Never posted wholesale via Worker.postMessage. Only the transactional
   * protocol messages created by SnapshotClient (`snapshotPatchStart` /
   * `snapshotPatchChunk` / `snapshotPatchComplete`) cross the Worker
   * boundary. Parity helpers ignore this field.
   */
  transfer?: SnapshotTransferInput;
}

/**
 * Build a lightweight worker payload. O(1) relative to rows and columns —
 * no row-level field extraction, searchable-field resolution, column
 * scans, set copying, or transfer-index iteration occur here.
 */
export function buildQuickSearchWorkerPayload(
  rows: RowData[],
  descriptors: readonly SearchableFieldDescriptor[],
  fieldsSignature: string,
  quickFilterText: string,
  sourceIndexes: Uint32Array | undefined,
  sourceVersion: number,
  cacheMode: QuickFilterCacheMode,
  sourceLayoutRevision: number,
  searchableDataRevision: number,
  transfer?: SnapshotTransferInput,
): QuickSearchWorkerPayload | null {
  const normalizer = defaultNormalizer;
  const normalizedText = normalizer.normalizeQuery(quickFilterText);

  return {
    rows,
    descriptors,
    fieldsSignature,
    normalizedText,
    sourceIndexes: sourceIndexes ?? null,
    sourceVersion,
    cacheMode,
    normalizerSignature: normalizer.signature,
    sourceLayoutRevision,
    searchableDataRevision,
    ...(transfer !== undefined ? { transfer } : {}),
  };
}
