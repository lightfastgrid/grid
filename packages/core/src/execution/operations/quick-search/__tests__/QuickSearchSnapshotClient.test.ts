import { describe, expect, it, vi } from 'vitest';

import { createNormalizer } from '../../../../features/quick-search/normalizer';
import type { SearchableFieldDescriptor } from '../../../../features/quick-search/searchableFieldResolver';
import type {
  CooperativeScheduleOptions,
  CooperativeSchedulerBackend,
} from '../../../../scheduling/CooperativeScheduler';
import { CooperativeScheduler } from '../../../../scheduling/CooperativeScheduler';
import type { QuickSearchWorkerRequest } from '../quickSearchProtocol';
import { QuickSearchSnapshotClient } from '../QuickSearchSnapshotClient';

function createManualBackend(): CooperativeSchedulerBackend & {
  flush(): void;
  step(): void;
  pending(): number;
  lastOptions(): CooperativeScheduleOptions | undefined;
  allOptions(): Array<CooperativeScheduleOptions | undefined>;
} {
  const queue: Array<{
    cb: () => void;
    cancelled: boolean;
    options: CooperativeScheduleOptions | undefined;
  }> = [];
  const seen: Array<CooperativeScheduleOptions | undefined> = [];
  return {
    schedule(cb, options) {
      seen.push(options);
      const entry = { cb, cancelled: false, options };
      queue.push(entry);
      return {
        cancel() {
          entry.cancelled = true;
        },
      };
    },
    flush() {
      // Continuations may schedule more work; loop until stable.
      while (queue.length > 0) {
        const snapshot = queue.splice(0);
        for (const entry of snapshot) {
          if (!entry.cancelled) entry.cb();
        }
      }
    },
    step() {
      // Run only the currently queued entries; work they schedule stays queued.
      const snapshot = queue.splice(0);
      for (const entry of snapshot) {
        if (!entry.cancelled) entry.cb();
      }
    },
    pending() {
      return queue.filter((e) => !e.cancelled).length;
    },
    lastOptions() {
      return seen[seen.length - 1];
    },
    allOptions() {
      return seen.slice();
    },
  };
}

function createRecordingTransport(options?: {
  shouldFail?: (message: QuickSearchWorkerRequest) => boolean;
}) {
  const messages: QuickSearchWorkerRequest[] = [];
  return {
    messages,
    post(message: QuickSearchWorkerRequest): boolean {
      if (options?.shouldFail?.(message)) {
        return false;
      }
      messages.push(message);
      return true;
    },
  };
}

function desc(field: string, projectionField?: string): SearchableFieldDescriptor {
  return { field, projectionField, workerEligible: true };
}

const rows = [
  { name: 'Alice', city: 'Lahore' },
  { name: 'Bob', city: 'London' },
  { name: 'Cara', city: 'Berlin' },
];

function createClient(options?: {
  shouldFail?: (message: QuickSearchWorkerRequest) => boolean;
}) {
  const backend = createManualBackend();
  const transport = createRecordingTransport(options);
  const client = new QuickSearchSnapshotClient(
    transport,
    new CooperativeScheduler(backend),
  );
  return { backend, transport, client };
}

