import type {
  CsvExportProgress,
  CsvExportResult,
} from '../features/csv-export/csvExportTypes';
import type {
  LightFastGridAsyncTransactionsFlushedEvent,
  LightFastGridCellShellActionEvent,
  LightFastGridCellValueChangedEvent,
  LightFastGridColumnOrderChangedEvent,
  LightFastGridColumnPinChangedEvent,
  LightFastGridColumnSelectionChangedEvent,
  LightFastGridColumnVisibilityChangedEvent,
  LightFastGridFilterChangedEvent,
  LightFastGridFocusedCellChangedEvent,
  LightFastGridOverlayPresentationChangedEvent,
  LightFastGridPaginationChangedEvent,
  LightFastGridQuickFilterChangedEvent,
  LightFastGridQuickSearchPendingChangedEvent,
  LightFastGridRowDataUpdatedEvent,
  LightFastGridRowOrderChangedEvent,
  LightFastGridRowPinChangedEvent,
  LightFastGridSelectionChangedEvent,
  LightFastGridSortChangedEvent,
} from '../types';

/**
 * Typed event map for the `Grid`. Each key is an event name; each value is
 * the payload `emit` will dispatch and `on` handlers will receive.
 */
export interface GridEventMap {
  'grid:mounted': { container: HTMLElement };
  'grid:destroyed': Record<string, never>;
  'data:updated': { rowCount: number };
  'columns:updated': { columnCount: number };
  'column:resized': { field: string; width: number };
  'selection:changed': LightFastGridSelectionChangedEvent;
  'column-selection:changed': LightFastGridColumnSelectionChangedEvent;
  'column-order:changed': LightFastGridColumnOrderChangedEvent;
  'row-order:changed': LightFastGridRowOrderChangedEvent;
  'sort:changed': LightFastGridSortChangedEvent;
  'filter:changed': LightFastGridFilterChangedEvent;
  'quick-filter:changed': LightFastGridQuickFilterChangedEvent;
  'quick-search-pending:changed': LightFastGridQuickSearchPendingChangedEvent;
  'column-pin:changed': LightFastGridColumnPinChangedEvent;
  'row-pin:changed': LightFastGridRowPinChangedEvent;
  'column-visibility:changed': LightFastGridColumnVisibilityChangedEvent;
  'pagination:changed': LightFastGridPaginationChangedEvent;
  'row-data:updated': LightFastGridRowDataUpdatedEvent;
  'cell-value:changed': LightFastGridCellValueChangedEvent;
  'focused-cell:changed': LightFastGridFocusedCellChangedEvent;
  'cell-shell:action': LightFastGridCellShellActionEvent;
  'async-transactions:flushed': LightFastGridAsyncTransactionsFlushedEvent;
  'grid:configuration-changed': {
    readonly property:
      | 'accessibility'
      | 'columnSelection'
      | 'columnGroupHeaders'
      | 'defaultColDef'
      | 'floatingFilters'
      | 'rowSelection';
  };
  'overlay:changed': Record<string, never>;
  'overlay:presentation-changed': LightFastGridOverlayPresentationChangedEvent;
  'column-menu:changed': { readonly openField: string | null };
  'csv-export:progress': CsvExportProgress;
  'csv-export:completed': CsvExportResult;
  'csv-export:cancelled': { taskId: number };
  'csv-export:error': { taskId: number; error: unknown };
}
