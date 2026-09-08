import { describe, expect, it, vi } from 'vitest';

import { Grid } from '../../Grid';

describe('Grid', () => {
  it('creates a grid instance', () => {
    const grid = new Grid({
      columns: [{ field: 'name', headerName: 'Name' }],
      rows: [{ name: 'Test' }],
    });
    expect(grid).toBeDefined();
    expect(grid.getRowCount()).toBe(1);
  });

  it('emits data:updated on setRows with the new row count', () => {
    const grid = new Grid({ columns: [], rows: [] });
    const received: number[] = [];
    grid.on('data:updated', ({ rowCount }) => received.push(rowCount));
    grid.setRows([{ name: 'A' }, { name: 'B' }]);
    expect(received).toEqual([2]);
  });

  it('emits columns:updated on setColumns', () => {
    const grid = new Grid({ columns: [], rows: [] });
    const spy = vi.fn();
    grid.on('columns:updated', spy);
    grid.setColumns([
      { field: 'a', headerName: 'A' },
      { field: 'b', headerName: 'B' },
    ]);
    expect(spy).toHaveBeenCalledWith({ columnCount: 2 });
  });

  it('emits columns:updated with leaf count for grouped input', () => {
    const grid = new Grid({ columns: [], rows: [] });
    const spy = vi.fn();
    grid.on('columns:updated', spy);
    grid.setColumns([
      {
        headerName: 'Group',
        children: [
          { field: 'a', headerName: 'A' },
          { field: 'b', headerName: 'B' },
        ],
      },
      { field: 'c', headerName: 'C' },
    ]);
    expect(spy).toHaveBeenCalledWith({ columnCount: 3 });
  });

  it('emits column:resized when setColumnWidth updates a column', () => {
    const grid = new Grid({
      columns: [{ field: 'a', width: 100 }],
      rows: [],
    });
    const received: Array<{ field: string; width: number }> = [];
    grid.on('column:resized', (p) => {
      received.push(p);
    });
    grid.setColumnWidth('a', 220);
    expect(received).toEqual([{ field: 'a', width: 220 }]);
  });

  it('delivers constructor callbacks through the event bridge once', () => {
    const onColumnResized = vi.fn();
    const grid = new Grid({
      columns: [{ field: 'a', width: 100 }],
      rows: [],
      onColumnResized,
    });
    const listener = vi.fn();
    grid.on('column:resized', listener);

    grid.setColumnWidth('a', 220);

    expect(onColumnResized).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    expect(onColumnResized.mock.calls[0]![0]).toBe(listener.mock.calls[0]![0]);
    grid.destroy();
  });

  it('captures constructor callbacks while preserving direct event subscriptions', () => {
    const onQuickFilterChanged = vi.fn();
    const replacement = vi.fn();
    const listener = vi.fn();
    const options = {
      columns: [{ field: 'a' }],
      rows: [],
      onQuickFilterChanged,
    };
    const grid = new Grid(options);
    grid.on('quick-filter:changed', listener);

    options.onQuickFilterChanged = replacement;
    grid.setQuickFilterText('captured');

    expect(onQuickFilterChanged).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
    grid.destroy();
  });

  it('isolates a throwing constructor callback from sibling observers', () => {
    const failure = new Error('observer failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    const grid = new Grid({
      columns: [{ field: 'a', width: 100 }],
      rows: [],
      onColumnResized: () => {
        throw failure;
      },
    });
    grid.on('column:resized', listener);

    expect(() => grid.setColumnWidth('a', 220)).not.toThrow();

    expect(listener).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalled();
    grid.destroy();
  });

  it('does not emit column:resized when column is not resizable', () => {
    const grid = new Grid({
      columns: [{ field: 'a', width: 100, resizable: false }],
      rows: [],
    });
    const spy = vi.fn();
    grid.on('column:resized', spy);
    grid.setColumnWidth('a', 220);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not emit column:resized when defaultColDef disables resize', () => {
    const grid = new Grid({
      columns: [{ field: 'a', width: 100 }],
      rows: [],
      defaultColDef: { resizable: false },
    });
    const spy = vi.fn();
    grid.on('column:resized', spy);
    grid.setColumnWidth('a', 220);
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when mutating after destroy', () => {
    const grid = new Grid({ columns: [], rows: [] });
    grid.destroy();
    expect(() => grid.setRows([])).toThrow(/destroyed/);
  });
});
