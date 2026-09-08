/**
 * Immutable view of retained quick-search dirty source indexes.
 *
 * `indexes` is the union of pending and in-flight ownership.
 * `complete` is the conservative conjunction of both ownership states.
 */
export interface QuickSearchDirtySourceSnapshot {
  readonly indexes: ReadonlySet<number>;
  readonly complete: boolean;
}

/**
 * Stable snapshot of one in-flight dirty-index transfer.
 * Does not carry worker transport or protocol message concepts.
 */
export interface QuickSearchDirtySourceTransfer {
  readonly transferId: number;
  readonly indexes: ReadonlySet<number>;
  readonly complete: boolean;
}

/**
 * GridState-facing transfer snapshot: accumulator transfer plus the revision
 * pair captured at begin time.
 */
export interface QuickSearchDirtyTransferSnapshot {
  readonly transferId: number;
  readonly indexes: ReadonlySet<number>;
  readonly complete: boolean;
  readonly sourceLayoutRevision: number;
  readonly searchableDataRevision: number;
}

interface InFlightOwnership {
  readonly transferId: number;
  readonly indexes: ReadonlySet<number>;
  readonly complete: boolean;
}

/**
 * Feature-owned accumulator for searchable update-only source indexes with
 * pending / in-flight transfer ownership.
 *
 * GridState owns one instance and drives transitions. No row-ID lookups,
 * rows scans, or worker/protocol terminology.
 */
export class QuickSearchDirtySourceAccumulator {
  private readonly pendingIndexes = new Set<number>();
  private pendingComplete = true;
  private inFlight: InFlightOwnership | null = null;
  private nextTransferId = 1;

  record(
    sourceIndexes: Iterable<number>,
    sourceIndexCoverageComplete: boolean,
  ): void {
    for (const index of sourceIndexes) {
      this.pendingIndexes.add(index);
    }
    if (!sourceIndexCoverageComplete) {
      this.pendingComplete = false;
    }
  }

  beginTransfer(): QuickSearchDirtySourceTransfer {
    if (this.inFlight !== null) {
      this.restoreInFlightToPending(this.inFlight);
      this.inFlight = null;
    }

    const transferId = this.nextTransferId++;
    const indexes = new Set(this.pendingIndexes);
    const complete = this.pendingComplete;
    this.inFlight = { transferId, indexes, complete };

    this.pendingIndexes.clear();
    this.pendingComplete = true;

    return {
      transferId,
      // Same ReadonlySet reference retained as in-flight ownership.
      indexes,
      complete,
    };
  }

  /**
   * Begin a transfer only when retained dirty ownership exists.
   * Returns undefined for empty + complete with no in-flight work —
   * without allocating a transfer ID or copying indexes.
   * Incomplete empty coverage still begins a transfer.
   */
  beginTransferIfNeeded(): QuickSearchDirtySourceTransfer | undefined {
    if (
      this.inFlight === null &&
      this.pendingIndexes.size === 0 &&
      this.pendingComplete
    ) {
      return undefined;
    }
    return this.beginTransfer();
  }

  cancelTransfer(transferId: number): boolean {
    const active = this.inFlight;
    if (active === null || active.transferId !== transferId) {
      return false;
    }
    this.restoreInFlightToPending(active);
    this.inFlight = null;
    return true;
  }

  /**
   * Drop matching in-flight ownership after a complete transfer was posted.
   * Incomplete and stale transfer IDs return false without mutation.
   */
  acknowledgeTransferPosted(transferId: number): boolean {
    const active = this.inFlight;
    if (active === null || active.transferId !== transferId) {
      return false;
    }
    // Incomplete transfers are not postable; reject without mutating state.
    if (!active.complete) {
      return false;
    }
    // Drop only in-flight ownership. Pending edits recorded after begin remain.
    this.inFlight = null;
    return true;
  }

  /**
   * Drop matching in-flight ownership after an accepted full-snapshot rebuild
   * covered the transfer. Incomplete transfers are allowed; pending edits
   * recorded after begin remain. Stale IDs return false without mutation.
   */
  acknowledgeTransferCoveredByFullSnapshot(transferId: number): boolean {
    const active = this.inFlight;
    if (active === null || active.transferId !== transferId) {
      return false;
    }
    this.inFlight = null;
    return true;
  }

  clear(): void {
    this.pendingIndexes.clear();
    this.pendingComplete = true;
    this.inFlight = null;
  }

  snapshot(): QuickSearchDirtySourceSnapshot {
    const indexes = new Set(this.pendingIndexes);
    if (this.inFlight !== null) {
      for (const index of this.inFlight.indexes) {
        indexes.add(index);
      }
    }
    const complete =
      this.pendingComplete && (this.inFlight?.complete ?? true);
    return { indexes, complete };
  }

  private restoreInFlightToPending(active: InFlightOwnership): void {
    for (const index of active.indexes) {
      this.pendingIndexes.add(index);
    }
    this.pendingComplete = this.pendingComplete && active.complete;
  }
}
