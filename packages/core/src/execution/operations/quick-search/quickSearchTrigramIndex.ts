/**
 * Worker-owned trigram candidate index.
 *
 * Postings map each trigram to a MatchSet (sparse/bitset by density).
 * Candidate lookup intersects postings smallest-first. Candidates are
 * NEVER final results — trigram overlap admits false positives (row
 * "ABC BCD" has both trigrams of query "ABCD" without the substring),
 * so callers must verify candidates with the real matcher.
 *
 * Build pipeline:
 *   1. Row ingestion into mutable number[] postings (chunked by the engine)
 *   2. Incremental compaction into MatchSets (chunked + cancellable)
 *   3. O(1) publication of the finished immutable index
 */

import type { MatchSet } from "./matchSet";
import {
  createMatchSet,
  createSparseSet,
  DEFAULT_BITSET_DENSITY_THRESHOLD,
  intersectMatchSets,
} from "./matchSet";

export const TRIGRAM_LENGTH = 3;

/** Posting indexes copied per cooperative slice (internal bound). */
export const DEFAULT_COMPACTION_POSTING_INDEXES_PER_SLICE = 4096;
/** Grams compacted per cooperative slice (internal bound). */
export const DEFAULT_COMPACTION_GRAMS_PER_SLICE = 64;
/** Soft time budget per compaction slice (internal bound). */
export const DEFAULT_COMPACTION_TIME_BUDGET_MS = 4;

/** Unique trigrams of a normalized text. Empty for texts shorter than 3. */
export function extractTrigrams(text: string): string[] {
  if (text.length < TRIGRAM_LENGTH) return [];
  const seen = new Set<string>();
  for (let i = 0; i + TRIGRAM_LENGTH <= text.length; i++) {
    seen.add(text.slice(i, i + TRIGRAM_LENGTH));
  }
  return Array.from(seen);
}

export interface TrigramCompactionSliceOptions {
  /** Positive posting-index cap for this slice. */
  maxPostingIndexes?: number;
  /** Positive gram-count cap for this slice. */
  maxGrams?: number;
  /** Soft cooperative time budget in ms. */
  timeBudgetMs?: number;
  /** Injectable monotonic clock for tests. */
  now?: () => number;
  /** Optional cancel probe checked around each work unit. */
  isCancelled?: () => boolean;
}

export interface TrigramCompactionSliceResult {
  done: boolean;
  /** Number of posting indexes copied this slice. */
  processedIndexes: number;
  /** Number of grams fully completed this slice. */
  processedGrams: number;
}

/**
 * In-progress state for converting one posting list into a MatchSet.
 * Resumes across slices — partial posting is never published.
 */
interface PostingConversionState {
  gram: string;
  list: number[];
  cursor: number;
  isDense: boolean;
  sparseTarget: Uint32Array | null;
  denseWords: Uint32Array | null;
  denseCardinality: number;
}

/**
 * Staged compaction of mutable postings into MatchSets.
 * Partial compact maps are never published; discard() clears everything.
 *
 * Work is bounded by posting indexes per slice, not just gram count —
 * a single high-cardinality posting resumes across multiple slices.
 */
export class TrigramPostingsCompaction {
  private sourcePostings: Map<string, number[]> | null;
  private readonly iterator: Iterator<[string, number[]]>;
  private compact: Map<string, MatchSet> | null = new Map();
  private readonly rowCount: number;
  private doneFlag = false;
  private discarded = false;
  private currentPosting: PostingConversionState | null = null;

  constructor(postings: Map<string, number[]>, rowCount: number) {
    this.sourcePostings = postings;
    this.iterator = postings.entries();
    this.rowCount = rowCount;
  }

  get done(): boolean {
    return this.doneFlag;
  }

  get isDiscarded(): boolean {
    return this.discarded;
  }

