import { describe, expect, it, vi } from 'vitest';

import type {
  CooperativePriority,
  CooperativeScheduleOptions,
  CooperativeSchedulerBackend,
} from '../../../../scheduling/CooperativeScheduler';
import { CooperativeScheduler } from '../../../../scheduling/CooperativeScheduler';
import type {
  QuickSearchExecuteRequest,
  QuickSearchExecutionMeta,
  QuickSearchIndexIdentity,
  QuickSearchQueryEngineOptions,
} from '../quickSearchQueryEngine';
import { QuickSearchQueryEngine } from '../quickSearchQueryEngine';
import { QuickSearchSnapshotStore } from '../quickSearchSnapshotStore';
import { TrigramIndexBuilder, TrigramPostingsCompaction } from '../quickSearchTrigramIndex';

function createManualBackend(): CooperativeSchedulerBackend & {
  flush(): void;
  flushOne(): boolean;
  pending(): number;
  priorities: CooperativePriority[];
} {
  const queue: Array<{
    cb: () => void;
    cancelled: boolean;
    priority: CooperativePriority;
  }> = [];
  const priorities: CooperativePriority[] = [];
  return {
    priorities,
    schedule(cb, options?: CooperativeScheduleOptions) {
      const priority = options?.priority ?? 'user-visible';
      priorities.push(priority);
      const entry = { cb, cancelled: false, priority };
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
    flushOne() {
      while (queue.length > 0) {
        const entry = queue.shift()!;
        if (entry.cancelled) continue;
        entry.cb();
        return true;
      }
      return false;
    },
    pending() {
      return queue.filter((e) => !e.cancelled).length;
    },
  };
}

function makeStore(texts: string[]): QuickSearchSnapshotStore {
  const store = new QuickSearchSnapshotStore();
  store.start(1, texts.length);
  store.applyChunk(
    1,
    texts.map((text, i) => ({ rowIndex: i, values: [text] })),
  );
  store.markComplete(1);
  return store;
}

function makeEngine(
  texts: string[],
  options?: QuickSearchQueryEngineOptions,
) {
  const backend = createManualBackend();
  const store = makeStore(texts);
  const engine = new QuickSearchQueryEngine(
    store,
    new CooperativeScheduler(backend),
    options,
  );
  return { backend, store, engine };
}

function request(
  text: string,
  overrides?: Partial<QuickSearchExecuteRequest>,
): QuickSearchExecuteRequest {
  return {
    normalizedText: text,
    generation: 1,
    searchableFieldsKey: 'sf',
    normalizerSignature: 'n1',
    configSignature: 'c1',
    sourceSignature: 'src-full',
    sourceIndexes: null,
    chunkSize: 2,
    searchableDataRevision: 0,
    sourceLayoutRevision: 0,
    ...overrides,
  };
}

function indexIdentity(
  overrides?: Partial<QuickSearchIndexIdentity>,
): QuickSearchIndexIdentity {
  return {
    generation: 1,
    sourceLayoutRevision: 0,
    searchableDataRevision: 0,
    searchableFieldsKey: 'sf',
    normalizerSignature: 'n1',
    ...overrides,
  };
}

interface RunOutcome {
  result: Uint32Array | undefined;
  meta: QuickSearchExecutionMeta | undefined;
  completions: number;
}

function run(
  engine: QuickSearchQueryEngine,
  backend: { flush(): void },
  req: QuickSearchExecuteRequest,
): RunOutcome {
  const out: RunOutcome = { result: undefined, meta: undefined, completions: 0 };
  engine.execute(req, (indexes, meta) => {
    out.result = indexes;
    out.meta = meta;
    out.completions++;
  });
  backend.flush();
  return out;
}

describe('QuickSearchQueryEngine', () => {
  // ── Scan path ────────────────────────────────────────────────────────

  it('short query scans the full snapshot when sourceIndexes is null', () => {
    const { backend, engine } = makeEngine(['AX', 'BX', 'AY']);
    const out = run(engine, backend, request('A'));
    expect(out.meta?.path).toBe('scan');
    expect(Array.from(out.result!)).toEqual([0, 2]);
  });

  it('scan preserves provided sourceIndexes order', () => {
    const { backend, engine } = makeEngine(['A1', 'A2', 'A3', 'A4']);
    const out = run(
      engine,
      backend,
      request('A', { sourceIndexes: new Uint32Array([3, 0, 2]), sourceSignature: 'src-a' }),
    );
    expect(out.meta?.path).toBe('scan');
    expect(Array.from(out.result!)).toEqual([3, 0, 2]);
  });

  it('scan runs chunked through the cooperative scheduler', () => {
    const { backend, engine } = makeEngine(['A', 'B', 'A']);
    const out: { done: boolean } = { done: false };
    engine.execute(request('A', { chunkSize: 1 }), () => {
      out.done = true;
    });
    // First chunk ran synchronously; the rest is scheduled.
    expect(out.done).toBe(false);
    expect(backend.pending()).toBe(1);
    backend.flush();
    expect(out.done).toBe(true);
  });

  // ── Index path ───────────────────────────────────────────────────────

  it('indexable query uses trigram candidates and verification removes false positives', () => {
    // Row 0 has both trigrams of "ABCD" but not the substring.
    const { backend, engine } = makeEngine(['ABC BCD', 'XABCDY', 'ZZZ', 'QQQ']);
    const out = run(engine, backend, request('ABCD'));
    expect(out.meta?.path).toBe('index');
    expect(Array.from(out.result!)).toEqual([1]);
  });

  it('broad candidate ratio falls back to scan', () => {
    const { backend, engine } = makeEngine(['AAA1', 'AAA2', 'AAA3', 'BBB']);
    const out = run(engine, backend, request('AAA'));
    expect(out.meta?.path).toBe('scan');
    expect(Array.from(out.result!)).toEqual([0, 1, 2]);
  });

  it('index path respects sourceIndexes order', () => {
    const { backend, engine } = makeEngine(['ALICE', 'BOB', 'MALICE', 'CARA']);
    const out = run(
      engine,
      backend,
      request('ALICE', { sourceIndexes: new Uint32Array([2, 0]), sourceSignature: 'src-a' }),
    );
    expect(out.meta?.path).toBe('index');
    expect(Array.from(out.result!)).toEqual([2, 0]);
  });

  // ── Caches ───────────────────────────────────────────────────────────

  it('exact source-scoped repeat completes synchronously with zero row-text reads', () => {
    const { backend, store, engine } = makeEngine(['ALICE', 'BOB', 'MALICE', 'CARA']);
    const first = run(engine, backend, request('ALICE'));
    expect(first.meta?.path).toBe('index');

    const reads = vi.spyOn(store, 'getRowText');
    const out: RunOutcome = { result: undefined, meta: undefined, completions: 0 };
    engine.execute(request('ALICE'), (indexes, meta) => {
      out.result = indexes;
      out.meta = meta;
      out.completions++;
    });
    // Synchronous completion — no scheduler work, no reads.
    expect(out.completions).toBe(1);
    expect(out.meta?.path).toBe('cached-source-result');
    expect(Array.from(out.result!)).toEqual(Array.from(first.result!));
    expect(reads).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(0);
  });

  it('full-match cache reuses across source changes without row-text reads, preserving source order', () => {
    const { backend, store, engine } = makeEngine(['ALICE', 'BOB', 'MALICE']);
    // Full-dataset execution stores the full-match entry.
    run(engine, backend, request('ALICE'));

    const reads = vi.spyOn(store, 'getRowText');
    const out = run(
      engine,
      backend,
      request('ALICE', {
        sourceIndexes: new Uint32Array([2, 1, 0]),
        sourceSignature: 'src-b',
      }),
    );
    expect(out.meta?.path).toBe('full-match-intersect');
    // Source order (2 before 0), not ascending match order.
    expect(Array.from(out.result!)).toEqual([2, 0]);
    expect(reads).not.toHaveBeenCalled();
  });

  it('subset execution does not populate the full-match cache', () => {
    const { backend, engine } = makeEngine(['ALICE', 'ALICE B', 'BOB']);
    run(
      engine,
      backend,
      request('ALICE', { sourceIndexes: new Uint32Array([0]), sourceSignature: 'src-a' }),
    );

    // Same query against the full dataset must NOT hit full-match —
    // the subset result misses row 1.
    const out = run(engine, backend, request('ALICE'));
    expect(out.meta?.path).not.toBe('full-match-intersect');
    expect(Array.from(out.result!)).toEqual([0, 1]);
  });

  it('source-scoped cache stores and returns the final Uint32Array', () => {
    const { backend, engine } = makeEngine(['ALICE', 'BOB']);
    const first = run(engine, backend, request('ALICE'));
    const second = run(engine, backend, request('ALICE'));
    expect(second.meta?.path).toBe('cached-source-result');
    expect(second.result).toBeInstanceOf(Uint32Array);
    expect(second.result).toBe(first.result);
  });

  it('cacheMode false bypasses exact source cache and scans fresh', () => {
    const { backend, store, engine } = makeEngine(['ALICE', 'BOB', 'MALICE']);
    run(engine, backend, request('ALICE'));

    const reads = vi.spyOn(store, 'getRowText');
    const out = run(engine, backend, request('ALICE', { cacheMode: false }));

    expect(out.meta?.path).toBe('scan');
    expect(Array.from(out.result!)).toEqual([0, 2]);
    expect(reads).toHaveBeenCalled();
  });

  it('cacheMode false bypasses full-match cache across source changes', () => {
    const { backend, store, engine } = makeEngine(['ALICE', 'BOB', 'MALICE']);
    run(engine, backend, request('ALICE'));

    const reads = vi.spyOn(store, 'getRowText');
    const out = run(
      engine,
      backend,
      request('ALICE', {
        sourceIndexes: new Uint32Array([2, 1, 0]),
        sourceSignature: 'src-b',
        cacheMode: false,
      }),
    );

    expect(out.meta?.path).toBe('scan');
    expect(Array.from(out.result!)).toEqual([2, 0]);
    expect(reads).toHaveBeenCalled();
  });

  it('cacheMode false does not populate source or full-match caches', () => {
    const { backend, engine } = makeEngine(['ALICE', 'BOB', 'MALICE', 'CARA', 'DAN']);
    const disabled = run(engine, backend, request('ALICE', { cacheMode: false }));
    expect(disabled.meta?.path).toBe('scan');

    const enabled = run(engine, backend, request('ALICE'));
    expect(enabled.meta?.path).toBe('index');

    const subset = run(
      engine,
      backend,
      request('ALICE', {
        sourceIndexes: new Uint32Array([2, 1, 0]),
        sourceSignature: 'src-b',
      }),
    );
    expect(subset.meta?.path).toBe('full-match-intersect');
    expect(Array.from(subset.result!)).toEqual([2, 0]);
  });

  // ── Lazy narrowing ───────────────────────────────────────────────────

  it('forward typing verifies only previous candidates', () => {
    const { backend, store, engine } = makeEngine(['ALICE X', 'ALIGN Y', 'BOB', 'MALICE']);
    const first = run(engine, backend, request('ALI'));
    expect(Array.from(first.result!)).toEqual([0, 1, 3]);

    const reads = vi.spyOn(store, 'getRowText');
    const out = run(engine, backend, request('ALIC'));
    expect(out.meta?.path).toBe('lazy-narrow');
    expect(Array.from(out.result!)).toEqual([0, 3]);
    // Only the 3 previous candidates were read — not all 4 rows.
    expect(reads).toHaveBeenCalledTimes(3);
  });

  it('backspace does not use lazy narrowing', () => {
    const { backend, engine } = makeEngine(['ALICE', 'ALIGN', 'BOB']);
    run(engine, backend, request('ALICE'));
    const out = run(engine, backend, request('ALIC'));
    expect(out.meta?.path).not.toBe('lazy-narrow');
    expect(Array.from(out.result!)).toEqual([0]);
  });

  it('source change does not use lazy narrowing', () => {
    const { backend, engine } = makeEngine(['ALICE', 'ALIGN', 'BOB']);
    run(engine, backend, request('ALI'));
    const out = run(
      engine,
      backend,
      request('ALIC', { sourceIndexes: new Uint32Array([0, 1]), sourceSignature: 'src-b' }),
    );
    expect(out.meta?.path).not.toBe('lazy-narrow');
    expect(Array.from(out.result!)).toEqual([0]);
  });

  it('cacheMode false bypasses lazy narrowing state', () => {
    const { backend, store, engine } = makeEngine(['ALICE X', 'ALIGN Y', 'BOB', 'MALICE']);
    run(engine, backend, request('ALI'));

    const reads = vi.spyOn(store, 'getRowText');
    const out = run(engine, backend, request('ALIC', { cacheMode: false }));

    expect(out.meta?.path).toBe('scan');
    expect(Array.from(out.result!)).toEqual([0, 3]);
    expect(reads).toHaveBeenCalledTimes(4);
  });

  // ── Empty query ──────────────────────────────────────────────────────

  it('empty query passes through source order without caching', () => {
    const { backend, engine } = makeEngine(['A', 'B', 'C']);
    const withSource = run(
      engine,
      backend,
      request('', { sourceIndexes: new Uint32Array([2, 0]), sourceSignature: 'src-a' }),
    );
    expect(withSource.meta?.path).toBe('empty');
    expect(Array.from(withSource.result!)).toEqual([2, 0]);

    const noSource = run(engine, backend, request('   '));
    expect(noSource.meta?.path).toBe('empty');
    expect(Array.from(noSource.result!)).toEqual([0, 1, 2]);
  });

  // ── Cancellation ─────────────────────────────────────────────────────

  it('cancelling a scan prevents completion', () => {
    const { backend, engine } = makeEngine(['A', 'B', 'A']);
    const spy = vi.fn();
    const handle = engine.execute(request('A', { chunkSize: 1 }), spy);
    handle.cancel();
    backend.flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it('cancelling during index build prevents completion', () => {
    const { backend, engine } = makeEngine(['ALICE', 'BOB', 'CARA']);
    const spy = vi.fn();
    const handle = engine.execute(request('ALICE', { chunkSize: 1 }), spy);
    // First index-build chunk ran synchronously; continuation pending.
    expect(backend.pending()).toBe(1);
    handle.cancel();
    backend.flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it('a new execution runs correctly after a cancellation, with no stale completion', () => {
    const { backend, engine } = makeEngine(['ALICE', 'BOB', 'MALICE']);
    const stale = vi.fn();
    const handle = engine.execute(request('ALICE', { chunkSize: 1 }), stale);
    handle.cancel();
    backend.flush();

    const out = run(engine, backend, request('ALICE', { chunkSize: 1 }));
    expect(stale).not.toHaveBeenCalled();
    expect(out.completions).toBe(1);
    expect(Array.from(out.result!)).toEqual([0, 2]);
  });

  // ── Stale generation / incomplete snapshot guard ─────────────────────

  it('stale-generation request does no work, no completion, no cache write', () => {
    const { backend, store, engine } = makeEngine(['ALICE', 'BOB', 'MALICE', 'CARA']);
    const reads = vi.spyOn(store, 'getRowText');
    const spy = vi.fn();

    engine.execute(request('ALICE', { generation: 99 }), spy);
    backend.flush();

    expect(spy).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();       // no scan, no index build
    expect(backend.pending()).toBe(0);          // nothing scheduled

    // No cache was written under the stale key: a valid-generation run
    // must execute for real (index path), not hit a cached entry.
    const out = run(engine, backend, request('ALICE'));
    expect(out.meta?.path).toBe('index');
    expect(Array.from(out.result!)).toEqual([0, 2]);
  });

  it('incomplete snapshot request does no work and never completes', () => {
    const store = new QuickSearchSnapshotStore();
    store.start(1, 2);
    store.applyChunk(1, [{ rowIndex: 0, values: ['ALICE'] }]);
    // markComplete(1) intentionally NOT called.
    const backend = createManualBackend();
    const engine = new QuickSearchQueryEngine(store, new CooperativeScheduler(backend));
    const reads = vi.spyOn(store, 'getRowText');
    const spy = vi.fn();

    engine.execute(request('ALICE'), spy);
    backend.flush();

    expect(spy).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(0);
  });

  // ── Result shape ─────────────────────────────────────────────────────

  it('every completed result is a Uint32Array', () => {
    const { backend, engine } = makeEngine(['ALICE', 'AAA', 'AAA2', 'AAA3']);
    const outcomes = [
      run(engine, backend, request('')),                                   // empty
      run(engine, backend, request('A')),                                  // scan
      run(engine, backend, request('ALICE')),                              // index
      run(engine, backend, request('ALICE')),                              // cached
      run(engine, backend, request('AAA')),                                // broad → scan
      run(engine, backend, request('ALICE', {
        sourceIndexes: new Uint32Array([0]),
        sourceSignature: 'src-x',
      })),                                                                 // full-match ∩ source
    ];
    for (const out of outcomes) {
      expect(out.result).toBeInstanceOf(Uint32Array);
    }
  });

  it('reset after commitPatch clears caches so pre-patch indexes cannot return', () => {
    const { backend, store, engine } = makeEngine(['ALICE', 'BOB']);
    const first = run(engine, backend, request('ALICE', { cacheMode: true }));
    expect(Array.from(first.result!)).toEqual([0]);
    expect(first.meta?.path).not.toBe('scan');

    expect(store.commitPatch(1, new Map([[0, 'ZEBRA']]))).toBe(true);
    engine.reset();

    const cached = run(
      engine,
      backend,
      request('ALICE', { cacheMode: true, searchableDataRevision: 1 }),
    );
    expect(Array.from(cached.result!)).toEqual([]);

    const patched = run(
      engine,
      backend,
      request('ZEBRA', { cacheMode: true, searchableDataRevision: 1 }),
    );
    expect(Array.from(patched.result!)).toEqual([0]);
  });

  it('reset prevents lazy narrowing from pre-patch candidates', () => {
    const { backend, store, engine } = makeEngine(['ALICE', 'ALAN', 'BOB']);
    const first = run(engine, backend, request('AL', { cacheMode: true }));
    expect(first.meta?.path).toBeDefined();

    expect(store.commitPatch(1, new Map([[0, 'ZEBRA']]))).toBe(true);
    engine.reset();

    const narrowed = run(
      engine,
      backend,
      request('ALI', { cacheMode: true, searchableDataRevision: 1 }),
    );
    expect(narrowed.meta?.path).not.toBe('lazy-narrow');
    expect(Array.from(narrowed.result!)).toEqual([]);
  });

  it('reset drops trigram index so rebuild uses patched text', () => {
    const { backend, store, engine } = makeEngine(['ALICE', 'BOB', 'CARA']);
    const first = run(engine, backend, request('ALICE', { cacheMode: true }));
    expect(Array.from(first.result!)).toEqual([0]);

    expect(store.commitPatch(1, new Map([[0, 'ZEBRA']]))).toBe(true);
    engine.reset();

    const after = run(
      engine,
      backend,
      request('ZEBRA', { cacheMode: true, searchableDataRevision: 1 }),
    );
    expect(Array.from(after.result!)).toEqual([0]);
    const old = run(
      engine,
      backend,
      request('ALICE', { cacheMode: true, searchableDataRevision: 1 }),
    );
    expect(Array.from(old.result!)).toEqual([]);
  });

  it('canceled in-flight query cannot storeCompletedResult after reset', () => {
    const backend = createManualBackend();
    const store = makeStore(['ALICE', 'BOB', 'CARA', 'DAVE']);
    const engine = new QuickSearchQueryEngine(store, new CooperativeScheduler(backend));
    const onComplete = vi.fn();

    const handle = engine.execute(
      request('A', { chunkSize: 1, cacheMode: true }),
      onComplete,
    );
    expect(backend.pending()).toBeGreaterThan(0);
    handle.cancel();
    expect(store.commitPatch(1, new Map([[0, 'ZEBRA']]))).toBe(true);
    engine.reset();
    backend.flush();
    expect(onComplete).not.toHaveBeenCalled();

    const after = run(
      engine,
      backend,
      request('ZEBRA', { cacheMode: true, searchableDataRevision: 1 }),
    );
    expect(Array.from(after.result!)).toEqual([0]);
  });

  // ── Stage 1L-A: selective source vs index build ──────────────────────

  it('selective source over a large missing-index snapshot scans sourceIndexes only', () => {
    const backend = createManualBackend();
    const store = new QuickSearchSnapshotStore();
    const SNAPSHOT = 100_000;
    store.start(1, SNAPSHOT);
    const sourceIndexes = new Uint32Array(100);
    for (let i = 0; i < 100; i++) {
      const idx = i * 1000;
      sourceIndexes[i] = idx;
      store.applyChunk(1, [
        {
          rowIndex: idx,
          values: [i === 50 ? 'ALICEUNIQUE' : `ROW${idx}`],
        },
      ]);
    }
    store.markComplete(1);
    const engine = new QuickSearchQueryEngine(store, new CooperativeScheduler(backend));

    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const reads = vi.spyOn(store, 'getRowText');

    const out = run(
      engine,
      backend,
      request('ALICEUNIQUE', {
        sourceIndexes,
        sourceSignature: 'src-selective',
        chunkSize: 25,
      }),
    );

    expect(out.meta?.path).toBe('scan');
    expect(Array.from(out.result!)).toEqual([50_000]);
    expect(addRow).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(0);

    const readIndexes = reads.mock.calls.map((c) => c[0] as number);
    expect(readIndexes.length).toBe(100);
    expect(new Set(readIndexes).size).toBe(100);
    for (const idx of readIndexes) {
      expect(sourceIndexes.includes(idx)).toBe(true);
    }

    addRow.mockRestore();
    reads.mockRestore();
  });

  it('broad missing-index source still follows the chunked build path', () => {
    const { backend, engine } = makeEngine(['ALICE', 'BOB', 'CARA', 'DAVE']);
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');

    const out = run(engine, backend, request('ALICE', { chunkSize: 1 }));
    expect(out.meta?.path).toBe('index');
    expect(addRow).toHaveBeenCalled();
    expect(Array.from(out.result!)).toEqual([0]);

    addRow.mockRestore();
  });

  it('once the index is published, a selective source uses it without rebuilding', () => {
    const texts = Array.from({ length: 100 }, (_, i) =>
      i === 42 ? 'ALICEUNIQUE' : `ROW${i}`,
    );
    const { backend, engine } = makeEngine(texts);

    // Broad non-identity source: builds/publishes the index without storing
    // a full-match cache entry (so later selective policy is observable).
    const warmSource = Uint32Array.from({ length: 80 }, (_, i) => i);
    const warm = run(
      engine,
      backend,
      request('ALICEUNIQUE', {
        sourceIndexes: warmSource,
        sourceSignature: 'src-warm',
        chunkSize: 20,
      }),
    );
    expect(warm.meta?.path).toBe('index');

    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const sourceIndexes = new Uint32Array([40, 41, 42, 43, 44]);
    const out = run(
      engine,
      backend,
      request('ALICEUNIQUE', {
        sourceIndexes,
        sourceSignature: 'src-sel',
        chunkSize: 2,
      }),
    );

    expect(out.meta?.path).toBe('index');
    expect(Array.from(out.result!)).toEqual([42]);
    expect(addRow).not.toHaveBeenCalled();

    addRow.mockRestore();
  });

  it('reset returns index state to missing so selective sources scan again', () => {
    const backend = createManualBackend();
    const store = new QuickSearchSnapshotStore();
    store.start(1, 100_000);
    const sourceIndexes = new Uint32Array([7]);
    store.applyChunk(1, [{ rowIndex: 7, values: ['ALICEUNIQUE'] }]);
    store.markComplete(1);
    const engine = new QuickSearchQueryEngine(store, new CooperativeScheduler(backend));

    // Publish via broad query, then drop published state.
    run(engine, backend, request('ALICEUNIQUE', { chunkSize: 10_000 }));
    engine.reset();

    const buildSpy = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const out = run(
      engine,
      backend,
      request('ALICEUNIQUE', {
        sourceIndexes,
        sourceSignature: 'src-one',
        chunkSize: 1,
      }),
    );
    expect(out.meta?.path).toBe('scan');
    expect(buildSpy).not.toHaveBeenCalled();
    expect(Array.from(out.result!)).toEqual([7]);
    buildSpy.mockRestore();
  });
});

describe('QuickSearchQueryEngine immutable base + dirty overlay (Stage 2A)', () => {
  function publishBase(texts: string[]) {
    const harness = makeEngine(texts);
    const warm = run(harness.engine, harness.backend, request('WARMTRIGRAM'));
    expect(warm.result).toBeDefined();
    return harness;
  }

  function commit(
    harness: ReturnType<typeof makeEngine>,
    baseDataRevision: number,
    targetDataRevision: number,
    rows: ReadonlyMap<number, string>,
  ): void {
    expect(harness.store.commitPatch(1, rows)).toBe(true);
    harness.engine.commitPatch({
      generation: 1,
      sourceLayoutRevision: 0,
      searchableFieldsKey: 'sf',
      normalizerSignature: 'n1',
      baseDataRevision,
      targetDataRevision,
      dirtyRowBytes: new Map(
        [...rows].map(([index, text]) => [index, text.length * 2]),
      ),
    });
  }

  it('30–32: excludes stale dirty postings, finds new grams, and canonically verifies both paths', () => {
    const harness = publishBase([
      'WARMTRIGRAM OLDMATCH WRONG',
      'WARMTRIGRAM BASEMATCH SECOND',
      'OTHER',
      'SPARE',
    ]);
    commit(harness, 0, 1, new Map([[0, 'NEWMATCH SECOND']]));

    const stale = run(
      harness.engine,
      harness.backend,
      request('OLDMATCH', { searchableDataRevision: 1 }),
    );
    expect(stale.meta?.path).toBe('index');
    expect(Array.from(stale.result!)).toEqual([]);

    const introduced = run(
      harness.engine,
      harness.backend,
      request('NEWMATCH', { searchableDataRevision: 1 }),
    );
    expect(introduced.meta?.path).toBe('index');
    expect(Array.from(introduced.result!)).toEqual([0]);

    const bothParts = run(
      harness.engine,
      harness.backend,
      request('BASEMATCH SECOND', { searchableDataRevision: 1 }),
    );
    expect(Array.from(bothParts.result!)).toEqual([1]);
    const dirtyBothParts = run(
      harness.engine,
      harness.backend,
      request('NEWMATCH SECOND', { searchableDataRevision: 1 }),
    );
    expect(Array.from(dirtyBothParts.result!)).toEqual([0]);
  });

  it('33: merges base and dirty matches in exact non-identity upstream order', () => {
    const harness = publishBase([
      'WARMTRIGRAM TARGET OLD',
      'WARMTRIGRAM TARGET',
      'OTHER',
      'WARMTRIGRAM TARGET',
      'FIFTH',
      'SIXTH',
    ]);
    commit(harness, 0, 1, new Map([[0, 'TARGET']]));

    const out = run(
      harness.engine,
      harness.backend,
      request('TARGET', {
        searchableDataRevision: 1,
        sourceIndexes: new Uint32Array([3, 0, 2, 1]),
        sourceSignature: 'src-nonidentity',
      }),
    );
    expect(out.meta?.path).toBe('index');
    expect(Array.from(out.result!)).toEqual([3, 0, 1]);
  });

  it('large non-identity source preserves order with one dirty row', () => {
    const rowCount = 100_000;
    const texts = Array.from({ length: rowCount }, () => 'OTHER');
    texts[10] = 'WARMTRIGRAM';
    texts[99_999] = 'TARGET';
    const harness = publishBase(texts);
    commit(harness, 0, 1, new Map([[50_000, 'TARGET']]));
    const sourceIndexes = Uint32Array.from(
      { length: rowCount },
      (_, ordinal) => rowCount - ordinal - 1,
    );

    const out = run(
      harness.engine,
      harness.backend,
      request('TARGET', {
        searchableDataRevision: 1,
        sourceIndexes,
        sourceSignature: 'src-large-reversed',
      }),
    );
    expect(out.meta?.path).toBe('index');
    expect(Array.from(out.result!)).toEqual([99_999, 50_000]);
  });

  it('re-edit returns one newest result without rebuilding; cacheMode:false stays correct', () => {
    const harness = publishBase(['WARMTRIGRAM OLD', 'OTHER', 'SPARE', 'LAST']);
    commit(harness, 0, 1, new Map([[0, 'FIRSTEDIT']]));
    commit(harness, 1, 2, new Map([[0, 'SECOND']]));
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const out = run(
      harness.engine,
      harness.backend,
      request('SECOND', { searchableDataRevision: 2, cacheMode: false }),
    );
    expect(Array.from(out.result!)).toEqual([0]);
    expect(
      Array.from(run(
        harness.engine,
        harness.backend,
        request('FIRSTEDIT', { searchableDataRevision: 2 }),
      ).result!),
    ).toEqual([]);
    expect(addRow).not.toHaveBeenCalled();
    addRow.mockRestore();
  });

  it('34: patch discards a partial replacement and retains prior base plus overlay', () => {
    const harness = publishBase([
      'WARMTRIGRAM OLD',
      'OTHER',
      'SPARE',
      'LAST',
    ]);
    commit(harness, 0, 1, new Map([[0, 'FIRSTEDIT']]));
    harness.engine.scheduleIdleIndexBuild(indexIdentity({ searchableDataRevision: 1 }), {
      chunkSize: 1,
    });
    expect(harness.backend.flushOne()).toBe(true);
    expect(harness.backend.pending()).toBe(1);

    commit(harness, 1, 2, new Map([[0, 'SECONDEDIT']]));
    harness.backend.flush();
    expect(harness.backend.pending()).toBe(0);

    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const out = run(
      harness.engine,
      harness.backend,
      request('SECONDEDIT', { searchableDataRevision: 2 }),
    );
    expect(out.meta?.path).toBe('index');
    expect(Array.from(out.result!)).toEqual([0]);
    expect(addRow).not.toHaveBeenCalled();
    addRow.mockRestore();
  });

  it('current-revision replacement publication clears overlay; reset clears all ownership', () => {
    const harness = publishBase(['WARMTRIGRAM OLD', 'OTHER', 'SPARE', 'LAST']);
    commit(harness, 0, 1, new Map([[0, 'CURRENTTEXT']]));
    const cancelled = harness.engine.scheduleIdleIndexBuild(
      indexIdentity({ searchableDataRevision: 1 }),
      { chunkSize: 1 },
    );
    expect(harness.backend.flushOne()).toBe(true);
    cancelled.cancel();
    harness.backend.flush();
    const retainedBuild = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const retained = run(
      harness.engine,
      harness.backend,
      request('CURRENTTEXT', { searchableDataRevision: 1 }),
    );
    expect(Array.from(retained.result!)).toEqual([0]);
    expect(retainedBuild).not.toHaveBeenCalled();
    retainedBuild.mockRestore();

    harness.engine.scheduleIdleIndexBuild(indexIdentity({ searchableDataRevision: 1 }));
    harness.backend.flush();
    const publishedBuild = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const published = run(
      harness.engine,
      harness.backend,
      request('CURRENTTEXT', { searchableDataRevision: 1 }),
    );
    expect(Array.from(published.result!)).toEqual([0]);
    expect(publishedBuild).not.toHaveBeenCalled();
    publishedBuild.mockRestore();

    commit(harness, 1, 2, new Map([[0, 'AGAIN']]));
    harness.engine.reset();
    const resetBuild = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const reset = run(
      harness.engine,
      harness.backend,
      request('AGAIN', { searchableDataRevision: 2 }),
    );
    expect(Array.from(reset.result!)).toEqual([0]);
    expect(resetBuild).toHaveBeenCalled();
    resetBuild.mockRestore();
  });
});

describe('QuickSearchQueryEngine time-budgeted index ingestion', () => {
  const buildTexts = Array.from({ length: 8 }, (_, i) =>
    i === 7 ? 'NEEDLETARGET' : `ROW${i}`,
  );

  function advancingClock(stepMs: number): () => number {
    let elapsed = 0;
    return () => {
      const current = elapsed;
      elapsed += stepMs;
      return current;
    };
  }

  it('splits interactive ingestion by time, resumes without gaps, and keeps user-visible priority', () => {
    const harness = makeEngine(buildTexts, {
      ingestionTimeBudgetMs: 4,
      now: advancingClock(2),
    });
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const out: { result?: Uint32Array } = {};

    harness.engine.execute(request('NEEDLETARGET', { chunkSize: 10_000 }), (indexes) => {
      out.result = indexes;
    });
    expect(addRow.mock.calls.map((call) => call[0])).toEqual([0, 1]);
    expect(harness.backend.pending()).toBe(1);
    expect(harness.backend.priorities).toEqual(['user-visible']);

    expect(harness.backend.flushOne()).toBe(true);
    expect(addRow.mock.calls.map((call) => call[0])).toEqual([0, 1, 2, 3]);
    harness.backend.flush();
    expect(addRow.mock.calls.map((call) => call[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(Array.from(out.result!)).toEqual([7]);
    expect(harness.backend.priorities).not.toContain('background');
    addRow.mockRestore();
  });

  it('immediate budget exhaustion still ingests one row per slice and completes', () => {
    const harness = makeEngine(buildTexts, {
      ingestionTimeBudgetMs: 0.5,
      now: advancingClock(10),
    });
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const out = run(
      harness.engine,
      harness.backend,
      request('NEEDLETARGET', { chunkSize: 10_000 }),
    );
    expect(addRow.mock.calls.map((call) => call[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(Array.from(out.result!)).toEqual([7]);
    addRow.mockRestore();
  });

  it('interactive cancellation after one bounded slice lets superseding work run', () => {
    const harness = makeEngine(buildTexts, {
      ingestionTimeBudgetMs: 4,
      now: advancingClock(2),
    });
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const first = harness.engine.execute(
      request('NEEDLETARGET', { chunkSize: 10_000 }),
      () => {
        throw new Error('cancelled build must not complete');
      },
    );
    expect(addRow.mock.calls.map((call) => call[0])).toEqual([0, 1]);
    first.cancel();

    const superseding = run(
      harness.engine,
      harness.backend,
      request('RO', { chunkSize: 10_000 }),
    );
    expect(Array.from(superseding.result!)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(addRow.mock.calls.map((call) => call[0])).toEqual([0, 1]);
    addRow.mockRestore();
  });

  it('idle ingestion is time-sliced, cancellable, and retains background priority', () => {
    const harness = makeEngine(buildTexts, {
      ingestionTimeBudgetMs: 4,
      now: advancingClock(2),
    });
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const beginCompaction = vi.spyOn(TrigramIndexBuilder.prototype, 'beginCompaction');
    const handle = harness.engine.scheduleIdleIndexBuild(indexIdentity(), {
      chunkSize: 10_000,
    });

    expect(addRow).not.toHaveBeenCalled();
    expect(harness.backend.flushOne()).toBe(true);
    expect(addRow.mock.calls.map((call) => call[0])).toEqual([0, 1]);
    expect(harness.backend.priorities.every((priority) => priority === 'background')).toBe(true);

    handle.cancel();
    harness.backend.flush();
    expect(addRow.mock.calls.map((call) => call[0])).toEqual([0, 1]);
    expect(beginCompaction).not.toHaveBeenCalled();
    addRow.mockRestore();
    beginCompaction.mockRestore();
  });

  it('replacement ingestion uses the same time budget and background continuations', () => {
    const harness = makeEngine(buildTexts, {
      maxRows: 1,
      maxEstimatedBytes: 10_000,
      ingestionTimeBudgetMs: 4,
      now: advancingClock(2),
    });
    run(harness.engine, harness.backend, request('NEEDLETARGET'));
    harness.backend.priorities.length = 0;
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    expect(harness.store.commitPatch(1, new Map([[0, 'DIRTY0'], [1, 'DIRTY1']]))).toBe(true);
    harness.engine.commitPatch({
      generation: 1,
      sourceLayoutRevision: 0,
      searchableFieldsKey: 'sf',
      normalizerSignature: 'n1',
      baseDataRevision: 0,
      targetDataRevision: 1,
      dirtyRowBytes: new Map([[0, 12], [1, 12]]),
    });

    expect(addRow).not.toHaveBeenCalled();
    expect(harness.backend.priorities).toEqual(['background']);
    expect(harness.backend.flushOne()).toBe(true);
    expect(addRow.mock.calls.map((call) => call[0])).toEqual([0, 1]);
    expect(harness.backend.priorities.every((priority) => priority === 'background')).toBe(true);
    addRow.mockRestore();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'invalid ingestion budget %s falls back and cannot zero-progress loop',
    (ingestionTimeBudgetMs) => {
      const harness = makeEngine(buildTexts, {
        ingestionTimeBudgetMs,
        now: advancingClock(10),
      });
      const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
      run(harness.engine, harness.backend, request('NEEDLETARGET', { chunkSize: 10_000 }));
      expect(addRow).toHaveBeenCalledTimes(buildTexts.length);
      addRow.mockRestore();
    },
  );
});

describe('QuickSearchQueryEngine bounded overlay replacement (Stage 2B / test 35)', () => {
  const texts = [
    'WARMTRIGRAM OLD0',
    'WARMTRIGRAM OLD1',
    'OLD2',
    'BASE TARGET',
    'OTHER',
    'SPARE',
  ];

  function publish(thresholds: QuickSearchQueryEngineOptions) {
    const harness = makeEngine(texts, thresholds);
    run(harness.engine, harness.backend, request('WARMTRIGRAM'));
    harness.backend.priorities.length = 0;
    return harness;
  }

  function patch(
    harness: ReturnType<typeof makeEngine>,
    baseDataRevision: number,
    targetDataRevision: number,
    rows: ReadonlyMap<number, string>,
  ): void {
    expect(harness.store.commitPatch(1, rows)).toBe(true);
    harness.engine.commitPatch({
      generation: 1,
      sourceLayoutRevision: 0,
      searchableFieldsKey: 'sf',
      normalizerSignature: 'n1',
      baseDataRevision,
      targetDataRevision,
      dirtyRowBytes: new Map(
        [...rows].map(([index, text]) => [index, text.length * 2]),
      ),
    });
  }

  it('uses strict row bounds: below and exact schedule nothing; bound + 1 schedules background asynchronously', () => {
    const harness = publish({ maxRows: 2, maxEstimatedBytes: 10_000 });
    patch(harness, 0, 1, new Map([[0, 'EDIT0']]));
    expect(harness.backend.pending()).toBe(0);
    patch(harness, 1, 2, new Map([[1, 'EDIT1']]));
    expect(harness.backend.pending()).toBe(0);

    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    patch(harness, 2, 3, new Map([[2, 'EDIT2']]));
    expect(harness.backend.pending()).toBe(1);
    expect(harness.backend.priorities).toEqual(['background']);
    expect(addRow).not.toHaveBeenCalled();
    expect(harness.backend.flushOne()).toBe(true);
    expect(addRow).toHaveBeenCalled();
    addRow.mockRestore();
  });

  it('uses replacement byte accounting and does not restart after a shrinking re-edit', () => {
    const harness = publish({ maxRows: 10, maxEstimatedBytes: 10 });
    patch(harness, 0, 1, new Map([[0, '12345']]));
    expect(harness.backend.pending()).toBe(0);

    patch(harness, 1, 2, new Map([[0, '123456']]));
    expect(harness.backend.pending()).toBe(1);

    patch(harness, 2, 3, new Map([[0, 'TINY']]));
    expect(harness.backend.pending()).toBe(0);
    harness.backend.flush();
    const out = run(
      harness.engine,
      harness.backend,
      request('TINY', { searchableDataRevision: 3 }),
    );
    expect(Array.from(out.result!)).toEqual([0]);
  });

  it('interactive query preempts replacement and uses retained base plus overlay without scan or rebuild', () => {
    const harness = publish({ maxRows: 1, maxEstimatedBytes: 10_000 });
    patch(harness, 0, 1, new Map([[0, 'DIRTYTARGET0'], [1, 'DIRTYTARGET1']]));
    expect(harness.backend.flushOne()).toBe(true);
    expect(harness.backend.pending()).toBe(1);

    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const out = run(
      harness.engine,
      harness.backend,
      request('DIRTYTARGET', { searchableDataRevision: 1 }),
    );
    expect(out.meta?.path).toBe('index');
    expect(Array.from(out.result!)).toEqual([0, 1]);
    expect(addRow).not.toHaveBeenCalled();
    expect(harness.backend.pending()).toBe(0);
    addRow.mockRestore();
  });

  it('patch during replacement discards obsolete work and publishes only the latest revision', () => {
    const harness = publish({ maxRows: 1, maxEstimatedBytes: 10_000 });
    patch(harness, 0, 1, new Map([[0, 'FIRSTTARGET'], [1, 'KEEP TARGET']]));
    expect(harness.backend.flushOne()).toBe(true);
    expect(harness.backend.pending()).toBe(1);

    patch(harness, 1, 2, new Map([[0, 'LATESTTARGET'], [2, 'THIRD TARGET']]));
    expect(harness.backend.pending()).toBe(1);
    harness.backend.flush();

    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const latest = run(
      harness.engine,
      harness.backend,
      request('LATESTTARGET', { searchableDataRevision: 2 }),
    );
    expect(Array.from(latest.result!)).toEqual([0]);
    expect(addRow).not.toHaveBeenCalled();
    addRow.mockRestore();

    // Publication cleared the accumulated three-row overlay. One subsequent
    // dirty row is exactly at the row bound and must not schedule rebuilding.
    patch(harness, 2, 3, new Map([[0, 'NEWESTTARGET']]));
    expect(harness.backend.pending()).toBe(0);
    expect(Array.from(run(
      harness.engine,
      harness.backend,
      request('NEWESTTARGET', { searchableDataRevision: 3 }),
    ).result!)).toEqual([0]);
  });
});

describe('QuickSearchQueryEngine idle index build (Stage 1L-B / test 38)', () => {
  it('preempts a partial idle build, scans, and later idle opportunity publishes', () => {
    const texts = Array.from({ length: 8 }, (_, i) =>
      i === 3 ? 'ALICEUNIQUE' : `ROW${i}`,
    );
    const { backend, engine } = makeEngine(texts);
    const identity = indexIdentity();
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');

    backend.priorities.length = 0;
    engine.scheduleIdleIndexBuild(identity, { chunkSize: 2 });
    expect(backend.pending()).toBe(1);
    expect(backend.priorities).toEqual(['background']);

    // First idle chunk is async — zero work until flush.
    expect(addRow).not.toHaveBeenCalled();
    expect(backend.flushOne()).toBe(true);
    expect(addRow).toHaveBeenCalledTimes(2);
    expect(backend.pending()).toBe(1);
    expect(backend.priorities[backend.priorities.length - 1]).toBe('background');

    addRow.mockClear();
    backend.priorities.length = 0;

    // Unrelated short query preempts → scan; does not seed ALICEUNIQUE lazy state.
    const out = run(engine, backend, request('ZZ', { chunkSize: 4 }));
    expect(out.meta?.path).toBe('scan');
    expect(addRow).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(0);

    // Later stable idle opportunity with the same identity.
    backend.priorities.length = 0;
    engine.scheduleIdleIndexBuild(identity, { chunkSize: 3 });
    expect(backend.priorities[0]).toBe('background');
    backend.flush();
    expect(addRow).toHaveBeenCalled();

    addRow.mockClear();
    const after = run(engine, backend, request('ALICEUNIQUE', { chunkSize: 4 }));
    expect(after.meta?.path).toBe('index');
    expect(Array.from(after.result!)).toEqual([3]);
    expect(addRow).not.toHaveBeenCalled();

    addRow.mockRestore();
  });

  it.each([
    ['generation', { generation: 2 }],
    ['sourceLayoutRevision', { sourceLayoutRevision: 9 }],
    ['searchableDataRevision', { searchableDataRevision: 4 }],
    ['searchableFieldsKey', { searchableFieldsKey: 'sf|other' }],
    ['normalizerSignature', { normalizerSignature: 'n2' }],
  ] as const)(
    'identity change during building (%s) prevents old build publication',
    (_label, change) => {
      const { backend, engine } = makeEngine(['ALICE', 'BOB', 'CARA', 'DAVE']);
      const identity = indexIdentity();
      engine.scheduleIdleIndexBuild(identity, { chunkSize: 1 });
      expect(backend.flushOne()).toBe(true);
      expect(backend.pending()).toBe(1);

      // Replace with a different identity — cancels/discards the partial.
      const next = indexIdentity(change);
      const handle = engine.scheduleIdleIndexBuild(next, { chunkSize: 1 });
      handle.cancel();
      backend.flush();

      // Cancelled replacement never published; query sees missing → may build interactively.
      const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
      const out = run(engine, backend, request('ALICE', { chunkSize: 2, ...change }));
      // For generation mismatch against snapshot, execute is a no-op.
      if ('generation' in change) {
        expect(out.completions).toBe(0);
        expect(addRow).not.toHaveBeenCalled();
      } else {
        expect(out.meta?.path).toBe('index');
        expect(addRow).toHaveBeenCalled();
      }
      addRow.mockRestore();
    },
  );

  it('snapshot generation change mid-idle prevents publication of the partial builder', () => {
    const { backend, store, engine } = makeEngine(['ALICE', 'BOB', 'CARA', 'DAVE']);
    engine.scheduleIdleIndexBuild(indexIdentity(), { chunkSize: 1 });
    expect(backend.flushOne()).toBe(true);

    store.start(2, 4);
    store.applyChunk(2, [
      { rowIndex: 0, values: ['ALICE'] },
      { rowIndex: 1, values: ['BOB'] },
      { rowIndex: 2, values: ['CARA'] },
      { rowIndex: 3, values: ['DAVE'] },
    ]);
    store.markComplete(2);
    backend.flush();

    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const out = run(
      engine,
      backend,
      request('ALICE', { generation: 2, chunkSize: 2 }),
    );
    expect(out.meta?.path).toBe('index');
    expect(addRow).toHaveBeenCalled();
    addRow.mockRestore();
  });

  it('reset() cancels and discards an idle build', () => {
    const { backend, store, engine } = makeEngine(['ALICE', 'BOB', 'CARA', 'DAVE']);
    engine.scheduleIdleIndexBuild(indexIdentity(), { chunkSize: 1 });
    expect(backend.flushOne()).toBe(true);
    expect(backend.pending()).toBe(1);

    engine.reset();
    backend.flush();
    expect(backend.pending()).toBe(0);

    const reads = vi.spyOn(store, 'getRowText');
    // After reset, no published index — interactive path may rebuild.
    run(engine, backend, request('ALICE', { chunkSize: 2 }));
    expect(reads).toHaveBeenCalled();
    reads.mockRestore();
  });

  it('duplicate idle requests for the same identity dedupe', () => {
    const { backend, engine } = makeEngine(['ALICE', 'BOB', 'CARA', 'DAVE']);
    const identity = indexIdentity();
    const first = engine.scheduleIdleIndexBuild(identity, { chunkSize: 1 });
    const second = engine.scheduleIdleIndexBuild(identity, { chunkSize: 1 });
    expect(backend.pending()).toBe(1);

    second.cancel();
    backend.flush();
    expect(backend.pending()).toBe(0);

    // Cancelling the deduped handle cancelled the shared build.
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    run(engine, backend, request('ALICE', { chunkSize: 2 }));
    expect(addRow).toHaveBeenCalled();
    addRow.mockRestore();
    void first;
  });

  it('cancellation before the first scheduled chunk performs zero row-text reads', () => {
    const { backend, store, engine } = makeEngine(['ALICE', 'BOB', 'CARA', 'DAVE']);
    const reads = vi.spyOn(store, 'getRowText');
    const handle = engine.scheduleIdleIndexBuild(indexIdentity(), { chunkSize: 1 });
    expect(backend.pending()).toBe(1);
    handle.cancel();
    backend.flush();
    expect(reads).not.toHaveBeenCalled();
    expect(backend.pending()).toBe(0);
    reads.mockRestore();
  });

  it('cache hit still preempts idle CPU work without waiting on the build', () => {
    const { backend, store, engine } = makeEngine(['ALICE', 'BOB', 'MALICE', 'CARA']);

    // Seed source cache via a preempting scan (no published index).
    engine.scheduleIdleIndexBuild(indexIdentity(), { chunkSize: 1 });
    expect(backend.flushOne()).toBe(true);
    run(engine, backend, request('ALICE', { chunkSize: 2 }));
    expect(backend.pending()).toBe(0);

    engine.scheduleIdleIndexBuild(indexIdentity(), { chunkSize: 1 });
    expect(backend.flushOne()).toBe(true);
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const reads = vi.spyOn(store, 'getRowText');

    const out: { path?: string; completions: number } = { completions: 0 };
    engine.execute(request('ALICE'), (_indexes, meta) => {
      out.path = meta.path;
      out.completions++;
    });
    expect(out.completions).toBe(1);
    expect(out.path).toBe('cached-source-result');
    expect(reads).not.toHaveBeenCalled();
    expect(addRow).not.toHaveBeenCalled();
    backend.flush();
    expect(addRow).not.toHaveBeenCalled();

    addRow.mockRestore();
    reads.mockRestore();
  });

  it('forward typing does not automatically restart idle construction', () => {
    const { backend, engine } = makeEngine(['ALICE X', 'ALIGN Y', 'BOB', 'MALICE']);
    engine.scheduleIdleIndexBuild(indexIdentity(), { chunkSize: 1 });
    expect(backend.flushOne()).toBe(true);

    // Preempt with an initial scan that seeds lazy-narrowing state.
    const first = run(engine, backend, request('ALI', { chunkSize: 2 }));
    expect(first.meta?.path).toBe('scan');
    expect(backend.pending()).toBe(0);

    backend.priorities.length = 0;
    const out = run(engine, backend, request('ALIC', { chunkSize: 2 }));
    expect(out.meta?.path).toBe('lazy-narrow');
    expect(backend.priorities.every((p) => p !== 'background')).toBe(true);
    expect(backend.pending()).toBe(0);
  });

  it('idle ingestion finishes but index remains unpublished while compaction is partial', () => {
    const texts = Array.from({ length: 8 }, (_, i) =>
      i === 3 ? 'ALICEUNIQUE' : `ROW${i}`,
    );
    const { backend, engine } = makeEngine(texts);
    const identity = indexIdentity();

    // Use chunkSize large enough to ingest all rows in one slice,
    // but compactionGramsPerSlice small enough to need multiple slices.
    engine.scheduleIdleIndexBuild(identity, {
      chunkSize: 100,
      compactionGramsPerSlice: 1,
    });

    // Flush enough to complete ingestion + one compaction slice.
    backend.flushOne(); // ingest all 8 rows
    expect(backend.pending()).toBe(1); // continuation pending (compact phase)
    backend.flushOne(); // one compaction slice (1 gram)
    expect(backend.pending()).toBe(1); // still more grams to compact

    // Index is NOT published yet — query sees missing.
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const out = run(engine, backend, request('ALICEUNIQUE', { chunkSize: 100 }));
    // Preempted → scans, index was not published.
    expect(out.meta?.path).toBe('scan');
    expect(Array.from(out.result!)).toEqual([3]);
    addRow.mockRestore();
  });

  it('idle compaction spans multiple background continuations', () => {
    const texts = Array.from({ length: 8 }, (_, i) =>
      i === 3 ? 'ALICEUNIQUE' : `ROW${i}`,
    );
    const { backend, engine } = makeEngine(texts);
    const identity = indexIdentity();

    engine.scheduleIdleIndexBuild(identity, {
      chunkSize: 100,
      compactionGramsPerSlice: 1,
    });

    // Complete ingestion
    backend.flushOne();
    expect(backend.pending()).toBe(1);

    // Count background compaction continuations
    let compactSlices = 0;
    while (backend.pending() > 0) {
      backend.flushOne();
      compactSlices++;
    }
    // Must have taken multiple slices (more grams than 1 per slice)
    expect(compactSlices).toBeGreaterThan(1);

    // Verify the index was published and usable.
    const out = run(engine, backend, request('ALICEUNIQUE', { chunkSize: 100 }));
    expect(out.meta?.path).toBe('index');
    expect(Array.from(out.result!)).toEqual([3]);
  });

  it('interactive query during idle compaction cancels it and partial never publishes', () => {
    const texts = Array.from({ length: 8 }, (_, i) =>
      i === 3 ? 'ALICEUNIQUE' : `ROW${i}`,
    );
    const { backend, engine } = makeEngine(texts);
    const identity = indexIdentity();

    engine.scheduleIdleIndexBuild(identity, {
      chunkSize: 100,
      compactionGramsPerSlice: 1,
    });

    // Complete ingestion, start compaction.
    backend.flushOne(); // ingest
    backend.flushOne(); // first compact slice
    expect(backend.pending()).toBe(1); // more compaction pending

    // Interactive query preempts.
    const out = run(engine, backend, request('ALICEUNIQUE', { chunkSize: 100 }));
    expect(out.meta?.path).toBe('scan');
    expect(Array.from(out.result!)).toEqual([3]);

    // No idle continuation left.
    expect(backend.pending()).toBe(0);
    backend.flush();
    // Index is NOT published from the cancelled idle build.
    const out2 = run(engine, backend, request('ALICEUNIQUE', { chunkSize: 100 }));
    // Uses source cache from the scan we just did.
    expect(out2.meta?.path).toBe('cached-source-result');
  });

  it('interactive build compaction is cancellable and never publishes after cancel', () => {
    const texts = Array.from({ length: 6 }, (_, i) =>
      i === 2 ? 'ALICEUNIQUE' : `ROW${i}`,
    );
    const { backend, engine } = makeEngine(texts);
    const spy = vi.fn();

    // Interactive build: execute with small chunk so it takes multiple steps.
    const handle = engine.execute(
      request('ALICEUNIQUE', { chunkSize: 1 }),
      spy,
    );

    // Let it make progress but cancel before completion.
    backend.flushOne();
    handle.cancel();
    backend.flush();

    expect(spy).not.toHaveBeenCalled();

    // A fresh query can still complete (no stale published index).
    const out = run(engine, backend, request('ALICEUNIQUE', { chunkSize: 100 }));
    expect(Array.from(out.result!)).toEqual([2]);
  });

  it('cancellation within compaction stops all later work', () => {
    const texts = Array.from({ length: 8 }, (_, i) =>
      i === 3 ? 'ALICEUNIQUE' : `ROW${i}`,
    );
    const { backend, engine } = makeEngine(texts);
    const identity = indexIdentity();

    engine.scheduleIdleIndexBuild(identity, {
      chunkSize: 100,
      compactionGramsPerSlice: 1,
    });

    // Ingest + one compact slice
    backend.flushOne();
    backend.flushOne();

    // Cancel the idle build via handle.
    const handle = engine.scheduleIdleIndexBuild(identity);
    handle.cancel();

    // No more work scheduled.
    backend.flush();
    expect(backend.pending()).toBe(0);

    // Not published — query must scan.
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const out = run(engine, backend, request('ALICEUNIQUE', { chunkSize: 100 }));
    expect(out.meta?.path).not.toBe('cached-source-result');
    expect(Array.from(out.result!)).toEqual([3]);
    addRow.mockRestore();
  });

  it('chunkSize 0, negative, NaN, and Infinity do not loop forever', () => {
    const { backend, engine } = makeEngine(['ALICE', 'BOB']);
    for (const bad of [0, -1, NaN, Infinity]) {
      const out = run(engine, backend, request('A', { chunkSize: bad }));
      expect(out.result).toBeDefined();
    }
  });

  it('interactive query preempts idle inside one partial posting (processedGrams === 0)', () => {
    // Freeze the clock: the compaction slice has a soft *time* budget
    // (DEFAULT_COMPACTION_TIME_BUDGET_MS) checked against `performance.now()`.
    // Under full-suite CPU load, real time can jump past that budget mid-slice,
    // so a slice stops early and the idle build splits into a different number
    // of scheduler tasks — making this test's fixed `flushOne()` steps line up
    // with the wrong task. With time frozen, only the deterministic 4096-index
    // cap applies (this was the sole source of flakiness).
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    // 5000 rows all sharing the trigram "AAA" — exceeds
    // DEFAULT_COMPACTION_POSTING_INDEXES_PER_SLICE (4096).
    const ROW_COUNT = 5000;
    const texts = Array.from({ length: ROW_COUNT }, (_, i) =>
      i === 2500 ? 'AAAUNIQUE' : `AAA${i}`,
    );
    const backend = createManualBackend();
    const store = makeStore(texts);
    const engine = new QuickSearchQueryEngine(store, new CooperativeScheduler(backend));
    const identity = indexIdentity();

    engine.scheduleIdleIndexBuild(identity, { chunkSize: ROW_COUNT });

    // Flush ingestion — one slice covers all rows.
    backend.flushOne();
    expect(backend.pending()).toBe(1);

    // Spy on TrigramPostingsCompaction.prototype.compactNext to capture
    // the slice result from the single compaction continuation.
    const compactNextSpy = vi.spyOn(
      TrigramPostingsCompaction.prototype,
      'compactNext',
    );

    // Flush one compaction slice.
    backend.flushOne();
    expect(backend.pending()).toBe(1); // continuation scheduled — posting incomplete

    // Verify the slice processed exactly 4096 indexes and 0 grams.
    const lastResult = compactNextSpy.mock.results[0];
    expect(lastResult?.type).toBe('return');
    const sliceResult = lastResult!.value as { done: boolean; processedIndexes: number; processedGrams: number };
    expect(sliceResult.processedIndexes).toBe(4096);
    expect(sliceResult.processedGrams).toBe(0);
    expect(sliceResult.done).toBe(false);

    compactNextSpy.mockRestore();

    // Interactive query preempts.
    const out = run(engine, backend, request('AAAUNIQUE', { chunkSize: ROW_COUNT }));
    expect(out.meta?.path).toBe('scan');
    expect(Array.from(out.result!)).toEqual([2500]);

    // Queued continuation is cancelled — no idle work remains.
    expect(backend.pending()).toBe(0);

    // Partial idle index never published: a fresh, uncached query with a
    // non-lazy-narrowable normalizedText must run through a fresh interactive
    // build (index path with addRow calls) — not cached-source-result,
    // full-match-intersect, or lazy-narrow.
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');
    const out2 = run(engine, backend, request('AAA4999', { chunkSize: ROW_COUNT }));
    expect(Array.from(out2.result!)).toContain(4999);
    expect(out2.meta?.path).toBe('index');
    expect(addRow).toHaveBeenCalled();
    expect(out2.meta?.path).not.toBe('cached-source-result');
    expect(out2.meta?.path).not.toBe('full-match-intersect');
    expect(out2.meta?.path).not.toBe('lazy-narrow');
    addRow.mockRestore();
    nowSpy.mockRestore();
  });

  it('selective missing-index source still scans without starting idle or interactive build', () => {
    const backend = createManualBackend();
    const store = new QuickSearchSnapshotStore();
    store.start(1, 100_000);
    const sourceIndexes = new Uint32Array(100);
    for (let i = 0; i < 100; i++) {
      const idx = i * 1000;
      sourceIndexes[i] = idx;
      store.applyChunk(1, [
        { rowIndex: idx, values: [i === 50 ? 'ALICEUNIQUE' : `ROW${idx}`] },
      ]);
    }
    store.markComplete(1);
    const engine = new QuickSearchQueryEngine(store, new CooperativeScheduler(backend));
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');

    engine.scheduleIdleIndexBuild(indexIdentity(), { chunkSize: 500 });
    // Preempt via selective query before idle runs.
    const out = run(
      engine,
      backend,
      request('ALICEUNIQUE', {
        sourceIndexes,
        sourceSignature: 'src-selective',
        chunkSize: 25,
      }),
    );
    expect(out.meta?.path).toBe('scan');
    expect(addRow).not.toHaveBeenCalled();
    backend.flush();
    expect(addRow).not.toHaveBeenCalled();
    addRow.mockRestore();
  });
});
