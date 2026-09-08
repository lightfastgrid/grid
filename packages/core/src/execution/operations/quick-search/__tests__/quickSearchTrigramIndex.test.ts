import { describe, expect, it } from 'vitest';

import { createMatchSet, createMatchSetFromSortedUnique, materializeMatchSet } from '../matchSet';
import type {
  QuickSearchTrigramIndex} from '../quickSearchTrigramIndex';
import {
  extractTrigrams,
  sanitizePositiveFinite,
  sanitizePositiveInt,
  TrigramIndexBuilder,
  TrigramPostingsCompaction,
} from '../quickSearchTrigramIndex';

function buildIndex(texts: string[]): QuickSearchTrigramIndex {
  const builder = new TrigramIndexBuilder(texts.length);
  texts.forEach((text, i) => builder.addRow(i, text));
  return builder.finish();
}

describe('quickSearchTrigramIndex', () => {
  it('extractTrigrams produces unique sliding trigrams', () => {
    expect(extractTrigrams('ABCD')).toEqual(['ABC', 'BCD']);
    expect(extractTrigrams('AAAA')).toEqual(['AAA']);
    expect(extractTrigrams('AB')).toEqual([]);
    expect(extractTrigrams('')).toEqual([]);
  });

  it('builds candidate postings for parts of length >= 3', () => {
    const index = buildIndex(['ALICE', 'BOB', 'MALICE']);
    const candidates = index.getCandidatesForPart('ALI');
    expect(Array.from(materializeMatchSet(candidates))).toEqual([0, 2]);
  });

  it('missing trigram yields empty candidates', () => {
    const index = buildIndex(['ALICE', 'BOB']);
    expect(index.getCandidatesForPart('XYZ').cardinality).toBe(0);
    // One present + one missing trigram — still empty.
    expect(index.getCandidatesForPart('ALIXYZ').cardinality).toBe(0);
  });

  it('candidates admit trigram false positives that verification must remove', () => {
    // "ABC BCD" contains both trigrams of "ABCD" without the substring.
    const index = buildIndex(['ABC BCD', 'XABCDY', 'ZZZ']);
    const candidates = index.getCandidatesForPart('ABCD');
    const rows = Array.from(materializeMatchSet(candidates));
    expect(rows).toContain(1); // true match
    expect(rows).toContain(0); // false positive — matcher must reject it
    expect(rows).not.toContain(2);
  });

  it('intersects candidates across parts (AND semantics)', () => {
    const index = buildIndex(['ALICE LAHORE', 'ALICE LONDON', 'BOB LAHORE']);
    const candidates = index.getCandidatesForParts(['ALICE', 'LAHORE']);
    expect(Array.from(materializeMatchSet(candidates))).toEqual([0]);
  });

  it('empty parts list yields empty candidates', () => {
    const index = buildIndex(['ALICE']);
    expect(index.getCandidatesForParts([]).cardinality).toBe(0);
  });
});

