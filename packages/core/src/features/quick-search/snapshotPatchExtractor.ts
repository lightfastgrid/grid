/**
 * Bounded cooperative extraction of searchable values for a dirty-row
 * subset.
 *
 * Used to build transactional patch payloads (`patchStart` → chunks →
 * `patchComplete`). This module never posts protocol messages — callers
 * retain the completed chunk list so `totalChunks` is known before
 * `patchStart`.
 *
 * All O(k) work (index consumption, dedupe/validation, row projection)
 * runs on CooperativeScheduler continuations. Creating an iterator is
 * allowed on the caller's task; consuming it is not.
 */

import type { SearchableSnapshotRow } from "../../execution/operations/quick-search/quickSearchProtocol";
import type {
  CooperativeHandle,
  CooperativeScheduleOptions,
} from "../../scheduling/CooperativeScheduler";
import { CooperativeScheduler } from "../../scheduling/CooperativeScheduler";
import type { RowData } from "../../types";

import type { QuickSearchNormalizer } from "./normalizer";
import { defaultNormalizer } from "./normalizer";
import { readRowFieldValue } from "./rowFieldValue";
import type { SearchableFieldDescriptor } from "./searchableFieldResolver";

// ── Internal defaults (not public API; tests inject smaller bounds) ─

/** Stricter than full-snapshot prewarm — edit path must stay responsive. */
const DEFAULT_PATCH_BUDGET_MS = 4;
const DEFAULT_MAX_ROWS_PER_CHUNK = 256;
const DEFAULT_MAX_BYTES_PER_CHUNK = 64 * 1024;
/** Aspirational only — never overrides an exhausted time budget. */
const DEFAULT_MIN_ROWS_PER_CHUNK = 8;
const DEFAULT_MAX_UNIQUE_ROWS = 2048;
const DEFAULT_MAX_TRANSACTION_BYTES = 512 * 1024;
/** Caps pathological duplicate-heavy iterables (reuses transaction-row-limit). */
const DEFAULT_MAX_INPUT_INDEXES = 8192;
/** Max source-index occurrences consumed per collection continuation. */
const DEFAULT_MAX_INDEXES_PER_CONTINUATION = 1024;

/**
 * Conservative structured-clone cost estimate per searchable row.
 * UTF-16 code units × 2 plus fixed object/array overhead — O(1) per
 * string, never TextEncoder.
 */
const ESTIMATE_ROW_OVERHEAD_BYTES = 48;
const ESTIMATE_VALUE_OVERHEAD_BYTES = 16;

export interface SnapshotPatchExtractionConfig {
  rows: readonly RowData[];
  descriptors: readonly SearchableFieldDescriptor[];
  normalizer?: QuickSearchNormalizer;
  /**
   * Dirty source indexes. Accepts arrays, Uint32Array, ReadonlySet, or
   * any Iterable — consumed cooperatively in first-seen unique order.
   */
  sourceIndexes: Iterable<number>;
  scheduler?: CooperativeScheduler;
  schedulePriority?: CooperativeScheduleOptions;
  /** Injectable monotonic clock for tests. */
  now?: () => number;
  budgetMs?: number;
  maxRowsPerChunk?: number;
  maxBytesPerChunk?: number;
  minRowsPerChunk?: number;
  maxUniqueRows?: number;
  maxTransactionBytes?: number;
  /** Max source-index occurrences consumed for the whole transaction. */
  maxInputIndexes?: number;
  /** Max occurrences consumed per collection continuation. */
  maxIndexesPerContinuation?: number;
}

export type SnapshotPatchRebuildReason =
  | "transaction-row-limit"
  | "transaction-byte-limit"
  | "invalid-source-index"
  | "oversized-row";

export type SnapshotPatchExtractionResult =
  | {
      kind: "patch";
      chunks: SearchableSnapshotRow[][];
      totalUniqueRows: number;
      totalChunks: number;
      totalEstimatedBytes: number;
    }
  | {
      kind: "rebuild-required";
      reason: SnapshotPatchRebuildReason;
    };

