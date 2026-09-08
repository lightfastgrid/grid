import { describe, expect, it } from 'vitest';

import { BoundedLruMap } from '../boundedLru';
import { createBitsetSet, createSparseSet } from '../matchSet';
import {
  buildFullMatchKey,
  buildSourceResultKey,
} from '../quickSearchCacheKeys';
import type { LazyNarrowingPrevious } from '../quickSearchLazyNarrowing';
import type {
  FullMatchCacheEntry,
  QuickSearchCaches,
  QuickSearchPlanInput,
  SourceResultCacheEntry,
} from '../quickSearchPlanner';
import { planQuickSearchQuery } from '../quickSearchPlanner';

const ctx = {
  generation: 1,
  searchableFieldsKey: 'sf|v|name,city',
  normalizerSignature: 'qs-norm-v1',
  configSignature: 'cfg-1',
  searchableDataRevision: 0,
};

function createCaches(): QuickSearchCaches {
  return {
    sourceResult: new BoundedLruMap<string, SourceResultCacheEntry>(16),
    fullMatch: new BoundedLruMap<string, FullMatchCacheEntry>(16),
    lastQuery: null,
  };
}

function planInput(overrides?: Partial<QuickSearchPlanInput>): QuickSearchPlanInput {
  const snapshotRowCount = overrides?.snapshotRowCount ?? 100_000;
  const sourceIndexes =
    overrides && 'sourceIndexes' in overrides
      ? (overrides.sourceIndexes ?? null)
      : null;
  const sourceRowCount =
    overrides?.sourceRowCount ??
    (sourceIndexes !== null ? sourceIndexes.length : snapshotRowCount);
  return {
    ...ctx,
    normalizedText: 'ALICE',
    sourceSignature: 'src-1',
    sourceIndexes,
    snapshotRowCount,
    sourceRowCount,
    indexState: 'missing',
    caches: createCaches(),
    ...overrides,
  };
}

function lastQuery(overrides?: Partial<LazyNarrowingPrevious>): LazyNarrowingPrevious {
  return {
    ...ctx,
    sourceSignature: 'src-1',
    normalizedText: 'ALIC',
    indexes: new Uint32Array([2, 7, 11]),
    ...overrides,
  };
}

