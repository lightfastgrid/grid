import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import type { CooperativeSchedulerBackend } from '../../../../scheduling/CooperativeScheduler';
import { CooperativeScheduler } from '../../../../scheduling/CooperativeScheduler';
import type {
  QuickSearchWorkerRequest,
  QuickSearchWorkerResponse,
  SearchableSnapshotRow,
} from '../quickSearchProtocol';
import { TrigramIndexBuilder } from '../quickSearchTrigramIndex';
import {
  buildSearchableFieldsKeyFromSnapshotFields,
  buildSourceSignature,
  QuickSearchWorkerRuntime,
} from '../quickSearchWorkerRuntime';

const here = dirname(fileURLToPath(import.meta.url));
const runtimeSource = readFileSync(join(here, '../quickSearchWorkerRuntime.ts'), 'utf8');

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
      while (queue.length > 0) {
        const snapshot = queue.splice(0);
        for (const entry of snapshot) {
          if (!entry.cancelled) entry.cb();
        }
      }
    },
    pending() {
      return queue.filter((e) => !e.cancelled).length;
    },
  };
}

function makeRows(texts: string[]): SearchableSnapshotRow[] {
  return texts.map((text, rowIndex) => ({ rowIndex, values: [text] }));
}

function snapshotStart(
  generation: number,
  rowCount: number,
  sourceLayoutRevision = 0,
  searchableDataRevision = 0,
) {
  return {
    kind: 'quickSearch:snapshotStart' as const,
    generation,
    rowCount,
    fields: [{ field: 'name' }],
    payloadFormat: 'searchable-fields-v1' as const,
    normalizerSignature: 'qs-norm-v1',
    sourceLayoutRevision,
    searchableDataRevision,
  };
}

function snapshotChunk(generation: number, rows: SearchableSnapshotRow[]) {
  return {
    kind: 'quickSearch:snapshotChunk' as const,
    generation,
    startIndex: rows[0]?.rowIndex ?? 0,
    payloadFormat: 'searchable-fields-v1' as const,
    rows,
  };
}

function queryMessage(
  requestId: number,
  normalizedText: string,
  generation = 1,
  sourceIndexes: Uint32Array | null = null,
  sourceVersion = 0,
  cacheMode: false | true | "auto" = "auto",
  sourceLayoutRevision = 0,
  searchableDataRevision = 0,
) {
  return {
    kind: 'quickSearch:query' as const,
    generation,
    requestId,
    normalizedText,
    sourceIndexes,
    sourceVersion,
    cacheMode,
    sourceLayoutRevision,
    searchableDataRevision,
  };
}

interface RuntimeHarness {
  runtime: QuickSearchWorkerRuntime;
  backend: ReturnType<typeof createManualBackend>;
  responses: QuickSearchWorkerResponse[];
}

function createRuntime(queryChunkSize = 2): RuntimeHarness {
  const backend = createManualBackend();
  const scheduler = new CooperativeScheduler(backend);
  const responses: QuickSearchWorkerResponse[] = [];
  const runtime = new QuickSearchWorkerRuntime((response) => responses.push(response), {
    scheduler,
    queryChunkSize,
  });
  return { runtime, backend, responses };
}

function completeSnapshot(
  harness: RuntimeHarness,
  texts: string[],
  generation = 1,
): void {
  const { runtime } = harness;
  runtime.handleMessage(snapshotStart(generation, texts.length));
  runtime.handleMessage(snapshotChunk(generation, makeRows(texts)));
  runtime.handleMessage({ kind: 'quickSearch:snapshotComplete', generation });
}

