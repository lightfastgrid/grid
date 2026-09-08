/**
 * Worker-side quick-search query engine.
 *
 * Consumes the Phase 2 snapshot store and the Phase 3A planner/caches.
 * Execution flow per query:
 *
 *   preempt idle build (if any) → capture building|ready|missing
 *   plan (empty → source cache → full-match ∩ source → lazy → index → scan)
 *   cache hits complete synchronously with zero row-text reads
 *   lazy/index/scan run chunked + cancellable via CooperativeScheduler
 *   completed results feed the source-scoped LRU, the full-match LRU
 *   (full-dataset executions only), and the lazy-narrowing last result
 *
 * Idle index builds are engine-owned, background-priority, and never
 * exposed as partial lookups. Interactive queries preempt them and scan
 * without waiting; a later explicit idle opportunity may republish.
 *
 * Every boundary result is a `Uint32Array` of source row indexes —
 * bitsets and MatchSets never leave this module.
 */

import type {
  CooperativeHandle,
  CooperativeScheduleOptions,
} from "../../../scheduling/CooperativeScheduler";
import { CooperativeScheduler } from "../../../scheduling/CooperativeScheduler";
import type { QuickFilterCacheMode } from "../../../types";

import { BoundedLruMap } from "./boundedLru";
import {
  createMatchSet,
  matchSetContains,
  materializeInSourceOrder,
} from "./matchSet";
import {
  buildFullMatchKey,
  buildSourceResultKey,
  canStoreFullMatchEntry,
} from "./quickSearchCacheKeys";
import type { LazyNarrowingPrevious } from "./quickSearchLazyNarrowing";
import { parseQueryParts, rowTextMatchesParts } from "./quickSearchMatcher";
import type {
  FullMatchCacheEntry,
  QuickSearchCaches,
  QuickSearchIndexState,
  SourceResultCacheEntry,
} from "./quickSearchPlanner";
import { planQuickSearchQuery } from "./quickSearchPlanner";
import type { QuickSearchSnapshotStore } from "./quickSearchSnapshotStore";
import type { QuickSearchTrigramIndex } from "./quickSearchTrigramIndex";
import {
  DEFAULT_COMPACTION_GRAMS_PER_SLICE,
  DEFAULT_COMPACTION_TIME_BUDGET_MS,
  sanitizePositiveInt,
  TrigramIndexBuilder,
  type TrigramPostingsCompaction,
} from "./quickSearchTrigramIndex";

export const DEFAULT_QUERY_CHUNK_SIZE = 10000;
/** Candidate sets covering more of the snapshot than this scan instead. */
export const BROAD_CANDIDATE_RATIO = 0.5;
const DEFAULT_INDEX_INGESTION_TIME_BUDGET_MS = 4;
/** Internal Stage 2B overlay bounds; rebuilding starts only when exceeded. */
const DEFAULT_MAX_OVERLAY_ROWS = 2048;
const DEFAULT_MAX_OVERLAY_ESTIMATED_BYTES = 4 * 1024 * 1024;
const SOURCE_RESULT_CACHE_SIZE = 32;
const FULL_MATCH_CACHE_SIZE = 16;

const IDLE_SCHEDULE_OPTIONS: CooperativeScheduleOptions = {
  priority: "background",
};

export type QuickSearchExecutionPath =
  | "empty"
  | "cached-source-result"
  | "full-match-intersect"
  | "lazy-narrow"
  | "index"
  | "scan";

export interface QuickSearchExecutionMeta {
  path: QuickSearchExecutionPath;
}

/** Worker-internal identity authorizing idle build publication. */
export interface QuickSearchIndexIdentity {
  generation: number;
  sourceLayoutRevision: number;
  searchableDataRevision: number;
  searchableFieldsKey: string;
  normalizerSignature: string;
}

export interface QuickSearchExecuteRequest {
  /** Already normalized through the shared normalizer. */
  normalizedText: string;
  generation: number;
  searchableFieldsKey: string;
  normalizerSignature: string;
  configSignature: string;
  /**
   * O(1) source identity string derived from the monotonic
   * `filteredOrderVersion` counter on the main thread.
   */
  sourceSignature: string;
  /** Upstream filtered order; null = full dataset. */
  sourceIndexes: Uint32Array | null;
  /** Searchable-data revision — included in cache / lazy-narrow identity. */
  searchableDataRevision: number;
  /** Source layout revision — included in index identity. */
  sourceLayoutRevision: number;
  /**
   * `false` is a hard cache-disable switch for reusable worker query state.
   * `true`, `"auto"`, and `undefined` use the default layered caches.
   */
  cacheMode?: QuickFilterCacheMode;
  chunkSize?: number;
}

