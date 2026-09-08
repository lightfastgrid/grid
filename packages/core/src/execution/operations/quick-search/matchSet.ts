/**
 * MatchSet representations for quick-search query results.
 *
 * Sparse sets hold sorted ascending `Uint32Array` row indexes; dense
 * sets hold one-bit-per-row bitsets. The planner picks the shape by
 * density. Bitsets are quick-search operation internals ONLY — every
 * result crossing the operation boundary is materialized to a
 * `Uint32Array` of row indexes first.
 */

export interface SparseIndexSet {
  kind: "sparse";
  /** Sorted ascending source row indexes. */
  indexes: Uint32Array;
  cardinality: number;
}

export interface DenseBitsetSet {
  kind: "bitset";
  /** One bit per source row index. */
  words: Uint32Array;
  cardinality: number;
  rowCount: number;
}

export type MatchSet = SparseIndexSet | DenseBitsetSet;

/** Store sets above ~8% density as bitsets (doc: 5-10% initial target). */
export const DEFAULT_BITSET_DENSITY_THRESHOLD = 0.08;

function toSortedUniqueUint32(indexes: ArrayLike<number>): Uint32Array {
  const sorted = Uint32Array.from(indexes);
  sorted.sort();
  // De-duplicate in place — sparse and bitset are both SETS, so
  // duplicate inputs must not inflate cardinality or materialize twice.
  let n = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i] !== sorted[i - 1]) {
      sorted[n++] = sorted[i]!;
    }
  }
  return n === sorted.length ? sorted : sorted.slice(0, n);
}

export function createSparseSet(indexes: ArrayLike<number>): SparseIndexSet {
  const unique = toSortedUniqueUint32(indexes);
  return { kind: "sparse", indexes: unique, cardinality: unique.length };
}

export function createBitsetSet(
  indexes: ArrayLike<number>,
  rowCount: number,
): DenseBitsetSet {
  const words = new Uint32Array((rowCount + 31) >>> 5);
  let cardinality = 0;
  for (let i = 0; i < indexes.length; i++) {
    const idx = indexes[i]!;
    const word = idx >>> 5;
    const bit = 1 << (idx & 31);
    if ((words[word]! & bit) === 0) {
      words[word]! |= bit;
      cardinality++;
    }
  }
  return { kind: "bitset", words, cardinality, rowCount };
}

/** Choose sparse vs bitset by match density (unique cardinality, not raw input length). */
export function createMatchSet(
  indexes: ArrayLike<number>,
  rowCount: number,
  densityThreshold: number = DEFAULT_BITSET_DENSITY_THRESHOLD,
): MatchSet {
  const sparse = createSparseSet(indexes);
  if (rowCount > 0 && sparse.cardinality / rowCount > densityThreshold) {
    return createBitsetSet(sparse.indexes, rowCount);
  }
  return sparse;
}

/**
 * MatchSet construction for already ascending, de-duplicated indexes
 * (e.g. trigram postings built by ascending row ingestion). Skips the
 * general sort/de-duplicate path used by {@link createMatchSet}.
 */
export function createMatchSetFromSortedUnique(
  indexes: ArrayLike<number>,
  rowCount: number,
  densityThreshold: number = DEFAULT_BITSET_DENSITY_THRESHOLD,
): MatchSet {
  const sortedUnique =
    indexes instanceof Uint32Array
      ? indexes.slice()
      : Uint32Array.from(indexes);
  if (rowCount > 0 && sortedUnique.length / rowCount > densityThreshold) {
    return createBitsetSet(sortedUnique, rowCount);
  }
  return {
    kind: "sparse",
    indexes: sortedUnique,
    cardinality: sortedUnique.length,
  };
}

