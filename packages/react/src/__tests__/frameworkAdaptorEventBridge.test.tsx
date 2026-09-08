// @vitest-environment jsdom
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { Grid } from '@lightfastgrid/core';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createRef,
  Profiler,
  type ProfilerOnRenderCallback,
  type RefObject,
  StrictMode,
} from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lightfastgrid/core', async () =>
  import('../../../core/src/index'),
);

import { LightFastGrid } from '../LightFastGrid';
import type {
  ReactLightFastGridHandle,
  ReactLightFastGridProps,
} from '../types';

interface MountedGrid {
  readonly container: HTMLDivElement;
  readonly ref: RefObject<ReactLightFastGridHandle | null>;
  readonly root: Root;
}

const BASE_PROPS: ReactLightFastGridProps = {
  columns: [{ field: 'name', headerName: 'Name' }],
  rows: [{ id: 'r1', name: 'Alpha' }],
  getRowId: (row) => row.id,
};

async function mountGrid(
  props: ReactLightFastGridProps,
  wrapper?: (grid: React.ReactNode) => React.ReactNode,
): Promise<MountedGrid> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const ref = createRef<ReactLightFastGridHandle>();
  const grid = <LightFastGrid ref={ref} {...props} />;

  await act(async () => {
    root.render(wrapper?.(grid) ?? grid);
  });
  return { container, ref, root };
}

async function rerenderGrid(
  mounted: MountedGrid,
  props: ReactLightFastGridProps,
): Promise<void> {
  await act(async () => {
    mounted.root.render(<LightFastGrid ref={mounted.ref} {...props} />);
  });
}

