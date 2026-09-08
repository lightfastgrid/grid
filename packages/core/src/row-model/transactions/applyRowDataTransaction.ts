/**
 * Pure row-data transaction application.
 *
 * Applies an add / update / remove transaction to a row array in
 * O(n + k): one pass to index current rows by stable id, one pass per
 * transaction list (k = changed rows), one pass to assemble the
 * result. No nested scans, no input mutation, no per-row allocation
 * beyond the output arrays.
 */

import type { RowData } from "../../types";

import type {
  ResolveTransactionRowId,
  RowDataTransaction,
  RowDataTransactionResult,
  RowDataTransactionSkipped,
} from "./types";

/** Build a zero-change result for `rows` (used for no-op fast paths). */
export function createEmptyTransactionResult(
  rows: RowData[],
): RowDataTransactionResult {
  return emptyResult(rows);
}

function emptyResult(rows: RowData[]): RowDataTransactionResult {
  return {
    rows,
    added: [],
    updated: [],
    removed: [],
    skipped: [],
    addCount: 0,
    updateCount: 0,
    removeCount: 0,
    skippedCount: 0,
  };
}

function isEmptyTransaction(transaction: RowDataTransaction): boolean {
  return (
    (transaction.add?.length ?? 0) === 0 &&
    (transaction.update?.length ?? 0) === 0 &&
    (transaction.remove?.length ?? 0) === 0 &&
    (transaction.removeIds?.length ?? 0) === 0
  );
}

function countAddPositionOptions(txn: RowDataTransaction): number {
  let count = 0;
  if (txn.addIndex !== undefined) count++;
  if (txn.addBeforeId !== undefined) count++;
  if (txn.addAfterId !== undefined) count++;
  return count;
}

/**
 * Apply `transaction` to `currentRows` and return the new row array
 * plus a normalized result.
 *
 * - Updates and removals match by stable row id via `resolveRowId`.
 * - Entries without a resolvable id are skipped (`missingRowId`).
 * - Ids not present in `currentRows` are skipped (`notFound`).
 * - Add rows whose id already exists (in current rows or earlier adds)
 *   are skipped (`duplicateId`) — unless that id is also removed in the
 *   same transaction (remove + add same id acts as replace-at-position).
 * - Current row order is preserved; updates replace in place, removals
 *   drop rows, adds insert at the clamped `addIndex`, before
 *   `addBeforeId`, after `addAfterId`, or append.
 * - `addIndex`, `addBeforeId`, and `addAfterId` are mutually exclusive;
 *   supplying more than one skips all add rows as `invalidAddPosition`.
 * - Anchor ids (`addBeforeId`/`addAfterId`) are resolved against the
 *   post-removal row array; a missing anchor skips adds as
 *   `anchorNotFound`.
 * - Never mutates `currentRows`, the transaction arrays, or row objects.
 */
