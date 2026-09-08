import { describe, expect, it } from 'vitest';

import { GridState } from '../../../state/GridState';
import type {
  LightFastGridColDef,
  LightFastGridColumnGroupDef,
  LightFastGridColumnInput,
} from '../../../types';

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

// ── 1. Flat columns: no group snapshot ────────────────────────────────

describe('GridState with flat columns', () => {
  it('snapshot has no columnGroupHeaders', () => {
    const state = new GridState({
      columns: [leaf('a'), leaf('b'), leaf('c')],
      rows: [{ a: 1, b: 2, c: 3 }],
    });
    const snap = state.getSnapshot();
    expect(snap.columns.map((c) => c.field)).toEqual(['a', 'b', 'c']);
    expect(snap.columnGroupHeaders).toBeUndefined();
  });
});

// ── 2. One-level groups ───────────────────────────────────────────────

describe('GridState with one-level groups', () => {
  it('produces flat visible columns and group metadata', () => {
    const state = new GridState({
      columns: [
        group('Profile', [leaf('name'), leaf('email')], 'profile'),
        group('Finance', [leaf('balance')], 'finance'),
      ],
      rows: [],
    });
    const snap = state.getSnapshot();

    expect(snap.columns.map((c) => c.field)).toEqual([
      'name', 'email', 'balance',
    ]);
    expect(snap.columnGroupHeaders).toBeDefined();
    expect(snap.columnGroupHeaders!.depth).toBe(1);
    expect(snap.columnGroupHeaders!.byField['name']).toEqual({
      path: [{ id: '/profile', headerName: 'Profile', level: 0 }],
    });
    expect(snap.columnGroupHeaders!.byField['balance']).toEqual({
      path: [{ id: '/finance', headerName: 'Finance', level: 0 }],
    });
  });
});

// ── 3. Nested groups ──────────────────────────────────────────────────

describe('GridState with nested groups', () => {
  it('produces correct depth and root-to-leaf path', () => {
    const state = new GridState({
      columns: [
        group('Outer', [
          group('Inner', [leaf('deep')], 'inner'),
        ], 'outer'),
      ],
      rows: [],
    });
    const snap = state.getSnapshot();

    expect(snap.columnGroupHeaders!.depth).toBe(2);
    expect(snap.columnGroupHeaders!.byField['deep']!.path).toEqual([
      { id: '/outer', headerName: 'Outer', level: 0 },
      { id: '/outer/inner', headerName: 'Inner', level: 1 },
    ]);
  });
});

// ── 7. Hidden leaf is omitted from visible snapshot ───────────────────

describe('GridState hidden leaves', () => {
  it('omits hidden leaves from snapshot columns and group metadata', () => {
    const state = new GridState({
      columns: [
        group('G', [
          leaf('vis'),
          leaf('hid', { visible: false }),
        ], 'g'),
      ],
      rows: [],
    });
    const snap = state.getSnapshot();

    expect(snap.columns.map((c) => c.field)).toEqual(['vis']);
    expect(snap.columnGroupHeaders!.byField['vis']).toBeDefined();
    expect(snap.columnGroupHeaders!.byField['hid']).toBeUndefined();
  });
});

// ── 9. setColumns replaces group metadata cleanly ─────────────────────

describe('GridState setColumns with groups', () => {
  it('replaces previous group metadata cleanly', () => {
    const state = new GridState({
      columns: [
        group('Old', [leaf('a')], 'old'),
      ],
      rows: [],
    });

    let snap = state.getSnapshot();
    expect(snap.columnGroupHeaders!.byField['a']!.path[0]!.id).toBe('/old');

    state.setColumns([
      group('New', [leaf('a'), leaf('b')], 'new'),
    ]);
    snap = state.getSnapshot();

    expect(snap.columns.map((c) => c.field)).toEqual(['a', 'b']);
    expect(snap.columnGroupHeaders!.byField['a']!.path[0]!.id).toBe('/new');
    expect(snap.columnGroupHeaders!.byField['b']).toBeDefined();
  });

  it('clears group metadata when switching to flat columns', () => {
    const state = new GridState({
      columns: [group('G', [leaf('a')], 'g')],
      rows: [],
    });
    expect(state.getSnapshot().columnGroupHeaders).toBeDefined();

    state.setColumns([leaf('a'), leaf('b')]);
    const snap = state.getSnapshot();
    expect(snap.columnGroupHeaders).toBeUndefined();
    expect(snap.columns.map((c) => c.field)).toEqual(['a', 'b']);
  });
});

// ── 10. Runtime hide/show/pin still uses leaf field ids ───────────────

describe('GridState runtime APIs with grouped input', () => {
  it('hide/show uses leaf field ids', () => {
    const state = new GridState({
      columns: [
        group('G', [leaf('a'), leaf('b'), leaf('c')], 'g'),
      ],
      rows: [],
    });

    expect(state.getSnapshot().columns.map((c) => c.field)).toEqual(['a', 'b', 'c']);

    state.setColumnVisible('b', false);
    let snap = state.getSnapshot();
    expect(snap.columns.map((c) => c.field)).toEqual(['a', 'c']);
    expect(snap.columnGroupHeaders!.byField['b']).toBeUndefined();

    state.setColumnVisible('b', true);
    snap = state.getSnapshot();
    expect(snap.columns.map((c) => c.field)).toEqual(['a', 'b', 'c']);
    expect(snap.columnGroupHeaders!.byField['b']).toBeDefined();
  });

  it('pin uses leaf field ids', () => {
    const state = new GridState({
      columns: [
        group('G', [leaf('a'), leaf('b')], 'g'),
      ],
      rows: [],
    });

    state.setColumnPinned('a', 'left');
    const snap = state.getSnapshot();
    const colA = snap.columns.find((c) => c.field === 'a');
    expect(colA!.pinned).toBe('left');
    expect(snap.columnGroupHeaders!.byField['a']).toBeDefined();
  });
});

