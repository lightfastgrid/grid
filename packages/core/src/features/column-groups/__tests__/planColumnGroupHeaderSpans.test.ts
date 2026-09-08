import { describe, expect, it } from 'vitest';

import type {
  ColumnDef,
  ColumnGroupHeadersSnapshot,
  ColumnGroupPathMeta,
} from '../../../types';
import type { ColumnGroupHeaderLaneInput } from '../columnGroupHeaderTypes';
import {
  expectedPrefixEdgeCount,
  planColumnGroupHeaderSpans,
} from '../planColumnGroupHeaderSpans';

function col(field: string, width = 100): ColumnDef {
  return { field, width };
}

function prefixEdgesFromWidths(widths: readonly number[]): number[] {
  const edges = [0];
  for (const width of widths) {
    edges.push(edges[edges.length - 1]! + width);
  }
  return edges;
}

function meta(path: ColumnGroupPathMeta['path']): ColumnGroupPathMeta {
  return { path };
}

function snapshot(
  depth: number,
  byField: Record<string, ColumnGroupPathMeta>,
): ColumnGroupHeadersSnapshot {
  return { depth, byField };
}

function plan(input: ColumnGroupHeaderLaneInput) {
  return planColumnGroupHeaderSpans(input);
}

function spanAtLevel(result: ReturnType<typeof plan>, level: number) {
  return result.levels.find((entry) => entry.level === level)?.spans ?? [];
}

// ── 1. Flat / no snapshot ───────────────────────────────────────────