describe('planQuickSearchQuery', () => {
  // ── 1. Empty query ───────────────────────────────────────────────────

  it('empty and whitespace-only queries plan passthrough', () => {
    expect(planQuickSearchQuery(planInput({ normalizedText: '' })).kind).toBe('empty');
    expect(planQuickSearchQuery(planInput({ normalizedText: '   ' })).kind).toBe('empty');
  });

  it('zero-row selective source with empty query remains empty', () => {
    expect(
      planQuickSearchQuery(
        planInput({
          normalizedText: '',
          sourceIndexes: new Uint32Array([]),
          sourceRowCount: 0,
          snapshotRowCount: 100_000,
          indexState: 'missing',
        }),
      ).kind,
    ).toBe('empty');
  });

  // ── 2. Source-scoped cache wins over everything ──────────────────────

  it('exact source-scoped hit wins before full-match, lazy, index, and scan', () => {
    const caches = createCaches();
    const cachedOrder = new Uint32Array([9, 3, 1]);
    caches.sourceResult.set(
      buildSourceResultKey({ ...ctx, sourceSignature: 'src-1', normalizedText: 'ALICE' }),
      { indexes: cachedOrder },
    );
    // Populate ALL later stages — none of them may be chosen.
    caches.fullMatch.set(
      buildFullMatchKey({ ...ctx, normalizedText: 'ALICE' }),
      { matchSet: createSparseSet([1, 3, 9, 20]) },
    );
    caches.lastQuery = lastQuery({ normalizedText: 'ALIC' });

    const plan = planQuickSearchQuery(
      planInput({
        caches,
        indexState: 'ready',
        sourceRowCount: 100,
        snapshotRowCount: 100_000,
      }),
    );
    expect(plan.kind).toBe('cached-source-result');
    if (plan.kind !== 'cached-source-result') throw new Error('unreachable');
    // Cached row order is returned as-is (already source-ordered).
    expect(plan.indexes).toBe(cachedOrder);
  });

  it('source-scoped cache misses when sourceSignature changes', () => {
    const caches = createCaches();
    caches.sourceResult.set(
      buildSourceResultKey({ ...ctx, sourceSignature: 'src-1', normalizedText: 'ALICE' }),
      { indexes: new Uint32Array([1]) },
    );
    const plan = planQuickSearchQuery(
      planInput({ caches, sourceSignature: 'src-2' }),
    );
    expect(plan.kind).not.toBe('cached-source-result');
  });

  // ── 3. Full-match cache across source changes ────────────────────────

  it('full-match hit survives sourceIndexes changes and preserves source order', () => {
    const caches = createCaches();
    caches.fullMatch.set(
      buildFullMatchKey({ ...ctx, normalizedText: 'ALICE' }),
      { matchSet: createBitsetSet([5, 20, 90], 100) },
    );

    // Filter changed: new source signature and a descending source order.
    const plan = planQuickSearchQuery(
      planInput({
        caches,
        sourceSignature: 'src-2',
        sourceIndexes: new Uint32Array([90, 50, 20, 10, 5]),
        indexState: 'missing',
      }),
    );
    expect(plan.kind).toBe('full-match-intersect');
    if (plan.kind !== 'full-match-intersect') throw new Error('unreachable');
    // Source order (descending), never internal ascending match order.
    expect(Array.from(plan.indexes)).toEqual([90, 20, 5]);
    expect(plan.indexes).toBeInstanceOf(Uint32Array);
  });

  it('full-match hit with null source materializes ascending identity order', () => {
    const caches = createCaches();
    caches.fullMatch.set(
      buildFullMatchKey({ ...ctx, normalizedText: 'ALICE' }),
      { matchSet: createBitsetSet([40, 3, 77], 100) },
    );
    const plan = planQuickSearchQuery(planInput({ caches }));
    if (plan.kind !== 'full-match-intersect') throw new Error('expected full-match hit');
    expect(Array.from(plan.indexes)).toEqual([3, 40, 77]);
  });

  // ── 4. Lazy narrowing ────────────────────────────────────────────────

  it('safe forward typing plans lazy narrowing with mandatory verification', () => {
    const caches = createCaches();
    caches.lastQuery = lastQuery({ normalizedText: 'ALIC' });
    const plan = planQuickSearchQuery(
      planInput({
        caches,
        normalizedText: 'ALICE',
        indexState: 'missing',
        sourceRowCount: 100,
        snapshotRowCount: 100_000,
      }),
    );
    expect(plan.kind).toBe('lazy-narrow');
    if (plan.kind !== 'lazy-narrow') throw new Error('unreachable');
    expect(Array.from(plan.candidateIndexes)).toEqual([2, 7, 11]);
    expect(plan.requiresVerification).toBe(true);
  });

  it('backspace does not use lazy narrowing', () => {
    const caches = createCaches();
    caches.lastQuery = lastQuery({ normalizedText: 'ALICE' });
    const plan = planQuickSearchQuery(planInput({ caches, normalizedText: 'ALIC' }));
    expect(plan.kind).not.toBe('lazy-narrow');
  });

  it.each([
    ['generation change', { generation: 2 }],
    ['source change', { sourceSignature: 'src-2' }],
    ['config change', { configSignature: 'cfg-2' }],
    ['searchable fields change', { searchableFieldsKey: 'sf|v|name' }],
  ] as const)('%s does not use lazy narrowing', (_label, overrides) => {
    const caches = createCaches();
    caches.lastQuery = lastQuery({ normalizedText: 'ALIC' });
    const plan = planQuickSearchQuery(
      planInput({ caches, normalizedText: 'ALICE', ...overrides }),
    );
    expect(plan.kind).not.toBe('lazy-narrow');
  });

  // ── 5. Index / scan policy (Stage 1L-A) ─────────────────────────────

  it('100/100k + missing + indexable query → scan (never build)', () => {
    const plan = planQuickSearchQuery(
      planInput({
        normalizedText: 'ALICE',
        indexState: 'missing',
        snapshotRowCount: 100_000,
        sourceRowCount: 100,
        sourceIndexes: new Uint32Array(100),
      }),
    );
    expect(plan.kind).toBe('scan');
  });

  it('broad/full 100k + missing + indexable → index-lookup requiresBuild true', () => {
    const plan = planQuickSearchQuery(
      planInput({
        normalizedText: 'ALICE LAHORE',
        indexState: 'missing',
        snapshotRowCount: 100_000,
        sourceRowCount: 100_000,
        sourceIndexes: null,
      }),
    );
    expect(plan).toEqual({ kind: 'index-lookup', requiresBuild: true });
  });

  it('ready index + selective source → index-lookup requiresBuild false', () => {
    const plan = planQuickSearchQuery(
      planInput({
        normalizedText: 'ALICE',
        indexState: 'ready',
        snapshotRowCount: 100_000,
        sourceRowCount: 100,
        sourceIndexes: new Uint32Array(100),
      }),
    );
    expect(plan).toEqual({ kind: 'index-lookup', requiresBuild: false });
  });

  it('building index + broad source → scan', () => {
    const plan = planQuickSearchQuery(
      planInput({
        normalizedText: 'ALICE',
        indexState: 'building',
        snapshotRowCount: 100_000,
        sourceRowCount: 100_000,
      }),
    );
    expect(plan.kind).toBe('scan');
  });

  it('missing index + 1-2 character part → scan', () => {
    expect(
      planQuickSearchQuery(
        planInput({
          normalizedText: 'AL',
          indexState: 'missing',
          snapshotRowCount: 100_000,
          sourceRowCount: 100_000,
        }),
      ).kind,
    ).toBe('scan');
    expect(
      planQuickSearchQuery(
        planInput({
          normalizedText: 'ALICE AB',
          indexState: 'ready',
          snapshotRowCount: 100_000,
          sourceRowCount: 100_000,
        }),
      ).kind,
    ).toBe('scan');
  });

  it('selectivity requires both ratio and absolute bounds', () => {
    // Under absolute cap, but above ratio → not selective → may build.
    const overRatio = planQuickSearchQuery(
      planInput({
        normalizedText: 'ALICE',
        indexState: 'missing',
        snapshotRowCount: 1_000,
        sourceRowCount: 100, // 10% > 5%
      }),
    );
    expect(overRatio).toEqual({ kind: 'index-lookup', requiresBuild: true });

    // Under ratio, but over absolute cap → not selective → may build.
    const overAbsolute = planQuickSearchQuery(
      planInput({
        normalizedText: 'ALICE',
        indexState: 'missing',
        snapshotRowCount: 10_000_000,
        sourceRowCount: 3_000, // 0.03% < 5%, but > 2048 absolute
      }),
    );
    expect(overAbsolute).toEqual({ kind: 'index-lookup', requiresBuild: true });

    // Both bounds satisfied → selective scan.
    const both = planQuickSearchQuery(
      planInput({
        normalizedText: 'ALICE',
        indexState: 'missing',
        snapshotRowCount: 100_000,
        sourceRowCount: 100,
      }),
    );
    expect(both.kind).toBe('scan');
  });

  it('zero-row missing source with indexable query scans safely', () => {
    const plan = planQuickSearchQuery(
      planInput({
        normalizedText: 'ALICE',
        indexState: 'missing',
        snapshotRowCount: 100_000,
        sourceRowCount: 0,
        sourceIndexes: new Uint32Array([]),
      }),
    );
    expect(plan.kind).toBe('scan');
  });
});
