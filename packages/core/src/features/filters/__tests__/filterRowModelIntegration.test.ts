import { describe, expect, it, vi } from 'vitest';

import { GridExecutionService } from '../../../execution/GridExecutionService';
import { executeFilterOperation } from '../../../execution/operations/filter/filterMainThread';
import { FILTER_OPERATION_THRESHOLD } from '../../../execution/operations/filter/filterOperation';
import { filterOperation } from '../../../execution/operations/filter/filterOperation';
import { sortOperation } from '../../../execution/operations/sort/sortOperation';
import { rowIndexExecutionResultToRowOrder } from '../../../execution/operations/types';
import { Grid } from '../../../Grid';
import { GridState } from '../../../state/GridState';
import type { ColumnFilterModel, FilterModel, RowData, SortModel } from '../../../types';
import { resolveColumnFilterConfigs } from '../resolveColumnFilterConfigs';

function makeState(
  rows: RowData[],
  opts?: {
    sortModel?: SortModel;
    filterModel?: FilterModel;
    pagination?: boolean;
    pageSize?: number;
  },
) {
  const state = new GridState({
    columns: [
      { field: 'name', filter: 'text' },
      { field: 'age', filter: 'number' },
    ],
    rows,
    defaultColDef: { sortable: true },
    initialSortModel: opts?.sortModel,
    pagination: opts?.pagination,
    paginationPageSize: opts?.pageSize,
  });
  if (opts?.filterModel) {
    state.setFilterModel(opts.filterModel);
    applyFilter(state);
  }
  return state;
}

function stateFilterConfigs(state: GridState) {
  return resolveColumnFilterConfigs({
    columns: state.getColumnDefs(),
    defaultFilterable: state.getDefaultColDef()?.filterable,
    defaultFilter: state.getDefaultColDef()?.filter,
  });
}

function applyFilter(state: GridState): void {
  const rawRows = state.getRows();
  const filterModel = state.getFilterModel();
  if (Object.keys(filterModel).length === 0) return;
  const columnsByField = stateFilterConfigs(state);
  const result = executeFilterOperation({
    rows: rawRows,
    filterModel,
    columnsByField,
  });
  const rowOrder = rowIndexExecutionResultToRowOrder(result);
  state.applyFilteredRowOrder(rowOrder);
}

function displayRows(state: GridState): RowData[] {
  const snap = state.getSnapshot();
  const result: RowData[] = [];
  for (let i = 0; i < snap.rowView.rowCount; i++) {
    result.push(snap.rowView.getRow(i)!);
  }
  return result;
}

function displaySourceIndexes(state: GridState): number[] {
  const snap = state.getSnapshot();
  const result: number[] = [];
  for (let i = 0; i < snap.rowView.rowCount; i++) {
    result.push(snap.rowView.getSourceIndex(i));
  }
  return result;
}

const resolveId = (row: RowData): string | null => {
  const raw = row.id;
  return raw === null || raw === undefined ? null : String(raw);
};

function makeGrid(
  rows: RowData[],
  opts?: {
    pagination?: boolean;
    pageSize?: number;
    filterModel?: FilterModel;
  },
) {
  const grid = new Grid({
    columns: [
      { field: 'name', filter: 'text' },
      { field: 'age', filter: 'number' },
    ],
    rows,
    defaultColDef: { sortable: true },
    pagination: opts?.pagination,
    paginationPageSize: opts?.pageSize,
  });
  if (opts?.filterModel) {
    grid.setFilterModel(opts.filterModel);
  }
  return grid;
}

