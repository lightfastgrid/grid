/**
 * Worker-side quick-search runtime.
 *
 * Translates {@link QuickSearchWorkerRequest} protocol messages into
 * snapshot-store updates, query-engine execution, cancellation, typed
 * worker responses, and transactional PATCHING with bounded staging.
 *
 * Layout/data revisions are pending at snapshotStart and adopted as
 * applied only after a matching snapshotComplete. Patch commits advance
 * only `searchableDataRevision` after atomic row-text application.
 */

import { CooperativeScheduler } from "../../../scheduling/CooperativeScheduler";

import type {
  QuickSearchErrorCode,
  QuickSearchPatchRejectReason,
  QuickSearchWorkerRequest,
  QuickSearchWorkerResponse,
  SearchableSnapshotRow,
  SearchProjectionField,
  SnapshotPatchChunkMessage,
  SnapshotPatchCompleteMessage,
  SnapshotPatchStartMessage,
  SnapshotPayloadFormat,
  SnapshotStartMessage,
} from "./quickSearchProtocol";
import type { QuickSearchExecutionHandle } from "./quickSearchQueryEngine";
import { QuickSearchQueryEngine } from "./quickSearchQueryEngine";
import { QuickSearchSnapshotStore } from "./quickSearchSnapshotStore";

export const WORKER_DEFAULT_CONFIG_SIGNATURE = "worker-default-v1";

/** Independent worker staging ceilings — never trust client totals alone. */
const WORKER_MAX_STAGED_UNIQUE_ROWS = 2048;
const WORKER_MAX_STAGED_BYTES = 512 * 1024;
const WORKER_MAX_TOTAL_CHUNKS = WORKER_MAX_STAGED_UNIQUE_ROWS;

const STAGED_ROW_OVERHEAD_BYTES = 48;
const STAGED_VALUE_OVERHEAD_BYTES = 16;

export interface QuickSearchWorkerRuntimeOptions {
  scheduler?: CooperativeScheduler;
  /** Passed through to query execution — primarily for tests. */
  queryChunkSize?: number;
  snapshot?: QuickSearchSnapshotStore;
  engine?: QuickSearchQueryEngine;
}

interface SnapshotRevisionPair {
  sourceLayoutRevision: number;
  searchableDataRevision: number;
}

interface StagedRow {
  text: string;
  estimatedBytes: number;
}

interface ActivePatch {
  patchId: number;
  generation: number;
  sourceLayoutRevision: number;
  baseDataRevision: number;
  targetDataRevision: number;
  totalUniqueRows: number;
  totalChunks: number;
  expectedChunkSequence: number;
  staged: Map<number, StagedRow>;
  totalStagedBytes: number;
}

export function buildSearchableFieldsKeyFromSnapshotFields(
  fields: readonly SearchProjectionField[],
): string {
  const parts = fields.map((f) => {
    let key = f.field;
    if (f.projectionField) key += `:${f.projectionField}`;
    return key;
  });
  return `sf|v|${parts.join(",")}`;
}

/**
 * Build a bounded source signature from the monotonic version supplied
 * by the main thread. O(1) — no per-index string allocation.
 */
export function buildSourceSignature(sourceVersion: number): string {
  return `src|v${sourceVersion}`;
}

function estimateStagedTextBytes(text: string): number {
  return STAGED_ROW_OVERHEAD_BYTES + STAGED_VALUE_OVERHEAD_BYTES + text.length * 2;
}

function toRowText(values: readonly string[]): string {
  return values.join(" ");
}

export class QuickSearchWorkerRuntime {
  private readonly snapshot: QuickSearchSnapshotStore;
  private readonly engine: QuickSearchQueryEngine;
  private readonly post: (response: QuickSearchWorkerResponse) => void;
  private readonly queryChunkSize?: number;

  private snapshotMeta: {
    generation: number;
    searchableFieldsKey: string;
    normalizerSignature: string;
    payloadFormat: SnapshotPayloadFormat;
  } | null = null;

  private pendingRevisions: SnapshotRevisionPair | null = null;
  private appliedRevisions: SnapshotRevisionPair | null = null;
  private activePatch: ActivePatch | null = null;

