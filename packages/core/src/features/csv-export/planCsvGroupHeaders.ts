/**
 * CSV Export V1 - pure group-header planner (Stage 1).
 *
 * Derives group-header rows purely from `groupMetaByField` and the planned
 * column order. Never inspects DOM or renderer state. One row is produced per
 * group depth (level 0 = topmost). Within a row, adjacent planned columns that
 * share the same group node (by full ancestry identity) form one contiguous
 * run; visibility, pinning, selection, and explicit field order naturally
 * split a source group into multiple runs. The synthetic row-number column and
 * any ungrouped leaf are empty spacers that break runs.
 *
 * Each emitted run retains groupId, headerName, level, covered fields, and span
 * so Stage 2 can invoke `processGroupHeader` exactly once per run.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 11.
 */

import type { ColumnGroupPathSegment } from "../../types";

import type { CsvExportSnapshot } from "./csvExportSnapshot";
import type { CsvPlannedColumn } from "./planCsvColumnScope";

/** One emitted contiguous group run at a given level. */
export interface CsvGroupHeaderRun {
  groupId: string;
  headerName: string;
  level: number;
  /** Covered leaf fields, left to right. */
  fields: readonly string[];
}

/**
 * One segment of a group-header row. A run segment carries the group label and
 * spans `span` planned columns; a spacer segment (`run: null`) is one empty
 * cell for an ungrouped leaf, the row-number column, or a gap.
 */
export interface CsvGroupHeaderSegment {
  run: CsvGroupHeaderRun | null;
  /** Index of the first covered planned column. */
  startColumnIndex: number;
  /** Number of planned columns covered (spacer span is always 1). */
  span: number;
}

/** One group-header row for a single depth level. */
export interface CsvGroupHeaderRow {
  level: number;
  segments: readonly CsvGroupHeaderSegment[];
}

export interface CsvGroupHeaderPlan {
  /** Group rows, top level first. Empty when no rows are emitted. */
  rows: readonly CsvGroupHeaderRow[];
}

const EMPTY_PLAN: CsvGroupHeaderPlan = { rows: [] };

function pathFor(
  column: CsvPlannedColumn,
  snapshot: CsvExportSnapshot,
): readonly ColumnGroupPathSegment[] {
  if (column.kind !== "data") return [];
  return snapshot.groupMetaByField[column.field]?.path ?? [];
}

/** Ancestry identity through `level`; distinguishes same-id nodes under different parents. */
function runKeyAt(
  path: readonly ColumnGroupPathSegment[],
  level: number,
): string | null {
  if (path.length <= level) return null;
  let key = "";
  for (let l = 0; l <= level; l++) key += JSON.stringify(path[l]!.id) + "\u0000";
  return key;
}

function buildRow(
  level: number,
  plannedColumns: readonly CsvPlannedColumn[],
  paths: readonly (readonly ColumnGroupPathSegment[])[],
): CsvGroupHeaderRow {
  const segments: CsvGroupHeaderSegment[] = [];
  let i = 0;
  while (i < plannedColumns.length) {
    const key = runKeyAt(paths[i]!, level);
    if (key === null) {
      segments.push({ run: null, startColumnIndex: i, span: 1 });
      i++;
      continue;
    }
    // Extend the contiguous run while the ancestry key matches.
    const start = i;
    const fields: string[] = [];
    const segment = paths[i]![level]!;
    while (i < plannedColumns.length && runKeyAt(paths[i]!, level) === key) {
      const column = plannedColumns[i]!;
      if (column.kind === "data") fields.push(column.field);
      i++;
    }
    segments.push({
      run: {
        groupId: segment.id,
        headerName: segment.headerName,
        level,
        fields,
      },
      startColumnIndex: start,
      span: i - start,
    });
  }
  return { level, segments };
}

/**
 * Plan group-header rows for the planned columns.
 *
 * Tri-state `includeColumnGroupHeaders`: `undefined` follows the captured
 * `groupHeaderDisplayEnabled` state; `true` forces structural headers even when
 * on-screen group rows are suppressed; `false` always omits them. Flat columns
 * (no group depth) produce no rows.
 */
export function planCsvGroupHeaders(
  snapshot: CsvExportSnapshot,
  plannedColumns: readonly CsvPlannedColumn[],
  includeColumnGroupHeaders: boolean | undefined,
): CsvGroupHeaderPlan {
  const emit =
    includeColumnGroupHeaders === undefined
      ? snapshot.groupHeaderDisplayEnabled
      : includeColumnGroupHeaders;
  if (!emit) return EMPTY_PLAN;

  const paths = plannedColumns.map((column) => pathFor(column, snapshot));
  let depth = 0;
  for (const path of paths) depth = Math.max(depth, path.length);
  if (depth === 0) return EMPTY_PLAN;

  const rows: CsvGroupHeaderRow[] = [];
  for (let level = 0; level < depth; level++) {
    rows.push(buildRow(level, plannedColumns, paths));
  }
  return { rows };
}
