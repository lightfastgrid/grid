/**
 * Row-data transaction types.
 *
 * Pure data contracts for incremental row updates (add / update /
 * remove) and immutable-rows diffing. No Grid, renderer, React, event,
 * or feature imports — this layer operates on row arrays and stable
 * row ids only.
 */

import type { RowData } from "../../types";

/**
 * Resolve a stable row id for transaction matching, or `null` when no
 * id is available. Implementations must be pure and index-free —
 * transaction rows have no meaningful position.
 */
export type ResolveTransactionRowId = (row: RowData) => string | null;

export type RowDataTransactionEntry = RowData | null | undefined;

/** Incremental row-data change request. */
export interface RowDataTransaction {
  /** Rows to add. Appended unless a positioning option is provided. */
  add?: RowDataTransactionEntry[];
  /** Rows to update in place, matched by stable row id. */
  update?: RowDataTransactionEntry[];
  /** Rows to remove, matched by stable row id. */
  remove?: RowDataTransactionEntry[];
  /** Row ids to remove (alternative to {@link remove} row objects). */
  removeIds?: string[];
  /**
   * Insertion index for {@link add} rows, clamped to the valid range
   * of the post-removal row array. Omitted: append at the end.
   * Mutually exclusive with {@link addBeforeId} and {@link addAfterId}.
   */
  addIndex?: number;
  /**
   * Insert {@link add} rows before the source row with this id.
   * Anchor resolution happens against post-removal rows.
   * Mutually exclusive with {@link addIndex} and {@link addAfterId}.
   */
  addBeforeId?: string;
  /**
   * Insert {@link add} rows after the source row with this id.
   * Anchor resolution happens against post-removal rows.
   * Mutually exclusive with {@link addIndex} and {@link addBeforeId}.
   */
  addAfterId?: string;
}

/** Why a transaction entry was not applied. */
export type RowDataTransactionSkipReason =
  | "missingRowId"
  | "duplicateId"
  | "notFound"
  | "invalidRow"
  | "invalidAddPosition"
  | "anchorNotFound";

/** A transaction entry that was not applied, with the reason. */
export interface RowDataTransactionSkipped {
  /** The resolved id, when one was available. */
  id?: string;
  /** The offending row object, when one was provided. */
  row?: RowData;
  reason: RowDataTransactionSkipReason;
}

/** Normalized result of applying a transaction or immutable diff. */
export interface RowDataTransactionResult {
  /** The resulting row array. Inputs are never mutated. */
  rows: RowData[];
  added: RowData[];
  updated: RowData[];
  removed: RowData[];
  skipped: RowDataTransactionSkipped[];
  addCount: number;
  updateCount: number;
  removeCount: number;
  skippedCount: number;
}
