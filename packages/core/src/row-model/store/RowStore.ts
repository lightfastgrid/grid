/**
 * Persistent row store with copy-on-write ownership and incremental id index.
 *
 * Owns `sourceRows`, `rowIdToSourceIndex`, and copy-on-write state.
 * Transactions use the persistent index for O(1) id lookups instead of
 * rebuilding a Map from scratch on every call.
 *
 * Copy-on-write protocol:
 *   - `replaceAll` stores the caller's array as BORROWED (never mutated).
 *   - The first in-place mutation (update-only txn) clones the array, then
 *     the store is OWNED and subsequent updates mutate in place.
 *   - Structural transactions (add/remove) produce a new array via
 *     `applyRowDataTransaction` and the store becomes OWNED.
 *   - `replaceAll` resets to BORROWED.
 */

import type { RowData } from "../../types";
import {
  applyRowDataTransaction,
  createEmptyTransactionResult,
} from "../transactions/applyRowDataTransaction";
import type {
  ResolveTransactionRowId,
  RowDataTransaction,
  RowDataTransactionResult,
} from "../transactions/types";

import type {
  RowStoreBatchOutcome,
  RowStoreCommitOutcome,
  RowStoreDirtyMetadata,
} from "./RowStore.types";

const EMPTY_ROWS: RowData[] = [];

const EMPTY_SOURCE_INDEXES: ReadonlySet<number> = new Set<number>();
const EMPTY_FIELDS_BY_SOURCE_INDEX: ReadonlyMap<number, ReadonlySet<string>> =
  new Map<number, ReadonlySet<string>>();

const EMPTY_DIRTY: RowStoreDirtyMetadata = {
  updatedRowIds: new Set<string>(),
  dirtyFieldsByRowId: new Map<string, ReadonlySet<string>>(),
  structural: false,
  updatedSourceIndexes: EMPTY_SOURCE_INDEXES,
  dirtyFieldsBySourceIndex: EMPTY_FIELDS_BY_SOURCE_INDEX,
};

function unionFieldSets(
  existing: ReadonlySet<string> | undefined,
  next: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!existing || existing.size === 0) return next;
  if (next.size === 0) return existing;
  const merged = new Set(existing);
  for (const f of next) merged.add(f);
  return merged;
}

/**
 * Compute the set of top-level keys that differ between two row objects.
 * Compares by strict equality on shared keys and detects added/removed keys.
 */
function diffRowFields(
  oldRow: RowData,
  newRow: RowData,
): ReadonlySet<string> {
  const dirty = new Set<string>();
  const oldKeys = Object.keys(oldRow);
  const newKeys = Object.keys(newRow);

  for (const key of oldKeys) {
    if ((oldRow as Record<string, unknown>)[key] !== (newRow as Record<string, unknown>)[key]) {
      dirty.add(key);
    } else if (!(key in newRow)) {
      dirty.add(key);
    }
  }
  for (const key of newKeys) {
    if (!(key in oldRow)) {
      dirty.add(key);
    }
  }
  return dirty;
}

export class RowStore {
  private _sourceRows: RowData[] = EMPTY_ROWS;
  private _rowIdToSourceIndex = new Map<string, number>();
  private _owned = false;
  private _sourceRowsShared = false;
  private _sourceLayoutRevision = 0;

  get sourceRows(): RowData[] {
    return this._sourceRows;
  }

  get rowCount(): number {
    return this._sourceRows.length;
  }

  get rowIdToSourceIndex(): ReadonlyMap<string, number> {
    return this._rowIdToSourceIndex;
  }

  get sourceLayoutRevision(): number {
    return this._sourceLayoutRevision;
  }

  /** O(1) retained source reference; later in-place updates detach first. */
  captureSourceRows(): RowData[] {
    this._sourceRowsShared = true;
    return this._sourceRows;
  }

  // ── Full replacement ──────────────────────────────────────────────

