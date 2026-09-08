import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import type { SearchableFieldDescriptor } from '../../../../features/quick-search/searchableFieldResolver';
import type { CooperativeSchedulerBackend } from '../../../../scheduling/CooperativeScheduler';
import { CooperativeScheduler } from '../../../../scheduling/CooperativeScheduler';
import type {
  QuickSearchWorkerRequest,
  QuickSearchWorkerResponse,
} from '../quickSearchProtocol';
import { QuickSearchSnapshotClient } from '../QuickSearchSnapshotClient';
import { QuickSearchWorkerClient } from '../QuickSearchWorkerClient';

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, '../QuickSearchWorkerClient.ts'), 'utf8');

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

interface PostedMessage {
  message: QuickSearchWorkerRequest;
  transfer?: Transferable[];
}

function createHarness(options?: {
  throwOnPost?: Error;
  throwOnCancel?: boolean;
  shouldThrow?: (message: QuickSearchWorkerRequest) => Error | null;
}) {
  const posted: PostedMessage[] = [];
  const subscribers = new Set<(response: QuickSearchWorkerResponse) => void>();
  const terminate = vi.fn();

  const transport = {
    post(message: QuickSearchWorkerRequest, transfer?: Transferable[]) {
      if (options?.throwOnCancel && message.kind === 'quickSearch:cancel') {
        throw new Error('cancel failed');
      }
      if (options?.shouldThrow) {
        const err = options.shouldThrow(message);
        if (err) throw err;
      }
      if (options?.throwOnPost) throw options.throwOnPost;
      posted.push({ message, transfer });
    },
    subscribe(handler: (response: QuickSearchWorkerResponse) => void) {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },
    terminate,
  };

  const backend = createManualBackend();
  const client = new QuickSearchWorkerClient(transport, {
    scheduler: new CooperativeScheduler(backend),
  });

  const emit = (response: QuickSearchWorkerResponse) => {
    for (const handler of subscribers) handler(response);
  };

  return { client, posted, backend, emit, terminate, transport };
}

function createInjectedSnapshotHarness(options?: {
  shouldFailSnapshot?: (message: QuickSearchWorkerRequest) => boolean;
}) {
  const posted: PostedMessage[] = [];
  const snapshotPosted: QuickSearchWorkerRequest[] = [];
  const subscribers = new Set<(response: QuickSearchWorkerResponse) => void>();
  const terminate = vi.fn();

  const transport = {
    post(message: QuickSearchWorkerRequest, transfer?: Transferable[]) {
      posted.push({ message, transfer });
    },
    subscribe(handler: (response: QuickSearchWorkerResponse) => void) {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },
    terminate,
  };

  const backend = createManualBackend();
  const scheduler = new CooperativeScheduler(backend);
  const snapshotClient = new QuickSearchSnapshotClient(
    {
      post(message) {
        if (options?.shouldFailSnapshot?.(message)) return false;
        snapshotPosted.push(message);
        return true;
      },
    },
    scheduler,
  );
  const client = new QuickSearchWorkerClient(transport, {
    scheduler,
    snapshotClient,
  });

  const emit = (response: QuickSearchWorkerResponse) => {
    for (const handler of subscribers) handler(response);
  };

  return { client, posted, snapshotPosted, backend, emit, terminate };
}

function desc(field: string, projectionField?: string): SearchableFieldDescriptor {
  return { field, projectionField, workerEligible: true };
}

const rows = [
  { name: 'Alice', city: 'Lahore' },
  { name: 'Bob', city: 'London' },
  { name: 'Cara', city: 'Berlin' },
];

const baseConfig = {
  rows,
  descriptors: [desc('name'), desc('city')],
  fieldsSignature: 'sig-a',
  chunkSize: 2,
  sourceVersion: 0,
  cacheMode: 'auto' as const,
  sourceLayoutRevision: 0,
  searchableDataRevision: 0,
};

function snapshotMessages(posted: PostedMessage[]) {
  return posted.map((p) => p.message).filter((m) => m.kind.startsWith('quickSearch:snapshot'));
}

function queryMessages(posted: PostedMessage[]) {
  return posted
    .map((p) => p.message)
    .filter(
      (m): m is Extract<QuickSearchWorkerRequest, { kind: 'quickSearch:query' }> =>
        m.kind === 'quickSearch:query',
    );
}

function cancelMessages(posted: PostedMessage[]) {
  return posted.map((p) => p.message).filter((m) => m.kind === 'quickSearch:cancel');
}

