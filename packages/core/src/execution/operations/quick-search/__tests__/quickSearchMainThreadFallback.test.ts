import { describe, expect, it, vi } from 'vitest';

import * as rowAggregateText from '../../../../features/quick-search/rowAggregateText';
import type { CooperativeSchedulerBackend } from '../../../../scheduling/CooperativeScheduler';
import { CooperativeScheduler } from '../../../../scheduling/CooperativeScheduler';
import type { ColumnDef, RowData } from '../../../../types';
import {
  DEFAULT_FALLBACK_MAX_ROWS_PER_CHUNK,
  DEFAULT_FALLBACK_TIME_BUDGET_MS,
  executeQuickSearchMainThreadFallback,
} from '../quickSearchMainThreadFallback';

function createManualBackend(): CooperativeSchedulerBackend & {
  flush(): void;
  pending(): number;
} {
  const queue: Array<{ cb: () => void; cancelled: boolean }> = [];
  return {
    schedule(cb) {
      const entry = { cb, cancelled: false };
      queue.push(entry);
      return {
        cancel() {
          entry.cancelled = true;
        },
      };
    },
    flush() {
      const snapshot = queue.splice(0);
      for (const entry of snapshot) {
        if (!entry.cancelled) entry.cb();
      }
    },
    pending() {
      return queue.filter((e) => !e.cancelled).length;
    },
  };
}

function col(partial: Partial<ColumnDef> & { field: string }): ColumnDef {
  return { ...partial };
}

const sampleRows: RowData[] = [
  { name: 'Alice', city: 'Lahore', balance: 2397, active: true, balanceSearch: '2397 2,397' },
  { name: 'Bob', city: 'London', balance: 100, active: false, balanceSearch: '100 100' },
  { name: 'Cara', city: 'Berlin', balance: 55, active: true, balanceSearch: '55 55' },
  { name: null, city: undefined, balance: null, active: undefined },
];

const sampleColumns: ColumnDef[] = [
  col({ field: 'name' }),
  col({ field: 'city' }),
  col({ field: 'balance' }),
  col({ field: 'active' }),
];

function runSync(config: Parameters<typeof executeQuickSearchMainThreadFallback>[0]): Uint32Array {
  let result: Uint32Array | null = null;
  executeQuickSearchMainThreadFallback(config, (indexes) => {
    result = indexes;
  });
  expect(result).not.toBeNull();
  return result!;
}

