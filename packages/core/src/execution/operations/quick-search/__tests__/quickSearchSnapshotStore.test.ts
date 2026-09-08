import { describe, expect, it } from 'vitest';

import { QuickSearchSnapshotStore } from '../quickSearchSnapshotStore';

describe('QuickSearchSnapshotStore', () => {
  it('builds row texts from searchable-only chunks, joining fields with a space', () => {
    const store = new QuickSearchSnapshotStore();
    store.start(1, 2);
    store.applyChunk(1, [
      { rowIndex: 0, values: ['ALICE', 'LAHORE'] },
      { rowIndex: 1, values: ['BOB', 'LONDON'] },
    ]);
    store.markComplete(1);

    expect(store.getRowText(0)).toBe('ALICE LAHORE');
    expect(store.getRowText(1)).toBe('BOB LONDON');
    expect(store.getRowCount()).toBe(2);
    expect(store.isComplete()).toBe(true);
    expect(store.getGeneration()).toBe(1);
  });

  it('rejects stale-generation chunks and completion', () => {
    const store = new QuickSearchSnapshotStore();
    store.start(2, 1);
    expect(store.applyChunk(1, [{ rowIndex: 0, values: ['OLD'] }])).toBe(false);
    expect(store.getRowText(0)).toBe('');
    expect(store.markComplete(1)).toBe(false);
    expect(store.isComplete()).toBe(false);
  });

  it('ignores out-of-range row indexes', () => {
    const store = new QuickSearchSnapshotStore();
    store.start(1, 1);
    store.applyChunk(1, [
      { rowIndex: 5, values: ['X'] },
      { rowIndex: -1, values: ['Y'] },
      { rowIndex: 0, values: ['OK'] },
    ]);
    expect(store.getRowText(0)).toBe('OK');
    expect(store.getRowText(5)).toBe('');
  });

  it('clear resets everything', () => {
    const store = new QuickSearchSnapshotStore();
    store.start(1, 1);
    store.applyChunk(1, [{ rowIndex: 0, values: ['A'] }]);
    store.markComplete(1);
    store.clear();
    expect(store.getRowCount()).toBe(0);
    expect(store.isComplete()).toBe(false);
    expect(store.getRowText(0)).toBe('');
  });

  it('commitPatch applies multi-row updates atomically', () => {
    const store = new QuickSearchSnapshotStore();
    store.start(1, 3);
    store.applyChunk(1, [
      { rowIndex: 0, values: ['A'] },
      { rowIndex: 1, values: ['B'] },
      { rowIndex: 2, values: ['C'] },
    ]);
    store.markComplete(1);

    const ok = store.commitPatch(
      1,
      new Map([
        [0, 'X'],
        [2, 'Z'],
      ]),
    );
    expect(ok).toBe(true);
    expect(store.getRowText(0)).toBe('X');
    expect(store.getRowText(1)).toBe('B');
    expect(store.getRowText(2)).toBe('Z');
  });

  it('commitPatch with invalid generation commits nothing', () => {
    const store = new QuickSearchSnapshotStore();
    store.start(2, 1);
    store.applyChunk(2, [{ rowIndex: 0, values: ['A'] }]);
    store.markComplete(2);

    expect(store.commitPatch(1, new Map([[0, 'X']]))).toBe(false);
    expect(store.getRowText(0)).toBe('A');
  });

  it('commitPatch on incomplete snapshot commits nothing', () => {
    const store = new QuickSearchSnapshotStore();
    store.start(1, 1);
    store.applyChunk(1, [{ rowIndex: 0, values: ['A'] }]);

    expect(store.commitPatch(1, new Map([[0, 'X']]))).toBe(false);
    expect(store.getRowText(0)).toBe('A');
    expect(store.isComplete()).toBe(false);
  });

  it('one invalid source index prevents every update including earlier valid entries', () => {
    const store = new QuickSearchSnapshotStore();
    store.start(1, 2);
    store.applyChunk(1, [
      { rowIndex: 0, values: ['A'] },
      { rowIndex: 1, values: ['B'] },
    ]);
    store.markComplete(1);

    expect(
      store.commitPatch(
        1,
        new Map([
          [0, 'X'],
          [99, 'Y'],
          [1, 'Z'],
        ]),
      ),
    ).toBe(false);
    expect(store.getRowText(0)).toBe('A');
    expect(store.getRowText(1)).toBe('B');
  });
});