describe('QuickSearchWorkerRuntime', () => {
  // ── 1. snapshot lifecycle posts ready ───────────────────────────────

  it('snapshotStart + snapshotChunk + snapshotComplete posts ready', () => {
    const { runtime, responses } = createRuntime();
    runtime.handleMessage(snapshotStart(1, 2));
    runtime.handleMessage(snapshotChunk(1, makeRows(['ALICE', 'BOB'])));
    runtime.handleMessage({ kind: 'quickSearch:snapshotComplete', generation: 1 });

    expect(responses).toEqual([{ kind: 'quickSearch:ready', generation: 1 }]);
    expect(runtime.getSnapshotStore().isComplete()).toBe(true);
  });

  // ── 2. stale chunks ignored ─────────────────────────────────────────

  it('ignores stale snapshot chunks', () => {
    const { runtime } = createRuntime();
    runtime.handleMessage(snapshotStart(2, 2));
    runtime.handleMessage(snapshotChunk(1, makeRows(['STALE', 'STALE'])));
    runtime.handleMessage(snapshotChunk(2, makeRows(['ALICE', 'BOB'])));
    runtime.handleMessage({ kind: 'quickSearch:snapshotComplete', generation: 2 });

    expect(runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
    expect(runtime.getSnapshotStore().getRowText(1)).toBe('BOB');
  });

  // ── 3. query after complete returns Uint32Array indexes ─────────────

  it('query after snapshotComplete returns expected Uint32Array indexes', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB', 'CARA']);
    harness.runtime.handleMessage(queryMessage(1, 'BOB'));
    harness.backend.flush();

    const success = harness.responses.find((r) => r.kind === 'quickSearch:success');
    expect(success).toEqual({
      kind: 'quickSearch:success',
      requestId: 1,
      indexes: Uint32Array.from([1]),
    });
  });

  // ── 4. sourceIndexes preserve order ─────────────────────────────────

  it('query with sourceIndexes preserves source order', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB', 'CARA', 'ALICE']);
    harness.runtime.handleMessage(
      queryMessage(2, 'ALICE', 1, Uint32Array.from([3, 0, 2])),
    );
    harness.backend.flush();

    const success = harness.responses.find((r) => r.kind === 'quickSearch:success');
    expect(success?.kind).toBe('quickSearch:success');
    if (success?.kind === 'quickSearch:success') {
      expect(Array.from(success.indexes)).toEqual([3, 0]);
    }
  });

  // ── 5. query before snapshotComplete returns error ──────────────────

  it('query before snapshotComplete returns error and does not hang', () => {
    const harness = createRuntime();
    harness.runtime.handleMessage(snapshotStart(1, 2));
    harness.runtime.handleMessage(snapshotChunk(1, makeRows(['ALICE', 'BOB'])));
    harness.runtime.handleMessage(queryMessage(1, 'ALICE'));

    expect(harness.responses).toEqual([
      {
        kind: 'quickSearch:error',
        requestId: 1,
        code: 'snapshot-unavailable',
        message: 'Snapshot is unavailable, stale, or incomplete',
      },
    ]);
    expect(harness.backend.pending()).toBe(0);
  });

  // ── 6. stale generation query returns error ─────────────────────────

  it('stale generation query returns error and no success', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB'], 1);
    harness.runtime.handleMessage(queryMessage(2, 'ALICE', 2));
    harness.backend.flush();

    expect(harness.responses.some((r) => r.kind === 'quickSearch:success')).toBe(false);
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:error',
      requestId: 2,
      code: 'generation-mismatch',
      message: 'Query generation does not match the applied snapshot',
    });
  });

  // ── 7. cancelQuery prevents success ─────────────────────────────────

  it('cancelQuery prevents success for the active request', () => {
    const harness = createRuntime(1);
    completeSnapshot(harness, ['ALICE', 'BOB', 'CARA']);
    harness.runtime.handleMessage(queryMessage(1, 'A'));
    harness.runtime.handleMessage({ kind: 'quickSearch:cancel', requestId: 1 });
    harness.backend.flush();

    expect(harness.responses.some((r) => r.kind === 'quickSearch:success')).toBe(false);
    expect(harness.runtime.getActiveRequestId()).toBeNull();
  });

  // ── 8. newer query supersedes older query ───────────────────────────

  it('newer query supersedes older query and ignores stale completion', () => {
    const harness = createRuntime(1);
    completeSnapshot(harness, ['ALICE', 'BOB', 'CARA']);
    harness.runtime.handleMessage(queryMessage(1, 'A'));
    harness.runtime.handleMessage(queryMessage(2, 'BOB'));
    harness.backend.flush();

    const successes = harness.responses.filter((r) => r.kind === 'quickSearch:success');
    expect(successes).toHaveLength(1);
    expect(successes[0]).toEqual({
      kind: 'quickSearch:success',
      requestId: 2,
      indexes: Uint32Array.from([1]),
    });
  });

  // ── 9. clearSnapshot cancels, clears store, resets engine ───────────

  it('clearSnapshot cancels active query, clears store, and resets engine', () => {
    const harness = createRuntime(1);
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage(queryMessage(1, 'A'));
    harness.runtime.handleMessage({ kind: 'quickSearch:clearSnapshot' });
    harness.backend.flush();

    expect(harness.responses.some((r) => r.kind === 'quickSearch:success')).toBe(false);
    expect(harness.runtime.getSnapshotStore().getRowCount()).toBe(0);
    expect(harness.runtime.getSnapshotStore().isComplete()).toBe(false);
    expect(harness.runtime.getActiveRequestId()).toBeNull();
  });

  // ── 10. empty query is defensive ────────────────────────────────────

  it('handles empty query defensively with passthrough and no pending work', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage(queryMessage(1, '   '));
    harness.backend.flush();

    expect(harness.backend.pending()).toBe(0);
    expect(harness.runtime.getActiveRequestId()).toBeNull();
    expect(harness.runtime.hasActiveQueryHandle()).toBe(false);
    const success = harness.responses.find((r) => r.kind === 'quickSearch:success');
    expect(success).toEqual({
      kind: 'quickSearch:success',
      requestId: 1,
      indexes: Uint32Array.from([0, 1]),
    });
  });

  it('does not retain activeQueryHandle after synchronous engine completion', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage(queryMessage(1, '   '));

    expect(harness.runtime.hasActiveQueryHandle()).toBe(false);
    expect(harness.runtime.getActiveRequestId()).toBeNull();
  });

  // ── 11. flat-utf8-v1 unsupported ────────────────────────────────────

  it('flat-utf8-v1 snapshot start/chunk/complete never posts ready or success', () => {
    const harness = createRuntime();
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotStart',
      generation: 1,
      rowCount: 2,
      fields: [{ field: 'name' }],
      payloadFormat: 'flat-utf8-v1',
      normalizerSignature: 'qs-norm-v1',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotChunk',
      generation: 1,
      startIndex: 0,
      payloadFormat: 'flat-utf8-v1',
      textUtf8: new Uint8Array([65, 66]),
      rowOffsets: new Uint32Array([0, 2]),
    });
    harness.runtime.handleMessage({ kind: 'quickSearch:snapshotComplete', generation: 1 });
    harness.runtime.handleMessage(queryMessage(1, 'AB'));
    harness.backend.flush();

    expect(harness.responses.some((r) => r.kind === 'quickSearch:ready')).toBe(false);
    expect(harness.responses.some((r) => r.kind === 'quickSearch:success')).toBe(false);
    expect(harness.runtime.getSnapshotStore().isComplete()).toBe(false);
    expect(harness.runtime.getSnapshotStore().getRowCount()).toBe(0);
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:error',
      requestId: 1,
      code: 'snapshot-unavailable',
      message: 'Snapshot is unavailable, stale, or incomplete',
    });
  });

  // ── 12. transactional PATCHING ─────────────────────────────────────

  it('one-row patch retains the warm published index behind an exact overlay', () => {
    const harness = createRuntime();
    completeSnapshot(harness, [
      'WARMTRIGRAM OLDVALUE',
      'WARMTRIGRAM BASEVALUE',
      'OTHER',
      'SPARE',
    ]);
    harness.runtime.handleMessage(queryMessage(1, 'WARMTRIGRAM'));
    harness.backend.flush();
    const addRow = vi.spyOn(TrigramIndexBuilder.prototype, 'addRow');

    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 1,
      generation: 1,
      chunkSequence: 0,
      updates: [{ rowIndex: 0, values: ['BRANDNEWTEXT'] }],
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchComplete',
      patchId: 1,
      generation: 1,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });

    harness.runtime.handleMessage(queryMessage(2, 'BRANDNEWTEXT', 1, null, 0, 'auto', 0, 1));
    harness.backend.flush();
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:success',
      requestId: 2,
      indexes: Uint32Array.from([0]),
    });
    expect(addRow).not.toHaveBeenCalled();
    addRow.mockRestore();
  });

  it('ignores patchStart while BUILDING without mutating pending snapshot state', () => {
    const harness = createRuntime();
    harness.runtime.handleMessage(snapshotStart(1, 2, 0, 0));
    harness.runtime.handleMessage(snapshotChunk(1, makeRows(['ALICE', 'BOB'])));
    expect(harness.runtime.getAppliedRevisions()).toBeNull();

    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });

    expect(harness.runtime.isPatching()).toBe(false);
    expect(harness.runtime.getPendingRevisions()).toEqual({
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
    expect(harness.responses.some((r) => r.kind === 'quickSearch:patchRejected')).toBe(
      false,
    );
  });

  // ── 13. runtime module boundaries ─────────────────────────────────────

  it('does not import Grid, GridState, React, or renderer modules', () => {
    expect(runtimeSource).not.toMatch(/from ['"].*Grid['"]/);
    expect(runtimeSource).not.toMatch(/GridState/);
    expect(runtimeSource).not.toMatch(/@lightfastgrid\/react/);
    expect(runtimeSource).not.toMatch(/renderer/);
  });

  // ── Helpers ─────────────────────────────────────────────────────────

  it('buildSearchableFieldsKeyFromSnapshotFields encodes projection fields', () => {
    expect(
      buildSearchableFieldsKeyFromSnapshotFields([
        { field: 'name' },
        { field: 'bankBalance', projectionField: 'bankBalanceSearch' },
      ]),
    ).toBe('sf|v|name,bankBalance:bankBalanceSearch');
  });

  it('buildSourceSignature uses monotonic version, no per-index string', () => {
    expect(buildSourceSignature(0)).toBe('src|v0');
    expect(buildSourceSignature(1)).toBe('src|v1');
    expect(buildSourceSignature(42)).toBe('src|v42');
  });

  it('snapshotStart cancels an in-flight query and resets engine caches', () => {
    const harness = createRuntime(1);
    completeSnapshot(harness, ['ALICE', 'BOB', 'CARA'], 1);
    harness.runtime.handleMessage(queryMessage(1, 'A'));
    harness.runtime.handleMessage(snapshotStart(2, 1));
    harness.backend.flush();

    expect(harness.responses.some((r) => r.kind === 'quickSearch:success')).toBe(false);
    expect(harness.runtime.getSnapshotStore().getGeneration()).toBe(2);
    expect(harness.runtime.getSnapshotStore().isComplete()).toBe(false);
  });

  it('cancel without requestId cancels the active query', () => {
    const harness = createRuntime(1);
    completeSnapshot(harness, ['ALICE', 'BOB', 'CARA']);
    harness.runtime.handleMessage(queryMessage(5, 'A'));
    harness.runtime.handleMessage({ kind: 'quickSearch:cancel' });
    harness.backend.flush();
    expect(harness.responses.some((r) => r.kind === 'quickSearch:success')).toBe(false);
  });

  it('cancel with non-matching requestId leaves the active query running', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage(queryMessage(7, 'ALICE'));
    harness.runtime.handleMessage({ kind: 'quickSearch:cancel', requestId: 99 });
    harness.backend.flush();

    expect(harness.responses.some((r) => r.kind === 'quickSearch:success')).toBe(true);
  });

  it('revisions are pending at snapshotStart and applied only after matching complete', () => {
    const harness = createRuntime();
    harness.runtime.handleMessage(snapshotStart(1, 2, 4, 7));
    expect(harness.runtime.getPendingRevisions()).toEqual({
      sourceLayoutRevision: 4,
      searchableDataRevision: 7,
    });
    expect(harness.runtime.getAppliedRevisions()).toBeNull();

    harness.runtime.handleMessage(snapshotChunk(1, makeRows(['ALICE', 'BOB'])));
    expect(harness.runtime.getAppliedRevisions()).toBeNull();

    harness.runtime.handleMessage({ kind: 'quickSearch:snapshotComplete', generation: 1 });
    expect(harness.runtime.getAppliedRevisions()).toEqual({
      sourceLayoutRevision: 4,
      searchableDataRevision: 7,
    });
    expect(harness.runtime.getPendingRevisions()).toBeNull();
  });

  it('stale snapshotComplete leaves current pending revisions unchanged', () => {
    const harness = createRuntime();
    harness.runtime.handleMessage(snapshotStart(2, 2, 4, 7));
    expect(harness.runtime.getPendingRevisions()).toEqual({
      sourceLayoutRevision: 4,
      searchableDataRevision: 7,
    });

    harness.runtime.handleMessage({ kind: 'quickSearch:snapshotComplete', generation: 1 });
    expect(harness.runtime.getPendingRevisions()).toEqual({
      sourceLayoutRevision: 4,
      searchableDataRevision: 7,
    });
    expect(harness.runtime.getAppliedRevisions()).toBeNull();
    expect(harness.responses.some((r) => r.kind === 'quickSearch:ready')).toBe(false);
  });

  it('query with matching revisions succeeds', () => {
    const harness = createRuntime();
    harness.runtime.handleMessage(snapshotStart(1, 2, 3, 5));
    harness.runtime.handleMessage(snapshotChunk(1, makeRows(['ALICE', 'BOB'])));
    harness.runtime.handleMessage({ kind: 'quickSearch:snapshotComplete', generation: 1 });
    harness.runtime.handleMessage(queryMessage(1, 'ALICE', 1, null, 0, 'auto', 3, 5));
    harness.backend.flush();

    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:success',
      requestId: 1,
      indexes: Uint32Array.from([0]),
    });
  });

  it('layout and data revision mismatches return exact typed codes without engine work', () => {
    const harness = createRuntime();
    harness.runtime.handleMessage(snapshotStart(1, 2, 1, 2));
    harness.runtime.handleMessage(snapshotChunk(1, makeRows(['ALICE', 'BOB'])));
    harness.runtime.handleMessage({ kind: 'quickSearch:snapshotComplete', generation: 1 });

    harness.runtime.handleMessage(queryMessage(10, 'ALICE', 1, null, 0, 'auto', 9, 2));
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:error',
      requestId: 10,
      code: 'layout-mismatch',
      message: 'Query sourceLayoutRevision does not match the applied snapshot',
    });
    expect(harness.backend.pending()).toBe(0);
    expect(harness.runtime.hasActiveQueryHandle()).toBe(false);

    harness.responses.length = 0;
    harness.runtime.handleMessage(queryMessage(11, 'ALICE', 1, null, 0, 'auto', 1, 99));
    expect(harness.responses).toEqual([
      {
        kind: 'quickSearch:error',
        requestId: 11,
        code: 'revision-mismatch',
        message: 'Query searchableDataRevision does not match the applied snapshot',
      },
    ]);
    expect(harness.backend.pending()).toBe(0);
    expect(harness.runtime.hasActiveQueryHandle()).toBe(false);
  });

  it('clearSnapshot and superseding snapshotStart discard revision state', () => {
    const harness = createRuntime();
    harness.runtime.handleMessage(snapshotStart(1, 2, 4, 7));
    harness.runtime.handleMessage(snapshotChunk(1, makeRows(['ALICE', 'BOB'])));
    harness.runtime.handleMessage({ kind: 'quickSearch:snapshotComplete', generation: 1 });
    expect(harness.runtime.getAppliedRevisions()).not.toBeNull();

    harness.runtime.handleMessage({ kind: 'quickSearch:clearSnapshot' });
    expect(harness.runtime.getPendingRevisions()).toBeNull();
    expect(harness.runtime.getAppliedRevisions()).toBeNull();

    harness.runtime.handleMessage(snapshotStart(2, 1, 8, 9));
    expect(harness.runtime.getPendingRevisions()).toEqual({
      sourceLayoutRevision: 8,
      searchableDataRevision: 9,
    });
    expect(harness.runtime.getAppliedRevisions()).toBeNull();

    harness.runtime.handleMessage(snapshotStart(3, 1, 10, 11));
    expect(harness.runtime.getPendingRevisions()).toEqual({
      sourceLayoutRevision: 10,
      searchableDataRevision: 11,
    });
    expect(harness.runtime.getAppliedRevisions()).toBeNull();
  });
});