describe('quickSearchMainThreadFallback', () => {
  // ── 1. Default semantics ────────────────────────────────────────────

  it('matches text fields with default AND semantics', () => {
    expect(runSync({ rows: sampleRows, columns: sampleColumns, normalizedText: 'ALICE' })).toEqual(
      Uint32Array.from([0]),
    );
    expect(runSync({ rows: sampleRows, columns: sampleColumns, normalizedText: 'ALICE LAHORE' })).toEqual(
      Uint32Array.from([0]),
    );
    expect(runSync({ rows: sampleRows, columns: sampleColumns, normalizedText: 'ALICE LONDON' })).toEqual(
      new Uint32Array(0),
    );
  });

  it('matches number and boolean values via normalization', () => {
    expect(runSync({ rows: sampleRows, columns: sampleColumns, normalizedText: '2397' })).toEqual(
      Uint32Array.from([0]),
    );
    expect(runSync({ rows: sampleRows, columns: sampleColumns, normalizedText: 'TRUE' })).toEqual(
      Uint32Array.from([0, 2]),
    );
    expect(runSync({ rows: sampleRows, columns: sampleColumns, normalizedText: 'FALSE' })).toEqual(
      Uint32Array.from([1]),
    );
  });

  it('treats null and undefined field values as empty searchable text', () => {
    expect(runSync({ rows: sampleRows, columns: sampleColumns, normalizedText: 'BERLIN' })).toEqual(
      Uint32Array.from([2]),
    );
    expect(
      runSync({ rows: sampleRows, columns: [col({ field: 'name' })], normalizedText: 'NULL' }),
    ).toEqual(new Uint32Array(0));
    expect(
      runSync({ rows: sampleRows, columns: [col({ field: 'name' })], normalizedText: 'ALICE' }),
    ).toEqual(Uint32Array.from([0]));
  });

  it('matches query parts across different fields', () => {
    expect(runSync({ rows: sampleRows, columns: sampleColumns, normalizedText: 'BOB LONDON' })).toEqual(
      Uint32Array.from([1]),
    );
  });

  it('normalizes rawText through the shared normalizer', () => {
    expect(
      runSync({ rows: sampleRows, columns: sampleColumns, rawText: 'alice lahore' }),
    ).toEqual(Uint32Array.from([0]));
  });

  // ── 2. Column behavior ──────────────────────────────────────────────

  it('excludes searchable: false columns', () => {
    const rows = [{ secret: 'HIDDEN', name: 'Alice' }];
    const columns = [col({ field: 'name' }), col({ field: 'secret', searchable: false })];
    expect(runSync({ rows, columns, normalizedText: 'HIDDEN' })).toEqual(new Uint32Array(0));
    expect(runSync({ rows, columns, normalizedText: 'ALICE' })).toEqual(Uint32Array.from([0]));
  });

  it('excludes hidden columns unless includeHiddenColumns is true', () => {
    const rows = [{ name: 'Alice', secret: 'TOPSECRET' }];
    const columns = [col({ field: 'name' }), col({ field: 'secret', visible: false })];
    expect(runSync({ rows, columns, normalizedText: 'TOPSECRET' })).toEqual(new Uint32Array(0));
    expect(
      runSync({ rows, columns, normalizedText: 'TOPSECRET', includeHiddenColumns: true }),
    ).toEqual(Uint32Array.from([0]));
  });

  it('reads dot-path projection fields', () => {
    const rows = [{ profile: { search: 'deep value' } }];
    const columns = [col({ field: 'profile.search' })];
    expect(runSync({ rows, columns, normalizedText: 'DEEP' })).toEqual(Uint32Array.from([0]));
  });

  it('uses quickFilterTextField projection instead of raw field', () => {
    const rows = [{ balance: 2397, balanceSearch: '2397 2,397' }];
    const columns = [col({ field: 'balance', quickFilterTextField: 'balanceSearch' })];
    expect(runSync({ rows, columns, normalizedText: '2,397' })).toEqual(Uint32Array.from([0]));
  });

  it('quickFilterTextField takes precedence over getQuickFilterText', () => {
    const extractor = vi.fn(({ value }: { value: unknown }) => `custom:${value}`);
    const rows = [{ balance: 2397, balanceSearch: '2397 2,397' }];
    const columns = [
      col({
        field: 'balance',
        quickFilterTextField: 'balanceSearch',
        getQuickFilterText: extractor,
      }),
    ];
    expect(runSync({ rows, columns, normalizedText: '2,397' })).toEqual(Uint32Array.from([0]));
    expect(extractor).not.toHaveBeenCalled();
  });

  it('getQuickFilterText is used when no projection field is configured', () => {
    const extractor = vi.fn(({ value }: { value: unknown }) => `custom:${value}`);
    const rows = [{ balance: 2397 }];
    const columns = [
      col({
        field: 'balance',
        getQuickFilterText: extractor,
      }),
    ];
    expect(runSync({ rows, columns, normalizedText: 'CUSTOM:2397' })).toEqual(Uint32Array.from([0]));
    expect(extractor).toHaveBeenCalled();
  });

  // ── 3. Custom parser / matcher ──────────────────────────────────────

  it('uses a custom parser on normalized text', () => {
    const parser = vi.fn((text: string) => text.split('|'));
    const onComplete = vi.fn();
    executeQuickSearchMainThreadFallback(
      { rows: sampleRows, columns: sampleColumns, normalizedText: 'ALICE|LAHORE', parser },
      onComplete,
    );
    expect(parser).toHaveBeenCalledTimes(1);
    expect(parser).toHaveBeenCalledWith('ALICE|LAHORE');
    expect(onComplete).toHaveBeenCalledWith(Uint32Array.from([0]));
  });

  it('uses a custom matcher with rowText and queryParts', () => {
    const matcher = vi.fn(({ rowText, queryParts }: { rowText: string; queryParts: string[] }) =>
      rowText.startsWith(queryParts[0] ?? ''),
    );
    const onComplete = vi.fn();
    executeQuickSearchMainThreadFallback(
      { rows: sampleRows, columns: [col({ field: 'name' })], normalizedText: 'AL', matcher },
      onComplete,
    );
    expect(matcher).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(Uint32Array.from([0]));
  });

  // ── 4. Source indexes ───────────────────────────────────────────────

  it('returns identity source indexes when sourceIndexes is null', () => {
    expect(runSync({ rows: sampleRows, columns: sampleColumns, normalizedText: 'BOB', sourceIndexes: null })).toEqual(
      Uint32Array.from([1]),
    );
  });

  it('preserves provided source index order in results', () => {
    const sourceIndexes = Uint32Array.from([2, 0, 1]);
    expect(
      runSync({
        rows: sampleRows,
        columns: sampleColumns,
        normalizedText: 'TRUE',
        sourceIndexes,
      }),
    ).toEqual(Uint32Array.from([2, 0]));
  });

  it('searches only rows referenced by sourceIndexes', () => {
    const sourceIndexes = Uint32Array.from([1]);
    expect(
      runSync({
        rows: sampleRows,
        columns: sampleColumns,
        normalizedText: 'ALICE',
        sourceIndexes,
      }),
    ).toEqual(new Uint32Array(0));
  });

  // ── 5. Empty query ──────────────────────────────────────────────────

  it('does no work for blank normalized text', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const onComplete = vi.fn();
    const aggregateSpy = vi.spyOn(rowAggregateText, 'buildNormalizedRowAggregateText');

    const handle = executeQuickSearchMainThreadFallback(
      { rows: sampleRows, columns: sampleColumns, normalizedText: '   ', scheduler },
      onComplete,
    );

    expect(onComplete).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(0);
    expect(aggregateSpy).not.toHaveBeenCalled();
    expect(() => handle.cancel()).not.toThrow();
    aggregateSpy.mockRestore();
  });

  it('does no work when parser returns no parts', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const onComplete = vi.fn();
    const parser = () => [] as string[];

    executeQuickSearchMainThreadFallback(
      { rows: sampleRows, columns: sampleColumns, normalizedText: 'ALICE', parser, scheduler },
      onComplete,
    );

    expect(onComplete).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(0);
  });

  // ── 6. Chunking ─────────────────────────────────────────────────────

  it('schedules the first chunk for large inputs instead of running synchronously', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const rows = Array.from({ length: 10 }, (_, i) => ({ name: `Row${i}` }));
    const onComplete = vi.fn();

    executeQuickSearchMainThreadFallback(
      {
        rows,
        columns: [col({ field: 'name' })],
        normalizedText: 'ROW',
        scheduler,
        smallInputThreshold: 3,
      },
      onComplete,
    );

    expect(onComplete).not.toHaveBeenCalled();
    expect(backend.pending()).toBeGreaterThan(0);

    while (backend.pending() > 0) backend.flush();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]![0]).toBeInstanceOf(Uint32Array);
    expect(onComplete.mock.calls[0]![0].length).toBe(10);
  });

  it('yields when the time budget is exhausted', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const rows = Array.from({ length: 6 }, (_, i) => ({ name: `Row${i}` }));
    const onComplete = vi.fn();
    let clock = 0;
    const now = () => {
      clock += 5;
      return clock;
    };

    executeQuickSearchMainThreadFallback(
      {
        rows,
        columns: [col({ field: 'name' })],
        normalizedText: 'ROW',
        scheduler,
        smallInputThreshold: 0,
        maxRowsPerChunk: 100,
        timeBudgetMs: 8,
        now,
      },
      onComplete,
    );

    expect(onComplete).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(1);

    backend.flush();
    expect(onComplete).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(1);

    backend.flush();
    expect(onComplete).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(1);

    backend.flush();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('caps each chunk by maxRowsPerChunk', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const rows = Array.from({ length: 5 }, (_, i) => ({ name: `Row${i}` }));
    const onComplete = vi.fn();

    executeQuickSearchMainThreadFallback(
      {
        rows,
        columns: [col({ field: 'name' })],
        normalizedText: 'ROW',
        scheduler,
        smallInputThreshold: 0,
        maxRowsPerChunk: 2,
        timeBudgetMs: 1_000,
        now: () => 0,
      },
      onComplete,
    );

    expect(backend.pending()).toBe(1);
    backend.flush();
    expect(onComplete).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(1);
    backend.flush();
    expect(onComplete).not.toHaveBeenCalled();
    backend.flush();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('exports default chunking constants for tests', () => {
    expect(DEFAULT_FALLBACK_TIME_BUDGET_MS).toBe(8);
    expect(DEFAULT_FALLBACK_MAX_ROWS_PER_CHUNK).toBe(5000);
  });

  // ── 7. Cancellation ─────────────────────────────────────────────────

  it('cancels before the first scheduled chunk runs', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const onComplete = vi.fn();
    const rows = Array.from({ length: 10 }, (_, i) => ({ name: `Row${i}` }));

    const handle = executeQuickSearchMainThreadFallback(
      {
        rows,
        columns: [col({ field: 'name' })],
        normalizedText: 'ROW',
        scheduler,
        smallInputThreshold: 0,
      },
      onComplete,
    );

    expect(backend.pending()).toBe(1);
    handle.cancel();
    backend.flush();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('cancels mid-run without completing', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const onComplete = vi.fn();
    const rows = Array.from({ length: 10 }, (_, i) => ({ name: `Row${i}` }));

    const handle = executeQuickSearchMainThreadFallback(
      {
        rows,
        columns: [col({ field: 'name' })],
        normalizedText: 'ROW',
        scheduler,
        smallInputThreshold: 0,
        maxRowsPerChunk: 2,
        timeBudgetMs: 1_000,
        now: () => 0,
      },
      onComplete,
    );

    backend.flush();
    expect(onComplete).not.toHaveBeenCalled();
    handle.cancel();
    backend.flush();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('allows a new execution after cancel without stale completion', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const rows = Array.from({ length: 10 }, (_, i) => ({ name: i === 0 ? 'Alice' : `Row${i}` }));
    const firstComplete = vi.fn();
    const secondComplete = vi.fn();

    const first = executeQuickSearchMainThreadFallback(
      {
        rows,
        columns: [col({ field: 'name' })],
        normalizedText: 'ALICE',
        scheduler,
        smallInputThreshold: 0,
        maxRowsPerChunk: 1,
        timeBudgetMs: 1_000,
        now: () => 0,
      },
      firstComplete,
    );

    backend.flush();
    first.cancel();
    backend.flush();
    expect(firstComplete).not.toHaveBeenCalled();

    executeQuickSearchMainThreadFallback(
      {
        rows,
        columns: [col({ field: 'name' })],
        normalizedText: 'ALICE',
        scheduler,
        smallInputThreshold: 10,
      },
      secondComplete,
    );

    expect(secondComplete).toHaveBeenCalledWith(Uint32Array.from([0]));
  });

  // ── 8. Result shape ─────────────────────────────────────────────────

  it('returns Uint32Array source row indexes', () => {
    const indexes = runSync({ rows: sampleRows, columns: sampleColumns, normalizedText: 'BOB' });
    expect(indexes).toBeInstanceOf(Uint32Array);
    expect(Array.from(indexes)).toEqual([1]);
  });
});
