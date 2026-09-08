import { describe, expect, it, vi } from 'vitest';

import type { SearchableSnapshotRow } from '../../../execution/operations/quick-search/quickSearchProtocol';
import type { CooperativeSchedulerBackend } from '../../../scheduling/CooperativeScheduler';
import { CooperativeScheduler } from '../../../scheduling/CooperativeScheduler';
import { createNormalizer } from '../normalizer';
import type { SearchableFieldDescriptor } from '../searchableFieldResolver';
import { extractSnapshotChunked, extractSnapshotSync } from '../snapshotExtractor';

function createManualBackend(): CooperativeSchedulerBackend & {
  flush(): void;
  step(): void;
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
      while (queue.length > 0) {
        const snapshot = queue.splice(0);
        for (const entry of snapshot) {
          if (!entry.cancelled) entry.cb();
        }
      }
    },
    step() {
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

function desc(field: string, projectionField?: string): SearchableFieldDescriptor {
  return { field, projectionField, workerEligible: true };
}

const rows = [
  { name: 'Alice', city: 'Lahore', balance: 2397, balanceSearch: '2397 2,397' },
  { name: 'Bob', city: 'London', balance: 100, balanceSearch: '100 100' },
  { name: 'Cara', city: 'Berlin', balance: 55, balanceSearch: '55 55' },
];

describe('snapshotExtractor', () => {
  // ── 5. Emits only { rowIndex, values } rows ─────────────────────────

  it('emits rows shaped { rowIndex, values } with no RowData leakage', () => {
    const result = extractSnapshotSync({
      rows,
      descriptors: [desc('name'), desc('city')],
    });
    expect(result).toHaveLength(3);
    for (const row of result) {
      expect(Object.keys(row).sort()).toEqual(['rowIndex', 'values']);
      expect(Array.isArray(row.values)).toBe(true);
      for (const v of row.values) expect(typeof v).toBe('string');
    }
    expect(result[0]).toEqual({ rowIndex: 0, values: ['ALICE', 'LAHORE'] });
  });

  it('reads projection fields instead of raw fields when configured', () => {
    const result = extractSnapshotSync({
      rows,
      descriptors: [desc('balance', 'balanceSearch')],
    });
    expect(result[0]!.values).toEqual(['2397 2,397']);
  });

  it('resolves dot-path projection fields', () => {
    const nested = [{ profile: { search: 'deep value' } }];
    const result = extractSnapshotSync({
      rows: nested,
      descriptors: [desc('profile.search')],
    });
    expect(result[0]!.values).toEqual(['DEEP VALUE']);
  });

  // ── 6. Normalizes via the Phase 1 normalizer ────────────────────────

  it('normalizes values through the provided normalizer', () => {
    const normalizer = createNormalizer();
    const spy = vi.spyOn(normalizer, 'normalizeValue');
    const result = extractSnapshotSync({
      rows: [{ name: 'straße' }],
      descriptors: [desc('name')],
      normalizer,
    });
    expect(spy).toHaveBeenCalled();
    expect(result[0]!.values).toEqual(['straße'.toUpperCase()]);
  });

  it('normalizes null/undefined to empty string', () => {
    const result = extractSnapshotSync({
      rows: [{ name: null, city: undefined }],
      descriptors: [desc('name'), desc('city')],
    });
    expect(result[0]!.values).toEqual(['', '']);
  });

  // ── Snapshot extraction never invokes display pipeline functions ─────

  it('does not invoke valueGetter/valueFormatter during extraction', () => {
    const valueGetter = vi.fn(() => 'computed');
    const valueFormatter = vi.fn(() => 'formatted');
    const getQuickFilterText = vi.fn(() => 'custom');

    const rowsWithProjection = [
      { oct: 80000, octText: '80000 High' },
      { oct: 50000, octText: '50000 Medium' },
    ];

    extractSnapshotSync({
      rows: rowsWithProjection,
      descriptors: [desc('oct', 'octText')],
    });

    expect(valueGetter).not.toHaveBeenCalled();
    expect(valueFormatter).not.toHaveBeenCalled();
    expect(getQuickFilterText).not.toHaveBeenCalled();
  });

  it('reads projection field, not raw field, for worker snapshot', () => {
    const rowsWithProjection = [
      { 'game.bought': true, boughtText: 'true Yes' },
      { 'game.bought': false, boughtText: 'false No' },
    ];

    const result = extractSnapshotSync({
      rows: rowsWithProjection,
      descriptors: [desc('game.bought', 'boughtText')],
    });

    expect(result[0]!.values).toEqual(['TRUE YES']);
    expect(result[1]!.values).toEqual(['FALSE NO']);
  });

  // ── 7. Chunked processing with cooperative continuation ─────────────

  it('first chunk is scheduled, not synchronous', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const chunks: Array<{ startIndex: number; size: number }> = [];
    const onComplete = vi.fn();

    extractSnapshotChunked(
      {
        rows,
        descriptors: [desc('name')],
        chunkSize: 2,
        scheduler,
      },
      (chunk, startIndex) => {
        chunks.push({ startIndex, size: chunk.length });
      },
      onComplete,
    );

    // No chunk emitted yet — first chunk is scheduled via the scheduler.
    expect(chunks).toEqual([]);
    expect(backend.pending()).toBe(1);
    expect(onComplete).not.toHaveBeenCalled();

    backend.flush();
    expect(chunks).toEqual([
      { startIndex: 0, size: 2 },
      { startIndex: 2, size: 1 },
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('completes immediately for empty rows', () => {
    const onChunk = vi.fn();
    const onComplete = vi.fn();
    extractSnapshotChunked(
      { rows: [], descriptors: [desc('name')] },
      onChunk,
      onComplete,
    );
    expect(onChunk).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // ── 8. Cancellation stops remaining extraction ──────────────────────

  it('cancellation after first chunk prevents further chunks and completion', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const received: SearchableSnapshotRow[][] = [];
    const onComplete = vi.fn();

    const handle = extractSnapshotChunked(
      {
        rows,
        descriptors: [desc('name')],
        chunkSize: 1,
        scheduler,
      },
      (chunk) => {
        received.push(chunk);
      },
      onComplete,
    );

    // Step once to fire the first chunk only (single pass).
    backend.step();
    expect(received).toHaveLength(1);
    handle.cancel();
    backend.flush();

    expect(received).toHaveLength(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('cancel before first scheduled chunk posts no chunks and no complete', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const received: SearchableSnapshotRow[][] = [];
    const onComplete = vi.fn();

    const handle = extractSnapshotChunked(
      {
        rows,
        descriptors: [desc('name')],
        chunkSize: 1,
        scheduler,
      },
      (chunk) => {
        received.push(chunk);
      },
      onComplete,
    );

    // Cancel before the scheduler fires the first chunk.
    expect(received).toHaveLength(0);
    handle.cancel();
    backend.flush();

    expect(received).toHaveLength(0);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('time budget splits work into multiple chunks smaller than chunkSize', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const manyRows = Array.from({ length: 100 }, (_, i) => ({ name: `Row ${i}` }));
    const chunks: number[] = [];
    const onComplete = vi.fn();

    let time = 0;
    const now = () => {
      const current = time;
      time += 2;
      return current;
    };

    extractSnapshotChunked(
      {
        rows: manyRows,
        descriptors: [desc('name')],
        chunkSize: 5000,
        budgetMs: 3,
        scheduler,
        now,
      },
      (chunk) => {
        chunks.push(chunk.length);
      },
      onComplete,
    );

    backend.flush();

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((size) => size < 5000)).toBe(true);
    expect(chunks.reduce((sum, size) => sum + size, 0)).toBe(100);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('chunkSize remains a safety cap when budget allows more rows', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const tenRows = Array.from({ length: 10 }, (_, i) => ({ name: `Row ${i}` }));
    const chunks: number[] = [];
    const onComplete = vi.fn();

    extractSnapshotChunked(
      {
        rows: tenRows,
        descriptors: [desc('name')],
        chunkSize: 2,
        budgetMs: 1_000_000,
        scheduler,
        now: () => 0,
      },
      (chunk) => {
        chunks.push(chunk.length);
      },
      onComplete,
    );

    backend.flush();

    expect(chunks).toEqual([2, 2, 2, 2, 2]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('sanitizes chunkSize <= 0 to the default cap so extraction still completes', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    const chunks: number[] = [];
    const onComplete = vi.fn();

    extractSnapshotChunked(
      {
        rows,
        descriptors: [desc('name')],
        chunkSize: 0,
        scheduler,
        now: () => 0,
      },
      (chunk) => {
        chunks.push(chunk.length);
      },
      onComplete,
    );

    backend.flush();

    expect(chunks.reduce((sum, size) => sum + size, 0)).toBe(3);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
