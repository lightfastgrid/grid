// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type { GridContext } from '../../../context/GridContext';
import { Grid } from '../../../Grid';
import { SELECTION_COLUMN_FIELD } from '../../../internal/selectionColumn';
import { CSS } from '../../../rendering/const/css-classes';
import { HEADER_HEIGHT, ROW_HEIGHT } from '../../../rendering/helpers/gridConstants';
import * as populateRowModule from '../../../rendering/helpers/populateRow';
import type { GridState } from '../../../state/GridState';
import type {
  LightFastGridSelectionChangedEvent,
  RowData,
  RowSelectionOptions,
  SelectionChange,
  SelectionChangeKind,
  SelectionChangeSource,
  SelectionSnapshot,
} from '../../../types';

function selChange(
  kind: SelectionChangeKind,
  changedIds: string[],
  selection: SelectionSnapshot,
): SelectionChange {
  return { kind, changedIds, selection };
}

function dispatchSelectionChangeForTest(
  grid: Grid,
  change: SelectionChange,
  source: SelectionChangeSource,
): void {
  (
    grid as unknown as {
      dispatchSelectionChange(
        change: SelectionChange,
        source: SelectionChangeSource,
      ): void;
    }
  ).dispatchSelectionChange(change, source);
}

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Let queueMicrotask(fn) from checkbox handling run (after native default). */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

function firstDataRow(container: HTMLElement): HTMLElement | null {
  return container.querySelector(`.${CSS.ROW}`);
}

