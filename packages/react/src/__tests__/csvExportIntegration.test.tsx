// @vitest-environment jsdom
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { createRef, Profiler, type RefObject } from 'react';
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

const COLUMNS = [{ field: 'value', headerName: 'Value' }];
const ROWS = [{ id: 'a', value: 'Alpha' }];

interface MountedGrid {
  readonly container: HTMLDivElement;
  readonly ref: RefObject<ReactLightFastGridHandle | null>;
  readonly root: Root;
}

async function mountGrid(props: ReactLightFastGridProps): Promise<MountedGrid> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const ref = createRef<ReactLightFastGridHandle>();

  await act(async () => {
    root.render(<LightFastGrid ref={ref} {...props} />);
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
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('React CSV export integration', () => {
  it('test 59 exposes real handle methods and keeps current CSV props on one Grid', async () => {
    let workerConstructions = 0;
    vi.stubGlobal(
      'Worker',
      class ColdWorkerGuard {
        constructor() {
          workerConstructions++;
        }
      },
    );
    const oldProgress = vi.fn();
    const oldCompleted = vi.fn();
    const oldCancelled = vi.fn();
    const oldError = vi.fn();
    const newProgress = vi.fn();
    const newCompleted = vi.fn();
    const newCancelled = vi.fn();
    const newError = vi.fn();
    const baseProps: ReactLightFastGridProps = {
      columns: COLUMNS,
      rows: ROWS,
      getRowId: (row) => row.id,
      csvExport: { includeColumnHeaders: true },
      onCsvExportProgress: oldProgress,
      onCsvExportCompleted: oldCompleted,
      onCsvExportCancelled: oldCancelled,
      onCsvExportError: oldError,
    };
    const mounted = await mountGrid(baseProps);
    const handle = mounted.ref.current;
    if (handle === null) throw new Error('React Grid handle was not mounted');
    const coreGrid = handle.getInstance();
    if (coreGrid === null) throw new Error('Core Grid instance was not mounted');

    expect(workerConstructions).toBe(0);
    expect(typeof handle.getDataAsCsv).toBe('function');
    expect(typeof handle.exportDataAsCsv).toBe('function');
    await expect(handle.getDataAsCsv()).resolves.toBe(
      'Value\r\nAlpha\r\n',
    );

    const task = handle.exportDataAsCsv({ output: { type: 'text' } });
    expect(typeof task.cancel).toBe('function');
    await expect(task.promise).resolves.toMatchObject({
      taskId: task.id,
      outputType: 'text',
      rowCount: 1,
      columnCount: 1,
      text: 'Value\r\nAlpha\r\n',
    });
    expect(oldCompleted).toHaveBeenCalledTimes(2);
    expect(oldProgress).toHaveBeenCalled();

    const oldProgressCount = oldProgress.mock.calls.length;
    await rerenderGrid(mounted, {
      ...baseProps,
      csvExport: { includeColumnHeaders: false },
      onCsvExportProgress: newProgress,
      onCsvExportCompleted: newCompleted,
      onCsvExportCancelled: newCancelled,
      onCsvExportError: newError,
    });
    expect(mounted.ref.current?.getInstance()).toBe(coreGrid);
    await expect(mounted.ref.current?.getDataAsCsv()).resolves.toBe(
      'Alpha\r\n',
    );
    expect(oldCompleted).toHaveBeenCalledTimes(2);
    expect(oldProgress).toHaveBeenCalledTimes(oldProgressCount);
    expect(newCompleted).toHaveBeenCalledOnce();
    expect(newProgress).toHaveBeenCalled();

    const replacementCancelled = mounted.ref.current?.exportDataAsCsv({
      output: { type: 'text' },
    });
    if (replacementCancelled === undefined) {
      throw new Error('Replacement CSV cancellation task was not created');
    }
    replacementCancelled.cancel();
    await expect(replacementCancelled.promise).rejects.toMatchObject({
      code: 'csv-export/cancelled',
    });
    const replacementError = mounted.ref.current?.exportDataAsCsv({
      output: { type: 'text' },
      processCell: () => {
        throw new Error('replacement projection failure');
      },
    });
    if (replacementError === undefined) {
      throw new Error('Replacement CSV error task was not created');
    }
    await expect(replacementError.promise).rejects.toThrow(
      'replacement projection failure',
    );
    expect(oldCancelled).not.toHaveBeenCalled();
    expect(oldError).not.toHaveBeenCalled();
    expect(newCancelled).toHaveBeenCalledOnce();
    expect(newError).toHaveBeenCalledOnce();

    const newProgressCount = newProgress.mock.calls.length;
    await rerenderGrid(mounted, {
      ...baseProps,
      csvExport: undefined,
      onCsvExportProgress: undefined,
      onCsvExportCompleted: undefined,
      onCsvExportCancelled: undefined,
      onCsvExportError: undefined,
    });
    await expect(mounted.ref.current?.getDataAsCsv()).resolves.toBe(
      'Value\r\nAlpha\r\n',
    );
    expect(oldCompleted).toHaveBeenCalledTimes(2);
    expect(newCompleted).toHaveBeenCalledOnce();
    expect(newProgress).toHaveBeenCalledTimes(newProgressCount);

    const clearedCancelled = mounted.ref.current?.exportDataAsCsv({
      output: { type: 'text' },
    });
    if (clearedCancelled === undefined) {
      throw new Error('Cleared CSV cancellation task was not created');
    }
    clearedCancelled.cancel();
    await expect(clearedCancelled.promise).rejects.toMatchObject({
      code: 'csv-export/cancelled',
    });
    const clearedError = mounted.ref.current?.exportDataAsCsv({
      output: { type: 'text' },
      processCell: () => {
        throw new Error('cleared projection failure');
      },
    });
    if (clearedError === undefined) {
      throw new Error('Cleared CSV error task was not created');
    }
    await expect(clearedError.promise).rejects.toThrow(
      'cleared projection failure',
    );
    expect(newCancelled).toHaveBeenCalledOnce();
    expect(newError).toHaveBeenCalledOnce();
    expect(workerConstructions).toBe(0);

    const staleHandle = mounted.ref.current;
    if (staleHandle === null) throw new Error('React Grid handle disappeared');
    await unmountGrid(mounted);
    expect(() => staleHandle.getDataAsCsv()).toThrow(
      'LightFastGrid CSV export requires a mounted Grid instance.',
    );
    expect(() =>
      staleHandle.exportDataAsCsv({ output: { type: 'text' } }),
    ).toThrow('LightFastGrid CSV export requires a mounted Grid instance.');
  });

  it('test 60 delivers cooperative progress without rerendering React', async () => {
    const wideColumns = Array.from({ length: 160 }, (_, index) => ({
      field: `field-${index}`,
      headerName: `Field ${index}`,
    }));
    const wideRow: Record<string, unknown> = { id: 'wide' };
    for (let index = 0; index < wideColumns.length; index++) {
      wideRow[`field-${index}`] = `value-${index}`;
    }

    let renderCount = 0;
    const progress = vi.fn();
    const completed = vi.fn();
    const profilerCommit = vi.fn();
    const ref = createRef<ReactLightFastGridHandle>();

    function Harness() {
      renderCount++;
      return (
        <LightFastGrid
          ref={ref}
          columns={wideColumns}
          rows={[wideRow]}
          getRowId={(row) => row.id}
          execution={{ thresholds: { csvExport: Number.MAX_SAFE_INTEGER } }}
          onCsvExportProgress={progress}
          onCsvExportCompleted={completed}
        />
      );
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Profiler id="csv-export" onRender={profilerCommit}>
          <Harness />
        </Profiler>,
      );
    });
    const renderCountBeforeExport = renderCount;
    const profilerCommitsBeforeExport = profilerCommit.mock.calls.length;
    const handle = ref.current;
    if (handle === null) throw new Error('React Grid handle was not mounted');

    await expect(handle.getDataAsCsv()).resolves.toContain('value-159');

    expect(progress.mock.calls.length).toBeGreaterThan(1);
    expect(completed).toHaveBeenCalledOnce();
    expect(renderCount).toBe(renderCountBeforeExport);
    expect(profilerCommit).toHaveBeenCalledTimes(
      profilerCommitsBeforeExport,
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