describe('planColumnGroupHeaderSpans', () => {
  it('returns empty plan when snapshot is missing', () => {
    const columns = [col('a'), col('b')];
    const result = plan({
      columns,
      prefixEdges: prefixEdgesFromWidths([100, 100]),
    });
    expect(result).toEqual({ depth: 0, levels: [] });
  });

  it('returns empty plan when depth is 0', () => {
    const result = plan({
      columns: [col('a')],
      columnGroupHeaders: snapshot(0, {}),
      prefixEdges: prefixEdgesFromWidths([100]),
    });
    expect(result).toEqual({ depth: 0, levels: [] });
  });

  // ── 2. One-level group spanning adjacent leaves ───────────────────

  it('plans one span for adjacent leaves sharing a top-level group', () => {
    const columns = [col('a', 80), col('b', 120)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/profile', headerName: 'Profile', level: 0 }]),
        b: meta([{ id: '/profile', headerName: 'Profile', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([80, 120]),
    });

    expect(result.depth).toBe(1);
    expect(spanAtLevel(result, 0)).toEqual([
      {
        key: '0:/profile:0',
        level: 0,
        headerName: 'Profile',
        startLeafIndex: 0,
        endLeafIndex: 1,
        left: 0,
        width: 200,
      },
    ]);
  });

  // ── 3. Two adjacent groups at same level ──────────────────────────

  it('plans separate spans for adjacent groups at the same level', () => {
    const columns = [col('a', 50), col('b', 50), col('c', 70), col('d', 30)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/profile', headerName: 'Profile', level: 0 }]),
        b: meta([{ id: '/profile', headerName: 'Profile', level: 0 }]),
        c: meta([{ id: '/finance', headerName: 'Finance', level: 0 }]),
        d: meta([{ id: '/finance', headerName: 'Finance', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([50, 50, 70, 30]),
    });

    const spans = spanAtLevel(result, 0);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({
      headerName: 'Profile',
      startLeafIndex: 0,
      endLeafIndex: 1,
      left: 0,
      width: 100,
    });
    expect(spans[1]).toMatchObject({
      headerName: 'Finance',
      startLeafIndex: 2,
      endLeafIndex: 3,
      left: 100,
      width: 100,
    });
  });

  // ── 4. Ungrouped leaf splits spans ────────────────────────────────

  it('splits spans when an ungrouped leaf sits between grouped leaves', () => {
    const columns = [col('a', 60), col('flat', 40), col('b', 60)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/g', headerName: 'G', level: 0 }]),
        b: meta([{ id: '/g', headerName: 'G', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([60, 40, 60]),
    });

    const spans = spanAtLevel(result, 0);
    expect(spans).toHaveLength(3);
    expect(spans[0]).toMatchObject({
      startLeafIndex: 0,
      endLeafIndex: 0,
      left: 0,
      width: 60,
    });
    expect(spans[1]).toMatchObject({
      key: 'gap:0:0',
      headerName: '',
      startLeafIndex: 1,
      endLeafIndex: 1,
      left: 60,
      width: 40,
    });
    expect(spans[2]).toMatchObject({
      startLeafIndex: 2,
      endLeafIndex: 2,
      left: 100,
      width: 60,
    });
  });

  it('plans gap fillers for ungrouped prefix columns before grouped leaves', () => {
    const columns = [col('sel', 44), col('act', 44), col('a', 80), col('b', 120)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/profile', headerName: 'Profile', level: 0 }]),
        b: meta([{ id: '/profile', headerName: 'Profile', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([44, 44, 80, 120]),
    });

    const spans = spanAtLevel(result, 0);
    expect(spans).toHaveLength(3);
    expect(spans[0]).toMatchObject({
      key: 'gap:0:0',
      headerName: '',
      startLeafIndex: 0,
      endLeafIndex: 0,
      left: 0,
      width: 44,
    });
    expect(spans[1]).toMatchObject({
      key: 'gap:0:1',
      headerName: '',
      startLeafIndex: 1,
      endLeafIndex: 1,
      left: 44,
      width: 44,
    });
    expect(spans[2]).toMatchObject({
      headerName: 'Profile',
      startLeafIndex: 2,
      endLeafIndex: 3,
      left: 88,
      width: 200,
    });
  });

  // ── 5. Nested groups ──────────────────────────────────────────────

  it('plans level 0 and level 1 spans for nested groups', () => {
    const columns = [col('deep', 90), col('deep2', 110)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(2, {
        deep: meta([
          { id: '/outer', headerName: 'Outer', level: 0 },
          { id: '/outer/inner', headerName: 'Inner', level: 1 },
        ]),
        deep2: meta([
          { id: '/outer', headerName: 'Outer', level: 0 },
          { id: '/outer/inner', headerName: 'Inner', level: 1 },
        ]),
      }),
      prefixEdges: prefixEdgesFromWidths([90, 110]),
    });

    expect(result.depth).toBe(2);
    expect(spanAtLevel(result, 0)).toEqual([
      {
        key: '0:/outer:0',
        level: 0,
        headerName: 'Outer',
        startLeafIndex: 0,
        endLeafIndex: 1,
        left: 0,
        width: 200,
      },
    ]);
    expect(spanAtLevel(result, 1)).toEqual([
      {
        key: '1:/outer/inner:0',
        level: 1,
        headerName: 'Inner',
        startLeafIndex: 0,
        endLeafIndex: 1,
        left: 0,
        width: 200,
      },
    ]);
  });

  // ── 6. Mixed-depth groups ─────────────────────────────────────────

  it('emits only top-level span for shallow leaves at deeper levels', () => {
    const columns = [col('shallow', 80), col('deep', 120)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(2, {
        shallow: meta([{ id: '/outer', headerName: 'Outer', level: 0 }]),
        deep: meta([
          { id: '/outer', headerName: 'Outer', level: 0 },
          { id: '/outer/inner', headerName: 'Inner', level: 1 },
        ]),
      }),
      prefixEdges: prefixEdgesFromWidths([80, 120]),
    });

    expect(spanAtLevel(result, 0)).toEqual([
      {
        key: '0:/outer:0',
        level: 0,
        headerName: 'Outer',
        startLeafIndex: 0,
        endLeafIndex: 1,
        left: 0,
        width: 200,
      },
    ]);
    expect(spanAtLevel(result, 1)).toEqual([
      {
        key: 'gap:1:0',
        level: 1,
        headerName: '',
        startLeafIndex: 0,
        endLeafIndex: 0,
        left: 0,
        width: 80,
      },
      {
        key: '1:/outer/inner:0',
        level: 1,
        headerName: 'Inner',
        startLeafIndex: 1,
        endLeafIndex: 1,
        left: 80,
        width: 120,
      },
    ]);
  });

  // ── 7. Duplicate labels, different ids ────────────────────────────

  it('does not merge spans with duplicate labels but different ids', () => {
    const columns = [col('a', 50), col('b', 50)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/parentA/details', headerName: 'Details', level: 0 }]),
        b: meta([{ id: '/parentB/details', headerName: 'Details', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([50, 50]),
    });

    const spans = spanAtLevel(result, 0);
    expect(spans).toHaveLength(2);
    expect(spans[0]!.headerName).toBe('Details');
    expect(spans[1]!.headerName).toBe('Details');
    expect(spans[0]!.key).not.toBe(spans[1]!.key);
  });

  // ── 8. Same groupId under different parents ───────────────────────

  it('does not merge parent-scoped ids with the same local groupId', () => {
    const columns = [col('a', 40), col('b', 40), col('c', 40), col('d', 40)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(2, {
        a: meta([
          { id: '/g1', headerName: 'G1', level: 0 },
          { id: '/g1/shared', headerName: 'Shared', level: 1 },
        ]),
        b: meta([
          { id: '/g1', headerName: 'G1', level: 0 },
          { id: '/g1/shared', headerName: 'Shared', level: 1 },
        ]),
        c: meta([
          { id: '/g2', headerName: 'G2', level: 0 },
          { id: '/g2/shared', headerName: 'Shared', level: 1 },
        ]),
        d: meta([
          { id: '/g2', headerName: 'G2', level: 0 },
          { id: '/g2/shared', headerName: 'Shared', level: 1 },
        ]),
      }),
      prefixEdges: prefixEdgesFromWidths([40, 40, 40, 40]),
    });

    const level1 = spanAtLevel(result, 1);
    expect(level1).toHaveLength(2);
    expect(level1[0]).toMatchObject({
      key: '1:/g1/shared:0',
      startLeafIndex: 0,
      endLeafIndex: 1,
    });
    expect(level1[1]).toMatchObject({
      key: '1:/g2/shared:1',
      startLeafIndex: 2,
      endLeafIndex: 3,
    });
  });

  // ── 9. Center window filters by intersection ──────────────────────

  it('includes only spans intersecting the center window with lane-local geometry', () => {
    const columns = [
      col('a', 50),
      col('b', 50),
      col('c', 50),
      col('d', 50),
    ];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/all', headerName: 'All', level: 0 }]),
        b: meta([{ id: '/all', headerName: 'All', level: 0 }]),
        c: meta([{ id: '/all', headerName: 'All', level: 0 }]),
        d: meta([{ id: '/all', headerName: 'All', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([50, 50, 50, 50]),
      centerWindow: { startCol: 1, endCol: 2 },
    });

    const spans = spanAtLevel(result, 0);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({
      key: '0:/all:0',
      level: 0,
      headerName: 'All',
      startLeafIndex: 0,
      endLeafIndex: 3,
      left: 0,
      width: 200,
    });
  });

  it('omits non-intersecting center-window spans entirely', () => {
    const columns = [col('a', 100), col('b', 100), col('c', 100)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/left', headerName: 'Left', level: 0 }]),
        b: meta([{ id: '/mid', headerName: 'Mid', level: 0 }]),
        c: meta([{ id: '/right', headerName: 'Right', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([100, 100, 100]),
      centerWindow: { startCol: 1, endCol: 1 },
    });

    const spans = spanAtLevel(result, 0);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      headerName: 'Mid',
      startLeafIndex: 1,
      endLeafIndex: 1,
      left: 100,
      width: 100,
    });
  });

  // ── 10. Pinned lane (no center window) ────────────────────────────

  it('plans all visible lane leaves when no center window is provided', () => {
    const columns = [col('a', 70), col('b', 30)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/pinned', headerName: 'Pinned', level: 0 }]),
        b: meta([{ id: '/pinned', headerName: 'Pinned', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([70, 30]),
    });

    expect(spanAtLevel(result, 0)).toEqual([
      {
        key: '0:/pinned:0',
        level: 0,
        headerName: 'Pinned',
        startLeafIndex: 0,
        endLeafIndex: 1,
        left: 0,
        width: 100,
      },
    ]);
  });

  // ── 11. Runtime hide closes or shrinks spans ──────────────────────

  it('shrinks spans when hidden grouped leaves are omitted by caller', () => {
    const columns = [col('a', 80), col('c', 120)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/g', headerName: 'G', level: 0 }]),
        c: meta([{ id: '/g', headerName: 'G', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([80, 120]),
    });

    expect(spanAtLevel(result, 0)).toEqual([
      {
        key: '0:/g:0',
        level: 0,
        headerName: 'G',
        startLeafIndex: 0,
        endLeafIndex: 1,
        left: 0,
        width: 200,
      },
    ]);
  });

  it('splits spans when hide leaves an ungrouped leaf between grouped leaves', () => {
    const columns = [col('a', 50), col('flat', 40), col('c', 50)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/g', headerName: 'G', level: 0 }]),
        c: meta([{ id: '/g', headerName: 'G', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([50, 40, 50]),
    });

    const spans = spanAtLevel(result, 0);
    expect(spans).toHaveLength(3);
    expect(spans[0]).toMatchObject({ startLeafIndex: 0, endLeafIndex: 0, width: 50 });
    expect(spans[1]).toMatchObject({
      key: 'gap:0:0',
      headerName: '',
      startLeafIndex: 1,
      endLeafIndex: 1,
      width: 40,
    });
    expect(spans[2]).toMatchObject({ startLeafIndex: 2, endLeafIndex: 2, width: 50 });
  });

  it('merges adjacent grouped leaves when a middle leaf is hidden by caller', () => {
    const columns = [col('a', 50), col('c', 50)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/g', headerName: 'G', level: 0 }]),
        c: meta([{ id: '/g', headerName: 'G', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([50, 50]),
    });

    const spans = spanAtLevel(result, 0);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      startLeafIndex: 0,
      endLeafIndex: 1,
      left: 0,
      width: 100,
    });
  });

  // ── 12. Prefix edge width math ────────────────────────────────────

  it('derives left/width from variable prefix edges', () => {
    const columns = [col('a', 30), col('b', 70), col('c', 50)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/g', headerName: 'G', level: 0 }]),
        b: meta([{ id: '/g', headerName: 'G', level: 0 }]),
        c: meta([{ id: '/g', headerName: 'G', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([30, 70, 50]),
    });

    expect(spanAtLevel(result, 0)[0]).toMatchObject({
      left: 0,
      width: 150,
    });
  });

  it('derives partial-span geometry from prefix edges', () => {
    const columns = [col('a', 25), col('b', 75), col('c', 100)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        b: meta([{ id: '/only-b', headerName: 'Only B', level: 0 }]),
      }),
      prefixEdges: prefixEdgesFromWidths([25, 75, 100]),
    });

    const spans = spanAtLevel(result, 0);
    expect(spans).toHaveLength(3);
    expect(spans[0]).toMatchObject({
      key: 'gap:0:0',
      headerName: '',
      startLeafIndex: 0,
      endLeafIndex: 0,
      left: 0,
      width: 25,
    });
    expect(spans[1]).toMatchObject({
      startLeafIndex: 1,
      endLeafIndex: 1,
      left: 25,
      width: 75,
    });
    expect(spans[2]).toMatchObject({
      key: 'gap:0:1',
      headerName: '',
      startLeafIndex: 2,
      endLeafIndex: 2,
      left: 100,
      width: 100,
    });
  });

  // ── 13. Empty columns / prefix edges ──────────────────────────────

  it('returns empty plan for empty columns', () => {
    const result = plan({
      columns: [],
      columnGroupHeaders: snapshot(1, {}),
      prefixEdges: [0],
    });
    expect(result).toEqual({ depth: 0, levels: [] });
  });

  it('returns empty plan for empty prefix edges with empty columns', () => {
    const result = plan({
      columns: [],
      columnGroupHeaders: snapshot(2, {}),
      prefixEdges: [],
    });
    expect(result).toEqual({ depth: 0, levels: [] });
  });

  // ── 14. Invalid prefix edge length ────────────────────────────────

  it('returns empty plan when prefix edge length is invalid', () => {
    const columns = [col('a', 100), col('b', 100)];
    const result = plan({
      columns,
      columnGroupHeaders: snapshot(1, {
        a: meta([{ id: '/g', headerName: 'G', level: 0 }]),
        b: meta([{ id: '/g', headerName: 'G', level: 0 }]),
      }),
      prefixEdges: [0, 100],
    });
    expect(result).toEqual({ depth: 0, levels: [] });
  });

  it('documents expected prefix edge count helper', () => {
    expect(expectedPrefixEdgeCount(0)).toBe(1);
    expect(expectedPrefixEdgeCount(3)).toBe(4);
  });
});