  private activeQueryHandle: QuickSearchExecutionHandle | null = null;
  private activeRequestId: number | null = null;

  constructor(
    post: (response: QuickSearchWorkerResponse) => void,
    options?: QuickSearchWorkerRuntimeOptions,
  ) {
    this.post = post;
    this.snapshot = options?.snapshot ?? new QuickSearchSnapshotStore();
    const scheduler = options?.scheduler ?? new CooperativeScheduler();
    this.engine =
      options?.engine ?? new QuickSearchQueryEngine(this.snapshot, scheduler);
    this.queryChunkSize = options?.queryChunkSize;
  }

  getSnapshotStore(): QuickSearchSnapshotStore {
    return this.snapshot;
  }

  getQueryEngine(): QuickSearchQueryEngine {
    return this.engine;
  }

  getActiveRequestId(): number | null {
    return this.activeRequestId;
  }

  /** Test hook — whether an engine execution handle is still retained. */
  hasActiveQueryHandle(): boolean {
    return this.activeQueryHandle !== null;
  }

  /** Test hook — applied revisions after a successful snapshotComplete. */
  getAppliedRevisions(): SnapshotRevisionPair | null {
    return this.appliedRevisions;
  }

  /** Test hook — pending revisions after snapshotStart. */
  getPendingRevisions(): SnapshotRevisionPair | null {
    return this.pendingRevisions;
  }

  /** Test hook — whether a patch transaction is actively staging. */
  isPatching(): boolean {
    return this.activePatch !== null;
  }

  handleMessage(message: QuickSearchWorkerRequest): void {
    switch (message.kind) {
      case "quickSearch:snapshotStart":
        this.handleSnapshotStart(message);
        break;
      case "quickSearch:snapshotChunk":
        this.handleSnapshotChunk(message);
        break;
      case "quickSearch:snapshotComplete":
        this.handleSnapshotComplete(message);
        break;
      case "quickSearch:snapshotPatchStart":
        this.handlePatchStart(message);
        break;
      case "quickSearch:snapshotPatchChunk":
        this.handlePatchChunk(message);
        break;
      case "quickSearch:snapshotPatchComplete":
        this.handlePatchComplete(message);
        break;
      case "quickSearch:query":
        this.handleQuery(message);
        break;
      case "quickSearch:cancel":
        this.handleCancelQuery(message);
        break;
      case "quickSearch:clearSnapshot":
        this.handleClearSnapshot();
        break;
    }
  }

  private handleSnapshotStart(message: SnapshotStartMessage): void {
    this.discardStaging();
    this.cancelActiveQuery();
    this.engine.reset();
    this.appliedRevisions = null;
    this.pendingRevisions = {
      sourceLayoutRevision: message.sourceLayoutRevision,
      searchableDataRevision: message.searchableDataRevision,
    };

    const meta = {
      generation: message.generation,
      searchableFieldsKey: buildSearchableFieldsKeyFromSnapshotFields(message.fields),
      normalizerSignature: message.normalizerSignature,
      payloadFormat: message.payloadFormat,
    };

    if (message.payloadFormat !== "searchable-fields-v1") {
      this.snapshot.clear();
      this.snapshotMeta = meta;
      return;
    }

    this.snapshot.start(message.generation, message.rowCount);
    this.snapshotMeta = meta;
  }

  private handleSnapshotChunk(
    message: Extract<QuickSearchWorkerRequest, { kind: "quickSearch:snapshotChunk" }>,
  ): void {
    if (message.payloadFormat !== "searchable-fields-v1") {
      return;
    }
    this.snapshot.applyChunk(message.generation, message.rows);
  }

  private handleSnapshotComplete(
    message: Extract<QuickSearchWorkerRequest, { kind: "quickSearch:snapshotComplete" }>,
  ): void {
    if (this.snapshotMeta?.generation !== message.generation) return;
    if (this.snapshotMeta.payloadFormat !== "searchable-fields-v1") return;
    if (!this.snapshot.markComplete(message.generation)) return;
    if (this.pendingRevisions === null) return;
    this.appliedRevisions = this.pendingRevisions;
    this.pendingRevisions = null;
    this.post({ kind: "quickSearch:ready", generation: message.generation });
  }

