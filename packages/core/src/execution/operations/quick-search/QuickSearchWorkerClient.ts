/**
 * Main-thread quick-search worker client.
 *
 * Owns worker transport lifecycle, monotonic request ids, logical
 * execution tokens (cancel-handle identity), stale-response guards,
 * query cancellation, snapshot sync / patch coordination, and bounded
 * worker-rebuild-first recovery for revision/layout/generation mismatches
 * and typed patchRejected responses.
 */

import type { QuickSearchNormalizer } from "../../../features/quick-search/normalizer";
import type { SearchableFieldDescriptor } from "../../../features/quick-search/searchableFieldResolver";
import type { CooperativeHandle } from "../../../scheduling/CooperativeScheduler";
import { CooperativeScheduler } from "../../../scheduling/CooperativeScheduler";
import type { QuickFilterCacheMode, RowData } from "../../../types";

import { parseQueryParts } from "./quickSearchMatcher";
import type {
  QuickSearchErrorCode,
  QuickSearchWorkerRequest,
  QuickSearchWorkerResponse,
} from "./quickSearchProtocol";
import { QUICK_SEARCH_RECOVERABLE_ERROR_CODES } from "./quickSearchProtocol";
import type { QuickSearchExecutionHandle } from "./quickSearchQueryEngine";
import {
  QuickSearchSnapshotClient,
  type SnapshotSyncConfig,
  type SnapshotTransferDisposition,
  type SnapshotTransferInput,
  type SnapshotTransport,
} from "./QuickSearchSnapshotClient";

export interface QuickSearchWorkerTransport {
  post(message: QuickSearchWorkerRequest, transfer?: Transferable[]): void;
  subscribe(handler: (response: QuickSearchWorkerResponse) => void): () => void;
  terminate?(): void;
}

export interface QuickSearchWorkerExecuteConfig {
  rows: readonly RowData[];
  descriptors: readonly SearchableFieldDescriptor[];
  /** Stable searchable-fields signature from the field resolver. */
  fieldsSignature: string;
  normalizer?: QuickSearchNormalizer;
  chunkSize?: number;
  /** Already normalized through the shared normalizer. */
  normalizedText: string;
  /**
   * Upstream filtered order; null = full dataset in identity order.
   *
   * Caller-owned buffers are never transferred to the worker — structured
   * clone copies the typed array so the caller retains its buffer.
   */
  sourceIndexes?: Uint32Array | null;
  /** Monotonic upstream filtered-order version for O(1) cache keying. */
  sourceVersion: number;
  cacheMode: QuickFilterCacheMode;
  sourceLayoutRevision: number;
  searchableDataRevision: number;
  /**
   * Optional dirty-index transfer for transactional patching.
   * Feature-neutral — do not pass grid ownership or accumulator types.
   */
  transfer?: SnapshotTransferInput;
}

export interface QuickSearchWorkerExecuteCallbacks {
  onSuccess: (indexes: Uint32Array) => void;
  /** Worker error or transport failure — caller may run main-thread fallback. */
  onFallback: (error: Error) => void;
  /** Snapshot sync in progress; query will post after matching ready. */
  onSyncing?: () => void;
}

interface PendingQuery {
  requestId: number;
  generation: number;
  normalizedText: string;
  sourceIndexes: Uint32Array | null;
  sourceVersion: number;
  cacheMode: QuickFilterCacheMode;
  sourceLayoutRevision: number;
  searchableDataRevision: number;
}

interface PostedPatch {
  patchId: number;
  generation: number;
}

const NOOP_HANDLE: QuickSearchExecutionHandle = { cancel() {} };

function isEmptyNormalizedQuery(normalizedText: string): boolean {
  const trimmed = normalizedText.trim();
  return trimmed.length === 0 || parseQueryParts(trimmed).length === 0;
}

function buildPassthroughIndexes(
  rowCount: number,
  sourceIndexes: Uint32Array | null | undefined,
): Uint32Array {
  if (sourceIndexes !== null && sourceIndexes !== undefined) {
    return sourceIndexes;
  }
  const out = new Uint32Array(rowCount);
  for (let i = 0; i < rowCount; i++) {
    out[i] = i;
  }
  return out;
}

function toBaseSyncConfig(
  config: QuickSearchWorkerExecuteConfig,
): Omit<SnapshotSyncConfig, "transfer" | "onAsyncFailure"> {
  return {
    rows: config.rows,
    descriptors: config.descriptors,
    fieldsSignature: config.fieldsSignature,
    normalizer: config.normalizer,
    chunkSize: config.chunkSize,
    sourceLayoutRevision: config.sourceLayoutRevision,
    searchableDataRevision: config.searchableDataRevision,
  };
}