  /**
   * Replace all rows. The caller's array is stored by reference (borrowed)
   * and never mutated. The id index is rebuilt from scratch.
   */
  replaceAll(
    rows: RowData[],
    resolveId: ResolveTransactionRowId,
  ): void {
    this._sourceRows = rows;
    this._owned = false;
    this._sourceRowsShared = false;
    this._sourceLayoutRevision++;
    this.rebuildIndex(resolveId);
  }

  // ── Single source-row replacement by index ────────────────────────

  replaceRowAtSourceIndex(
    sourceIndex: number,
    newRow: RowData,
    resolveId: ResolveTransactionRowId,
  ): RowStoreCommitOutcome {
    if (sourceIndex < 0 || sourceIndex >= this._sourceRows.length) {
      return this.noopOutcome();
    }

    const oldRow = this._sourceRows[sourceIndex]!;
    if (oldRow === newRow) {
      return this.noopOutcome();
    }

    this.detachSourceRowsForMutation();

    this._sourceRows[sourceIndex] = newRow;

    const oldId = resolveId(oldRow);
    const newId = resolveId(newRow);
    if (oldId !== newId) {
      if (oldId !== null) this._rowIdToSourceIndex.delete(oldId);
      if (newId !== null) this._rowIdToSourceIndex.set(newId, sourceIndex);
    } else if (newId !== null) {
      this._rowIdToSourceIndex.set(newId, sourceIndex);
    }

    const rowId = newId ?? oldId ?? `__idx_${sourceIndex}`;
    const fields = diffRowFields(oldRow, newRow);
    const updatedRowIds = new Set([rowId]);
    const dirtyFieldsByRowId = new Map<string, ReadonlySet<string>>();
    if (fields.size > 0) {
      dirtyFieldsByRowId.set(rowId, fields);
    }
    const dirtyFieldsBySourceIndex = new Map<number, ReadonlySet<string>>([
      [sourceIndex, fields],
    ]);

    return {
      result: {
        rows: this._sourceRows,
        added: [],
        updated: [newRow],
        removed: [],
        skipped: [],
        addCount: 0,
        updateCount: 1,
        removeCount: 0,
        skippedCount: 0,
      },
      dirty: {
        updatedRowIds,
        dirtyFieldsByRowId,
        structural: false,
        updatedSourceIndexes: new Set([sourceIndex]),
        dirtyFieldsBySourceIndex,
      },
      changed: true,
      structural: false,
    };
  }

  // ── Single transaction ────────────────────────────────────────────

  applyTransaction(
    txn: RowDataTransaction,
    resolveId: ResolveTransactionRowId,
  ): RowStoreCommitOutcome {
    const isUpdateOnly =
      (txn.add === undefined || txn.add.length === 0) &&
      (txn.remove === undefined || txn.remove.length === 0) &&
      (txn.removeIds === undefined || txn.removeIds.length === 0);

    if (isUpdateOnly) {
      return this.applyUpdateOnly(txn, resolveId);
    }

    return this.applyStructural(txn, resolveId);
  }

  // ── Batch (async flush path) ──────────────────────────────────────

