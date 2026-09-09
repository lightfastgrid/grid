import type {
  GridCreateOptions,
  GridEventCallbacks,
  GridOptions,
} from '@lightfastgrid/core';
import {
  Grid,
  quickFilterOptionsEqual,
  subscribeGridEventCallbacks,
} from '@lightfastgrid/core';
import type { RefObject } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { adaptCellRenderers } from '../adaptCellRenderers';
import { adaptCellShellOverlays } from '../adaptCellShellOverlays';
import { adaptHeaderRenderers } from '../adaptHeaderRenderers';
import { adaptOverlays } from '../adaptOverlays';
import type { ReactLightFastGridProps } from '../types';

import { useLatest } from './useLatest';

const GRID_EVENT_CALLBACK_KEYS = [
  'onGridReady',
  'onColumnResized',
  'onSelectionChanged',
  'onColumnSelectionChanged',
  'onColumnOrderChanged',
  'onRowOrderChanged',
  'onSortChanged',
  'onFilterChanged',
  'onColumnPinChanged',
  'onRowPinChanged',
  'onColumnVisibilityChanged',
  'onPaginationChanged',
  'onFocusedCellChanged',
  'onCellShellAction',
  'onCellValueChanged',
  'onRowDataUpdated',
  'onQuickFilterChanged',
  'onQuickSearchPendingChanged',
  'onAsyncTransactionsFlushed',
  'onCsvExportProgress',
  'onCsvExportCompleted',
  'onCsvExportCancelled',
  'onCsvExportError',
] as const satisfies readonly (keyof GridEventCallbacks)[];

type MissingEventCallbackKey = Exclude<
  keyof GridEventCallbacks,
  (typeof GRID_EVENT_CALLBACK_KEYS)[number]
>;

const ALL_EVENT_CALLBACK_KEYS_LISTED: MissingEventCallbackKey extends never
  ? true
  : false = true;

function removeEventCallbacks(props: GridCreateOptions): void {
  void ALL_EVENT_CALLBACK_KEYS_LISTED;
  for (const key of GRID_EVENT_CALLBACK_KEYS) delete props[key];
}

function cleanupGridLifecycle(
  grid: Grid,
  unsubscribeCallbacks: (() => void) | undefined,
): void {
  let failed = false;
  let firstError: unknown;
  try {
    unsubscribeCallbacks?.();
  } catch (error) {
    failed = true;
    firstError = error;
  }
  try {
    grid.destroy();
  } catch (error) {
    if (!failed) {
      failed = true;
      firstError = error;
    }
  }
  if (failed) throw firstError;
}

/**
 * Owns the core `Grid` lifecycle inside React.
 *
 * - Creates the grid, registers listeners **before** `mount()` so synchronous
 *   `grid:mounted` delivery is not missed.
 * - Calls `grid.mount(container)` once the container ref is attached.
 * - Event callbacks use refs so dependency arrays stay stable.
 */