describe('TrigramPostingsCompaction', () => {
  function buildPostings(texts: string[]): { postings: Map<string, number[]>; rowCount: number } {
    const postings = new Map<string, number[]>();
    texts.forEach((text, i) => {
      for (const gram of extractTrigrams(text)) {
        let list = postings.get(gram);
        if (!list) {
          list = [];
          postings.set(gram, list);
        }
        list.push(i);
      }
    });
    return { postings, rowCount: texts.length };
  }

  it('multi-slice compaction completes after processing all grams', () => {
    const { postings, rowCount } = buildPostings(['ALICE', 'BOB', 'MALICE']);
    const compaction = new TrigramPostingsCompaction(postings, rowCount);

    const result1 = compaction.compactNext({ maxGrams: 2, timeBudgetMs: 1000, now: () => 0 });
    expect(result1.done).toBe(false);
    expect(compaction.done).toBe(false);

    let result;
    do {
      result = compaction.compactNext({ maxGrams: 2, timeBudgetMs: 1000, now: () => 0 });
    } while (!result.done);

    expect(compaction.done).toBe(true);
    const index = compaction.takeIndex();
    expect(index.rowCount).toBe(3);
  });

  it('discard prevents publication and marks discarded', () => {
    const { postings, rowCount } = buildPostings(['ALICE', 'BOB']);
    const compaction = new TrigramPostingsCompaction(postings, rowCount);
    compaction.compactNext({ maxGrams: 1, timeBudgetMs: 1000, now: () => 0 });
    compaction.discard();

    expect(compaction.isDiscarded).toBe(true);
    expect(compaction.done).toBe(false);
    expect(() => compaction.takeIndex()).toThrow();
  });

  it('compactNext after discard returns done: false', () => {
    const { postings, rowCount } = buildPostings(['ALICE']);
    const compaction = new TrigramPostingsCompaction(postings, rowCount);
    compaction.discard();
    const result = compaction.compactNext();
    expect(result.done).toBe(false);
    expect(result.processedIndexes).toBe(0);
  });

  it('isCancelled stops compaction within a slice', () => {
    const { postings, rowCount } = buildPostings(['ALICE', 'BOB', 'MALICE', 'DAVE']);
    const compaction = new TrigramPostingsCompaction(postings, rowCount);
    let cancelled = false;
    const result = compaction.compactNext({
      maxGrams: 100,
      timeBudgetMs: 1000,
      now: () => 0,
      isCancelled: () => { cancelled = true; return true; },
    });
    expect(result.done).toBe(false);
    expect(cancelled).toBe(true);
  });

  it('time budget stops compaction mid-slice but guarantees progress', () => {
    const { postings, rowCount } = buildPostings(['ALICE', 'BOB', 'MALICE']);
    const compaction = new TrigramPostingsCompaction(postings, rowCount);
    let time = 0;
    const result = compaction.compactNext({
      maxGrams: 100,
      timeBudgetMs: 1,
      now: () => time++,
    });
    expect(result.done).toBe(false);
    expect(result.processedIndexes).toBeGreaterThan(0);
  });

  it('takeIndex throws on incomplete compaction', () => {
    const { postings, rowCount } = buildPostings(['ALICE', 'BOB']);
    const compaction = new TrigramPostingsCompaction(postings, rowCount);
    compaction.compactNext({ maxGrams: 1, timeBudgetMs: 1000, now: () => 0 });
    expect(() => compaction.takeIndex()).toThrow();
  });

  it('beginCompaction transitions builder and ignores further addRow', () => {
    const builder = new TrigramIndexBuilder(3);
    builder.addRow(0, 'ALICE');
    builder.addRow(1, 'BOB');
    const compaction = builder.beginCompaction();
    builder.addRow(2, 'CARA');

    let result;
    do {
      result = compaction.compactNext({ maxGrams: 100, timeBudgetMs: 1000, now: () => 0 });
    } while (!result.done);

    const index = compaction.takeIndex();
    expect(index.getCandidatesForPart('ALI').cardinality).toBe(1);
    expect(index.getCandidatesForPart('CAR').cardinality).toBe(0);
  });

  // ── 100k posting tests (P1: unbounded single posting) ──────────────────

  it('100k posting requires multiple slices under small posting-index bound', () => {
    const ROW_COUNT = 100_000;
    const postings = new Map<string, number[]>();
    const bigList = Array.from({ length: ROW_COUNT }, (_, i) => i);
    postings.set('AAA', bigList);
    const compaction = new TrigramPostingsCompaction(postings, ROW_COUNT);

    let slices = 0;
    let totalIndexes = 0;
    let totalGrams = 0;
    let result;
    do {
      result = compaction.compactNext({
        maxPostingIndexes: 1000,
        maxGrams: 100,
        timeBudgetMs: 10_000,
        now: () => 0,
      });
      totalIndexes += result.processedIndexes;
      totalGrams += result.processedGrams;
      slices++;
    } while (!result.done);

    expect(slices).toBeGreaterThan(1);
    expect(totalIndexes).toBe(ROW_COUNT);
    expect(totalGrams).toBe(1);
  });

  it('no single slice converts the entire 100k posting', () => {
    const ROW_COUNT = 100_000;
    const postings = new Map<string, number[]>();
    postings.set('AAA', Array.from({ length: ROW_COUNT }, (_, i) => i));
    const compaction = new TrigramPostingsCompaction(postings, ROW_COUNT);

    const result = compaction.compactNext({
      maxPostingIndexes: 1000,
      maxGrams: 100,
      timeBudgetMs: 10_000,
      now: () => 0,
    });
    expect(result.done).toBe(false);
    expect(result.processedIndexes).toBeLessThanOrEqual(1000);
    expect(result.processedGrams).toBe(0);
  });

  it('cancel midway through a 100k posting: no gram publishes', () => {
    const ROW_COUNT = 100_000;
    const postings = new Map<string, number[]>();
    postings.set('AAA', Array.from({ length: ROW_COUNT }, (_, i) => i));
    const compaction = new TrigramPostingsCompaction(postings, ROW_COUNT);

    // Process some but not all.
    compaction.compactNext({
      maxPostingIndexes: 500,
      maxGrams: 100,
      timeBudgetMs: 10_000,
      now: () => 0,
    });
    compaction.discard();

    expect(compaction.isDiscarded).toBe(true);
    expect(() => compaction.takeIndex()).toThrow();
  });

  it('clock exceeds budget after first gram but each slice still advances and eventually completes', () => {
    // Multiple small grams — time budget fires between grams.
    const ROW_COUNT = 20;
    const postings = new Map<string, number[]>();
    for (let g = 0; g < 10; g++) {
      postings.set(`G${String(g).padStart(2, '0')}`, [g, g + 10]);
    }
    const compaction = new TrigramPostingsCompaction(postings, ROW_COUNT);
    const BUDGET_MS = 2;

    let totalIndexes = 0;
    let totalGrams = 0;
    let slices = 0;
    let result;
    do {
      let callCount = 0;
      result = compaction.compactNext({
        maxPostingIndexes: 10_000,
        maxGrams: 100,
        timeBudgetMs: BUDGET_MS,
        now: () => {
          // First call returns 0 (start timestamp).
          // Subsequent calls return a value exceeding the budget.
          return callCount++ === 0 ? 0 : BUDGET_MS + 1;
        },
      });
      if (!result.done) {
        expect(result.processedIndexes).toBeGreaterThan(0);
        // Time budget stops it before maxGrams — only 1 gram per slice.
        expect(result.processedGrams).toBeLessThanOrEqual(1);
      }
      totalIndexes += result.processedIndexes;
      totalGrams += result.processedGrams;
      slices++;
    } while (!result.done);

    expect(totalGrams).toBe(10);
    expect(totalIndexes).toBe(20);
    expect(slices).toBeGreaterThan(1);
  });

  it('sparse incremental result matches canonical MatchSet', () => {
    const ROW_COUNT = 10_000;
    const indexes = Array.from({ length: 50 }, (_, i) => i * 200);
    const postings = new Map<string, number[]>();
    postings.set('AAA', indexes);
    const compaction = new TrigramPostingsCompaction(postings, ROW_COUNT);

    let result;
    do {
      result = compaction.compactNext({
        maxPostingIndexes: 10,
        maxGrams: 100,
        timeBudgetMs: 10_000,
        now: () => 0,
      });
    } while (!result.done);

    const index = compaction.takeIndex();
    const candidates = index.getCandidatesForPart('AAA');
    const canonical = createMatchSet(indexes, ROW_COUNT);
    expect(Array.from(materializeMatchSet(candidates))).toEqual(
      Array.from(materializeMatchSet(canonical)),
    );
  });

  it('dense incremental result matches canonical MatchSet', () => {
    const ROW_COUNT = 100;
    const indexes = Array.from({ length: 90 }, (_, i) => i);
    const postings = new Map<string, number[]>();
    postings.set('AAA', indexes);
    const compaction = new TrigramPostingsCompaction(postings, ROW_COUNT);

    let result;
    do {
      result = compaction.compactNext({
        maxPostingIndexes: 10,
        maxGrams: 100,
        timeBudgetMs: 10_000,
        now: () => 0,
      });
    } while (!result.done);

    const index = compaction.takeIndex();
    const candidates = index.getCandidatesForPart('AAA');
    const canonical = createMatchSet(indexes, ROW_COUNT);
    expect(Array.from(materializeMatchSet(candidates))).toEqual(
      Array.from(materializeMatchSet(canonical)),
    );
    expect(candidates.kind).toBe('bitset');
  });
});

