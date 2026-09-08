import { describe, expect, it, vi } from 'vitest';

import type { CooperativeSchedulerBackend } from '../../../scheduling/CooperativeScheduler';
import { CooperativeScheduler } from '../../../scheduling/CooperativeScheduler';
import { createNormalizer } from '../normalizer';
import type { SearchableFieldDescriptor } from '../searchableFieldResolver';
import { extractSnapshotSync } from '../snapshotExtractor';
import {
  estimateSearchableRowBytes,
  extractSnapshotPatchSubset,
  type SnapshotPatchExtractionResult,
} from '../snapshotPatchExtractor';

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

function runPatch(
  config: Parameters<typeof extractSnapshotPatchSubset>[0],
  backend: ReturnType<typeof createManualBackend>,
): SnapshotPatchExtractionResult | undefined {
  let result: SnapshotPatchExtractionResult | undefined;
  extractSnapshotPatchSubset(config, (r) => {
    result = r;
  });
  backend.flush();
  return result;
}

describe('extractSnapshotPatchSubset', () => {
  it('custom iterable proves zero source-index consumption before scheduler execution', () => {
    const backend = createManualBackend();
    let consumed = 0;
    const iterable: Iterable<number> = {
      [Symbol.iterator]() {
        const values = [0, 1];
        let i = 0;
        return {
          next() {
            if (i >= values.length) return { done: true, value: undefined };
            consumed += 1;
            return { done: false, value: values[i++]! };
          },
        };
      },
    };

    let result: SnapshotPatchExtractionResult | undefined;
    extractSnapshotPatchSubset(
      {
        rows,
        descriptors: [desc('name')],
        sourceIndexes: iterable,
        scheduler: new CooperativeScheduler(backend),
      },
      (r) => {
        result = r;
      },
    );

    expect(backend.pending()).toBe(1);
    expect(consumed).toBe(0);
    expect(result).toBeUndefined();

    backend.flush();
    expect(consumed).toBe(2);
    expect(result?.kind).toBe('patch');
  });

  it('does not read the first row before the scheduler runs', () => {
    const backend = createManualBackend();
    const scheduler = new CooperativeScheduler(backend);
    let reads = 0;
    const tracked = rows.map((r) =>
      new Proxy(r, {
        get(target, prop, receiver) {
          reads += 1;
          return Reflect.get(target, prop, receiver);
        },
      }),
    );

    let result: SnapshotPatchExtractionResult | undefined;
    extractSnapshotPatchSubset(
      {
        rows: tracked,
        descriptors: [desc('name')],
        sourceIndexes: [1],
        scheduler,
      },
      (r) => {
        result = r;
      },
    );

    expect(backend.pending()).toBe(1);
    expect(reads).toBe(0);
    expect(result).toBeUndefined();

    backend.flush();
    expect(reads).toBeGreaterThan(0);
    expect(result?.kind).toBe('patch');
  });

  it('ReadonlySet<number> works directly', () => {
    const backend = createManualBackend();
    const result = runPatch(
      {
        rows,
        descriptors: [desc('name')],
        sourceIndexes: new Set([2, 0, 2]),
        scheduler: new CooperativeScheduler(backend),
      },
      backend,
    );

    expect(result?.kind).toBe('patch');
    if (result?.kind === 'patch') {
      expect(result.totalUniqueRows).toBe(2);
      expect(result.chunks.flat().map((r) => r.rowIndex)).toEqual([2, 0]);
    }
  });

  it('reads only the supplied source indexes', () => {
    const backend = createManualBackend();
    const readIndexes: number[] = [];
    const tracked = rows.map((r, i) =>
      new Proxy(r, {
        get(target, prop, receiver) {
          if (typeof prop === 'string') readIndexes.push(i);
          return Reflect.get(target, prop, receiver);
        },
      }),
    );

    const result = runPatch(
      {
        rows: tracked,
        descriptors: [desc('name')],
        sourceIndexes: [0, 2],
        scheduler: new CooperativeScheduler(backend),
      },
      backend,
    );

    expect(result?.kind).toBe('patch');
    expect(new Set(readIndexes)).toEqual(new Set([0, 2]));
    if (result?.kind === 'patch') {
      expect(result.chunks.flat().map((r) => r.rowIndex)).toEqual([0, 2]);
    }
  });

  it('dedupes duplicate indexes using the latest current row value', () => {
    const backend = createManualBackend();
    const mutable = [
      { name: 'Alice' },
      { name: 'Bob' },
      { name: 'Cara' },
    ];
    mutable[1] = { name: 'Bobby' };

    const result = runPatch(
      {
        rows: mutable,
        descriptors: [desc('name')],
        sourceIndexes: [1, 1, 1],
        scheduler: new CooperativeScheduler(backend),
      },
      backend,
    );

    expect(result).toMatchObject({
      kind: 'patch',
      totalUniqueRows: 1,
      totalChunks: 1,
      chunks: [[{ rowIndex: 1, values: ['BOBBY'] }]],
    });
  });

  it('large duplicate input is cooperatively split and bounded by max input occurrences', () => {
    const backend = createManualBackend();
    let steps = 0;
    const onComplete = vi.fn();

    extractSnapshotPatchSubset(
      {
        rows,
        descriptors: [desc('name')],
        sourceIndexes: (function* () {
          for (let i = 0; i < 100; i++) yield 0;
        })(),
        maxInputIndexes: 20,
        maxIndexesPerContinuation: 5,
        budgetMs: 1_000_000,
        now: () => 0,
        scheduler: new CooperativeScheduler(backend),
      },
      onComplete,
    );

    while (backend.pending() > 0 && steps < 20) {
      backend.step();
      steps += 1;
      if (onComplete.mock.calls.length > 0) break;
    }

    expect(steps).toBeGreaterThan(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]![0]).toEqual({
      kind: 'rebuild-required',
      reason: 'transaction-row-limit',
    });
  });

  it('matches full snapshot projection and normalization for the same indexes', () => {
    const backend = createManualBackend();
    const normalizer = createNormalizer();
    const descriptors = [desc('balance', 'balanceSearch'), desc('name')];
    const full = extractSnapshotSync({
      rows,
      descriptors,
      normalizer,
    });

    const result = runPatch(
      {
        rows,
        descriptors,
        normalizer,
        sourceIndexes: [0, 2],
        scheduler: new CooperativeScheduler(backend),
      },
      backend,
    );

    expect(result?.kind).toBe('patch');
    if (result?.kind === 'patch') {
      expect(result.chunks.flat()).toEqual([full[0], full[2]]);
    }
  });

  it('row cap produces multiple bounded chunks', () => {
    const backend = createManualBackend();
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `R${i}` }));
    const result = runPatch(
      {
        rows: many,
        descriptors: [desc('name')],
        sourceIndexes: many.map((_, i) => i),
        maxRowsPerChunk: 3,
        minRowsPerChunk: 1,
        budgetMs: 1_000_000,
        now: () => 0,
        scheduler: new CooperativeScheduler(backend),
      },
      backend,
    );

    expect(result?.kind).toBe('patch');
    if (result?.kind === 'patch') {
      expect(result.totalUniqueRows).toBe(10);
      expect(result.totalChunks).toBe(4);
      expect(result.chunks.map((c) => c.length)).toEqual([3, 3, 3, 1]);
    }
  });

  it('byte cap produces bounded chunks and projects each row once', () => {
    const backend = createManualBackend();
    const many = Array.from({ length: 6 }, (_, i) => ({
      name: `Row-${i}-${'x'.repeat(20)}`,
    }));
    const fieldReads = new Map<number, number>();
    const tracked = many.map((r, i) =>
      new Proxy(r, {
        get(target, prop, receiver) {
          if (prop === 'name') {
            fieldReads.set(i, (fieldReads.get(i) ?? 0) + 1);
          }
          return Reflect.get(target, prop, receiver);
        },
      }),
    );
    const sample = {
      rowIndex: 0,
      values: [createNormalizer().normalizeValue(many[0]!.name)],
    };
    const rowBytes = estimateSearchableRowBytes(sample);

    const result = runPatch(
      {
        rows: tracked,
        descriptors: [desc('name')],
        sourceIndexes: many.map((_, i) => i),
        maxRowsPerChunk: 100,
        maxBytesPerChunk: rowBytes * 2 + 8,
        minRowsPerChunk: 1,
        budgetMs: 1_000_000,
        now: () => 0,
        scheduler: new CooperativeScheduler(backend),
      },
      backend,
    );

    expect(result?.kind).toBe('patch');
    if (result?.kind === 'patch') {
      expect(result.totalChunks).toBeGreaterThan(1);
      for (const chunk of result.chunks) {
        let bytes = 0;
        for (const row of chunk) bytes += estimateSearchableRowBytes(row);
        expect(bytes).toBeLessThanOrEqual(rowBytes * 2 + 8);
      }
      expect(result.totalUniqueRows).toBe(6);
      for (let i = 0; i < 6; i++) {
        expect(fieldReads.get(i)).toBe(1);
      }
    }
  });

  it('injected monotonic clock proves time-budget yielding', () => {
    const backend = createManualBackend();
    let t = 0;
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `R${i}` }));

    const result = runPatch(
      {
        rows: many,
        descriptors: [desc('name')],
        sourceIndexes: many.map((_, i) => i),
        maxRowsPerChunk: 100,
        minRowsPerChunk: 2,
        budgetMs: 5,
        now: () => {
          const cur = t;
          t += 3;
          return cur;
        },
        scheduler: new CooperativeScheduler(backend),
      },
      backend,
    );

    expect(result?.kind).toBe('patch');
    if (result?.kind === 'patch') {
      expect(result.totalChunks).toBeGreaterThan(1);
      expect(result.chunks.every((c) => c.length >= 1)).toBe(true);
      expect(result.totalUniqueRows).toBe(8);
    }
  });

  it('time expiry cuts work even when minRowsPerChunk is larger', () => {
    const backend = createManualBackend();
    let t = 0;
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `R${i}` }));

    const result = runPatch(
      {
        rows: many,
        descriptors: [desc('name')],
        sourceIndexes: many.map((_, i) => i),
        maxRowsPerChunk: 100,
        minRowsPerChunk: 50,
        budgetMs: 1,
        now: () => {
          const cur = t;
          t += 10;
          return cur;
        },
        scheduler: new CooperativeScheduler(backend),
      },
      backend,
    );

    expect(result?.kind).toBe('patch');
    if (result?.kind === 'patch') {
      expect(result.totalChunks).toBeGreaterThan(1);
      expect(result.chunks.every((c) => c.length < 50)).toBe(true);
      expect(result.totalUniqueRows).toBe(10);
    }
  });

  it('transaction row limit returns rebuild-required asynchronously without projecting', () => {
    const backend = createManualBackend();
    const spy = vi.fn(() => {
      throw new Error('should not project');
    });
    const guarded = rows.map((r) =>
      new Proxy(r, {
        get(target, prop, receiver) {
          spy();
          return Reflect.get(target, prop, receiver);
        },
      }),
    );

    let result: SnapshotPatchExtractionResult | undefined;
    extractSnapshotPatchSubset(
      {
        rows: guarded,
        descriptors: [desc('name')],
        sourceIndexes: [0, 1, 2],
        maxUniqueRows: 2,
        scheduler: new CooperativeScheduler(backend),
      },
      (r) => {
        result = r;
      },
    );

    expect(result).toBeUndefined();
    expect(backend.pending()).toBe(1);
    backend.flush();
    expect(result).toEqual({
      kind: 'rebuild-required',
      reason: 'transaction-row-limit',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('empty source indexes complete asynchronously with zero chunks', () => {
    const backend = createManualBackend();
    let result: SnapshotPatchExtractionResult | undefined;
    extractSnapshotPatchSubset(
      {
        rows,
        descriptors: [desc('name')],
        sourceIndexes: [],
        scheduler: new CooperativeScheduler(backend),
      },
      (r) => {
        result = r;
      },
    );
    expect(result).toBeUndefined();
    expect(backend.pending()).toBe(1);
    backend.flush();
    expect(result).toEqual({
      kind: 'patch',
      chunks: [],
      totalUniqueRows: 0,
      totalChunks: 0,
      totalEstimatedBytes: 0,
    });
  });

  it('transaction byte limit returns rebuild-required', () => {
    const backend = createManualBackend();
    const result = runPatch(
      {
        rows,
        descriptors: [desc('name')],
        sourceIndexes: [0, 1, 2],
        maxTransactionBytes: 1,
        minRowsPerChunk: 1,
        maxRowsPerChunk: 10,
        scheduler: new CooperativeScheduler(backend),
      },
      backend,
    );

    expect(result).toEqual({
      kind: 'rebuild-required',
      reason: 'transaction-byte-limit',
    });
  });

  it('invalid source indexes return rebuild-required asynchronously', () => {
    const backend = createManualBackend();
    let result: SnapshotPatchExtractionResult | undefined;
    extractSnapshotPatchSubset(
      {
        rows,
        descriptors: [desc('name')],
        sourceIndexes: [0, 99],
        scheduler: new CooperativeScheduler(backend),
      },
      (r) => {
        result = r;
      },
    );
    expect(result).toBeUndefined();
    expect(backend.pending()).toBe(1);
    backend.flush();
    expect(result).toEqual({
      kind: 'rebuild-required',
      reason: 'invalid-source-index',
    });
  });

  it('cancellation before first continuation prevents completion', () => {
    const backend = createManualBackend();
    const onComplete = vi.fn();
    const handle = extractSnapshotPatchSubset(
      {
        rows,
        descriptors: [desc('name')],
        sourceIndexes: [0, 1],
        scheduler: new CooperativeScheduler(backend),
      },
      onComplete,
    );
    expect(backend.pending()).toBe(1);
    handle.cancel();
    backend.flush();
    expect(onComplete).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(0);
  });

  it('cancellation during index collection prevents projection and completion', () => {
    const backend = createManualBackend();
    const onComplete = vi.fn();
    let reads = 0;
    const tracked = rows.map((r) =>
      new Proxy(r, {
        get(target, prop, receiver) {
          reads += 1;
          return Reflect.get(target, prop, receiver);
        },
      }),
    );

    const handle = extractSnapshotPatchSubset(
      {
        rows: tracked,
        descriptors: [desc('name')],
        sourceIndexes: (function* () {
          for (let i = 0; i < 50; i++) yield i % 3;
        })(),
        maxIndexesPerContinuation: 2,
        budgetMs: 1_000_000,
        now: () => 0,
        scheduler: new CooperativeScheduler(backend),
      },
      onComplete,
    );

    backend.step();
    expect(onComplete).not.toHaveBeenCalled();
    expect(reads).toBe(0);
    expect(backend.pending()).toBe(1);
    handle.cancel();
    backend.flush();
    expect(onComplete).not.toHaveBeenCalled();
    expect(reads).toBe(0);
  });

  it('cancellation mid-extraction prevents completion and further projection', () => {
    const backend = createManualBackend();
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `R${i}` }));
    const onComplete = vi.fn();
    const handle = extractSnapshotPatchSubset(
      {
        rows: many,
        descriptors: [desc('name')],
        sourceIndexes: many.map((_, i) => i),
        maxRowsPerChunk: 2,
        minRowsPerChunk: 1,
        budgetMs: 1_000_000,
        now: () => 0,
        scheduler: new CooperativeScheduler(backend),
      },
      onComplete,
    );

    backend.step();
    expect(onComplete).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(1);
    handle.cancel();
    backend.flush();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('result reports exact totals and estimated bytes', () => {
    const backend = createManualBackend();
    const result = runPatch(
      {
        rows,
        descriptors: [desc('name'), desc('city')],
        sourceIndexes: [0, 2, 0],
        maxRowsPerChunk: 1,
        minRowsPerChunk: 1,
        budgetMs: 1_000_000,
        now: () => 0,
        scheduler: new CooperativeScheduler(backend),
      },
      backend,
    );

    expect(result?.kind).toBe('patch');
    if (result?.kind === 'patch') {
      expect(result.totalUniqueRows).toBe(2);
      expect(result.totalChunks).toBe(2);
      let bytes = 0;
      for (const chunk of result.chunks) {
        for (const row of chunk) bytes += estimateSearchableRowBytes(row);
      }
      expect(result.totalEstimatedBytes).toBe(bytes);
      for (const row of result.chunks.flat()) {
        expect(Object.keys(row).sort()).toEqual(['rowIndex', 'values']);
      }
    }
  });
});
