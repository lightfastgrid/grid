import type {
  Grid,
  RowData,
  RowDataTransactionResult,
} from '@lightfastgrid/core';
import type { ForwardedRef } from 'react';
import { forwardRef, StrictMode, useImperativeHandle, useRef } from 'react';

import { useGridInstance } from './hooks/useGridInstance';
import { adaptOverlays } from './adaptOverlays';

/** Zero-change result for handle calls made before the grid mounts. */
function emptyTransactionResult(
  rows: RowData[] = [],
): RowDataTransactionResult {
  return {
    rows,
    added: [],
    updated: [],
    removed: [],
    skipped: [],
    addCount: 0,
    updateCount: 0,
    removeCount: 0,
    skippedCount: 0,
  };
}

function requireMountedGrid(grid: Grid | null): Grid {
  if (grid === null) {
    throw new Error(
      'LightFastGrid CSV export requires a mounted Grid instance.',
    );
  }
  return grid;
}
import type {
  ReactLightFastGridHandle,
  ReactLightFastGridProps,
} from './types';

import '@lightfastgrid/core/themes/default.css';

function LightFastGridInner(
  props: ReactLightFastGridProps,
  ref: ForwardedRef<ReactLightFastGridHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useGridInstance(containerRef, props);

  useImperativeHandle(
    ref,
    () => ({
      getInstance: () => gridRef.current,
      getRows: () => gridRef.current?.getRows() ?? [],
      exportDataAsCsv: (params) =>
        requireMountedGrid(gridRef.current).exportDataAsCsv(params),
      getDataAsCsv: (params) =>
        requireMountedGrid(gridRef.current).getDataAsCsv(params),
      getSelectedRowIds: () => gridRef.current?.getSelectedRowIds() ?? [],
      getSelectedRows: () => gridRef.current?.getSelectedRows() ?? [],
      setSelectedRowIds: (ids, source) => {
        gridRef.current?.setSelectedRowIds(ids, source);
      },
      clearSelection: () => {
        gridRef.current?.clearSelection();
      },
      getSelectedColumnIds: () =>
        gridRef.current?.getSelectedColumnIds() ?? [],
      setSelectedColumnIds: (ids, source) => {
        gridRef.current?.setSelectedColumnIds(ids, source);
      },
      clearColumnSelection: () => {
        gridRef.current?.clearColumnSelection();
      },
      setSortModel: (model, source) => {
        gridRef.current?.setSortModel(model, source);
      },
      getSortModel: () => gridRef.current?.getSortModel() ?? [],
      clearSort: (source) => {
        gridRef.current?.clearSort(source);
      },
      toggleColumnSort: (field, opts) => {
        gridRef.current?.toggleColumnSort(field, opts);
      },
      setFilterModel: (model, source) => {
        gridRef.current?.setFilterModel(model, source);
      },
      getFilterModel: () => gridRef.current?.getFilterModel() ?? {},
      clearFilters: (source) => {
        gridRef.current?.clearFilters(source);
      },
      setColumnFilterModel: (field, model, source) => {
        gridRef.current?.setColumnFilterModel(field, model, source);
      },
      getColumnFilterModel: (field) =>
        gridRef.current?.getColumnFilterModel(field) ?? null,
      clearColumnFilter: (field, source) => {
        gridRef.current?.clearColumnFilter(field, source);
      },
      getColumnFilterConfig: (field) =>
        gridRef.current?.getColumnFilterConfig(field) ?? null,
      setFloatingFilters: (value) => {
        gridRef.current?.setFloatingFilters(value);
      },
      setColumnGroupHeaders: (value) => {
        gridRef.current?.setColumnGroupHeaders(value);
      },
      isColumnGroupHeadersEnabled: () =>
        gridRef.current?.isColumnGroupHeadersEnabled() ?? true,
      setQuickFilterText: (text) => {
        gridRef.current?.setQuickFilterText(text);
      },
      setQuickFilterConfig: (quickFilter) => {
        gridRef.current?.setQuickFilterConfig(quickFilter);
      },
      clearQuickFilter: () => {
        gridRef.current?.clearQuickFilter();
      },
      getQuickFilterText: () => gridRef.current?.getQuickFilterText() ?? "",
      isQuickFilterPresent: () =>
        gridRef.current?.isQuickFilterPresent() ?? false,
      pinColumn: (field, pinned, source) => {
        gridRef.current?.pinColumn(field, pinned, source);
      },
      unpinColumn: (field, source) => {
        gridRef.current?.unpinColumn(field, source);
      },
      setColumnPinState: (state, source) => {
        gridRef.current?.setColumnPinState(state, source);
      },
      getColumnPinState: () => gridRef.current?.getColumnPinState() ?? [],
      clearColumnPinning: (source) => {
        gridRef.current?.clearColumnPinning(source);
      },
      getColumns: () => gridRef.current?.getColumns() ?? [],
      setColumnVisible: (field, visible, source) => {
        gridRef.current?.setColumnVisible(field, visible, source);
      },
      hideColumns: (fields, source) => {
        gridRef.current?.hideColumns(fields, source);
      },
      showColumns: (fields, source) => {
        gridRef.current?.showColumns(fields, source);
      },
      setColumnVisibilityState: (state, source) => {
        gridRef.current?.setColumnVisibilityState(state, source);
      },
      getColumnVisibilityState: () =>
        gridRef.current?.getColumnVisibilityState() ?? [],
      showAllColumns: (source) => {
        gridRef.current?.showAllColumns(source);
      },
      pinRow: (rowId, position, source) => {
        gridRef.current?.pinRow(rowId, position, source);
      },
      pinRows: (rowIds, position, source) => {
        gridRef.current?.pinRows(rowIds, position, source);
      },
      unpinRows: (rowIds, source) => {
        gridRef.current?.unpinRows(rowIds, source);
      },
      setRowPinState: (state, source) => {
        gridRef.current?.setRowPinState(state, source);
      },
      getRowPinState: () => gridRef.current?.getRowPinState() ?? [],
      clearRowPinning: (source) => {
        gridRef.current?.clearRowPinning(source);
      },
      setRowStyling: (value) => {
        gridRef.current?.setRowStyling(value);
      },
      sizeColumnsToFit: (source) => {
        gridRef.current?.sizeColumnsToFit(source);
      },
      sizeSelectedColumnsToFit: (source) => {
        gridRef.current?.sizeSelectedColumnsToFit(source);
      },
      resetColumnWidths: (source) => {
        gridRef.current?.resetColumnWidths(source);
      },
      autoSizeColumn: (field, source) => {
        gridRef.current?.autoSizeColumn(field, source);
      },
      autoSizeColumns: (fields, source) => {
        gridRef.current?.autoSizeColumns(fields, source);
      },
      autoSizeSelectedColumns: (source) => {
        gridRef.current?.autoSizeSelectedColumns(source);
      },
      setLoading: (loading) => {
        gridRef.current?.setLoading(loading);
      },
      showLoadingOverlay: () => {
        gridRef.current?.showLoadingOverlay();
      },
      showNoRowsOverlay: () => {
        gridRef.current?.showNoRowsOverlay();
      },
      showNoMatchingRowsOverlay: () => {
        gridRef.current?.showNoMatchingRowsOverlay();
      },
      hideOverlay: () => {
        gridRef.current?.hideOverlay();
      },
      setOverlays: (overlays) => {
        gridRef.current?.setOverlays(adaptOverlays(overlays));
      },
      getPaginationState: () =>
        gridRef.current?.getPaginationState() ?? {
          enabled: false,
          pageIndex: 0,
          pageSize: 100,
          pageCount: 0,
          totalRows: 0,
          startRow: 0,
          endRow: 0,
        },
      setPaginationConfig: (config) => {
        gridRef.current?.setPaginationConfig(config);
      },
      applyTransaction: (transaction) =>
        gridRef.current
          ? gridRef.current.applyTransaction(transaction)
          : emptyTransactionResult(),
      applyTransactionAsync: (transaction, callback) => {
        gridRef.current?.applyTransactionAsync(transaction, callback);
      },
      flushAsyncTransactions: () =>
        gridRef.current?.flushAsyncTransactions() ?? [],
      setRowsImmutable: (nextRows) =>
        gridRef.current
          ? gridRef.current.setRowsImmutable(nextRows)
          : emptyTransactionResult(nextRows),
      setExecutionOptions: (execution) => {
        gridRef.current?.setExecutionOptions(execution);
      },
      setTheme: (theme) => {
        gridRef.current?.setTheme(theme);
      },
      getFocusedCell: () => gridRef.current?.getFocusedCell() ?? null,
      setFocusedCell: (target, source) => {
        gridRef.current?.setFocusedCell(target, source);
      },
      clearFocusedCell: (source) => {
        gridRef.current?.clearFocusedCell(source);
      },
      moveFocusedCell: (direction, source) => {
        gridRef.current?.moveFocusedCell(direction, source);
      },
      setPageIndex: (pageIndex, source) => {
        gridRef.current?.setPageIndex(pageIndex, source);
      },
      setPageSize: (pageSize, source) => {
        gridRef.current?.setPageSize(pageSize, source);
      },
      nextPage: (source) => {
        gridRef.current?.nextPage(source);
      },
      previousPage: (source) => {
        gridRef.current?.previousPage(source);
      },
      firstPage: (source) => {
        gridRef.current?.firstPage(source);
      },
      lastPage: (source) => {
        gridRef.current?.lastPage(source);
      },
    }),
    [gridRef],
  );

  return (
    <StrictMode>
      <div
        ref={containerRef}
        className={props.className}
        style={{
          width: '100%',
          height: props.height ?? '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          ...props.style,
        }}
      />
    </StrictMode>
  );
}

export const LightFastGrid = forwardRef<
  ReactLightFastGridHandle,
  ReactLightFastGridProps
>(LightFastGridInner);

LightFastGrid.displayName = 'LightFastGrid';
