import { describe, expect, it } from 'vitest';

import { createIndexedRowOrder } from '../../../row-model/rowOrder';
import { remapRowOrderByRowIds } from '../quickSearchRowOrderRemap';

const rows = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
  { id: 'c', name: 'Charlie' },
];

function idMap(entries: Array<[string, number]>): Map<string, number> {
  return new Map(entries);
}

describe('remapRowOrderByRowIds', () => {
  it('remaps indexed order when rows are inserted at the head', () => {
    const remapped = remapRowOrderByRowIds(
      {
        previousRows: rows,
        previousRowIdToIndex: idMap([
          ['a', 0],
          ['b', 1],
          ['c', 2],
        ]),
        previousOrder: createIndexedRowOrder(Uint32Array.from([0])),
      },
      idMap([
        ['e', 0],
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]),
    );

    expect(remapped).toEqual(createIndexedRowOrder(Uint32Array.from([1])));
  });

  it('remaps append-only layout without changing matched row id', () => {
    const remapped = remapRowOrderByRowIds(
      {
        previousRows: rows,
        previousRowIdToIndex: idMap([
          ['a', 0],
          ['b', 1],
          ['c', 2],
        ]),
        previousOrder: createIndexedRowOrder(Uint32Array.from([0])),
      },
      idMap([
        ['a', 0],
        ['b', 1],
        ['c', 2],
        ['e', 3],
      ]),
    );

    expect(remapped).toEqual(createIndexedRowOrder(Uint32Array.from([0])));
  });

  it('drops removed rows from the remapped order', () => {
    const remapped = remapRowOrderByRowIds(
      {
        previousRows: rows,
        previousRowIdToIndex: idMap([
          ['a', 0],
          ['b', 1],
          ['c', 2],
        ]),
        previousOrder: createIndexedRowOrder(Uint32Array.from([0, 2])),
      },
      idMap([
        ['b', 0],
        ['c', 1],
      ]),
    );

    expect(remapped).toEqual(createIndexedRowOrder(Uint32Array.from([1])));
  });

  it('returns null when row ids are unavailable', () => {
    const remapped = remapRowOrderByRowIds(
      {
        previousRows: rows,
        previousRowIdToIndex: new Map(),
        previousOrder: createIndexedRowOrder(Uint32Array.from([0])),
      },
      idMap([['a', 0]]),
    );

    expect(remapped).toBeNull();
  });
});
