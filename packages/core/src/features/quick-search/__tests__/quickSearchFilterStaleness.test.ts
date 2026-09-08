import { afterEach, describe, expect, it, vi } from 'vitest';

import { GridExecutionService } from '../../../execution/GridExecutionService';
import type { QuickSearchTaskCompletion } from '../../../execution/GridTaskTypes';
import type { QuickSearchOperationInput } from '../../../execution/operations/quick-search';
import { Grid } from '../../../Grid';
import type { GridState } from '../../../state/GridState';
import type { FilterModel, LightFastGridColDef, RowData } from '../../../types';

const rows: RowData[] = [
  { id: '1', name: 'Alice', city: 'Lahore', age: 30 },
  { id: '2', name: 'Bob', city: 'London', age: 25 },
  { id: '3', name: 'Charlie', city: 'Paris', age: 35 },
];

const columns: LightFastGridColDef[] = [
  { field: 'name', filter: 'text' as const },
  { field: 'city', headerName: 'City' },
  { field: 'age', filter: 'number' as const, searchable: false },
];

const broadFilter: FilterModel = {
  name: {
    type: 'text',
    operator: 'and',
    conditions: [{ operator: 'contains', value: 'a' }],
  },
};

const narrowFilter: FilterModel = {
  name: {
    type: 'text',
    operator: 'and',
    conditions: [{ operator: 'contains', value: 'alice' }],
  },
};

function displayNames(state: GridState): string[] {
  const snap = state.getSnapshot();
  const result: string[] = [];
  for (let i = 0; i < snap.rowView.rowCount; i++) {
    result.push(snap.rowView.getRow(i)!.name as string);
  }
  return result;
}

function gridState(grid: Grid): GridState {
  return (grid as unknown as { state: GridState }).state;
}

function makeCompletion(
  state: GridState,
  overrides: Partial<QuickSearchTaskCompletion> & {
    result: QuickSearchTaskCompletion['result'];
  },
): QuickSearchTaskCompletion {
  return {
    kind: 'quickSearch',
    requestId: 1,
    producer: 'mainThread',
    quickFilterText: state.getQuickFilterText(),
    searchableFieldsSignature: state.getQuickSearchSearchableFieldsSignature(),
    filterModel: state.getFilterModel(),
    filteredOrderVersion: state.getFilteredOrderVersion(),
    sourceLayoutRevision: state.getQuickSearchSourceLayoutRevision(),
    searchableDataRevision: state.getQuickSearchSearchableDataRevision(),
    ...overrides,
  };
}

