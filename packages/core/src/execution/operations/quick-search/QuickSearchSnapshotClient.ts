/**
 * Snapshot lifecycle controller for quick-search worker execution.
 *
 * Owns the main-thread side of the snapshot protocol: start → chunks →
 * complete, transactional patchStart → patchChunk* → patchComplete, plus
 * clear/cancel and stale-generation guarding. Chunks are always
 * searchable/projection-only (`SearchableSnapshotRow[]`) — full `RowData[]`
 * is never posted.
 *
 * Reuse identity is revision/signature based — rows-array identity is
 * advisory extraction input only. Same-structure data-revision advances
 * patch in place without bumping generation when a complete transfer is
 * provided.
 *
 * Transport posts return success/failure so a dead worker cannot leave
 * O(n) extraction running after snapshotStart/chunk/complete fails.
 */

import type { QuickSearchNormalizer } from "../../../features/quick-search/normalizer";
import { defaultNormalizer } from "../../../features/quick-search/normalizer";
import type { SearchableFieldDescriptor } from "../../../features/quick-search/searchableFieldResolver";
import type { SnapshotExtractionHandle } from "../../../features/quick-search/snapshotExtractor";
import { extractSnapshotChunked } from "../../../features/quick-search/snapshotExtractor";
import type { SnapshotPatchExtractionHandle } from "../../../features/quick-search/snapshotPatchExtractor";
import { extractSnapshotPatchSubset } from "../../../features/quick-search/snapshotPatchExtractor";
import type {
  CooperativeHandle,
  CooperativeScheduleOptions,
} from "../../../scheduling/CooperativeScheduler";
import { CooperativeScheduler } from "../../../scheduling/CooperativeScheduler";
import type { RowData } from "../../../types";

import type {
  QuickSearchWorkerRequest,
  SearchableSnapshotRow,
} from "./quickSearchProtocol";

export interface SnapshotTransport {
  /** @returns true when the message was accepted by the transport. */
  post(message: QuickSearchWorkerRequest): boolean;
}

/**
 * Feature-neutral transfer input. GridState owns `transferId`; this client
 * owns exactly-once disposition and never imports accumulator types.
 */
export interface SnapshotTransferInput {
  transferId: number;
  /** Accepts ReadonlySet / arrays / any Iterable — never sync-consumed here. */
  indexes: Iterable<number>;
  complete: boolean;
  onDisposition: (disposition: SnapshotTransferDisposition) => void;
}

export type SnapshotTransferDisposition =
  | {
      kind: "posted";
      transferId: number;
      patchId: number;
      generation: number;
      targetDataRevision: number;
    }
  | {
      kind: "cancelled";
      transferId: number;
    }
  | {
      kind: "rebuild-required";
      transferId: number;
      newGeneration: number;
    };

export interface SnapshotSyncConfig {
  rows: readonly RowData[];
  descriptors: readonly SearchableFieldDescriptor[];
  /** Stable searchable-fields signature from the field resolver. */
  fieldsSignature: string;
  normalizer?: QuickSearchNormalizer;
  chunkSize?: number;
  /** Priority for extraction continuations (prewarm passes background). */
  schedulePriority?: CooperativeScheduleOptions;
  sourceLayoutRevision: number;
  searchableDataRevision: number;
  /**
   * Optional dirty-index transfer. When eligible, drives a transactional
   * patch; otherwise forces full rebuild with transfer disposition.
   */
  transfer?: SnapshotTransferInput;
  /**
   * Invoked at most once when transport rejects a coherence message and the
   * caller must complete worker-unavailable fallback.
   */
  onAsyncFailure?: () => void;
}

export type SnapshotSyncOutcome =
  | "reused"
  | "patching"
  | "started"
  | "failed";

interface CurrentSnapshot {
  /** Advisory extraction input — updated on COW reuse without rebuild. */
  rows: readonly RowData[];
  fieldsSignature: string;
  normalizerSignature: string;
  sourceLayoutRevision: number;
  searchableDataRevision: number;
  generation: number;
  complete: boolean;
}