describe('filter row-model integration', () => {
  const rows: RowData[] = [
    { name: 'Alice', age: 30 },
    { name: 'Bob', age: 25 },
    { name: 'Charlie', age: 35 },
    { name: 'Diana', age: 28 },
  ];

  // ── GridState-level tests ──────────────────────────────────────────

  it('no filters — identity pass-through', () => {
    const state = makeState(rows);
    const snap = state.getSnapshot();
    expect(snap.rowView.rowCount).toBe(4);
    expect(snap.filterModel).toEqual({});
    expect(snap.filterPending).toBe(false);
    expect(displaySourceIndexes(state)).toEqual([0, 1, 2, 3]);
  });

  it('text filter reduces visible rows', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'li' }],
        },
      },
    });
    const visible = displayRows(state);
    expect(visible).toHaveLength(2);
    expect(visible.map((r) => r.name)).toEqual(['Alice', 'Charlie']);
  });

  it('filter before sort — sorted within filtered set', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'a' }],
        },
      },
    });
    state.setSortModel([{ field: 'age', sort: 'asc' }]);
    const visible = displayRows(state);
    expect(visible.map((r) => r.name)).toEqual(['Diana', 'Alice', 'Charlie']);
  });

  it('filter before sort before pagination', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'a' }],
        },
      },
      pagination: true,
      pageSize: 2,
    });
    state.setSortModel([{ field: 'age', sort: 'asc' }]);
    const snap = state.getSnapshot();
    expect(snap.rowView.rowCount).toBe(2);
    const visible = displayRows(state);
    expect(visible.map((r) => r.name)).toEqual(['Diana', 'Alice']);
    expect(snap.pagination?.totalRows).toBe(3);
    expect(snap.pagination?.pageCount).toBe(2);
  });

  it('empty filter result produces zero rows', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'zzz' }],
        },
      },
    });
    const snap = state.getSnapshot();
    expect(snap.rowView.rowCount).toBe(0);
  });

  it('clearing filters restores all rows', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'li' }],
        },
      },
    });
    expect(state.getSnapshot().rowView.rowCount).toBe(2);
    state.setFilterModel({});
    expect(state.getSnapshot().rowView.rowCount).toBe(4);
    expect(state.getSnapshot().filterModel).toEqual({});
  });

  it('clearing filters clears pending state and restores full pipeline', () => {
    const state = makeState(rows);
    state.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    state.markFilterPending();
    expect(state.isFilterPending()).toBe(true);

    state.setFilterModel({});
    expect(state.isFilterPending()).toBe(false);
    expect(state.needsFilterSchedule).toBe(false);
    const snap = state.getSnapshot();
    expect(snap.rowView.rowCount).toBe(4);
    expect(snap.filterPending).toBe(false);
  });

  it('setFilterModel returns false for no-op', () => {
    const state = makeState(rows);
    expect(state.setFilterModel({})).toBe(false);
  });

  it('setFilterModel returns true when model changes', () => {
    const state = makeState(rows);
    expect(
      state.setFilterModel({
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'a' }],
        },
      }),
    ).toBe(true);
  });

  it('snapshot includes filterModel and filterPending', () => {
    const fm: FilterModel = {
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    };
    const state = makeState(rows, { filterModel: fm });
    const snap = state.getSnapshot();
    expect(snap.filterModel).toEqual(fm);
    expect(snap.filterPending).toBe(false);
  });

  it('filter + sort repeated getSnapshot keeps rowView.generation stable', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'li' }],
        },
      },
    });
    state.setSortModel([{ field: 'age', sort: 'asc' }]);
    const snap1 = state.getSnapshot();
    const snap2 = state.getSnapshot();
    const snap3 = state.getSnapshot();
    expect(snap1.rowView.generation).toBe(snap2.rowView.generation);
    expect(snap2.rowView.generation).toBe(snap3.rowView.generation);
  });

  it('sort receives only filtered source indexes, not all rows', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'a' }],
        },
      },
    });
    state.setSortModel([{ field: 'age', sort: 'desc' }]);
    const indexes = displaySourceIndexes(state);
    expect(indexes).toEqual([2, 0, 3]);
    expect(indexes).not.toContain(1);
  });

  it('number filter works correctly', () => {
    const state = makeState(rows, {
      filterModel: {
        age: {
          type: 'number',
          operator: 'and',
          conditions: [{ operator: 'gte', value: 30 }],
        },
      },
    });
    const visible = displayRows(state);
    expect(visible.map((r) => r.name)).toEqual(['Alice', 'Charlie']);
  });

  it('filter invalidated on setRows', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'li' }],
        },
      },
    });
    expect(state.getSnapshot().rowView.rowCount).toBe(2);
    const newRows = [
      { name: 'Olivia', age: 22 },
      { name: 'Felix', age: 33 },
    ];
    state.setRows(newRows);
    applyFilter(state);
    const snap = state.getSnapshot();
    expect(snap.rowView.rowCount).toBe(2);
    expect(displayRows(state).map((r) => r.name)).toEqual(['Olivia', 'Felix']);
  });

  it('resolveColumnFilterConfigs builds map from column defs and defaults', () => {
    const state = makeState(rows);
    const configs = stateFilterConfigs(state);
    expect(configs.size).toBe(2);
    expect(configs.get('name')?.type).toBe('text');
    expect(configs.get('age')?.type).toBe('number');
  });

  it('pagination total reflects filtered count', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'a' }],
        },
      },
      pagination: true,
      pageSize: 10,
    });
    const snap = state.getSnapshot();
    expect(snap.pagination?.totalRows).toBe(3);
    expect(snap.pagination?.pageCount).toBe(1);
  });

  it('pagination state after setFilterModel is correct before getSnapshot', () => {
    const state = makeState(rows, {
      pagination: true,
      pageSize: 10,
    });
    expect(state.getPaginationState().totalRows).toBe(4);
    state.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'li' }],
      },
    });
    applyFilter(state);
    expect(state.getPaginationState().totalRows).toBe(2);
  });

  it('needsFilterSchedule is set when filter model has entries', () => {
    const state = makeState(rows);
    expect(state.needsFilterSchedule).toBe(false);
    state.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    expect(state.needsFilterSchedule).toBe(true);
  });

  it('needsFilterSchedule is false after markFilterPending', () => {
    const state = makeState(rows);
    state.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    expect(state.needsFilterSchedule).toBe(true);
    state.markFilterPending();
    expect(state.needsFilterSchedule).toBe(false);
  });

  it('needsFilterSchedule is false after applyFilteredRowOrder', () => {
    const state = makeState(rows);
    state.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    expect(state.needsFilterSchedule).toBe(true);
    applyFilter(state);
    expect(state.needsFilterSchedule).toBe(false);
  });

  it('needsFilterSchedule is false after Grid.setFilterModel synchronous completion', () => {
    const grid = makeGrid(rows);
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    // Small row count completes synchronously — flag must be cleared
    expect((grid as unknown as { state: GridState }).state.needsFilterSchedule).toBe(false);
    grid.destroy();
  });

  it('setRows with active filters sets needsFilterSchedule true until scheduled', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'a' }],
        },
      },
    });
    expect(state.needsFilterSchedule).toBe(false);
    state.setRows([{ name: 'Zara', age: 40 }]);
    expect(state.needsFilterSchedule).toBe(true);
    state.markFilterPending();
    expect(state.needsFilterSchedule).toBe(false);
  });

  it('active filter update on unrelated field keeps filtered rows and dirty metadata without scheduling filter', () => {
    const filteredRows: RowData[] = [
      { id: 'a', name: 'Alice', age: 30 },
      { id: 'b', name: 'Bob', age: 25 },
      { id: 'c', name: 'Charlie', age: 35 },
      { id: 'd', name: 'Diana', age: 28 },
    ];
    const state = makeState(filteredRows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'li' }],
        },
      },
    });
    expect(displaySourceIndexes(state)).toEqual([0, 2]);
    expect(state.needsFilterSchedule).toBe(false);

    const outcome = state.replaceRowAtSourceIndex(
      0,
      { id: 'a', name: 'Alice', age: 31 },
      resolveId,
    );

    expect(outcome.changed).toBe(true);
    expect(state.needsFilterSchedule).toBe(false);
    expect(displaySourceIndexes(state)).toEqual([0, 2]);
    expect(displayRows(state).map((r) => r.age)).toEqual([31, 35]);

    const dirty = state.consumeRenderChangeSetForRender();
    expect(dirty?.get('a')).toEqual(new Set(['age']));
  });

  it('active filter update on filtered field schedules recompute and preserves old filtered order while pending', () => {
    const filteredRows: RowData[] = [
      { id: 'a', name: 'Alice', age: 30 },
      { id: 'b', name: 'Bob', age: 25 },
      { id: 'c', name: 'Charlie', age: 35 },
      { id: 'd', name: 'Diana', age: 28 },
    ];
    const state = makeState(filteredRows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'li' }],
        },
      },
    });
    expect(displaySourceIndexes(state)).toEqual([0, 2]);

    state.replaceRowAtSourceIndex(
      1,
      { id: 'b', name: 'Liam', age: 25 },
      resolveId,
    );

    expect(state.needsFilterSchedule).toBe(true);
    state.markFilterPending();
    expect(state.getSnapshot().filterPending).toBe(true);
    expect(displaySourceIndexes(state)).toEqual([0, 2]);

    applyFilter(state);
    expect(displaySourceIndexes(state)).toEqual([0, 1, 2]);
  });

  it('dot-path filter invalidation touches top-level object updates but ignores unrelated fields', () => {
    const dotRows: RowData[] = [
      { id: 'a', user: { name: 'Alice' }, age: 30 },
      { id: 'b', user: { name: 'Bob' }, age: 25 },
      { id: 'c', user: { name: 'Charlie' }, age: 35 },
    ];
    const state = new GridState({
      columns: [
        { field: 'user.name', filter: 'text' },
        { field: 'age', filter: 'number' },
      ],
      rows: dotRows,
      defaultColDef: { sortable: true },
    });
    state.setFilterModel({
      'user.name': {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'li' }],
      },
    });
    applyFilter(state);
    expect(displaySourceIndexes(state)).toEqual([0, 2]);

    state.replaceRowAtSourceIndex(
      0,
      { id: 'a', user: dotRows[0]!.user, age: 31 },
      resolveId,
    );
    expect(state.needsFilterSchedule).toBe(false);
    expect(displaySourceIndexes(state)).toEqual([0, 2]);

    state.replaceRowAtSourceIndex(
      1,
      { id: 'b', user: { name: 'Liam' }, age: 25 },
      resolveId,
    );
    expect(state.needsFilterSchedule).toBe(true);
    state.markFilterPending();
    expect(displaySourceIndexes(state)).toEqual([0, 2]);
  });

  it('changing column filter config invalidates filter cache', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'a' }],
        },
      },
    });
    expect(state.getSnapshot().rowView.rowCount).toBe(3);
    const version1 = state.getFilterConfigVersion();
    state.setColumns([
      { field: 'name', filter: 'number' },
      { field: 'age', filter: 'number' },
    ]);
    expect(state.getFilterConfigVersion()).toBeGreaterThan(version1);
    expect(state.needsFilterSchedule).toBe(true);
  });

  it('changing defaultColDef filter config invalidates filter cache', () => {
    const state = new GridState({
      columns: [{ field: 'name' }, { field: 'age' }],
      rows,
      defaultColDef: { sortable: true, filter: 'text' },
    });
    state.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    applyFilter(state);
    expect(state.getSnapshot().rowView.rowCount).toBe(3);
    const version1 = state.getFilterConfigVersion();
    state.setDefaultColDef({ sortable: true, filter: 'number' });
    expect(state.getFilterConfigVersion()).toBeGreaterThan(version1);
    expect(state.needsFilterSchedule).toBe(true);
  });

  it('no filter logic executes in getSnapshot without an applied filter result', () => {
    const state = makeState(rows);
    state.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'li' }],
      },
    });
    // Do NOT call applyFilter — simulate filter pending
    const snap = state.getSnapshot();
    // Without an applied filter result, getSnapshot must show all rows (identity)
    expect(snap.rowView.rowCount).toBe(4);
    expect(snap.filterModel).toEqual({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'li' }],
      },
    });
  });

  // ── Sort operation cache with sourceIndexes ──────────────────────────

  it('sort operation cache skips sourceIndexes subset requests', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'a' }],
        },
      },
    });
    state.setSortModel([{ field: 'age', sort: 'asc' }]);
    // Prime the sort cache
    state.getSnapshot();

    const cache = state.getSortOperationCache();
    const filteredIndexes = new Uint32Array([0, 2, 3]);
    const result = cache.tryResolve({
      rows: state.getRows(),
      sortModel: [{ field: 'age', sort: 'desc' }],
      columns: state.getVisibleColumnDefs(),
      sourceIndexes: filteredIndexes,
    });
    // Pair cache must not return a full-row result for a subset request
    expect(result).toBe(null);
  });

  // ── Sort worker eligibility with sourceIndexes ──────────────────────

  it('sort worker is ineligible when sourceIndexes is present', () => {
    const input = {
      rows,
      sortModel: [{ field: 'age', sort: 'asc' as const }],
      columns: [
        { field: 'name', sortable: true },
        { field: 'age', sortable: true },
      ],
      sourceIndexes: new Uint32Array([0, 2, 3]),
    };
    const eligibility = sortOperation.worker!.resolveEligibility(input);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe('source-indexes-subset');
  });

  it('sort worker is eligible without sourceIndexes', () => {
    const input = {
      rows,
      sortModel: [{ field: 'age', sort: 'asc' as const }],
      columns: [
        { field: 'name', sortable: true },
        { field: 'age', sortable: true },
      ],
    };
    const eligibility = sortOperation.worker!.resolveEligibility(input);
    expect(eligibility.eligible).toBe(true);
  });

  // ── GridExecutionService.scheduleFilter ─────────────────────────────

  it('GridExecutionService.scheduleFilter executes and returns filter result', () => {
    const service = new GridExecutionService();

    const fm: FilterModel = {
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'row-5' }],
      },
    };

    const largeRows: RowData[] = [];
    for (let i = 0; i < 100; i++) {
      largeRows.push({ name: `row-${i}`, age: i });
    }

    let completionCalled = false;
    const largeState = makeState(largeRows);
    largeState.setFilterModel(fm);

    service.scheduleFilter(
      largeState.getRows(),
      fm,
      stateFilterConfigs(largeState),
      (completion) => {
        completionCalled = true;
        const rowOrder = rowIndexExecutionResultToRowOrder(completion.result);
        largeState.applyFilteredRowOrder(rowOrder);
      },
    );

    // Below threshold (100 rows) — executes synchronously
    expect(completionCalled).toBe(true);
    const snap = largeState.getSnapshot();
    // 'row-5' matches: row-5, row-50..row-59 = 11 rows
    expect(snap.rowView.rowCount).toBe(11);
    service.destroy();
  });

  it('large filter at threshold proves work count >= threshold triggers async path', () => {
    // Verify the filter operation's getWorkUnitCount reports the correct
    // count at threshold, which controls whether the runner attempts the
    // async (worker/deferred) path vs immediate main-thread execution.
    const largeRows: RowData[] = new Array(FILTER_OPERATION_THRESHOLD);
    for (let i = 0; i < FILTER_OPERATION_THRESHOLD; i++) {
      largeRows[i] = { name: `row-${i}`, age: i };
    }
    const fm: FilterModel = {
      age: {
        type: 'number',
        operator: 'and',
        conditions: [{ operator: 'gte', value: 0 }],
      },
    };
    const state = makeState(largeRows);
    const columnsByField = stateFilterConfigs(state);

    const workUnits = filterOperation.getWorkUnitCount({
      rows: largeRows,
      filterModel: fm,
      columnsByField,
    });
    expect(workUnits).toBe(FILTER_OPERATION_THRESHOLD);
    expect(workUnits).toBeGreaterThanOrEqual(filterOperation.threshold);

    // Below threshold: immediate main-thread execution
    const smallRows = largeRows.slice(0, 100);
    const smallState = makeState(smallRows);
    const service = new GridExecutionService();
    let syncProducer: string | undefined;
    service.scheduleFilter(smallRows, fm, stateFilterConfigs(smallState), (c) => {
      syncProducer = c.producer;
    });
    expect(syncProducer).toBe('mainThread');
    service.destroy();
  });

  // ── Grid-level filter scheduling ────────────────────────────────────

  it('Grid uses scheduleFilter when active filter model is set', () => {
    const grid = makeGrid(rows);
    const scheduleSpy = vi.spyOn(
      GridExecutionService.prototype,
      'scheduleFilter',
    );

    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    scheduleSpy.mockRestore();
    grid.destroy();
  });

  it('Grid.clearFilters cancels filter execution', () => {
    const grid = makeGrid(rows);
    const cancelSpy = vi.spyOn(
      GridExecutionService.prototype,
      'cancelFilter',
    );

    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    grid.clearFilters();

    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
    grid.destroy();
  });

  it('Grid.setFilterModel({}) clears pending and cancels filter', () => {
    const grid = makeGrid(rows);
    const cancelSpy = vi.spyOn(
      GridExecutionService.prototype,
      'cancelFilter',
    );

    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    grid.setFilterModel({});

    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
    grid.destroy();
  });

  it('Grid.setRows with active filters schedules filter execution', () => {
    const grid = makeGrid(rows);
    const scheduleSpy = vi.spyOn(
      GridExecutionService.prototype,
      'scheduleFilter',
    );

    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    const callsAfterSetFilter = scheduleSpy.mock.calls.length;

    grid.setRows([
      { name: 'Ava', age: 20 },
      { name: 'Ben', age: 22 },
    ]);

    // setRows with active filters should schedule another filter execution
    expect(scheduleSpy.mock.calls.length).toBeGreaterThan(callsAfterSetFilter);
    scheduleSpy.mockRestore();
    grid.destroy();
  });

  it('Grid.getFilterModel returns current filter model', () => {
    const grid = makeGrid(rows);
    expect(grid.getFilterModel()).toEqual({});

    const fm: FilterModel = {
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    };
    grid.setFilterModel(fm);
    expect(grid.getFilterModel()).toEqual(fm);
    grid.destroy();
  });

  // ── Pagination with pending/completed filter ──────────────────────

  it('pagination shows full rows while filter is pending (no applied result)', () => {
    const state = makeState(rows, {
      pagination: true,
      pageSize: 10,
    });
    state.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'li' }],
      },
    });
    state.markFilterPending();
    // No applyFilteredRowOrder — filter pending with no result yet
    const snap = state.getSnapshot();
    // Identity fallback while pending: all 4 rows visible
    expect(snap.rowView.rowCount).toBe(4);
    expect(snap.pagination?.totalRows).toBe(4);
    expect(snap.filterPending).toBe(true);
  });

  it('pagination reflects filtered count after filter completion', () => {
    const state = makeState(rows, {
      pagination: true,
      pageSize: 2,
    });
    state.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    applyFilter(state);
    const snap = state.getSnapshot();
    expect(snap.pagination?.totalRows).toBe(3);
    expect(snap.pagination?.pageCount).toBe(2);
    expect(snap.rowView.rowCount).toBe(2);
    expect(snap.filterPending).toBe(false);
  });

  // ── Filter model immutability ──────────────────────────────────────

  it('mutating the original model after setFilterModel does not change grid state', () => {
    const grid = makeGrid(rows);
    const fm: FilterModel = {
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    };
    grid.setFilterModel(fm);

    // Mutate the original object
    fm.name!.conditions[0]!.value = 'zzz';
    fm.age = {
      type: 'number',
      operator: 'and',
      conditions: [{ operator: 'gte', value: 100 }],
    };

    const stored = grid.getFilterModel();
    expect(stored.name!.conditions[0]!.value).toBe('a');
    expect(stored.age).toBeUndefined();
    grid.destroy();
  });

  it('mutating getFilterModel result does not change grid state', () => {
    const grid = makeGrid(rows);
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });

    const retrieved = grid.getFilterModel();
    retrieved.name!.conditions[0]!.value = 'zzz';
    delete retrieved.name;

    const stored = grid.getFilterModel();
    expect(stored.name).toBeDefined();
    expect(stored.name!.conditions[0]!.value).toBe('a');
    grid.destroy();
  });

  it('onFilterChanged.filteredRows is correct with pagination enabled', () => {
    let receivedEvent: { filteredRows: number; totalRows: number } | null = null;
    const grid = new Grid({
      columns: [
        { field: 'name', filter: 'text' },
        { field: 'age', filter: 'number' },
      ],
      rows,
      defaultColDef: { sortable: true },
      pagination: true,
      paginationPageSize: 2,
      onFilterChanged: (e) => { receivedEvent = e; },
    });

    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });

    expect(receivedEvent).not.toBeNull();
    // Alice, Charlie, Diana = 3 filtered rows, but page size is 2
    // filteredRows must report the full filtered count (3), not the page count (2)
    expect(receivedEvent!.filteredRows).toBe(3);
    expect(receivedEvent!.totalRows).toBe(4);
    grid.destroy();
  });

  it('stale filter completion is ignored after model replacement', () => {
    const state = makeState(rows);
    state.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'li' }],
      },
    });
    applyFilter(state);
    expect(state.getSnapshot().rowView.rowCount).toBe(2);

    // Replace with a different filter — the old completion is now stale
    const staleModel: FilterModel = {
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'li' }],
      },
    };
    state.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    applyFilter(state);
    expect(state.getSnapshot().rowView.rowCount).toBe(3);

    // Verify stale check works via Grid-level scheduling
    const grid = makeGrid(rows);
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'li' }],
      },
    });
    // isCurrentFilterModel rejects a different model
    expect(
      state.isCurrentFilterModel(staleModel),
    ).toBe(false);
    grid.destroy();
  });

  // ── Column-level filter API ────────────────────────────────────────

  it('Grid.setColumnFilterModel applies one column filter', () => {
    const grid = makeGrid(rows);
    const scheduleSpy = vi.spyOn(
      GridExecutionService.prototype,
      'scheduleFilter',
    );

    grid.setColumnFilterModel('name', {
      type: 'text',
      operator: 'and',
      conditions: [{ operator: 'contains', value: 'li' }],
    });

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(grid.getFilterModel()).toEqual({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'li' }],
      },
    });
    scheduleSpy.mockRestore();
    grid.destroy();
  });

  it('Grid text filters search valueGetter + valueFormatter display text', () => {
    const grid = new Grid({
      columns: [
        {
          field: 'jan',
          filter: 'text',
          valueGetter: ({ row }: { row: RowData }) =>
            Math.round((Number(row.jan) / 100000) * 100),
          valueFormatter: ({ value }: { value: unknown }) => `${String(value)}%`,
        },
      ],
      rows: [
        { name: 'Thirty eight', jan: 38031 },
        { name: 'Thirty', jan: 30000 },
        { name: 'Seventy two', jan: 72000 },
      ],
      defaultColDef: { filter: true },
    });

    grid.setColumnFilterModel('jan', {
      type: 'text',
      operator: 'and',
      conditions: [{ operator: 'contains', value: '30%' }],
    });

    const snap = (grid as unknown as { state: GridState }).state.getSnapshot();
    expect(snap.rowView.rowCount).toBe(1);
    expect(snap.rowView.getRow(0)!.name).toBe('Thirty');
    grid.destroy();
  });

  it('Grid.getColumnFilterModel returns a defensive copy', () => {
    const grid = makeGrid(rows);
    grid.setColumnFilterModel('name', {
      type: 'text',
      operator: 'and',
      conditions: [{ operator: 'contains', value: 'a' }],
    });

    const retrieved = grid.getColumnFilterModel('name');
    expect(retrieved).not.toBeNull();
    retrieved!.conditions[0]!.value = 'zzz';

    const fresh = grid.getColumnFilterModel('name');
    expect(fresh!.conditions[0]!.value).toBe('a');
    grid.destroy();
  });

  it('mutating the input column model after setColumnFilterModel does not affect grid state', () => {
    const grid = makeGrid(rows);
    const colModel: ColumnFilterModel = {
      type: 'text',
      operator: 'and',
      conditions: [{ operator: 'contains', value: 'a' }],
    };
    grid.setColumnFilterModel('name', colModel);

    colModel.conditions[0]!.value = 'zzz';

    const stored = grid.getColumnFilterModel('name');
    expect(stored!.conditions[0]!.value).toBe('a');
    grid.destroy();
  });

  it('Grid.clearColumnFilter removes one column and preserves other filters', () => {
    const grid = makeGrid(rows);
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
      age: {
        type: 'number',
        operator: 'and',
        conditions: [{ operator: 'gte', value: 30 }],
      },
    });

    grid.clearColumnFilter('name');

    const model = grid.getFilterModel();
    expect(model.name).toBeUndefined();
    expect(model.age).toBeDefined();
    expect(grid.getColumnFilterModel('name')).toBeNull();
    expect(grid.getColumnFilterModel('age')).not.toBeNull();
    grid.destroy();
  });

  it('Grid.clearColumnFilter on the last filter cancels execution and emits once', () => {
    const grid = makeGrid(rows);
    const cancelSpy = vi.spyOn(
      GridExecutionService.prototype,
      'cancelFilter',
    );
    let eventCount = 0;
    grid.on('filter:changed', () => { eventCount++; });

    grid.setColumnFilterModel('name', {
      type: 'text',
      operator: 'and',
      conditions: [{ operator: 'contains', value: 'a' }],
    });
    eventCount = 0;

    grid.clearColumnFilter('name');

    expect(cancelSpy).toHaveBeenCalled();
    expect(grid.getFilterModel()).toEqual({});
    expect(eventCount).toBe(1);
    cancelSpy.mockRestore();
    grid.destroy();
  });

  it('unknown/unconfigured field no-ops and emits nothing', () => {
    const grid = makeGrid(rows);
    let eventCount = 0;
    grid.on('filter:changed', () => { eventCount++; });
    const scheduleSpy = vi.spyOn(
      GridExecutionService.prototype,
      'scheduleFilter',
    );

    grid.setColumnFilterModel('nonexistent', {
      type: 'text',
      operator: 'and',
      conditions: [{ operator: 'contains', value: 'a' }],
    });

    expect(scheduleSpy).not.toHaveBeenCalled();
    expect(eventCount).toBe(0);
    expect(grid.getColumnFilterModel('nonexistent')).toBeNull();
    expect(grid.getFilterModel()).toEqual({});

    // clearColumnFilter on a field that was never set is also a no-op
    grid.clearColumnFilter('neverSet');
    expect(eventCount).toBe(0);

    scheduleSpy.mockRestore();
    grid.destroy();
  });

  it('no-op same model emits nothing and does not schedule filter execution', () => {
    const grid = makeGrid(rows);
    const colModel: ColumnFilterModel = {
      type: 'text',
      operator: 'and',
      conditions: [{ operator: 'contains', value: 'a' }],
    };
    grid.setColumnFilterModel('name', colModel);

    const scheduleSpy = vi.spyOn(
      GridExecutionService.prototype,
      'scheduleFilter',
    );
    let eventCount = 0;
    grid.on('filter:changed', () => { eventCount++; });

    // Set the exact same model again
    grid.setColumnFilterModel('name', {
      type: 'text',
      operator: 'and',
      conditions: [{ operator: 'contains', value: 'a' }],
    });

    expect(scheduleSpy).not.toHaveBeenCalled();
    expect(eventCount).toBe(0);
    scheduleSpy.mockRestore();
    grid.destroy();
  });

  // ── Normalization through feature path ─────────────────────────────

  it('Grid.setFilterModel drops unknown/unconfigured fields', () => {
    const grid = makeGrid(rows);
    let eventCount = 0;
    grid.on('filter:changed', () => { eventCount++; });

    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
      unknownField: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'x' }],
      },
    } as FilterModel);

    const stored = grid.getFilterModel();
    expect(stored.name).toBeDefined();
    expect((stored as Record<string, unknown>).unknownField).toBeUndefined();
    expect(eventCount).toBe(1);
    grid.destroy();
  });

  it('Grid.setFilterModel with only unknown/invalid filters is a no-op when already empty', () => {
    const grid = makeGrid(rows);
    let eventCount = 0;
    grid.on('filter:changed', () => { eventCount++; });

    grid.setFilterModel({
      unknownField: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'x' }],
      },
    } as FilterModel);

    expect(grid.getFilterModel()).toEqual({});
    expect(eventCount).toBe(0);
    grid.destroy();
  });

  it('Grid.setFilterModel with only unknown/invalid filters clears active model and emits', () => {
    const grid = makeGrid(rows);
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });

    let eventCount = 0;
    grid.on('filter:changed', () => { eventCount++; });

    grid.setFilterModel({
      unknownField: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'x' }],
      },
    } as FilterModel);

    expect(grid.getFilterModel()).toEqual({});
    expect(eventCount).toBe(1);
    grid.destroy();
  });

  it('Grid.setColumnFilterModel normalizes type from column config', () => {
    const grid = makeGrid(rows);

    // Pass a model with type 'text' to a column configured as 'number'.
    // The normalizer should use the config type ('number'), not the input type.
    grid.setColumnFilterModel('age', {
      type: 'text' as 'number',
      operator: 'and',
      conditions: [{ operator: 'gte', value: 30 }],
    });

    const stored = grid.getColumnFilterModel('age');
    expect(stored).not.toBeNull();
    expect(stored!.type).toBe('number');
    grid.destroy();
  });

  it('Grid.setColumnFilterModel with invalid/empty conditions clears existing column filter', () => {
    const grid = makeGrid(rows);
    grid.setColumnFilterModel('name', {
      type: 'text',
      operator: 'and',
      conditions: [{ operator: 'contains', value: 'a' }],
    });
    expect(grid.getColumnFilterModel('name')).not.toBeNull();

    let eventCount = 0;
    grid.on('filter:changed', () => { eventCount++; });

    // Empty conditions array normalizes to null → clears the column filter
    grid.setColumnFilterModel('name', {
      type: 'text',
      operator: 'and',
      conditions: [],
    });

    expect(grid.getColumnFilterModel('name')).toBeNull();
    expect(grid.getFilterModel()).toEqual({});
    expect(eventCount).toBe(1);
    grid.destroy();
  });

  it('Grid.setFilterModel normalizes operator default to "and"', () => {
    const grid = makeGrid(rows);
    grid.setFilterModel({
      name: {
        type: 'text',
        conditions: [{ operator: 'contains', value: 'a' }],
      } as FilterModel['string'],
    });

    const stored = grid.getFilterModel();
    expect(stored.name!.operator).toBe('and');
    grid.destroy();
  });

  // ── Dynamic config change re-normalization ─────────────────────────

  it('active filter is dropped when setColumns removes that field', () => {
    const grid = makeGrid(rows);
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });

    let filterEvent: { activeFilterCount: number } | null = null;
    grid.on('filter:changed', (e) => { filterEvent = e; });

    grid.setColumns([
      { field: 'age', filter: 'number' },
    ]);

    expect(grid.getFilterModel()).toEqual({});
    expect(grid.getColumnFilterModel('name')).toBeNull();
    expect(filterEvent).not.toBeNull();
    expect(filterEvent!.activeFilterCount).toBe(0);
    grid.destroy();
  });

  it('active filter is dropped when setColumns makes field unfilterable', () => {
    const grid = makeGrid(rows);
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });

    let filterEvent: { activeFilterCount: number } | null = null;
    grid.on('filter:changed', (e) => { filterEvent = e; });

    grid.setColumns([
      { field: 'name', filterable: false },
      { field: 'age', filter: 'number' },
    ]);

    expect(grid.getFilterModel()).toEqual({});
    expect(filterEvent).not.toBeNull();
    expect(filterEvent!.activeFilterCount).toBe(0);
    grid.destroy();
  });

  it('active filter is re-normalized when setDefaultColDef changes filter type', () => {
    const grid = new Grid({
      columns: [
        { field: 'name' },
        { field: 'age' },
      ],
      rows,
      defaultColDef: { sortable: true, filter: 'text' },
    });
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    expect(grid.getFilterModel().name).toBeDefined();

    let filterEvent: { filterModel: FilterModel } | null = null;
    grid.on('filter:changed', (e) => { filterEvent = e; });

    // Change default filter to number — 'contains' is invalid for number type
    grid.setDefaultColDef({ sortable: true, filter: 'number' });

    // The 'contains' condition is invalid for number, so the filter is dropped
    expect(grid.getFilterModel()).toEqual({});
    expect(filterEvent).not.toBeNull();
    grid.destroy();
  });

  it('dropping filters through column config emits exactly one filter changed event', () => {
    const grid = makeGrid(rows);
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
      age: {
        type: 'number',
        operator: 'and',
        conditions: [{ operator: 'gte', value: 30 }],
      },
    });

    let eventCount = 0;
    grid.on('filter:changed', () => { eventCount++; });

    // Remove both filterable columns
    grid.setColumns([
      { field: 'name' },
      { field: 'age' },
    ]);

    expect(grid.getFilterModel()).toEqual({});
    expect(eventCount).toBe(1);
    grid.destroy();
  });

  it('config change with equivalent normalized model emits no filter changed event', () => {
    const grid = makeGrid(rows);
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });

    let eventCount = 0;
    grid.on('filter:changed', () => { eventCount++; });

    // Change columns but keep 'name' filterable as text — model stays the same
    grid.setColumns([
      { field: 'name', filter: 'text' },
      { field: 'age', filter: 'number' },
      { field: 'extra', filter: 'text' },
    ]);

    expect(grid.getFilterModel()).toEqual({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    expect(eventCount).toBe(0);
    grid.destroy();
  });

  it('sort still refreshes correctly when columns change and filters also need cleanup', () => {
    const grid = makeGrid(rows);
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    grid.setSortModel([{ field: 'age', sort: 'asc' }]);

    let filterEventCount = 0;
    let sortEventCount = 0;
    grid.on('filter:changed', () => { filterEventCount++; });
    grid.on('sort:changed', () => { sortEventCount++; });

    // Remove 'name' filter config and keep sort column — sort model unchanged
    grid.setColumns([
      { field: 'name' },
      { field: 'age', filter: 'number' },
    ]);

    expect(grid.getFilterModel()).toEqual({});
    expect(filterEventCount).toBe(1);
    expect(grid.getSortModel()).toEqual([{ field: 'age', sort: 'asc' }]);
    expect(sortEventCount).toBe(0);
    grid.destroy();
  });

  it('setColumns removes sorted column with active filters: sort:changed emits once', () => {
    const grid = makeGrid(rows);
    grid.setFilterModel({
      age: {
        type: 'number',
        operator: 'and',
        conditions: [{ operator: 'gte', value: 25 }],
      },
    });
    grid.setSortModel([{ field: 'name', sort: 'asc' }]);

    let filterEventCount = 0;
    let sortEventCount = 0;
    let sortSource: string | undefined;
    grid.on('filter:changed', () => { filterEventCount++; });
    grid.on('sort:changed', (e) => { sortEventCount++; sortSource = e.source; });

    // Remove 'name' column entirely — sort model loses its column,
    // but 'age' filter stays valid
    grid.setColumns([
      { field: 'age', filter: 'number' },
    ]);

    expect(grid.getSortModel()).toEqual([]);
    expect(sortEventCount).toBe(1);
    expect(sortSource).toBe('api');
    // Filter on 'age' should still be active
    expect(grid.getFilterModel().age).toBeDefined();
    expect(filterEventCount).toBe(0);
    grid.destroy();
  });

  it('setDefaultColDef changes config with equivalent filter model: only sort:changed emits', () => {
    const grid = new Grid({
      columns: [
        { field: 'name', filter: 'text' },
        { field: 'age', filter: 'number' },
      ],
      rows,
      defaultColDef: { sortable: true },
    });
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    grid.setSortModel([{ field: 'age', sort: 'asc' }]);

    let filterEventCount = 0;
    let sortEventCount = 0;
    grid.on('filter:changed', () => { filterEventCount++; });
    grid.on('sort:changed', () => { sortEventCount++; });

    // Change defaultColDef to make all columns unsortable — sort model
    // is pruned, but 'name' filter stays valid (column-level filter: 'text')
    grid.setDefaultColDef({ sortable: false });

    expect(grid.getSortModel()).toEqual([]);
    expect(sortEventCount).toBe(1);
    expect(grid.getFilterModel().name).toBeDefined();
    expect(filterEventCount).toBe(0);
    grid.destroy();
  });

  it('setColumns drops filter and sort in the same call: each event emits once', () => {
    const grid = makeGrid(rows);
    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });
    grid.setSortModel([{ field: 'name', sort: 'asc' }]);

    let filterEventCount = 0;
    let sortEventCount = 0;
    let sortSource: string | undefined;
    grid.on('filter:changed', () => { filterEventCount++; });
    grid.on('sort:changed', (e) => { sortEventCount++; sortSource = e.source; });

    // Remove 'name' column — both its filter and its sort entry are dropped
    grid.setColumns([
      { field: 'age', filter: 'number' },
    ]);

    expect(grid.getFilterModel()).toEqual({});
    expect(grid.getSortModel()).toEqual([]);
    expect(filterEventCount).toBe(1);
    expect(sortEventCount).toBe(1);
    expect(sortSource).toBe('api');
    grid.destroy();
  });
});

