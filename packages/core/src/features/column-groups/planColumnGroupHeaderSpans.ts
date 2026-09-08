/**
 * Pure planner: visible lane columns + group metadata + prefix edges → spans.
 *
 * No DOM reads/writes. Geometry is lane-local via prefix edge subtraction.
 * See COLUMN_GROUP_HEADERS_V1_ARCHITECTURE.md §3.
 */

import type { ColumnGroupPathSegment } from '../../types';

import type {
  ColumnGroupHeaderLaneInput,
  ColumnGroupHeaderSpanPlan,
  PlannedColumnGroupSpan,
} from './columnGroupHeaderTypes';

/** Expected prefix edge count for a lane with `columnCount` visible leaves. */
export function expectedPrefixEdgeCount(columnCount: number): number {
  return columnCount + 1;
}

function emptyPlan(): ColumnGroupHeaderSpanPlan {
  return { depth: 0, levels: [] };
}

function segmentAtLevel(
  path: readonly ColumnGroupPathSegment[] | undefined,
  level: number,
): ColumnGroupPathSegment | null {
  if (!path || level >= path.length) return null;
  return path[level] ?? null;
}

function spansWindow(
  startLeafIndex: number,
  endLeafIndex: number,
  windowStart: number,
  windowEnd: number,
): boolean {
  return startLeafIndex <= windowEnd && endLeafIndex >= windowStart;
}

function spanGeometry(
  prefixEdges: Float64Array | readonly number[],
  startLeafIndex: number,
  endLeafIndex: number,
): { left: number; width: number } {
  const left = prefixEdges[startLeafIndex] ?? 0;
  const right = prefixEdges[endLeafIndex + 1] ?? left;
  return { left, width: right - left };
}

function planGroupSpans(
  input: ColumnGroupHeaderLaneInput,
  level: number,
): PlannedColumnGroupSpan[] {
  const { columns, columnGroupHeaders, prefixEdges, centerWindow } = input;
  const byField = columnGroupHeaders?.byField;
  if (!byField) return [];

  const spans: PlannedColumnGroupSpan[] = [];
  const columnCount = columns.length;
  let runStart = -1;
  let runSegment: ColumnGroupPathSegment | null = null;
  let runIndex = 0;

  const finishRun = (runEnd: number): void => {
    if (runSegment === null || runStart < 0) return;

    if (
      centerWindow !== undefined
      && !spansWindow(runStart, runEnd, centerWindow.startCol, centerWindow.endCol)
    ) {
      runIndex++;
      runStart = -1;
      runSegment = null;
      return;
    }

    const { left, width } = spanGeometry(prefixEdges, runStart, runEnd);
    spans.push({
      key: `${level}:${runSegment.id}:${runIndex}`,
      level,
      headerName: runSegment.headerName,
      startLeafIndex: runStart,
      endLeafIndex: runEnd,
      left,
      width,
    });
    runIndex++;
    runStart = -1;
    runSegment = null;
  };

  for (let leafIndex = 0; leafIndex <= columnCount; leafIndex++) {
    const segment =
      leafIndex < columnCount
        ? segmentAtLevel(byField[columns[leafIndex]!.field]?.path, level)
        : null;

    const sameRun =
      runSegment !== null
      && segment !== null
      && segment.id === runSegment.id;

    if (!sameRun) {
      if (runSegment !== null) {
        finishRun(leafIndex - 1);
      }
      if (segment !== null) {
        runStart = leafIndex;
        runSegment = segment;
      }
    }
  }

  return spans;
}

/** Filler spans for leaf columns not covered by a group label at this level. */
function planGapSpans(
  input: ColumnGroupHeaderLaneInput,
  level: number,
  groupSpans: readonly PlannedColumnGroupSpan[],
): PlannedColumnGroupSpan[] {
  const { prefixEdges, centerWindow } = input;
  const columnCount = input.columns.length;
  const covered = new Uint8Array(columnCount);
  for (const span of groupSpans) {
    for (let i = span.startLeafIndex; i <= span.endLeafIndex; i++) {
      covered[i] = 1;
    }
  }

  const gaps: PlannedColumnGroupSpan[] = [];
  let gapIndex = 0;

  for (let leafIndex = 0; leafIndex < columnCount; leafIndex++) {
    if (covered[leafIndex]) continue;
    if (
      centerWindow !== undefined
      && !spansWindow(leafIndex, leafIndex, centerWindow.startCol, centerWindow.endCol)
    ) {
      continue;
    }
    const { left, width } = spanGeometry(prefixEdges, leafIndex, leafIndex);
    gaps.push({
      key: `gap:${level}:${gapIndex}`,
      level,
      headerName: '',
      startLeafIndex: leafIndex,
      endLeafIndex: leafIndex,
      left,
      width,
    });
    gapIndex++;
  }

  return gaps;
}

function planLevelSpans(
  input: ColumnGroupHeaderLaneInput,
  level: number,
): PlannedColumnGroupSpan[] {
  const groupSpans = planGroupSpans(input, level);
  const gapSpans = planGapSpans(input, level, groupSpans);
  return [...gapSpans, ...groupSpans].sort(
    (a, b) => a.startLeafIndex - b.startLeafIndex,
  );
}

/**
 * Plan group header spans for one lane.
 *
 * Uses the snapshot's global `depth` so header rows stay aligned across lanes.
 * Returns an empty plan when there is no group snapshot, depth is 0,
 * columns are empty, or prefix edges length is invalid.
 */
export function planColumnGroupHeaderSpans(
  input: ColumnGroupHeaderLaneInput,
): ColumnGroupHeaderSpanPlan {
  const { columns, columnGroupHeaders, prefixEdges } = input;
  const depth = columnGroupHeaders?.depth ?? 0;

  if (depth === 0 || columns.length === 0) {
    return emptyPlan();
  }

  if (prefixEdges.length !== expectedPrefixEdgeCount(columns.length)) {
    return emptyPlan();
  }

  const levels = [];
  for (let level = 0; level < depth; level++) {
    const spans = planLevelSpans(input, level);
    levels.push({ level, spans });
  }

  return { depth, levels };
}
