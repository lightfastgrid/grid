// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { adaptCellRenderers } from '../adaptCellRenderers';

describe('adaptCellRenderers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('commits initial custom row-action content before render returns', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const adapted = adaptCellRenderers({
      customActions: {
        kind: 'actions',
        mode: 'custom',
        render: () => <button type="button">Custom command</button>,
      },
    });
    const renderer = adapted?.customActions;
    expect(renderer?.mode).toBe('custom');
    if (renderer?.mode !== 'custom') {
      throw new Error('Expected a custom row-action renderer');
    }

    const cleanup = renderer.render({
      host,
      row: { id: 'r1' },
      rowIndex: 0,
      rowId: 'r1',
      column: { field: 'actions' },
      grid: { getRows: () => [{ id: 'r1' }] },
      close: () => {},
    });

    expect(host.querySelector('button')?.textContent).toBe('Custom command');
    cleanup?.();
  });
});
