/**
 * Pure quick-search worker algorithm for parity tests.
 *
 * Simulates what the worker runtime does: extracts snapshot rows from
 * raw row data, loads the snapshot store, and runs a synchronous
 * query-engine execution. Never used at runtime — parity tests call
 * this to verify main-thread and worker paths produce identical results.
 */

import { extractSnapshotSync } from "../../../features/quick-search/snapshotExtractor";
import type { CooperativeSchedulerBackend } from "../../../scheduling/CooperativeScheduler";
import { CooperativeScheduler } from "../../../scheduling/CooperativeScheduler";

import { parseQueryParts } from "./quickSearchMatcher";
import { QuickSearchQueryEngine } from "./quickSearchQueryEngine";
import { QuickSearchSnapshotStore } from "./quickSearchSnapshotStore";
import type { QuickSearchWorkerPayload } from "./quickSearchWorkerPayload";
import { buildSourceSignature, WORKER_DEFAULT_CONFIG_SIGNATURE } from "./quickSearchWorkerRuntime";

/**
 * Synchronous scheduler backend for parity tests.
 * Runs every scheduled callback immediately so chunked execution
 * completes within a single `engine.execute()` call.
 */
const syncBackend: CooperativeSchedulerBackend = {
  schedule(cb) {
    cb();
    return { cancel() {} };
  },
};

function isEmptyNormalizedQuery(normalizedText: string): boolean {
  const trimmed = normalizedText.trim();
  return trimmed.length === 0 || parseQueryParts(trimmed).length === 0;
}

/**
 * Run the quick-search worker algorithm synchronously on the main
 * thread. Used by parity tests only.
 *
 * Ignores adapter-only `payload.transfer` metadata — parity compares
 * searchable query results, not patch lifecycle ownership.
 *
 * Returns `null` for empty queries — the caller must normalize this
 * to the appropriate `RowIndexExecutionResult`.
 */
export function executeQuickSearchWorkerPayload(
  payload: QuickSearchWorkerPayload,
): Uint32Array | null {
  // Adapter-only transfer must never affect parity extraction/query.
  void payload.transfer;
  if (isEmptyNormalizedQuery(payload.normalizedText)) {
    return null;
  }

  const snapshotRows = extractSnapshotSync({
    rows: payload.rows,
    descriptors: payload.descriptors,
  });

  const store = new QuickSearchSnapshotStore();
  const generation = 1;
  store.start(generation, payload.rows.length);
  store.applyChunk(generation, snapshotRows);
  store.markComplete(generation);

  const scheduler = new CooperativeScheduler(syncBackend);
  const engine = new QuickSearchQueryEngine(store, scheduler);

  const sourceSignature = buildSourceSignature(payload.sourceVersion);

  let result = new Uint32Array(0);
  engine.execute(
    {
      normalizedText: payload.normalizedText,
      generation,
      searchableFieldsKey: payload.fieldsSignature,
      normalizerSignature: payload.normalizerSignature,
      configSignature: WORKER_DEFAULT_CONFIG_SIGNATURE,
      sourceSignature,
      sourceIndexes: payload.sourceIndexes,
      searchableDataRevision: payload.searchableDataRevision,
      sourceLayoutRevision: payload.sourceLayoutRevision,
    },
    (indexes) => {
      result = Uint32Array.from(indexes);
    },
  );

  return result;
}
