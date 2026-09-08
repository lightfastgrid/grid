import { describe, expect, it } from 'vitest';

import {
  createBitsetSet,
  createMatchSet,
  createSparseSet,
  DEFAULT_BITSET_DENSITY_THRESHOLD,
  intersectMatchSets,
  intersectWithSourceIndexes,
  matchSetContains,
  materializeInSourceOrder,
  materializeMatchSet,
} from '../matchSet';

describe('matchSet', () => {
  // ── Construction ─────────────────────────────────────────────────────

  it('sparse sets sort indexes ascending', () => {
    const set = createSparseSet([7, 1, 3]);
    expect(Array.from(set.indexes)).toEqual([1, 3, 7]);
    expect(set.cardinality).toBe(3);
    expect(set.kind).toBe('sparse');
  });

  it('sparse sets de-duplicate indexes like bitsets do', () => {
    const set = createSparseSet([5, 1, 5, 3, 1, 1]);
    expect(Array.from(set.indexes)).toEqual([1, 3, 5]);
    expect(set.cardinality).toBe(3);
    // Materialization must not emit duplicates either.
    expect(Array.from(materializeMatchSet(set))).toEqual([1, 3, 5]);
  });

  it('sparse/sparse intersection with duplicate inputs stays duplicate-free', () => {
    const a = createSparseSet([2, 2, 4, 6, 6, 8]);
    const b = createSparseSet([2, 4, 4, 8, 8]);
    const result = intersectMatchSets(a, b);
    expect(Array.from(materializeMatchSet(result))).toEqual([2, 4, 8]);
    expect(result.cardinality).toBe(3);
  });

  it('bitsets use one bit per row and deduplicate', () => {
    const set = createBitsetSet([0, 31, 32, 63, 63], 64);
    expect(set.kind).toBe('bitset');
    expect(set.words.length).toBe(2);
    expect(set.cardinality).toBe(4);
    expect(set.rowCount).toBe(64);
  });

  it('createMatchSet picks sparse below and bitset above the density threshold', () => {
    const rowCount = 1000;
    const sparseCount = Math.floor(rowCount * DEFAULT_BITSET_DENSITY_THRESHOLD) - 1;
    const denseCount = Math.floor(rowCount * DEFAULT_BITSET_DENSITY_THRESHOLD) + 10;

    const sparseIndexes = Array.from({ length: sparseCount }, (_, i) => i);
    const denseIndexes = Array.from({ length: denseCount }, (_, i) => i);

    expect(createMatchSet(sparseIndexes, rowCount).kind).toBe('sparse');
    expect(createMatchSet(denseIndexes, rowCount).kind).toBe('bitset');
  });

  it('density choice uses unique cardinality, not raw duplicate-inflated length', () => {
    const rowCount = 1000;
    // 10 unique indexes (1% density) repeated 20x = 200 raw entries (20% raw).
    const unique = Array.from({ length: 10 }, (_, i) => i * 7);
    const duplicated: number[] = [];
    for (let r = 0; r < 20; r++) duplicated.push(...unique);

    const set = createMatchSet(duplicated, rowCount);
    expect(set.kind).toBe('sparse');
    expect(set.cardinality).toBe(10);
  });

  // ── contains ─────────────────────────────────────────────────────────

  it('contains works for both representations', () => {
    const indexes = [2, 5, 900];
    const sparse = createSparseSet(indexes);
    const bitset = createBitsetSet(indexes, 1000);
    for (const i of indexes) {
      expect(matchSetContains(sparse, i)).toBe(true);
      expect(matchSetContains(bitset, i)).toBe(true);
    }
    for (const i of [0, 3, 899, 999]) {
      expect(matchSetContains(sparse, i)).toBe(false);
      expect(matchSetContains(bitset, i)).toBe(false);
    }
    // Out-of-range never matches.
    expect(matchSetContains(bitset, 5000)).toBe(false);
  });

  // ── Intersection parity across representations ──────────────────────

  it('sparse/bitset intersections all produce identical results', () => {
    const rowCount = 200;
    const aIdx = [1, 5, 9, 50, 51, 120, 199];
    const bIdx = [5, 9, 40, 51, 100, 199];
    const expected = [5, 9, 51, 199];

    const combos = [
      [createSparseSet(aIdx), createSparseSet(bIdx)],
      [createSparseSet(aIdx), createBitsetSet(bIdx, rowCount)],
      [createBitsetSet(aIdx, rowCount), createSparseSet(bIdx)],
      [createBitsetSet(aIdx, rowCount), createBitsetSet(bIdx, rowCount)],
    ] as const;

    for (const [a, b] of combos) {
      const result = intersectMatchSets(a, b);
      expect(Array.from(materializeMatchSet(result))).toEqual(expected);
      expect(result.cardinality).toBe(expected.length);
    }
  });

  it('intersection with an empty set is empty', () => {
    const a = createSparseSet([1, 2, 3]);
    const empty = createSparseSet([]);
    expect(materializeMatchSet(intersectMatchSets(a, empty)).length).toBe(0);
  });

  // ── Source-order preservation ────────────────────────────────────────

  it('intersectWithSourceIndexes preserves SOURCE order, not match order', () => {
    // Upstream (e.g. sorted/filtered) order is descending here.
    const source = new Uint32Array([90, 50, 20, 10, 5]);
    const match = createSparseSet([5, 20, 90]); // internally ascending

    const sparseResult = intersectWithSourceIndexes(match, source);
    expect(Array.from(sparseResult)).toEqual([90, 20, 5]);

    const bitsetResult = intersectWithSourceIndexes(
      createBitsetSet([5, 20, 90], 100),
      source,
    );
    expect(Array.from(bitsetResult)).toEqual([90, 20, 5]);
  });

  it('materializeInSourceOrder without source falls back to ascending order', () => {
    const bitset = createBitsetSet([40, 3, 77], 100);
    expect(Array.from(materializeInSourceOrder(bitset, null))).toEqual([3, 40, 77]);
  });

  // ── Boundary shape: bitsets never leak ───────────────────────────────

  it('materialization always returns Uint32Array, never a bitset', () => {
    const bitset = createBitsetSet([1, 2, 3], 10);
    const sparse = createSparseSet([1, 2, 3]);
    const source = new Uint32Array([3, 2]);

    for (const out of [
      materializeMatchSet(bitset),
      materializeMatchSet(sparse),
      materializeInSourceOrder(bitset, source),
      materializeInSourceOrder(sparse, null),
      intersectWithSourceIndexes(bitset, source),
    ]) {
      expect(out).toBeInstanceOf(Uint32Array);
    }
  });

  it('bitset materialization emits ascending row indexes across word boundaries', () => {
    const indexes = [0, 31, 32, 33, 64, 95, 96];
    const bitset = createBitsetSet(indexes, 128);
    expect(Array.from(materializeMatchSet(bitset))).toEqual(indexes);
  });
});