describe('QuickSearchWorkerRuntime PATCHING', () => {
  function applyPatch(
    harness: RuntimeHarness,
    updates: Array<{ rowIndex: number; values: string[] }>,
    opts?: {
      patchId?: number;
      base?: number;
      target?: number;
      generation?: number;
      layout?: number;
    },
  ): void {
    const patchId = opts?.patchId ?? 1;
    const generation = opts?.generation ?? 1;
    const base = opts?.base ?? 0;
    const target = opts?.target ?? 1;
    const layout = opts?.layout ?? 0;
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId,
      generation,
      sourceLayoutRevision: layout,
      baseDataRevision: base,
      targetDataRevision: target,
      totalUniqueRows: updates.length,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId,
      generation,
      chunkSequence: 0,
      updates,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchComplete',
      patchId,
      generation,
      targetDataRevision: target,
      totalUniqueRows: updates.length,
      totalChunks: 1,
    });
  }

  it('staged rows are invisible before patchComplete', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 1,
      generation: 1,
      chunkSequence: 0,
      updates: [{ rowIndex: 0, values: ['ZEBRA'] }],
    });

    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
    expect(harness.runtime.isPatching()).toBe(true);
    expect(harness.runtime.getAppliedRevisions()?.searchableDataRevision).toBe(0);
  });

  it('successful commit makes new text searchable and old text stop matching', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    applyPatch(harness, [{ rowIndex: 0, values: ['ZEBRA'] }]);

    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ZEBRA');
    expect(harness.runtime.getAppliedRevisions()?.searchableDataRevision).toBe(1);
    expect(harness.runtime.isPatching()).toBe(false);
    expect(harness.responses.some((r) => r.kind === 'quickSearch:patchRejected')).toBe(
      false,
    );

    harness.runtime.handleMessage(queryMessage(1, 'ZEBRA', 1, null, 0, 'auto', 0, 1));
    harness.backend.flush();
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:success',
      requestId: 1,
      indexes: Uint32Array.from([0]),
    });

    harness.responses.length = 0;
    harness.runtime.handleMessage(queryMessage(2, 'ALICE', 1, null, 0, 'auto', 0, 1));
    harness.backend.flush();
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:success',
      requestId: 2,
      indexes: Uint32Array.from([]),
    });
  });

  it('exact source cache cannot return pre-patch indexes after commit', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB', 'CARA']);
    harness.runtime.handleMessage(queryMessage(1, 'ALICE', 1, null, 0, true, 0, 0));
    harness.backend.flush();
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:success',
      requestId: 1,
      indexes: Uint32Array.from([0]),
    });

    applyPatch(harness, [{ rowIndex: 0, values: ['ZEBRA'] }]);
    harness.responses.length = 0;
    harness.runtime.handleMessage(queryMessage(2, 'ALICE', 1, null, 0, true, 0, 1));
    harness.backend.flush();
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:success',
      requestId: 2,
      indexes: Uint32Array.from([]),
    });
  });

  it('cacheMode false sees patched text', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage(queryMessage(1, 'ALICE', 1, null, 0, false, 0, 0));
    harness.backend.flush();
    applyPatch(harness, [{ rowIndex: 0, values: ['ZEBRA'] }]);
    harness.responses.length = 0;
    harness.runtime.handleMessage(queryMessage(2, 'ZEBRA', 1, null, 0, false, 0, 1));
    harness.backend.flush();
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:success',
      requestId: 2,
      indexes: Uint32Array.from([0]),
    });
  });

  it('query during PATCHING returns patch-in-progress and schedules no engine work', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage(queryMessage(5, 'ALICE', 1, null, 0, 'auto', 0, 0));
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:error',
      requestId: 5,
      code: 'patch-in-progress',
      message: 'A snapshot patch transaction is in progress',
    });
    expect(harness.backend.pending()).toBe(0);
    expect(harness.runtime.hasActiveQueryHandle()).toBe(false);
    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
  });

  it('rejects generation/layout/base revision mismatches', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);

    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 99,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 1,
      generation: 99,
      reason: 'generation-mismatch',
    });

    harness.responses.length = 0;
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 2,
      generation: 1,
      sourceLayoutRevision: 9,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 2,
      generation: 1,
      reason: 'layout-mismatch',
    });

    harness.responses.length = 0;
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 3,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 5,
      targetDataRevision: 6,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 3,
      generation: 1,
      reason: 'revision-mismatch',
    });
  });

  it('rejects out-of-order and duplicate chunk sequences', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 2,
      totalChunks: 2,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 1,
      generation: 1,
      chunkSequence: 1,
      updates: [{ rowIndex: 0, values: ['X'] }],
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 1,
      generation: 1,
      reason: 'chunk-sequence-mismatch',
    });
    expect(harness.runtime.isPatching()).toBe(false);
    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
  });

  it('rejects missing chunk and staged.size mismatch on complete', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 2,
      totalChunks: 2,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 1,
      generation: 1,
      chunkSequence: 0,
      updates: [{ rowIndex: 0, values: ['X'] }],
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchComplete',
      patchId: 1,
      generation: 1,
      targetDataRevision: 1,
      totalUniqueRows: 2,
      totalChunks: 2,
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 1,
      generation: 1,
      reason: 'incomplete-staging',
    });
    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
    expect(harness.runtime.getAppliedRevisions()?.searchableDataRevision).toBe(0);
  });

  it('rejects repeated-total mismatch on complete', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 1,
      generation: 1,
      chunkSequence: 0,
      updates: [{ rowIndex: 0, values: ['X'] }],
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchComplete',
      patchId: 1,
      generation: 1,
      targetDataRevision: 1,
      totalUniqueRows: 9,
      totalChunks: 1,
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 1,
      generation: 1,
      reason: 'incomplete-staging',
    });
  });

  it('last-write-wins replaces staged bytes without double counting', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 2,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 1,
      generation: 1,
      chunkSequence: 0,
      updates: [{ rowIndex: 0, values: ['AAAA'] }],
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 1,
      generation: 1,
      chunkSequence: 1,
      updates: [{ rowIndex: 0, values: ['BB'] }],
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchComplete',
      patchId: 1,
      generation: 1,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 2,
    });
    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('BB');
    expect(harness.runtime.isPatching()).toBe(false);
  });

  it('superseding patchStart discards previous staging', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 1,
      generation: 1,
      chunkSequence: 0,
      updates: [{ rowIndex: 0, values: ['OLD'] }],
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 2,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 2,
      generation: 1,
      chunkSequence: 0,
      updates: [{ rowIndex: 1, values: ['NEW'] }],
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchComplete',
      patchId: 2,
      generation: 1,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
    expect(harness.runtime.getSnapshotStore().getRowText(1)).toBe('NEW');
  });

  it('snapshotStart and clearSnapshot discard staging', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    expect(harness.runtime.isPatching()).toBe(true);
    harness.runtime.handleMessage(snapshotStart(2, 1, 0, 0));
    expect(harness.runtime.isPatching()).toBe(false);

    completeSnapshot(harness, ['X'], 2);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 3,
      generation: 2,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    expect(harness.runtime.isPatching()).toBe(true);
    harness.runtime.handleMessage({ kind: 'quickSearch:clearSnapshot' });
    expect(harness.runtime.isPatching()).toBe(false);
  });

  it('cancel query does not discard patch staging', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({ kind: 'quickSearch:cancel' });
    expect(harness.runtime.isPatching()).toBe(true);
  });

  it('malformed chunk then complete can emit duplicate rejection safely', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 1,
      generation: 1,
      chunkSequence: 0,
      updates: [{ rowIndex: 99, values: ['X'] }],
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 1,
      generation: 1,
      reason: 'staging-limit',
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchComplete',
      patchId: 1,
      generation: 1,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    const rejected = harness.responses.filter((r) => r.kind === 'quickSearch:patchRejected');
    expect(rejected.length).toBeGreaterThanOrEqual(2);
    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
  });

  it('active old chunked query is canceled before commit and cannot post success', () => {
    const harness = createRuntime(1);
    completeSnapshot(harness, ['ALICE', 'BOB', 'CARA', 'DAVE']);
    harness.runtime.handleMessage(queryMessage(1, 'A', 1, null, 0, 'auto', 0, 0));
    expect(harness.runtime.hasActiveQueryHandle()).toBe(true);

    applyPatch(harness, [{ rowIndex: 0, values: ['ZEBRA'] }]);
    harness.backend.flush();

    expect(harness.responses.some((r) => r.kind === 'quickSearch:success')).toBe(false);
    expect(harness.runtime.hasActiveQueryHandle()).toBe(false);

    harness.responses.length = 0;
    harness.runtime.handleMessage(queryMessage(2, 'ZEBRA', 1, null, 0, 'auto', 0, 1));
    harness.backend.flush();
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:success',
      requestId: 2,
      indexes: Uint32Array.from([0]),
    });
  });

  it('worker staging-limit rejects oversized totalUniqueRows on start', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 10_000,
      totalChunks: 1,
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 1,
      generation: 1,
      reason: 'staging-limit',
    });
  });

  it('wrong-generation chunk rejects with generation-mismatch identifying active patch', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 7,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 7,
      generation: 99,
      chunkSequence: 0,
      updates: [{ rowIndex: 0, values: ['X'] }],
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 7,
      generation: 1,
      reason: 'generation-mismatch',
    });
    expect(harness.runtime.isPatching()).toBe(false);
    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
    expect(harness.runtime.getAppliedRevisions()?.searchableDataRevision).toBe(0);
  });

  it('wrong-generation complete rejects with generation-mismatch', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 3,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 3,
      generation: 1,
      chunkSequence: 0,
      updates: [{ rowIndex: 0, values: ['X'] }],
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchComplete',
      patchId: 3,
      generation: 99,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 3,
      generation: 1,
      reason: 'generation-mismatch',
    });
    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
    expect(harness.runtime.getAppliedRevisions()?.searchableDataRevision).toBe(0);
  });

  it('wrong patch ID rejects with chunk-sequence-mismatch identifying active patch', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 5,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 99,
      generation: 1,
      chunkSequence: 0,
      updates: [{ rowIndex: 0, values: ['X'] }],
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 5,
      generation: 1,
      reason: 'chunk-sequence-mismatch',
    });
    expect(harness.runtime.isPatching()).toBe(false);
    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
  });

  it('target revision mismatch on complete rejects with revision-mismatch', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 1,
      generation: 1,
      chunkSequence: 0,
      updates: [{ rowIndex: 0, values: ['X'] }],
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchComplete',
      patchId: 1,
      generation: 1,
      targetDataRevision: 9,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 1,
      generation: 1,
      reason: 'revision-mismatch',
    });
    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
    expect(harness.runtime.getAppliedRevisions()?.searchableDataRevision).toBe(0);
  });

  it('rejected complete never mutates row text or applied revision', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ALICE', 'BOB']);
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 1,
      generation: 1,
      sourceLayoutRevision: 0,
      baseDataRevision: 0,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 1,
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 1,
      generation: 1,
      chunkSequence: 0,
      updates: [{ rowIndex: 0, values: ['X'] }],
    });
    harness.runtime.handleMessage({
      kind: 'quickSearch:snapshotPatchComplete',
      patchId: 1,
      generation: 1,
      targetDataRevision: 1,
      totalUniqueRows: 1,
      totalChunks: 2,
    });
    expect(harness.responses).toContainEqual({
      kind: 'quickSearch:patchRejected',
      patchId: 1,
      generation: 1,
      reason: 'incomplete-staging',
    });
    expect(harness.runtime.getSnapshotStore().getRowText(0)).toBe('ALICE');
    expect(harness.runtime.getSnapshotStore().getRowText(1)).toBe('BOB');
    expect(harness.runtime.getAppliedRevisions()).toEqual({
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
  });
});

