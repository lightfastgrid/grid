/**
 * Pure immutable-rows diff.
 *
 * Compares a previous row array against a replacement array using
 * stable row ids and object identity, producing the same normalized
 * result shape as a transaction. `nextRows` order is authoritative and
 * is returned as `rows` unchanged so no UI data is ever lost.
 *
 * O(n + m): one pass over previous rows to index by id, one pass over
 * next rows to classify. No input mutation.
 */

import type { RowData } from "../../types";

import type {
  ResolveTransactionRowId,
  RowDataTransactionResult,
  RowDataTransactionSkipped,
} from "./types";

/**
 * Diff `previousRows` → `nextRows` by stable id:
 *
 * - new id → `added`
 * - existing id, different object reference → `updated`
 * - existing id, same object reference → unchanged (not reported)
 * - previous id absent from `nextRows` → `removed`
 * - next rows without a resolvable id → skipped (`missingRowId`) but
 *   kept in `rows`
 * - duplicate ids within `nextRows` → first wins, later occurrences
 *   skipped (`duplicateId`) but kept in `rows`
 *
 * Previous rows without a resolvable id cannot be tracked and are
 * neither matched nor reported as removed.
 */
export function diffImmutableRows(
  previousRows: RowData[],
  nextRows: RowData[],
  resolveRowId: ResolveTransactionRowId,
): RowDataTransactionResult {
  // ── Index previous rows by id (O(n)) ───────────────────────────────
  const previousById = new Map<string, RowData>();
  for (let i = 0; i < previousRows.length; i++) {
    const id = resolveRowId(previousRows[i]!);
    if (id !== null) previousById.set(id, previousRows[i]!);
  }

  const added: RowData[] = [];
  const updated: RowData[] = [];
  const skipped: RowDataTransactionSkipped[] = [];
  const seenNextIds = new Set<string>();

  // ── Classify next rows (O(m)) ──────────────────────────────────────
  for (let i = 0; i < nextRows.length; i++) {
    const row = nextRows[i]!;
    const id = resolveRowId(row);
    if (id === null) {
      skipped.push({ row, reason: "missingRowId" });
      continue;
    }
    if (seenNextIds.has(id)) {
      skipped.push({ id, row, reason: "duplicateId" });
      continue;
    }
    seenNextIds.add(id);

    const previous = previousById.get(id);
    if (previous === undefined) {
      added.push(row);
    } else if (previous !== row) {
      updated.push(row);
    }
    // same reference → unchanged
  }

  // ── Removed: previous ids absent from nextRows (O(n)) ─────────────
  const removed: RowData[] = [];
  for (const [id, row] of previousById) {
    if (!seenNextIds.has(id)) removed.push(row);
  }

  return {
    // nextRows order is authoritative; return it as-is so rows the
    // diff could not classify (missing/duplicate ids) are not dropped.
    rows: nextRows,
    added,
    updated,
    removed,
    skipped,
    addCount: added.length,
    updateCount: updated.length,
    removeCount: removed.length,
    skippedCount: skipped.length,
  };
}