  /**
   * Compact up to `maxPostingIndexes` posting entries (bounded by time and
   * gram count). Returns progress metadata. Every non-cancelled incomplete
   * slice processes at least one posting index or one empty posting.
   */
  compactNext(
    options?: TrigramCompactionSliceOptions,
  ): TrigramCompactionSliceResult {
    const noProgress: TrigramCompactionSliceResult = {
      done: false,
      processedIndexes: 0,
      processedGrams: 0,
    };
    if (this.discarded) return noProgress;
    if (this.doneFlag) return { done: true, processedIndexes: 0, processedGrams: 0 };
    if (options?.isCancelled?.()) return noProgress;

    const maxPostingIndexes = sanitizePositiveInt(
      options?.maxPostingIndexes,
      DEFAULT_COMPACTION_POSTING_INDEXES_PER_SLICE,
    );
    const maxGrams = sanitizePositiveInt(
      options?.maxGrams,
      DEFAULT_COMPACTION_GRAMS_PER_SLICE,
    );
    const timeBudgetMs = sanitizePositiveFinite(
      options?.timeBudgetMs,
      DEFAULT_COMPACTION_TIME_BUDGET_MS,
    );
    const now = options?.now ?? portableNow;
    const started = now();
    const compact = this.compact;
    if (compact === null) return noProgress;

    let processedIndexes = 0;
    let processedGrams = 0;

    while (processedGrams < maxGrams && processedIndexes < maxPostingIndexes) {
      if (options?.isCancelled?.()) break;
      // Honor time budget only after at least one unit of progress.
      if (processedIndexes > 0 && now() - started >= timeBudgetMs) break;

      // Resume or start a posting conversion.
      if (this.currentPosting === null) {
        const next = this.iterator.next();
        if (next.done) {
          this.sourcePostings?.clear();
          this.sourcePostings = null;
          this.doneFlag = true;
          return { done: true, processedIndexes, processedGrams };
        }
        const [gram, list] = next.value;
        if (list.length === 0) {
          compact.set(gram, createSparseSet([]));
          processedGrams++;
          continue;
        }
        const density = this.rowCount > 0 ? list.length / this.rowCount : 0;
        const isDense = density > DEFAULT_BITSET_DENSITY_THRESHOLD;
        this.currentPosting = {
          gram,
          list,
          cursor: 0,
          isDense,
          sparseTarget: isDense ? null : new Uint32Array(list.length),
          denseWords: isDense ? new Uint32Array((this.rowCount + 31) >>> 5) : null,
          denseCardinality: 0,
        };
      }

      const cp = this.currentPosting;
      const remaining = cp.list.length - cp.cursor;
      const budget = Math.max(1, Math.min(remaining, maxPostingIndexes - processedIndexes));

      if (cp.isDense) {
        const words = cp.denseWords!;
        const end = cp.cursor + budget;
        for (let i = cp.cursor; i < end; i++) {
          const idx = cp.list[i]!;
          const word = idx >>> 5;
          const bit = 1 << (idx & 31);
          if ((words[word]! & bit) === 0) {
            words[word]! |= bit;
            cp.denseCardinality++;
          }
        }
        cp.cursor = end;
        processedIndexes += budget;
      } else {
        const target = cp.sparseTarget!;
        const end = cp.cursor + budget;
        for (let i = cp.cursor; i < end; i++) {
          target[i] = cp.list[i]!;
        }
        cp.cursor = end;
        processedIndexes += budget;
      }

      // Posting complete?
      if (cp.cursor >= cp.list.length) {
        if (cp.isDense) {
          compact.set(cp.gram, {
            kind: "bitset",
            words: cp.denseWords!,
            cardinality: cp.denseCardinality,
            rowCount: this.rowCount,
          });
        } else {
          compact.set(cp.gram, {
            kind: "sparse",
            indexes: cp.sparseTarget!,
            cardinality: cp.sparseTarget!.length,
          });
        }
        this.currentPosting = null;
        processedGrams++;
      }

      if (options?.isCancelled?.()) break;
    }

    return { done: false, processedIndexes, processedGrams };
  }