  /**
   * Apply multiple transactions sequentially. No coalescing in Phase 1 —
   * each transaction is applied in order, and dirty metadata is merged.
   */
  applyTransactionBatch(
    txns: RowDataTransaction[],
    resolveId: ResolveTransactionRowId,
  ): RowStoreBatchOutcome {
    if (txns.length === 1) {
      const outcome = this.applyTransaction(txns[0]!, resolveId);
      return {
        results: [outcome.result],
        dirty: outcome.dirty,
        changed: outcome.changed,
        structural: outcome.structural,
      };
    }

    const results: RowDataTransactionResult[] = [];
    let anyChanged = false;
    let anyStructural = false;
    const mergedUpdatedIds = new Set<string>();
    const mergedDirtyFields = new Map<string, ReadonlySet<string>>();
    const mergedSourceIndexes = new Set<number>();
    const mergedFieldsBySourceIndex = new Map<number, ReadonlySet<string>>();

    for (const txn of txns) {
      const outcome = this.applyTransaction(txn, resolveId);
      // Snapshot rows so later transactions don't mutate earlier results.
      const snapshotResult = outcome.result.rows === this._sourceRows
        ? { ...outcome.result, rows: this._sourceRows.slice() }
        : outcome.result;
      results.push(snapshotResult);
      if (outcome.changed) anyChanged = true;
      if (outcome.structural) anyStructural = true;
      for (const id of outcome.dirty.updatedRowIds) {
        mergedUpdatedIds.add(id);
      }
      for (const [id, fields] of outcome.dirty.dirtyFieldsByRowId) {
        mergedDirtyFields.set(id, unionFieldSets(mergedDirtyFields.get(id), fields));
      }
      for (const idx of outcome.dirty.updatedSourceIndexes) {
        mergedSourceIndexes.add(idx);
      }
      for (const [idx, fields] of outcome.dirty.dirtyFieldsBySourceIndex) {
        mergedFieldsBySourceIndex.set(
          idx,
          unionFieldSets(mergedFieldsBySourceIndex.get(idx), fields),
        );
      }
    }

    return {
      results,
      dirty: {
        updatedRowIds: mergedUpdatedIds,
        dirtyFieldsByRowId: mergedDirtyFields,
        structural: anyStructural,
        updatedSourceIndexes: anyStructural ? EMPTY_SOURCE_INDEXES : mergedSourceIndexes,
        dirtyFieldsBySourceIndex: anyStructural
          ? EMPTY_FIELDS_BY_SOURCE_INDEX
          : mergedFieldsBySourceIndex,
      },
      changed: anyChanged,
      structural: anyStructural,
    };
  }

  // ── Private: update-only path ─────────────────────────────────────

  private applyUpdateOnly(
    txn: RowDataTransaction,
    resolveId: ResolveTransactionRowId,
  ): RowStoreCommitOutcome {
    const updates = txn.update;
    if (!updates || updates.length === 0) {
      return this.noopOutcome();
    }

    const updatedRowIds = new Set<string>();
    const updatedSourceIndexes = new Set<number>();
    const dirtyFieldsByRowId = new Map<string, ReadonlySet<string>>();
    const dirtyFieldsBySourceIndex = new Map<number, ReadonlySet<string>>();
    const updated: RowData[] = [];
    const skipped: RowDataTransactionResult["skipped"] = [];

    // Use persistent index for O(1) lookups.
    for (const row of updates) {
      if (row === null || row === undefined) {
        skipped.push({ reason: "invalidRow" });
        continue;
      }
      const id = resolveId(row);
      if (id === null) {
        skipped.push({ row, reason: "missingRowId" });
        continue;
      }
      const index = this._rowIdToSourceIndex.get(id);
      if (index === undefined) {
        skipped.push({ id, row, reason: "notFound" });
        continue;
      }

      // Copy-on-write: clone before first in-place mutation.
      this.detachSourceRowsForMutation();

      const oldRow = this._sourceRows[index]!;
      const fields = diffRowFields(oldRow, row);
      this._sourceRows[index] = row;
      updated.push(row);
      updatedRowIds.add(id);
      updatedSourceIndexes.add(index);
      dirtyFieldsBySourceIndex.set(
        index,
        unionFieldSets(dirtyFieldsBySourceIndex.get(index), fields),
      );
      if (fields.size > 0) {
        dirtyFieldsByRowId.set(
          id,
          unionFieldSets(dirtyFieldsByRowId.get(id), fields),
        );
      }
    }

    if (updated.length === 0) {
      // All entries were skipped.
      return {
        result: {
          rows: this._sourceRows,
          added: [],
          updated: [],
          removed: [],
          skipped,
          addCount: 0,
          updateCount: 0,
          removeCount: 0,
          skippedCount: skipped.length,
        },
        dirty: EMPTY_DIRTY,
        changed: false,
        structural: false,
      };
    }

    return {
      result: {
        rows: this._sourceRows,
        added: [],
        updated,
        removed: [],
        skipped,
        addCount: 0,
        updateCount: updated.length,
        removeCount: 0,
        skippedCount: skipped.length,
      },
      dirty: {
        updatedRowIds,
        dirtyFieldsByRowId,
        structural: false,
        updatedSourceIndexes,
        dirtyFieldsBySourceIndex,
      },
      changed: true,
      structural: false,
    };
  }