describe('Grid selection API', () => {
  it('getSelectedRowIds returns ids after row click', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '300px', width: '500px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ k: 'a' }, { k: 'b' }] as RowData[],
      columns: [{ field: 'k' }],
      rowSelection: 'single',
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const row = firstDataRow(container);
    expect(row).toBeTruthy();
    row!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );

    await flushRenders();
    const ids = grid.getSelectedRowIds();
    expect(ids.length).toBe(1);
    expect(ids[0]).toMatch(/^auto:\d+$/);

    grid.destroy();
    container.remove();
  });

  it('getSelectedRows maps ids to row objects using user getRowId', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '260px', width: '440px' });
    document.body.appendChild(container);

    const r1 = { id: 'u1', v: 1 } as RowData;
    const grid = new Grid({
      rows: [r1],
      columns: [{ field: 'v' }],
      rowSelection: 'single',
      suppressRowVirtualization: true,
      getRowId: (row) => row.id,
    });
    grid.mount(container);
    await flushRenders();

    firstDataRow(container)?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual(['u1']);
    expect(grid.getSelectedRows()).toEqual([r1]);

    grid.destroy();
    container.remove();
  });

  it('auto ids resolve getSelectedRows without mutating row objects', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '260px', width: '440px' });
    document.body.appendChild(container);

    const row = Object.freeze({ x: 1 } as RowData);
    const keysBefore = Object.keys(row);

    const grid = new Grid({
      rows: [row],
      columns: [{ field: 'x' }],
      rowSelection: 'single',
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    firstDataRow(container)?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();

    const rows = grid.getSelectedRows();
    expect(rows).toEqual([row]);
    expect(Object.keys(row)).toEqual(keysBefore);

    grid.destroy();
    container.remove();
  });

  it('onSelectionChanged receives ids, rows, changed*, and source click', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '280px', width: '480px' });
    document.body.appendChild(container);

    const spy = vi.fn();
    const r0 = { id: 'z0', n: 0 } as RowData;

    const grid = new Grid({
      rows: [r0],
      columns: [{ field: 'n' }],
      rowSelection: 'single',
      suppressRowVirtualization: true,
      getRowId: (row) => row.id,
      onSelectionChanged: spy,
    });
    grid.mount(container);
    await flushRenders();

    firstDataRow(container)?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();

    expect(spy).toHaveBeenCalledTimes(1);
    const e = spy.mock.calls[0]![0]!;
    expect(e.source).toBe("click");
    expect(e.changeKind).toBe("single");
    expect(e.selectionType).toBe("explicit");
    expect(e.selectedRowIds).toEqual(["z0"]);
    expect(e.selectedCount).toBe(1);
    expect(e.getSelectedRows()).toEqual([r0]);
    expect(e.changedRowIds).toContain('z0');
    expect(e.changedRows).toEqual([r0]);

    grid.destroy();
    container.remove();
  });

  it('clearSelection clears store, DOM, and emits api clear event', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '280px', width: '480px' });
    document.body.appendChild(container);

    const spy = vi.fn();
    const r0 = { id: 'c0', n: 0 } as RowData;

    const grid = new Grid({
      rows: [r0],
      columns: [{ field: 'n' }],
      rowSelection: 'single',
      suppressRowVirtualization: true,
      getRowId: (row) => row.id,
      onSelectionChanged: spy,
    });
    grid.mount(container);
    await flushRenders();

    firstDataRow(container)?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();
    spy.mockClear();

    grid.clearSelection();
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual([]);
    expect(grid.getSelectedRows()).toEqual([]);
    const rowEl = firstDataRow(container);
    expect(rowEl?.classList.contains('lfg-row-selected')).toBe(false);

    expect(spy).toHaveBeenCalledTimes(1);
    const e = spy.mock.calls[0]![0]!;
    expect(e.source).toBe("api");
    expect(e.changeKind).toBe("clear");
    expect(e.selectionType).toBe("explicit");
    expect(e.selectedRowIds).toEqual([]);
    expect(e.selectedCount).toBe(0);
    expect(e.getSelectedRows()).toEqual([]);
    expect(e.changedRowIds).toEqual([]);
    expect(e.changedRows).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it('string multiple: plain body replaces selection; Ctrl click toggles in', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '200px', width: '400px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: 'm0' }, { id: 'm1' }] as RowData[],
      columns: [{ field: 'id' }],
      rowSelection: 'multiple',
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const rows = container.querySelectorAll(`.${CSS.ROW}`);
    rows[0]!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(['m0']);

    rows[1]!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(['m1']);

    rows[0]!.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: true,
      }),
    );
    await flushRenders();
    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(['m0', 'm1']));

    grid.destroy();
    container.remove();
  });

  it('string none: row click does not select', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '200px', width: '400px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: 'n0' }] as RowData[],
      columns: [{ field: 'id' }],
      rowSelection: 'none',
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    firstDataRow(container)?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it('object multiple with body click: row body selects when enableRowClickSelection true', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '200px', width: '400px' });
    document.body.appendChild(container);

    const cfg: RowSelectionOptions = {
      mode: 'multiple',
      checkboxes: false,
      headerCheckbox: false,
      enableRowClickSelection: true,
    };

    const grid = new Grid({
      rows: [{ id: 'o0' }] as RowData[],
      columns: [{ field: 'id' }],
      rowSelection: cfg,
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    firstDataRow(container)?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual(['o0']);

    grid.destroy();
    container.remove();
  });

  it('checkbox-only: body click ignored; checkbox click selects', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '200px', width: '400px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: 'cb0', v: 1 }] as RowData[],
      columns: [{ field: 'v' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        enableRowClickSelection: false,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const row = firstDataRow(container)!;
    const cell = row.querySelector(`.${CSS.CELL}`);
    expect(cell).toBeTruthy();
    cell!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual([]);

    // Checkbox is in center row (unpinned by default)
    const checkbox = container.querySelector(
      '.lfg-row-selection-checkbox',
    ) as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    checkbox!.click();
    await flushMicrotasks();
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(['cb0']);

    grid.destroy();
    container.remove();
  });

  it('header checkbox: selects all then second click clears', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '220px', width: '400px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: 'h0', v: 0 },
        { id: 'h1', v: 1 },
      ] as RowData[],
      columns: [{ field: 'v' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const kinds: SelectionChangeKind[] = [];
    grid.on('selection:changed', (e) => kinds.push(e.changeKind));

    const headerCb = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement | null;
    expect(headerCb).toBeTruthy();
    expect(headerCb!.tagName).toBe('INPUT');
    expect(headerCb!.type).toBe('checkbox');

    headerCb!.click();
    await flushMicrotasks();
    await flushRenders();
    expect(kinds[0]).toBe('selectAll');
    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(['h0', 'h1']));

    expect(headerCb!.checked).toBe(true);
    expect(headerCb!.indeterminate).toBe(false);

    headerCb!.click();
    await flushMicrotasks();
    await flushRenders();
    expect(kinds[1]).toBe('clear');
    expect(grid.getSelectedRowIds()).toEqual([]);
    expect(headerCb!.checked).toBe(false);

    grid.destroy();
    container.remove();
  });

  it('virtualization: selection class, aria, and checkbox restore after scroll', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '120px', width: '400px' });
    document.body.appendChild(container);

    const rows = Array.from({ length: 80 }, (_, i) => ({
      id: `s${i}`,
      n: i,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [{ field: 'n' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
        enableRowClickSelection: true,
      },
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    expect(viewport).toBeTruthy();

    const firstRow = firstDataRow(container)!;
    firstRow.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();

    const selectedId = grid.getSelectedRowIds()[0];
    expect(selectedId).toMatch(/^s\d+$/);

    viewport.scrollTop = 50 * ROW_HEIGHT;
    await flushRenders();
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual([selectedId]);

    viewport.scrollTop = 0;
    await flushRenders();
    await flushRenders();

    const restored = container.querySelector(
      `[data-row-id="${selectedId}"]`,
    ) as HTMLElement | null;
    expect(restored).toBeTruthy();
    expect(restored!.classList.contains('lfg-row-selected')).toBe(true);
    expect(restored!.getAttribute('aria-selected')).toBe('true');
    const restoredCb = restored!.querySelector(
      '.lfg-row-selection-checkbox',
    ) as HTMLInputElement;
    expect(restoredCb.checked).toBe(true);

    grid.destroy();
    container.remove();
  });

  it('does not attach click listeners to pooled row roots (delegation only)', async () => {
    const orig = HTMLElement.prototype.addEventListener;
    const rowTargets: HTMLElement[] = [];
    const wrap = vi
      .spyOn(HTMLElement.prototype, 'addEventListener')
      .mockImplementation(function (
        this: HTMLElement,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (type === 'click' && this.classList.contains(CSS.ROW)) {
          rowTargets.push(this);
        }
        return orig.call(this, type, listener, options);
      });

    const container = document.createElement('div');
    Object.assign(container.style, { height: '200px', width: '400px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: 'd0' }] as RowData[],
      columns: [{ field: 'id' }],
      rowSelection: 'single',
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    expect(rowTargets).toEqual([]);

    wrap.mockRestore();
    grid.destroy();
    container.remove();
  });

  it('row checkbox is a real input; click toggles checked and selection', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '200px', width: '400px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: 'chk0', v: 1 }] as RowData[],
      columns: [{ field: 'v' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        enableRowClickSelection: false,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    // Checkbox is in center row (unpinned by default)
    const cb = container.querySelector(
      '.lfg-row-selection-checkbox',
    ) as HTMLInputElement;
    expect(cb).toBeTruthy();
    expect(cb.tagName).toBe('INPUT');
    expect(cb.type).toBe('checkbox');

    cb.click();
    await flushMicrotasks();
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual(['chk0']);
    expect(cb.checked).toBe(true);

    cb.click();
    await flushMicrotasks();
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual([]);
    expect(cb.checked).toBe(false);

    grid.destroy();
    container.remove();
  });

  it('header checkbox indeterminate when only some rows selected', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '240px', width: '400px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: 'i0', v: 0 },
        { id: 'i1', v: 1 },
      ] as RowData[],
      columns: [{ field: 'v' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
        enableRowClickSelection: false,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const headerCb = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement;
    const row0 = container.querySelector('[data-row-id="i0"]')!;
    const rowCb = row0.querySelector(
      '.lfg-row-selection-checkbox',
    ) as HTMLInputElement;

    rowCb.click();
    await flushMicrotasks();
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual(['i0']);
    expect(headerCb.checked).toBe(false);
    expect(headerCb.indeterminate).toBe(true);

    grid.destroy();
    container.remove();
  });

  it('header checkbox does not render for single mode even when requested', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '200px', width: '400px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: 's0', v: 0 }] as RowData[],
      columns: [{ field: 'v' }],
      rowSelection: {
        mode: 'single',
        checkboxes: true,
        headerCheckbox: true,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    expect(container.querySelector('.lfg-header-selection-checkbox')).toBeNull();

    grid.destroy();
    container.remove();
  });

  it('row and header checkbox elements exist after pool rebuild (same rowSelection)', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '72px', width: '400px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: Array.from({ length: 50 }, (_, i) => ({
        id: `rb${i}`,
        v: i,
      })) as RowData[],
      columns: [{ field: 'v' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
      },
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    // Checkbox is in center row (unpinned by default)
    expect(container.querySelector('.lfg-row-selection-checkbox'))
      .toBeTruthy();
    expect(container.querySelector('.lfg-header-selection-checkbox')).toBeTruthy();

    Object.assign(container.style, { height: '400px' });
    await flushRenders();
    await flushRenders();
    await flushRenders();

    expect(container.querySelector('.lfg-row-selection-checkbox'))
      .toBeTruthy();
    expect(container.querySelector('.lfg-header-selection-checkbox')).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it('checkboxes inject internal selection column; state snapshot keeps user columns only', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '220px', width: '440px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: 'inj0', v: 1 }] as RowData[],
      columns: [{ field: 'v', headerName: 'V' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const snap = (grid as unknown as { state: GridState }).state.getSnapshot();
    expect(snap.columns).toHaveLength(1);
    expect(snap.columns[0]?.field).toBe('v');

    // Selection column header is in the center header row (unpinned by default)
    expect(
      container.querySelector(
        `.lfg-header-cell[data-col-id="${SELECTION_COLUMN_FIELD}"]`,
      ),
    ).toBeTruthy();
    // Selection column cells are in center body rows
    const selCell = container.querySelector(
      `.${CSS.CELL}[data-col-id="${SELECTION_COLUMN_FIELD}"]`,
    );
    expect(selCell).toBeTruthy();
    expect(selCell?.querySelector('.lfg-row-selection-checkbox')).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it('setColumnWidth ignores internal selection column; resize handle hidden', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '200px', width: '400px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: 'w0', v: 1 }] as RowData[],
      columns: [{ field: 'v', width: 120 }],
      rowSelection: { mode: 'multiple', checkboxes: true },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const spy = vi.fn();
    grid.on('column:resized', spy);
    grid.setColumnWidth(SELECTION_COLUMN_FIELD, 400);
    expect(spy).not.toHaveBeenCalled();

    const handle = container.querySelector(
      `.lfg-header-cell[data-col-id="${SELECTION_COLUMN_FIELD}"] .lfg-resize-handle`,
    ) as HTMLElement | null;
    expect(handle?.style.display).toBe('none');

    grid.destroy();
    container.remove();
  });

  it('header select-all with 100k rows does not resolve row ids for every row on the click path', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '120px', width: '400px' });
    document.body.appendChild(container);

    const rows = Array.from({ length: 100_000 }, (_, i) => ({
      id: `b${i}`,
      n: i,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [{ field: 'n' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
      },
      getRowId: (r) => (r as { id: string }).id,
    });

    const ctx = (grid as unknown as { ctx: GridContext }).ctx;
    let resolveCalls = 0;
    const orig = ctx.resolveRowId.bind(ctx);
    ctx.resolveRowId = (row, idx) => {
      resolveCalls++;
      return orig(row, idx);
    };

    grid.mount(container);
    await flushRenders();

    const spy = vi.fn();
    grid.on('selection:changed', spy);

    const headerCb = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement;
    expect(headerCb).toBeTruthy();

    const beforeClick = resolveCalls;
    headerCb!.click();
    await flushMicrotasks();
    await flushRenders();
    const duringClick = resolveCalls - beforeClick;

    expect(spy).toHaveBeenCalledTimes(1);
    const e = spy.mock.calls[0]![0] as LightFastGridSelectionChangedEvent;
    expect(e.changeKind).toBe('selectAll');
    expect(e.selectionType).toBe('all');
    expect(e.selectedCount).toBe(100_000);
    expect(e.selectedRowIds).toBeUndefined();
    expect(e.changedRowIds).toEqual([]);
    expect(e.getSelectedRowIds()).toHaveLength(100_000);
    expect(duringClick).toBeLessThan(2500);

    grid.destroy();
    container.remove();
  });

  it('after header select-all, scrolled-in rows render as selected', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '120px', width: '400px' });
    document.body.appendChild(container);

    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: `v${i}`,
      n: i,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [{ field: 'n' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const headerCb = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement;
    headerCb!.click();
    await flushMicrotasks();
    await flushRenders();

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollTop = 150 * ROW_HEIGHT;
    await flushRenders();
    await flushRenders();

    const rowEl = container.querySelector(
      '[data-row-id="v150"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    expect(rowEl!.classList.contains('lfg-row-selected')).toBe(true);
    const cb = rowEl!.querySelector(
      '.lfg-row-selection-checkbox',
    ) as HTMLInputElement;
    expect(cb.checked).toBe(true);

    grid.destroy();
    container.remove();
  });

  it('after header select-all with vertical virtualization, recycle restores first row selection visuals', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '120px', width: '400px' });
    document.body.appendChild(container);

    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: `vz${i}`,
      n: i,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [{ field: 'n' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
      },
      suppressRowVirtualization: false,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const headerCb = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement;
    expect(headerCb).toBeTruthy();
    headerCb!.click();
    await flushMicrotasks();
    await flushRenders();

    // Checkbox is in center row (unpinned by default)
    const firstRowCb = container.querySelector(
      '.lfg-row-selection-checkbox',
    ) as HTMLInputElement;
    expect(firstRowCb.checked).toBe(true);

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollTop = HEADER_HEIGHT + 80 * ROW_HEIGHT;
    viewport.dispatchEvent(new Event('scroll'));
    await flushRenders();
    await flushRenders();

    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event('scroll'));
    await flushRenders();
    await flushRenders();

    const rowEl = container.querySelector(
      `.${CSS.ROW}[data-row-id="vz0"]`,
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    expect(rowEl!.classList.contains('lfg-row-selected')).toBe(true);
    expect(
      rowEl!.querySelector('.lfg-row-selection-checkbox'),
    ).toBeTruthy();
    const cb = rowEl!.querySelector(
      '.lfg-row-selection-checkbox',
    ) as HTMLInputElement;
    expect(cb.checked).toBe(true);

    grid.destroy();
    container.remove();
  });

  it('after header select-all with vertical virtualization, far scrolled-in row renders as selected', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '120px', width: '400px' });
    document.body.appendChild(container);

    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: `vf${i}`,
      n: i,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [{ field: 'n' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
      },
      suppressRowVirtualization: false,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const headerCb = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement;
    headerCb!.click();
    await flushMicrotasks();
    await flushRenders();

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollTop = HEADER_HEIGHT + 150 * ROW_HEIGHT;
    viewport.dispatchEvent(new Event('scroll'));
    await flushRenders();
    await flushRenders();

    const rowEl = container.querySelector(
      '[data-row-id="vf150"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    expect(rowEl!.classList.contains('lfg-row-selected')).toBe(true);
    const cb = rowEl!.querySelector(
      '.lfg-row-selection-checkbox',
    ) as HTMLInputElement;
    expect(cb.checked).toBe(true);

    grid.destroy();
    container.remove();
  });

  it('header checkbox restores after horizontal scroll when all rows selected', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '200px', width: '320px' });
    document.body.appendChild(container);

    const colCount = 36;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `hx${i}`,
      width: 120,
    }));

    const rows = Array.from({ length: 15 }, (_, r) => {
      const row: Record<string, unknown> = { id: `hall${r}` };
      for (let i = 0; i < colCount; i++) row[`hx${i}`] = r;
      return row as RowData;
    });

    const grid = new Grid({
      rows,
      columns,
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: false,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const headerCb0 = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement;
    expect(headerCb0).toBeTruthy();
    headerCb0.click();
    await flushMicrotasks();
    await flushRenders();

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollLeft = 8000;
    viewport.dispatchEvent(new Event('scroll'));
    await flushRenders();
    await flushRenders();

    viewport.scrollLeft = 0;
    viewport.dispatchEvent(new Event('scroll'));
    await flushRenders();
    await flushRenders();

    const headerCb = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement;
    expect(headerCb).toBeTruthy();
    expect(headerCb.checked).toBe(true);
    expect(headerCb.indeterminate).toBe(false);

    grid.destroy();
    container.remove();
  });

  it('header checkbox restores indeterminate after horizontal scroll when partially selected', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '200px', width: '320px' });
    document.body.appendChild(container);

    const colCount = 36;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `hp${i}`,
      width: 120,
    }));

    const rows = Array.from({ length: 15 }, (_, r) => {
      const row: Record<string, unknown> = { id: `part${r}` };
      for (let i = 0; i < colCount; i++) row[`hp${i}`] = r;
      return row as RowData;
    });

    const grid = new Grid({
      rows,
      columns,
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: false,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const row0 = container.querySelector(
      '[data-row-id="part0"]',
    ) as HTMLElement;
    const rowCb = row0.querySelector(
      '.lfg-row-selection-checkbox',
    ) as HTMLInputElement;
    rowCb.click();
    await flushMicrotasks();
    await flushRenders();

    const headerBefore = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement;
    expect(headerBefore.indeterminate).toBe(true);
    expect(headerBefore.checked).toBe(false);

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollLeft = 8000;
    viewport.dispatchEvent(new Event('scroll'));
    await flushRenders();
    await flushRenders();

    viewport.scrollLeft = 0;
    viewport.dispatchEvent(new Event('scroll'));
    await flushRenders();
    await flushRenders();

    const headerCb = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement;
    expect(headerCb).toBeTruthy();
    expect(headerCb.checked).toBe(false);
    expect(headerCb.indeterminate).toBe(true);

    grid.destroy();
    container.remove();
  });

  it('micro-scroll inside unchanged row/column window does not call populateRow; recycle still binds selection', async () => {
    const populateRowSpy = vi.spyOn(populateRowModule, 'populateRow');

    const container = document.createElement('div');
    Object.assign(container.style, { height: '120px', width: '400px' });
    document.body.appendChild(container);

    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: `perf${i}`,
      n: i,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [{ field: 'n' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
      },
      suppressRowVirtualization: false,
      suppressColumnVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const headerCb = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement;
    headerCb!.click();
    await flushMicrotasks();
    await flushRenders();

    populateRowSpy.mockClear();

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    const baseTop = viewport.scrollTop;
    for (let i = 0; i < 10; i++) {
      viewport.scrollTop = baseTop + (i + 1) * 6;
      viewport.dispatchEvent(new Event('scroll'));
      await flushRenders();
    }

    expect(populateRowSpy).not.toHaveBeenCalled();

    populateRowSpy.mockClear();
    viewport.scrollTop = HEADER_HEIGHT + 95 * ROW_HEIGHT;
    viewport.dispatchEvent(new Event('scroll'));
    await flushRenders();
    await flushRenders();

    expect(populateRowSpy.mock.calls.length).toBeGreaterThan(0);

    const rowEl = container.querySelector(
      '[data-row-id="perf95"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    expect(rowEl!.classList.contains('lfg-row-selected')).toBe(true);
    const cb = rowEl!.querySelector(
      '.lfg-row-selection-checkbox',
    ) as HTMLInputElement;
    expect(cb.checked).toBe(true);

    populateRowSpy.mockRestore();
    grid.destroy();
    container.remove();
  });

  it('after select-all, toggling one row excludes it and updates header state', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '240px', width: '400px' });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [
        { id: 'x0', v: 0 },
        { id: 'x1', v: 1 },
      ] as RowData[],
      columns: [{ field: 'v' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
        enableRowClickSelection: false,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const headerCb = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement;
    headerCb!.click();
    await flushMicrotasks();
    await flushRenders();

    const row1 = container.querySelector('[data-row-id="x1"]')!;
    const rowCb = row1.querySelector(
      '.lfg-row-selection-checkbox',
    ) as HTMLInputElement;
    rowCb.click();
    await flushMicrotasks();
    await flushRenders();

    expect(grid.getSelectedRowIds()).toEqual(['x0']);
    expect(headerCb.indeterminate).toBe(true);
    expect(headerCb.checked).toBe(false);

    grid.destroy();
    container.remove();
  });
});

