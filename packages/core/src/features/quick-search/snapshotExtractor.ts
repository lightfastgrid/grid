/**
 * Searchable-only snapshot extraction.
 *
 * Reads only searchable/projection fields from source rows, normalizes
 * values through the Phase 1 normalizer, and emits chunks of
 * `SearchableSnapshotRow[]`. Never posts full `RowData[]`.
 *
 * Extraction is chunked and cooperatively scheduled so cold extraction
 * over 100k+ rows does not freeze the main thread.
 */

import type { SearchableSnapshotRow } from "../../execution/operations/quick-search/quickSearchProtocol";
import type { CooperativeHandle, CooperativeScheduleOptions } from "../../scheduling/CooperativeScheduler";
import { CooperativeScheduler } from "../../scheduling/CooperativeScheduler";
import type { RowData } from "../../types";

import type { QuickSearchNormalizer } from "./normalizer";
import { defaultNormalizer } from "./normalizer";
import { readRowFieldValue } from "./rowFieldValue";
import type { SearchableFieldDescriptor } from "./searchableFieldResolver";

export const DEFAULT_CHUNK_SIZE = 5000;
export const DEFAULT_BUDGET_MS = 8;

export interface SnapshotExtractionConfig {
  rows: readonly RowData[];
  descriptors: readonly SearchableFieldDescriptor[];
  normalizer?: QuickSearchNormalizer;
  /** Safety cap on rows per scheduled chunk. Time budget is the primary control. */
  chunkSize?: number;
  /** Max main-thread work per scheduled continuation (milliseconds). */
  budgetMs?: number;
  scheduler?: CooperativeScheduler;
  schedulePriority?: CooperativeScheduleOptions;
  /** Injectable monotonic clock for tests. */
  now?: () => number;
}

export interface SnapshotExtractionHandle {
  cancel(): void;
}

function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function resolveChunkSize(chunkSize: number | undefined): number {
  const resolved = chunkSize ?? DEFAULT_CHUNK_SIZE;
  return resolved > 0 ? resolved : DEFAULT_CHUNK_SIZE;
}

function extractRow(
  row: RowData,
  rowIndex: number,
  descriptors: readonly SearchableFieldDescriptor[],
  normalizer: QuickSearchNormalizer,
): SearchableSnapshotRow {
  const values: string[] = new Array(descriptors.length);
  for (let i = 0; i < descriptors.length; i++) {
    const desc = descriptors[i]!;
    const sourceField = desc.projectionField ?? desc.field;
    const raw = readRowFieldValue(row, sourceField);
    values[i] = normalizer.normalizeValue(raw);
  }
  return { rowIndex, values };
}

/**
 * Synchronous full extraction — small inputs and tests ONLY.
 *
 * Cold snapshot extraction for real datasets must go through
 * {@link extractSnapshotChunked}; a synchronous loop over 100k+ rows
 * blocks input. Never wire this into the worker snapshot posting path.
 */
export function extractSnapshotSync(
  config: SnapshotExtractionConfig,
): SearchableSnapshotRow[] {
  const { rows, descriptors } = config;
  const normalizer = config.normalizer ?? defaultNormalizer;
  const result: SearchableSnapshotRow[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    result[i] = extractRow(rows[i]!, i, descriptors, normalizer);
  }
  return result;
}

export function extractSnapshotChunked(
  config: SnapshotExtractionConfig,
  onChunk: (
    chunk: SearchableSnapshotRow[],
    startIndex: number,
  ) => void | boolean,
  onComplete: () => void,
): SnapshotExtractionHandle {
  const { rows, descriptors } = config;
  const normalizer = config.normalizer ?? defaultNormalizer;
  const chunkSize = resolveChunkSize(config.chunkSize);
  const budgetMs = config.budgetMs ?? DEFAULT_BUDGET_MS;
  const scheduler = config.scheduler ?? new CooperativeScheduler();
  const priority = config.schedulePriority;
  const now = config.now ?? defaultNow;

  let cursor = 0;
  let cancelled = false;
  let pendingHandle: CooperativeHandle | null = null;

  function processNextChunk(): void {
    if (cancelled) return;

    const deadline = now() + budgetMs;
    const startIndex = cursor;
    const chunk: SearchableSnapshotRow[] = [];

    while (cursor < rows.length && chunk.length < chunkSize) {
      if (chunk.length > 0 && now() >= deadline) {
        break;
      }
      chunk.push(extractRow(rows[cursor]!, cursor, descriptors, normalizer));
      cursor++;
    }

    if (chunk.length === 0) {
      pendingHandle = null;
      return;
    }

    // `false` aborts immediately (e.g. transport failure inside the callback).
    const continueExtraction = onChunk(chunk, startIndex);
    if (continueExtraction === false) {
      cancelled = true;
      pendingHandle = null;
      return;
    }

    if (cursor >= rows.length) {
      pendingHandle = null;
      onComplete();
      return;
    }

    pendingHandle = scheduler.schedule(processNextChunk, priority);
  }

  if (rows.length === 0) {
    onComplete();
    return { cancel() {} };
  }

  // Schedule the first chunk through the cooperative scheduler so cold
  // extraction never blocks the current frame synchronously.
  pendingHandle = scheduler.schedule(processNextChunk, priority);

  return {
    cancel() {
      cancelled = true;
      pendingHandle?.cancel();
      pendingHandle = null;
    },
  };
}