  // ── Private: structural path (add/remove) ─────────────────────────

  private applyStructural(
    txn: RowDataTransaction,
    resolveId: ResolveTransactionRowId,
  ): RowStoreCommitOutcome {
    // Snapshot pre-transaction state for dirty field diffing.
    const preRows = this._sourceRows;
    const preIndex = new Map(this._rowIdToSourceIndex);

    const result = applyRowDataTransaction(
      this._sourceRows,
      txn,
      resolveId,
    );

    const noChange =
      result.addCount === 0 &&
      result.updateCount === 0 &&
      result.removeCount === 0;

    if (noChange) {
      // Nothing applied (all skipped or empty after validation).
      return {
        result: {
          ...result,
          rows: this._sourceRows,
        },
        dirty: EMPTY_DIRTY,
        changed: false,
        structural: false,
      };
    }

    const actualStructural = result.addCount > 0 || result.removeCount > 0;

    // Build dirty metadata for any updates within the transaction.
    // Diff against the pre-transaction rows using the old index snapshot.
    const updatedRowIds = new Set<string>();
    const dirtyFieldsByRowId = new Map<string, ReadonlySet<string>>();
    const mutableSourceIndexes = new Set<number>();
    const dirtyFieldsBySourceIndex = new Map<number, ReadonlySet<string>>();

    for (const row of result.updated) {
      const id = resolveId(row);
      if (id !== null) {
        updatedRowIds.add(id);
        const oldIndex = preIndex.get(id);
        if (oldIndex !== undefined && preRows[oldIndex]) {
          const fields = diffRowFields(preRows[oldIndex]!, row);
          if (fields.size > 0) {
            dirtyFieldsByRowId.set(
              id,
              unionFieldSets(dirtyFieldsByRowId.get(id), fields),
            );
          }
          if (!actualStructural) {
            // Partially-skipped add/remove request that only applied updates:
            // source indexes remain valid — populate per-index field metadata.
            mutableSourceIndexes.add(oldIndex);
            dirtyFieldsBySourceIndex.set(
              oldIndex,
              unionFieldSets(dirtyFieldsBySourceIndex.get(oldIndex), fields),
            );
          }
        }
      }
    }

    // Adopt the new array as owned.
    this._sourceRows = result.rows;
    this._owned = true;
    this._sourceRowsShared = false;

    if (actualStructural) {
      this._sourceLayoutRevision++;
      this.rebuildIndex(resolveId);
    }

    return {
      result,
      dirty: {
        updatedRowIds,
        dirtyFieldsByRowId,
        structural: actualStructural,
        updatedSourceIndexes: actualStructural ? EMPTY_SOURCE_INDEXES : mutableSourceIndexes,
        dirtyFieldsBySourceIndex: actualStructural
          ? EMPTY_FIELDS_BY_SOURCE_INDEX
          : dirtyFieldsBySourceIndex,
      },
      changed: true,
      structural: actualStructural,
    };
  }

  // ── Private: helpers ──────────────────────────────────────────────

  private rebuildIndex(resolveId: ResolveTransactionRowId): void {
    const index = this._rowIdToSourceIndex;
    index.clear();
    const rows = this._sourceRows;
    for (let i = 0; i < rows.length; i++) {
      const id = resolveId(rows[i]!);
      if (id !== null) index.set(id, i);
    }
  }

  private detachSourceRowsForMutation(): void {
    if (this._owned && !this._sourceRowsShared) return;
    this._sourceRows = this._sourceRows.slice();
    this._owned = true;
    this._sourceRowsShared = false;
  }

  private noopOutcome(): RowStoreCommitOutcome {
    return {
      result: createEmptyTransactionResult(this._sourceRows),
      dirty: EMPTY_DIRTY,
      changed: false,
      structural: false,
    };
  }
}