describe('quickSearchWorker.ts entry file', () => {
  const workerSource = readFileSync(join(here, '../quickSearchWorker.ts'), 'utf8');

  it('exists and imports QuickSearchWorkerRuntime', () => {
    expect(workerSource).toContain('QuickSearchWorkerRuntime');
  });

  it('calls runtime.handleMessage on incoming messages', () => {
    expect(workerSource).toContain('handleMessage');
  });

  it('does not import Grid, GridState, React, or renderer modules', () => {
    expect(workerSource).not.toMatch(/from ['"].*Grid['"]/);
    expect(workerSource).not.toMatch(/GridState/);
    expect(workerSource).not.toMatch(/@lightfastgrid\/react/);
    expect(workerSource).not.toMatch(/renderer/);
  });
});

describe('QuickSearchWorkerRuntime transfer safety', () => {
  /**
   * Simulate what quickSearchWorker.ts does: after the runtime posts a
   * success response, the worker entry transfers response.indexes.buffer,
   * detaching it from the worker's memory space.
   */
  function simulateTransfer(responses: QuickSearchWorkerResponse[]): void {
    for (const r of responses) {
      if (r.kind === 'quickSearch:success') {
        structuredClone(r, { transfer: [r.indexes.buffer] });
      }
    }
  }

  it('eng → transfer → english: lazy narrowing still returns expected rows', () => {
    const harness = createRuntime();
    completeSnapshot(harness, [
      'ENGLISH',
      'FRENCH',
      'GERMAN',
      'ENGLISH LITERATURE',
    ]);

    harness.runtime.handleMessage(queryMessage(1, 'ENG'));
    harness.backend.flush();
    expect(harness.responses.some((r) => r.kind === 'quickSearch:success')).toBe(true);

    simulateTransfer(harness.responses);
    harness.responses.length = 0;

    harness.runtime.handleMessage(queryMessage(2, 'ENGLISH'));
    harness.backend.flush();

    const success = harness.responses.find((r) => r.kind === 'quickSearch:success');
    expect(success).toBeDefined();
    if (success?.kind === 'quickSearch:success') {
      expect(Array.from(success.indexes).sort()).toEqual([0, 3]);
    }
  });

  it('eng → transfer → eng: exact cache repeat still returns expected rows', () => {
    const harness = createRuntime();
    completeSnapshot(harness, ['ENGLISH', 'FRENCH', 'GERMAN']);

    harness.runtime.handleMessage(queryMessage(1, 'ENG'));
    harness.backend.flush();

    const first = harness.responses.find((r) => r.kind === 'quickSearch:success');
    expect(first?.kind).toBe('quickSearch:success');
    if (first?.kind === 'quickSearch:success') {
      expect(Array.from(first.indexes)).toEqual([0]);
    }

    simulateTransfer(harness.responses);
    harness.responses.length = 0;

    harness.runtime.handleMessage(queryMessage(2, 'ENG'));
    harness.backend.flush();

    const second = harness.responses.find((r) => r.kind === 'quickSearch:success');
    expect(second).toBeDefined();
    if (second?.kind === 'quickSearch:success') {
      expect(Array.from(second.indexes)).toEqual([0]);
    }
  });

});

describe('QuickSearchWorkerRuntime message dispatch', () => {
  it('routes all supported request kinds without throwing', () => {
    const responses: QuickSearchWorkerResponse[] = [];
    const runtime = new QuickSearchWorkerRuntime((r) => responses.push(r));
    const messages: QuickSearchWorkerRequest[] = [
      snapshotStart(1, 1),
      snapshotChunk(1, makeRows(['A'])),
      { kind: 'quickSearch:snapshotComplete', generation: 1 },
      queryMessage(1, 'A'),
      { kind: 'quickSearch:cancel', requestId: 1 },
      { kind: 'quickSearch:clearSnapshot' },
      {
        kind: 'quickSearch:snapshotPatchStart',
        patchId: 1,
        generation: 1,
        sourceLayoutRevision: 0,
        baseDataRevision: 0,
        targetDataRevision: 1,
        totalUniqueRows: 0,
        totalChunks: 0,
      },
      {
        kind: 'quickSearch:snapshotPatchChunk',
        patchId: 1,
        generation: 1,
        chunkSequence: 0,
        updates: [{ rowIndex: 0, values: ['X'] }],
      },
      {
        kind: 'quickSearch:snapshotPatchComplete',
        patchId: 1,
        generation: 1,
        targetDataRevision: 1,
        totalUniqueRows: 0,
        totalChunks: 0,
      },
    ];

    expect(() => {
      for (const message of messages) runtime.handleMessage(message);
    }).not.toThrow();
  });
});