  private handlePatchStart(message: SnapshotPatchStartMessage): void {
    // BUILDING / IDLE: ignore without mutating pending snapshot state.
    if (!this.isReady()) {
      return;
    }

    const applied = this.appliedRevisions!;
    const meta = this.snapshotMeta!;

    if (message.generation !== meta.generation) {
      this.rejectAndDiscard(message.patchId, message.generation, "generation-mismatch");
      return;
    }
    if (message.sourceLayoutRevision !== applied.sourceLayoutRevision) {
      this.rejectAndDiscard(message.patchId, message.generation, "layout-mismatch");
      return;
    }
    if (message.baseDataRevision !== applied.searchableDataRevision) {
      this.rejectAndDiscard(message.patchId, message.generation, "revision-mismatch");
      return;
    }
    if (
      !Number.isInteger(message.targetDataRevision) ||
      message.targetDataRevision <= message.baseDataRevision
    ) {
      this.rejectAndDiscard(message.patchId, message.generation, "revision-mismatch");
      return;
    }
    if (
      !isNonNegativeInteger(message.totalUniqueRows) ||
      !isNonNegativeInteger(message.totalChunks) ||
      message.totalUniqueRows > WORKER_MAX_STAGED_UNIQUE_ROWS ||
      message.totalChunks > WORKER_MAX_TOTAL_CHUNKS
    ) {
      this.rejectAndDiscard(message.patchId, message.generation, "staging-limit");
      return;
    }

    // Valid superseding start discards previous staging.
    this.discardStaging();
    this.cancelActiveQuery();

    this.activePatch = {
      patchId: message.patchId,
      generation: message.generation,
      sourceLayoutRevision: message.sourceLayoutRevision,
      baseDataRevision: message.baseDataRevision,
      targetDataRevision: message.targetDataRevision,
      totalUniqueRows: message.totalUniqueRows,
      totalChunks: message.totalChunks,
      expectedChunkSequence: 0,
      staged: new Map(),
      totalStagedBytes: 0,
    };
  }

