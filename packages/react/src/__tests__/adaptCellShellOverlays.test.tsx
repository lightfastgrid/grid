// @vitest-environment jsdom
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import type { CellShellOverlayRenderContext } from '@lightfastgrid/core';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { adaptCellShellOverlays } from '../adaptCellShellOverlays';
import type {
  ReactCellShellOverlayRegistry,
} from '../types';

function makeCoreCtx(
  overrides?: Partial<CellShellOverlayRenderContext>,
): CellShellOverlayRenderContext {
  return {
    host: document.createElement('div'),
    overlayKey: 'test',
    rowId: 'r1',
    rowIndex: 0,
    field: 'name',
    column: { field: 'name' },
    row: { id: 'r1' },
    value: 'v',
    formattedValue: 'v',
    anchor: document.createElement('div'),
    originalEvent: new MouseEvent('click'),
    close: () => {},
    ...overrides,
  };
}

describe('adaptCellShellOverlays', () => {
  it('returns undefined when input is undefined', () => {
    expect(adaptCellShellOverlays(undefined)).toBeUndefined();
  });

  it('preserves registry keys', () => {
    const registry: ReactCellShellOverlayRegistry = {
      'game-info': {
        kind: 'cell-shell-overlay',
        render: () => null,
      },
      'detail-panel': {
        kind: 'cell-shell-overlay',
        render: () => null,
      },
    };
    const adapted = adaptCellShellOverlays(registry)!;
    expect(Object.keys(adapted)).toEqual(['game-info', 'detail-panel']);
    expect(adapted['game-info']!.kind).toBe('cell-shell-overlay');
    expect(adapted['detail-panel']!.kind).toBe('cell-shell-overlay');
  });

  it('omits host from the React render context', () => {
    const renderSpy = vi.fn(() => null);
    const registry: ReactCellShellOverlayRegistry = {
      test: { kind: 'cell-shell-overlay', render: renderSpy },
    };
    const adapted = adaptCellShellOverlays(registry)!;
    const ctx = makeCoreCtx();

    act(() => { adapted.test!.render(ctx); });

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const receivedCtx = renderSpy.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(receivedCtx[0]).not.toHaveProperty('host');
    expect(receivedCtx[0].overlayKey).toBe('test');
    expect(receivedCtx[0].rowId).toBe('r1');
    expect(receivedCtx[0].field).toBe('name');
    expect(receivedCtx[0].formattedValue).toBe('v');
  });

  it('mounts JSX into host, cleanup unmounts content and runs user cleanup', () => {
    const userCleanup = vi.fn();
    const registry: ReactCellShellOverlayRegistry = {
      test: {
        kind: 'cell-shell-overlay',
        render: (ctx) => ({
          node: (
            <div data-testid="overlay">
              <span>{ctx.formattedValue}</span>
              <button type="button" onClick={ctx.close}>Close</button>
            </div>
          ),
          cleanup: userCleanup,
        }),
      },
    };
    const adapted = adaptCellShellOverlays(registry)!;
    const ctx = makeCoreCtx({ formattedValue: 'Pac-Man' });

    let cleanup: (() => void) | void;
    act(() => { cleanup = adapted.test!.render(ctx); });

    expect(ctx.host.querySelector('[data-testid="overlay"]')).not.toBeNull();
    expect(ctx.host.querySelector('span')!.textContent).toBe('Pac-Man');
    expect(ctx.host.querySelector('button')!.textContent).toBe('Close');

    act(() => { cleanup!(); });

    expect(ctx.host.innerHTML).toBe('');
    expect(userCleanup).toHaveBeenCalledTimes(1);
  });

  it('handles plain ReactNode return (no cleanup)', () => {
    const registry: ReactCellShellOverlayRegistry = {
      test: {
        kind: 'cell-shell-overlay',
        render: (ctx) => <span>{ctx.rowId}</span>,
      },
    };
    const adapted = adaptCellShellOverlays(registry)!;
    const ctx = makeCoreCtx({ rowId: 'row-42' });

    let cleanup: (() => void) | void;
    act(() => { cleanup = adapted.test!.render(ctx); });

    expect(ctx.host.querySelector('span')!.textContent).toBe('row-42');

    act(() => { cleanup!(); });

    expect(ctx.host.innerHTML).toBe('');
  });
});
