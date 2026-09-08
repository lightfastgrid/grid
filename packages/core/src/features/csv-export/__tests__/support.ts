/**
 * Shared test doubles for the CSV export planners (Stage 1).
 * Not a test file (no `.test.ts` suffix); only imported by the planner tests.
 */

import type { RowView } from "../../../row-model/rowOrder";
import type {
  ColumnDef,
  ColumnGroupPathMeta,
  RowData,
  RowPinPosition,
} from "../../../types";
import type {
  CsvColumnSelectionReadSnapshot,
  CsvExportSnapshot,
  CsvRowIdResolver,
  CsvRowPinReadSnapshot,
  CsvSelectionReadSnapshot,
} from "../csvExportSnapshot";
import type { CsvRowPlan } from "../planCsvRowScope";

/** RowView double. `order[displayIndex] = sourceIndex`. */
export function makeRowView(
  order: readonly number[],
  rows: readonly RowData[],
  opts: { throwOnGetRow?: boolean } = {},
): RowView {
  return {
    generation: 1,
    rows: rows as RowData[],
    rowCount: order.length,
    getSourceIndex(displayIndex: number): number {
      return displayIndex >= 0 && displayIndex < order.length
        ? order[displayIndex]!
        : -1;
    },
    getRow(displayIndex: number): RowData | undefined {
      if (opts.throwOnGetRow) {
        throw new Error("getRow must not be called by the row planner");
      }
      const si = this.getSourceIndex(displayIndex);
      return si < 0 ? undefined : rows[si];
    },
  };
}

export interface RowViewCallCounts {
  getSourceIndex: number;
  getRow: number;
}

/** RowView double that counts accessor calls (for no-scan-at-construction proofs). */
export function makeCountingRowView(
  order: readonly number[],
  rows: readonly RowData[],
): { view: RowView; calls: RowViewCallCounts } {
  const calls: RowViewCallCounts = { getSourceIndex: 0, getRow: 0 };
  const view: RowView = {
    generation: 1,
    rows: rows as RowData[],
    rowCount: order.length,
    getSourceIndex(displayIndex: number): number {
      calls.getSourceIndex++;
      return displayIndex >= 0 && displayIndex < order.length
        ? order[displayIndex]!
        : -1;
    },
    getRow(displayIndex: number): RowData | undefined {
      calls.getRow++;
      const si = this.getSourceIndex(displayIndex);
      return si < 0 ? undefined : rows[si];
    },
  };
  return { view, calls };
}

export function membership(values: Iterable<string>): CsvSelectionReadSnapshot &
  CsvColumnSelectionReadSnapshot {
  const set = new Set(values);
  return {
    model: "explicit",
    universeRowCount: set.size,
    definitelyEmpty: set.size === 0,
    size: set.size,
    has: (v: string) => set.has(v),
  };
}

/** Build a pin membership view from a plain `rowId -> lane` record. */
export function pinMembership(
  record: Record<string, RowPinPosition>,
): CsvRowPinReadSnapshot {
  const map = new Map<string, RowPinPosition>(Object.entries(record));
  return { size: map.size, get: (rowId: string) => map.get(rowId) };
}

/** Default resolver: rowId = `row.id` as string, falling back to source index. */
export function idResolver(rows: readonly RowData[]): CsvRowIdResolver {
  return {
    getRowIdBySourceIndex(sourceIndex: number): string {
      const row = rows[sourceIndex];
      return String(row?.id ?? sourceIndex);
    },
  };
}

/** Resolver double that counts `getRowIdBySourceIndex` calls. */
export function makeCountingResolver(
  rows: readonly RowData[],
): { resolver: CsvRowIdResolver; calls: { resolve: number } } {
  const calls = { resolve: 0 };
  const resolver: CsvRowIdResolver = {
    getRowIdBySourceIndex(sourceIndex: number): string {
      calls.resolve++;
      const row = rows[sourceIndex];
      return String(row?.id ?? sourceIndex);
    },
  };
  return { resolver, calls };
}

export interface SnapshotOverrides {
  sourceRows?: readonly RowData[];
  pageView?: RowView;
  fullView?: RowView;
  visibleColumns?: readonly ColumnDef[];
  allLeafColumns?: readonly ColumnDef[];
  groupMetaByField?: Readonly<Record<string, ColumnGroupPathMeta>>;
  /** Plain `rowId -> lane` record; converted to a membership view internally. */
  rowPinState?: Record<string, RowPinPosition>;
  selectedRowIds?: CsvSelectionReadSnapshot;
  selectedColumnIds?: CsvColumnSelectionReadSnapshot;
  rowIds?: CsvRowIdResolver;
  groupHeaderDisplayEnabled?: boolean;
}

export function makeSnapshot(overrides: SnapshotOverrides = {}): CsvExportSnapshot {
  const sourceRows = overrides.sourceRows ?? [];
  const identityOrder = sourceRows.map((_row, i) => i);
  const fullView = overrides.fullView ?? makeRowView(identityOrder, sourceRows);
  return {
    sourceRows,
    pageView: overrides.pageView ?? fullView,
    fullView,
    visibleColumns: overrides.visibleColumns ?? [],
    allLeafColumns: overrides.allLeafColumns ?? overrides.visibleColumns ?? [],
    groupMetaByField: overrides.groupMetaByField ?? {},
    rowPinState: pinMembership(overrides.rowPinState ?? {}),
    selectedRowIds: overrides.selectedRowIds ?? membership([]),
    selectedColumnIds: overrides.selectedColumnIds ?? membership([]),
    rowIds: overrides.rowIds ?? idResolver(sourceRows),
    groupHeaderDisplayEnabled: overrides.groupHeaderDisplayEnabled ?? false,
    sourceLayoutRevision: 1,
    dataRevision: 1,
    columnSchemaRevision: 1,
  };
}

/** Drive a row plan to completion with a small budget (proves resumability). */
export function drainRowPlan(plan: CsvRowPlan, budget = 3): number[] {
  const out: number[] = [];
  let guard = 0;
  while (!plan.step(out, budget)) {
    if (++guard > 1_000_000) throw new Error("row plan did not terminate");
  }
  return out;
}