export function useGridInstance(
  containerRef: RefObject<HTMLElement | null>,
  props: ReactLightFastGridProps,
): RefObject<Grid | null> {
  const gridRef = useRef<Grid | null>(null);
  const adaptedCellRenderers = useMemo(
    () => adaptCellRenderers(props.cellRenderers),
    [props.cellRenderers],
  );
  const adaptedHeaderRenderers = useMemo(
    () => adaptHeaderRenderers(props.headerRenderers),
    [props.headerRenderers],
  );
  const adaptedOverlays = useMemo(
    () => adaptOverlays(props.overlays),
    [props.overlays],
  );
  const adaptedCellShellOverlays = useMemo(
    () => adaptCellShellOverlays(props.cellShellOverlays),
    [props.cellShellOverlays],
  );
  const propsRef = useLatest(props);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const {
      height,
      className,
      style,
      immutableRows,
      ...frameworkNeutralProps
    } = props;
    void height;
    void className;
    void style;
    void immutableRows;
    const coreProps: GridCreateOptions = {
      ...frameworkNeutralProps,
      cellRenderers: adaptedCellRenderers,
      cellShellOverlays: adaptedCellShellOverlays,
      headerRenderers: adaptedHeaderRenderers,
      overlays: adaptedOverlays,
    };
    removeEventCallbacks(coreProps);
    coreProps.onBeforeCellEditCommit = (event) =>
      propsRef.current.onBeforeCellEditCommit?.(event);
    const grid = new Grid(coreProps);
    gridRef.current = grid;

    let unsubscribeCallbacks: (() => void) | undefined;
    try {
      unsubscribeCallbacks = subscribeGridEventCallbacks(
        grid,
        (): Readonly<GridEventCallbacks> => propsRef.current,
      );
      grid.mount(el);
    } catch (error) {
      try {
        cleanupGridLifecycle(grid, unsubscribeCallbacks);
      } catch {
        // Preserve the bridge-installation or mount failure.
      }
      gridRef.current = null;
      throw error;
    }

    return () => {
      try {
        cleanupGridLifecycle(grid, unsubscribeCallbacks);
      } finally {
        if (gridRef.current === grid) gridRef.current = null;
      }
    };

  }, [containerRef]);

  useEffect(() => {
    gridRef.current?.setTheme(props.theme);
  }, [props.theme]);

  useEffect(() => {
    gridRef.current?.setAccessibilityOptions(props.accessibility);
  }, [props.accessibility]);

  useEffect(() => {
    gridRef.current?.setColumns(props.columns ?? []);
  }, [props.columns]);

  // Rows — with `immutableRows`, replacement arrays diff by stable row
  // id through the core (`setRowsImmutable`). The core falls back to
  // `setRows` (with a one-time dev warning) when `getRowId` is missing
  // so data is never lost.
  //
  // Echoing an accepted transaction's `result.rows` (same row objects
  // in the same order) still runs setRows / setRowsImmutable. Pending
  // cell-change flash is preserved for that equivalent sequence. A new
  // object snapshot still drops obsolete flash metadata.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (props.immutableRows === true) {
      grid.setRowsImmutable(props.rows ?? []);
    } else {
      grid.setRows(props.rows ?? []);
    }
  }, [props.rows, props.immutableRows]);

  useEffect(() => {
    gridRef.current?.setDefaultColDef(props.defaultColDef);
  }, [props.defaultColDef]);

  useEffect(() => {
    gridRef.current?.setRowSelection(props.rowSelection);
  }, [props.rowSelection]);

  useEffect(() => {
    gridRef.current?.setColumnSelection(props.columnSelection);
  }, [props.columnSelection]);

  useEffect(() => {
    gridRef.current?.setColumnOrder(props.columnOrder);
  }, [props.columnOrder]);

  useEffect(() => {
    gridRef.current?.setRowDrag(props.rowDrag);
  }, [props.rowDrag]);

  // Row styling — one setter; the core de-duplicates by reference and bumps
  // its `rowStylingVersion` only when at least one input actually changed,
  // so unrelated prop ticks do NOT force a row-class recompute.
  useEffect(() => {
    gridRef.current?.setRowStyling({
      rowClass: props.rowClass,
      getRowClass: props.getRowClass,
      rowClassRules: props.rowClassRules,
    });
  }, [props.rowClass, props.getRowClass, props.rowClassRules]);

  // Overlays — `loading` and `overlays` flow through dedicated setters so
  // the core de-duplicates by value/reference and schedules at most one render.
  useEffect(() => {
    gridRef.current?.setLoading(props.loading ?? false);
  }, [props.loading]);

  // Async transaction batching delay — the core normalizes
  // (Math.max(0, value ?? 50)); an already-queued flush keeps its
  // original timing, the new delay applies from the next queue start.
  useEffect(() => {
    gridRef.current?.setAsyncTransactionWaitMillis(
      props.asyncTransactionWaitMillis,
    );
  }, [props.asyncTransactionWaitMillis]);

  useEffect(() => {
    gridRef.current?.setExecutionOptions(props.execution);
  }, [props.execution]);

  // Pagination config — guarded by VALUE, not reference. Inline array
  // literals for `paginationPageSizeOptions` would otherwise re-fire this
  // on every render and revert runtime pagination API calls
  // (setPageSize / setPaginationConfig) back to the prop config.
  const lastPaginationConfigKey = useRef<string | null>(null);
  useEffect(() => {
    const config = {
      enabled: props.pagination === true,
      pageSize: props.paginationPageSize,
      pageSizeOptions: props.paginationPageSizeOptions,
    };
    const key = JSON.stringify(config);
    if (key === lastPaginationConfigKey.current) return;
    lastPaginationConfigKey.current = key;
    gridRef.current?.setPaginationConfig(config);
  });

  useEffect(() => {
    gridRef.current?.setOverlays(adaptedOverlays);
  }, [adaptedOverlays]);

  useEffect(() => {
    gridRef.current?.setFloatingFilters(props.floatingFilters);
  }, [props.floatingFilters]);

  useEffect(() => {
    gridRef.current?.setColumnGroupHeaders(props.columnGroupHeaders);
  }, [props.columnGroupHeaders]);

  useEffect(() => {
    if (props.quickFilterText !== undefined) {
      gridRef.current?.setQuickFilterText(props.quickFilterText);
    }
  }, [props.quickFilterText]);

  const lastQuickFilterConfig =
    useRef<GridOptions['quickFilter']>(undefined);
  useEffect(() => {
    const quickFilter = props.quickFilter;
    if (quickFilterOptionsEqual(lastQuickFilterConfig.current, quickFilter)) {
      return;
    }
    lastQuickFilterConfig.current = quickFilter;
    gridRef.current?.setQuickFilterConfig(quickFilter);
  });

  /** Keep mutable configuration and hook inputs live without remounting. */
  useLayoutEffect(() => {
    gridRef.current?.setColumnMenu(props.columnMenu);
  }, [props.columnMenu]);

  useLayoutEffect(() => {
    gridRef.current?.setCellMenu(props.cellMenu);
  }, [props.cellMenu]);

  useLayoutEffect(() => {
    gridRef.current?.setCellRenderers(adaptedCellRenderers);
  }, [adaptedCellRenderers]);

  useLayoutEffect(() => {
    gridRef.current?.setCellShellOverlays(adaptedCellShellOverlays);
  }, [adaptedCellShellOverlays]);

  useLayoutEffect(() => {
    gridRef.current?.setHeaderRenderers(adaptedHeaderRenderers);
  }, [adaptedHeaderRenderers]);

  useLayoutEffect(() => {
    gridRef.current?.setCsvExportConfig(props.csvExport);
  }, [props.csvExport]);

  useLayoutEffect(() => {
    gridRef.current?.setBeforeCellEditCommitHook(
      props.onBeforeCellEditCommit === undefined
        ? undefined
        : (event) => propsRef.current.onBeforeCellEditCommit?.(event),
    );
  }, [props.onBeforeCellEditCommit, propsRef]);

  return gridRef;
}