describe('selection:changed payload (lazy selected rows)', () => {
  it('does not resolve all selected rows until getSelectedRows()', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: `id_${i}`,
      v: i,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [{ field: 'v' }],
      getRowId: (r) => (r as { id: string }).id,
      rowSelection: 'multiple',
    });

    const ctx = (grid as unknown as { ctx: GridContext }).ctx;
    let resolveCalls = 0;
    const orig = ctx.resolveRowId.bind(ctx);
    ctx.resolveRowId = (row, idx) => {
      resolveCalls++;
      return orig(row, idx);
    };

    let last: LightFastGridSelectionChangedEvent | undefined;
    grid.on('selection:changed', (e) => {
      last = e;
    });

    const manySelected = rows.map((r) => (r as { id: string }).id);
    dispatchSelectionChangeForTest(
      grid,
      selChange('toggle', ['id_0'], {
        type: 'explicit',
        ids: manySelected,
        selectedCount: 100,
      }),
      'api',
    );

    expect(last?.selectionType).toBe('explicit');
    expect(resolveCalls).toBe(1);
    expect(last?.selectedCount).toBe(100);
    expect(last?.changedRows).toEqual([rows[0]]);

    resolveCalls = 0;
    const resolved = last!.getSelectedRows();
    expect(resolved).toEqual(rows);
    expect(resolveCalls).toBe(100);

    resolveCalls = 0;
    expect(last!.getSelectedRows()).toBe(resolved);
    expect(resolveCalls).toBe(0);

    grid.destroy();
  });

  it('forEachSelectedRow yields rows in selectedRowIds order', () => {
    const r0 = { id: 'a', n: 0 } as RowData;
    const r1 = { id: 'b', n: 1 } as RowData;
    const r2 = { id: 'c', n: 2 } as RowData;

    const grid = new Grid({
      rows: [r0, r1, r2],
      columns: [{ field: 'n' }],
      getRowId: (row) => row.id,
      rowSelection: 'multiple',
    });

    const collected: RowData[] = [];
    grid.on('selection:changed', (e) => {
      e.forEachSelectedRow((row) => collected.push(row));
    });

    dispatchSelectionChangeForTest(
      grid,
      selChange('toggle', ['c'], {
        type: 'explicit',
        ids: ['c', 'a'],
        selectedCount: 2,
      }),
      'api',
    );

    expect(collected).toEqual([r2, r0]);

    grid.destroy();
  });

  it('mounted select-all uses all model: selectedRowIds omitted, lazy resolvers work', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, { height: '200px', width: '400px' });
    document.body.appendChild(container);

    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: `z${i}`,
      n: i,
    })) as RowData[];

    const grid = new Grid({
      rows,
      columns: [{ field: 'n' }],
      rowSelection: {
        mode: 'multiple',
        checkboxes: true,
        headerCheckbox: true,
      },
      suppressRowVirtualization: true,
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    let last: LightFastGridSelectionChangedEvent | undefined;
    grid.on('selection:changed', (e) => {
      last = e;
    });

    const headerCb = container.querySelector(
      '.lfg-header-selection-checkbox',
    ) as HTMLInputElement;
    headerCb!.click();
    await flushMicrotasks();
    await flushRenders();

    expect(last?.selectionType).toBe('all');
    expect(last?.selectedRowIds).toBeUndefined();
    expect(last?.getSelectedRowIds()).toHaveLength(40);
    const collected: RowData[] = [];
    last?.forEachSelectedRow((r) => collected.push(r));
    expect(collected).toHaveLength(40);

    grid.destroy();
    container.remove();
  });
});