describe("condition + selection OR composition", () => {
  it("condition-only filters correctly", () => {
    const state = makeState([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
      { name: "Charlie", age: 35 },
    ], {
      filterModel: {
        name: {
          type: "text",
          operator: "and",
          conditions: [{ operator: "contains", value: "ali" }],
        },
      },
    });
    const rows = displayRows(state);
    expect(rows.map((r) => r.name)).toEqual(["Alice"]);
  });

  it("selection-only filters correctly", () => {
    const state = makeState([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
      { name: "Charlie", age: 35 },
    ], {
      filterModel: {
        name: {
          type: "text",
          operator: "and",
          conditions: [],
          selection: { operator: "in", values: ["bob"] },
        },
      },
    });
    const rows = displayRows(state);
    expect(rows.map((r) => r.name)).toEqual(["Bob"]);
  });

  it("condition + selection returns intersection for the same column", () => {
    const state = makeState([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
      { name: "Charlie", age: 35 },
      { name: "Diana", age: 28 },
    ], {
      filterModel: {
        name: {
          type: "text",
          operator: "and",
          conditions: [{ operator: "contains", value: "ali" }],
          selection: { operator: "in", values: ["charlie"] },
        },
      },
    });
    const rows = displayRows(state);
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it("condition + selection OR does not produce duplicates for overlapping matches", () => {
    const state = makeState([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ], {
      filterModel: {
        name: {
          type: "text",
          operator: "and",
          conditions: [{ operator: "contains", value: "ali" }],
          selection: { operator: "in", values: ["alice"] },
        },
      },
    });
    const rows = displayRows(state);
    expect(rows.map((r) => r.name)).toEqual(["Alice"]);
  });
});

describe('pending fallback — sort', () => {
  const rows: RowData[] = [
    { name: 'Charlie', age: 35 },
    { name: 'Alice', age: 30 },
    { name: 'Bob', age: 25 },
  ];

  it('ASC→DESC pending shows ASC order, not identity', () => {
    const state = makeState(rows, { sortModel: [{ field: 'name', sort: 'asc' }] });
    const ascSnap = state.getSnapshot();
    const ascOrder: string[] = [];
    for (let i = 0; i < ascSnap.rowView.rowCount; i++) {
      ascOrder.push(ascSnap.rowView.getRow(i)!.name as string);
    }
    expect(ascOrder).toEqual(['Alice', 'Bob', 'Charlie']);

    state.setSortModel([{ field: 'name', sort: 'desc' }]);
    state.markSortPending();

    const pendingSnap = state.getSnapshot();
    const pendingOrder: string[] = [];
    for (let i = 0; i < pendingSnap.rowView.rowCount; i++) {
      pendingOrder.push(pendingSnap.rowView.getRow(i)!.name as string);
    }
    expect(pendingOrder).toEqual(['Alice', 'Bob', 'Charlie']);
    expect(pendingOrder).not.toEqual(['Charlie', 'Alice', 'Bob']);
  });

  it('pending fallback clears after applySortedRowOrder', () => {
    const state = makeState(rows, { sortModel: [{ field: 'name', sort: 'asc' }] });
    state.getSnapshot();

    state.setSortModel([{ field: 'name', sort: 'desc' }]);
    state.markSortPending();

    const descOrder = rowIndexExecutionResultToRowOrder(
      { kind: 'indexes', indexes: new Uint32Array([0, 2, 1]) },
    );
    state.applySortedRowOrder(descOrder);

    const snap = state.getSnapshot();
    const order: string[] = [];
    for (let i = 0; i < snap.rowView.rowCount; i++) {
      order.push(snap.rowView.getRow(i)!.name as string);
    }
    expect(order).toEqual(['Charlie', 'Bob', 'Alice']);
  });

  it('clearing sort intentionally returns identity order', () => {
    const state = makeState(rows, { sortModel: [{ field: 'name', sort: 'asc' }] });
    state.getSnapshot();

    state.setSortModel([]);
    const snap = state.getSnapshot();
    const order: string[] = [];
    for (let i = 0; i < snap.rowView.rowCount; i++) {
      order.push(snap.rowView.getRow(i)!.name as string);
    }
    expect(order).toEqual(['Charlie', 'Alice', 'Bob']);
  });

  it('setRows clears sort fallback — no stale order', () => {
    const state = makeState(rows, { sortModel: [{ field: 'name', sort: 'asc' }] });
    state.getSnapshot();

    state.setSortModel([{ field: 'name', sort: 'desc' }]);
    state.markSortPending();

    const newRows: RowData[] = [{ name: 'Zara', age: 20 }, { name: 'Yuki', age: 22 }];
    state.setRows(newRows);

    const snap = state.getSnapshot();
    const order: string[] = [];
    for (let i = 0; i < snap.rowView.rowCount; i++) {
      order.push(snap.rowView.getRow(i)!.name as string);
    }
    expect(order).toEqual(['Zara', 'Yuki']);
  });
});

describe('pending fallback — filter', () => {
  const rows: RowData[] = [
    { name: 'Alice', age: 30 },
    { name: 'Bob', age: 25 },
    { name: 'Charlie', age: 35 },
    { name: 'Diana', age: 28 },
  ];

  it('changing filter model while pending keeps previous filtered order', () => {
    const state = makeState(rows, {
      filterModel: {
        name: { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'a' }] },
      },
    });
    const filteredSnap = state.getSnapshot();
    const filteredNames: string[] = [];
    for (let i = 0; i < filteredSnap.rowView.rowCount; i++) {
      filteredNames.push(filteredSnap.rowView.getRow(i)!.name as string);
    }
    expect(filteredNames).toEqual(['Alice', 'Charlie', 'Diana']);

    state.setFilterModel({
      name: { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'li' }] },
    });
    state.markFilterPending();

    const pendingSnap = state.getSnapshot();
    const pendingNames: string[] = [];
    for (let i = 0; i < pendingSnap.rowView.rowCount; i++) {
      pendingNames.push(pendingSnap.rowView.getRow(i)!.name as string);
    }
    expect(pendingNames).toEqual(['Alice', 'Charlie', 'Diana']);
    expect(pendingNames).not.toEqual(['Alice', 'Bob', 'Charlie', 'Diana']);
  });

  it('applyFilteredRowOrder clears filter fallback', () => {
    const state = makeState(rows, {
      filterModel: {
        name: { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'a' }] },
      },
    });
    state.getSnapshot();

    state.setFilterModel({
      name: { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'li' }] },
    });
    state.markFilterPending();
    applyFilter(state);

    const snap = state.getSnapshot();
    const names: string[] = [];
    for (let i = 0; i < snap.rowView.rowCount; i++) {
      names.push(snap.rowView.getRow(i)!.name as string);
    }
    expect(names).toEqual(['Alice', 'Charlie']);
  });

  it('cell edit on filtered field keeps previous filter order while pending', () => {
    const state = makeState(rows, {
      filterModel: {
        name: { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'a' }] },
      },
    });
    const filteredSnap = state.getSnapshot();
    const filteredNames: string[] = [];
    for (let i = 0; i < filteredSnap.rowView.rowCount; i++) {
      filteredNames.push(filteredSnap.rowView.getRow(i)!.name as string);
    }
    expect(filteredNames).toEqual(['Alice', 'Charlie', 'Diana']);

    state.replaceRowAtSourceIndex(0, { name: 'Alicia', age: 30 }, resolveId);
    state.markFilterPending();

    const pendingSnap = state.getSnapshot();
    const pendingNames: string[] = [];
    for (let i = 0; i < pendingSnap.rowView.rowCount; i++) {
      pendingNames.push(pendingSnap.rowView.getRow(i)!.name as string);
    }
    expect(pendingNames).toEqual(['Alicia', 'Charlie', 'Diana']);
    expect(pendingNames.length).not.toBe(4);
  });

  it('clearing filters returns full rows', () => {
    const state = makeState(rows, {
      filterModel: {
        name: { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'a' }] },
      },
    });
    state.getSnapshot();

    state.setFilterModel({});
    const snap = state.getSnapshot();
    expect(snap.rowView.rowCount).toBe(4);
  });

  it('setRows clears filter fallback — no stale order', () => {
    const state = makeState(rows, {
      filterModel: {
        name: { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'a' }] },
      },
    });
    state.getSnapshot();

    state.setFilterModel({
      name: { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'li' }] },
    });
    state.markFilterPending();

    const newRows: RowData[] = [{ name: 'Zara', age: 20 }];
    state.setRows(newRows);

    const snap = state.getSnapshot();
    expect(snap.rowView.rowCount).toBe(1);
  });
});