  /** Discard mutable postings and any partial compact output. */
  discard(): void {
    if (this.discarded) return;
    this.discarded = true;
    this.doneFlag = false;
    this.sourcePostings?.clear();
    this.sourcePostings = null;
    this.compact?.clear();
    this.compact = null;
    this.currentPosting = null;
  }

  /**
   * O(1) hand-off of the finished compact map into an immutable index.
   * Throws if compaction is incomplete or discarded.
   */
  takeIndex(): QuickSearchTrigramIndex {
    if (this.discarded || !this.doneFlag || this.compact === null) {
      throw new Error("Trigram compaction is not ready to publish");
    }
    const postings = this.compact;
    this.compact = null;
    this.sourcePostings = null;
    return new QuickSearchTrigramIndex(postings, this.rowCount);
  }
}

/** Incremental builder: mutable number[] postings, then staged compaction. */
export class TrigramIndexBuilder {
  private postings: Map<string, number[]> | null = new Map();
  private readonly rowCount: number;

  constructor(rowCount: number) {
    this.rowCount = rowCount;
  }

  addRow(rowIndex: number, rowText: string): void {
    const postings = this.postings;
    if (postings === null) return;
    for (const gram of extractTrigrams(rowText)) {
      let list = postings.get(gram);
      if (!list) {
        list = [];
        postings.set(gram, list);
      }
      list.push(rowIndex);
    }
  }

  /**
   * Hand mutable postings to a cancellable compaction stage.
   * Further addRow calls are ignored after this.
   */
  beginCompaction(): TrigramPostingsCompaction {
    const postings = this.postings ?? new Map();
    this.postings = null;
    return new TrigramPostingsCompaction(postings, this.rowCount);
  }

  /**
   * Synchronous finish for parity/test helpers only.
   * Engine build paths must use {@link beginCompaction} instead.
   */
  finish(): QuickSearchTrigramIndex {
    const postings = this.postings;
    if (postings === null) {
      throw new Error("Trigram builder already entered compaction");
    }
    const compact = new Map<string, MatchSet>();
    for (const [gram, list] of postings) {
      compact.set(gram, createMatchSet(list, this.rowCount));
    }
    this.postings = null;
    return new QuickSearchTrigramIndex(compact, this.rowCount);
  }
}

function portableNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/**
 * Finite positive integer >= 1; falls back when value cannot make progress.
 * For integer bounds: chunk sizes, gram counts, posting index counts.
 */
export function sanitizePositiveInt(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

/**
 * Finite positive number; falls back when value is not usable.
 * For fractional bounds: time budgets in ms.
 */
export function sanitizePositiveFinite(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}


function intersectSmallestFirst(sets: MatchSet[]): MatchSet {
  if (sets.length === 0) return createSparseSet([]);
  sets.sort((a, b) => a.cardinality - b.cardinality);
  let acc = sets[0]!;
  for (let i = 1; i < sets.length && acc.cardinality > 0; i++) {
    acc = intersectMatchSets(acc, sets[i]!);
  }
  return acc;
}

export class QuickSearchTrigramIndex {
  private readonly postings: Map<string, MatchSet>;
  readonly rowCount: number;

  constructor(postings: Map<string, MatchSet>, rowCount: number) {
    this.postings = postings;
    this.rowCount = rowCount;
  }

  /** Candidate rows possibly containing `part` (length must be >= 3). */
  getCandidatesForPart(part: string): MatchSet {
    const grams = extractTrigrams(part);
    if (grams.length === 0) return createSparseSet([]);
    const sets: MatchSet[] = [];
    for (const gram of grams) {
      const posting = this.postings.get(gram);
      if (!posting) return createSparseSet([]);
      sets.push(posting);
    }
    return intersectSmallestFirst(sets);
  }

  /** AND across parts: intersect per-part candidate sets, smallest first. */
  getCandidatesForParts(parts: readonly string[]): MatchSet {
    const sets = parts.map((part) => this.getCandidatesForPart(part));
    return intersectSmallestFirst(sets);
  }
}
