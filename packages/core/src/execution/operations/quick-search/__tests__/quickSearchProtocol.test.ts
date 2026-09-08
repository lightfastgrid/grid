import { describe, expect, it } from 'vitest';

import type {
  CancelQueryMessage,
  ClearSnapshotMessage,
  PatchRejectedMessage,
  QueryMessage,
  QuickSearchErrorCode,
  QuickSearchPatchRejectReason,
  QuickSearchSuccessResponse,
  QuickSearchWorkerRequest,
  QuickSearchWorkerResponse,
  SearchableFieldsSnapshotChunkMessage,
  SearchableSnapshotRow,
  SnapshotCompleteMessage,
  SnapshotPatchChunkMessage,
  SnapshotPatchCompleteMessage,
  SnapshotPatchStartMessage,
  SnapshotStartMessage,
} from '../quickSearchProtocol';
import { QUICK_SEARCH_RECOVERABLE_ERROR_CODES } from '../quickSearchProtocol';

describe('Quick Search Worker Protocol', () => {
  // ── 8. Snapshot chunks are searchable/projection-only ───────────────

  it('SearchableSnapshotRow contains rowIndex and string values, not RowData', () => {
    const row: SearchableSnapshotRow = {
      rowIndex: 0,
      values: ['ALICE', 'LAHORE'],
    };
    expect(row.rowIndex).toBe(0);
    expect(row.values).toEqual(['ALICE', 'LAHORE']);
    expect('name' in row).toBe(false);
    expect('city' in row).toBe(false);
  });

  it('snapshot chunk message carries SearchableSnapshotRow[], not RowData[]', () => {
    const chunk: SearchableFieldsSnapshotChunkMessage = {
      kind: 'quickSearch:snapshotChunk',
      generation: 1,
      startIndex: 0,
      payloadFormat: 'searchable-fields-v1',
      rows: [
        { rowIndex: 0, values: ['ALICE', 'LAHORE'] },
        { rowIndex: 1, values: ['BOB', 'LONDON'] },
      ],
    };
    expect(chunk.rows[0]!.values).toEqual(['ALICE', 'LAHORE']);
    expect(chunk.payloadFormat).toBe('searchable-fields-v1');
    for (const row of chunk.rows) {
      expect(Object.keys(row).sort()).toEqual(['rowIndex', 'values']);
    }
  });

  it('snapshot start includes generation, fields, payloadFormat, normalizerSignature, revisions', () => {
    const start: SnapshotStartMessage = {
      kind: 'quickSearch:snapshotStart',
      generation: 1,
      rowCount: 1000,
      fields: [
        { field: 'name' },
        { field: 'bankBalance', projectionField: 'bankBalanceSearch' },
      ],
      payloadFormat: 'searchable-fields-v1',
      normalizerSignature: 'qs-norm-v1',
      sourceLayoutRevision: 3,
      searchableDataRevision: 7,
    };
    expect(start.kind).toBe('quickSearch:snapshotStart');
    expect(start.normalizerSignature).toBe('qs-norm-v1');
    expect(start.fields).toHaveLength(2);
    expect(start.sourceLayoutRevision).toBe(3);
    expect(start.searchableDataRevision).toBe(7);
  });

  // ── Transactional patch protocol ────────────────────────────────────

  it('snapshotPatchStart carries exact required transactional fields', () => {
    const start: SnapshotPatchStartMessage = {
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 9,
      generation: 2,
      sourceLayoutRevision: 1,
      baseDataRevision: 4,
      targetDataRevision: 5,
      totalUniqueRows: 3,
      totalChunks: 2,
    };
    expect(start).toEqual({
      kind: 'quickSearch:snapshotPatchStart',
      patchId: 9,
      generation: 2,
      sourceLayoutRevision: 1,
      baseDataRevision: 4,
      targetDataRevision: 5,
      totalUniqueRows: 3,
      totalChunks: 2,
    });
  });

  it('snapshotPatchChunk carries patchId, generation, sequence, and updates', () => {
    const chunk: SnapshotPatchChunkMessage = {
      kind: 'quickSearch:snapshotPatchChunk',
      patchId: 9,
      generation: 2,
      chunkSequence: 0,
      updates: [{ rowIndex: 4, values: ['ALICE'] }],
    };
    expect(chunk.chunkSequence).toBe(0);
    expect(chunk.updates[0]).toEqual({ rowIndex: 4, values: ['ALICE'] });
    expect(Object.keys(chunk.updates[0]!).sort()).toEqual(['rowIndex', 'values']);
  });

  it('snapshotPatchComplete carries target revision and totals', () => {
    const complete: SnapshotPatchCompleteMessage = {
      kind: 'quickSearch:snapshotPatchComplete',
      patchId: 9,
      generation: 2,
      targetDataRevision: 5,
      totalUniqueRows: 3,
      totalChunks: 2,
    };
    expect(complete.targetDataRevision).toBe(5);
    expect(complete.totalUniqueRows).toBe(3);
    expect(complete.totalChunks).toBe(2);
  });

  it('patchRejected is a typed response with every allowed reason', () => {
    const reasons: QuickSearchPatchRejectReason[] = [
      'generation-mismatch',
      'layout-mismatch',
      'revision-mismatch',
      'chunk-sequence-mismatch',
      'incomplete-staging',
      'staging-limit',
    ];
    for (const reason of reasons) {
      const rejected: PatchRejectedMessage = {
        kind: 'quickSearch:patchRejected',
        patchId: 1,
        generation: 2,
        reason,
      };
      expect(rejected.reason).toBe(reason);
    }
    expect(reasons).toHaveLength(6);
  });

  it('patch-in-progress is a query error code and not a recoverable mismatch', () => {
    const code: QuickSearchErrorCode = 'patch-in-progress';
    expect(code).toBe('patch-in-progress');
    expect(QUICK_SEARCH_RECOVERABLE_ERROR_CODES.has('patch-in-progress')).toBe(false);
  });

  it('old quickSearch:snapshotPatch kind is not part of the protocol', () => {
    const requestKinds: QuickSearchWorkerRequest['kind'][] = [
      'quickSearch:snapshotStart',
      'quickSearch:snapshotChunk',
      'quickSearch:snapshotComplete',
      'quickSearch:snapshotPatchStart',
      'quickSearch:snapshotPatchChunk',
      'quickSearch:snapshotPatchComplete',
      'quickSearch:query',
      'quickSearch:cancel',
      'quickSearch:clearSnapshot',
    ];
    expect(requestKinds).not.toContain('quickSearch:snapshotPatch');
    expect(new Set(requestKinds).size).toBe(9);
  });

  // ── 9. Success response uses Uint32Array ────────────────────────────

  it('success response contains Uint32Array indexes', () => {
    const response: QuickSearchSuccessResponse = {
      kind: 'quickSearch:success',
      requestId: 42,
      indexes: new Uint32Array([0, 3, 7, 15]),
    };
    expect(response.indexes).toBeInstanceOf(Uint32Array);
    expect(response.indexes.length).toBe(4);
    expect(response.indexes[2]).toBe(7);
  });

  it('empty result uses zero-length Uint32Array', () => {
    const response: QuickSearchSuccessResponse = {
      kind: 'quickSearch:success',
      requestId: 1,
      indexes: new Uint32Array(0),
    };
    expect(response.indexes.length).toBe(0);
  });

  // ── Protocol message discriminants ──────────────────────────────────

  it('all request message kinds are distinct', () => {
    const kinds = new Set<string>();
    const messages: QuickSearchWorkerRequest[] = [
      {
        kind: 'quickSearch:snapshotStart',
        generation: 1,
        rowCount: 0,
        fields: [],
        payloadFormat: 'searchable-fields-v1',
        normalizerSignature: 'v1',
        sourceLayoutRevision: 0,
        searchableDataRevision: 0,
      },
      {
        kind: 'quickSearch:snapshotChunk',
        generation: 1,
        startIndex: 0,
        payloadFormat: 'searchable-fields-v1',
        rows: [],
      },
      { kind: 'quickSearch:snapshotComplete', generation: 1 },
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
        updates: [],
      },
      {
        kind: 'quickSearch:snapshotPatchComplete',
        patchId: 1,
        generation: 1,
        targetDataRevision: 1,
        totalUniqueRows: 0,
        totalChunks: 0,
      },
      {
        kind: 'quickSearch:query',
        generation: 1,
        requestId: 1,
        normalizedText: 'TEST',
        sourceIndexes: null,
        sourceVersion: 0,
        cacheMode: 'auto',
        sourceLayoutRevision: 0,
        searchableDataRevision: 0,
      },
      { kind: 'quickSearch:cancel' },
      { kind: 'quickSearch:clearSnapshot' },
    ];
    for (const m of messages) {
      kinds.add(m.kind);
    }
    expect(kinds.size).toBe(9);
  });

  it('all response message kinds are distinct', () => {
    const kinds = new Set<string>();
    const responses: QuickSearchWorkerResponse[] = [
      { kind: 'quickSearch:ready', generation: 1 },
      { kind: 'quickSearch:success', requestId: 1, indexes: new Uint32Array(0) },
      { kind: 'quickSearch:error', requestId: 1, code: 'worker-error', message: 'fail' },
      {
        kind: 'quickSearch:patchRejected',
        patchId: 1,
        generation: 1,
        reason: 'revision-mismatch',
      },
    ];
    for (const r of responses) {
      kinds.add(r.kind);
    }
    expect(kinds.size).toBe(4);
  });

  it('query message includes sourceIndexes and normalizedText', () => {
    const query: QueryMessage = {
      kind: 'quickSearch:query',
      generation: 1,
      requestId: 5,
      normalizedText: 'ALICE',
      sourceIndexes: new Uint32Array([0, 2, 4]),
      sourceVersion: 0,
      sourceLayoutRevision: 1,
      searchableDataRevision: 2,
      cacheMode: false,
    };
    expect(query.sourceIndexes).toBeInstanceOf(Uint32Array);
    expect(query.normalizedText).toBe('ALICE');
    expect(query.cacheMode).toBe(false);
  });

  it('cancel message supports optional requestId', () => {
    const cancelAll: CancelQueryMessage = { kind: 'quickSearch:cancel' };
    const cancelOne: CancelQueryMessage = {
      kind: 'quickSearch:cancel',
      requestId: 42,
    };
    expect(cancelAll.requestId).toBeUndefined();
    expect(cancelOne.requestId).toBe(42);
  });

  it('clear snapshot message has no payload', () => {
    const clear: ClearSnapshotMessage = { kind: 'quickSearch:clearSnapshot' };
    expect(Object.keys(clear)).toEqual(['kind']);
  });

  it('snapshot complete message has generation only', () => {
    const complete: SnapshotCompleteMessage = {
      kind: 'quickSearch:snapshotComplete',
      generation: 3,
    };
    expect(complete.generation).toBe(3);
  });
});