describe('QuickSearchSnapshotClient', () => {
  // ── Lifecycle: start → chunks → complete ───────────────────────────

  it('posts snapshotStart, searchable-only chunks, and snapshotComplete', () => {
    const { backend, transport, client } = createClient();

    const outcome = client.sync({
      rows,
      descriptors: [desc('name'), desc('city')],
      fieldsSignature: 'sig-a',
      chunkSize: 2,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();

    expect(outcome).toBe('started');
    const kinds = transport.messages.map((m) => m.kind);
    expect(kinds).toEqual([
      'quickSearch:snapshotStart',
      'quickSearch:snapshotChunk',
      'quickSearch:snapshotChunk',
      'quickSearch:snapshotComplete',
    ]);
    expect(client.isSnapshotComplete()).toBe(true);

    const start = transport.messages[0]!;
    if (start.kind !== 'quickSearch:snapshotStart') throw new Error('unreachable');
    expect(start.rowCount).toBe(3);
    expect(start.payloadFormat).toBe('searchable-fields-v1');
    expect(start.fields).toEqual([{ field: 'name' }, { field: 'city' }]);
    expect(start.normalizerSignature.length).toBeGreaterThan(0);
  });

  // ── 12. Chunks never carry RowData[] ────────────────────────────────

  it('every posted chunk row has exactly { rowIndex, values } keys', () => {
    const { backend, transport, client } = createClient();
    client.sync({
      rows,
      descriptors: [desc('name'), desc('city')],
      fieldsSignature: 'sig-a',
      chunkSize: 2,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();

    const chunkMessages = transport.messages.filter(
      (m): m is Extract<QuickSearchWorkerRequest, { kind: 'quickSearch:snapshotChunk' }> =>
        m.kind === 'quickSearch:snapshotChunk',
    );
    expect(chunkMessages.length).toBeGreaterThan(0);
    for (const msg of chunkMessages) {
      expect(msg.payloadFormat).toBe('searchable-fields-v1');
      if (msg.payloadFormat !== 'searchable-fields-v1') continue;
      for (const row of msg.rows) {
        expect(Object.keys(row).sort()).toEqual(['rowIndex', 'values']);
        for (const v of row.values) expect(typeof v).toBe('string');
      }
    }
  });

  // ── 10. Same signature reuses the snapshot ──────────────────────────

  it('reuses the snapshot for identical rows/fields/normalizer', () => {
    const { backend, transport, client } = createClient();
    const config = {
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    };
    client.sync(config);
    backend.flush();
    const postedAfterFirst = transport.messages.length;

    const outcome = client.sync(config);
    expect(outcome).toBe('reused');
    expect(transport.messages.length).toBe(postedAfterFirst);
  });

  it('reuses snapshot when only rows reference changes (same revisions/signatures)', () => {
    const { backend, transport, client } = createClient();
    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    const gen1 = client.getCurrentGeneration();
    const startsBefore = transport.messages.filter(
      (m) => m.kind === 'quickSearch:snapshotStart',
    ).length;

    const newRows = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Cara' }];
    const outcome = client.sync({
      rows: newRows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();

    expect(outcome).toBe('reused');
    expect(client.getCurrentGeneration()).toBe(gen1);
    expect(
      transport.messages.filter((m) => m.kind === 'quickSearch:snapshotStart'),
    ).toHaveLength(startsBefore);
  });

  it('starts a new generation when searchableDataRevision changes', () => {
    const { backend, transport, client } = createClient();
    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    const gen1 = client.getCurrentGeneration();

    const outcome = client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
    });
    backend.flush();

    expect(outcome).toBe('started');
    expect(client.getCurrentGeneration()).toBeGreaterThan(gen1);
    const starts = transport.messages.filter(
      (m) => m.kind === 'quickSearch:snapshotStart',
    );
    expect(starts).toHaveLength(2);
    const second = starts[1]!;
    expect(second.searchableDataRevision).toBe(1);
    expect(second.sourceLayoutRevision).toBe(0);
  });

  it('starts a new generation when sourceLayoutRevision changes', () => {
    const { backend, transport, client } = createClient();
    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    const gen1 = client.getCurrentGeneration();

    const outcome = client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 2,
      searchableDataRevision: 0,
    });
    backend.flush();

    expect(outcome).toBe('started');
    expect(client.getCurrentGeneration()).toBeGreaterThan(gen1);
    const starts = transport.messages.filter(
      (m) => m.kind === 'quickSearch:snapshotStart',
    );
    expect(starts).toHaveLength(2);
    const second = starts[1]!;
    expect(second.sourceLayoutRevision).toBe(2);
  });

  // ── 9. Stale generation is ignored ──────────────────────────────────

  it('superseded sync posts no further chunks and never completes', () => {
    const { backend, transport, client } = createClient();
    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    // First chunk is scheduled, not yet posted.
    expect(transport.messages.filter((m) => m.kind === 'quickSearch:snapshotChunk').length).toBe(0);

    // Supersede with a searchable-data revision bump before gen 1 fires any chunks.
    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
    });
    backend.flush();

    const messagesByGen = new Map<number, string[]>();
    for (const m of transport.messages) {
      if ('generation' in m) {
        const list = messagesByGen.get(m.generation) ?? [];
        list.push(m.kind);
        messagesByGen.set(m.generation, list);
      }
    }
    // Gen 1 stopped before any chunks — only start was posted.
    expect(messagesByGen.get(1)).toEqual([
      'quickSearch:snapshotStart',
    ]);
    // Gen 2 ran to completion (3 rows, chunkSize 1).
    expect(messagesByGen.get(2)).toEqual([
      'quickSearch:snapshotStart',
      'quickSearch:snapshotChunk',
      'quickSearch:snapshotChunk',
      'quickSearch:snapshotChunk',
      'quickSearch:snapshotComplete',
    ]);
  });

  it('revision change during incomplete extraction cancels old extraction', () => {
    const { backend, transport, client } = createClient();
    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    expect(client.isSnapshotComplete()).toBe(false);

    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 3,
    });
    backend.flush();

    const gen1Chunks = transport.messages.filter(
      (m) =>
        m.kind === 'quickSearch:snapshotChunk' &&
        'generation' in m &&
        m.generation === 1,
    );
    const gen1Complete = transport.messages.some(
      (m) => m.kind === 'quickSearch:snapshotComplete' && m.generation === 1,
    );
    expect(gen1Chunks).toHaveLength(0);
    expect(gen1Complete).toBe(false);
    expect(client.getCurrentGeneration()).toBe(2);
    expect(client.isSnapshotComplete()).toBe(true);
  });

  // ── Cancellation ─────────────────────────────────────────────────────

  it('cancel stops in-flight extraction and chunk posting', () => {
    const { backend, transport, client } = createClient();
    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    // Cancel before the scheduler fires the first chunk.
    client.cancel();
    backend.flush();

    const kinds = transport.messages.map((m) => m.kind);
    expect(kinds).toEqual(['quickSearch:snapshotStart']);
    expect(client.isSnapshotComplete()).toBe(false);

    // Next sync restarts fresh instead of reusing the cancelled snapshot.
    const outcome = client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    expect(outcome).toBe('started');
  });

  it('clear cancels work and posts clearSnapshot', () => {
    const { backend, transport, client } = createClient();
    client.sync({ rows, descriptors: [desc('name')], fieldsSignature: 'sig-a', sourceLayoutRevision: 0, searchableDataRevision: 0 });
    backend.flush();
    expect(client.clear()).toBe(true);

    expect(transport.messages[transport.messages.length - 1]!.kind).toBe('quickSearch:clearSnapshot');
    // After clear, the same config must repost.
    const outcome = client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    expect(outcome).toBe('started');
  });

  it('clear returns false when clearSnapshot is rejected and keeps local state cleared', () => {
    const { backend, client } = createClient({
      shouldFail: (m) => m.kind === 'quickSearch:clearSnapshot',
    });
    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    expect(client.clear()).toBe(false);
    expect(client.isSnapshotComplete()).toBe(false);
    expect(client.getCurrentGeneration()).toBe(0);
    expect(backend.pending()).toBe(0);
  });

  // ── 11. Idle prewarm ─────────────────────────────────────────────────

  it('prewarm schedules at background priority and syncs when it fires', () => {
    const { backend, transport, client } = createClient();
    client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });

    // Nothing posted yet — prewarm never blocks the current frame.
    expect(transport.messages).toHaveLength(0);
    expect(backend.lastOptions()).toEqual({ priority: 'background' });

    backend.flush();
    const kinds = transport.messages.map((m) => m.kind);
    expect(kinds[0]).toBe('quickSearch:snapshotStart');
    expect(kinds[kinds.length - 1]).toBe('quickSearch:snapshotComplete');
  });

  it('prewarm extraction continuations also run at background priority', () => {
    const { backend, transport, client } = createClient();
    client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();

    // Every scheduled task in the prewarm flow — the initial callback
    // AND each extraction continuation — must be background priority.
    expect(backend.allOptions().length).toBeGreaterThan(1);
    for (const options of backend.allOptions()) {
      expect(options).toEqual({ priority: 'background' });
    }
    const kinds = transport.messages.map((m) => m.kind);
    expect(kinds[kinds.length - 1]).toBe('quickSearch:snapshotComplete');
  });

  it('prewarm handle cancels extraction after the prewarm has fired', () => {
    const { backend, transport, client } = createClient();
    const handle = client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });

    // Fire the prewarm callback — extraction starts, snapshotStart is
    // posted, and the first chunk is scheduled (not yet fired).
    backend.step();
    const postedAfterFire = transport.messages.map((m) => m.kind);
    expect(postedAfterFire).toEqual([
      'quickSearch:snapshotStart',
    ]);

    handle.cancel();
    backend.flush();

    // No chunks, no completion.
    expect(transport.messages.map((m) => m.kind)).toEqual(postedAfterFire);
    expect(client.isSnapshotComplete()).toBe(false);
  });

  it('prewarm handle cancel after fire does not disturb a newer sync', () => {
    const { backend, transport, client } = createClient();
    const handle = client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.step();

    // A newer sync replaces the prewarm-started snapshot.
    const newRows = [{ name: 'Zed' }];
    client.sync({
      rows: newRows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-b',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    const completed = transport.messages.filter(
      (m) => m.kind === 'quickSearch:snapshotComplete',
    ).length;
    expect(completed).toBe(1);

    // Cancelling the stale prewarm handle must not cancel the new snapshot.
    handle.cancel();
    expect(client.isSnapshotComplete()).toBe(true);
  });

  it('prewarm is cancellable before it fires', () => {
    const { backend, transport, client } = createClient();
    const handle = client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    handle.cancel();
    backend.flush();
    expect(transport.messages).toHaveLength(0);
  });

  it('does not start duplicate prewarm jobs for the same signature', () => {
    const { backend, client } = createClient();
    client.prewarm({ rows, descriptors: [desc('name')], fieldsSignature: 'sig-a', sourceLayoutRevision: 0, searchableDataRevision: 0 });
    client.prewarm({ rows, descriptors: [desc('name')], fieldsSignature: 'sig-a', sourceLayoutRevision: 0, searchableDataRevision: 0 });
    expect(backend.pending()).toBe(1);
  });

  it('prewarm dedupes across unrelated rows-reference change', () => {
    const { backend, client } = createClient();
    const newRows = [{ name: 'Zed' }];
    client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    client.prewarm({
      rows: newRows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    expect(backend.pending()).toBe(1);
  });

  it('prewarm is replaced when searchableDataRevision changes', () => {
    const { backend, transport, client } = createClient();
    client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 2,
    });
    expect(backend.pending()).toBe(1);
    backend.flush();
    const start = transport.messages[0]!;
    if (start.kind !== 'quickSearch:snapshotStart') throw new Error('unreachable');
    expect(start.searchableDataRevision).toBe(2);
  });

  it('prewarm is replaced when sourceLayoutRevision changes', () => {
    const { backend, transport, client } = createClient();
    client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 4,
      searchableDataRevision: 0,
    });
    expect(backend.pending()).toBe(1);
    backend.flush();
    const start = transport.messages[0]!;
    if (start.kind !== 'quickSearch:snapshotStart') throw new Error('unreachable');
    expect(start.sourceLayoutRevision).toBe(4);
  });

  it('prewarm for a different normalizer replaces the pending prewarm', () => {
    const { backend, client } = createClient();
    const customNormalizer = createNormalizer({ version: 'custom-v2' });
    client.prewarm({ rows, descriptors: [desc('name')], fieldsSignature: 'sig-a', sourceLayoutRevision: 0, searchableDataRevision: 0 });
    client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      normalizer: customNormalizer,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    expect(backend.pending()).toBe(1);
  });

  it('prewarm no-ops when the snapshot is already synced', () => {
    const { backend, transport, client } = createClient();
    const config = {
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    };
    client.sync(config);
    backend.flush();
    const posted = transport.messages.length;

    client.prewarm(config);
    backend.flush();
    expect(transport.messages.length).toBe(posted);
  });

  it('prewarm preserves an older completed patch base across repeated data revisions', () => {
    const { backend, transport, client } = createClient();
    const baseConfig = {
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    };
    client.sync(baseConfig);
    backend.flush();
    const generation = client.getCurrentGeneration();
    transport.messages.length = 0;

    client.prewarm({
      ...baseConfig,
      rows: [{ name: 'Alicia' }, rows[1]!, rows[2]!],
      searchableDataRevision: 1,
    });
    client.prewarm({
      ...baseConfig,
      rows: [{ name: 'Alina' }, rows[1]!, rows[2]!],
      searchableDataRevision: 2,
    });
    backend.flush();

    expect(backend.pending()).toBe(0);
    expect(transport.messages).toHaveLength(0);
    expect(client.getCurrentGeneration()).toBe(generation);
    expect(client.isSnapshotComplete()).toBe(true);
  });

  it('interactive sync patches the base retained by prewarm before query execution', () => {
    const { backend, transport, client } = createClient();
    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    const generation = client.getCurrentGeneration();
    transport.messages.length = 0;

    const editedRows = [{ name: 'Alicia' }, rows[1]!, rows[2]!];
    client.prewarm({
      rows: editedRows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
    });
    backend.flush();

    const dispositions: unknown[] = [];
    expect(client.sync({
      rows: editedRows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: {
        transferId: 1,
        indexes: [0],
        complete: true,
        onDisposition: (disposition) => dispositions.push(disposition),
      },
    })).toBe('patching');
    backend.flush();

    expect(client.getCurrentGeneration()).toBe(generation);
    expect(transport.messages.map((message) => message.kind)).toEqual([
      'quickSearch:snapshotPatchStart',
      'quickSearch:snapshotPatchChunk',
      'quickSearch:snapshotPatchComplete',
    ]);
    expect(dispositions).toEqual([
      expect.objectContaining({ kind: 'posted', transferId: 1, generation }),
    ]);
  });

  it.each([
    {
      label: 'fields signature',
      config: { descriptors: [desc('city')], fieldsSignature: 'sig-b' },
    },
    {
      label: 'normalizer signature',
      config: { normalizer: createNormalizer({ version: 'prewarm-v2' }) },
    },
    {
      label: 'source layout',
      config: { sourceLayoutRevision: 1 },
    },
  ])('prewarm rebuilds when $label changes', ({ config }) => {
    const { backend, transport, client } = createClient();
    const baseConfig = {
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    };
    client.sync(baseConfig);
    backend.flush();
    const generation = client.getCurrentGeneration();
    transport.messages.length = 0;

    client.prewarm({
      ...baseConfig,
      searchableDataRevision: 1,
      ...config,
    });
    backend.flush();

    expect(client.getCurrentGeneration()).toBeGreaterThan(generation);
    expect(transport.messages[0]?.kind).toBe('quickSearch:snapshotStart');
    expect(client.isSnapshotComplete()).toBe(true);
  });

  it('sync works correctly without any prewarm (correctness independent)', () => {
    const { backend, transport, client } = createClient();
    const outcome = client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    expect(outcome).toBe('started');
    expect(transport.messages[transport.messages.length - 1]!.kind).toBe('quickSearch:snapshotComplete');
  });

  // ── Custom extractors are never invoked during extraction ───────────

  // ── Priority forwarding ────────────────────────────────────────────

  it('active sync forwards schedulePriority to every chunk including first', () => {
    const backend = createManualBackend();
    const transport = createRecordingTransport();
    const client = new QuickSearchSnapshotClient(
      transport,
      new CooperativeScheduler(backend),
    );
    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      schedulePriority: { priority: 'user-blocking' },
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();

    // Every scheduler call (first chunk + continuations) used the priority.
    for (const opts of backend.allOptions()) {
      expect(opts).toEqual({ priority: 'user-blocking' });
    }
  });

  it('never runs getQuickFilterText during snapshot extraction', () => {
    const spy = vi.fn(() => 'custom');
    const { backend, client } = createClient();
    // Descriptor resolution already excluded the custom extractor —
    // the client only ever sees field/projection descriptors.
    client.sync({
      rows: rows.map((r) => ({ ...r, getQuickFilterText: spy })),
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    expect(spy).not.toHaveBeenCalled();
  });

  // ── Transport failure aborts extraction ─────────────────────────────

  it('snapshotStart failure schedules zero extraction and returns failed', () => {
    const { backend, transport, client } = createClient({
      shouldFail: (m) => m.kind === 'quickSearch:snapshotStart',
    });
    const outcome = client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });

    expect(outcome).toBe('failed');
    expect(backend.pending()).toBe(0);
    expect(client.isSnapshotComplete()).toBe(false);
    expect(client.getCurrentGeneration()).toBe(0);
    expect(transport.messages).toHaveLength(0);

    backend.flush();
    expect(transport.messages).toHaveLength(0);
  });

  it('chunk-post failure cancels extraction and posts no later chunks/complete', () => {
    let chunkPosts = 0;
    const { backend, transport, client } = createClient({
      shouldFail: (m) => {
        if (m.kind !== 'quickSearch:snapshotChunk') return false;
        chunkPosts += 1;
        return chunkPosts === 1;
      },
    });

    const outcome = client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    expect(outcome).toBe('started');

    backend.flush();
    expect(
      transport.messages.filter((m) => m.kind === 'quickSearch:snapshotChunk'),
    ).toHaveLength(0);
    expect(
      transport.messages.some((m) => m.kind === 'quickSearch:snapshotComplete'),
    ).toBe(false);
    expect(client.isSnapshotComplete()).toBe(false);
    expect(client.getCurrentGeneration()).toBe(0);
    expect(backend.pending()).toBe(0);
  });

  it('snapshotComplete-post failure leaves isSnapshotComplete false', () => {
    const { backend, transport, client } = createClient({
      shouldFail: (m) => m.kind === 'quickSearch:snapshotComplete',
    });

    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 2,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();

    expect(
      transport.messages.some((m) => m.kind === 'quickSearch:snapshotComplete'),
    ).toBe(false);
    expect(client.isSnapshotComplete()).toBe(false);
    expect(client.getCurrentGeneration()).toBe(0);
  });

  it('execute after completion-post failure starts a new generation', () => {
    let failComplete = true;
    const { backend, transport, client } = createClient({
      shouldFail: (m) =>
        failComplete && m.kind === 'quickSearch:snapshotComplete',
    });

    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    expect(client.isSnapshotComplete()).toBe(false);

    failComplete = false;
    const outcome = client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    expect(outcome).toBe('started');
    backend.flush();

    const starts = transport.messages.filter(
      (m) => m.kind === 'quickSearch:snapshotStart',
    );
    expect(starts).toHaveLength(2);
    expect(starts[0]).toMatchObject({ generation: 1 });
    expect(starts[1]).toMatchObject({ generation: 2 });
    expect(client.isSnapshotComplete()).toBe(true);
    expect(client.getCurrentGeneration()).toBe(2);
  });

  it('prewarm start failure leaves no scheduled extraction and no reusable snapshot', () => {
    const { backend, transport, client } = createClient({
      shouldFail: (m) => m.kind === 'quickSearch:snapshotStart',
    });

    client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();

    expect(backend.pending()).toBe(0);
    expect(transport.messages).toHaveLength(0);
    expect(client.isSnapshotComplete()).toBe(false);
    expect(client.getCurrentGeneration()).toBe(0);
  });

  it('prewarm chunk failure leaves no reusable snapshot and no pending extraction', () => {
    const { backend, transport, client } = createClient({
      shouldFail: (m) => m.kind === 'quickSearch:snapshotChunk',
    });

    client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();

    expect(backend.pending()).toBe(0);
    expect(
      transport.messages.some((m) => m.kind === 'quickSearch:snapshotComplete'),
    ).toBe(false);
    expect(client.isSnapshotComplete()).toBe(false);
    expect(client.getCurrentGeneration()).toBe(0);
  });
});

