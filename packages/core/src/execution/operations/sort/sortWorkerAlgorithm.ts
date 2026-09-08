/**
 * Pure worker-sort algorithm.
 *
 * Sorts source indexes from a columnar {@link WorkerSortPayload} and
 * returns a `Uint32Array` of reordered source indexes. This is the
 * pure function executed by the sort worker (`sortWorker.ts`).
 *
 * The function is intentionally decoupled from `RowData`, `ColumnDef`,
 * Grid, renderer, and feature code — it operates only on primitive
 * value columns and sort entries.
 *
 * Comparison semantics match {@link defaultCompare} from
 * `utils/defaultSortCompare`:
 * - number vs number: numeric subtraction; NaN after real numbers,
 *   NaN == NaN
 * - boolean vs boolean: false < true
 * - everything else: `String(a).localeCompare(String(b))`
 * - null/undefined always sort last (both asc and desc)
 * - stable tie-break by source index
 */

import { defaultCompare } from "../../../utils/defaultSortCompare";

import type { WorkerSortPayload, WorkerSortRowValue } from "./sortWorkerPayload";

// ── Public types ──────────────────────────────────────────────────────

/** Result of the pure worker-sort algorithm. */
export interface WorkerSortAlgorithmResult {
  /** Source indexes in sorted display order. */
  indexes: Uint32Array;
}

// ── Implementation ────────────────────────────────────────────────────

/**
 * Execute the worker sort algorithm on a columnar payload.
 *
 * Returns a `Uint32Array` of source indexes in sorted display order.
 * The caller is responsible for wrapping the result with
 * `createIndexedRowOrder` when integrating with the RowOrder system.
 *
 * Does not mutate `payload.valuesByEntry` or `payload.entries`.
 */
export function executeWorkerSortPayload(
  payload: WorkerSortPayload,
): WorkerSortAlgorithmResult {
  const { rowCount, entries, valuesByEntry } = payload;
  const entryCount = entries.length;

  const indexes = new Uint32Array(rowCount);
  for (let i = 0; i < rowCount; i++) indexes[i] = i;

  if (rowCount <= 1 || entryCount === 0) {
    return { indexes };
  }

  indexes.sort((a: number, b: number): number => {
    for (let e = 0; e < entryCount; e++) {
      const col: WorkerSortRowValue[] = valuesByEntry[e]!;
      const aVal: WorkerSortRowValue = col[a];
      const bVal: WorkerSortRowValue = col[b];

      // null/undefined always sort last (both asc and desc).
      const aNull = aVal === null || aVal === undefined;
      const bNull = bVal === null || bVal === undefined;
      if (aNull || bNull) {
        if (aNull && bNull) continue;
        return aNull ? 1 : -1;
      }

      const cmp = defaultCompare(aVal, bVal);
      if (cmp !== 0) return cmp * entries[e]!.dir;
    }
    return a - b; // stable tie-break by source index
  });

  return { indexes };
}
