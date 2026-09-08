/**
 * Serializable worker-sort payload builder (columnar layout).
 *
 * Builds a minimal, structured-clone-safe columnar payload from source
 * rows and a resolved {@link WorkerSortEligibility}. Values are stored
 * in columnar arrays (`valuesByEntry[entryIndex][sourceIndex]`) rather
 * than per-row projected objects — this reduces object allocation and
 * makes structured clone cheaper for large datasets.
 *
 * {@link SortWorkerClient} (driven by `WorkerTaskExecutor`) posts the
 * payload to the sort worker via `postMessage` without JSON
 * round-tripping.
 */

import type { RowData } from "../../../types";

import type { WorkerSortEligibility, WorkerSortEntry } from "./sortWorkerEligibility";

// ── Public types ──────────────────────────────────────────────────────

/** Primitive value types that survive structured clone without transforms. */
export type WorkerSortRowValue = string | number | boolean | null | undefined;

/** The complete payload a sort Worker will receive via `postMessage`. */
export interface WorkerSortPayload {
  /**
   * Columnar value arrays: `valuesByEntry[entryIndex][sourceIndex]`.
   *
   * Each inner array has `rowCount` elements in source order, containing
   * only the resolved field value for that sort entry.
   */
  valuesByEntry: WorkerSortRowValue[][];
  /** Sort entries (field, direction, pre-split dot-path). */
  entries: WorkerSortEntry[];
  /** Total number of rows (convenience; always `valuesByEntry[0].length`). */
  rowCount: number;
}

// ── Runtime value validation ──────────────────────────────────────────

/**
 * Check whether a value is a primitive safe for worker sort.
 *
 * Rejects object, function, symbol, and bigint — these cannot be
 * meaningfully compared in the worker without custom logic that isn't
 * available across the structured-clone boundary.
 */
export function isWorkerSortRowValue(value: unknown): value is WorkerSortRowValue {
  if (value === null || value === undefined) return true;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

// ── Implementation ────────────────────────────────────────────────────

/**
 * Resolve a dot-path value from a row.
 *
 * Duplicates the traversal logic from `utils/resolveDotPath` to keep
 * this module self-contained at runtime.
 */
function resolveDotPathValue(
  row: RowData,
  parts: readonly string[],
): unknown {
  let current: unknown = row;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Build a serializable columnar sort payload from source rows and a
 * resolved eligibility result.
 *
 * Returns `null` when:
 * - The eligibility check failed (`eligible: false`).
 * - Any extracted value is not a worker-safe primitive (object,
 *   function, symbol, bigint). This signals the caller to fall back
 *   to main-thread sorting.
 *
 * Performance:
 * - One value array preallocated per entry.
 * - Single pass over source rows.
 * - Per row, only the fields referenced by sort entries are read.
 * - No per-row object allocation.
 * - No JSON round-trip; no deep clone; no mutation of input rows.
 */
export function buildWorkerSortPayload(
  rows: RowData[],
  eligibility: WorkerSortEligibility,
): WorkerSortPayload | null {
  if (!eligibility.eligible) return null;

  const { entries } = eligibility;
  const entryCount = entries.length;
  const rowCount = rows.length;

  // Preallocate one value array per entry.
  const valuesByEntry: WorkerSortRowValue[][] = entries.map(
    () => new Array<WorkerSortRowValue>(rowCount),
  );

  for (let r = 0; r < rowCount; r++) {
    const src = rows[r]!;

    for (let e = 0; e < entryCount; e++) {
      const entry = entries[e]!;
      const raw: unknown = entry.pathParts
        ? resolveDotPathValue(src, entry.pathParts)
        : src[entry.field];

      if (!isWorkerSortRowValue(raw)) {
        // Unsupported value type — caller must fall back to main thread.
        return null;
      }

      valuesByEntry[e]![r] = raw;
    }
  }

  return { valuesByEntry, entries, rowCount };
}