export interface SnapshotPatchExtractionHandle {
  cancel(): void;
}

interface CarriedProjection {
  row: SearchableSnapshotRow;
  bytes: number;
}

type Phase = "collect" | "project";

function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function resolvePositive(value: number | undefined, fallback: number): number {
  if (value === undefined || value <= 0) return fallback;
  return value;
}

/**
 * Conservative O(1)-per-string byte estimate for structured-clone cost.
 * Uses UTF-16 length (`string.length`) × 2 plus fixed row/value overhead.
 * Never allocates a TextEncoder.
 */
export function estimateSearchableRowBytes(row: SearchableSnapshotRow): number {
  let bytes = ESTIMATE_ROW_OVERHEAD_BYTES;
  for (let i = 0; i < row.values.length; i++) {
    bytes += ESTIMATE_VALUE_OVERHEAD_BYTES + row.values[i]!.length * 2;
  }
  return bytes;
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
 * Cooperatively extract searchable patch updates for dirty source indexes.
 *
 * State machine: collect (dedupe/validate indexes) → project (bounded chunks).
 * Schedules before any index consumption or row projection.
 */
export function extractSnapshotPatchSubset(
  config: SnapshotPatchExtractionConfig,
  onComplete: (result: SnapshotPatchExtractionResult) => void,
): SnapshotPatchExtractionHandle {
  const rows = config.rows;
  const rowCount = rows.length;
  const descriptors = config.descriptors;
  const normalizer = config.normalizer ?? defaultNormalizer;
  const budgetMs = resolvePositive(config.budgetMs, DEFAULT_PATCH_BUDGET_MS);
  const maxRowsPerChunk = resolvePositive(
    config.maxRowsPerChunk,
    DEFAULT_MAX_ROWS_PER_CHUNK,
  );
  const maxBytesPerChunk = resolvePositive(
    config.maxBytesPerChunk,
    DEFAULT_MAX_BYTES_PER_CHUNK,
  );
  const minRowsPerChunk = resolvePositive(
    config.minRowsPerChunk,
    DEFAULT_MIN_ROWS_PER_CHUNK,
  );
  // Aspirational floor only — time/byte/row ceilings are binding.
  void minRowsPerChunk;
  const maxUniqueRows = resolvePositive(
    config.maxUniqueRows,
    DEFAULT_MAX_UNIQUE_ROWS,
  );
  const maxTransactionBytes = resolvePositive(
    config.maxTransactionBytes,
    DEFAULT_MAX_TRANSACTION_BYTES,
  );
  const maxInputIndexes = resolvePositive(
    config.maxInputIndexes,
    DEFAULT_MAX_INPUT_INDEXES,
  );
  const maxIndexesPerContinuation = resolvePositive(
    config.maxIndexesPerContinuation,
    DEFAULT_MAX_INDEXES_PER_CONTINUATION,
  );
  const scheduler = config.scheduler ?? new CooperativeScheduler();
  const priority = config.schedulePriority;
  const now = config.now ?? defaultNow;

  // Creating the iterator is allowed; consuming it is not (until scheduled).
  const iterator = config.sourceIndexes[Symbol.iterator]();

  let cancelled = false;
  let completed = false;
  let pendingHandle: CooperativeHandle | null = null;
  let phase: Phase = "collect";

  const seen = new Set<number>();
  const uniqueIndexes: number[] = [];
  let inputConsumed = 0;
  let projectCursor = 0;
  let totalEstimatedBytes = 0;
  let carried: CarriedProjection | null = null;
  let chunks: SearchableSnapshotRow[][] = [];

  function discardWorkingState(): void {
    uniqueIndexes.length = 0;
    seen.clear();
    chunks = [];
    carried = null;
    totalEstimatedBytes = 0;
  }

  function complete(result: SnapshotPatchExtractionResult): void {
    if (completed || cancelled) return;
    completed = true;
    pendingHandle = null;
    if (result.kind === "rebuild-required") {
      discardWorkingState();
    }
    onComplete(result);
  }

  function finishRebuild(reason: SnapshotPatchRebuildReason): void {
    complete({ kind: "rebuild-required", reason });
  }

  function finishPatch(): void {
    const resultChunks = chunks;
    chunks = [];
    carried = null;
    complete({
      kind: "patch",
      chunks: resultChunks,
      totalUniqueRows: uniqueIndexes.length,
      totalChunks: resultChunks.length,
      totalEstimatedBytes,
    });
  }

  function scheduleNext(): void {
    if (cancelled || completed) return;
    pendingHandle = scheduler.schedule(tick, priority);
  }

  function collectPhase(deadline: number): void {
    let consumedThisTick = 0;

    for (;;) {
      if (
        (consumedThisTick > 0 && now() >= deadline) ||
        consumedThisTick >= maxIndexesPerContinuation
      ) {
        scheduleNext();
        return;
      }

      const next = iterator.next();
      if (next.done) {
        phase = "project";
        // Continue into projection in the same tick while budget remains.
        projectPhase(deadline);
        return;
      }

      const index = next.value;
      inputConsumed += 1;
      consumedThisTick += 1;

      if (inputConsumed > maxInputIndexes) {
        finishRebuild("transaction-row-limit");
        return;
      }

      if (!Number.isInteger(index) || index < 0 || index >= rowCount) {
        finishRebuild("invalid-source-index");
        return;
      }

      if (!seen.has(index)) {
        if (uniqueIndexes.length >= maxUniqueRows) {
          finishRebuild("transaction-row-limit");
          return;
        }
        seen.add(index);
        uniqueIndexes.push(index);
      }
    }
  }

  function projectPhase(deadline: number): void {
    const chunk: SearchableSnapshotRow[] = [];
    let chunkBytes = 0;
    let projectedThisTick = 0;

    for (;;) {
      // Time budget is binding once at least one row was handled this tick.
      // minRowsPerChunk is aspirational only.
      if (projectedThisTick > 0 && now() >= deadline) {
        break;
      }

      if (chunk.length >= maxRowsPerChunk) {
        break;
      }

      if (carried === null) {
        if (projectCursor >= uniqueIndexes.length) {
          break;
        }
        const sourceIndex = uniqueIndexes[projectCursor]!;
        const row = extractRow(
          rows[sourceIndex]!,
          sourceIndex,
          descriptors,
          normalizer,
        );
        const bytes = estimateSearchableRowBytes(row);
        projectCursor += 1;
        projectedThisTick += 1;

        if (bytes > maxBytesPerChunk) {
          finishRebuild("oversized-row");
          return;
        }
        if (totalEstimatedBytes + bytes > maxTransactionBytes) {
          finishRebuild("transaction-byte-limit");
          return;
        }

        // Count transaction bytes exactly once at projection time.
        totalEstimatedBytes += bytes;
        carried = { row, bytes };
      }

      if (chunk.length > 0 && chunkBytes + carried.bytes > maxBytesPerChunk) {
        // Keep carried for the next chunk — do not reproject.
        break;
      }

      chunk.push(carried.row);
      chunkBytes += carried.bytes;
      carried = null;
    }

    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (projectCursor >= uniqueIndexes.length && carried === null) {
      finishPatch();
      return;
    }

    scheduleNext();
  }

  function tick(): void {
    pendingHandle = null;
    if (cancelled || completed) return;

    const deadline = now() + budgetMs;
    if (phase === "collect") {
      collectPhase(deadline);
    } else {
      projectPhase(deadline);
    }
  }

  // Never consume indexes or project on the calling (edit/input) task.
  pendingHandle = scheduler.schedule(tick, priority);

  return {
    cancel() {
      if (cancelled || completed) return;
      cancelled = true;
      pendingHandle?.cancel();
      pendingHandle = null;
      discardWorkingState();
    },
  };
}
