// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE,
  COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE,
  COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE,
  COLUMN_GROUP_HEADER_SPAN_ATTRIBUTE,
  COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE,
} from '../../../internal/columnGroupHeaderDomMetadata';
import type {
  ColumnDef,
  ColumnGroupHeadersSnapshot,
  ColumnGroupPathMeta,
} from '../../../types';
import type {
  DomGridFeatureContext,
  HeaderAddonSyncContext,
  HeaderLaneRefs,
} from '../../types';
import {
  columnGroupHeaderFeature,
  computeGroupHeaderAddonHeight,
  GROUP_HEADER_ROW_CLASS,
  GROUP_HEADER_SPAN_CLASS,
} from '../index';

function col(field: string, width = 100, pinned?: 'left' | 'right'): ColumnDef {
  return { field, width, headerName: field, ...(pinned ? { pinned } : {}) };
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

function prefixEdges(widths: readonly number[]): number[] {
  const edges = [0];
  for (const w of widths) edges.push(edges[edges.length - 1]! + w);
  return edges;
}

function makeLane(
  parent: HTMLElement,
  leafClass: string,
): { container: HTMLDivElement; leafRow: HTMLDivElement } {
  const container = parent as HTMLDivElement;
  const leafRow = document.createElement('div');
  leafRow.className = leafClass;
  container.appendChild(leafRow);
  return { container, leafRow };
}

describe('computeGroupHeaderAddonHeight', () => {
  it('returns depth * rowHeight and 0 for flat', () => {
    expect(computeGroupHeaderAddonHeight(0, 40)).toBe(0);
    expect(computeGroupHeaderAddonHeight(1, 40)).toBe(40);
    expect(computeGroupHeaderAddonHeight(2, 36)).toBe(72);
  });
});

describe('columnGroupHeaderFeature DOM', () => {
  let root: HTMLElement;
  let centerContainer: HTMLDivElement;
  let leftStack: HTMLDivElement;
  let rightStack: HTMLDivElement;
  let laneRefs: HeaderLaneRefs;
  let groupSnapshot: ColumnGroupHeadersSnapshot | undefined;
  let feature: ReturnType<typeof columnGroupHeaderFeature>;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);

    centerContainer = document.createElement('div');
    centerContainer.className = 'lfg-header';
    root.appendChild(centerContainer);
    const center = makeLane(centerContainer, 'lfg-header-row');

    leftStack = document.createElement('div');
    leftStack.className = 'lfg-pinned-header-stack lfg-pinned-left-header-stack';
    root.appendChild(leftStack);
    const left = makeLane(leftStack, 'lfg-pinned-header-row');

    rightStack = document.createElement('div');
    rightStack.className = 'lfg-pinned-header-stack lfg-pinned-right-header-stack';
    root.appendChild(rightStack);
    const right = makeLane(rightStack, 'lfg-pinned-header-row');

    laneRefs = {
      center: { container: center.container, leafRow: center.leafRow },
      left: { container: left.container, leafRow: left.leafRow },
      right: { container: right.container, leafRow: right.leafRow },
    };
    groupSnapshot = undefined;
    feature = columnGroupHeaderFeature();
  });

  afterEach(() => {
    feature.detach();
    root.remove();
  });

  function attachCtx(): DomGridFeatureContext {
    const ctx: DomGridFeatureContext = {
      root,
      surface: root,
      viewport: root,
      getPool: () => [],
      getColumns: () => [],
      getDisplayRows: () => ({
        rowCount: 0,
        getRow: () => null,
        getRowData: () => undefined,
        getSourceIndex: () => -1,
      }),
      getSourceRows: () => [],
      getVisibleRowStart: () => 0,
      requestSync: () => {},
      requestColumnTransformSync: () => {},
      resolveRowId: (_row, idx) => String(idx),
      getHeaderRowEl: () => laneRefs.center.leafRow,
      getPinnedHeaderRowEl: () => laneRefs.left?.leafRow ?? null,
      getPinnedRightHeaderRowEl: () => laneRefs.right?.leafRow ?? null,
      getHeaderLaneRefs: () => laneRefs,
      getColumnGroupHeaders: () => groupSnapshot,
      getDataRevision: () => 1,
      getSelectedColumnIdsForColumnOrder: () => [],
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      getSortModel: () => [],
      toggleColumnSort: () => {},
      setColumnSort: () => {},
      pinColumn: () => {},
      layoutMetrics: { rowHeight: 40, headerHeight: 40 },
    };
    feature.attach(ctx);
    return ctx;
  }

  function syncBag(overrides?: Partial<HeaderAddonSyncContext>): void {
    const centerCols = [col('a', 80), col('b', 120)];
    const ctx: HeaderAddonSyncContext = {
      centerWindow: { startCol: 0, endCol: 1 },
      lanes: {
        left: null,
        center: {
          columns: centerCols,
          prefixEdges: prefixEdges([80, 120]),
          containerOffsetX: 0,
        },
        right: null,
      },
      headerLaneRefs: {
        center: laneRefs.center,
        left: null,
        right: null,
      },
      layoutVersion: 1,
      ...overrides,
    };
    feature.syncHeaderAddon(ctx);
  }

  it('flat columns: no group rows and addon height 0', () => {
    groupSnapshot = undefined;
    attachCtx();
    expect(feature.getHeaderAddonHeight()).toBe(0);
    syncBag();
    expect(root.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)).toBeNull();
  });

  it('one-level center group: visible label and correct left/width', () => {
    groupSnapshot = snapshot(1, {
      a: meta([{ id: '/profile', headerName: 'Profile', level: 0 }]),
      b: meta([{ id: '/profile', headerName: 'Profile', level: 0 }]),
    });
    attachCtx();
    expect(feature.getHeaderAddonHeight()).toBe(40);

    syncBag();

    const rows = centerContainer.querySelectorAll(`.${GROUP_HEADER_ROW_CLASS}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nextElementSibling).toBe(laneRefs.center.leafRow);

    const span = rows[0]!.querySelector(`.${GROUP_HEADER_SPAN_CLASS}`) as HTMLDivElement;
    expect(span).toBeTruthy();
    expect(span.textContent).toBe('Profile');
    expect(span.style.left).toBe('0px');
    expect(span.style.width).toBe('200px');
    expect(rows[0]!.getAttribute(COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE)).toBe(
      '0',
    );
    expect(span.hasAttribute(COLUMN_GROUP_HEADER_SPAN_ATTRIBUTE)).toBe(true);
    expect(span.getAttribute(COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE)).toBe(
      'a',
    );
    expect(span.getAttribute(COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE)).toBe(
      'b',
    );
    expect(span.getAttribute(COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE)).toBe(
      '2',
    );
  });

  it('applies containerOffsetX to center span left at DOM bind', () => {
    groupSnapshot = snapshot(1, {
      a: meta([{ id: '/profile', headerName: 'Profile', level: 0 }]),
      b: meta([{ id: '/profile', headerName: 'Profile', level: 0 }]),
    });
    attachCtx();
    syncBag({
      lanes: {
        left: null,
        center: {
          columns: [col('a', 80), col('b', 120)],
          prefixEdges: prefixEdges([80, 120]),
          containerOffsetX: 44,
        },
        right: null,
      },
    });

    const span = centerContainer.querySelector(
      `.${GROUP_HEADER_SPAN_CLASS}`,
    ) as HTMLDivElement;
    expect(span.style.left).toBe('44px');
    expect(span.style.width).toBe('200px');
  });

  it('nested groups: rows appear top-to-bottom by level', () => {
    groupSnapshot = snapshot(2, {
      a: meta([
        { id: '/all', headerName: 'All', level: 0 },
        { id: '/all/profile', headerName: 'Profile', level: 1 },
      ]),
      b: meta([
        { id: '/all', headerName: 'All', level: 0 },
        { id: '/all/profile', headerName: 'Profile', level: 1 },
      ]),
    });
    attachCtx();
    expect(feature.getHeaderAddonHeight()).toBe(80);
    syncBag();

    const rows = Array.from(
      centerContainer.querySelectorAll(`.${GROUP_HEADER_ROW_CLASS}`),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute('data-level')).toBe('0');
    expect(rows[1]!.getAttribute('data-level')).toBe('1');
    expect(rows[0]!.nextElementSibling).toBe(rows[1]!);
    expect(rows[1]!.nextElementSibling).toBe(laneRefs.center.leafRow);

    expect(rows[0]!.querySelector(`.${GROUP_HEADER_SPAN_CLASS}`)?.textContent).toBe(
      'All',
    );
    expect(rows[1]!.querySelector(`.${GROUP_HEADER_SPAN_CLASS}`)?.textContent).toBe(
      'Profile',
    );
  });

  it('clears stale spans/rows when groups become flat or depth decreases', () => {
    groupSnapshot = snapshot(2, {
      a: meta([
        { id: '/all', headerName: 'All', level: 0 },
        { id: '/all/profile', headerName: 'Profile', level: 1 },
      ]),
      b: meta([
        { id: '/all', headerName: 'All', level: 0 },
        { id: '/all/profile', headerName: 'Profile', level: 1 },
      ]),
    });
    attachCtx();
    syncBag();
    expect(centerContainer.querySelectorAll(`.${GROUP_HEADER_ROW_CLASS}`)).toHaveLength(
      2,
    );

    groupSnapshot = snapshot(1, {
      a: meta([{ id: '/profile', headerName: 'Profile', level: 0 }]),
      b: meta([{ id: '/profile', headerName: 'Profile', level: 0 }]),
    });
    syncBag();
    expect(centerContainer.querySelectorAll(`.${GROUP_HEADER_ROW_CLASS}`)).toHaveLength(
      1,
    );
    expect(feature.getHeaderAddonHeight()).toBe(40);

    groupSnapshot = undefined;
    syncBag();
    expect(centerContainer.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)).toBeNull();
    expect(feature.getHeaderAddonHeight()).toBe(0);
  });

  it('pinned left and right use their own stacks and lane-local geometry', () => {
    groupSnapshot = snapshot(1, {
      leftA: meta([{ id: '/left', headerName: 'LeftGrp', level: 0 }]),
      leftB: meta([{ id: '/left', headerName: 'LeftGrp', level: 0 }]),
      center: meta([{ id: '/center', headerName: 'CenterGrp', level: 0 }]),
      rightA: meta([{ id: '/right', headerName: 'RightGrp', level: 0 }]),
    });
    attachCtx();

    const leftCols = [col('leftA', 50, 'left'), col('leftB', 70, 'left')];
    const centerCols = [col('center', 100)];
    const rightCols = [col('rightA', 90, 'right')];

    feature.syncHeaderAddon({
      centerWindow: { startCol: 0, endCol: 0 },
      lanes: {
        left: {
          columns: leftCols,
          prefixEdges: prefixEdges([50, 70]),
          containerOffsetX: 0,
        },
        center: {
          columns: centerCols,
          prefixEdges: prefixEdges([100]),
          containerOffsetX: 120,
        },
        right: {
          columns: rightCols,
          prefixEdges: prefixEdges([90]),
          containerOffsetX: 0,
        },
      },
      headerLaneRefs: laneRefs,
      layoutVersion: 1,
    });

    const leftSpan = leftStack.querySelector(
      `.${GROUP_HEADER_SPAN_CLASS}`,
    ) as HTMLDivElement;
    expect(leftSpan.textContent).toBe('LeftGrp');
    expect(leftSpan.style.left).toBe('0px');
    expect(leftSpan.style.width).toBe('120px');
    expect(leftStack.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)!.nextElementSibling).toBe(
      laneRefs.left!.leafRow,
    );

    const centerSpan = centerContainer.querySelector(
      `.${GROUP_HEADER_SPAN_CLASS}`,
    ) as HTMLDivElement;
    expect(centerSpan.textContent).toBe('CenterGrp');
    expect(centerSpan.style.left).toBe('120px');
    expect(centerSpan.style.width).toBe('100px');

    const rightSpan = rightStack.querySelector(
      `.${GROUP_HEADER_SPAN_CLASS}`,
    ) as HTMLDivElement;
    expect(rightSpan.textContent).toBe('RightGrp');
    expect(rightSpan.style.width).toBe('90px');
    expect(
      rightStack.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)!.nextElementSibling,
    ).toBe(laneRefs.right!.leafRow);
  });

  it('retains empty center owner rows when every grouped leaf is pinned', () => {
    groupSnapshot = snapshot(1, {
      leftA: meta([{ id: '/left', headerName: 'LeftGrp', level: 0 }]),
    });
    attachCtx();

    feature.syncHeaderAddon({
      centerWindow: { startCol: 0, endCol: -1 },
      lanes: {
        left: {
          columns: [col('leftA', 80, 'left')],
          prefixEdges: prefixEdges([80]),
          containerOffsetX: 0,
        },
        center: {
          columns: [],
          prefixEdges: prefixEdges([]),
          containerOffsetX: 80,
        },
        right: null,
      },
      headerLaneRefs: {
        center: laneRefs.center,
        left: laneRefs.left,
        right: null,
      },
      layoutVersion: 1,
    });

    const centerRows = centerContainer.querySelectorAll(
      `.${GROUP_HEADER_ROW_CLASS}`,
    );
    expect(centerRows).toHaveLength(1);
    expect(centerRows[0]!.childElementCount).toBe(0);
    expect(centerRows[0]!.nextElementSibling).toBe(laneRefs.center.leafRow);
  });

  it('pinned boundary split produces independent spans', () => {
    // Same group id on left + center leaves — planner runs per lane, so two spans.
    groupSnapshot = snapshot(1, {
      leftA: meta([{ id: '/shared', headerName: 'Shared', level: 0 }]),
      centerA: meta([{ id: '/shared', headerName: 'Shared', level: 0 }]),
      centerB: meta([{ id: '/shared', headerName: 'Shared', level: 0 }]),
    });
    attachCtx();

    feature.syncHeaderAddon({
      centerWindow: { startCol: 0, endCol: 1 },
      lanes: {
        left: {
          columns: [col('leftA', 60, 'left')],
          prefixEdges: prefixEdges([60]),
          containerOffsetX: 0,
        },
        center: {
          columns: [col('centerA', 80), col('centerB', 80)],
          prefixEdges: prefixEdges([80, 80]),
          containerOffsetX: 60,
        },
        right: null,
      },
      headerLaneRefs: {
        center: laneRefs.center,
        left: laneRefs.left,
        right: null,
      },
      layoutVersion: 1,
    });

    const leftSpans = leftStack.querySelectorAll(`.${GROUP_HEADER_SPAN_CLASS}`);
    const centerSpans = centerContainer.querySelectorAll(`.${GROUP_HEADER_SPAN_CLASS}`);
    expect(leftSpans).toHaveLength(1);
    expect(centerSpans).toHaveLength(1);
    expect((leftSpans[0] as HTMLElement).style.width).toBe('60px');
    expect((centerSpans[0] as HTMLElement).style.left).toBe('60px');
    expect((centerSpans[0] as HTMLElement).style.width).toBe('160px');
    expect(leftSpans[0]!.textContent).toBe('Shared');
    expect(centerSpans[0]!.textContent).toBe('Shared');
  });

  it('detach removes only feature-owned group rows', () => {
    groupSnapshot = snapshot(1, {
      a: meta([{ id: '/p', headerName: 'P', level: 0 }]),
      b: meta([{ id: '/p', headerName: 'P', level: 0 }]),
    });
    attachCtx();
    syncBag();
    expect(centerContainer.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)).toBeTruthy();
    expect(laneRefs.center.leafRow.isConnected).toBe(true);

    feature.detach();
    expect(centerContainer.querySelector(`.${GROUP_HEADER_ROW_CLASS}`)).toBeNull();
    expect(laneRefs.center.leafRow.isConnected).toBe(true);
  });
});
