/**
 * Pure query planner scaffolding for quick-search execution.
 *
 * Encodes the mandatory lookup order (doc: "Cache Strategy"):
 *
 *   1. empty query            → passthrough/clear
 *   2. source-scoped result   → exact completed row order, zero work
 *   3. full-match cache       → intersect with current source
 *   4. safe lazy narrowing    → previous result as candidates (verify!)
 *   5. index/scan policy      → ready lookup, justified build, or scan
 *
 * The planner DECIDES; it does not execute. Real index lookup, chunked
 * scanning, and verification are wired in the query engine. Everything
 * here is pure and worker-safe.
 */

import type { BoundedLruMap } from "./boundedLru";
import type { MatchSet } from "./matchSet";
import { materializeInSourceOrder } from "./matchSet";
import {
  buildFullMatchKey,
  buildSourceResultKey,
} from "./quickSearchCacheKeys";
import type { LazyNarrowingPrevious } from "./quickSearchLazyNarrowing";
import { canNarrowFromPrevious } from "./quickSearchLazyNarrowing";

// ── Cache entry shapes ──────────────────────────────────────────────

export interface SourceResultCacheEntry {
  /** Final row order for the exact snapshot/source/config/query. */
  indexes: Uint32Array;
}

export interface FullMatchCacheEntry {
  /** All-rows match set; source-independent. Internal representation. */
  matchSet: MatchSet;
}

export interface QuickSearchCaches {
  sourceResult: BoundedLruMap<string, SourceResultCacheEntry>;
  fullMatch: BoundedLruMap<string, FullMatchCacheEntry>;
  lastQuery: LazyNarrowingPrevious | null;
}

// ── Index / source policy inputs ────────────────────────────────────

/** Worker-internal published-index lifecycle (Stage 1L-A: missing|ready only). */
export type QuickSearchIndexState = "missing" | "building" | "ready";

/**
 * Selective-source bounds — internal constants, not public configuration.
 * Both must hold for a source to be treated as selective.
 */
const SELECTIVE_SOURCE_RATIO_MAX = 0.05;
const SELECTIVE_SOURCE_ABSOLUTE_MAX = 2048;

/** Minimum query-part length for the trigram candidate path. */
const MIN_INDEXED_PART_LENGTH = 3;

// ── Plan input / output ─────────────────────────────────────────────

export interface QuickSearchPlanInput {
  /** Already normalized through the shared normalizer. */
  normalizedText: string;
  generation: number;
  searchableFieldsKey: string;
  normalizerSignature: string;
  configSignature: string;
  /** Signature of the upstream filtered source order. */
  sourceSignature: string;
  /** Upstream filtered order; null = full dataset in source order. */
  sourceIndexes: Uint32Array | null;
  searchableDataRevision: number;
  caches: QuickSearchCaches;
  /** Real published-index lifecycle for this snapshot. */
  indexState: QuickSearchIndexState;
  /** Snapshot row count (identity source when sourceIndexes is null). */
  snapshotRowCount: number;
  /**
   * Effective source size for selectivity:
   * `sourceIndexes?.length ?? snapshotRowCount`.
   */
  sourceRowCount: number;
}

export type QuickSearchPlan =
  | { kind: "empty" }
  | { kind: "cached-source-result"; indexes: Uint32Array }
  | { kind: "full-match-intersect"; indexes: Uint32Array }
  | {
      kind: "lazy-narrow";
      /** Candidates only — execution MUST verify against the matcher. */
      candidateIndexes: Uint32Array;
      requiresVerification: true;
    }
  | { kind: "index-lookup"; requiresBuild: boolean }
  | { kind: "scan" };

function allPartsIndexable(normalizedText: string): boolean {
  const parts = normalizedText.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  return parts.every((p) => p.length >= MIN_INDEXED_PART_LENGTH);
}

/**
 * True only when both the ratio and absolute caps hold.
 * Empty / zero-row sources are selective (safe scan of nothing).
 */
function isSelectiveSource(
  sourceRowCount: number,
  snapshotRowCount: number,
): boolean {
  if (sourceRowCount <= 0) return true;
  if (sourceRowCount > SELECTIVE_SOURCE_ABSOLUTE_MAX) return false;
  if (snapshotRowCount <= 0) return false;
  return sourceRowCount / snapshotRowCount <= SELECTIVE_SOURCE_RATIO_MAX;
}

export function planQuickSearchQuery(
  input: QuickSearchPlanInput,
): QuickSearchPlan {
  // 1. Empty query — cancel/passthrough; never schedule work.
  if (input.normalizedText.trim().length === 0) {
    return { kind: "empty" };
  }

  // 2. Exact source-scoped completed result. Zero search work on hit.
  const sourceKey = buildSourceResultKey({
    generation: input.generation,
    searchableFieldsKey: input.searchableFieldsKey,
    normalizerSignature: input.normalizerSignature,
    sourceSignature: input.sourceSignature,
    configSignature: input.configSignature,
    normalizedText: input.normalizedText,
    searchableDataRevision: input.searchableDataRevision,
  });
  const sourceHit = input.caches.sourceResult.get(sourceKey);
  if (sourceHit) {
    return { kind: "cached-source-result", indexes: sourceHit.indexes };
  }

  // 3. Filter-independent full match, intersected with current source.
  const fullKey = buildFullMatchKey({
    generation: input.generation,
    searchableFieldsKey: input.searchableFieldsKey,
    normalizerSignature: input.normalizerSignature,
    configSignature: input.configSignature,
    normalizedText: input.normalizedText,
    searchableDataRevision: input.searchableDataRevision,
  });
  const fullHit = input.caches.fullMatch.get(fullKey);
  if (fullHit) {
    return {
      kind: "full-match-intersect",
      indexes: materializeInSourceOrder(fullHit.matchSet, input.sourceIndexes),
    };
  }

  // 4. Safe lazy narrowing for monotonic forward typing.
  const lastQuery = input.caches.lastQuery;
  if (lastQuery !== null && canNarrowFromPrevious(lastQuery, input)) {
    return {
      kind: "lazy-narrow",
      candidateIndexes: lastQuery.indexes,
      requiresVerification: true,
    };
  }

  // 5. Index / scan policy — never starts work; engine honors requiresBuild.
  return planIndexOrScan(input);
}

function planIndexOrScan(input: QuickSearchPlanInput): QuickSearchPlan {
  // In-flight idle builds must not block interactive queries (Stage 1L-B).
  if (input.indexState === "building") {
    return { kind: "scan" };
  }

  // 1–2 character parts are broad; never build or look up for them.
  if (!allPartsIndexable(input.normalizedText)) {
    return { kind: "scan" };
  }

  const selective = isSelectiveSource(
    input.sourceRowCount,
    input.snapshotRowCount,
  );

  if (input.indexState === "ready") {
    // Already-built index is usable for selective and broad sources.
    return { kind: "index-lookup", requiresBuild: false };
  }

  // missing
  if (selective) {
    // Selective filtered sources scan their subset — never justify a build.
    return { kind: "scan" };
  }

  // Broad / full source + indexable query → justified lazy build path.
  return { kind: "index-lookup", requiresBuild: true };
}