// ── 11. Mixed flat + grouped input ────────────────────────────────────

describe('mixed flat and grouped input', () => {
  it('ungrouped columns have no group metadata', () => {
    const state = new GridState({
      columns: [
        leaf('standalone'),
        group('G', [leaf('grouped')], 'g'),
      ],
      rows: [],
    });
    const snap = state.getSnapshot();

    expect(snap.columns.map((c) => c.field)).toEqual(['standalone', 'grouped']);
    expect(snap.columnGroupHeaders!.byField['standalone']).toBeUndefined();
    expect(snap.columnGroupHeaders!.byField['grouped']).toBeDefined();
  });
});

// ── Visible-depth semantics ───────────────────────────────────────────

describe('visible-depth semantics', () => {
  it('depth is computed from visible grouped leaves only', () => {
    const state = new GridState({
      columns: [
        group('L0', [
          group('L1', [leaf('deep', { visible: false })], 'l1'),
          leaf('shallow'),
        ], 'l0'),
      ],
      rows: [],
    });
    const snap = state.getSnapshot();

    expect(snap.columns.map((c) => c.field)).toEqual(['shallow']);
    expect(snap.columnGroupHeaders!.depth).toBe(1);
  });

  it('columnGroupHeaders is undefined when all grouped leaves are hidden and only ungrouped visible', () => {
    const state = new GridState({
      columns: [
        group('G', [leaf('g1', { visible: false })], 'g'),
        leaf('flat_visible'),
      ],
      rows: [],
    });
    const snap = state.getSnapshot();

    expect(snap.columns.map((c) => c.field)).toEqual(['flat_visible']);
    expect(snap.columnGroupHeaders).toBeUndefined();
  });

  it('columnGroupHeaders is undefined when all grouped leaves are hidden', () => {
    const state = new GridState({
      columns: [
        group('G', [
          leaf('a', { visible: false }),
          leaf('b', { visible: false }),
        ], 'g'),
      ],
      rows: [],
    });
    const snap = state.getSnapshot();

    expect(snap.columns).toEqual([]);
    expect(snap.columnGroupHeaders).toBeUndefined();
  });

  it('depth updates when a deep leaf is hidden at runtime', () => {
    const state = new GridState({
      columns: [
        group('L0', [
          group('L1', [leaf('deep')], 'l1'),
          leaf('shallow'),
        ], 'l0'),
      ],
      rows: [],
    });

    expect(state.getSnapshot().columnGroupHeaders!.depth).toBe(2);

    state.setColumnVisible('deep', false);
    const snap = state.getSnapshot();
    expect(snap.columnGroupHeaders!.depth).toBe(1);
  });
});

// ── leafColumnCount ───────────────────────────────────────────────────

describe('leafColumnCount', () => {
  it('returns leaf count for grouped input', () => {
    const state = new GridState({
      columns: [
        group('G', [leaf('a'), leaf('b')], 'g'),
        leaf('c'),
      ],
      rows: [],
    });
    expect(state.leafColumnCount).toBe(3);
  });

  it('returns 0 when no columns', () => {
    const state = new GridState({ rows: [] });
    expect(state.leafColumnCount).toBe(0);
  });
});

// ── Display toggle (columnGroupHeaders config) ────────────────────────

describe('column group headers display toggle', () => {
  const groupedColumns = [
    group('G', [leaf('a'), leaf('b')], 'g'),
    leaf('c'),
  ];

  it('columnGroupHeaders: false suppresses snapshot without changing leaves', () => {
    const state = new GridState({
      columns: groupedColumns,
      rows: [],
      columnGroupHeaders: false,
    });
    const snap = state.getSnapshot();
    expect(snap.columns.map((c) => c.field)).toEqual(['a', 'b', 'c']);
    expect(snap.columnGroupHeaders).toBeUndefined();
    expect(state.leafColumnCount).toBe(3);
    expect(state.isColumnGroupHeadersEnabled()).toBe(false);
  });

  it('setColumnGroupHeaders restores and suppresses snapshot at runtime', () => {
    const state = new GridState({
      columns: groupedColumns,
      rows: [],
    });
    expect(state.getSnapshot().columnGroupHeaders?.depth).toBe(1);
    expect(state.isColumnGroupHeadersEnabled()).toBe(true);

    expect(state.setColumnGroupHeaders(false)).toBe(true);
    expect(state.setColumnGroupHeaders(false)).toBe(false);
    expect(state.getSnapshot().columnGroupHeaders).toBeUndefined();
    expect(state.getSnapshot().columns.map((c) => c.field)).toEqual([
      'a',
      'b',
      'c',
    ]);

    expect(state.setColumnGroupHeaders({ enabled: true })).toBe(true);
    expect(state.getSnapshot().columnGroupHeaders?.depth).toBe(1);
  });

  it('{ enabled: false } matches false', () => {
    const state = new GridState({
      columns: groupedColumns,
      rows: [],
      columnGroupHeaders: { enabled: false },
    });
    expect(state.isColumnGroupHeadersEnabled()).toBe(false);
    expect(state.getSnapshot().columnGroupHeaders).toBeUndefined();
  });
});