describe('quick search filter staleness guards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects stale quick-search completion after filter model changes', () => {
    let capturedCompletion: ((completion: QuickSearchTaskCompletion) => void) | null =
      null;

    vi.spyOn(GridExecutionService.prototype, 'scheduleQuickSearch').mockImplementation(
      (_input, onComplete) => {
        capturedCompletion = onComplete;
        return 1;
      },
    );
    vi.spyOn(GridExecutionService.prototype, 'scheduleFilter').mockImplementation(
      (_rows, filterModel, _configs, onComplete) => {
        const value = filterModel.name?.conditions[0]?.value;
        const indexes =
          value === 'alice'
            ? Uint32Array.from([0])
            : Uint32Array.from([0, 1, 2]);
        onComplete({
          kind: 'filter',
          requestId: 1,
          result: { kind: 'indexes', indexes },
          producer: 'mainThread',
          filterModel,
          sourceRows: rows,
        });
        return 1;
      },
    );

    const grid = new Grid({
      columns,
      rows,
      getRowId: (row) => String(row.id),
    });
    grid.setFilterModel(broadFilter);
    grid.setQuickFilterText('a');

    expect(capturedCompletion).not.toBeNull();
    const state = gridState(grid);

    grid.setFilterModel(narrowFilter);

    capturedCompletion!(
      makeCompletion(state, {
        filterModel: broadFilter,
        filteredOrderVersion: 0,
        result: { kind: 'indexes', indexes: Uint32Array.from([0, 1, 2]) },
      }),
    );

    expect(state.needsQuickSearchSchedule).toBe(true);
    expect(displayNames(state)).toEqual(['Alice']);
  });

  it('accepts in-flight completion after unrelated COW rows-identity change', () => {
    const callbacks: Array<(completion: QuickSearchTaskCompletion) => void> = [];
    const inputs: QuickSearchOperationInput[] = [];
    const onPending = vi.fn();

    vi.spyOn(GridExecutionService.prototype, 'scheduleQuickSearch').mockImplementation(
      (input, onComplete) => {
        inputs.push(input);
        callbacks.push(onComplete);
        return callbacks.length;
      },
    );

    const grid = new Grid({
      columns,
      rows,
      getRowId: (row) => String(row.id),
      onQuickSearchPendingChanged: onPending,
    });
    const state = gridState(grid);
    const rowsBefore = state.getRows();

    grid.setQuickFilterText('a');

    expect(callbacks).toHaveLength(1);
    expect(state.isQuickSearchPending()).toBe(true);
    expect(onPending).toHaveBeenCalledWith({ pending: true });

    const scheduled = inputs[0]!;
    const originalCallback = callbacks[0]!;
    const layoutRev = state.getQuickSearchSourceLayoutRevision();
    const dataRev = state.getQuickSearchSearchableDataRevision();

    grid.applyTransaction({
      update: [{ id: '1', name: 'Alice', city: 'Lahore', age: 99 }],
    });

    const rowsAfter = state.getRows();
    expect(rowsAfter).not.toBe(rowsBefore);
    expect(state.getQuickSearchSourceLayoutRevision()).toBe(layoutRev);
    expect(state.getQuickSearchSearchableDataRevision()).toBe(dataRev);
    expect(callbacks).toHaveLength(1);
    expect(state.isQuickSearchPending()).toBe(true);

    originalCallback(
      makeCompletion(state, {
        quickFilterText: scheduled.quickFilterText,
        searchableFieldsSignature: scheduled.searchableFieldsSignature,
        filterModel: scheduled.filterModel,
        filteredOrderVersion: scheduled.filteredOrderVersion,
        sourceLayoutRevision: scheduled.sourceLayoutRevision,
        searchableDataRevision: scheduled.searchableDataRevision,
        result: { kind: 'indexes', indexes: Uint32Array.from([0, 2]) },
      }),
    );

    expect(state.isQuickSearchPending()).toBe(false);
    expect(state.needsQuickSearchSchedule).toBe(false);
    expect(displayNames(state)).toEqual(['Alice', 'Charlie']);
    expect(onPending.mock.calls.filter((c) => c[0].pending === false)).toHaveLength(1);
  });

  it('rejects stale quick-search completion after searchable data revision bumps', () => {
    const callbacks: Array<(completion: QuickSearchTaskCompletion) => void> = [];
    const inputs: QuickSearchOperationInput[] = [];

    vi.spyOn(GridExecutionService.prototype, 'scheduleQuickSearch').mockImplementation(
      (input, onComplete) => {
        inputs.push(input);
        callbacks.push(onComplete);
        return callbacks.length;
      },
    );

    const grid = new Grid({
      columns,
      rows,
      getRowId: (row) => String(row.id),
    });
    const state = gridState(grid);
    grid.setQuickFilterText('a');

    expect(callbacks).toHaveLength(1);
    const original = {
      callback: callbacks[0]!,
      input: inputs[0]!,
    };
    expect(state.getQuickSearchSearchableDataRevision()).toBe(
      original.input.searchableDataRevision,
    );

    grid.applyTransaction({
      update: [{ id: '1', name: 'Alicia', city: 'Lahore', age: 30 }],
    });

    expect(callbacks.length).toBeGreaterThan(1);
    expect(state.getQuickSearchSearchableDataRevision()).toBeGreaterThan(
      original.input.searchableDataRevision,
    );
    expect(state.getQuickSearchSourceLayoutRevision()).toBe(
      original.input.sourceLayoutRevision,
    );
    expect(state.needsQuickSearchSchedule).toBe(true);
    expect(state.isQuickSearchPending()).toBe(true);

    original.callback(
      makeCompletion(state, {
        quickFilterText: original.input.quickFilterText,
        searchableFieldsSignature: original.input.searchableFieldsSignature,
        filterModel: original.input.filterModel,
        filteredOrderVersion: original.input.filteredOrderVersion,
        sourceLayoutRevision: original.input.sourceLayoutRevision,
        searchableDataRevision: original.input.searchableDataRevision,
        result: { kind: 'indexes', indexes: Uint32Array.from([0, 1, 2]) },
      }),
    );

    expect(state.needsQuickSearchSchedule).toBe(true);
    expect(state.isQuickSearchPending()).toBe(true);
  });

  it('rejects stale quick-search completion after source layout revision bumps', () => {
    const callbacks: Array<(completion: QuickSearchTaskCompletion) => void> = [];
    const inputs: QuickSearchOperationInput[] = [];

    vi.spyOn(GridExecutionService.prototype, 'scheduleQuickSearch').mockImplementation(
      (input, onComplete) => {
        inputs.push(input);
        callbacks.push(onComplete);
        return callbacks.length;
      },
    );

    const grid = new Grid({
      columns,
      rows,
      getRowId: (row) => String(row.id),
    });
    const state = gridState(grid);
    grid.setQuickFilterText('a');

    expect(callbacks).toHaveLength(1);
    const original = {
      callback: callbacks[0]!,
      input: inputs[0]!,
    };
    const oldLayoutRevision = original.input.sourceLayoutRevision;

    grid.applyTransaction({
      add: [{ id: '4', name: 'Dana', city: 'Austin', age: 40 }],
    });

    expect(state.getQuickSearchSourceLayoutRevision()).toBeGreaterThan(oldLayoutRevision);
    expect(callbacks.length).toBeGreaterThan(1);
    expect(state.needsQuickSearchSchedule).toBe(true);
    expect(state.isQuickSearchPending()).toBe(true);

    // Every guard current except the captured layout revision.
    original.callback(
      makeCompletion(state, {
        sourceLayoutRevision: oldLayoutRevision,
        result: { kind: 'indexes', indexes: Uint32Array.from([0, 2]) },
      }),
    );

    expect(state.needsQuickSearchSchedule).toBe(true);
    expect(state.isQuickSearchPending()).toBe(true);
    expect(displayNames(state)).not.toEqual(['Alice', 'Charlie']);
  });

  it('non-searchable update does not bump searchableDataRevision', () => {
    const grid = new Grid({
      columns,
      rows,
      getRowId: (row) => String(row.id),
      quickFilterText: 'a',
    });
    const state = gridState(grid);
    const dataRev = state.getQuickSearchSearchableDataRevision();
    const layoutRev = state.getQuickSearchSourceLayoutRevision();

    grid.applyTransaction({
      update: [{ id: '1', name: 'Alice', city: 'Lahore', age: 99 }],
    });

    expect(state.getQuickSearchSearchableDataRevision()).toBe(dataRev);
    expect(state.getQuickSearchSourceLayoutRevision()).toBe(layoutRev);
  });

  it('cancels in-flight quick search when filter model changes', () => {
    const cancelSpy = vi.spyOn(GridExecutionService.prototype, 'cancelQuickSearch');

    const grid = new Grid({
      columns,
      rows,
      getRowId: (row) => String(row.id),
      quickFilterText: 'a',
    });

    grid.setFilterModel(broadFilter);

    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it('clearing last filter while quick search is active schedules quick search over full rows', () => {
    const grid = new Grid({
      columns,
      rows,
      getRowId: (row) => String(row.id),
      quickFilterText: 'a',
    });

    grid.setFilterModel(broadFilter);

    grid.clearFilters();

    const state = gridState(grid);
    const names = displayNames(state);
    expect(names).toEqual(['Alice', 'Charlie']);
  });
});
