import { describe, expect, it } from 'vitest';

import type {
  LightFastGridColDef,
  LightFastGridColumnGroupDef,
  LightFastGridColumnInput,
} from '../../../types';
import { deriveSegmentId } from '../deriveGroupPathIds';
import {
  flattenColumnInput,
  isColumnGroupDef,
} from '../flattenColumnInput';

function leaf(
  field: string,
  overrides?: Partial<LightFastGridColDef>,
): LightFastGridColDef {
  return { field, ...overrides };
}

function group(
  headerName: string,
  children: LightFastGridColumnInput[],
  groupId?: string,
): LightFastGridColumnGroupDef {
  return { headerName, children, ...(groupId !== undefined ? { groupId } : {}) };
}

// ── 1. Flat columns produce identical visible columns / no groups ──────

describe('flat columns (no groups)', () => {
  it('produces identical leaf columns and depth 0', () => {
    const input: LightFastGridColumnInput[] = [
      leaf('a'),
      leaf('b'),
      leaf('c'),
    ];
    const result = flattenColumnInput(input);
    expect(result.leafColumns).toEqual(input);
    expect(result.depth).toBe(0);
    expect(result.groupMetaByField).toEqual({});
  });

  it('preserves leaf order for flat input', () => {
    const input: LightFastGridColumnInput[] = [
      leaf('z'),
      leaf('a'),
      leaf('m'),
    ];
    const result = flattenColumnInput(input);
    expect(result.leafColumns.map((c) => c.field)).toEqual(['z', 'a', 'm']);
  });

  it('returns empty result for empty input', () => {
    const result = flattenColumnInput([]);
    expect(result.leafColumns).toEqual([]);
    expect(result.depth).toBe(0);
    expect(result.groupMetaByField).toEqual({});
  });
});

// ── 2. One-level groups ───────────────────────────────────────────────

describe('one-level groups', () => {
  it('flattens in leaf order with correct path metadata', () => {
    const input: LightFastGridColumnInput[] = [
      group('Profile', [leaf('name'), leaf('email')], 'profile'),
      group('Finance', [leaf('balance'), leaf('rating')], 'finance'),
    ];
    const result = flattenColumnInput(input);

    expect(result.leafColumns.map((c) => c.field)).toEqual([
      'name', 'email', 'balance', 'rating',
    ]);
    expect(result.depth).toBe(1);

    expect(result.groupMetaByField['name']).toEqual({
      path: [{
        id: '/profile',
        headerName: 'Profile',
        level: 0,
      }],
    });
    expect(result.groupMetaByField['email']).toEqual({
      path: [{
        id: '/profile',
        headerName: 'Profile',
        level: 0,
      }],
    });
    expect(result.groupMetaByField['balance']).toEqual({
      path: [{
        id: '/finance',
        headerName: 'Finance',
        level: 0,
      }],
    });
  });

  it('includes ungrouped leaves with no metadata', () => {
    const input: LightFastGridColumnInput[] = [
      leaf('standalone'),
      group('G', [leaf('grouped')], 'g'),
    ];
    const result = flattenColumnInput(input);

    expect(result.leafColumns.map((c) => c.field)).toEqual([
      'standalone', 'grouped',
    ]);
    expect(result.groupMetaByField['standalone']).toBeUndefined();
    expect(result.groupMetaByField['grouped']).toBeDefined();
    expect(result.depth).toBe(1);
  });
});

// ── 3. Nested groups ──────────────────────────────────────────────────

describe('nested groups', () => {
  it('produces correct depth and root-to-leaf path metadata', () => {
    const input: LightFastGridColumnInput[] = [
      group('Outer', [
        group('Inner', [
          leaf('deep'),
        ], 'inner'),
      ], 'outer'),
    ];
    const result = flattenColumnInput(input);

    expect(result.depth).toBe(2);
    expect(result.leafColumns.map((c) => c.field)).toEqual(['deep']);
    expect(result.groupMetaByField['deep']).toEqual({
      path: [
        { id: '/outer', headerName: 'Outer', level: 0 },
        { id: '/outer/inner', headerName: 'Inner', level: 1 },
      ],
    });
  });

  it('handles mixed depth: some leaves at depth 1, others at depth 2', () => {
    const input: LightFastGridColumnInput[] = [
      group('A', [
        leaf('a1'),
        group('B', [leaf('b1')], 'b'),
      ], 'a'),
    ];
    const result = flattenColumnInput(input);

    expect(result.depth).toBe(2);
    expect(result.leafColumns.map((c) => c.field)).toEqual(['a1', 'b1']);
    expect(result.groupMetaByField['a1']!.path).toHaveLength(1);
    expect(result.groupMetaByField['b1']!.path).toHaveLength(2);
    expect(result.groupMetaByField['b1']!.path[1]!.id).toBe('/a/b');
  });

  it('three levels of nesting', () => {
    const input: LightFastGridColumnInput[] = [
      group('L0', [
        group('L1', [
          group('L2', [leaf('x')], 'l2'),
        ], 'l1'),
      ], 'l0'),
    ];
    const result = flattenColumnInput(input);

    expect(result.depth).toBe(3);
    expect(result.groupMetaByField['x']!.path).toEqual([
      { id: '/l0', headerName: 'L0', level: 0 },
      { id: '/l0/l1', headerName: 'L1', level: 1 },
      { id: '/l0/l1/l2', headerName: 'L2', level: 2 },
    ]);
  });
});