interface SnapshotIdentity {
  fieldsSignature: string;
  normalizerSignature: string;
  sourceLayoutRevision: number;
  searchableDataRevision: number;
}

interface StructuralIdentity {
  fieldsSignature: string;
  normalizerSignature: string;
  sourceLayoutRevision: number;
}

interface TransferWork {
  transferId: number;
  onDisposition: (disposition: SnapshotTransferDisposition) => void;
  onAsyncFailure: (() => void) | undefined;
  dispositionEmitted: boolean;
  asyncFailureEmitted: boolean;
  /** Set when a patch transaction is allocated. */
  patchId: number | null;
}

function snapshotIdentityEqual(
  a: SnapshotIdentity,
  b: SnapshotIdentity,
): boolean {
  return (
    a.fieldsSignature === b.fieldsSignature &&
    a.normalizerSignature === b.normalizerSignature &&
    a.sourceLayoutRevision === b.sourceLayoutRevision &&
    a.searchableDataRevision === b.searchableDataRevision
  );
}

function structuralIdentityEqual(
  a: StructuralIdentity,
  b: StructuralIdentity,
): boolean {
  return (
    a.fieldsSignature === b.fieldsSignature &&
    a.normalizerSignature === b.normalizerSignature &&
    a.sourceLayoutRevision === b.sourceLayoutRevision
  );
}

export class QuickSearchSnapshotClient {
  private readonly transport: SnapshotTransport;
  private readonly scheduler: CooperativeScheduler;
  private generationCounter = 0;
  /** Monotonic; never reset by clear/cancel/destroy. */
  private patchIdCounter = 0;
  private current: CurrentSnapshot | null = null;
  private extraction: SnapshotExtractionHandle | null = null;
  private patchExtraction: SnapshotPatchExtractionHandle | null = null;
  private transferWork: TransferWork | null = null;
  private prewarmHandle: CooperativeHandle | null = null;
  private prewarmTarget: SnapshotIdentity | null = null;

  constructor(transport: SnapshotTransport, scheduler?: CooperativeScheduler) {
    this.transport = transport;
    this.scheduler = scheduler ?? new CooperativeScheduler();
  }

  getCurrentGeneration(): number {
    return this.current?.generation ?? 0;
  }

  isSnapshotComplete(): boolean {
    return this.current?.complete ?? false;
  }

  /** True while a patch extraction/post is owned by this client. */
  isPatching(): boolean {
    return this.transferWork !== null && this.patchExtraction !== null;
  }

  /**
   * Ensure the worker snapshot matches revision/signature identity.
   *
   * Outcomes:
   * - `reused` — identity current and no transfer to dispose
   * - `patching` — transactional patch extraction started
   * - `started` — full snapshot generation started
   * - `failed` — snapshotStart rejected
   *
   * A supplied transfer always receives exactly one disposition.
   */
  sync(config: SnapshotSyncConfig): SnapshotSyncOutcome {
    const normalizer = config.normalizer ?? defaultNormalizer;
    const identity: SnapshotIdentity = {
      fieldsSignature: config.fieldsSignature,
      normalizerSignature: normalizer.signature,
      sourceLayoutRevision: config.sourceLayoutRevision,
      searchableDataRevision: config.searchableDataRevision,
    };

    // Background prewarm must never displace active patch extraction.
    if (
      this.transferWork !== null &&
      config.schedulePriority?.priority === "background"
    ) {
      return "reused";
    }

    const cur = this.current;
    if (
      config.schedulePriority?.priority === "background" &&
      config.transfer === undefined &&
      this.isCompletedPatchBase(cur, identity)
    ) {
      return "reused";
    }
    if (cur && snapshotIdentityEqual(cur, identity)) {
      // Inspect transfer before reused: never strand ownership.
      if (config.transfer !== undefined) {
        return this.startFullRebuild(config, normalizer);
      }
      cur.rows = config.rows;
      return "reused";
    }

    if (this.isPatchEligible(cur, identity, config.transfer)) {
      return this.startPatch(config, normalizer);
    }

    return this.startFullRebuild(config, normalizer);
  }