describe('resolveSelectionRows (single scan)', () => {
  it('getSelectedRows preserves id order and matches changedRows for single-id change', () => {
    const r0 = { id: 'a', n: 0 } as RowData;
    const r1 = { id: 'b', n: 1 } as RowData;
    const r2 = { id: 'c', n: 2 } as RowData;

    const grid = new Grid({
      rows: [r0, r1, r2],
      columns: [{ field: 'n' }],
      getRowId: (row) => row.id,
      rowSelection: 'multiple',
    });

    const received: unknown[] = [];
    grid.on('selection:changed', (p) => {
      received.push(p);
    });

    dispatchSelectionChangeForTest(
      grid,
      selChange('toggle', ['c'], {
        type: 'explicit',
        ids: ['c', 'a'],
        selectedCount: 2,
      }),
      'api',
    );

    expect(received).toHaveLength(1);
    const e = received[0] as LightFastGridSelectionChangedEvent;
    expect(e.selectedRowIds).toEqual(['c', 'a']);
    expect(e.selectedCount).toBe(2);
    expect(e.getSelectedRows()).toEqual([r2, r0]);
    expect(e.changedRowIds).toEqual(['c']);
    expect(e.changedRows).toEqual([r2]);

    grid.destroy();
  });

  it('omits unresolved ids while keeping matched rows aligned to id order', () => {
    const row = { k: 'ok' } as RowData;

    const grid = new Grid({
      rows: [row],
      columns: [{ field: 'k' }],
      getRowId: () => 'known',
      rowSelection: 'single',
    });

    const received: unknown[] = [];
    grid.on('selection:changed', (p) => received.push(p));

    dispatchSelectionChangeForTest(
      grid,
      selChange('toggle', ['ghost'], {
        type: 'explicit',
        ids: ['known', 'ghost'],
        selectedCount: 2,
      }),
      'api',
    );

    expect(received).toHaveLength(1);
    const e = received[0] as LightFastGridSelectionChangedEvent;
    expect(e.getSelectedRows()).toEqual([row]);
    expect(e.changedRows).toEqual([]);

    grid.destroy();
  });

  it('stops calling resolveRowId after all union ids are found', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ i }) as RowData);
    const grid = new Grid({
      rows: data,
      columns: [{ field: 'i' }],
      getRowId: (_r, index) => `rid_${index}`,
      rowSelection: 'single',
    });

    const ctx = (grid as unknown as { ctx: GridContext }).ctx;
    let resolveCalls = 0;
    const orig = ctx.resolveRowId.bind(ctx);
    ctx.resolveRowId = (row, idx) => {
      resolveCalls++;
      return orig(row, idx);
    };

    dispatchSelectionChangeForTest(
      grid,
      selChange('toggle', ['rid_0'], {
        type: 'explicit',
        ids: ['rid_0', 'rid_1'],
        selectedCount: 2,
      }),
      'api',
    );

    expect(resolveCalls).toBe(1);

    resolveCalls = 0;
    dispatchSelectionChangeForTest(
      grid,
      selChange('toggle', ['nosuch'], {
        type: 'explicit',
        ids: ['rid_49'],
        selectedCount: 1,
      }),
      'api',
    );

    expect(resolveCalls).toBe(50);

    grid.destroy();
  });

  it('preserves duplicate id entries as duplicate refs in payload order', () => {
    const r1 = { id: 'same', tag: 'x' } as RowData;
    const grid = new Grid({
      rows: [r1],
      columns: [{ field: 'tag' }],
      getRowId: () => 'same',
      rowSelection: 'single',
    });

    const payloads: unknown[] = [];
    grid.on('selection:changed', (p) => payloads.push(p));

    dispatchSelectionChangeForTest(
      grid,
      selChange('toggle', ['same'], {
        type: 'explicit',
        ids: ['same', 'same'],
        selectedCount: 2,
      }),
      'api',
    );

    const e = payloads[0] as LightFastGridSelectionChangedEvent;
    expect(e.getSelectedRows()).toEqual([r1, r1]);
    expect(e.changedRows).toEqual([r1]);

    grid.destroy();
  });
});