describe('pending fallback — filter + sort composition', () => {
  const rows: RowData[] = [
    { name: 'Alice', age: 30 },
    { name: 'Bob', age: 25 },
    { name: 'Charlie', age: 35 },
    { name: 'Diana', age: 28 },
  ];

  function snapNames(state: GridState): string[] {
    const snap = state.getSnapshot();
    const result: string[] = [];
    for (let i = 0; i < snap.rowView.rowCount; i++) {
      result.push(snap.rowView.getRow(i)!.name as string);
    }
    return result;
  }

  it('filter recompute + pending sort keeps previous sorted order', () => {
    const state = makeState(rows, {
      sortModel: [{ field: 'age', sort: 'asc' }],
      filterModel: {
        name: { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'a' }] },
      },
    });
    const stableNames = snapNames(state);
    expect(stableNames).toEqual(['Diana', 'Alice', 'Charlie']);

    state.replaceRowAtSourceIndex(0, { name: 'Alicia', age: 30 }, resolveId);
    applyFilter(state);
    state.markSortPending();

    const pendingNames = snapNames(state);
    expect(pendingNames).toEqual(['Diana', 'Alicia', 'Charlie']);
    expect(pendingNames).not.toEqual(['Alicia', 'Charlie', 'Diana']);

    const descOrder = rowIndexExecutionResultToRowOrder(
      { kind: 'indexes', indexes: new Uint32Array([2, 0, 3]) },
    );
    state.applySortedRowOrder(descOrder);

    const finalNames = snapNames(state);
    expect(finalNames).toEqual(['Charlie', 'Alicia', 'Diana']);
  });
});