/** Retry / recovery always omits a settled transfer. */
function withoutTransfer(
  config: QuickSearchWorkerExecuteConfig,
): QuickSearchWorkerExecuteConfig {
  const { transfer: _omit, ...rest } = config;
  void _omit;
  return rest;
}

export class QuickSearchWorkerClient {
  private readonly transport: QuickSearchWorkerTransport;
  private readonly snapshotClient: QuickSearchSnapshotClient;
  private readonly unsubscribe: () => void;

  private requestIdCounter = 0;
  /** Monotonic identity for one logical execute(); cancel handles capture this. */
  private executionTokenCounter = 0;
  private activeExecutionToken: number | null = null;
  private activeRequestId: number | null = null;
  private activeCallbacks: QuickSearchWorkerExecuteCallbacks | null = null;
  private activeExecuteConfig: QuickSearchWorkerExecuteConfig | null = null;
  private pendingQuery: PendingQuery | null = null;
  private postedPatch: PostedPatch | null = null;
  private rebuildAttempted = false;
  private destroyed = false;

  constructor(
    transport: QuickSearchWorkerTransport,
    options?: {
      scheduler?: CooperativeScheduler;
      snapshotClient?: QuickSearchSnapshotClient;
    },
  ) {
    this.transport = transport;
    const snapshotTransport: SnapshotTransport = {
      post: (message) => this.postToTransport(message),
    };
    this.snapshotClient =
      options?.snapshotClient ??
      new QuickSearchSnapshotClient(
        snapshotTransport,
        options?.scheduler ?? new CooperativeScheduler(),
      );
    this.unsubscribe = transport.subscribe((response) =>
      this.handleResponse(response),
    );
  }

  getSnapshotClient(): QuickSearchSnapshotClient {
    return this.snapshotClient;
  }

  getActiveRequestId(): number | null {
    return this.activeRequestId;
  }

  /** Schedule background snapshot sync — never posts a query. */
  prewarm(config: SnapshotSyncConfig): CooperativeHandle {
    return this.snapshotClient.prewarm(config);
  }

  execute(
    config: QuickSearchWorkerExecuteConfig,
    callbacks: QuickSearchWorkerExecuteCallbacks,
  ): QuickSearchExecutionHandle {
    if (this.destroyed) {
      callbacks.onFallback(new Error("QuickSearchWorkerClient destroyed"));
      return NOOP_HANDLE;
    }

    this.cancelActiveQuery();
    this.rebuildAttempted = false;

    if (isEmptyNormalizedQuery(config.normalizedText)) {
      this.snapshotClient.cancel();
      // Empty-query fast path never hands the transfer to SnapshotClient —
      // settle ownership here so accumulator state is not stranded.
      if (config.transfer !== undefined) {
        config.transfer.onDisposition({
          kind: "cancelled",
          transferId: config.transfer.transferId,
        });
      }
      const passthrough = buildPassthroughIndexes(
        config.rows.length,
        config.sourceIndexes,
      );
      callbacks.onSuccess(passthrough);
      return NOOP_HANDLE;
    }

    const executionToken = ++this.executionTokenCounter;
    this.activeExecutionToken = executionToken;
    const requestId = ++this.requestIdCounter;
    this.activeRequestId = requestId;
    this.activeCallbacks = callbacks;
    this.activeExecuteConfig = config;

    this.beginSnapshotAndQuery(config, requestId, callbacks);

    if (this.activeExecutionToken !== executionToken) return NOOP_HANDLE;

    return {
      cancel: () => {
        if (this.activeExecutionToken !== executionToken) return;
        this.cancelActiveQuery();
      },
    };
  }

  /**
   * Cancel the active query without clearing the reusable snapshot.
   * The snapshot remains valid for reuse by the next `execute()` call
   * when revision/signature identity is unchanged. Active patch work is
   * cancelled via {@link QuickSearchSnapshotClient.cancelPatch}.
   */
  cancelQuery(): void {
    this.cancelActiveQuery();
  }

  /**
   * Cancel the active query AND clear the worker snapshot. Use for
   * real snapshot invalidation.
   */
  clear(): void {
    this.cancelActiveQuery();
    this.snapshotClient.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.cancelActiveQuery();
    this.snapshotClient.clear();
    this.snapshotClient.destroy();
    this.unsubscribe();
    this.transport.terminate?.();
    this.destroyed = true;
  }