async function unmountGrid(mounted: MountedGrid): Promise<void> {
  await act(async () => {
    mounted.root.unmount();
  });
  mounted.container.remove();
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('React framework event bridge', () => {
  it('uses latest callback props without remounting or resubscribing', async () => {
    const onMethod = vi.spyOn(Grid.prototype, 'on');
    const firstReady = vi.fn();
    const firstQuickFilter = vi.fn();
    const secondQuickFilter = vi.fn();
    const mounted = await mountGrid({
      ...BASE_PROPS,
      onGridReady: firstReady,
      onQuickFilterChanged: firstQuickFilter,
    });
    const grid = mounted.ref.current?.getInstance();
    if (grid === null || grid === undefined) throw new Error('Grid not mounted');
    const subscriptionCount = onMethod.mock.calls.length;

    expect(firstReady).toHaveBeenCalledOnce();
    grid.setQuickFilterText('first');
    expect(firstQuickFilter).toHaveBeenCalledOnce();

    await rerenderGrid(mounted, {
      ...BASE_PROPS,
      onGridReady: vi.fn(),
      onQuickFilterChanged: secondQuickFilter,
    });
    expect(mounted.ref.current?.getInstance()).toBe(grid);
    expect(onMethod).toHaveBeenCalledTimes(subscriptionCount);
    grid.setQuickFilterText('second');
    expect(firstQuickFilter).toHaveBeenCalledOnce();
    expect(secondQuickFilter).toHaveBeenCalledOnce();

    await rerenderGrid(mounted, {
      ...BASE_PROPS,
      onQuickFilterChanged: undefined,
    });
    expect(onMethod).toHaveBeenCalledTimes(subscriptionCount);
    grid.setQuickFilterText('cleared');
    expect(secondQuickFilter).toHaveBeenCalledOnce();

    await unmountGrid(mounted);
  });

  it('delivers an event without adding a React Profiler commit', async () => {
    const onQuickFilterChanged = vi.fn();
    const onRender: ProfilerOnRenderCallback = vi.fn();
    const mounted = await mountGrid(
      { ...BASE_PROPS, onQuickFilterChanged },
      (grid) => (
        <Profiler id="grid" onRender={onRender}>
          {grid}
        </Profiler>
      ),
    );
    const grid = mounted.ref.current?.getInstance();
    if (grid === null || grid === undefined) throw new Error('Grid not mounted');
    const commitCount = vi.mocked(onRender).mock.calls.length;

    act(() => grid.setQuickFilterText('event-only'));

    expect(onQuickFilterChanged).toHaveBeenCalledOnce();
    expect(onRender).toHaveBeenCalledTimes(commitCount);
    await unmountGrid(mounted);
  });

  it('flushes async row updates without adding a React Profiler commit', async () => {
    const onAsyncTransactionsFlushed = vi.fn();
    const onRender: ProfilerOnRenderCallback = vi.fn();
    const mounted = await mountGrid(
      {
        ...BASE_PROPS,
        asyncTransactionWaitMillis: 1_000,
        onAsyncTransactionsFlushed,
      },
      (grid) => (
        <Profiler id="grid-transactions" onRender={onRender}>
          {grid}
        </Profiler>
      ),
    );
    const handle = mounted.ref.current;
    if (handle === null) throw new Error('Grid handle not mounted');
    const commitCount = vi.mocked(onRender).mock.calls.length;

    act(() => {
      handle.applyTransactionAsync({
        update: [{ id: 'r1', name: 'Updated without React' }],
      });
      handle.flushAsyncTransactions();
    });

    expect(handle.getRows()[0]?.name).toBe('Updated without React');
    expect(onAsyncTransactionsFlushed).toHaveBeenCalledOnce();
    expect(onRender).toHaveBeenCalledTimes(commitCount);
    await unmountGrid(mounted);
  });

  it('keeps one live instance after Strict Mode replay', async () => {
    const destroy = vi.spyOn(Grid.prototype, 'destroy');
    const onGridReady = vi.fn();
    const onQuickFilterChanged = vi.fn();
    const mounted = await mountGrid(
      { ...BASE_PROPS, onGridReady, onQuickFilterChanged },
      (grid) => <StrictMode>{grid}</StrictMode>,
    );
    const liveGrid = mounted.ref.current?.getInstance();
    if (liveGrid === null || liveGrid === undefined) {
      throw new Error('Strict Mode Grid not mounted');
    }

    expect(onGridReady).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledOnce();
    liveGrid.setQuickFilterText('strict');
    expect(onQuickFilterChanged).toHaveBeenCalledOnce();

    await unmountGrid(mounted);
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes the adaptor bridge before destroying its Grid', async () => {
    const order: string[] = [];
    const originalOn = Grid.prototype.on;
    const originalDestroy = Grid.prototype.destroy;
    vi.spyOn(Grid.prototype, 'on').mockImplementation(function (
      this: Grid,
      event,
      handler,
    ) {
      const unsubscribe = originalOn.call(this, event, handler);
      return () => {
        order.push(`unsubscribe:${String(event)}`);
        unsubscribe();
      };
    });
    vi.spyOn(Grid.prototype, 'destroy').mockImplementation(function (
      this: Grid,
    ) {
      order.push('destroy:start');
      originalDestroy.call(this);
    });
    const mounted = await mountGrid(BASE_PROPS);

    await unmountGrid(mounted);

    const destroyIndex = order.indexOf('destroy:start');
    expect(destroyIndex).toBeGreaterThan(0);
    expect(order.slice(0, destroyIndex)).toHaveLength(23);
    expect(order.slice(0, destroyIndex)).toEqual(
      expect.arrayContaining([
        'unsubscribe:grid:mounted',
        'unsubscribe:selection:changed',
        'unsubscribe:csv-export:completed',
      ]),
    );
  });

  it('strips observer callbacks before constructing the core Grid', async () => {
    const source = await readFile(
      resolve('src/hooks/useGridInstance.ts'),
      'utf8',
    );
    const removeIndex = source.indexOf('removeEventCallbacks(coreProps)');
    const constructIndex = source.indexOf('new Grid(coreProps)');
    const subscribeIndex = source.indexOf('subscribeGridEventCallbacks(', constructIndex);
    const mountIndex = source.indexOf('grid.mount(el)', subscribeIndex);

    expect(removeIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeLessThan(constructIndex);
    expect(constructIndex).toBeLessThan(subscribeIndex);
    expect(subscribeIndex).toBeLessThan(mountIndex);
  });

  it('strips React-only container props before constructing the core Grid', async () => {
    const source = await readFile(
      resolve('src/hooks/useGridInstance.ts'),
      'utf8',
    );
    const stripIndex = source.indexOf('const {\n      height,');
    const constructIndex = source.indexOf('new Grid(coreProps)');

    expect(stripIndex).toBeGreaterThan(-1);
    expect(source.slice(stripIndex, constructIndex)).toContain('className,');
    expect(source.slice(stripIndex, constructIndex)).toContain('style,');
    expect(source.slice(stripIndex, constructIndex)).toContain('immutableRows,');
    expect(stripIndex).toBeLessThan(constructIndex);
  });

  it('forwards dynamic configuration and hooks through explicit setters', async () => {
    const mounted = await mountGrid(BASE_PROPS);
    const grid = mounted.ref.current?.getInstance();
    if (grid === null || grid === undefined) throw new Error('Grid not mounted');
    const setColumnMenu = vi.spyOn(grid, 'setColumnMenu');
    const setCellMenu = vi.spyOn(grid, 'setCellMenu');
    const setCellRenderers = vi.spyOn(grid, 'setCellRenderers');
    const setCellShellOverlays = vi.spyOn(
      grid,
      'setCellShellOverlays',
    );
    const setHeaderRenderers = vi.spyOn(grid, 'setHeaderRenderers');
    const setCsvExportConfig = vi.spyOn(grid, 'setCsvExportConfig');
    const setBeforeCellEditCommitHook = vi.spyOn(
      grid,
      'setBeforeCellEditCommitHook',
    );
    const hook = vi.fn();
    await rerenderGrid(mounted, {
      ...BASE_PROPS,
      columnMenu: { enabled: true },
      cellMenu: {
        enabled: true,
        trigger: 'button',
        getActions: () => [],
        onAction: () => undefined,
      },
      cellRenderers: {
        actions: {
          kind: 'actions',
          mode: 'custom',
          render: () => null,
        },
      },
      cellShellOverlays: {
        badge: {
          kind: 'cell-shell-overlay',
          render: () => null,
        },
      },
      headerRenderers: {
        actions: {
          kind: 'header-action',
          mode: 'custom',
          render: () => null,
        },
      },
      csvExport: { includeColumnHeaders: true },
      onBeforeCellEditCommit: hook,
    });

    expect(setColumnMenu).toHaveBeenLastCalledWith({ enabled: true });
    expect(setCellMenu).toHaveBeenCalledOnce();
    expect(
      setCellRenderers.mock.calls[setCellRenderers.mock.calls.length - 1]?.[0],
    ).toHaveProperty('actions');
    expect(
      setCellShellOverlays.mock.calls[
        setCellShellOverlays.mock.calls.length - 1
      ]?.[0],
    ).toHaveProperty('badge');
    expect(
      setHeaderRenderers.mock.calls[
        setHeaderRenderers.mock.calls.length - 1
      ]?.[0],
    ).toHaveProperty('actions');
    expect(setCsvExportConfig).toHaveBeenLastCalledWith({
      includeColumnHeaders: true,
    });
    expect(
      setBeforeCellEditCommitHook.mock.calls[
        setBeforeCellEditCommitHook.mock.calls.length - 1
      ]?.[0],
    ).toEqual(expect.any(Function));

    await rerenderGrid(mounted, BASE_PROPS);

    expect(setColumnMenu).toHaveBeenLastCalledWith(undefined);
    expect(setCellMenu).toHaveBeenLastCalledWith(undefined);
    expect(setCellRenderers).toHaveBeenLastCalledWith(undefined);
    expect(setCellShellOverlays).toHaveBeenLastCalledWith(undefined);
    expect(setHeaderRenderers).toHaveBeenLastCalledWith(undefined);
    expect(setCsvExportConfig).toHaveBeenLastCalledWith(undefined);
    expect(setBeforeCellEditCommitHook).toHaveBeenLastCalledWith(undefined);
    expect(mounted.ref.current?.getInstance()).toBe(grid);

    await unmountGrid(mounted);
  });
});