  private handlePatchChunk(message: SnapshotPatchChunkMessage): void {
    const patch = this.activePatch;
    if (patch === null) {
      this.postPatchRejected(
        message.patchId,
        message.generation,
        "chunk-sequence-mismatch",
      );
      return;
    }

    // Separate typed checks; discarded staging identifies the active patch.
    if (message.generation !== patch.generation) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "generation-mismatch");
      return;
    }
    if (message.patchId !== patch.patchId) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "chunk-sequence-mismatch");
      return;
    }
    if (message.chunkSequence !== patch.expectedChunkSequence) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "chunk-sequence-mismatch");
      return;
    }
    if (patch.expectedChunkSequence >= patch.totalChunks) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "staging-limit");
      return;
    }

    const validated = this.validateChunkUpdates(patch, message.updates);
    if (validated === null) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "staging-limit");
      return;
    }

    for (const [index, staged] of validated) {
      const previous = patch.staged.get(index);
      if (previous !== undefined) {
        patch.totalStagedBytes -= previous.estimatedBytes;
      }
      patch.staged.set(index, staged);
      patch.totalStagedBytes += staged.estimatedBytes;
    }

    if (
      patch.staged.size > WORKER_MAX_STAGED_UNIQUE_ROWS ||
      patch.totalStagedBytes > WORKER_MAX_STAGED_BYTES ||
      patch.staged.size > patch.totalUniqueRows
    ) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "staging-limit");
      return;
    }

    patch.expectedChunkSequence += 1;
  }

  private handlePatchComplete(message: SnapshotPatchCompleteMessage): void {
    const patch = this.activePatch;
    if (patch === null) {
      this.postPatchRejected(
        message.patchId,
        message.generation,
        "incomplete-staging",
      );
      return;
    }

    if (message.generation !== patch.generation) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "generation-mismatch");
      return;
    }
    if (message.patchId !== patch.patchId) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "chunk-sequence-mismatch");
      return;
    }
    if (message.targetDataRevision !== patch.targetDataRevision) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "revision-mismatch");
      return;
    }
    if (
      message.totalUniqueRows !== patch.totalUniqueRows ||
      message.totalChunks !== patch.totalChunks
    ) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "incomplete-staging");
      return;
    }
    if (
      patch.expectedChunkSequence !== patch.totalChunks ||
      patch.staged.size !== patch.totalUniqueRows
    ) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "incomplete-staging");
      return;
    }

    // Revalidate applied baseline before any mutation.
    const applied = this.appliedRevisions;
    if (applied === null) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "incomplete-staging");
      return;
    }
    if (patch.sourceLayoutRevision !== applied.sourceLayoutRevision) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "layout-mismatch");
      return;
    }
    if (patch.baseDataRevision !== applied.searchableDataRevision) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "revision-mismatch");
      return;
    }
    if (patch.targetDataRevision <= patch.baseDataRevision) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "revision-mismatch");
      return;
    }
    if (this.snapshot.getGeneration() !== patch.generation) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "generation-mismatch");
      return;
    }

    // Atomic commit order (research §7):
    // 1. Cancel active query/index work.
    this.cancelActiveQuery();

    const texts = new Map<number, string>();
    for (const [index, staged] of patch.staged) {
      texts.set(index, staged.text);
    }

    // 2. Atomically commit staged row texts.
    if (!this.snapshot.commitPatch(patch.generation, texts)) {
      this.rejectAndDiscard(patch.patchId, patch.generation, "staging-limit");
      return;
    }

    // 3. Clear reusable query state and retain a compatible immutable base
    // index behind an exact dirty-row overlay. Partial builders are discarded.
    const dirtyRowBytes = new Map<number, number>();
    for (const [index, staged] of patch.staged) {
      dirtyRowBytes.set(index, staged.estimatedBytes);
    }
    this.engine.commitPatch({
      generation: patch.generation,
      sourceLayoutRevision: patch.sourceLayoutRevision,
      searchableFieldsKey: this.snapshotMeta!.searchableFieldsKey,
      normalizerSignature: this.snapshotMeta!.normalizerSignature,
      baseDataRevision: patch.baseDataRevision,
      targetDataRevision: patch.targetDataRevision,
      dirtyRowBytes,
    });

    // 4. Advance applied searchable data revision (reuse validated object).
    applied.searchableDataRevision = patch.targetDataRevision;

    // 5. Clear staging. 6. Accept queries at the new revision (no ack).
    this.activePatch = null;
  }

  private handleQuery(
    message: Extract<QuickSearchWorkerRequest, { kind: "quickSearch:query" }>,
  ): void {
    this.cancelActiveQuery();
    this.activeRequestId = message.requestId;

    if (this.activePatch !== null) {
      this.postTypedError(
        message.requestId,
        "patch-in-progress",
        "A snapshot patch transaction is in progress",
      );
      this.activeRequestId = null;
      return;
    }

    const meta = this.snapshotMeta;
    const applied = this.appliedRevisions;

    if (
      meta === null ||
      applied === null ||
      meta.payloadFormat !== "searchable-fields-v1" ||
      !this.snapshot.isComplete() ||
      this.snapshot.getGeneration() !== meta.generation
    ) {
      this.postTypedError(
        message.requestId,
        "snapshot-unavailable",
        "Snapshot is unavailable, stale, or incomplete",
      );
      this.activeRequestId = null;
      return;
    }

    if (message.generation !== meta.generation) {
      this.postTypedError(
        message.requestId,
        "generation-mismatch",
        "Query generation does not match the applied snapshot",
      );
      this.activeRequestId = null;
      return;
    }

    if (message.sourceLayoutRevision !== applied.sourceLayoutRevision) {
      this.postTypedError(
        message.requestId,
        "layout-mismatch",
        "Query sourceLayoutRevision does not match the applied snapshot",
      );
      this.activeRequestId = null;
      return;
    }

    if (message.searchableDataRevision !== applied.searchableDataRevision) {
      this.postTypedError(
        message.requestId,
        "revision-mismatch",
        "Query searchableDataRevision does not match the applied snapshot",
      );
      this.activeRequestId = null;
      return;
    }

    const requestId = message.requestId;
    const sourceSignature = buildSourceSignature(message.sourceVersion);

    const handle = this.engine.execute(
      {
        normalizedText: message.normalizedText,
        generation: message.generation,
        searchableFieldsKey: meta.searchableFieldsKey,
        normalizerSignature: meta.normalizerSignature,
        configSignature: WORKER_DEFAULT_CONFIG_SIGNATURE,
        sourceSignature,
        sourceIndexes: message.sourceIndexes,
        searchableDataRevision: message.searchableDataRevision,
        sourceLayoutRevision: message.sourceLayoutRevision,
        cacheMode: message.cacheMode,
        chunkSize: this.queryChunkSize,
      },
      (indexes) => {
        if (this.activeRequestId !== requestId) return;
        this.activeRequestId = null;
        this.activeQueryHandle = null;
        const outbound = indexes.slice();
        this.post({ kind: "quickSearch:success", requestId, indexes: outbound });
      },
    );
    if (this.activeRequestId === requestId) {
      this.activeQueryHandle = handle;
    }
  }

  private handleCancelQuery(
    message: Extract<QuickSearchWorkerRequest, { kind: "quickSearch:cancel" }>,
  ): void {
    if (
      message.requestId !== undefined &&
      this.activeRequestId !== null &&
      message.requestId !== this.activeRequestId
    ) {
      return;
    }
    // Cancel must not discard patch staging.
    this.cancelActiveQuery();
  }

  private handleClearSnapshot(): void {
    this.discardStaging();
    this.cancelActiveQuery();
    this.snapshot.clear();
    this.engine.reset();
    this.snapshotMeta = null;
    this.pendingRevisions = null;
    this.appliedRevisions = null;
  }

  private isReady(): boolean {
    return (
      this.appliedRevisions !== null &&
      this.snapshotMeta !== null &&
      this.snapshotMeta.payloadFormat === "searchable-fields-v1" &&
      this.snapshot.isComplete() &&
      this.snapshot.getGeneration() === this.snapshotMeta.generation
    );
  }

  /**
   * Validate an entire chunk before mutating staging. Returns null when
   * any update is invalid or worker limits would be exceeded.
   */
  private validateChunkUpdates(
    patch: ActivePatch,
    updates: readonly SearchableSnapshotRow[],
  ): Map<number, StagedRow> | null {
    const rowCount = this.snapshot.getRowCount();
    const pending = new Map<number, StagedRow>();

    for (const update of updates) {
      const index = update.rowIndex;
      if (!Number.isInteger(index) || index < 0 || index >= rowCount) {
        return null;
      }
      const text = toRowText(update.values);
      const estimatedBytes = estimateStagedTextBytes(text);
      pending.set(index, { text, estimatedBytes });
    }

    let projectedBytes = patch.totalStagedBytes;
    let projectedUnique = patch.staged.size;
    for (const [index, staged] of pending) {
      const existing = patch.staged.get(index);
      if (existing !== undefined) {
        projectedBytes -= existing.estimatedBytes;
      } else {
        projectedUnique += 1;
      }
      projectedBytes += staged.estimatedBytes;
    }

    if (
      projectedUnique > WORKER_MAX_STAGED_UNIQUE_ROWS ||
      projectedBytes > WORKER_MAX_STAGED_BYTES ||
      projectedUnique > patch.totalUniqueRows
    ) {
      return null;
    }

    return pending;
  }

  private discardStaging(): void {
    this.activePatch = null;
  }

  private rejectAndDiscard(
    patchId: number,
    generation: number,
    reason: QuickSearchPatchRejectReason,
  ): void {
    this.discardStaging();
    this.postPatchRejected(patchId, generation, reason);
  }

  private postPatchRejected(
    patchId: number,
    generation: number,
    reason: QuickSearchPatchRejectReason,
  ): void {
    this.post({
      kind: "quickSearch:patchRejected",
      patchId,
      generation,
      reason,
    });
  }

  private cancelActiveQuery(): void {
    this.activeQueryHandle?.cancel();
    this.activeQueryHandle = null;
    this.activeRequestId = null;
  }

  private postTypedError(
    requestId: number,
    code: QuickSearchErrorCode,
    message: string,
  ): void {
    this.post({ kind: "quickSearch:error", requestId, code, message });
  }
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