describe('QuickSearchWorkerClient', () => {
  it('empty query cancels active query and posts no snapshot or query messages', () => {
    const { client, posted, backend, emit } = createHarness();
    const onSuccess = vi.fn();
    const onFallback = vi.fn();
    const onSyncing = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback, onSyncing },
    );
    backend.flush();
    expect(queryMessages(posted)).toHaveLength(0);
    posted.length = 0;
    onSyncing.mockClear();

    client.execute(
      { ...baseConfig, normalizedText: '   ' },
      { onSuccess, onFallback, onSyncing },
    );

    expect(snapshotMessages(posted)).toHaveLength(0);
    expect(queryMessages(posted)).toHaveLength(0);
    expect(cancelMessages(posted)).toHaveLength(1);
    expect(onSyncing).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(Uint32Array.from([0, 1, 2]));
    expect(client.getActiveRequestId()).toBeNull();

    emit({
      kind: 'quickSearch:success',
      requestId: 1,
      indexes: Uint32Array.from([99]),
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('empty query with transfer emits cancelled once and posts no worker messages', () => {
    const { client, posted } = createHarness();
    const dispositions: unknown[] = [];
    const onSuccess = vi.fn();
    const onFallback = vi.fn();

    client.execute(
      {
        ...baseConfig,
        normalizedText: '   ',
        transfer: {
          transferId: 42,
          indexes: new Set([0]),
          complete: true,
          onDisposition: (d) => {
            dispositions.push(d);
          },
        },
      },
      { onSuccess, onFallback },
    );

    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 42 }]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(Uint32Array.from([0, 1, 2]));
    expect(onFallback).not.toHaveBeenCalled();
    expect(snapshotMessages(posted)).toHaveLength(0);
    expect(queryMessages(posted)).toHaveLength(0);
    expect(
      posted.some((p) => p.message.kind.startsWith('quickSearch:snapshotPatch')),
    ).toBe(false);
    expect(client.getActiveRequestId()).toBeNull();
  });

  it('first non-empty query starts searchable-only snapshot sync', () => {
    const { client, posted, backend } = createHarness();
    const onSuccess = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback: vi.fn() },
    );
    backend.flush();

    const snapshot = snapshotMessages(posted);
    expect(snapshot.map((m) => m.kind)).toEqual([
      'quickSearch:snapshotStart',
      'quickSearch:snapshotChunk',
      'quickSearch:snapshotChunk',
      'quickSearch:snapshotComplete',
    ]);
    expect(queryMessages(posted)).toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('posts query after matching ready when snapshot was syncing', () => {
    const { client, posted, backend, emit } = createHarness();
    const onSuccess = vi.fn();
    const onSyncing = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback: vi.fn(), onSyncing },
    );
    backend.step();
    expect(onSyncing).toHaveBeenCalledTimes(1);
    expect(queryMessages(posted)).toHaveLength(0);

    backend.flush();
    const generation = client.getSnapshotClient().getCurrentGeneration();
    emit({ kind: 'quickSearch:ready', generation });

    expect(queryMessages(posted)).toHaveLength(1);
    const query = queryMessages(posted)[0]!;
    expect(query.normalizedText).toBe('ALICE');
    expect(query.generation).toBe(generation);
    expect(query.requestId).toBe(1);
    expect(query.cacheMode).toBe('auto');

    emit({
      kind: 'quickSearch:success',
      requestId: 1,
      indexes: Uint32Array.from([0]),
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(Uint32Array.from([0]));
  });

  it('posts cacheMode from execute config on query messages', () => {
    const { client, posted, backend, emit } = createHarness();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE', cacheMode: false },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );

    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });

    const query = queryMessages(posted)[0]!;
    expect(query.cacheMode).toBe(false);
  });

  it('stale ready from old generation does not post query', () => {
    const { client, posted, backend, emit } = createHarness();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.step();

    const newRows = [
      { name: 'Zed' },
      { name: 'Yana' },
      { name: 'Xavi' },
    ];
    client.execute(
      {
        rows: newRows,
        descriptors: [desc('name')],
        fieldsSignature: 'sig-a',
        chunkSize: 1,
        normalizedText: 'ZED',
        sourceVersion: 0,
        cacheMode: 'auto',
        sourceLayoutRevision: 0,
        searchableDataRevision: 0,
      },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.step();
    const currentGen = client.getSnapshotClient().getCurrentGeneration();
    expect(queryMessages(posted)).toHaveLength(0);

    emit({ kind: 'quickSearch:ready', generation: currentGen - 1 });

    expect(queryMessages(posted)).toHaveLength(0);
  });

  it('second query cancels first request before posting the new query', () => {
    const { client, posted, backend, emit } = createHarness();
    const firstSuccess = vi.fn();
    const secondSuccess = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: firstSuccess, onFallback: vi.fn() },
    );
    backend.flush();
    const generation = client.getSnapshotClient().getCurrentGeneration();
    emit({ kind: 'quickSearch:ready', generation });

    const cancelsBeforeSecond = cancelMessages(posted).length;
    posted.length = 0;

    client.execute(
      { ...baseConfig, normalizedText: 'BOB' },
      { onSuccess: secondSuccess, onFallback: vi.fn() },
    );

    expect(cancelMessages(posted)).toHaveLength(1);
    expect(cancelMessages(posted)[0]).toEqual({
      kind: 'quickSearch:cancel',
      requestId: 1,
    });
    expect(cancelsBeforeSecond).toBe(0);

    emit({
      kind: 'quickSearch:success',
      requestId: 1,
      indexes: Uint32Array.from([0]),
    });
    expect(firstSuccess).not.toHaveBeenCalled();

    emit({ kind: 'quickSearch:ready', generation });
    const query = queryMessages(posted)[0]!;
    expect(query.requestId).toBe(2);
    expect(query.normalizedText).toBe('BOB');

    emit({
      kind: 'quickSearch:success',
      requestId: 2,
      indexes: Uint32Array.from([1]),
    });
    expect(secondSuccess).toHaveBeenCalledTimes(1);
  });

  it('stale success response is ignored', () => {
    const { client, backend, emit } = createHarness();
    const firstSuccess = vi.fn();
    const secondSuccess = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: firstSuccess, onFallback: vi.fn() },
    );
    backend.flush();
    const generation = client.getSnapshotClient().getCurrentGeneration();
    emit({ kind: 'quickSearch:ready', generation });

    client.execute(
      { ...baseConfig, normalizedText: 'BOB' },
      { onSuccess: secondSuccess, onFallback: vi.fn() },
    );
    emit({ kind: 'quickSearch:ready', generation });

    emit({
      kind: 'quickSearch:success',
      requestId: 1,
      indexes: Uint32Array.from([0]),
    });
    expect(firstSuccess).not.toHaveBeenCalled();
    expect(secondSuccess).not.toHaveBeenCalled();

    emit({
      kind: 'quickSearch:success',
      requestId: 2,
      indexes: Uint32Array.from([1]),
    });
    expect(secondSuccess).toHaveBeenCalledTimes(1);
  });

  it('matching success completes once with Uint32Array', () => {
    const { client, backend, emit } = createHarness();
    const onSuccess = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback: vi.fn() },
    );
    backend.flush();
    const generation = client.getSnapshotClient().getCurrentGeneration();
    emit({ kind: 'quickSearch:ready', generation });

    const indexes = Uint32Array.from([0, 2]);
    emit({ kind: 'quickSearch:success', requestId: 1, indexes });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(indexes);
    expect(onSuccess.mock.calls[0]![0]).toBeInstanceOf(Uint32Array);
    expect(client.getActiveRequestId()).toBeNull();
  });

  it('matching error calls onFallback once and clears active state', () => {
    const { client, backend, emit } = createHarness();
    const onFallback = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback },
    );
    backend.flush();
    const generation = client.getSnapshotClient().getCurrentGeneration();
    emit({ kind: 'quickSearch:ready', generation });

    emit({
      kind: 'quickSearch:error',
      requestId: 1,
      code: 'worker-error',
      message: 'worker failed',
    });

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(new Error('[worker-error] worker failed'));
    expect(client.getActiveRequestId()).toBeNull();

    emit({
      kind: 'quickSearch:error',
      requestId: 1,
      code: 'worker-error',
      message: 'late error',
    });
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('cancel handle posts cancel and prevents later completion', () => {
    const { client, posted, backend, emit } = createHarness();
    const onSuccess = vi.fn();

    const handle = client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback: vi.fn() },
    );
    backend.flush();
    const generation = client.getSnapshotClient().getCurrentGeneration();
    emit({ kind: 'quickSearch:ready', generation });
    posted.length = 0;

    handle.cancel();
    expect(cancelMessages(posted)).toEqual([
      { kind: 'quickSearch:cancel', requestId: 1 },
    ]);
    expect(client.getActiveRequestId()).toBeNull();

    emit({
      kind: 'quickSearch:success',
      requestId: 1,
      indexes: Uint32Array.from([0]),
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('cancelQuery cancels active query without clearing snapshot', () => {
    const { client, posted, backend, emit } = createHarness();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();
    const generation = client.getSnapshotClient().getCurrentGeneration();
    emit({ kind: 'quickSearch:ready', generation });

    posted.length = 0;
    client.cancelQuery();

    expect(cancelMessages(posted)).toHaveLength(1);
    expect(
      posted.some((p) => p.message.kind === 'quickSearch:clearSnapshot'),
    ).toBe(false);
    expect(client.getSnapshotClient().isSnapshotComplete()).toBe(true);
    expect(client.getActiveRequestId()).toBeNull();
  });

  it('clear cancels active query and clears snapshot client', () => {
    const { client, posted, backend } = createHarness();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.step();
    client.clear();

    expect(cancelMessages(posted).length).toBeGreaterThan(0);
    expect(
      posted.some((p) => p.message.kind === 'quickSearch:clearSnapshot'),
    ).toBe(true);
    expect(client.getSnapshotClient().isSnapshotComplete()).toBe(false);
    expect(client.getActiveRequestId()).toBeNull();
  });

  it('destroy cancels active query, clears snapshot, unsubscribes, and terminates', () => {
    const { client, posted, backend, emit, terminate } = createHarness();
    const onSuccess = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback: vi.fn() },
    );
    backend.flush();
    const generation = client.getSnapshotClient().getCurrentGeneration();
    emit({ kind: 'quickSearch:ready', generation });

    client.destroy();
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(
      posted.some((p) => p.message.kind === 'quickSearch:clearSnapshot'),
    ).toBe(true);

    emit({
      kind: 'quickSearch:success',
      requestId: 1,
      indexes: Uint32Array.from([0]),
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('prewarm delegates to snapshot client and does not post query', () => {
    const { client, posted, backend } = createHarness();

    client.prewarm(baseConfig);
    backend.flush();

    expect(snapshotMessages(posted).length).toBeGreaterThan(0);
    expect(queryMessages(posted)).toHaveLength(0);
  });

  it('snapshot chunks never carry RowData[]', () => {
    const { client, posted, backend } = createHarness();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();

    for (const { message } of posted) {
      if (message.kind !== 'quickSearch:snapshotChunk') continue;
      if (message.payloadFormat !== 'searchable-fields-v1') continue;
      for (const row of message.rows) {
        expect(Object.keys(row).sort()).toEqual(['rowIndex', 'values']);
      }
    }
  });

  it('does not import Grid, GridState, React, or renderer modules', () => {
    expect(clientSource).not.toMatch(/from ['"].*Grid['"]/);
    expect(clientSource).not.toMatch(/GridState/);
    expect(clientSource).not.toMatch(/@lightfastgrid\/react/);
    expect(clientSource).not.toMatch(/renderer/);
  });

  it('does not transfer caller-provided sourceIndexes or detach buffers', () => {
    const { client, posted, backend, emit } = createHarness();
    const sourceIndexes = Uint32Array.from([2, 0]);
    const bufferBefore = sourceIndexes.buffer;

    client.execute(
      {
        ...baseConfig,
        normalizedText: 'ALICE',
        sourceIndexes,
      },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });

    const query = queryMessages(posted)[0]!;
    expect(query.sourceIndexes).toEqual(Uint32Array.from([2, 0]));
    expect(sourceIndexes.buffer).toBe(bufferBefore);
    expect(sourceIndexes.byteLength).toBe(8);

    for (const { transfer } of posted) {
      expect(transfer === undefined || transfer.length === 0).toBe(true);
    }
  });

  it('snapshot sync transport failure calls onFallback without onSyncing or pending state', () => {
    const { client } = createHarness({
      throwOnPost: new Error('post failed'),
    });
    const onFallback = vi.fn();
    const onSyncing = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback, onSyncing },
    );

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(new Error('post failed'));
    expect(onSyncing).not.toHaveBeenCalled();
    expect(client.getActiveRequestId()).toBeNull();
  });

  it('cancel post failure does not call onFallback for the canceled request', () => {
    const { client, backend, emit } = createHarness({ throwOnCancel: true });
    const onFallback = vi.fn();

    const handle = client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });

    handle.cancel();
    expect(onFallback).not.toHaveBeenCalled();
    expect(client.getActiveRequestId()).toBeNull();
  });

  it('cancel post failure during supersede does not call onFallback for the canceled query', () => {
    const { client, backend, emit } = createHarness({ throwOnCancel: true });
    const firstFallback = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback: firstFallback },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });

    client.execute(
      { ...baseConfig, normalizedText: 'BOB' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );

    expect(firstFallback).not.toHaveBeenCalled();
  });

  it('new query after cancelQuery reuses completed snapshot', () => {
    const { client, posted, backend, emit } = createHarness();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();
    const generation = client.getSnapshotClient().getCurrentGeneration();
    emit({ kind: 'quickSearch:ready', generation });

    client.cancelQuery();
    const postedAfterCancel = posted.length;

    const secondSuccess = vi.fn();
    client.execute(
      { ...baseConfig, normalizedText: 'BOB' },
      { onSuccess: secondSuccess, onFallback: vi.fn() },
    );

    const newSnapshotPosts = posted
      .slice(postedAfterCancel)
      .filter((p) => p.message.kind === 'quickSearch:snapshotStart');
    expect(newSnapshotPosts).toHaveLength(0);

    emit({ kind: 'quickSearch:ready', generation });
    const queries = queryMessages(posted.slice(postedAfterCancel));
    expect(queries.length).toBeGreaterThanOrEqual(1);
  });

  it('reuses complete snapshot without reposting snapshotStart on second query', () => {
    const { client, posted, backend, emit } = createHarness();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    const postedAfterFirst = posted.length;

    client.execute(
      { ...baseConfig, normalizedText: 'BOB' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );

    const newSnapshotPosts = posted
      .slice(postedAfterFirst)
      .filter((p) => p.message.kind === 'quickSearch:snapshotStart');
    expect(newSnapshotPosts).toHaveLength(0);
    expect(queryMessages(posted).length).toBeGreaterThanOrEqual(2);
  });

  it('query carries both revisions and pending query retains them through ready', () => {
    const { client, posted, backend, emit } = createHarness();
    client.execute(
      {
        ...baseConfig,
        normalizedText: 'ALICE',
        sourceLayoutRevision: 5,
        searchableDataRevision: 9,
      },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();
    const start = posted.find((p) => p.message.kind === 'quickSearch:snapshotStart')!.message;
    if (start.kind !== 'quickSearch:snapshotStart') throw new Error('unreachable');
    expect(start.sourceLayoutRevision).toBe(5);
    expect(start.searchableDataRevision).toBe(9);
    expect(queryMessages(posted)).toHaveLength(0);

    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    const query = queryMessages(posted)[0]!;
    expect(query.sourceLayoutRevision).toBe(5);
    expect(query.searchableDataRevision).toBe(9);
  });

  it('recoverable revision mismatch rebuilds once without onFallback', () => {
    const { client, posted, backend, emit } = createHarness();
    const onFallback = vi.fn();
    const onSuccess = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE', searchableDataRevision: 1 },
      { onSuccess, onFallback },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    const requestId = client.getActiveRequestId()!;

    emit({
      kind: 'quickSearch:error',
      requestId,
      code: 'revision-mismatch',
      message: 'revision mismatch',
    });

    expect(onFallback).not.toHaveBeenCalled();
    expect(client.getActiveRequestId()).not.toBeNull();
    expect(
      posted.some((p) => p.message.kind === 'quickSearch:clearSnapshot'),
    ).toBe(true);

    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    emit({
      kind: 'quickSearch:success',
      requestId: client.getActiveRequestId()!,
      indexes: new Uint32Array([0]),
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('second recoverable mismatch after retry calls onFallback exactly once', () => {
    const { client, backend, emit } = createHarness();
    const onFallback = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });

    emit({
      kind: 'quickSearch:error',
      requestId: client.getActiveRequestId()!,
      code: 'layout-mismatch',
      message: 'layout mismatch',
    });
    expect(onFallback).not.toHaveBeenCalled();

    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    emit({
      kind: 'quickSearch:error',
      requestId: client.getActiveRequestId()!,
      code: 'revision-mismatch',
      message: 'again',
    });

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(client.getActiveRequestId()).toBeNull();
  });

  it('stale mismatch response is ignored', () => {
    const { client, backend, emit } = createHarness();
    const onFallback = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    const activeId = client.getActiveRequestId()!;

    emit({
      kind: 'quickSearch:error',
      requestId: activeId - 1,
      code: 'revision-mismatch',
      message: 'stale',
    });
    expect(onFallback).not.toHaveBeenCalled();
    expect(client.getActiveRequestId()).toBe(activeId);
  });

  it('unrelated COW rows reuse does not resync snapshot', () => {
    const { client, posted, backend, emit } = createHarness();
    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    const startsBefore = posted.filter(
      (p) => p.message.kind === 'quickSearch:snapshotStart',
    ).length;

    const cowRows = rows.map((r) => ({ ...r }));
    client.execute(
      { ...baseConfig, rows: cowRows, normalizedText: 'BOB' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );

    expect(
      posted.filter((p) => p.message.kind === 'quickSearch:snapshotStart'),
    ).toHaveLength(startsBefore);
  });

  it('cancel handle after recoverable mismatch cancels the retry requestId', () => {
    const { client, posted, backend, emit } = createHarness();
    const handle = client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    const firstRequestId = client.getActiveRequestId()!;

    emit({
      kind: 'quickSearch:error',
      requestId: firstRequestId,
      code: 'revision-mismatch',
      message: 'revision mismatch',
    });
    const retryRequestId = client.getActiveRequestId()!;
    expect(retryRequestId).not.toBe(firstRequestId);

    handle.cancel();
    const cancels = cancelMessages(posted);
    expect(cancels[cancels.length - 1]).toEqual({
      kind: 'quickSearch:cancel',
      requestId: retryRequestId,
    });
    expect(client.getActiveRequestId()).toBeNull();
  });

  it('cancel while recovered snapshot waits for ready leaves no active logical execution', () => {
    const { client, posted, backend, emit } = createHarness();
    const onSuccess = vi.fn();
    const onFallback = vi.fn();
    const handle = client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });

    emit({
      kind: 'quickSearch:error',
      requestId: client.getActiveRequestId()!,
      code: 'generation-mismatch',
      message: 'generation mismatch',
    });
    expect(client.getActiveRequestId()).not.toBeNull();
    expect(
      posted.some((p) => p.message.kind === 'quickSearch:clearSnapshot'),
    ).toBe(true);
    // Recovery started a fresh incomplete snapshot — waiting for ready.
    expect(client.getSnapshotClient().isSnapshotComplete()).toBe(false);

    handle.cancel();
    expect(client.getActiveRequestId()).toBeNull();

    const retryGen = client.getSnapshotClient().getCurrentGeneration();
    emit({ kind: 'quickSearch:ready', generation: retryGen });
    emit({
      kind: 'quickSearch:success',
      requestId: 2,
      indexes: new Uint32Array([0]),
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
    expect(queryMessages(posted).filter((q) => q.requestId === 2)).toHaveLength(0);
  });

  it('superseding execute makes the original cancel handle a no-op', () => {
    const { client, posted, backend, emit } = createHarness();
    const handle1 = client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });

    client.execute(
      { ...baseConfig, normalizedText: 'BOB' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    const secondRequestId = client.getActiveRequestId();
    const cancelsBefore = cancelMessages(posted).length;

    handle1.cancel();
    expect(cancelMessages(posted)).toHaveLength(cancelsBefore);
    expect(client.getActiveRequestId()).toBe(secondRequestId);
  });

  it('clearSnapshot transport failure during recovery calls fallback once and starts no retry', () => {
    let failClear = false;
    const { client, posted, backend, emit } = createHarness({
      shouldThrow: (message) =>
        failClear && message.kind === 'quickSearch:clearSnapshot'
          ? new Error('clear failed')
          : null,
    });
    const onSuccess = vi.fn();
    const onFallback = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    const startsBefore = posted.filter(
      (p) => p.message.kind === 'quickSearch:snapshotStart',
    ).length;

    failClear = true;
    emit({
      kind: 'quickSearch:error',
      requestId: client.getActiveRequestId()!,
      code: 'revision-mismatch',
      message: 'revision mismatch',
    });

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(client.getActiveRequestId()).toBeNull();
    expect(
      posted.filter((p) => p.message.kind === 'quickSearch:snapshotStart'),
    ).toHaveLength(startsBefore);
    expect(backend.pending()).toBe(0);
  });

  it('snapshotStart transport failure during recovery cannot resurrect active state', () => {
    let failStart = false;
    const { client, posted, backend, emit } = createHarness({
      shouldThrow: (message) =>
        failStart && message.kind === 'quickSearch:snapshotStart'
          ? new Error('snapshotStart failed')
          : null,
    });
    const onSuccess = vi.fn();
    const onFallback = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });

    failStart = true;
    emit({
      kind: 'quickSearch:error',
      requestId: client.getActiveRequestId()!,
      code: 'layout-mismatch',
      message: 'layout mismatch',
    });

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(client.getActiveRequestId()).toBeNull();
    expect(posted.some((p) => p.message.kind === 'quickSearch:query')).toBe(true);
    // Only the original query — no retry query after failed recovery start.
    expect(queryMessages(posted)).toHaveLength(1);
    expect(backend.pending()).toBe(0);

    const failedGen = client.getSnapshotClient().getCurrentGeneration();
    emit({ kind: 'quickSearch:ready', generation: failedGen });
    emit({
      kind: 'quickSearch:success',
      requestId: 2,
      indexes: new Uint32Array([0]),
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(client.getActiveRequestId()).toBeNull();
  });

  it('chunk-post failure during active query calls fallback once and stops extraction', () => {
    let failChunks = false;
    const { client, posted, backend, emit } = createHarness({
      shouldThrow: (message) =>
        failChunks && message.kind === 'quickSearch:snapshotChunk'
          ? new Error('chunk post failed')
          : null,
    });
    const onSuccess = vi.fn();
    const onFallback = vi.fn();

    // Force a rebuild so extraction is in-flight during the query.
    client.execute(
      {
        ...baseConfig,
        normalizedText: 'ALICE',
        chunkSize: 1,
        fieldsSignature: 'sig-chunk-fail',
      },
      { onSuccess, onFallback },
    );
    expect(backend.pending()).toBe(1);

    failChunks = true;
    backend.step();

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(client.getActiveRequestId()).toBeNull();
    expect(backend.pending()).toBe(0);
    expect(
      posted.filter((p) => p.message.kind === 'quickSearch:snapshotChunk'),
    ).toHaveLength(0);
    expect(
      posted.some((p) => p.message.kind === 'quickSearch:snapshotComplete'),
    ).toBe(false);

    emit({
      kind: 'quickSearch:ready',
      generation: 1,
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('initial sync failure via injected snapshot transport calls fallback once', () => {
    const { client, posted, snapshotPosted } = createInjectedSnapshotHarness({
      shouldFailSnapshot: (m) => m.kind === 'quickSearch:snapshotStart',
    });
    const onSuccess = vi.fn();
    const onFallback = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback },
    );

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(client.getActiveRequestId()).toBeNull();
    expect(snapshotPosted).toHaveLength(0);
    expect(queryMessages(posted)).toHaveLength(0);
    expect(posted.some((p) => p.message.kind === 'quickSearch:cancel')).toBe(false);
  });

  it('recovery clear failure via injected snapshot transport calls fallback once without retry sync', () => {
    let failClear = false;
    const { client, snapshotPosted, backend, emit } = createInjectedSnapshotHarness({
      shouldFailSnapshot: (m) =>
        failClear && m.kind === 'quickSearch:clearSnapshot',
    });
    const onSuccess = vi.fn();
    const onFallback = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    const startsBefore = snapshotPosted.filter(
      (m) => m.kind === 'quickSearch:snapshotStart',
    ).length;

    failClear = true;
    emit({
      kind: 'quickSearch:error',
      requestId: client.getActiveRequestId()!,
      code: 'revision-mismatch',
      message: 'revision mismatch',
    });

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(client.getActiveRequestId()).toBeNull();
    expect(
      snapshotPosted.filter((m) => m.kind === 'quickSearch:snapshotStart'),
    ).toHaveLength(startsBefore);
    expect(
      snapshotPosted.some((m) => m.kind === 'quickSearch:clearSnapshot'),
    ).toBe(false);
  });

  it('recovery clear succeeds but retry sync fails calls fallback once', () => {
    let snapshotStarts = 0;
    const { client, snapshotPosted, backend, emit } = createInjectedSnapshotHarness({
      shouldFailSnapshot: (m) => {
        if (m.kind !== 'quickSearch:snapshotStart') return false;
        snapshotStarts += 1;
        return snapshotStarts > 1;
      },
    });
    const onSuccess = vi.fn();
    const onFallback = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });

    emit({
      kind: 'quickSearch:error',
      requestId: client.getActiveRequestId()!,
      code: 'layout-mismatch',
      message: 'layout mismatch',
    });

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(client.getActiveRequestId()).toBeNull();
    expect(
      snapshotPosted.filter((m) => m.kind === 'quickSearch:clearSnapshot'),
    ).toHaveLength(1);
    expect(
      snapshotPosted.filter((m) => m.kind === 'quickSearch:snapshotStart'),
    ).toHaveLength(1);
  });

  it('production adapter clear failure still calls fallback once, not twice', () => {
    let failClear = false;
    const { client, posted, backend, emit } = createHarness({
      shouldThrow: (message) =>
        failClear && message.kind === 'quickSearch:clearSnapshot'
          ? new Error('clear failed')
          : null,
    });
    const onSuccess = vi.fn();
    const onFallback = vi.fn();

    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess, onFallback },
    );
    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    const startsBefore = posted.filter(
      (p) => p.message.kind === 'quickSearch:snapshotStart',
    ).length;

    failClear = true;
    emit({
      kind: 'quickSearch:error',
      requestId: client.getActiveRequestId()!,
      code: 'revision-mismatch',
      message: 'revision mismatch',
    });

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(client.getActiveRequestId()).toBeNull();
    expect(
      posted.filter((p) => p.message.kind === 'quickSearch:snapshotStart'),
    ).toHaveLength(startsBefore);
  });
});

describe('QuickSearchWorkerClient patch/query ordering (Stage 1J-B)', () => {
  function warmReady(
    client: QuickSearchWorkerClient,
    backend: ReturnType<typeof createManualBackend>,
    emit: (r: QuickSearchWorkerResponse) => void,
    posted: PostedMessage[],
  ): number {
    client.execute(
      { ...baseConfig, normalizedText: 'ALICE' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();
    const generation = client.getSnapshotClient().getCurrentGeneration();
    emit({ kind: 'quickSearch:ready', generation });
    const requestId = client.getActiveRequestId()!;
    emit({
      kind: 'quickSearch:success',
      requestId,
      indexes: Uint32Array.from([0]),
    });
    posted.length = 0;
    return generation;
  }

  function makeTransfer(
    transferId: number,
    indexes: Iterable<number>,
    dispositions: unknown[],
  ) {
    return {
      transferId,
      indexes,
      complete: true as const,
      onDisposition: (d: unknown) => {
        dispositions.push(d);
      },
    };
  }

  it('does not post query while outcome is patching', () => {
    const { client, posted, backend, emit } = createHarness();
    const gen = warmReady(client, backend, emit, posted);
    const dispositions: unknown[] = [];
    const onSyncing = vi.fn();

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess: vi.fn(), onFallback: vi.fn(), onSyncing },
    );

    expect(onSyncing).toHaveBeenCalledTimes(1);
    expect(queryMessages(posted)).toHaveLength(0);
    expect(client.getSnapshotClient().isSnapshotComplete()).toBe(true);
    expect(client.getSnapshotClient().getCurrentGeneration()).toBe(gen);

    backend.flush();
    expect(queryMessages(posted)).toHaveLength(1);
  });

  it('posts cancel → patchStart → chunk → patchComplete → query in order', () => {
    const { client, posted, backend, emit } = createHarness();
    warmReady(client, backend, emit, posted);

    // Active query first so superseding execute posts cancel.
    client.execute(
      { ...baseConfig, normalizedText: 'BOB' },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    expect(queryMessages(posted)).toHaveLength(1);
    posted.length = 0;

    const dispositions: unknown[] = [];
    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();

    const kinds = posted.map((p) => p.message.kind);
    expect(kinds).toEqual([
      'quickSearch:cancel',
      'quickSearch:snapshotPatchStart',
      'quickSearch:snapshotPatchChunk',
      'quickSearch:snapshotPatchComplete',
      'quickSearch:query',
    ]);
  });

  it('external posted disposition runs before query post', () => {
    const { client, posted, backend, emit } = createHarness();
    const gen = warmReady(client, backend, emit, posted);
    const order: string[] = [];

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: {
          transferId: 1,
          indexes: [0],
          complete: true,
          onDisposition: (d) => {
            order.push(`disposition:${d.kind}`);
          },
        },
      },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();

    const queryIndex = posted.findIndex((p) => p.message.kind === 'quickSearch:query');
    expect(queryIndex).toBeGreaterThanOrEqual(0);
    // Disposition recorded before the query message was pushed.
    expect(order[0]).toBe('disposition:posted');
    expect(order).toHaveLength(1);

    const query = queryMessages(posted)[0]!;
    expect(query.generation).toBe(gen);
    expect(query.searchableDataRevision).toBe(1);
  });

  it('rebuild-required waits for new ready then posts query once; onSyncing once', () => {
    const { client, posted, backend, emit } = createHarness();
    warmReady(client, backend, emit, posted);
    const dispositions: unknown[] = [];
    const onSyncing = vi.fn();

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        // Incomplete transfer forces full rebuild via SnapshotClient.
        transfer: {
          transferId: 1,
          indexes: [0],
          complete: false,
          onDisposition: (d) => dispositions.push(d),
        },
      },
      { onSuccess: vi.fn(), onFallback: vi.fn(), onSyncing },
    );

    expect(onSyncing).toHaveBeenCalledTimes(1);
    expect(dispositions).toEqual([
      expect.objectContaining({ kind: 'rebuild-required' }),
    ]);
    expect(queryMessages(posted)).toHaveLength(0);

    backend.flush();
    expect(queryMessages(posted)).toHaveLength(0);

    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    expect(queryMessages(posted)).toHaveLength(1);
    expect(onSyncing).toHaveBeenCalledTimes(1);
  });

  it('cancel during patch emits cancelled once and posts no query', () => {
    const { client, posted, backend, emit } = createHarness();
    warmReady(client, backend, emit, posted);
    const dispositions: unknown[] = [];
    const onFallback = vi.fn();

    const handle = client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess: vi.fn(), onFallback },
    );
    expect(client.getSnapshotClient().isPatching()).toBe(true);
    handle.cancel();
    backend.flush();

    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 1 }]);
    expect(queryMessages(posted)).toHaveLength(0);
    expect(
      posted.some((p) => p.message.kind === 'quickSearch:snapshotPatchStart'),
    ).toBe(false);
    expect(onFallback).not.toHaveBeenCalled();
    expect(client.getSnapshotClient().isSnapshotComplete()).toBe(true);
  });

  it('cancelQuery during patch preserves completed base snapshot', () => {
    const { client, posted, backend, emit } = createHarness();
    const gen = warmReady(client, backend, emit, posted);
    const dispositions: unknown[] = [];

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    client.cancelQuery();
    backend.flush();

    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 1 }]);
    expect(client.getSnapshotClient().isSnapshotComplete()).toBe(true);
    expect(client.getSnapshotClient().getCurrentGeneration()).toBe(gen);
    expect(queryMessages(posted)).toHaveLength(0);
  });

  it('full snapshot sync remains reusable across query supersession', () => {
    const { client, posted, backend, emit } = createHarness();
    client.execute(
      { ...baseConfig, normalizedText: 'ALICE', chunkSize: 1 },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    // Mid full-snapshot extraction — first chunk scheduled, not complete.
    backend.step();
    expect(client.getSnapshotClient().isSnapshotComplete()).toBe(false);
    const gen = client.getSnapshotClient().getCurrentGeneration();

    client.execute(
      { ...baseConfig, normalizedText: 'BOB', chunkSize: 1 },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    // Same identity — must reuse in-progress generation, not cancelPatch-wipe.
    expect(client.getSnapshotClient().getCurrentGeneration()).toBe(gen);

    backend.flush();
    emit({ kind: 'quickSearch:ready', generation: gen });
    expect(queryMessages(posted).some((q) => q.normalizedText === 'BOB')).toBe(
      true,
    );
  });

  it('async patch transport failure calls fallback once', () => {
    const { client, backend, emit } = createHarness({
      shouldThrow: (m) =>
        m.kind === 'quickSearch:snapshotPatchStart'
          ? new Error('patch start failed')
          : null,
    });
    warmReady(client, backend, emit, []);
    const onFallback = vi.fn();
    const dispositions: unknown[] = [];

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess: vi.fn(), onFallback },
    );
    backend.flush();

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(client.getActiveRequestId()).toBeNull();
  });

  it('matching patchRejected starts exactly one full rebuild, not fallback', () => {
    const { client, posted, backend, emit } = createHarness();
    const gen = warmReady(client, backend, emit, posted);
    const onFallback = vi.fn();
    const onSyncing = vi.fn();
    const dispositions: unknown[] = [];

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess: vi.fn(), onFallback, onSyncing },
    );
    backend.flush();

    const postedDisp = dispositions[0] as {
      kind: string;
      patchId: number;
      generation: number;
    };
    expect(postedDisp.kind).toBe('posted');
    const oldRequestId = client.getActiveRequestId()!;
    const startsBefore = posted.filter(
      (p) => p.message.kind === 'quickSearch:snapshotStart',
    ).length;

    emit({
      kind: 'quickSearch:patchRejected',
      patchId: postedDisp.patchId,
      generation: postedDisp.generation,
      reason: 'revision-mismatch',
    });

    expect(onFallback).not.toHaveBeenCalled();
    expect(
      posted.some((p) => p.message.kind === 'quickSearch:clearSnapshot'),
    ).toBe(true);
    expect(client.getActiveRequestId()).not.toBe(oldRequestId);
    expect(client.getActiveRequestId()).not.toBeNull();

    backend.flush();
    const startsAfter = posted.filter(
      (p) => p.message.kind === 'quickSearch:snapshotStart',
    ).length;
    expect(startsAfter).toBe(startsBefore + 1);
    expect(client.getSnapshotClient().getCurrentGeneration()).toBeGreaterThan(
      gen,
    );

    // Duplicate rejection — no second rebuild.
    const startsMid = startsAfter;
    emit({
      kind: 'quickSearch:patchRejected',
      patchId: postedDisp.patchId,
      generation: postedDisp.generation,
      reason: 'incomplete-staging',
    });
    backend.flush();
    expect(
      posted.filter((p) => p.message.kind === 'quickSearch:snapshotStart'),
    ).toHaveLength(startsMid);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('recoverable error before matching patchRejected still rebuilds once', () => {
    const { client, posted, backend, emit } = createHarness();
    warmReady(client, backend, emit, posted);
    const onSuccess = vi.fn();
    const onFallback = vi.fn();
    const onSyncing = vi.fn();
    const dispositions: unknown[] = [];

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess, onFallback, onSyncing },
    );
    backend.flush();

    const postedDisp = dispositions[0] as {
      kind: string;
      patchId: number;
      generation: number;
    };
    expect(postedDisp.kind).toBe('posted');
    const oldRequestId = client.getActiveRequestId()!;
    const syncingAfterPatch = onSyncing.mock.calls.length;
    const clearsBefore = posted.filter(
      (p) => p.message.kind === 'quickSearch:clearSnapshot',
    ).length;
    const startsBefore = posted.filter(
      (p) => p.message.kind === 'quickSearch:snapshotStart',
    ).length;
    const genBefore = client.getSnapshotClient().getCurrentGeneration();

    // Reversed order: recoverable query error arrives before patchRejected.
    emit({
      kind: 'quickSearch:error',
      requestId: oldRequestId,
      code: 'revision-mismatch',
      message: 'revision mismatch',
    });

    expect(onFallback).not.toHaveBeenCalled();
    expect(
      posted.filter((p) => p.message.kind === 'quickSearch:clearSnapshot'),
    ).toHaveLength(clearsBefore + 1);
    backend.flush();
    expect(
      posted.filter((p) => p.message.kind === 'quickSearch:snapshotStart'),
    ).toHaveLength(startsBefore + 1);
    const retryId = client.getActiveRequestId()!;
    expect(retryId).not.toBe(oldRequestId);
    const genAfterError = client.getSnapshotClient().getCurrentGeneration();
    expect(genAfterError).toBeGreaterThan(genBefore);
    const syncingAfterError = onSyncing.mock.calls.length;

    emit({
      kind: 'quickSearch:patchRejected',
      patchId: postedDisp.patchId,
      generation: postedDisp.generation,
      reason: 'revision-mismatch',
    });
    backend.flush();

    expect(
      posted.filter((p) => p.message.kind === 'quickSearch:clearSnapshot'),
    ).toHaveLength(clearsBefore + 1);
    expect(
      posted.filter((p) => p.message.kind === 'quickSearch:snapshotStart'),
    ).toHaveLength(startsBefore + 1);
    expect(client.getSnapshotClient().getCurrentGeneration()).toBe(genAfterError);
    expect(onSyncing.mock.calls.length).toBe(syncingAfterError);
    expect(onFallback).not.toHaveBeenCalled();
    expect(client.getActiveRequestId()).toBe(retryId);

    emit({
      kind: 'quickSearch:ready',
      generation: genAfterError,
    });
    emit({
      kind: 'quickSearch:success',
      requestId: retryId,
      indexes: Uint32Array.from([0]),
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
    // Initial patch path called onSyncing once; recovery may call once more.
    expect(syncingAfterPatch).toBe(1);
  });

  it('obsolete generation/patchId rejection is ignored', () => {
    const { client, posted, backend, emit } = createHarness();
    warmReady(client, backend, emit, posted);
    const dispositions: unknown[] = [];

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();
    const activeId = client.getActiveRequestId();

    emit({
      kind: 'quickSearch:patchRejected',
      patchId: 999,
      generation: 1,
      reason: 'generation-mismatch',
    });
    expect(
      posted.some((p) => p.message.kind === 'quickSearch:clearSnapshot'),
    ).toBe(false);
    expect(client.getActiveRequestId()).toBe(activeId);
  });

  it('stale old query success/error after rejection is ignored', () => {
    const { client, posted, backend, emit } = createHarness();
    warmReady(client, backend, emit, posted);
    const onSuccess = vi.fn();
    const onFallback = vi.fn();
    const dispositions: unknown[] = [];

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess, onFallback },
    );
    backend.flush();
    const oldRequestId = client.getActiveRequestId()!;
    const postedDisp = dispositions[0] as { patchId: number; generation: number };

    emit({
      kind: 'quickSearch:patchRejected',
      patchId: postedDisp.patchId,
      generation: postedDisp.generation,
      reason: 'chunk-sequence-mismatch',
    });
    const retryId = client.getActiveRequestId()!;
    expect(retryId).not.toBe(oldRequestId);

    emit({
      kind: 'quickSearch:success',
      requestId: oldRequestId,
      indexes: Uint32Array.from([99]),
    });
    emit({
      kind: 'quickSearch:error',
      requestId: oldRequestId,
      code: 'worker-error',
      message: 'stale',
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();

    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    emit({
      kind: 'quickSearch:success',
      requestId: retryId,
      indexes: Uint32Array.from([0]),
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('retry uses new requestId under original cancel handle; handle cancels retry', () => {
    const { client, posted, backend, emit } = createHarness();
    warmReady(client, backend, emit, posted);
    const dispositions: unknown[] = [];

    const handle = client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();
    const postedDisp = dispositions[0] as { patchId: number; generation: number };
    const oldId = client.getActiveRequestId()!;

    emit({
      kind: 'quickSearch:patchRejected',
      patchId: postedDisp.patchId,
      generation: postedDisp.generation,
      reason: 'revision-mismatch',
    });
    const retryId = client.getActiveRequestId()!;
    expect(retryId).not.toBe(oldId);

    handle.cancel();
    expect(cancelMessages(posted).some((m) => m.requestId === retryId)).toBe(
      true,
    );
    expect(client.getActiveRequestId()).toBeNull();
  });

  it('second recoverable mismatch after patchRejected retry falls back once', () => {
    const { client, backend, emit } = createHarness();
    warmReady(client, backend, emit, []);
    const onFallback = vi.fn();
    const dispositions: unknown[] = [];

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess: vi.fn(), onFallback },
    );
    backend.flush();
    const postedDisp = dispositions[0] as { patchId: number; generation: number };

    emit({
      kind: 'quickSearch:patchRejected',
      patchId: postedDisp.patchId,
      generation: postedDisp.generation,
      reason: 'revision-mismatch',
    });
    expect(onFallback).not.toHaveBeenCalled();

    backend.flush();
    emit({
      kind: 'quickSearch:ready',
      generation: client.getSnapshotClient().getCurrentGeneration(),
    });
    emit({
      kind: 'quickSearch:error',
      requestId: client.getActiveRequestId()!,
      code: 'revision-mismatch',
      message: 'again',
    });
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(client.getActiveRequestId()).toBeNull();
  });

  it('success path clears remembered patch state', () => {
    const { client, posted, backend, emit } = createHarness();
    warmReady(client, backend, emit, posted);
    const dispositions: unknown[] = [];

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();
    const postedDisp = dispositions[0] as { patchId: number; generation: number };
    const requestId = client.getActiveRequestId()!;

    emit({
      kind: 'quickSearch:success',
      requestId,
      indexes: Uint32Array.from([0]),
    });
    expect(client.getActiveRequestId()).toBeNull();

    // Late rejection for the remembered patch must be ignored after success.
    const startsBefore = posted.filter(
      (p) => p.message.kind === 'quickSearch:snapshotStart',
    ).length;
    emit({
      kind: 'quickSearch:patchRejected',
      patchId: postedDisp.patchId,
      generation: postedDisp.generation,
      reason: 'revision-mismatch',
    });
    expect(
      posted.filter((p) => p.message.kind === 'quickSearch:snapshotStart'),
    ).toHaveLength(startsBefore);
  });

  it('empty-query supersession cancels patch and posts no query', () => {
    const { client, posted, backend, emit } = createHarness();
    warmReady(client, backend, emit, posted);
    const dispositions: unknown[] = [];

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], dispositions),
      },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    expect(client.getSnapshotClient().isPatching()).toBe(true);

    const onSuccess = vi.fn();
    client.execute(
      { ...baseConfig, normalizedText: '  ' },
      { onSuccess, onFallback: vi.fn() },
    );
    backend.flush();

    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 1 }]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(
      posted.some((p) => p.message.kind === 'quickSearch:snapshotPatchStart'),
    ).toBe(false);
    expect(client.getSnapshotClient().isSnapshotComplete()).toBe(true);
  });

  it('newer execute superseding patch cancels old transfer once', () => {
    const { client, posted, backend, emit } = createHarness();
    warmReady(client, backend, emit, posted);
    const d1: unknown[] = [];
    const d2: unknown[] = [];

    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, rows[1]!, rows[2]!],
        normalizedText: 'ALICIA',
        searchableDataRevision: 1,
        transfer: makeTransfer(1, [0], d1),
      },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    client.execute(
      {
        ...baseConfig,
        rows: [{ name: 'Alicia', city: 'Lahore' }, { name: 'Bobby', city: 'London' }, rows[2]!],
        normalizedText: 'BOBBY',
        searchableDataRevision: 2,
        transfer: makeTransfer(2, [1], d2),
      },
      { onSuccess: vi.fn(), onFallback: vi.fn() },
    );
    backend.flush();

    expect(d1).toEqual([{ kind: 'cancelled', transferId: 1 }]);
    expect(d2[0]).toMatchObject({ kind: 'posted', transferId: 2 });
    expect(queryMessages(posted).some((q) => q.normalizedText === 'BOBBY')).toBe(
      true,
    );
  });
});