describe('createMatchSetFromSortedUnique parity', () => {
  it('sparse case matches createMatchSet for ascending unique input', () => {
    const indexes = [0, 5, 10, 20, 99];
    const rowCount = 1000;
    const fromGeneral = createMatchSet(indexes, rowCount);
    const fromSorted = createMatchSetFromSortedUnique(indexes, rowCount);
    expect(Array.from(materializeMatchSet(fromSorted))).toEqual(
      Array.from(materializeMatchSet(fromGeneral)),
    );
  });

  it('dense case matches createMatchSet for ascending unique input', () => {
    const rowCount = 100;
    const indexes = Array.from({ length: 90 }, (_, i) => i);
    const fromGeneral = createMatchSet(indexes, rowCount);
    const fromSorted = createMatchSetFromSortedUnique(indexes, rowCount);
    expect(Array.from(materializeMatchSet(fromSorted))).toEqual(
      Array.from(materializeMatchSet(fromGeneral)),
    );
  });
});

describe('sanitizePositiveInt', () => {
  it('returns fallback for undefined', () => {
    expect(sanitizePositiveInt(undefined, 64)).toBe(64);
  });

  it('returns fallback for 0', () => {
    expect(sanitizePositiveInt(0, 64)).toBe(64);
  });

  it('returns fallback for negative', () => {
    expect(sanitizePositiveInt(-5, 64)).toBe(64);
  });

  it('returns fallback for NaN', () => {
    expect(sanitizePositiveInt(NaN, 64)).toBe(64);
  });

  it('returns fallback for Infinity', () => {
    expect(sanitizePositiveInt(Infinity, 64)).toBe(64);
  });

  it('returns fallback for -Infinity', () => {
    expect(sanitizePositiveInt(-Infinity, 64)).toBe(64);
  });

  it('floors positive fractional values to at least 1', () => {
    expect(sanitizePositiveInt(3.9, 64)).toBe(3);
    expect(sanitizePositiveInt(0.1, 64)).toBe(1);
    expect(sanitizePositiveInt(0.5, 64)).toBe(1);
    expect(sanitizePositiveInt(1.9, 64)).toBe(1);
  });

  it('passes through positive integers', () => {
    expect(sanitizePositiveInt(10, 64)).toBe(10);
  });
});