  /**
   * Schedule a background-priority snapshot sync for stable inputs.
   * Dedupes on revision/signature identity — not rows reference.
   * Never schedules while patch work is active.
   */
  prewarm(config: SnapshotSyncConfig): CooperativeHandle {
    if (this.transferWork !== null) {
      return { cancel() {} };
    }

    const normalizer = config.normalizer ?? defaultNormalizer;
    const identity: SnapshotIdentity = {
      fieldsSignature: config.fieldsSignature,
      normalizerSignature: normalizer.signature,
      sourceLayoutRevision: config.sourceLayoutRevision,
      searchableDataRevision: config.searchableDataRevision,
    };
    const cur = this.current;
    const alreadySynced = cur !== null && snapshotIdentityEqual(cur, identity);
    const preservesPatchBase = this.isCompletedPatchBase(cur, identity);
    const pending = this.prewarmTarget;
    const samePendingTarget =
      pending !== null && snapshotIdentityEqual(pending, identity);

    if (alreadySynced || preservesPatchBase || samePendingTarget) {
      return { cancel() {} };
    }

    this.prewarmHandle?.cancel();
    this.prewarmTarget = identity;

    let fired = false;
    let firedGeneration: number | null = null;

    const handle = this.scheduler.schedule(
      () => {
        fired = true;
        this.prewarmHandle = null;
        this.prewarmTarget = null;
        // Active patch may have started after schedule; must not displace it.
        if (this.transferWork !== null) {
          return;
        }
        // Never forward transfer ownership into background prewarm sync.
        const {
          transfer: _omitTransfer,
          onAsyncFailure: _omitFailure,
          ...prewarmConfig
        } = config;
        void _omitTransfer;
        void _omitFailure;
        this.sync({
          ...prewarmConfig,
          schedulePriority: { priority: "background" },
        });
        firedGeneration = this.current?.generation ?? null;
      },
      { priority: "background" },
    );
    this.prewarmHandle = handle;

    return {
      cancel: () => {
        if (!fired) {
          handle.cancel();
          if (this.prewarmHandle === handle) {
            this.prewarmHandle = null;
            this.prewarmTarget = null;
          }
          return;
        }
        if (
          firedGeneration !== null &&
          this.current !== null &&
          this.current.generation === firedGeneration &&
          !this.current.complete
        ) {
          this.cancel();
        }
      },
    };
  }

  /** Cancel in-flight extraction/chunk posting without clearing worker state. */
  cancel(): void {
    this.cancelInFlight({ emitTransferCancelled: true });
    if (this.current && !this.current.complete) {
      this.current = null;
    }
  }

  /**
   * Cancel active patch extraction only.
   * Preserves a completed base snapshot and emits transfer `cancelled`
   * exactly once when patch work was active. Does not cancel an in-flight
   * full snapshot generation.
   */
  cancelPatch(): void {
    if (this.patchExtraction === null) {
      return;
    }
    this.patchExtraction.cancel();
    this.patchExtraction = null;
    const work = this.transferWork;
    if (work !== null) {
      this.transferWork = null;
      this.emitDisposition(work, {
        kind: "cancelled",
        transferId: work.transferId,
      });
    }
  }

  /** Cancel everything and tell the worker to drop its snapshot. */
  clear(): boolean {
    this.cancelInFlight({ emitTransferCancelled: true });
    this.current = null;
    return this.transport.post({ kind: "quickSearch:clearSnapshot" });
  }

  destroy(): void {
    this.cancelInFlight({ emitTransferCancelled: true });
    this.current = null;
  }