describe('no-op config churn must not invalidate caches', () => {
  const rows: RowData[] = [
    { name: 'Alice', age: 30 },
    { name: 'Bob', age: 25 },
    { name: 'Charlie', age: 35 },
    { name: 'Diana', age: 28 },
  ];

  it('equivalent setDefaultColDef does not bump revision or invalidate caches', () => {
    const state = makeState(rows, {
      filterModel: {
        name: { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'a' }] },
      },
    });
    state.getSnapshot();

    const revBefore = (state as unknown as { revision: number }).revision;
    const filterConfigBefore = state.getFilterConfigVersion();

    const changed = state.setDefaultColDef({ sortable: true });
    expect(changed).toBe(false);

    const revAfter = (state as unknown as { revision: number }).revision;
    expect(revAfter).toBe(revBefore);
    expect(state.getFilterConfigVersion()).toBe(filterConfigBefore);
  });

  it('equivalent setDefaultColDef preserves filtered row order', () => {
    const state = makeState(rows, {
      filterModel: {
        name: { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'a' }] },
      },
    });
    const snap1 = state.getSnapshot();
    const order1 = snap1.rowView;

    state.setDefaultColDef({ sortable: true });

    const snap2 = state.getSnapshot();
    expect(snap2.rowView).toBe(order1);
  });

  it('no-op setRowSelection/setColumnSelection/setColumnOrder/setRowDrag return false', () => {
    const state = new GridState({
      columns: [{ field: 'name' }],
      rows,
      rowSelection: { mode: 'multiple', checkboxes: true, headerCheckbox: true },
      columnSelection: { mode: 'multiple' },
      columnOrder: { enabled: true },
      rowDrag: { enabled: true, managed: true },
    });

    expect(state.setRowSelection({ mode: 'multiple', checkboxes: true, headerCheckbox: true })).toBe(false);
    expect(state.setColumnSelection({ mode: 'multiple' })).toBe(false);
    expect(state.setColumnOrder({ enabled: true })).toBe(false);
    expect(state.setRowDrag({ enabled: true, managed: true })).toBe(false);
  });
});

