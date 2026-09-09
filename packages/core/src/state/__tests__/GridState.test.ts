import { describe, expect,it, vi } from 'vitest';

import type { RowData, ValueFormatterParams, ValueGetterParams } from '../../types';
import { GridState } from '../GridState';

const baseProps = {
  columns: [{ field: 'n', headerName: 'N' }],
  rows: [{ n: 1 }],
};

describe('GridState', () => {
  it('captures a cold active sort without row reads or synchronous computation', () => {
    const backingRows = Array.from({ length: 100_000 }, (_, index) => ({
      id: `row-${index}`,
      value: 100_000 - index,
    }));
    let numericSourceReads = 0;
    const rows = new Proxy(backingRows, {
      get(target, property, receiver) {
        if (
          typeof property === 'string' &&
          /^(?:0|[1-9]\d*)$/u.test(property)
        ) {
          numericSourceReads++;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const valueGetter = vi.fn((params: ValueGetterParams) => params.row.value);
    const valueFormatter = vi.fn((params: ValueFormatterParams) => String(params.value));
    const sortComparator = vi.fn((a: unknown, b: unknown) => Number(a) - Number(b));
    const getRowId = vi.fn((row: RowData) => String(row.id));
    const state = new GridState({
      rows,
      columns: [{
        field: 'value',
        sortable: true,
        valueGetter,
        valueFormatter,
        sortComparator,
      }],
      getRowId,
      initialSortModel: [{ field: 'value', sort: 'asc' }],
    });
    numericSourceReads = 0;
    valueGetter.mockClear();
    valueFormatter.mockClear();
    sortComparator.mockClear();
    getRowId.mockClear();

    const captured = state.captureReadSnapshot();

    expect(captured.sourceRows).toBe(rows);
    expect(captured.fullView.rows).toBe(rows);
    expect(captured.currentPageView.rows).toBe(rows);
    expect(captured.fullView.rowCount).toBe(100_000);
    expect(captured.fullView.getSourceIndex(99_999)).toBe(99_999);
    expect(numericSourceReads).toBe(0);
    expect(valueGetter).not.toHaveBeenCalled();
    expect(valueFormatter).not.toHaveBeenCalled();
    expect(sortComparator).not.toHaveBeenCalled();
    expect(getRowId).not.toHaveBeenCalled();
    expect(state.needsSortSchedule).toBe(true);
  });

  it('getSnapshot includes columns, data, dataRevision, and rowView', () => {
    const state = new GridState(baseProps);
    const snap = state.getSnapshot();

    expect(snap.columns).toHaveLength(1);
    expect(snap.columns[0]?.field).toBe('n');
    expect(snap.data).toEqual([{ n: 1 }]);
    expect(snap.data).toBe(baseProps.rows);
    expect(snap.dataRevision).toBe(0);
    expect(snap.columnSchemaProvided).toBe(true);
    expect(snap.sortModel).toEqual([]);
    expect(snap.sortPending).toBe(false);
    expect(snap.rowPinState).toBeUndefined();
    expect(snap.rowStylingVersion).toBe(0);
    expect(snap.columnOrder).toEqual({ enabled: false });
    expect('options' in snap).toBe(false);

    // rowView must reference the raw rows and have correct count
    expect(snap.rowView).toBeDefined();
    expect(snap.rowView.rows).toBe(baseProps.rows);
    expect(snap.rowView.rowCount).toBe(1);
    expect(snap.rowView.getRow(0)).toBe(baseProps.rows![0]);
    expect(snap.rowView.getSourceIndex(0)).toBe(0);
  });

  it('merges defaultColDef.cellChangeFlash when column omits it', () => {
    const state = new GridState({
      ...baseProps,
      defaultColDef: { cellChangeFlash: true },
    });
    expect(state.getSnapshot().columns[0]?.cellChangeFlash).toBe(true);
  });

  it('per-column cellChangeFlash false overrides defaultColDef', () => {
    const state = new GridState({
      columns: [
        { field: 'n', cellChangeFlash: false },
        { field: 'm' },
      ],
      rows: [{ n: 1, m: 2 }],
      defaultColDef: { cellChangeFlash: true },
    });
    expect(state.getSnapshot().columns[0]?.cellChangeFlash).toBe(false);
    expect(state.getSnapshot().columns[1]?.cellChangeFlash).toBe(true);
  });

  it('merges defaultColDef flags when column omits them', () => {
    const state = new GridState({
      ...baseProps,
      defaultColDef: {
        visible: true,
        sortable: true,
        filter: true,
        resizable: false,
        reorderable: true,
        pinnable: true,
      },
    });
    const c = state.getSnapshot().columns[0];
    expect(c?.visible).toBe(true);
    expect(c?.sortable).toBe(true);
    expect(c?.filterable).toBe(true);
    expect(c?.resizable).toBe(false);
    expect(c?.reorderable).toBe(true);
    expect(c?.pinnable).toBe(true);
  });

  it('preserves public CSV column options with default inheritance and overrides', () => {
    const state = new GridState({
      rows: [{ inheritedCsv: 'a', overriddenCsv: 'b' }],
      columns: [
        { field: 'inherited' },
        {
          field: 'overridden',
          exportable: true,
          exportValueField: 'overriddenCsv',
        },
      ],
      defaultColDef: {
        exportable: false,
        exportValueField: 'inheritedCsv',
      },
    });

    const read = state.captureReadSnapshot();
    expect(read.allUserLeafColumns[0]).toMatchObject({
      exportable: false,
      exportValueField: 'inheritedCsv',
    });
    expect(read.allUserLeafColumns[1]).toMatchObject({
      exportable: true,
      exportValueField: 'overriddenCsv',
    });
  });

  it('merges defaultColDef.resizable when column omits resizable', () => {
    const state = new GridState({
      ...baseProps,
      defaultColDef: { resizable: false },
    });
    expect(state.getSnapshot().columns[0]?.resizable).toBe(false);
  });

  it('per-column resizable overrides defaultColDef', () => {
    const state = new GridState({
      columns: [{ field: 'n', headerName: 'N', resizable: true }],
      rows: [{ n: 1 }],
      defaultColDef: { resizable: false },
    });
    expect(state.getSnapshot().columns[0]?.resizable).toBe(true);
  });

  it('setColumnWidth is a no-op when defaultColDef disables resizable', () => {
    const state = new GridState({
      columns: [{ field: 'n', width: 100 }],
      rows: [],
      defaultColDef: { resizable: false },
    });
    expect(state.setColumnWidth('n', 200)).toBe(false);
    expect(state.getSnapshot().columns[0]?.width).toBe(100);
  });

  it('setColumnWidth is a no-op when effective column is not resizable', () => {
    const state = new GridState({
      columns: [{ field: 'n', width: 100, resizable: false }],
      rows: [],
    });
    expect(state.setColumnWidth('n', 200)).toBe(false);
    expect(state.getSnapshot().columns[0]?.width).toBe(100);
  });

  it('tracks row count', () => {
    const state = new GridState(baseProps);
    expect(state.getRowCount()).toBe(1);
    state.setRows([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(state.getRowCount()).toBe(3);
  });

  it('hidden column is omitted from snapshot; stored column list unchanged', () => {
    const cols = [
      { field: 'a', width: 10 },
      { field: 'b', visible: false },
    ];
    const state = new GridState({ columns: cols, rows: [{ a: 1, b: 2 }] });
    expect(state.getSnapshot().columns.map((c) => c.field)).toEqual(['a']);
    expect(cols.length).toBe(2);
    expect(state.getVisibleColumnDefs().map((c) => c.field)).toEqual(['a']);
  });

  it('setColumnWidth is a no-op when column is hidden', () => {
    const state = new GridState({
      columns: [{ field: 'n', width: 100, visible: false }],
      rows: [],
    });
    expect(state.setColumnWidth('n', 200)).toBe(false);
    state.setColumns([{ field: 'n', width: 100, visible: true }]);
    expect(state.getSnapshot().columns[0]?.width).toBe(100);
  });

  it('setColumns can show a previously hidden column with width preserved', () => {
    const state = new GridState({
      columns: [{ field: 'price', width: 190, visible: false }],
      rows: [{ price: 5 }],
    });
    expect(state.getSnapshot().columns.length).toBe(0);
    state.setColumns([{ field: 'price', width: 190, visible: true }]);
    expect(state.getSnapshot().columns[0]?.width).toBe(190);
  });

  it('does not clone rows on setRows', () => {
    const state = new GridState({ columns: [], rows: [] });
    const rows = [{ n: 1 }, { n: 2 }];
    state.setRows(rows);
    expect(state.getSnapshot().data).toBe(rows);
  });

  it('maps columns in getSnapshot without mutating stored defs', () => {
    const state = new GridState({ columns: [], rows: [] });
    const cols = [{ field: 'x', headerName: 'X' }];
    state.setColumns(cols);
    const snap = state.getSnapshot();
    expect(snap.columns[0]).toEqual({
      field: 'x',
      headerName: 'X',
      width: undefined,
      flex: undefined,
      visible: true,
      minWidth: undefined,
      maxWidth: undefined,
      resizable: undefined,
      sortable: undefined,
      filterable: false,
      filter: undefined,
      reorderable: undefined,
      pinnable: undefined,
      pinned: undefined,
      editable: undefined,
      editor: undefined,
      sortComparator: undefined,
      valueGetter: undefined,
      valueFormatter: undefined,
      cellKind: undefined,
      actionTrigger: undefined,
      actionsKey: undefined,
      columnMenu: undefined,
      columnSelectable: undefined,
      suppressRowClickSelection: undefined,
      cellClass: undefined,
      getCellClass: undefined,
      cellClassRules: undefined,
      tooltip: undefined,
      tooltipValueGetter: undefined,
      suppressSizeToFit: undefined,
      cellShell: undefined,
    });
    expect(cols[0]).toEqual({ field: 'x', headerName: 'X' });
  });

  it('preserves cellShell shorthand on effective column', () => {
    const state = new GridState({
      columns: [{ field: 'status', cellShell: 'badge' }],
      rows: [{ status: 'active' }],
    });
    expect(state.getSnapshot().columns[0]?.cellShell).toBe('badge');
  });

  it('preserves cellShell config object on effective column', () => {
    const cfg = { kind: 'iconText' as const, icon: 'star', text: 'value' as const };
    const state = new GridState({
      columns: [{ field: 'rating', cellShell: cfg }],
      rows: [{ rating: 5 }],
    });
    expect(state.getSnapshot().columns[0]?.cellShell).toBe(cfg);
  });

  it('cellShell is undefined when not set on column', () => {
    const state = new GridState(baseProps);
    expect(state.getSnapshot().columns[0]?.cellShell).toBeUndefined();
  });

  it('inherits cellShell from defaultColDef when column omits it', () => {
    const state = new GridState({
      columns: [{ field: 'name' }],
      rows: [{ name: 'Alice' }],
      defaultColDef: { cellShell: 'badge' },
    });
    expect(state.getSnapshot().columns[0]?.cellShell).toBe('badge');
  });

  it('per-column cellShell overrides defaultColDef.cellShell', () => {
    const state = new GridState({
      columns: [{ field: 'name', cellShell: 'progress' }],
      rows: [{ name: 'Alice' }],
      defaultColDef: { cellShell: 'badge' },
    });
    expect(state.getSnapshot().columns[0]?.cellShell).toBe('progress');
  });
});
