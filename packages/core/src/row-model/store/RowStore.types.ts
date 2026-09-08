import type {
  RowDataTransactionResult,
} from "../transactions/types";

/**
 * Dirty metadata produced by a transaction or batch.
 *
 * Phase 2: consumed by RowValueCache and sort invalidation for selective
 * cache clearing. Phase 3 will use it for renderer dirty-skipping.
 *
 * Invariants:
 * - Structural transactions record updatedRowIds AND dirtyFieldsByRowId
 *   for updated rows (diffed against pre-transaction state).
 * - Duplicate updates to the same row within one txn union dirty fields.
 * - Batch merges union dirty fields per row across transactions.
 * - No-op updates (same field values) still count as updateCount
 *   (row object was replaced) but have empty dirty field set.
 * - Missing/notFound/duplicate-skipped entries never add dirty metadata.
 * - `dirtyFieldsBySourceIndex` is populated directly from source indexes
 *   during update-only commits (no row-ID lookup). Structural outcomes
 *   expose an empty map. An empty field set means no top-level values
 *   changed; a missing entry for a reported source index is unknown.
 */
export interface RowStoreDirtyMetadata {
  /** Row ids that were updated in place. */
  readonly updatedRowIds: ReadonlySet<string>;
  /** Changed fields per updated row (shallow key diff of old vs new row object). */
  readonly dirtyFieldsByRowId: ReadonlyMap<string, ReadonlySet<string>>;
  /** True when rows were added, removed, or reordered. */
  readonly structural: boolean;
  /** Source indexes of rows updated in place. Empty for structural outcomes. */
  readonly updatedSourceIndexes: ReadonlySet<number>;
  /**
   * Changed fields keyed by source index for update-only outcomes.
   * Empty map for structural outcomes. Always includes an entry for each
   * member of `updatedSourceIndexes` when RowStore produced the metadata.
   */
  readonly dirtyFieldsBySourceIndex: ReadonlyMap<number, ReadonlySet<string>>;
}

/** Outcome of a single transaction applied through RowStore. */
export interface RowStoreCommitOutcome {
  readonly result: RowDataTransactionResult;
  readonly dirty: RowStoreDirtyMetadata;
  /** True when the transaction changed at least one row. */
  readonly changed: boolean;
  /** True when the transaction is structural (add/remove). */
  readonly structural: boolean;
}

/** Outcome of a batch of transactions applied through RowStore. */
export interface RowStoreBatchOutcome {
  readonly results: RowDataTransactionResult[];
  readonly dirty: RowStoreDirtyMetadata;
  readonly changed: boolean;
  readonly structural: boolean;
}