describe('configurable execution thresholds — filter', () => {
  const rows: RowData[] = [
    { name: 'Alice', age: 30 },
    { name: 'Bob', age: 25 },
    { name: 'Charlie', age: 35 },
    { name: 'Diana', age: 28 },
  ];

  it('GridExecutionService defaults to FILTER_OPERATION_THRESHOLD', () => {
    const svc = new GridExecutionService();
    expect(svc.getFilterThreshold()).toBe(FILTER_OPERATION_THRESHOLD);
    svc.destroy();
  });

  it('GridExecutionService accepts custom filter threshold via constructor', () => {
    const svc = new GridExecutionService({ thresholds: { filter: 100 } });
    expect(svc.getFilterThreshold()).toBe(100);
    svc.destroy();
  });

  it('setExecutionOptions updates filter threshold at runtime', () => {
    const svc = new GridExecutionService();
    svc.setExecutionOptions({ thresholds: { filter: 500 } });
    expect(svc.getFilterThreshold()).toBe(500);
    svc.destroy();
  });

  it('setExecutionOptions(undefined) resets filter threshold to default', () => {
    const svc = new GridExecutionService({ thresholds: { filter: 100 } });
    svc.setExecutionOptions(undefined);
    expect(svc.getFilterThreshold()).toBe(FILTER_OPERATION_THRESHOLD);
    svc.destroy();
  });

  it('custom filter threshold below row count triggers async path (markFilterPending)', () => {
    const pendingSpy = vi.spyOn(GridState.prototype, 'markFilterPending');

    const grid = new Grid({
      columns: [
        { field: 'name', filter: 'text' },
        { field: 'age', filter: 'number' },
      ],
      rows,
      execution: { thresholds: { filter: 2 } },
    });

    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });

    expect(pendingSpy).toHaveBeenCalled();
    pendingSpy.mockRestore();
    grid.destroy();
  });

  it('custom filter threshold above row count keeps sync path (no markFilterPending)', () => {
    const pendingSpy = vi.spyOn(GridState.prototype, 'markFilterPending');

    const grid = new Grid({
      columns: [
        { field: 'name', filter: 'text' },
        { field: 'age', filter: 'number' },
      ],
      rows,
      execution: { thresholds: { filter: 500 } },
    });

    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });

    expect(pendingSpy).not.toHaveBeenCalled();
    pendingSpy.mockRestore();
    grid.destroy();
  });

  it('Grid.setExecutionOptions updates filter threshold at runtime and triggers async path', () => {
    const grid = new Grid({
      columns: [
        { field: 'name', filter: 'text' },
        { field: 'age', filter: 'number' },
      ],
      rows,
    });

    grid.setExecutionOptions({ thresholds: { filter: 2 } });

    const pendingSpy = vi.spyOn(GridState.prototype, 'markFilterPending');

    grid.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'a' }],
      },
    });

    expect(pendingSpy).toHaveBeenCalled();
    pendingSpy.mockRestore();
    grid.destroy();
  });
});