export function applyRowDataTransaction(
  currentRows: RowData[],
  transaction: RowDataTransaction,
  resolveRowId: ResolveTransactionRowId,
): RowDataTransactionResult {
  if (isEmptyTransaction(transaction)) {
    return emptyResult(currentRows);
  }

  // ── Index current rows by stable id (O(n)) ─────────────────────────
  const idToIndex = new Map<string, number>();
  for (let i = 0; i < currentRows.length; i++) {
    const id = resolveRowId(currentRows[i]!);
    if (id !== null) idToIndex.set(id, i);
  }

  const skipped: RowDataTransactionSkipped[] = [];
  const updated: RowData[] = [];
  const removed: RowData[] = [];

  // ── Updates by id ──────────────────────────────────────────────────
  const updatedByIndex = new Map<number, RowData>();
  for (const row of transaction.update ?? []) {
    if (row === null || row === undefined) {
      skipped.push({ reason: "invalidRow" });
      continue;
    }
    const id = resolveRowId(row);
    if (id === null) {
      skipped.push({ row, reason: "missingRowId" });
      continue;
    }
    const index = idToIndex.get(id);
    if (index === undefined) {
      skipped.push({ id, row, reason: "notFound" });
      continue;
    }
    updatedByIndex.set(index, row);
    updated.push(row);
  }

  // ── Removals by row object and by id ───────────────────────────────
  const removedIndexes = new Set<number>();
  const removedIds = new Set<string>();
  const markRemoved = (
    id: string,
    row: RowData | undefined,
  ): void => {
    const index = idToIndex.get(id);
    if (index === undefined) {
      skipped.push({ id, row, reason: "notFound" });
      return;
    }
    if (removedIndexes.has(index)) return; // already removed in this txn
    removedIndexes.add(index);
    removedIds.add(id);
    removed.push(currentRows[index]!);
  };

  for (const row of transaction.remove ?? []) {
    if (row === null || row === undefined) {
      skipped.push({ reason: "invalidRow" });
      continue;
    }
    const id = resolveRowId(row);
    if (id === null) {
      skipped.push({ row, reason: "missingRowId" });
      continue;
    }
    markRemoved(id, row);
  }

  for (const id of transaction.removeIds ?? []) {
    if (typeof id !== "string" || id === "") {
      skipped.push({ reason: "missingRowId" });
      continue;
    }
    markRemoved(id, undefined);
  }

  // ── Validate add positioning ──────────────────────────────────────
  const positionCount = countAddPositionOptions(transaction);
  const hasAdds = (transaction.add?.length ?? 0) > 0;

  if (positionCount > 1 && hasAdds) {
    for (const row of transaction.add!) {
      if (row === null || row === undefined) {
        skipped.push({ reason: "invalidRow" });
      } else {
        const id = resolveRowId(row);
        skipped.push({ id: id ?? undefined, row, reason: "invalidAddPosition" });
      }
    }
    if (updated.length === 0 && removed.length === 0) {
      const result = emptyResult(currentRows);
      return { ...result, skipped, skippedCount: skipped.length };
    }
    return assembleResult(
      currentRows, [], updatedByIndex, removedIndexes,
      currentRows.length - removedIndexes.size, // append position (won't matter — no adds)
      updated, removed, skipped,
    );
  }

  // ── Adds with duplicate-id detection ───────────────────────────────
  // An add row whose id exists in current rows is normally skipped as
  // duplicateId. Exception: if that id is also removed in this same
  // transaction, the add is allowed (remove + add = replace at position).
  const added: RowData[] = [];
  const addedIds = new Set<string>();
  for (const row of transaction.add ?? []) {
    if (row === null || row === undefined) {
      skipped.push({ reason: "invalidRow" });
      continue;
    }
    const id = resolveRowId(row);
    if (id !== null) {
      const existsInCurrent = idToIndex.has(id) && !removedIds.has(id);
      if (existsInCurrent || addedIds.has(id)) {
        skipped.push({ id, row, reason: "duplicateId" });
        continue;
      }
      addedIds.add(id);
    }
    added.push(row);
  }

  // Nothing applied — keep the current array reference.
  if (added.length === 0 && updated.length === 0 && removed.length === 0) {
    const result = emptyResult(currentRows);
    return { ...result, skipped, skippedCount: skipped.length };
  }

  // ── Resolve insertion position ─────────────────────────────────────
  const keptCount = currentRows.length - removedIndexes.size;

  let insertAt: number;
  if (added.length === 0) {
    insertAt = keptCount; // no adds, position is irrelevant
  } else if (transaction.addBeforeId !== undefined || transaction.addAfterId !== undefined) {
    const anchorId = (transaction.addBeforeId ?? transaction.addAfterId)!;
    const isBefore = transaction.addBeforeId !== undefined;
    const anchorResult = resolveAnchorPosition(
      currentRows, anchorId, isBefore, removedIndexes, idToIndex,
    );
    if (anchorResult === null) {
      // Anchor not found — skip all adds.
      for (const row of added) {
        const id = resolveRowId(row);
        skipped.push({ id: id ?? undefined, row, reason: "anchorNotFound" });
      }
      if (updated.length === 0 && removed.length === 0) {
        const result = emptyResult(currentRows);
        return { ...result, skipped, skippedCount: skipped.length };
      }
      return assembleResult(
        currentRows, [], updatedByIndex, removedIndexes,
        keptCount, updated, removed, skipped,
      );
    }
    insertAt = anchorResult;
  } else if (transaction.addIndex !== undefined) {
    insertAt = Math.min(Math.max(0, Math.floor(transaction.addIndex)), keptCount);
  } else {
    insertAt = keptCount; // append
  }

  return assembleResult(
    currentRows, added, updatedByIndex, removedIndexes,
    insertAt, updated, removed, skipped,
  );
}

/**
 * Resolve anchor position in the post-removal kept-row stream.
 * Returns the kept-row index where adds should be inserted, or `null`
 * if the anchor id is not found in the post-removal rows.
 */
function resolveAnchorPosition(
  currentRows: RowData[],
  anchorId: string,
  isBefore: boolean,
  removedIndexes: Set<number>,
  idToIndex: Map<string, number>,
): number | null {
  const sourceIndex = idToIndex.get(anchorId);
  if (sourceIndex === undefined || removedIndexes.has(sourceIndex)) {
    return null;
  }
  // Walk the current rows to find the kept-row index of the anchor.
  let keptIndex = 0;
  for (let i = 0; i < currentRows.length; i++) {
    if (removedIndexes.has(i)) continue;
    if (i === sourceIndex) {
      return isBefore ? keptIndex : keptIndex + 1;
    }
    keptIndex++;
  }
  return null;
}

function assembleResult(
  currentRows: RowData[],
  added: RowData[],
  updatedByIndex: Map<number, RowData>,
  removedIndexes: Set<number>,
  insertAt: number,
  updated: RowData[],
  removed: RowData[],
  skipped: RowDataTransactionSkipped[],
): RowDataTransactionResult {
  const keptCount = currentRows.length - removedIndexes.size;
  const rows = new Array<RowData>(keptCount + added.length);
  let write = 0;
  let kept = 0;
  for (let i = 0; i < currentRows.length; i++) {
    if (removedIndexes.has(i)) continue;
    if (kept === insertAt) {
      for (let a = 0; a < added.length; a++) rows[write++] = added[a]!;
    }
    rows[write++] = updatedByIndex.get(i) ?? currentRows[i]!;
    kept++;
  }
  if (kept === insertAt) {
    for (let a = 0; a < added.length; a++) rows[write++] = added[a]!;
  }

  return {
    rows,
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