  private isPatchEligible(
    cur: CurrentSnapshot | null,
    identity: SnapshotIdentity,
    transfer: SnapshotTransferInput | undefined,
  ): boolean {
    if (cur === null || !cur.complete) {
      return false;
    }
    if (transfer === undefined || !transfer.complete) {
      return false;
    }
    if (
      !structuralIdentityEqual(cur, {
        fieldsSignature: identity.fieldsSignature,
        normalizerSignature: identity.normalizerSignature,
        sourceLayoutRevision: identity.sourceLayoutRevision,
      })
    ) {
      return false;
    }
    return identity.searchableDataRevision > cur.searchableDataRevision;
  }

  /**
   * Prewarm is cold-snapshot preparation. A completed, structurally
   * compatible snapshot at an older data revision is deliberately retained
   * so an interactive sync can advance it with its dirty-index transfer.
   */
  private isCompletedPatchBase(
    cur: CurrentSnapshot | null,
    identity: SnapshotIdentity,
  ): boolean {
    return (
      cur !== null &&
      cur.complete &&
      structuralIdentityEqual(cur, identity) &&
      identity.searchableDataRevision > cur.searchableDataRevision
    );
  }

  private startPatch(
    config: SnapshotSyncConfig,
    normalizer: QuickSearchNormalizer,
  ): SnapshotSyncOutcome {
    const transfer = config.transfer!;
    const cur = this.current!;

    // Interactive patch cancels pending prewarm; never the reverse.
    this.cancelPendingPrewarmOnly();
    // Supersede any prior transfer/extraction with cancelled once.
    this.cancelInFlight({ emitTransferCancelled: true });

    const patchId = ++this.patchIdCounter;
    const work = this.createTransferWork(transfer, config.onAsyncFailure);
    work.patchId = patchId;
    this.transferWork = work;

    const generation = cur.generation;
    const baseDataRevision = cur.searchableDataRevision;
    const targetDataRevision = config.searchableDataRevision;
    const sourceLayoutRevision = cur.sourceLayoutRevision;
    const schedulePriority =
      config.schedulePriority ?? ({ priority: "user-visible" } as const);

    this.patchExtraction = extractSnapshotPatchSubset(
      {
        rows: config.rows,
        descriptors: config.descriptors,
        normalizer,
        sourceIndexes: transfer.indexes,
        scheduler: this.scheduler,
        schedulePriority,
      },
      (result) => {
        if (this.transferWork !== work) {
          return;
        }
        this.patchExtraction = null;

        if (result.kind === "rebuild-required") {
          this.beginFullSnapshotFromTransfer(config, normalizer, work);
          return;
        }
        if (result.totalUniqueRows === 0) {
          this.beginFullSnapshotFromTransfer(config, normalizer, work);
          return;
        }

        this.postPatchTransaction({
          work,
          config,
          patchId,
          generation,
          sourceLayoutRevision,
          baseDataRevision,
          targetDataRevision,
          chunks: result.chunks,
          totalUniqueRows: result.totalUniqueRows,
          totalChunks: result.totalChunks,
        });
      },
    );

    return "patching";
  }

  private postPatchTransaction(args: {
    work: TransferWork;
    config: SnapshotSyncConfig;
    patchId: number;
    generation: number;
    sourceLayoutRevision: number;
    baseDataRevision: number;
    targetDataRevision: number;
    chunks: SearchableSnapshotRow[][];
    totalUniqueRows: number;
    totalChunks: number;
  }): void {
    const {
      work,
      config,
      patchId,
      generation,
      sourceLayoutRevision,
      baseDataRevision,
      targetDataRevision,
      chunks,
      totalUniqueRows,
      totalChunks,
    } = args;

    const startPosted = this.transport.post({
      kind: "quickSearch:snapshotPatchStart",
      patchId,
      generation,
      sourceLayoutRevision,
      baseDataRevision,
      targetDataRevision,
      totalUniqueRows,
      totalChunks,
    });
    if (!startPosted) {
      this.failTransferTransport(work);
      return;
    }

    for (let sequence = 0; sequence < chunks.length; sequence++) {
      const chunkPosted = this.transport.post({
        kind: "quickSearch:snapshotPatchChunk",
        patchId,
        generation,
        chunkSequence: sequence,
        updates: chunks[sequence]!,
      });
      if (!chunkPosted) {
        this.failTransferTransport(work);
        return;
      }
    }

    const completePosted = this.transport.post({
      kind: "quickSearch:snapshotPatchComplete",
      patchId,
      generation,
      targetDataRevision,
      totalUniqueRows,
      totalChunks,
    });
    if (!completePosted) {
      this.failTransferTransport(work);
      return;
    }

    const cur = this.current;
    if (cur !== null && cur.generation === generation) {
      cur.searchableDataRevision = targetDataRevision;
      cur.rows = config.rows;
    }

    this.transferWork = null;
    this.emitDisposition(work, {
      kind: "posted",
      transferId: work.transferId,
      patchId,
      generation,
      targetDataRevision,
    });
  }