  private beginSnapshotAndQuery(
    config: QuickSearchWorkerExecuteConfig,
    requestId: number,
    callbacks: QuickSearchWorkerExecuteCallbacks,
  ): void {
    const executionToken = this.activeExecutionToken;
    const externalTransfer = config.transfer;

    const syncConfig: SnapshotSyncConfig = {
      ...toBaseSyncConfig(config),
      transfer:
        externalTransfer !== undefined
          ? {
              transferId: externalTransfer.transferId,
              indexes: externalTransfer.indexes,
              complete: externalTransfer.complete,
              onDisposition: (disposition) => {
                // Forward the original disposition exactly once first.
                externalTransfer.onDisposition(disposition);
                this.handleTransferDisposition(disposition, executionToken);
              },
            }
          : undefined,
      onAsyncFailure: () => {
        this.handleSnapshotAsyncFailure(executionToken);
      },
    };

    const outcome = this.snapshotClient.sync(syncConfig);
    if (outcome === "failed") {
      if (this.activeExecutionToken === executionToken) {
        const activeCallbacks = this.activeCallbacks;
        this.clearActiveState();
        activeCallbacks?.onFallback(
          new Error("Quick-search snapshot transport failed during sync"),
        );
      }
      return;
    }
    if (this.activeRequestId !== requestId) return;
    if (this.activeExecutionToken !== executionToken) return;

    const generation = this.snapshotClient.getCurrentGeneration();
    const sourceIndexes = config.sourceIndexes ?? null;
    const pending: PendingQuery = {
      requestId,
      generation,
      normalizedText: config.normalizedText.trim(),
      sourceIndexes,
      sourceVersion: config.sourceVersion,
      cacheMode: config.cacheMode,
      sourceLayoutRevision: config.sourceLayoutRevision,
      searchableDataRevision: config.searchableDataRevision,
    };

    switch (outcome) {
      case "reused": {
        if (this.snapshotClient.isSnapshotComplete()) {
          this.postQuery(pending);
        } else {
          this.pendingQuery = pending;
          callbacks.onSyncing?.();
        }
        break;
      }
      case "started": {
        this.pendingQuery = pending;
        callbacks.onSyncing?.();
        break;
      }
      case "patching": {
        // Base snapshot stays complete while patching — do not post yet.
        this.pendingQuery = pending;
        callbacks.onSyncing?.();
        break;
      }
    }
  }

  private handleTransferDisposition(
    disposition: SnapshotTransferDisposition,
    executionToken: number | null,
  ): void {
    if (
      executionToken === null ||
      this.activeExecutionToken !== executionToken
    ) {
      return;
    }

    switch (disposition.kind) {
      case "posted": {
        const pending = this.pendingQuery;
        if (pending === null) return;
        if (disposition.generation !== pending.generation) return;
        if (
          disposition.targetDataRevision !== pending.searchableDataRevision
        ) {
          return;
        }
        if (
          disposition.generation !== this.snapshotClient.getCurrentGeneration()
        ) {
          return;
        }

        this.postedPatch = {
          patchId: disposition.patchId,
          generation: disposition.generation,
        };
        this.pendingQuery = null;
        this.postQuery(pending);
        break;
      }
      case "rebuild-required": {
        const pending = this.pendingQuery;
        if (pending === null) return;
        pending.generation = disposition.newGeneration;
        // Keep pending; wait for matching ready. Do not re-emit onSyncing.
        break;
      }
      case "cancelled": {
        // Never post the pending query; cancellation must not call fallback.
        break;
      }
    }
  }

  private handleSnapshotAsyncFailure(executionToken: number | null): void {
    // Production transport failure may already have cleared the execution.
    if (
      executionToken === null ||
      this.activeExecutionToken !== executionToken
    ) {
      return;
    }
    const callbacks = this.activeCallbacks;
    this.clearActiveState();
    callbacks?.onFallback(
      new Error("Quick-search snapshot transport failed"),
    );
  }

  private postQuery(pending: PendingQuery): void {
    if (this.activeRequestId !== pending.requestId) return;

    this.postToTransport({
      kind: "quickSearch:query",
      generation: pending.generation,
      requestId: pending.requestId,
      normalizedText: pending.normalizedText,
      sourceIndexes: pending.sourceIndexes,
      sourceVersion: pending.sourceVersion,
      cacheMode: pending.cacheMode,
      sourceLayoutRevision: pending.sourceLayoutRevision,
      searchableDataRevision: pending.searchableDataRevision,
    });
  }

  private handleResponse(response: QuickSearchWorkerResponse): void {
    switch (response.kind) {
      case "quickSearch:ready":
        this.handleReady(response.generation);
        break;
      case "quickSearch:success":
        this.handleSuccess(response.requestId, response.indexes);
        break;
      case "quickSearch:error":
        this.handleError(response.requestId, response.code, response.message);
        break;
      case "quickSearch:patchRejected":
        this.handlePatchRejected(response.patchId, response.generation);
        break;
    }
  }

  private handleReady(generation: number): void {
    if (generation !== this.snapshotClient.getCurrentGeneration()) return;
    const pending = this.pendingQuery;
    if (pending === null || pending.generation !== generation) return;
    if (this.activeRequestId !== pending.requestId) return;
    this.pendingQuery = null;
    this.postQuery(pending);
  }

