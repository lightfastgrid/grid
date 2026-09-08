/**
 * Internal planner types for column group header span planning.
 *
 * Pure data shapes — no DOM. See COLUMN_GROUP_HEADERS_V1_ARCHITECTURE.md §3.
 */

import type { ColumnDef, ColumnGroupHeadersSnapshot } from '../../types';

/** Inclusive center-lane virtualization window over lane-local leaf indexes. */
export interface ColumnGroupHeaderCenterWindow {
  startCol: number;
  endCol: number;
}

/** Per-lane input to the group header span planner. */
export interface ColumnGroupHeaderLaneInput {
  /** Visible leaf columns in lane-local order. */
  columns: readonly ColumnDef[];
  /** Derived group header snapshot for visible leaves. */
  columnGroupHeaders?: ColumnGroupHeadersSnapshot;
  /**
   * Cumulative lane-local prefix edges.
   * `prefixEdges[i]` = sum of widths of columns `0..i-1`.
   * Length must equal `columns.length + 1`.
   */
  prefixEdges: Float64Array | readonly number[];
  /**
   * Center lane only: inclusive leaf index range currently visible.
   * When omitted, all planned spans are included.
   */
  centerWindow?: ColumnGroupHeaderCenterWindow;
}

/** One planned group header cell span within a lane. */
export interface PlannedColumnGroupSpan {
  /** Stable identity for DOM reuse/diff (level + segment id + run index). */
  key: string;
  /** 0 = topmost group row. */
  level: number;
  /** Display label from the group segment. */
  headerName: string;
  /** Inclusive start leaf index within the lane's visible column list. */
  startLeafIndex: number;
  /** Inclusive end leaf index within the lane's visible column list. */
  endLeafIndex: number;
  /** Left offset in lane-local coordinates (px). */
  left: number;
  /** Width in lane-local coordinates (px). */
  width: number;
}

/** Spans planned for one group header level within a lane. */
export interface ColumnGroupHeaderLevelPlan {
  level: number;
  spans: PlannedColumnGroupSpan[];
}

/** Full per-lane group header span plan. */
export interface ColumnGroupHeaderSpanPlan {
  /**
   * Global snapshot depth (same value across lanes for aligned header rows).
   * Not recomputed from this lane's leaves. 0 = no group rows.
   */
  depth: number;
  /**
   * Level plans ordered from topmost (level 0) downward through `depth - 1`.
   * Deeper levels may have empty `spans` when this lane has no grouped leaves at that level.
   */
  levels: ColumnGroupHeaderLevelPlan[];
}

/** Pooled DOM for one group-header level within a lane. */
export interface GroupHeaderLevelPool {
  level: number;
  rowEl: HTMLDivElement;
  spanPool: HTMLDivElement[];
}

/** Per-lane pooled group-header rows (feature-owned only). */
export interface GroupHeaderLanePool {
  levels: GroupHeaderLevelPool[];
}

/** CSS class names owned by the column-group header feature. */
export const GROUP_HEADER_ROW_CLASS = 'lfg-group-header-row';
export const GROUP_HEADER_SPAN_CLASS = 'lfg-group-header-span';
/** Display-only filler for ungrouped utility columns (selection / actions). */
export const GROUP_HEADER_GAP_SPAN_CLASS = 'lfg-group-header-span-gap';