  private startFullRebuild(
    config: SnapshotSyncConfig,
    normalizer: QuickSearchNormalizer,
  ): SnapshotSyncOutcome {
    const transfer = config.transfer;

    this.cancelInFlight({ emitTransferCancelled: true });

    const work =
      transfer !== undefined
        ? this.createTransferWork(transfer, config.onAsyncFailure)
        : null;
    if (work !== null) {
      this.transferWork = work;
    }

    return this.beginFullSnapshot(config, normalizer, work);
  }

  /**
   * Promote an in-flight transfer from patch extraction to full rebuild
   * without emitting cancelled and without retrying patch eligibility.
   */
  private beginFullSnapshotFromTransfer(
    config: SnapshotSyncConfig,
    normalizer: QuickSearchNormalizer,
    work: TransferWork,
  ): void {
    this.patchExtraction?.cancel();
    this.patchExtraction = null;
    // Keep transferWork; disposition becomes rebuild-required after start.
    this.beginFullSnapshot(config, normalizer, work);
  }

  private beginFullSnapshot(
    config: SnapshotSyncConfig,
    normalizer: QuickSearchNormalizer,
    transferWork: TransferWork | null,
  ): SnapshotSyncOutcome {
    this.extraction?.cancel();
    this.extraction = null;
    this.cancelPendingPrewarmOnly();

    const generation = ++this.generationCounter;
    const snapshot: CurrentSnapshot = {
      rows: config.rows,
      fieldsSignature: config.fieldsSignature,
      normalizerSignature: normalizer.signature,
      sourceLayoutRevision: config.sourceLayoutRevision,
      searchableDataRevision: config.searchableDataRevision,
      generation,
      complete: false,
    };
    this.current = snapshot;

    const startPosted = this.transport.post({
      kind: "quickSearch:snapshotStart",
      generation,
      rowCount: config.rows.length,
      fields: config.descriptors.map((d) => ({
        field: d.field,
        ...(d.projectionField !== undefined
          ? { projectionField: d.projectionField }
          : {}),
      })),
      payloadFormat: "searchable-fields-v1",
      normalizerSignature: normalizer.signature,
      sourceLayoutRevision: config.sourceLayoutRevision,
      searchableDataRevision: config.searchableDataRevision,
    });

    if (!startPosted) {
      this.dropAttemptedSnapshot(snapshot);
      if (transferWork !== null && this.transferWork === transferWork) {
        this.transferWork = null;
        this.emitDisposition(transferWork, {
          kind: "cancelled",
          transferId: transferWork.transferId,
        });
        this.emitAsyncFailure(transferWork);
      }
      return "failed";
    }

    // Install extraction before settling disposition so a synchronous
    // rebuild-required callback that cancel()/supersedes can abort the
    // already-scheduled first row and cannot leave BUILDING stranded.
    this.extraction = extractSnapshotChunked(
      {
        rows: config.rows,
        descriptors: config.descriptors,
        normalizer,
        chunkSize: config.chunkSize,
        scheduler: this.scheduler,
        schedulePriority: config.schedulePriority,
      },
      (chunk, startIndex) => {
        if (this.current !== snapshot) return false;
        const chunkPosted = this.transport.post({
          kind: "quickSearch:snapshotChunk",
          generation,
          startIndex,
          payloadFormat: "searchable-fields-v1",
          rows: chunk,
        });
        if (!chunkPosted) {
          this.invalidateAttemptedSnapshot(snapshot);
          if (transferWork !== null) {
            this.emitAsyncFailure(transferWork);
          } else if (config.onAsyncFailure) {
            // No transfer — still allow one-shot failure for callers.
            config.onAsyncFailure();
          }
          return false;
        }
        return true;
      },
      () => {
        if (this.current !== snapshot) return;
        this.extraction = null;
        const completePosted = this.transport.post({
          kind: "quickSearch:snapshotComplete",
          generation,
        });
        if (!completePosted) {
          this.invalidateAttemptedSnapshot(snapshot);
          if (transferWork !== null) {
            this.emitAsyncFailure(transferWork);
          } else if (config.onAsyncFailure) {
            config.onAsyncFailure();
          }
          return;
        }
        if (this.current === snapshot) {
          snapshot.complete = true;
        }
      },
    );

    if (transferWork !== null && this.transferWork === transferWork) {
      // Settle ownership first, then emit — disposition must not re-enter
      // cancelInFlight for this same transfer.
      this.transferWork = null;
      this.emitDisposition(transferWork, {
        kind: "rebuild-required",
        transferId: transferWork.transferId,
        newGeneration: generation,
      });
    }

    return "started";
  }