export interface QuickSearchIdleIndexBuildOptions {
  chunkSize?: number;
  /** Grams compacted per background slice (internal / test override). */
  compactionGramsPerSlice?: number;
}

export interface QuickSearchQueryEngineOptions {
  maxRows?: number;
  maxEstimatedBytes?: number;
  /** Worker-internal deterministic ingestion controls. */
  ingestionTimeBudgetMs?: number;
  now?: () => number;
}

export interface QuickSearchExecutionHandle {
  cancel(): void;
}

interface ExecutionState {
  cancelled: boolean;
  pending: CooperativeHandle | null;
}

interface PublishedIndex {
  index: QuickSearchTrigramIndex;
  identity: QuickSearchIndexIdentity;
}

interface DirtyOverlay {
  /** Current text-byte estimate, replacing the prior value on re-edit. */
  rows: Map<number, number>;
  totalEstimatedBytes: number;
  /** Complete patch coverage from the published base through this revision. */
  coveredDataRevision: number;
  /** Ascending identity-source view, invalidated only when overlay changes. */
  sortedIndexes: Uint32Array | null;
}

export interface QuickSearchCommittedPatch {
  generation: number;
  sourceLayoutRevision: number;
  searchableFieldsKey: string;
  normalizerSignature: string;
  baseDataRevision: number;
  targetDataRevision: number;
  dirtyRowBytes: ReadonlyMap<number, number>;
}

interface IdleIndexBuild {
  token: number;
  identity: QuickSearchIndexIdentity;
  builder: TrigramIndexBuilder;
  compaction: TrigramPostingsCompaction | null;
  phase: "ingest" | "compact";
  cursor: number;
  rowCount: number;
  chunkSize: number;
  compactionGramsPerSlice: number;
  pending: CooperativeHandle | null;
  cancelled: boolean;
}

interface IngestionSliceOptions {
  cursor: number;
  rowCount: number;
  rowCap: number;
  timeBudgetMs: number;
  now: () => number;
  isCancelled: () => boolean;
  ingestRow: (rowIndex: number) => void;
}

interface IngestionSliceResult {
  cursor: number;
  cancelled: boolean;
}

function identityIndexes(rowCount: number): Uint32Array {
  const out = new Uint32Array(rowCount);
  for (let i = 0; i < rowCount; i++) out[i] = i;
  return out;
}

function isCacheEnabled(mode: QuickFilterCacheMode | undefined): boolean {
  return mode !== false;
}

