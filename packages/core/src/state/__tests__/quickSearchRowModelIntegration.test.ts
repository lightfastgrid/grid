import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { executeFilterOperation } from '../../execution/operations/filter/filterMainThread';
import { rowIndexExecutionResultToRowOrder } from '../../execution/operations/types';
import { resolveColumnFilterConfigs } from '../../features/filters/resolveColumnFilterConfigs';
import { createIndexedRowOrder } from '../../row-model/rowOrder';
import type { FilterModel, LightFastGridColDef, RowData, SortModel } from '../../types';
import { GridState } from '../GridState';

const here = dirname(fileURLToPath(import.meta.url));
const gridStateSource = readFileSync(join(here, '../GridState.ts'), 'utf8');
const dirtyFieldsSource = readFileSync(
  join(here, '../../features/quick-search/quickSearchDirtyFields.ts'),
  'utf8',
);

const rows: RowData[] = [
  { id: 'a', name: 'Alice', age: 30 },
  { id: 'b', name: 'Bob', age: 25 },
  { id: 'c', name: 'Charlie', age: 35 },
  { id: 'd', name: 'Diana', age: 28 },
];

const resolveId = (row: RowData): string | null => {
  const raw = row.id;
  return raw === null || raw === undefined ? null : String(raw);
};