  private failTransferTransport(work: TransferWork): void {
    this.patchExtraction?.cancel();
    this.patchExtraction = null;
    this.extraction?.cancel();
    this.extraction = null;
    this.current = null;
    if (this.transferWork === work) {
      this.transferWork = null;
    }
    this.emitDisposition(work, {
      kind: "cancelled",
      transferId: work.transferId,
    });
    this.emitAsyncFailure(work);
  }

  private createTransferWork(
    transfer: SnapshotTransferInput,
    onAsyncFailure: (() => void) | undefined,
  ): TransferWork {
    return {
      transferId: transfer.transferId,
      onDisposition: transfer.onDisposition,
      onAsyncFailure,
      dispositionEmitted: false,
      asyncFailureEmitted: false,
      patchId: null,
    };
  }

  private emitDisposition(
    work: TransferWork,
    disposition: SnapshotTransferDisposition,
  ): void {
    if (work.dispositionEmitted) {
      return;
    }
    work.dispositionEmitted = true;
    work.onDisposition(disposition);
  }

  private emitAsyncFailure(work: TransferWork): void {
    if (work.asyncFailureEmitted) {
      return;
    }
    work.asyncFailureEmitted = true;
    work.onAsyncFailure?.();
  }

  private dropAttemptedSnapshot(snapshot: CurrentSnapshot): void {
    if (this.current === snapshot) {
      this.current = null;
    }
    this.extraction?.cancel();
    this.extraction = null;
  }

  /**
   * Invalidate an in-flight generation after a chunk/complete transport
   * failure. Safe to call from inside an extraction callback.
   */
  private invalidateAttemptedSnapshot(snapshot: CurrentSnapshot): void {
    this.extraction?.cancel();
    this.extraction = null;
    if (this.current === snapshot) {
      this.current = null;
    }
  }

  private cancelPendingPrewarmOnly(): void {
    this.prewarmHandle?.cancel();
    this.prewarmHandle = null;
    this.prewarmTarget = null;
  }

  private cancelInFlight(options: { emitTransferCancelled: boolean }): void {
    this.extraction?.cancel();
    this.extraction = null;
    this.patchExtraction?.cancel();
    this.patchExtraction = null;
    this.cancelPendingPrewarmOnly();

    const work = this.transferWork;
    if (work !== null) {
      this.transferWork = null;
      if (options.emitTransferCancelled) {
        this.emitDisposition(work, {
          kind: "cancelled",
          transferId: work.transferId,
        });
      }
    }
  }
}
