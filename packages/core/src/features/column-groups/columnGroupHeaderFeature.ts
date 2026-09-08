/**
 * Column group header DOM feature — display-only group rows above leaf headers.
 *
 * Implements DomGridFeature + HeaderAddonCapability. Uses Phase 3A lane refs
 * and the generic header-addon sync bag; owns only group row/span DOM.
 */

import { DEFAULT_GRID_LAYOUT_METRICS } from '../../layout/gridLayoutMetrics';
import type { ColumnGroupHeadersSnapshot } from '../../types';
import type {
  DomGridFeature,
  DomGridFeatureContext,
  HeaderAddonCapability,
  HeaderAddonLaneGeometry,
  HeaderAddonSyncContext,
  HeaderLaneRef,
} from '../types';

import {
  detachGroupHeaderLanePool,
  emptyGroupHeaderLanePool,
  ensureGroupHeaderLaneRows,
} from './columnGroupHeaderDom';
import type { GroupHeaderLanePool } from './columnGroupHeaderTypes';
import type { ColumnGroupHeaderSpanPlan } from './columnGroupHeaderTypes';
import { planColumnGroupHeaderSpans } from './planColumnGroupHeaderSpans';
import { syncGroupHeaderRows } from './syncGroupHeaderRows';

export function computeGroupHeaderAddonHeight(
  depth: number,
  rowHeight: number,
): number {
  if (depth <= 0 || rowHeight <= 0) return 0;
  return depth * rowHeight;
}

function syncLane(
  lanePool: GroupHeaderLanePool,
  laneRef: HeaderLaneRef | null | undefined,
  geometry: HeaderAddonLaneGeometry | null | undefined,
  snapshot: ColumnGroupHeadersSnapshot | undefined,
  centerWindow?: { startCol: number; endCol: number },
  preserveEmptyRows = false,
): void {
  if (!laneRef || !geometry || !snapshot || snapshot.depth <= 0) {
    detachGroupHeaderLanePool(lanePool);
    return;
  }

  const plan = planColumnGroupHeaderSpans({
    columns: geometry.columns,
    columnGroupHeaders: snapshot,
    prefixEdges: geometry.prefixEdges,
    centerWindow,
  });

  if (plan.depth <= 0) {
    if (
      preserveEmptyRows &&
      snapshot.depth > 0 &&
      geometry.columns.length === 0
    ) {
      const emptyPlan: ColumnGroupHeaderSpanPlan = {
        depth: snapshot.depth,
        levels: Array.from({ length: snapshot.depth }, (_, level) => ({
          level,
          spans: [],
        })),
      };
      ensureGroupHeaderLaneRows(lanePool, laneRef, emptyPlan.depth);
      syncGroupHeaderRows(
        lanePool,
        emptyPlan,
        geometry.columns,
        geometry.containerOffsetX,
      );
      return;
    }
    detachGroupHeaderLanePool(lanePool);
    return;
  }

  ensureGroupHeaderLaneRows(lanePool, laneRef, plan.depth);
  syncGroupHeaderRows(
    lanePool,
    plan,
    geometry.columns,
    geometry.containerOffsetX,
  );
}

export type ColumnGroupHeaderFeature = DomGridFeature & HeaderAddonCapability;

export function columnGroupHeaderFeature(): ColumnGroupHeaderFeature {
  let ctx: DomGridFeatureContext | null = null;
  const centerPool = emptyGroupHeaderLanePool();
  const leftPool = emptyGroupHeaderLanePool();
  const rightPool = emptyGroupHeaderLanePool();

  function clearAllLanes(): void {
    detachGroupHeaderLanePool(centerPool);
    detachGroupHeaderLanePool(leftPool);
    detachGroupHeaderLanePool(rightPool);
  }

  return {
    name: 'column-group-headers',

    attach(featureCtx: DomGridFeatureContext): void {
      clearAllLanes();
      ctx = featureCtx;
    },

    detach(): void {
      clearAllLanes();
      ctx = null;
    },

    getHeaderAddonHeight(): number {
      if (!ctx) return 0;
      const snapshot = ctx.getColumnGroupHeaders?.();
      const depth = snapshot?.depth ?? 0;
      const rowHeight =
        ctx.layoutMetrics?.headerHeight ?? DEFAULT_GRID_LAYOUT_METRICS.headerHeight;
      return computeGroupHeaderAddonHeight(depth, rowHeight);
    },

    syncHeaderAddon(context: HeaderAddonSyncContext): void {
      if (!ctx) return;
      const snapshot = ctx.getColumnGroupHeaders?.();
      const refs = context.headerLaneRefs;

      syncLane(
        centerPool,
        refs.center,
        context.lanes.center,
        snapshot,
        context.centerWindow,
        true,
      );
      syncLane(leftPool, refs.left, context.lanes.left, snapshot);
      syncLane(rightPool, refs.right, context.lanes.right, snapshot);
    },
  };
}