// ── 4. Duplicate group labels under different parents ─────────────────

describe('duplicate group labels under different parents', () => {
  it('do not share identities when headerName is the same', () => {
    const input: LightFastGridColumnInput[] = [
      group('Parent A', [
        group('Details', [leaf('a_detail')], 'details'),
      ], 'parentA'),
      group('Parent B', [
        group('Details', [leaf('b_detail')], 'details'),
      ], 'parentB'),
    ];
    const result = flattenColumnInput(input);

    const aPath = result.groupMetaByField['a_detail']!.path;
    const bPath = result.groupMetaByField['b_detail']!.path;

    expect(aPath[1]!.id).toBe('/parentA/details');
    expect(bPath[1]!.id).toBe('/parentB/details');
    expect(aPath[1]!.id).not.toBe(bPath[1]!.id);
  });
});

// ── 5. Duplicate groupId under different parents ──────────────────────

describe('duplicate groupId under different parents', () => {
  it('produces distinct scoped ids', () => {
    const input: LightFastGridColumnInput[] = [
      group('G1', [
        group('Shared', [leaf('f1')], 'shared'),
      ], 'g1'),
      group('G2', [
        group('Shared', [leaf('f2')], 'shared'),
      ], 'g2'),
    ];
    const result = flattenColumnInput(input);

    const id1 = result.groupMetaByField['f1']!.path[1]!.id;
    const id2 = result.groupMetaByField['f2']!.path[1]!.id;
    expect(id1).toBe('/g1/shared');
    expect(id2).toBe('/g2/shared');
    expect(id1).not.toBe(id2);
  });
});

// ── 6. Missing groupId derived identity stability ─────────────────────

describe('missing groupId derived identity', () => {
  it('uses sibling ordinal from original input position', () => {
    const input: LightFastGridColumnInput[] = [
      group('First', [leaf('a')]),
      group('Second', [leaf('b')]),
    ];
    const result = flattenColumnInput(input);

    expect(result.groupMetaByField['a']!.path[0]!.id).toBe('/0');
    expect(result.groupMetaByField['b']!.path[0]!.id).toBe('/1');
  });

  it('is stable regardless of leaf visibility', () => {
    const input: LightFastGridColumnInput[] = [
      group('G', [
        leaf('visible_leaf'),
        leaf('hidden_leaf', { visible: false }),
      ]),
    ];
    const result = flattenColumnInput(input);

    const visibleMeta = result.groupMetaByField['visible_leaf'];
    const hiddenMeta = result.groupMetaByField['hidden_leaf'];
    expect(visibleMeta!.path[0]!.id).toBe(hiddenMeta!.path[0]!.id);
  });

  it('is stable regardless of leaf pinning', () => {
    const inputUnpinned: LightFastGridColumnInput[] = [
      group('G', [leaf('a'), leaf('b')]),
    ];
    const inputPinned: LightFastGridColumnInput[] = [
      group('G', [leaf('a', { pinned: 'left' }), leaf('b')]),
    ];
    const r1 = flattenColumnInput(inputUnpinned);
    const r2 = flattenColumnInput(inputPinned);

    expect(r1.groupMetaByField['a']!.path[0]!.id)
      .toBe(r2.groupMetaByField['a']!.path[0]!.id);
    expect(r1.groupMetaByField['b']!.path[0]!.id)
      .toBe(r2.groupMetaByField['b']!.path[0]!.id);
  });

  it('ordinal comes from original children index, not reorder', () => {
    const input: LightFastGridColumnInput[] = [
      group('G', [leaf('a'), leaf('b'), leaf('c')]),
    ];
    const result = flattenColumnInput(input);

    expect(result.groupMetaByField['a']!.path[0]!.id).toBe('/0');
    expect(result.groupMetaByField['b']!.path[0]!.id).toBe('/0');
    expect(result.groupMetaByField['c']!.path[0]!.id).toBe('/0');
  });
});

// ── 7. Hidden leaves ──────────────────────────────────────────────────

