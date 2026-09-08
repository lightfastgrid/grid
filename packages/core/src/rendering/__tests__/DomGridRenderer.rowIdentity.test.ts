// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { Grid } from '../../Grid';
import type { RowData } from '../../types';
import { CSS } from '../const/css-classes';

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function rowIdForFirstCellText(container: HTMLElement, text: string): string | null {
  const rows = container.querySelectorAll(`.${CSS.ROW}`);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!(row instanceof HTMLElement)) continue;
    const cells = row.querySelectorAll(`.${CSS.CELL}`);
    const first = cells.item(0);
    if (first instanceof HTMLElement && first.textContent === text) {
      return row.getAttribute('data-row-id');
    }
  }
  return null;
}

describe('DomGridRenderer + row identity', () => {
  it('preserves auto data-row-id when the same objects are reordered (no user getRowId)', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, {
      height: '400px',
      width: '600px',
      position: 'fixed',
      top: '0',
      left: '0',
    });
    document.body.appendChild(container);

    const rowA = { name: 'A uniq' } as RowData;
    const rowB = { name: 'B uniq' } as RowData;

    const grid = new Grid({
      rows: [rowA, rowB],
      columns: [{ field: 'name' }],
      suppressRowVirtualization: true,
    });
    grid.mount(container);

    await flushRenders();

    const idBInitially = rowIdForFirstCellText(container, 'B uniq');
    expect(idBInitially).toBeTruthy();

    grid.setRows([rowB, rowA]);

    await flushRenders();

    const idBAfterReorder = rowIdForFirstCellText(container, 'B uniq');
    expect(idBAfterReorder).toBe(idBInitially);

    grid.destroy();
    container.remove();
  });

  it('uses user getRowId for data-row-id when provided', async () => {
    const container = document.createElement('div');
    Object.assign(container.style, {
      height: '200px',
      width: '400px',
    });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: 'r1', v: 1 }] as RowData[],
      columns: [{ field: 'v' }],
      suppressRowVirtualization: true,
      getRowId: (row: RowData) => row.id,
    });
    grid.mount(container);

    await flushRenders();

    expect(rowIdForFirstCellText(container, '1')).toBe('r1');

    grid.destroy();
    container.remove();
  });
});
