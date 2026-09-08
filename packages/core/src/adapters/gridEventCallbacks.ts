import type { GridEventMap } from "../events/GridEventMap";
import type { GridEventCallbacks, Unsubscribe } from "../types";

/** Minimal typed event source required by framework callback bridges. */
export interface GridEventSource {
  on<K extends keyof GridEventMap>(
    event: K,
    handler: (payload: GridEventMap[K]) => void,
  ): Unsubscribe;
}

/** Capture only observational callbacks from a wider Grid options object. */
export function captureGridEventCallbacks(
  callbacks: Readonly<GridEventCallbacks>,
): Readonly<GridEventCallbacks> {
  return {
    onGridReady: callbacks.onGridReady,
    onColumnResized: callbacks.onColumnResized,
    onSelectionChanged: callbacks.onSelectionChanged,
    onColumnSelectionChanged: callbacks.onColumnSelectionChanged,
    onColumnOrderChanged: callbacks.onColumnOrderChanged,
    onRowOrderChanged: callbacks.onRowOrderChanged,
    onSortChanged: callbacks.onSortChanged,
    onFilterChanged: callbacks.onFilterChanged,
    onColumnPinChanged: callbacks.onColumnPinChanged,
    onRowPinChanged: callbacks.onRowPinChanged,
    onColumnVisibilityChanged: callbacks.onColumnVisibilityChanged,
    onPaginationChanged: callbacks.onPaginationChanged,
    onFocusedCellChanged: callbacks.onFocusedCellChanged,
    onCellShellAction: callbacks.onCellShellAction,
    onCellValueChanged: callbacks.onCellValueChanged,
    onRowDataUpdated: callbacks.onRowDataUpdated,
    onQuickFilterChanged: callbacks.onQuickFilterChanged,
    onQuickSearchPendingChanged: callbacks.onQuickSearchPendingChanged,
    onAsyncTransactionsFlushed: callbacks.onAsyncTransactionsFlushed,
    onCsvExportProgress: callbacks.onCsvExportProgress,
    onCsvExportCompleted: callbacks.onCsvExportCompleted,
    onCsvExportCancelled: callbacks.onCsvExportCancelled,
    onCsvExportError: callbacks.onCsvExportError,
  };
}

function unsubscribeAll(unsubscribes: readonly Unsubscribe[]): void {
  let failed = false;
  let firstError: unknown;
  for (let index = unsubscribes.length - 1; index >= 0; index -= 1) {
    try {
      unsubscribes[index]?.();
    } catch (error) {
      if (!failed) {
        failed = true;
        firstError = error;
      }
    }
  }
  if (failed) throw firstError;
}

/**
 * Subscribe every public callback convenience to its canonical Grid event.
 * The callback object is read at delivery time so framework adaptors can keep
 * one subscription while exposing their latest callback props.
 */
export function subscribeGridEventCallbacks(
  source: GridEventSource,
  getCallbacks: () => Readonly<GridEventCallbacks>,
): Unsubscribe {
  const unsubscribes: Unsubscribe[] = [];

  const add = <K extends keyof GridEventMap>(
    event: K,
    notify: (
      callbacks: Readonly<GridEventCallbacks>,
      payload: GridEventMap[K],
    ) => void,
  ): void => {
    unsubscribes.push(
      source.on(event, (payload) => notify(getCallbacks(), payload)),
    );
  };

  try {
    add("grid:mounted", (callbacks) => callbacks.onGridReady?.());
    add("column:resized", (callbacks, payload) =>
      callbacks.onColumnResized?.(payload),
    );
    add("selection:changed", (callbacks, payload) =>
      callbacks.onSelectionChanged?.(payload),
    );
    add("column-selection:changed", (callbacks, payload) =>
      callbacks.onColumnSelectionChanged?.(payload),
    );
    add("column-order:changed", (callbacks, payload) =>
      callbacks.onColumnOrderChanged?.(payload),
    );
    add("row-order:changed", (callbacks, payload) =>
      callbacks.onRowOrderChanged?.(payload),
    );
    add("sort:changed", (callbacks, payload) =>
      callbacks.onSortChanged?.(payload),
    );
    add("filter:changed", (callbacks, payload) =>
      callbacks.onFilterChanged?.(payload),
    );
    add("column-pin:changed", (callbacks, payload) =>
      callbacks.onColumnPinChanged?.(payload),
    );
    add("row-pin:changed", (callbacks, payload) =>
      callbacks.onRowPinChanged?.(payload),
    );
    add("column-visibility:changed", (callbacks, payload) =>
      callbacks.onColumnVisibilityChanged?.(payload),
    );
    add("pagination:changed", (callbacks, payload) =>
      callbacks.onPaginationChanged?.(payload),
    );
    add("focused-cell:changed", (callbacks, payload) =>
      callbacks.onFocusedCellChanged?.(payload),
    );
    add("cell-shell:action", (callbacks, payload) =>
      callbacks.onCellShellAction?.(payload),
    );
    add("cell-value:changed", (callbacks, payload) =>
      callbacks.onCellValueChanged?.(payload),
    );
    add("row-data:updated", (callbacks, payload) =>
      callbacks.onRowDataUpdated?.(payload),
    );
    add("quick-filter:changed", (callbacks, payload) =>
      callbacks.onQuickFilterChanged?.(payload),
    );
    add("quick-search-pending:changed", (callbacks, payload) =>
      callbacks.onQuickSearchPendingChanged?.(payload),
    );
    add("async-transactions:flushed", (callbacks, payload) =>
      callbacks.onAsyncTransactionsFlushed?.(payload),
    );
    add("csv-export:progress", (callbacks, payload) =>
      callbacks.onCsvExportProgress?.(payload),
    );
    add("csv-export:completed", (callbacks, payload) =>
      callbacks.onCsvExportCompleted?.(payload),
    );
    add("csv-export:cancelled", (callbacks, payload) =>
      callbacks.onCsvExportCancelled?.(payload),
    );
    add("csv-export:error", (callbacks, payload) =>
      callbacks.onCsvExportError?.(payload),
    );
  } catch (error) {
    try {
      unsubscribeAll(unsubscribes);
    } catch {
      // Preserve the primary subscription failure after best-effort rollback.
    }
    throw error;
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    unsubscribeAll(unsubscribes);
  };
}