describe('sanitizePositiveFinite', () => {
  it('returns fallback for undefined', () => {
    expect(sanitizePositiveFinite(undefined, 4)).toBe(4);
  });

  it('returns fallback for 0', () => {
    expect(sanitizePositiveFinite(0, 4)).toBe(4);
  });

  it('returns fallback for negative', () => {
    expect(sanitizePositiveFinite(-1, 4)).toBe(4);
  });

  it('returns fallback for NaN', () => {
    expect(sanitizePositiveFinite(NaN, 4)).toBe(4);
  });

  it('returns fallback for Infinity', () => {
    expect(sanitizePositiveFinite(Infinity, 4)).toBe(4);
  });

  it('returns fallback for -Infinity', () => {
    expect(sanitizePositiveFinite(-Infinity, 4)).toBe(4);
  });

  it('preserves valid fractional time budgets', () => {
    expect(sanitizePositiveFinite(0.5, 4)).toBe(0.5);
    expect(sanitizePositiveFinite(2.5, 4)).toBe(2.5);
  });

  it('passes through positive integers', () => {
    expect(sanitizePositiveFinite(10, 4)).toBe(10);
  });
});

describe('no synchronous finish() in QuickSearchQueryEngine', () => {
  it('engine source has no .finish() calls', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const engineSource = readFileSync(
      join(__dirname, '../quickSearchQueryEngine.ts'),
      'utf8',
    );
    const lines = engineSource.split('\n');
    const finishCalls = lines.filter(
      (line: string) => line.includes('.finish()') && !line.trim().startsWith('*') && !line.trim().startsWith('//')
    );
    expect(finishCalls).toEqual([]);
  });
});