describe('QuickSearchSnapshotClient patch-or-rebuild (Stage 1J-A)', () => {
  type RowLike = Record<string, unknown>;

  function warmSnapshot(
    client: QuickSearchSnapshotClient,
    backend: ReturnType<typeof createManualBackend>,
    transport: ReturnType<typeof createRecordingTransport>,
    options?: {
      rows?: readonly RowLike[];
      descriptors?: SearchableFieldDescriptor[];
      fieldsSignature?: string;
    },
  ) {
    const warmRows = options?.rows ?? rows;
    client.sync({
      rows: warmRows,
      descriptors: options?.descriptors ?? [desc('name')],
      fieldsSignature: options?.fieldsSignature ?? 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    expect(client.isSnapshotComplete()).toBe(true);
    transport.messages.length = 0;
    return client.getCurrentGeneration();
  }

  function transferInput(
    transferId: number,
    indexes: Iterable<number>,
    dispositions: unknown[],
    options?: { complete?: boolean },
  ) {
    return {
      transferId,
      indexes,
      complete: options?.complete ?? true,
      onDisposition: (d: unknown) => {
        dispositions.push(d);
      },
    };
  }

  it('warm snapshot + revision advance posts patch, not snapshotStart', () => {
    const { backend, transport, client } = createClient();
    const gen = warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];
    const edited = [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }];

    const outcome = client.sync({
      rows: edited,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, new Set([0]), dispositions),
    });
    backend.flush();

    expect(outcome).toBe('patching');
    expect(client.getCurrentGeneration()).toBe(gen);
    expect(transport.messages.some((m) => m.kind === 'quickSearch:snapshotStart')).toBe(
      false,
    );
    expect(transport.messages.map((m) => m.kind)).toEqual([
      'quickSearch:snapshotPatchStart',
      'quickSearch:snapshotPatchChunk',
      'quickSearch:snapshotPatchComplete',
    ]);
    expect(dispositions).toEqual([
      {
        kind: 'posted',
        transferId: 1,
        patchId: 1,
        generation: gen,
        targetDataRevision: 1,
      },
    ]);
  });

  it('generation is unchanged across patch', () => {
    const { backend, transport, client } = createClient();
    const gen = warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions),
    });
    backend.flush();

    expect(client.getCurrentGeneration()).toBe(gen);
    const start = transport.messages[0]!;
    expect(start).toMatchObject({
      kind: 'quickSearch:snapshotPatchStart',
      generation: gen,
    });
  });

  it('posts exact patchStart/chunk/complete ordering and totals', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    client.sync({
      rows: [
        { name: 'Alicia' },
        { name: 'Bobby' },
        { name: 'Cara' },
      ],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(10, [0, 1], dispositions),
    });
    backend.flush();

    expect(transport.messages.map((m) => m.kind)).toEqual([
      'quickSearch:snapshotPatchStart',
      'quickSearch:snapshotPatchChunk',
      'quickSearch:snapshotPatchComplete',
    ]);
    const start = transport.messages[0]!;
    if (start.kind !== 'quickSearch:snapshotPatchStart') throw new Error('unreachable');
    expect(start).toMatchObject({
      patchId: 1,
      baseDataRevision: 0,
      targetDataRevision: 1,
      sourceLayoutRevision: 0,
      totalUniqueRows: 2,
      totalChunks: 1,
    });
    const chunk = transport.messages[1]!;
    if (chunk.kind !== 'quickSearch:snapshotPatchChunk') throw new Error('unreachable');
    expect(chunk.chunkSequence).toBe(0);
    expect(chunk.updates).toEqual([
      { rowIndex: 0, values: ['ALICIA'] },
      { rowIndex: 1, values: ['BOBBY'] },
    ]);
    const complete = transport.messages[2]!;
    if (complete.kind !== 'quickSearch:snapshotPatchComplete') {
      throw new Error('unreachable');
    }
    expect(complete).toMatchObject({
      totalUniqueRows: 2,
      totalChunks: 1,
      targetDataRevision: 1,
    });
  });

  it('passes ReadonlySet indexes without conversion', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const indexes: ReadonlySet<number> = new Set([2]);
    const dispositions: unknown[] = [];

    client.sync({
      rows: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carla' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, indexes, dispositions),
    });
    backend.flush();

    const chunk = transport.messages.find(
      (m) => m.kind === 'quickSearch:snapshotPatchChunk',
    );
    expect(chunk).toMatchObject({
      kind: 'quickSearch:snapshotPatchChunk',
      updates: [{ rowIndex: 2, values: ['CARLA'] }],
    });
  });

  it('posts latest edited projection values', () => {
    const { backend, transport, client } = createClient();
    const projRows = [
      { name: 'Alice', statusLabel: 'No' },
      { name: 'Bob', statusLabel: 'No' },
    ];
    warmSnapshot(client, backend, transport, {
      descriptors: [desc('status', 'statusLabel')],
      fieldsSignature: 'sig-proj',
      rows: projRows,
    });
    const dispositions: unknown[] = [];
    client.sync({
      rows: [
        { name: 'Alice', statusLabel: 'Yes' },
        { name: 'Bob', statusLabel: 'No' },
      ],
      descriptors: [desc('status', 'statusLabel')],
      fieldsSignature: 'sig-proj',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, new Set([0]), dispositions),
    });
    backend.flush();

    const chunk = transport.messages.find(
      (m) => m.kind === 'quickSearch:snapshotPatchChunk',
    );
    expect(chunk).toMatchObject({
      updates: [{ rowIndex: 0, values: ['YES'] }],
    });
  });

  it('advances local revision only after accepted patchComplete', () => {
    let failComplete = false;
    const { backend, transport, client } = createClient({
      shouldFail: (m) => failComplete && m.kind === 'quickSearch:snapshotPatchComplete',
    });
    warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];
    const failures: number[] = [];

    failComplete = true;
    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions),
      onAsyncFailure: () => failures.push(1),
    });
    backend.flush();

    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 1 }]);
    expect(failures).toEqual([1]);
    expect(client.isSnapshotComplete()).toBe(false);
    expect(client.getCurrentGeneration()).toBe(0);
    expect(
      transport.messages.some((m) => m.kind === 'quickSearch:snapshotPatchComplete'),
    ).toBe(false);

    // Successful path advances revision after complete.
    const { backend: b2, transport: t2, client: c2 } = createClient();
    warmSnapshot(c2, b2, t2);
    const d2: unknown[] = [];
    c2.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(2, [0], d2),
    });
    // Before flush, revision must still be 0.
    expect(c2.isSnapshotComplete()).toBe(true);
    b2.flush();
    expect(d2[0]).toMatchObject({ kind: 'posted', targetDataRevision: 1 });
    // Reuse at revision 1.
    expect(
      c2.sync({
        rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
        descriptors: [desc('name')],
        fieldsSignature: 'sig-a',
        sourceLayoutRevision: 0,
        searchableDataRevision: 1,
      }),
    ).toBe('reused');
  });

  it('incomplete transfer triggers full rebuild', () => {
    const { backend, transport, client } = createClient();
    const gen = warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    const outcome = client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions, { complete: false }),
    });
    backend.flush();

    expect(outcome).toBe('started');
    expect(client.getCurrentGeneration()).toBeGreaterThan(gen);
    expect(transport.messages[0]?.kind).toBe('quickSearch:snapshotStart');
    expect(dispositions).toEqual([
      {
        kind: 'rebuild-required',
        transferId: 1,
        newGeneration: client.getCurrentGeneration(),
      },
    ]);
  });

  it('extractor rebuild-required (invalid index) triggers full rebuild', () => {
    const { backend, transport, client } = createClient();
    const gen = warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [99], dispositions),
    });
    backend.flush();

    expect(client.getCurrentGeneration()).toBeGreaterThan(gen);
    expect(transport.messages.some((m) => m.kind === 'quickSearch:snapshotStart')).toBe(
      true,
    );
    expect(transport.messages.some((m) => m.kind === 'quickSearch:snapshotPatchStart')).toBe(
      false,
    );
    expect(dispositions).toEqual([
      {
        kind: 'rebuild-required',
        transferId: 1,
        newGeneration: client.getCurrentGeneration(),
      },
    ]);
  });

  it('zero unique rows despite revision advance triggers full rebuild', () => {
    const { backend, transport, client } = createClient();
    const gen = warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    client.sync({
      rows: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [], dispositions),
    });
    backend.flush();

    expect(client.getCurrentGeneration()).toBeGreaterThan(gen);
    expect(transport.messages[0]?.kind).toBe('quickSearch:snapshotStart');
    expect(dispositions[0]).toMatchObject({
      kind: 'rebuild-required',
      transferId: 1,
    });
  });

  it('structural/layout/signature change triggers full rebuild', () => {
    const { backend, transport, client } = createClient();
    const gen = warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    client.sync({
      rows: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Cara' }, { name: 'Dave' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 1,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions),
    });
    backend.flush();

    expect(client.getCurrentGeneration()).toBeGreaterThan(gen);
    expect(transport.messages[0]?.kind).toBe('quickSearch:snapshotStart');
    expect(dispositions[0]).toMatchObject({
      kind: 'rebuild-required',
      transferId: 1,
    });
  });

  it('rebuild-required is emitted only after accepted snapshotStart', () => {
    let failStart = false;
    const { backend, transport, client } = createClient({
      shouldFail: (m) => failStart && m.kind === 'quickSearch:snapshotStart',
    });
    warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];
    const failures: number[] = [];

    failStart = true;
    const outcome = client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions, { complete: false }),
      onAsyncFailure: () => failures.push(1),
    });

    expect(outcome).toBe('failed');
    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 1 }]);
    expect(failures).toEqual([1]);
    expect(transport.messages).toHaveLength(0);

    failStart = false;
    const dispositions2: unknown[] = [];
    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    transport.messages.length = 0;

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(2, [0], dispositions2, { complete: false }),
    });
    // Disposition fires synchronously on accepted start, before flush of chunks.
    expect(dispositions2).toEqual([
      {
        kind: 'rebuild-required',
        transferId: 2,
        newGeneration: client.getCurrentGeneration(),
      },
    ]);
    expect(transport.messages[0]?.kind).toBe('quickSearch:snapshotStart');
  });

  it('patchStart failure emits cancelled + async failure once', () => {
    const { backend, transport, client } = createClient({
      shouldFail: (m) => m.kind === 'quickSearch:snapshotPatchStart',
    });
    warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];
    const failures: number[] = [];

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions),
      onAsyncFailure: () => failures.push(1),
    });
    backend.flush();

    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 1 }]);
    expect(failures).toEqual([1]);
    expect(transport.messages).toHaveLength(0);
    expect(client.isSnapshotComplete()).toBe(false);
  });

  it('patchChunk failure stops posting and never emits posted', () => {
    const { backend, transport, client } = createClient({
      shouldFail: (m) => m.kind === 'quickSearch:snapshotPatchChunk',
    });
    warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];
    const failures: number[] = [];

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bobby' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0, 1], dispositions),
      onAsyncFailure: () => failures.push(1),
    });
    backend.flush();

    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 1 }]);
    expect(failures).toEqual([1]);
    expect(transport.messages.map((m) => m.kind)).toEqual([
      'quickSearch:snapshotPatchStart',
    ]);
    expect(
      transport.messages.some((m) => m.kind === 'quickSearch:snapshotPatchComplete'),
    ).toBe(false);
  });

  it('prewarm cannot displace interactive patch', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions),
    });
    // Patch extraction scheduled; prewarm must no-op.
    client.prewarm({
      rows: [{ name: 'Zed' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-b',
      sourceLayoutRevision: 0,
      searchableDataRevision: 9,
    });
    expect(backend.pending()).toBe(1);
    backend.flush();

    expect(transport.messages.some((m) => m.kind === 'quickSearch:snapshotStart')).toBe(
      false,
    );
    expect(dispositions[0]).toMatchObject({ kind: 'posted' });
  });

  it('patch cancels pending prewarm', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    client.prewarm({
      rows: [{ name: 'Zed' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-b',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    expect(backend.pending()).toBe(1);

    const dispositions: unknown[] = [];
    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions),
    });
    expect(backend.pending()).toBe(1);
    backend.flush();

    expect(transport.messages.some((m) => m.kind === 'quickSearch:snapshotStart')).toBe(
      false,
    );
    expect(dispositions[0]).toMatchObject({ kind: 'posted' });
  });

  it('cancel before first patch continuation posts no patch messages', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions),
    });
    client.cancel();
    backend.flush();

    expect(transport.messages).toHaveLength(0);
    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 1 }]);
  });

  it('cancel mid-extraction posts no patch messages and cancels once', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions),
    });
    // Fire first collect tick but cancel before completion if multi-step.
    // With small set, one step may finish — cancel before flush:
    client.cancel();
    backend.flush();
    client.cancel();

    expect(transport.messages).toHaveLength(0);
    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 1 }]);
  });

  it('cancelPatch cancels patch extraction once and preserves completed base', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const gen = client.getCurrentGeneration();
    const dispositions: unknown[] = [];

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions),
    });
    expect(client.isPatching()).toBe(true);
    client.cancelPatch();
    backend.flush();
    client.cancelPatch();

    expect(client.isPatching()).toBe(false);
    expect(client.isSnapshotComplete()).toBe(true);
    expect(client.getCurrentGeneration()).toBe(gen);
    expect(transport.messages).toHaveLength(0);
    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 1 }]);
  });

  it('superseding sync cancels old transfer once', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const d1: unknown[] = [];
    const d2: unknown[] = [];

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], d1),
    });
    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bobby' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 2,
      transfer: transferInput(2, [1], d2),
    });
    backend.flush();

    expect(d1).toEqual([{ kind: 'cancelled', transferId: 1 }]);
    expect(d2).toEqual([
      expect.objectContaining({ kind: 'posted', transferId: 2, targetDataRevision: 2 }),
    ]);
  });

  it('successful posted transfer is not cancelled by later sync', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions),
    });
    backend.flush();
    expect(dispositions).toHaveLength(1);
    expect(dispositions[0]).toMatchObject({ kind: 'posted' });

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
    });
    client.clear();

    expect(dispositions).toHaveLength(1);
  });

  it('clear/destroy cancel active patch work exactly once', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions),
    });
    expect(client.clear()).toBe(true);
    client.destroy();
    backend.flush();

    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 1 }]);
    expect(
      transport.messages.some((m) => m.kind === 'quickSearch:snapshotPatchStart'),
    ).toBe(false);
  });

  it('patch IDs remain monotonic across clear/rebuild', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const d1: unknown[] = [];
    client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], d1),
    });
    backend.flush();
    const posted1 = d1[0] as { patchId: number };
    expect(posted1.patchId).toBe(1);

    client.clear();
    client.sync({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
    });
    backend.flush();
    transport.messages.length = 0;

    const d2: unknown[] = [];
    client.sync({
      rows: [{ name: 'Alice' }, { name: 'Bobby' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 2,
      transfer: transferInput(2, [1], d2),
    });
    backend.flush();
    const posted2 = d2[0] as { patchId: number };
    expect(posted2.patchId).toBe(2);
  });

  it('rows-reference-only change with unchanged revisions still reuses', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const gen = client.getCurrentGeneration();

    const outcome = client.sync({
      rows: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });

    expect(outcome).toBe('reused');
    expect(client.getCurrentGeneration()).toBe(gen);
    expect(transport.messages).toHaveLength(0);
  });

  it('exact identity plus supplied transfer does not reuse; rebuild-required once', () => {
    const { backend, transport, client } = createClient();
    const gen = warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    const outcome = client.sync({
      rows: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
      transfer: transferInput(7, [0], dispositions),
    });
    backend.flush();

    expect(outcome).toBe('started');
    expect(outcome).not.toBe('reused');
    expect(client.getCurrentGeneration()).toBeGreaterThan(gen);
    expect(transport.messages[0]?.kind).toBe('quickSearch:snapshotStart');
    expect(dispositions).toEqual([
      {
        kind: 'rebuild-required',
        transferId: 7,
        newGeneration: client.getCurrentGeneration(),
      },
    ]);
  });

  it('patch start returns patching; full rebuild returns started', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const dPatch: unknown[] = [];

    expect(
      client.sync({
        rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
        descriptors: [desc('name')],
        fieldsSignature: 'sig-a',
        sourceLayoutRevision: 0,
        searchableDataRevision: 1,
        transfer: transferInput(1, [0], dPatch),
      }),
    ).toBe('patching');
    backend.flush();

    const dRebuild: unknown[] = [];
    expect(
      client.sync({
        rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }, { name: 'Dave' }],
        descriptors: [desc('name')],
        fieldsSignature: 'sig-a',
        sourceLayoutRevision: 1,
        searchableDataRevision: 2,
        transfer: transferInput(2, [0], dRebuild),
      }),
    ).toBe('started');
    expect(dRebuild[0]).toMatchObject({ kind: 'rebuild-required' });
  });

  it('prewarm with an accidental transfer does not consume or dispose it', () => {
    const { backend, transport, client } = createClient();
    const dispositions: unknown[] = [];
    const transfer = transferInput(99, [0], dispositions);

    client.prewarm({
      rows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
      transfer,
      onAsyncFailure: () => {
        dispositions.push({ kind: 'async-failure' });
      },
    });
    backend.flush();

    expect(dispositions).toHaveLength(0);
    expect(transport.messages[0]?.kind).toBe('quickSearch:snapshotStart');
    expect(client.isSnapshotComplete()).toBe(true);

    // The same transfer object can still be disposed by a later interactive sync.
    const outcome = client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer,
    });
    backend.flush();
    expect(outcome).toBe('patching');
    expect(dispositions).toEqual([
      expect.objectContaining({ kind: 'posted', transferId: 99 }),
    ]);
  });

  it('rebuild-required callback that calls cancel leaves no extraction work', () => {
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport);
    const dispositions: unknown[] = [];

    const outcome = client.sync({
      rows: [{ name: 'Alicia' }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      chunkSize: 1,
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: {
        transferId: 1,
        indexes: [0],
        complete: false,
        onDisposition: (d) => {
          dispositions.push(d);
          if (d.kind === 'rebuild-required') {
            client.cancel();
          }
        },
      },
    });

    expect(outcome).toBe('started');
    expect(dispositions).toEqual([
      {
        kind: 'rebuild-required',
        transferId: 1,
        newGeneration: expect.any(Number),
      },
    ]);
    expect(backend.pending()).toBe(0);
    backend.flush();
    expect(
      transport.messages.filter((m) => m.kind === 'quickSearch:snapshotChunk'),
    ).toHaveLength(0);
    expect(
      transport.messages.some((m) => m.kind === 'quickSearch:snapshotComplete'),
    ).toBe(false);
    expect(client.isSnapshotComplete()).toBe(false);
    expect(dispositions).toHaveLength(1);
  });

  it('genuine mid-patch-extraction cancel posts no patch messages', () => {
    // Default maxIndexesPerContinuation is 1024 — more indexes keeps collect pending.
    const rowCount = 1100;
    const largeRows = Array.from({ length: rowCount }, (_, i) => ({
      name: `R${i}`,
    }));
    const indexes = Array.from({ length: rowCount }, (_, i) => i);

    const { backend, transport, client } = createClient();
    client.sync({
      rows: largeRows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    transport.messages.length = 0;

    const dispositions: unknown[] = [];
    const outcome = client.sync({
      rows: largeRows.map((r, i) =>
        i === 0 ? { name: 'Edited' } : r,
      ),
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, indexes, dispositions),
    });
    expect(outcome).toBe('patching');

    backend.step();
    expect(backend.pending()).toBeGreaterThan(0);
    expect(transport.messages).toHaveLength(0);

    client.cancel();
    backend.flush();

    expect(transport.messages).toHaveLength(0);
    expect(dispositions).toEqual([{ kind: 'cancelled', transferId: 1 }]);
    expect(backend.pending()).toBe(0);
  });

  it('default unique-row limit causes full rebuild after accepted snapshotStart', () => {
    // Default maxUniqueRows is 2048 — 2049 unique indexes force rebuild-required.
    const rowCount = 2049;
    const largeRows = Array.from({ length: rowCount }, (_, i) => ({
      name: `R${i}`,
    }));
    const indexes = Array.from({ length: rowCount }, (_, i) => i);

    const { backend, transport, client } = createClient();
    client.sync({
      rows: largeRows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    backend.flush();
    const gen = client.getCurrentGeneration();
    transport.messages.length = 0;

    const dispositions: unknown[] = [];
    const outcome = client.sync({
      rows: largeRows,
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, indexes, dispositions),
    });
    expect(outcome).toBe('patching');
    backend.flush();

    expect(client.getCurrentGeneration()).toBeGreaterThan(gen);
    expect(transport.messages[0]?.kind).toBe('quickSearch:snapshotStart');
    expect(
      transport.messages.some((m) => m.kind === 'quickSearch:snapshotPatchStart'),
    ).toBe(false);
    expect(dispositions).toEqual([
      {
        kind: 'rebuild-required',
        transferId: 1,
        newGeneration: client.getCurrentGeneration(),
      },
    ]);
  });

  it('default oversized-row byte limit causes full rebuild after accepted snapshotStart', () => {
    // Default maxBytesPerChunk is 64KiB. Estimate = 48 + 16 + length*2.
    // length > 32736 yields an oversized single row.
    const huge = 'X'.repeat(40_000);
    const { backend, transport, client } = createClient();
    warmSnapshot(client, backend, transport, {
      rows: [{ name: 'small' }, { name: 'Bob' }, { name: 'Cara' }],
    });
    const gen = client.getCurrentGeneration();
    const dispositions: unknown[] = [];

    const outcome = client.sync({
      rows: [{ name: huge }, { name: 'Bob' }, { name: 'Cara' }],
      descriptors: [desc('name')],
      fieldsSignature: 'sig-a',
      sourceLayoutRevision: 0,
      searchableDataRevision: 1,
      transfer: transferInput(1, [0], dispositions),
    });
    expect(outcome).toBe('patching');
    backend.flush();

    expect(client.getCurrentGeneration()).toBeGreaterThan(gen);
    expect(transport.messages[0]?.kind).toBe('quickSearch:snapshotStart');
    expect(
      transport.messages.some((m) => m.kind === 'quickSearch:snapshotPatchStart'),
    ).toBe(false);
    expect(dispositions).toEqual([
      {
        kind: 'rebuild-required',
        transferId: 1,
        newGeneration: client.getCurrentGeneration(),
      },
    ]);
  });
});