function sparseContains(set: SparseIndexSet, rowIndex: number): boolean {
  const arr = set.indexes;
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = arr[mid]!;
    if (v === rowIndex) return true;
    if (v < rowIndex) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

function bitsetContains(set: DenseBitsetSet, rowIndex: number): boolean {
  if (rowIndex >= set.rowCount) return false;
  return (set.words[rowIndex >>> 5]! & (1 << (rowIndex & 31))) !== 0;
}

export function matchSetContains(set: MatchSet, rowIndex: number): boolean {
  return set.kind === "sparse"
    ? sparseContains(set, rowIndex)
    : bitsetContains(set, rowIndex);
}

function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function intersectSparseSparse(a: SparseIndexSet, b: SparseIndexSet): SparseIndexSet {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  const av = a.indexes;
  const bv = b.indexes;
  while (i < av.length && j < bv.length) {
    const x = av[i]!;
    const y = bv[j]!;
    if (x === y) {
      out.push(x);
      i++;
      j++;
    } else if (x < y) {
      i++;
    } else {
      j++;
    }
  }
  const indexes = Uint32Array.from(out);
  return { kind: "sparse", indexes, cardinality: indexes.length };
}

function intersectSparseBitset(a: SparseIndexSet, b: DenseBitsetSet): SparseIndexSet {
  const out: number[] = [];
  for (let i = 0; i < a.indexes.length; i++) {
    const idx = a.indexes[i]!;
    if (bitsetContains(b, idx)) out.push(idx);
  }
  const indexes = Uint32Array.from(out);
  return { kind: "sparse", indexes, cardinality: indexes.length };
}

function intersectBitsetBitset(a: DenseBitsetSet, b: DenseBitsetSet): DenseBitsetSet {
  const rowCount = Math.min(a.rowCount, b.rowCount);
  const wordCount = (rowCount + 31) >>> 5;
  const words = new Uint32Array(wordCount);
  let cardinality = 0;
  for (let w = 0; w < wordCount; w++) {
    const merged = (a.words[w] ?? 0) & (b.words[w] ?? 0);
    words[w] = merged;
    cardinality += popcount32(merged);
  }
  return { kind: "bitset", words, cardinality, rowCount };
}

export function intersectMatchSets(a: MatchSet, b: MatchSet): MatchSet {
  if (a.kind === "sparse" && b.kind === "sparse") return intersectSparseSparse(a, b);
  if (a.kind === "sparse" && b.kind === "bitset") return intersectSparseBitset(a, b);
  if (a.kind === "bitset" && b.kind === "sparse") return intersectSparseBitset(b, a);
  return intersectBitsetBitset(a as DenseBitsetSet, b as DenseBitsetSet);
}

/**
 * Intersect a match set with upstream source indexes, preserving the
 * SOURCE order — the upstream filtered order is the display authority,
 * never the internal sorted match order.
 */
export function intersectWithSourceIndexes(
  set: MatchSet,
  sourceIndexes: Uint32Array,
): Uint32Array {
  const out: number[] = [];
  for (let i = 0; i < sourceIndexes.length; i++) {
    const idx = sourceIndexes[i]!;
    if (matchSetContains(set, idx)) out.push(idx);
  }
  return Uint32Array.from(out);
}

/** Materialize a match set to ascending row indexes (identity source order). */
export function materializeMatchSet(set: MatchSet): Uint32Array {
  if (set.kind === "sparse") {
    return set.indexes.slice();
  }
  const out = new Uint32Array(set.cardinality);
  let n = 0;
  for (let w = 0; w < set.words.length; w++) {
    let word = set.words[w]!;
    while (word !== 0) {
      const bit = word & -word;
      out[n++] = (w << 5) + (31 - Math.clz32(bit));
      word ^= bit;
    }
  }
  return out;
}

/**
 * Materialize to final `Uint32Array` row indexes. With `sourceIndexes`,
 * output follows the upstream source order; without, ascending row
 * index (identity) order. This is the ONLY shape that may leave the
 * quick-search operation — bitsets never cross the boundary.
 */
export function materializeInSourceOrder(
  set: MatchSet,
  sourceIndexes: Uint32Array | null,
): Uint32Array {
  if (sourceIndexes === null) return materializeMatchSet(set);
  return intersectWithSourceIndexes(set, sourceIndexes);
}