describe('hidden leaves', () => {
  it('are included in leaf columns (flattening preserves them)', () => {
    const input: LightFastGridColumnInput[] = [
      group('G', [
        leaf('vis'),
        leaf('hid', { visible: false }),
      ], 'g'),
    ];
    const result = flattenColumnInput(input);

    expect(result.leafColumns.map((c) => c.field)).toEqual(['vis', 'hid']);
    expect(result.groupMetaByField['vis']).toBeDefined();
    expect(result.groupMetaByField['hid']).toBeDefined();
  });
});

// ── 8. Leaf behavior fields survive flattening ────────────────────────

describe('leaf behavior fields survive flattening', () => {
  it('preserves all leaf properties through flattening', () => {
    const getter = () => 'val';
    const formatter = () => 'formatted';
    const comparator = () => 0;
    const quickFilterGetter = () => 'text';

    const inputLeaf = leaf('f', {
      headerName: 'Field',
      sortable: true,
      filterable: true,
      filter: 'text',
      floatingFilter: true,
      pinned: 'left',
      width: 200,
      minWidth: 50,
      maxWidth: 500,
      resizable: true,
      reorderable: false,
      pinnable: true,
      visible: true,
      editable: true,
      columnMenu: false,
      valueGetter: getter as LightFastGridColDef['valueGetter'],
      valueFormatter: formatter as LightFastGridColDef['valueFormatter'],
      sortComparator: comparator,
      searchable: true,
      quickFilterTextField: 'search_text',
      getQuickFilterText: quickFilterGetter as LightFastGridColDef['getQuickFilterText'],
      cellClass: 'my-class',
      tooltip: true,
      suppressSizeToFit: true,
    });

    const input: LightFastGridColumnInput[] = [
      group('G', [inputLeaf], 'g'),
    ];
    const result = flattenColumnInput(input);

    expect(result.leafColumns[0]).toBe(inputLeaf);
  });

  it('does not add group metadata onto leaf objects', () => {
    const input: LightFastGridColumnInput[] = [
      group('G', [leaf('a')], 'g'),
    ];
    const result = flattenColumnInput(input);
    const leafCol = result.leafColumns[0]!;

    expect(leafCol).not.toHaveProperty('groupId');
    expect(leafCol).not.toHaveProperty('path');
    expect(leafCol).not.toHaveProperty('groupMeta');
    expect(leafCol).not.toHaveProperty('children');
  });
});

// ── Field-less / synthetic leaves ─────────────────────────────────────

describe('field-less leaves', () => {
  it('skips leaves without a field and keeps sibling group meta intact', () => {
    const synthetic = {
      headerName: 'Winning Trends',
      width: 200,
    } as LightFastGridColDef;

    const input: LightFastGridColumnInput[] = [
      group('Monthly', [
        synthetic,
        leaf('jan'),
        leaf('feb'),
      ], 'monthly'),
    ];
    const result = flattenColumnInput(input);

    expect(result.leafColumns.map((c) => c.field)).toEqual(['jan', 'feb']);
    expect(result.depth).toBe(1);
    expect(result.groupMetaByField).not.toHaveProperty('undefined');
    expect(Object.keys(result.groupMetaByField)).toEqual(['jan', 'feb']);
    expect(result.groupMetaByField['jan']?.path[0]?.headerName).toBe('Monthly');
  });

  it('skips empty-string field leaves', () => {
    const input: LightFastGridColumnInput[] = [
      leaf(''),
      leaf('name'),
    ];
    const result = flattenColumnInput(input);
    expect(result.leafColumns.map((c) => c.field)).toEqual(['name']);
  });
});

// ── deriveSegmentId unit tests ────────────────────────────────────────

describe('deriveSegmentId', () => {
  it('root-level with groupId', () => {
    expect(deriveSegmentId('', 'profile', 0)).toBe('/profile');
  });

  it('root-level without groupId uses ordinal', () => {
    expect(deriveSegmentId('', undefined, 1)).toBe('/1');
  });

  it('nested with groupId', () => {
    expect(deriveSegmentId('/profile', 'name', 0)).toBe('/profile/name');
  });

  it('nested without groupId uses ordinal', () => {
    expect(deriveSegmentId('/1', undefined, 1)).toBe('/1/1');
  });

  it('encodes special characters in groupId', () => {
    expect(deriveSegmentId('', 'a/b', 0)).toBe('/a%2Fb');
    expect(deriveSegmentId('', 'with space', 0)).toBe('/with%20space');
  });
});

// ── isColumnGroupDef type guard ───────────────────────────────────────

describe('isColumnGroupDef', () => {
  it('returns true for group defs', () => {
    expect(isColumnGroupDef(group('G', [leaf('a')]))).toBe(true);
  });

  it('returns false for leaf defs', () => {
    expect(isColumnGroupDef(leaf('a'))).toBe(false);
  });
});