function makeState(
  sourceRows: RowData[] = rows,
  opts?: {
    sortModel?: SortModel;
    filterModel?: FilterModel;
    columns?: LightFastGridColDef[];
  },
) {
  const state = new GridState({
    columns: opts?.columns ?? [
      { field: 'name', filter: 'text' },
      { field: 'age', filter: 'number' },
    ],
    rows: sourceRows,
    defaultColDef: { sortable: true },
    initialSortModel: opts?.sortModel,
    getRowId: (row) => String(row.id),
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
  const filterModel = state.getFilterModel();
  if (Object.keys(filterModel).length === 0) return;
  const result = executeFilterOperation({
    rows: state.getRows(),
    filterModel,
    columnsByField: stateFilterConfigs(state),
  });
  state.applyFilteredRowOrder(rowIndexExecutionResultToRowOrder(result));
}

function applyQuickSearchOrder(state: GridState, indexes: readonly number[]): void {
  state.applyQuickSearchRowOrder(createIndexedRowOrder(Uint32Array.from(indexes)));
}

function activateQuickSearch(state: GridState, text: string, indexes: readonly number[]): void {
  state.setQuickFilterText(text);
  state.markQuickSearchPending();
  applyQuickSearchOrder(state, indexes);
  state.getSnapshot();
}

function displaySourceIndexes(state: GridState): number[] {
  const snap = state.getSnapshot();
  const result: number[] = [];
  for (let i = 0; i < snap.rowView.rowCount; i++) {
    result.push(snap.rowView.getSourceIndex(i));
  }
  return result;
}

function displayNames(state: GridState): string[] {
  const snap = state.getSnapshot();
  const result: string[] = [];
  for (let i = 0; i < snap.rowView.rowCount; i++) {
    result.push(snap.rowView.getRow(i)!.name as string);
  }
  return result;
}

describe('quick search row-model integration', () => {
  it('composes filter → quick search → sort in pipeline order', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'a' }],
        },
      },
      sortModel: [{ field: 'age', sort: 'asc' }],
    });
    expect(displaySourceIndexes(state)).toEqual([3, 0, 2]);

    activateQuickSearch(state, 'ali', [0, 2]);
    expect(displaySourceIndexes(state)).toEqual([0, 2]);
    expect(displayNames(state)).toEqual(['Alice', 'Charlie']);
  });

  it('empty query clears quick-search result, pending false, and schedules no quick-search work', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'a' }],
        },
      },
    });
    activateQuickSearch(state, 'ali', [0]);
    expect(displaySourceIndexes(state)).toEqual([0]);

    state.setQuickFilterText('');
    state.clearQuickSearchPending();

    expect(state.isQuickFilterPresent()).toBe(false);
    expect(state.isQuickSearchPending()).toBe(false);
    expect(state.needsQuickSearchSchedule).toBe(false);
    expect(displaySourceIndexes(state)).toEqual([0, 2, 3]);
  });

  it('pending quick-search recompute keeps previous quick-search row order visible', () => {
    const state = makeState(rows, {
      filterModel: {
        name: {
          type: 'text',
          operator: 'and',
          conditions: [{ operator: 'contains', value: 'a' }],
        },
      },
    });
    activateQuickSearch(state, 'ali', [0]);
    expect(displaySourceIndexes(state)).toEqual([0]);

    state.setQuickFilterText('charlie');
    expect(state.needsQuickSearchSchedule).toBe(true);
    state.markQuickSearchPending();

    expect(state.isQuickSearchPending()).toBe(true);
    expect(displaySourceIndexes(state)).toEqual([0]);
    expect(displaySourceIndexes(state)).not.toEqual([0, 2, 3]);
  });

  it('dirty unrelated field keeps quick-search row order and render dirty metadata', () => {
    const state = makeState(rows, {
      columns: [
        { field: 'name' },
        { field: 'age', searchable: false },
      ],
    });
    activateQuickSearch(state, 'ali', [0]);
    expect(displaySourceIndexes(state)).toEqual([0]);

    state.replaceRowAtSourceIndex(
      0,
      { id: 'a', name: 'Alice', age: 31 },
      resolveId,
    );

    expect(state.needsQuickSearchSchedule).toBe(false);
    expect(displaySourceIndexes(state)).toEqual([0]);
    const dirty = state.consumeRenderChangeSetForRender();
    expect(dirty?.get('a')).toEqual(new Set(['age']));
  });

  it('dirty searchable field schedules quick-search recompute and keeps old order while pending', () => {
    const state = makeState(rows);
    activateQuickSearch(state, 'ali', [0]);
    expect(displaySourceIndexes(state)).toEqual([0]);

    state.replaceRowAtSourceIndex(
      0,
      { id: 'a', name: 'Alicia', age: 30 },
      resolveId,
    );
    expect(state.needsQuickSearchSchedule).toBe(true);
    state.markQuickSearchPending();

    expect(displaySourceIndexes(state)).toEqual([0]);
  });

  it('dot-path and projection fields invalidate quick search correctly', () => {
    const dotRows: RowData[] = [
      { id: 'a', user: { name: 'Alice' }, notes: 'x', age: 30 },
      { id: 'b', user: { name: 'Bob' }, notes: 'y', age: 25 },
    ];
    const dotState = makeState(dotRows, {
      columns: [{ field: 'user.name' }, { field: 'age', searchable: false }],
    });
    activateQuickSearch(dotState, 'ali', [0]);

    dotState.replaceRowAtSourceIndex(
      0,
      { id: 'a', user: dotRows[0]!.user, notes: 'changed', age: 30 },
      resolveId,
    );
    expect(dotState.needsQuickSearchSchedule).toBe(false);

    dotState.replaceRowAtSourceIndex(
      0,
      { id: 'a', user: { name: 'Alicia' }, notes: 'changed', age: 30 },
      resolveId,
    );
    expect(dotState.needsQuickSearchSchedule).toBe(true);

    const projectionRows: RowData[] = [
      { id: 'a', balance: 100, balanceSearch: '100 1,000', notes: 'x' },
      { id: 'b', balance: 200, balanceSearch: '200 2,000', notes: 'y' },
    ];
    const projectionState = new GridState({
      columns: [
        { field: 'balance', quickFilterTextField: 'balanceSearch' },
        { field: 'notes', searchable: false },
      ],
      rows: projectionRows,
      getRowId: (row) => String(row.id),
    });
    activateQuickSearch(projectionState, '100', [0]);

    projectionState.replaceRowAtSourceIndex(
      0,
      { id: 'a', balance: 100, balanceSearch: '100 1,000', notes: 'changed' },
      resolveId,
    );
    expect(projectionState.needsQuickSearchSchedule).toBe(false);

    projectionState.replaceRowAtSourceIndex(
      0,
      { id: 'a', balance: 100, balanceSearch: '999', notes: 'changed' },
      resolveId,
    );
    expect(projectionState.needsQuickSearchSchedule).toBe(true);
  });

  it('structural append schedules recompute and preserves remapped quick-search order while pending', () => {
    const state = makeState(rows);
    activateQuickSearch(state, 'ali', [0]);
    expect(displaySourceIndexes(state)).toEqual([0]);
    expect(displayNames(state)).toEqual(['Alice']);

    state.applyStoreTransaction({ add: [{ id: 'e', name: 'Eve', age: 40 }] }, resolveId);
    expect(state.needsQuickSearchSchedule).toBe(true);
    state.markQuickSearchPending();

    expect(displaySourceIndexes(state)).toEqual([0]);
    expect(displayNames(state)).toEqual(['Alice']);
  });

  it('structural insert at head preserves matched row identity while pending', () => {
    const state = makeState(rows);
    activateQuickSearch(state, 'ali', [0]);
    expect(displayNames(state)).toEqual(['Alice']);

    state.applyStoreTransaction(
      { add: [{ id: 'e', name: 'Eve', age: 40 }], addIndex: 0 },
      resolveId,
    );
    state.markQuickSearchPending();

    expect(displayNames(state)).toEqual(['Alice']);
    expect(displayNames(state)).not.toEqual(['Eve']);
    expect(displaySourceIndexes(state)).toEqual([1]);
  });

  it('structural remove before matched row falls back when remapped order is empty', () => {
    const state = makeState(rows);
    activateQuickSearch(state, 'ali', [0]);
    expect(displayNames(state)).toEqual(['Alice']);

    state.applyStoreTransaction({ remove: [rows[0]!] }, resolveId);
    state.markQuickSearchPending();

    expect(displayNames(state)).not.toEqual(['Alice']);
    expect(displaySourceIndexes(state)).toHaveLength(3);
  });

  it('row reorder remaps quick-search fallback by row id while pending', () => {
    const state = makeState(rows);
    activateQuickSearch(state, 'ali', [0]);
    expect(displayNames(state)).toEqual(['Alice']);

    const moved = state.moveRowsByIds('b', ['b'], 0, (row) => resolveId(row)!);
    expect(moved?.changed).toBe(true);
    expect(state.needsQuickSearchSchedule).toBe(true);
    state.markQuickSearchPending();

    expect(displayNames(state)).toEqual(['Alice']);
    expect(displayNames(state)).not.toEqual(['Bob']);
  });

  it('quickFilter includeHiddenColumns affects searchable invalidation in GridState', () => {
    const state = new GridState({
      columns: [
        { field: 'name' },
        { field: 'secret', visible: false },
      ],
      rows: [{ id: 'a', name: 'Alice', secret: 'hidden' }],
      quickFilter: { includeHiddenColumns: false },
    });
    activateQuickSearch(state, 'ali', [0]);

    state.replaceRowAtSourceIndex(
      0,
      { id: 'a', name: 'Alice', secret: 'changed' },
      resolveId,
    );
    expect(state.needsQuickSearchSchedule).toBe(false);

    state.setQuickFilterOptions({ includeHiddenColumns: true });
    expect(state.needsQuickSearchSchedule).toBe(true);
  });

  it('filter model change invalidates quick-search sourceIndexes without requiring snapshot rebuild hooks', () => {
    const state = makeState(rows);
    activateQuickSearch(state, 'ali', [0]);
    expect(state.needsQuickSearchSchedule).toBe(false);

    state.setFilterModel({
      name: {
        type: 'text',
        operator: 'and',
        conditions: [{ operator: 'contains', value: 'li' }],
      },
    });
    expect(state.needsQuickSearchSchedule).toBe(true);
    expect(state.needsFilterSchedule).toBe(true);
  });

  it('state and feature helpers stay on intended orchestration boundaries', () => {
    expect(dirtyFieldsSource).not.toMatch(/from ['"].*\/rendering\//);
    expect(dirtyFieldsSource).not.toMatch(/column-menu/);
    expect(dirtyFieldsSource).not.toMatch(/@lightfastgrid\/react/);
    expect(dirtyFieldsSource).not.toMatch(/execution\/operations\/quick-search/);

    expect(gridStateSource).toMatch(/features\/quick-search\/quickSearchDependencyPlan/);
    expect(gridStateSource).not.toMatch(/QuickSearchWorkerClient/);
    expect(gridStateSource).not.toMatch(/quickSearchWorkerRuntime/);
    expect(gridStateSource).not.toMatch(/quickSearchMainThreadFallback/);
    expect(gridStateSource).not.toMatch(/\bgetCachedQuickSearchPlan\b/);
    expect(gridStateSource).not.toMatch(/\binvalidateQuickSearchDependencyPlan\b/);
  });
});
