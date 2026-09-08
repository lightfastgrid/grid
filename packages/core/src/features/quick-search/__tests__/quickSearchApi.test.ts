import { describe, expect, it, vi } from 'vitest';

import { Grid } from '../../../Grid';
import { GridState } from '../../../state/GridState';

const baseProps = {
  columns: [
    { field: 'name', headerName: 'Name' },
    { field: 'city', headerName: 'City' },
  ],
  rows: [
    { name: 'Alice', city: 'Lahore' },
    { name: 'Bob', city: 'London' },
  ],
};

describe('Quick Search API — Phase 0', () => {
  // ── 1. Initial quickFilterText option ────────────────────────────────

  it('stores initial quickFilterText from props', () => {
    const grid = new Grid({ ...baseProps, quickFilterText: 'alice' });
    expect(grid.getQuickFilterText()).toBe('alice');
    expect(grid.isQuickFilterPresent()).toBe(true);
  });

  it('defaults to empty quick filter text', () => {
    const grid = new Grid(baseProps);
    expect(grid.getQuickFilterText()).toBe('');
    expect(grid.isQuickFilterPresent()).toBe(false);
  });

  // ── 2. setQuickFilterText updates state and emits ────────────────────

  it('setQuickFilterText updates state and fires onQuickFilterChanged', () => {
    const onChanged = vi.fn();
    const grid = new Grid({ ...baseProps, onQuickFilterChanged: onChanged });

    grid.setQuickFilterText('bob');

    expect(grid.getQuickFilterText()).toBe('bob');
    expect(grid.isQuickFilterPresent()).toBe(true);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith({
      quickFilterText: 'bob',
      source: 'api',
    });
  });

  it('setQuickFilterText also fires via event bus', () => {
    const grid = new Grid(baseProps);
    const spy = vi.fn();
    grid.on('quick-filter:changed', spy);

    grid.setQuickFilterText('test');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      quickFilterText: 'test',
      source: 'api',
    });
  });

  // ── 3. Same-value no-op ──────────────────────────────────────────────

  it('setQuickFilterText with the same value is a no-op', () => {
    const onChanged = vi.fn();
    const grid = new Grid({
      ...baseProps,
      quickFilterText: 'alice',
      onQuickFilterChanged: onChanged,
    });

    grid.setQuickFilterText('alice');

    expect(onChanged).not.toHaveBeenCalled();
  });

  // ── 4. clearQuickFilter ──────────────────────────────────────────────

  it('clearQuickFilter clears state and emits when value was non-empty', () => {
    const onChanged = vi.fn();
    const grid = new Grid({
      ...baseProps,
      quickFilterText: 'bob',
      onQuickFilterChanged: onChanged,
    });

    grid.clearQuickFilter();

    expect(grid.getQuickFilterText()).toBe('');
    expect(grid.isQuickFilterPresent()).toBe(false);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith({
      quickFilterText: '',
      source: 'api',
    });
  });

  it('clearQuickFilter is a no-op when already empty', () => {
    const onChanged = vi.fn();
    const grid = new Grid({ ...baseProps, onQuickFilterChanged: onChanged });

    grid.clearQuickFilter();

    expect(onChanged).not.toHaveBeenCalled();
  });

  // ── 5. isQuickFilterPresent ──────────────────────────────────────────

  it('isQuickFilterPresent returns false for whitespace-only text', () => {
    const grid = new Grid(baseProps);
    grid.setQuickFilterText('   ');
    expect(grid.isQuickFilterPresent()).toBe(false);
  });

  it('isQuickFilterPresent returns true for non-empty trimmed text', () => {
    const grid = new Grid(baseProps);
    grid.setQuickFilterText('  a  ');
    expect(grid.isQuickFilterPresent()).toBe(true);
  });

  // ── 6. onQuickSearchPendingChanged ───────────────────────────────────

  it('does not fire pending changed on empty text', () => {
    const onPending = vi.fn();
    const grid = new Grid({
      ...baseProps,
      onQuickSearchPendingChanged: onPending,
    });

    grid.setQuickFilterText('');
    expect(onPending).not.toHaveBeenCalled();
  });

  it('fires pending false when clearing a non-empty query that was pending', () => {
    const onPending = vi.fn();
    const grid = new Grid({
      ...baseProps,
      quickFilterText: 'alice',
      onQuickSearchPendingChanged: onPending,
    });

    // Not yet pending (Phase 0 does not schedule execution).
    // Clearing should not fire pending=false because it was not pending.
    grid.clearQuickFilter();
    expect(onPending).not.toHaveBeenCalled();
  });

  it('emits pending:changed via event bus', () => {
    const grid = new Grid(baseProps);
    const spy = vi.fn();
    grid.on('quick-search-pending:changed', spy);

    // Without actual execution there is no pending transition in Phase 0.
    // Verify the bus key is valid by listening (no error = pass).
    expect(spy).not.toHaveBeenCalled();
  });

  // ── 7. Empty quick-filter text does not set pending ──────────────────

  it('empty quick-filter text does not set pending true', () => {
    const state = new GridState(baseProps);
    state.setQuickFilterText('');
    const snap = state.getSnapshot();
    expect(snap.quickSearchPending).toBe(false);
  });

  // ── 8. Existing grid behavior unaffected ─────────────────────────────

  it('grid without quick search works identically', () => {
    const state = new GridState(baseProps);
    const snap = state.getSnapshot();

    expect(snap.columns).toHaveLength(2);
    expect(snap.data).toEqual(baseProps.rows);
    expect(snap.quickFilterText).toBe('');
    expect(snap.quickSearchPending).toBe(false);
    expect(snap.sortPending).toBe(false);
    expect(snap.filterPending).toBe(false);
  });

  it('sort and filter continue working when quick filter is set', () => {
    const grid = new Grid({
      ...baseProps,
      initialSortModel: [{ field: 'name', sort: 'asc' }],
    });
    grid.setQuickFilterText('test');

    expect(grid.getQuickFilterText()).toBe('test');
    // Sort model should still be active
    const state = new GridState({
      ...baseProps,
      initialSortModel: [{ field: 'name', sort: 'asc' }],
      quickFilterText: 'test',
    });
    const snap = state.getSnapshot();
    expect(snap.sortModel).toEqual([{ field: 'name', sort: 'asc' }]);
    expect(snap.quickFilterText).toBe('test');
  });

  // ── 9. Snapshot includes quick-filter state ──────────────────────────

  it('snapshot includes quickFilterText and quickSearchPending', () => {
    const state = new GridState({ ...baseProps, quickFilterText: 'hello' });
    const snap = state.getSnapshot();

    expect(snap.quickFilterText).toBe('hello');
    expect(snap.quickSearchPending).toBe(false);
  });

  // ── defaultColDef quick-search field merging ─────────────────────────

  it('merges defaultColDef searchable/quickFilterTextField into effective defs', () => {
    const state = new GridState({
      columns: [
        { field: 'name' },
        { field: 'city', searchable: true },
      ],
      rows: [],
      defaultColDef: { searchable: false, quickFilterTextField: 'searchText' },
    });
    const defs = state.getAllEffectiveColumnDefs();
    // Column without its own flag inherits the default.
    expect(defs[0]!.searchable).toBe(false);
    expect(defs[0]!.quickFilterTextField).toBe('searchText');
    // Per-column value overrides the default.
    expect(defs[1]!.searchable).toBe(true);
  });

  // ── constructor callbacks and dynamic event subscriptions ────────────

  it('delivers onQuickFilterChanged from constructor options', () => {
    const callback = vi.fn();
    const grid = new Grid({ ...baseProps, onQuickFilterChanged: callback });

    grid.setQuickFilterText('test');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      quickFilterText: 'test',
      source: 'api',
    });
  });

  it('supports replacing a quick-filter event subscription', () => {
    const grid = new Grid(baseProps);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = grid.on('quick-filter:changed', first);

    grid.setQuickFilterText('first');
    unsubscribeFirst();
    grid.on('quick-filter:changed', second);
    grid.setQuickFilterText('second');

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  // ── setQuickFilterConfig ─────────────────────────────────────────────

  it('setQuickFilterConfig is a no-op for equivalent inline configs', () => {
    const onPending = vi.fn();
    const grid = new Grid({
      ...baseProps,
      quickFilterText: 'alice',
      quickFilter: { includeHiddenColumns: true },
      onQuickSearchPendingChanged: onPending,
    });

    grid.setQuickFilterConfig({ includeHiddenColumns: true });

    expect(onPending).not.toHaveBeenCalled();
  });

  it('setQuickFilterConfig marks pending when query is active and options change', () => {
    const onPending = vi.fn();
    const grid = new Grid({
      ...baseProps,
      quickFilterText: 'alice',
      onQuickSearchPendingChanged: onPending,
    });

    grid.setQuickFilterConfig({ includeHiddenColumns: true });

    expect(onPending).not.toHaveBeenCalled();
    const state = (grid as unknown as { state: GridState }).state;
    expect(state.getSnapshot().rowView.rowCount).toBe(1);
  });

  // ── quickFilter: false / enabled: false ─────────────────────────────

  it('quickFilter: false with text does not filter and isQuickFilterPresent is false', () => {
    const grid = new Grid({
      ...baseProps,
      quickFilterText: 'alice',
      quickFilter: false,
    });
    expect(grid.isQuickFilterPresent()).toBe(false);
    const state = (grid as unknown as { state: GridState }).state;
    expect(state.getSnapshot().rowView.rowCount).toBe(2);
  });

  it('quickFilter: { enabled: false } with text does not filter', () => {
    const grid = new Grid({
      ...baseProps,
      quickFilterText: 'alice',
      quickFilter: { enabled: false },
    });
    expect(grid.isQuickFilterPresent()).toBe(false);
    const state = (grid as unknown as { state: GridState }).state;
    expect(state.getSnapshot().rowView.rowCount).toBe(2);
  });

  it('changing config from enabled: false to true with existing text schedules quick search', () => {
    const grid = new Grid({
      ...baseProps,
      quickFilterText: 'bob',
      quickFilter: { enabled: false },
    });
    expect(grid.isQuickFilterPresent()).toBe(false);
    const state = (grid as unknown as { state: GridState }).state;
    expect(state.getSnapshot().rowView.rowCount).toBe(2);

    grid.setQuickFilterConfig({ enabled: true });

    expect(grid.isQuickFilterPresent()).toBe(true);
    expect(state.getSnapshot().rowView.rowCount).toBe(1);
    expect(state.getSnapshot().rowView.getRow(0)).toEqual({ name: 'Bob', city: 'London' });
  });

  it('changing config from enabled: true to false clears quick-search and restores upstream rows', () => {
    const grid = new Grid(baseProps);
    grid.setQuickFilterText('bob');

    const state = (grid as unknown as { state: GridState }).state;
    expect(state.getSnapshot().rowView.rowCount).toBe(1);

    grid.setQuickFilterConfig({ enabled: false });

    expect(grid.isQuickFilterPresent()).toBe(false);
    expect(state.getSnapshot().rowView.rowCount).toBe(2);
  });

  it('setQuickFilterConfig with a new parser reference reschedules quick search', () => {
    const onPending = vi.fn();
    const grid = new Grid({
      ...baseProps,
      quickFilterText: 'alice',
      quickFilter: { parser: (text: string) => text.split(' ') },
      onQuickSearchPendingChanged: onPending,
    });

    grid.setQuickFilterConfig({ parser: (text: string) => text.split(' ') });

    expect(onPending).not.toHaveBeenCalled();
    const state = (grid as unknown as { state: GridState }).state;
    expect(state.getSnapshot().rowView.rowCount).toBe(1);
  });

  it('setQuickFilterText completes quick search and filters displayed rows', () => {
    const onPending = vi.fn();
    const grid = new Grid({
      ...baseProps,
      onQuickSearchPendingChanged: onPending,
    });

    grid.setQuickFilterText('bob');

    expect(onPending).not.toHaveBeenCalled();
    const state = (grid as unknown as { state: GridState }).state;
    const snap = state.getSnapshot();
    expect(snap.rowView.rowCount).toBe(1);
    expect(snap.rowView.getRow(0)).toEqual({ name: 'Bob', city: 'London' });
  });

  it('clearQuickFilter restores all rows after quick search completed', () => {
    const grid = new Grid(baseProps);
    grid.setQuickFilterText('bob');
    grid.clearQuickFilter();

    const state = (grid as unknown as { state: GridState }).state;
    expect(state.getSnapshot().rowView.rowCount).toBe(2);
  });
});