function defaultMonotonicNow(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function sanitizePositiveFinite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/** Shared idle/interactive ingestion discipline with guaranteed progress. */
function runIngestionSlice(options: IngestionSliceOptions): IngestionSliceResult {
  let cursor = options.cursor;
  let processed = 0;
  const startedAt = options.now();

  while (cursor < options.rowCount && processed < options.rowCap) {
    if (options.isCancelled()) {
      return { cursor, cancelled: true };
    }
    if (
      processed > 0 &&
      options.now() - startedAt >= options.timeBudgetMs
    ) {
      break;
    }
    options.ingestRow(cursor);
    cursor++;
    processed++;
  }

  return { cursor, cancelled: options.isCancelled() };
}

function identitiesEqual(
  a: QuickSearchIndexIdentity,
  b: QuickSearchIndexIdentity,
): boolean {
  return (
    a.generation === b.generation &&
    a.sourceLayoutRevision === b.sourceLayoutRevision &&
    a.searchableDataRevision === b.searchableDataRevision &&
    a.searchableFieldsKey === b.searchableFieldsKey &&
    a.normalizerSignature === b.normalizerSignature
  );
}

function structuralIdentityEqual(
  a: QuickSearchIndexIdentity,
  b: Pick<
    QuickSearchIndexIdentity,
    | "generation"
    | "sourceLayoutRevision"
    | "searchableFieldsKey"
    | "normalizerSignature"
  >,
): boolean {
  return (
    a.generation === b.generation &&
    a.sourceLayoutRevision === b.sourceLayoutRevision &&
    a.searchableFieldsKey === b.searchableFieldsKey &&
    a.normalizerSignature === b.normalizerSignature
  );
}

function identityFromRequest(
  request: QuickSearchExecuteRequest,
): QuickSearchIndexIdentity {
  return {
    generation: request.generation,
    sourceLayoutRevision: request.sourceLayoutRevision,
    searchableDataRevision: request.searchableDataRevision,
    searchableFieldsKey: request.searchableFieldsKey,
    normalizerSignature: request.normalizerSignature,
  };
}

export class QuickSearchQueryEngine {
  private readonly snapshot: QuickSearchSnapshotStore;
  private readonly scheduler: CooperativeScheduler;
  private readonly maxOverlayRows: number;
  private readonly maxOverlayEstimatedBytes: number;
  private readonly ingestionTimeBudgetMs: number;
  private readonly now: () => number;
  private readonly caches: QuickSearchCaches = {
    sourceResult: new BoundedLruMap<string, SourceResultCacheEntry>(
      SOURCE_RESULT_CACHE_SIZE,
    ),
    fullMatch: new BoundedLruMap<string, FullMatchCacheEntry>(FULL_MATCH_CACHE_SIZE),
    lastQuery: null,
  };
  private published: PublishedIndex | null = null;
  private overlay: DirtyOverlay | null = null;
  private idleBuild: IdleIndexBuild | null = null;
  private idleBuildTokenCounter = 0;

  constructor(
    snapshot: QuickSearchSnapshotStore,
    scheduler?: CooperativeScheduler,
    options?: QuickSearchQueryEngineOptions,
  ) {
    this.snapshot = snapshot;
    this.scheduler = scheduler ?? new CooperativeScheduler();
    this.maxOverlayRows = sanitizePositiveInt(
      options?.maxRows,
      DEFAULT_MAX_OVERLAY_ROWS,
    );
    this.maxOverlayEstimatedBytes = sanitizePositiveInt(
      options?.maxEstimatedBytes,
      DEFAULT_MAX_OVERLAY_ESTIMATED_BYTES,
    );
    this.ingestionTimeBudgetMs = sanitizePositiveFinite(
      options?.ingestionTimeBudgetMs,
      DEFAULT_INDEX_INGESTION_TIME_BUDGET_MS,
    );
    this.now = options?.now ?? defaultMonotonicNow;
  }

  /** Drop caches, published index, and any idle build — snapshot rebuild. */
  reset(): void {
    this.cancelIdleBuild();
    this.caches.sourceResult.clear();
    this.caches.fullMatch.clear();
    this.caches.lastQuery = null;
    this.published = null;
    this.overlay = null;
  }

  /** Patch commit: retain a compatible immutable base and extend its overlay. */
  commitPatch(patch: QuickSearchCommittedPatch): void {
    this.cancelIdleBuild();
    this.clearQueryCaches();

    const published = this.published;
    const coveredRevision =
      this.overlay?.coveredDataRevision ?? published?.identity.searchableDataRevision;
    if (
      published === null ||
      coveredRevision !== patch.baseDataRevision ||
      !structuralIdentityEqual(published.identity, patch)
    ) {
      this.published = null;
      this.overlay = null;
      return;
    }

    const overlay = this.overlay ?? {
      rows: new Map<number, number>(),
      totalEstimatedBytes: 0,
      coveredDataRevision: patch.baseDataRevision,
      sortedIndexes: null,
    };
    for (const [sourceIndex, estimatedBytes] of patch.dirtyRowBytes) {
      overlay.totalEstimatedBytes -= overlay.rows.get(sourceIndex) ?? 0;
      overlay.rows.set(sourceIndex, estimatedBytes);
      overlay.totalEstimatedBytes += estimatedBytes;
    }
    overlay.coveredDataRevision = patch.targetDataRevision;
    overlay.sortedIndexes = null;
    this.overlay = overlay;

    if (
      overlay.rows.size > this.maxOverlayRows ||
      overlay.totalEstimatedBytes > this.maxOverlayEstimatedBytes
    ) {
      this.scheduleIdleIndexBuild({
        generation: patch.generation,
        sourceLayoutRevision: patch.sourceLayoutRevision,
        searchableDataRevision: patch.targetDataRevision,
        searchableFieldsKey: patch.searchableFieldsKey,
        normalizerSignature: patch.normalizerSignature,
      });
    }
  }

  /**
   * Schedule a cancellable background index build for a stable idle
   * opportunity. Worker-internal only — not a public Grid API.
   *
   * The first chunk is always asynchronous; continuations use background
   * priority. Matching in-flight builds dedupe; a published matching index
   * is a no-op. Stale/different builds are cancelled before replacement.
   */
  scheduleIdleIndexBuild(
    identity: QuickSearchIndexIdentity,
    options?: QuickSearchIdleIndexBuildOptions,
  ): QuickSearchExecutionHandle {
    const noop: QuickSearchExecutionHandle = { cancel() {} };

    if (
      this.published !== null &&
      identitiesEqual(this.published.identity, identity)
    ) {
      return noop;
    }

    if (
      this.idleBuild !== null &&
      !this.idleBuild.cancelled &&
      identitiesEqual(this.idleBuild.identity, identity)
    ) {
      const active = this.idleBuild;
      return {
        cancel: () => {
          if (this.idleBuild === active) {
            this.cancelIdleBuild();
          }
        },
      };
    }

    this.cancelIdleBuild();

    if (
      !this.snapshot.isComplete() ||
      identity.generation !== this.snapshot.getGeneration()
    ) {
      return noop;
    }

    const rowCount = this.snapshot.getRowCount();
    const chunkSize = sanitizePositiveInt(
      options?.chunkSize,
      DEFAULT_QUERY_CHUNK_SIZE,
    );
    const compactionGramsPerSlice = sanitizePositiveInt(
      options?.compactionGramsPerSlice,
      DEFAULT_COMPACTION_GRAMS_PER_SLICE,
    );
    const token = ++this.idleBuildTokenCounter;
    const build: IdleIndexBuild = {
      token,
      identity,
      builder: new TrigramIndexBuilder(rowCount),
      compaction: null,
      phase: "ingest",
      cursor: 0,
      rowCount,
      chunkSize,
      compactionGramsPerSlice,
      pending: null,
      cancelled: false,
    };
    this.idleBuild = build;

    // Empty snapshot: still schedule so publication stays async.
    build.pending = this.scheduler.schedule(() => {
      this.runIdleBuildChunk(build);
    }, IDLE_SCHEDULE_OPTIONS);

    return {
      cancel: () => {
        if (this.idleBuild === build) {
          this.cancelIdleBuild();
        }
      },
    };
  }

  execute(
    request: QuickSearchExecuteRequest,
    onComplete: (indexes: Uint32Array, meta: QuickSearchExecutionMeta) => void,
  ): QuickSearchExecutionHandle {
    const state: ExecutionState = { cancelled: false, pending: null };
    const handle: QuickSearchExecutionHandle = {
      cancel: () => {
        state.cancelled = true;
        state.pending?.cancel();
        state.pending = null;
      },
    };
    const chunkSize = sanitizePositiveInt(
      request.chunkSize,
      DEFAULT_QUERY_CHUNK_SIZE,
    );
    const cacheEnabled = isCacheEnabled(request.cacheMode);

    // Stale-generation / incomplete-snapshot guard: executing would scan
    // the wrong snapshot and poison caches under stale keys. No work, no
    // completion — the integration layer reissues after snapshot sync.
    if (
      request.generation !== this.snapshot.getGeneration() ||
      !this.snapshot.isComplete()
    ) {
      return handle;
    }

    const requestIdentity = identityFromRequest(request);
    const indexState = this.captureIndexStateAndPreemptIdle(requestIdentity);

    const snapshotRowCount = this.snapshot.getRowCount();
    const sourceRowCount = request.sourceIndexes?.length ?? snapshotRowCount;

    const plan = cacheEnabled
      ? planQuickSearchQuery({
          normalizedText: request.normalizedText,
          generation: request.generation,
          searchableFieldsKey: request.searchableFieldsKey,
          normalizerSignature: request.normalizerSignature,
          configSignature: request.configSignature,
          sourceSignature: request.sourceSignature,
          sourceIndexes: request.sourceIndexes,
          searchableDataRevision: request.searchableDataRevision,
          caches: this.caches,
          indexState,
          snapshotRowCount,
          sourceRowCount,
        })
      : ({
          kind: request.normalizedText.trim().length === 0 ? "empty" : "scan",
        } as const);

    const finish = (indexes: Uint32Array, path: QuickSearchExecutionPath): void => {
      if (state.cancelled) return;
      if (cacheEnabled) {
        this.storeCompletedResult(request, indexes);
      }
      onComplete(indexes, { path });
    };

    switch (plan.kind) {
      case "empty": {
        const passthrough =
          request.sourceIndexes?.slice() ?? identityIndexes(this.snapshot.getRowCount());
        onComplete(passthrough, { path: "empty" });
        return handle;
      }

      case "cached-source-result": {
        this.caches.lastQuery = this.toLastQuery(request, plan.indexes);
        onComplete(plan.indexes, { path: "cached-source-result" });
        return handle;
      }

      case "full-match-intersect": {
        if (cacheEnabled) {
          this.caches.sourceResult.set(this.sourceKey(request), { indexes: plan.indexes });
          this.caches.lastQuery = this.toLastQuery(request, plan.indexes);
        }
        onComplete(plan.indexes, { path: "full-match-intersect" });
        return handle;
      }

      case "lazy-narrow": {
        const parts = parseQueryParts(request.normalizedText);
        const candidates = plan.candidateIndexes;
        this.runChunkedMatch(
          candidates.length,
          (i) => candidates[i]!,
          parts,
          chunkSize,
          state,
          (matches) => finish(Uint32Array.from(matches), "lazy-narrow"),
        );
        return handle;
      }

      case "index-lookup": {
        this.runIndexPath(
          request,
          requestIdentity,
          plan.requiresBuild,
          chunkSize,
          state,
          finish,
        );
        return handle;
      }

      case "scan": {
        this.runScanPath(request, chunkSize, state, finish);
        return handle;
      }
    }
  }

  // ── Index ownership ─────────────────────────────────────────────────

  /**
   * Interactive arrival cancels any idle build. If that build matched the
   * request identity, the planner sees "building" so policy routes to scan
   * and never waits on or reuses the discarded partial builder.
   */
  private captureIndexStateAndPreemptIdle(
    requestIdentity: QuickSearchIndexIdentity,
  ): QuickSearchIndexState {
    const idle = this.idleBuild;
    const matchedIdle =
      idle !== null &&
      !idle.cancelled &&
      identitiesEqual(idle.identity, requestIdentity);

    if (idle !== null) {
      this.cancelIdleBuild();
    }

    if (matchedIdle) {
      // A replacement build never hides the still-usable immutable base plus
      // complete overlay. Only a cold build preempts to building/scan.
      return this.getUsablePublished(requestIdentity) !== null
        ? "ready"
        : "building";
    }
    if (this.getUsablePublished(requestIdentity) !== null) {
      return "ready";
    }
    return "missing";
  }

  private cancelIdleBuild(): void {
    const build = this.idleBuild;
    if (build === null) return;
    build.cancelled = true;
    build.pending?.cancel();
    build.pending = null;
    build.compaction?.discard();
    build.compaction = null;
    this.idleBuild = null;
  }

  private clearQueryCaches(): void {
    this.caches.sourceResult.clear();
    this.caches.fullMatch.clear();
    this.caches.lastQuery = null;
  }

  private getUsablePublished(
    identity: QuickSearchIndexIdentity,
  ): PublishedIndex | null {
    const published = this.published;
    if (published === null || !structuralIdentityEqual(published.identity, identity)) {
      return null;
    }
    const coveredRevision =
      this.overlay?.coveredDataRevision ?? published.identity.searchableDataRevision;
    return coveredRevision === identity.searchableDataRevision ? published : null;
  }

  private publishIndex(
    index: QuickSearchTrigramIndex,
    identity: QuickSearchIndexIdentity,
  ): void {
    this.published = { index, identity };
    this.overlay = null;
  }

  private isIdleBuildCurrent(build: IdleIndexBuild): boolean {
    if (build.cancelled) return false;
    if (this.idleBuild !== build) return false;
    if (build.token !== this.idleBuild.token) return false;
    if (!this.snapshot.isComplete()) return false;
    if (build.identity.generation !== this.snapshot.getGeneration()) return false;
    return true;
  }

  private scheduleIdleContinuation(build: IdleIndexBuild): void {
    if (!this.isIdleBuildCurrent(build)) return;
    build.pending = this.scheduler.schedule(() => {
      this.runIdleBuildChunk(build);
    }, IDLE_SCHEDULE_OPTIONS);
  }

  private runIdleBuildChunk(build: IdleIndexBuild): void {
    if (!this.isIdleBuildCurrent(build)) return;
    build.pending = null;

    if (build.phase === "ingest") {
      this.runIdleIngestSlice(build);
      return;
    }
    this.runIdleCompactSlice(build);
  }

  private runIdleIngestSlice(build: IdleIndexBuild): void {
    if (!this.isIdleBuildCurrent(build)) return;

    if (build.rowCount === 0 || build.cursor >= build.rowCount) {
      build.compaction = build.builder.beginCompaction();
      build.phase = "compact";
      this.runIdleCompactSlice(build);
      return;
    }

    const slice = runIngestionSlice({
      cursor: build.cursor,
      rowCount: build.rowCount,
      rowCap: build.chunkSize,
      timeBudgetMs: this.ingestionTimeBudgetMs,
      now: this.now,
      isCancelled: () => !this.isIdleBuildCurrent(build),
      ingestRow: (rowIndex) => {
        build.builder.addRow(rowIndex, this.snapshot.getRowText(rowIndex));
      },
    });
    build.cursor = slice.cursor;

    if (slice.cancelled || !this.isIdleBuildCurrent(build)) return;

    if (build.cursor >= build.rowCount) {
      build.compaction = build.builder.beginCompaction();
      build.phase = "compact";
      this.scheduleIdleContinuation(build);
      return;
    }

    this.scheduleIdleContinuation(build);
  }

  private runIdleCompactSlice(build: IdleIndexBuild): void {
    if (!this.isIdleBuildCurrent(build)) return;
    const compaction = build.compaction;
    if (compaction === null) return;

    const result = compaction.compactNext({
      maxGrams: build.compactionGramsPerSlice,
      timeBudgetMs: DEFAULT_COMPACTION_TIME_BUDGET_MS,
      isCancelled: () => !this.isIdleBuildCurrent(build),
    });

    if (!this.isIdleBuildCurrent(build)) {
      compaction.discard();
      return;
    }

    if (!result.done) {
      this.scheduleIdleContinuation(build);
      return;
    }

    const index = compaction.takeIndex();
    if (!this.isIdleBuildCurrent(build)) return;
    this.publishIndex(index, build.identity);
    this.idleBuild = null;
  }

  // ── Execution paths ─────────────────────────────────────────────────

  private runIndexPath(
    request: QuickSearchExecuteRequest,
    requestIdentity: QuickSearchIndexIdentity,
    requiresBuild: boolean,
    chunkSize: number,
    state: ExecutionState,
    finish: (indexes: Uint32Array, path: QuickSearchExecutionPath) => void,
  ): void {
    const parts = parseQueryParts(request.normalizedText);

    const runWithIndex = (index: QuickSearchTrigramIndex): void => {
      const candidates = index.getCandidatesForParts(parts);
      const rowCount = this.snapshot.getRowCount();

      if (rowCount > 0 && candidates.cardinality / rowCount > BROAD_CANDIDATE_RATIO) {
        this.runScanPath(request, chunkSize, state, finish);
        return;
      }

      const overlay = this.overlay;
      const ordered =
        overlay === null || overlay.rows.size === 0
          ? materializeInSourceOrder(candidates, request.sourceIndexes)
          : this.materializeBaseAndDirtyInSourceOrder(
              candidates,
              overlay,
              request.sourceIndexes,
              rowCount,
            );
      this.runChunkedMatch(
        ordered.length,
        (i) => ordered[i]!,
        parts,
        chunkSize,
        state,
        (matches) => finish(Uint32Array.from(matches), "index"),
      );
    };

    if (!requiresBuild) {
      const published = this.getUsablePublished(requestIdentity);
      if (published === null) {
        this.runScanPath(request, chunkSize, state, finish);
        return;
      }
      runWithIndex(published.index);
      return;
    }

    // Missing + broad: interactive lazy chunked build — never reuses idle.
    this.ensureIndexInteractive(requestIdentity, chunkSize, state, runWithIndex);
  }

  /**
   * `sourceIndexes` is the upstream ordering authority. Filtered sources use
   * one traversal and include each dirty row or clean base candidate once.
   * Identity sources merge ascending base candidates with an overlay-sized
   * cached sorted dirty view.
   */
  private materializeBaseAndDirtyInSourceOrder(
    candidates: ReturnType<QuickSearchTrigramIndex["getCandidatesForParts"]>,
    overlay: DirtyOverlay,
    sourceIndexes: Uint32Array | null,
    rowCount: number,
  ): Uint32Array {
    if (sourceIndexes !== null) {
      const ordered: number[] = [];
      for (let ordinal = 0; ordinal < sourceIndexes.length; ordinal++) {
        const sourceIndex = sourceIndexes[ordinal]!;
        if (
          overlay.rows.has(sourceIndex) ||
          matchSetContains(candidates, sourceIndex)
        ) {
          ordered.push(sourceIndex);
        }
      }
      return Uint32Array.from(ordered);
    }

    const base = materializeInSourceOrder(candidates, null);
    const cleanBase: number[] = [];
    for (let i = 0; i < base.length; i++) {
      const sourceIndex = base[i]!;
      if (!overlay.rows.has(sourceIndex)) cleanBase.push(sourceIndex);
    }

    if (overlay.sortedIndexes === null) {
      const dirty = [...overlay.rows.keys()].filter(
        (sourceIndex) => sourceIndex >= 0 && sourceIndex < rowCount,
      );
      dirty.sort((a, b) => a - b);
      overlay.sortedIndexes = Uint32Array.from(dirty);
    }
    const dirty = overlay.sortedIndexes;

    const merged: number[] = [];
    let baseCursor = 0;
    let dirtyCursor = 0;
    while (baseCursor < cleanBase.length || dirtyCursor < dirty.length) {
      if (baseCursor >= cleanBase.length) {
        merged.push(dirty[dirtyCursor++]!);
        continue;
      }
      if (dirtyCursor >= dirty.length) {
        merged.push(cleanBase[baseCursor++]!);
        continue;
      }
      const baseIndex = cleanBase[baseCursor]!;
      const dirtyIndex = dirty[dirtyCursor]!;
      if (baseIndex < dirtyIndex) {
        merged.push(baseIndex);
        baseCursor++;
      } else {
        merged.push(dirtyIndex);
        dirtyCursor++;
      }
    }
    return Uint32Array.from(merged);
  }

  private runScanPath(
    request: QuickSearchExecuteRequest,
    chunkSize: number,
    state: ExecutionState,
    finish: (indexes: Uint32Array, path: QuickSearchExecutionPath) => void,
  ): void {
    const parts = parseQueryParts(request.normalizedText);
    const src = request.sourceIndexes;
    const total = src !== null ? src.length : this.snapshot.getRowCount();
    const idxAt = src !== null ? (i: number) => src[i]! : (i: number) => i;
    this.runChunkedMatch(total, idxAt, parts, chunkSize, state, (matches) =>
      finish(Uint32Array.from(matches), "scan"),
    );
  }

  /**
   * Chunked, cancellable matcher pass over an ordered candidate space.
   * The FIRST chunk runs synchronously — acceptable off-main-thread.
   * Continuations use default (user-visible) priority.
   */
  private runChunkedMatch(
    total: number,
    idxAt: (i: number) => number,
    parts: string[],
    chunkSize: number,
    state: ExecutionState,
    done: (matches: number[]) => void,
  ): void {
    const matches: number[] = [];
    let cursor = 0;
    const step = (): void => {
      if (state.cancelled) return;
      const end = Math.min(cursor + chunkSize, total);
      for (let i = cursor; i < end; i++) {
        const rowIndex = idxAt(i);
        if (rowTextMatchesParts(this.snapshot.getRowText(rowIndex), parts)) {
          matches.push(rowIndex);
        }
      }
      cursor = end;
      if (cursor >= total) {
        state.pending = null;
        done(matches);
        return;
      }
      state.pending = this.scheduler.schedule(step);
    };
    step();
  }

  /**
   * Interactive missing-index build owned by the query ExecutionState.
   * Ingest and compaction are separate phased steps — never synchronous
   * builder.finish(). Does not reuse a preempted idle builder.
   */
  private ensureIndexInteractive(
    identity: QuickSearchIndexIdentity,
    chunkSize: number,
    state: ExecutionState,
    done: (index: QuickSearchTrigramIndex) => void,
  ): void {
    if (
      this.published !== null &&
      identitiesEqual(this.published.identity, identity)
    ) {
      done(this.published.index);
      return;
    }
    const rowCount = this.snapshot.getRowCount();
    const builder = new TrigramIndexBuilder(rowCount);
    let cursor = 0;
    let compaction: TrigramPostingsCompaction | null = null;

    const discardCompaction = (): void => {
      compaction?.discard();
      compaction = null;
    };

    const compactStep = (): void => {
      const executionCancelled = (): boolean => state.cancelled;

      if (executionCancelled()) {
        discardCompaction();
        return;
      }
      if (compaction === null) return;

      const result = compaction.compactNext({
        maxGrams: DEFAULT_COMPACTION_GRAMS_PER_SLICE,
        timeBudgetMs: DEFAULT_COMPACTION_TIME_BUDGET_MS,
        isCancelled: executionCancelled,
      });

      if (executionCancelled()) {
        discardCompaction();
        return;
      }

      if (!result.done) {
        state.pending = this.scheduler.schedule(compactStep);
        return;
      }

      state.pending = null;
      const index = compaction.takeIndex();
      compaction = null;
      if (executionCancelled()) return;
      this.publishIndex(index, identity);
      done(index);
    };

    const ingestStep = (): void => {
      if (state.cancelled) {
        discardCompaction();
        return;
      }

      if (rowCount === 0 || cursor >= rowCount) {
        compaction = builder.beginCompaction();
        compactStep();
        return;
      }

      const slice = runIngestionSlice({
        cursor,
        rowCount,
        rowCap: chunkSize,
        timeBudgetMs: this.ingestionTimeBudgetMs,
        now: this.now,
        isCancelled: () => state.cancelled,
        ingestRow: (rowIndex) => {
          builder.addRow(rowIndex, this.snapshot.getRowText(rowIndex));
        },
      });
      cursor = slice.cursor;

      if (slice.cancelled) {
        discardCompaction();
        return;
      }

      if (cursor >= rowCount) {
        compaction = builder.beginCompaction();
        // Yield before compaction so cancel can preempt between phases.
        state.pending = this.scheduler.schedule(compactStep);
        return;
      }

      state.pending = this.scheduler.schedule(ingestStep);
    };

    ingestStep();
  }

  // ── Cache writes ────────────────────────────────────────────────────

  private storeCompletedResult(
    request: QuickSearchExecuteRequest,
    indexes: Uint32Array,
  ): void {
    this.caches.sourceResult.set(this.sourceKey(request), { indexes });
    if (canStoreFullMatchEntry(request.sourceIndexes)) {
      this.caches.fullMatch.set(this.fullKey(request), {
        matchSet: createMatchSet(indexes, this.snapshot.getRowCount()),
      });
    }
    this.caches.lastQuery = this.toLastQuery(request, indexes);
  }

  private toLastQuery(
    request: QuickSearchExecuteRequest,
    indexes: Uint32Array,
  ): LazyNarrowingPrevious {
    return {
      generation: request.generation,
      searchableFieldsKey: request.searchableFieldsKey,
      normalizerSignature: request.normalizerSignature,
      sourceSignature: request.sourceSignature,
      configSignature: request.configSignature,
      normalizedText: request.normalizedText,
      searchableDataRevision: request.searchableDataRevision,
      indexes,
    };
  }

  private sourceKey(request: QuickSearchExecuteRequest): string {
    return buildSourceResultKey({
      generation: request.generation,
      searchableFieldsKey: request.searchableFieldsKey,
      normalizerSignature: request.normalizerSignature,
      sourceSignature: request.sourceSignature,
      configSignature: request.configSignature,
      normalizedText: request.normalizedText,
      searchableDataRevision: request.searchableDataRevision,
    });
  }

  private fullKey(request: QuickSearchExecuteRequest): string {
    return buildFullMatchKey({
      generation: request.generation,
      searchableFieldsKey: request.searchableFieldsKey,
      normalizerSignature: request.normalizerSignature,
      configSignature: request.configSignature,
      normalizedText: request.normalizedText,
      searchableDataRevision: request.searchableDataRevision,
    });
  }
}