  private handleSuccess(requestId: number, indexes: Uint32Array): void {
    if (requestId !== this.activeRequestId) return;
    const callbacks = this.activeCallbacks;
    this.clearActiveState();
    callbacks?.onSuccess(indexes);
  }

  private handleError(
    requestId: number,
    code: QuickSearchErrorCode,
    message: string,
  ): void {
    if (requestId !== this.activeRequestId) return;

    const callbacks = this.activeCallbacks;
    const config = this.activeExecuteConfig;
    const recoverable =
      QUICK_SEARCH_RECOVERABLE_ERROR_CODES.has(code) &&
      config !== null &&
      callbacks !== null;

    if (recoverable && !this.rebuildAttempted) {
      this.rebuildAttempted = true;
      this.recoverWithWorkerRebuild(withoutTransfer(config), callbacks);
      return;
    }

    this.clearActiveState();
    callbacks?.onFallback(new Error(`[${code}] ${message}`));
  }

  private handlePatchRejected(patchId: number, generation: number): void {
    if (this.activeExecutionToken === null) return;
    // Shared recovery already consumed this logical execution's rebuild budget.
    if (this.rebuildAttempted) return;
    const remembered = this.postedPatch;
    if (remembered === null) return;
    if (
      remembered.patchId !== patchId ||
      remembered.generation !== generation
    ) {
      return;
    }

    const callbacks = this.activeCallbacks;
    const config = this.activeExecuteConfig;
    if (callbacks === null || config === null) return;

    // First matching rejection only.
    this.rebuildAttempted = true;
    this.recoverWithWorkerRebuild(withoutTransfer(config), callbacks);
  }

  /**
   * Shared worker-rebuild-first recovery for recoverable query mismatches
   * and matching patchRejected. One attempt per logical execution; retries
   * always omit the settled transfer. Does not call onFallback on success.
   */
  private recoverWithWorkerRebuild(
    config: QuickSearchWorkerExecuteConfig,
    callbacks: QuickSearchWorkerExecuteCallbacks,
  ): void {
    const executionToken = this.activeExecutionToken;
    // Authoritative: settle remembered patch so later patchRejected is obsolete.
    this.postedPatch = null;
    this.pendingQuery = null;

    const clearAccepted = this.snapshotClient.clear();
    if (!clearAccepted) {
      if (
        this.activeExecutionToken === executionToken &&
        this.activeCallbacks === callbacks &&
        this.activeExecuteConfig !== null
      ) {
        this.clearActiveState();
        callbacks.onFallback(
          new Error("Quick-search snapshot transport failed during clear"),
        );
      }
      return;
    }
    if (
      this.activeExecutionToken !== executionToken ||
      this.activeCallbacks !== callbacks
    ) {
      return;
    }

    // Keep activeExecuteConfig without transfer for subsequent retries.
    this.activeExecuteConfig = config;

    const retryRequestId = ++this.requestIdCounter;
    this.activeRequestId = retryRequestId;
    this.beginSnapshotAndQuery(config, retryRequestId, callbacks);
  }

  private handleTransportFailure(err: unknown): void {
    if (this.activeExecutionToken === null) return;
    const callbacks = this.activeCallbacks;
    this.clearActiveState();
    const error = err instanceof Error ? err : new Error(String(err));
    callbacks?.onFallback(error);
  }

  private postToTransport(
    message: QuickSearchWorkerRequest,
    transfer?: Transferable[],
  ): boolean {
    if (this.destroyed) return false;
    try {
      this.transport.post(message, transfer);
      return true;
    } catch (err) {
      this.handleTransportFailure(err);
      return false;
    }
  }

  /** Cancel posts are best-effort — failure must not complete the canceled request. */
  private postCancelToTransport(requestId: number): void {
    if (this.destroyed) return;
    try {
      this.transport.post({ kind: "quickSearch:cancel", requestId });
    } catch {
      // Stale worker responses are ignored by request-id guards.
    }
  }

  private cancelActiveQuery(): void {
    const wasPatching = this.snapshotClient.isPatching();
    const requestId = this.activeRequestId;
    // Clear logical execution first so patch cancelled dispositions are stale.
    this.clearActiveState();
    if (requestId !== null) {
      this.postCancelToTransport(requestId);
    }
    if (wasPatching) {
      this.snapshotClient.cancelPatch();
    }
  }

  private clearActiveState(): void {
    this.activeExecutionToken = null;
    this.activeRequestId = null;
    this.activeCallbacks = null;
    this.activeExecuteConfig = null;
    this.pendingQuery = null;
    this.postedPatch = null;
    this.rebuildAttempted = false;
  }
}
