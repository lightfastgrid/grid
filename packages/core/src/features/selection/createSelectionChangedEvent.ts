import type { RowAccess } from "../../internal/rowAccess";
import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type {
  LightFastGridSelectionChangedEvent,
  RowData,
  SelectionChange,
  SelectionChangeSource,
} from "../../types";
import {
  forEachSelectedRowFromDisplayRows,
  forEachSelectedRowFromModel,
  resolveChangedRowsByIds,
  resolveSelectedIdsFromDisplayRows,
  resolveSelectedIdsFromModel,
  resolveSelectedRowsFromDisplayRows,
  resolveSelectedRowsFromModel,
} from "../../utils/rowSelection";

const INLINE_SELECTED_ID_CAP = 512;
const EAGER_CHANGED_ROW_CAP = 256;

export interface CreateSelectionChangedEventArgs {
  change: SelectionChange;
  source: SelectionChangeSource;
  rowAccess: RowAccess;
  displayRows?: DisplayRowReader;
}

/**
 * Builds {@link LightFastGridSelectionChangedEvent} from a point-in-time
 * {@link SelectionChange} + current grid rows/identity. Lazy methods resolve
 * only from `change.selection` plus row access/display rows — never from the
 * live selection renderer.
 */
export function createSelectionChangedEvent(
  args: CreateSelectionChangedEventArgs,
): LightFastGridSelectionChangedEvent {
  const { change, source, rowAccess, displayRows } = args;
  const selection = change.selection;

  const isBulk =
    change.kind === "selectAll" || change.kind === "clear";

  const changedRows =
    !isBulk &&
    change.changedIds.length > 0 &&
    change.changedIds.length <= EAGER_CHANGED_ROW_CAP
      ? resolveChangedRowsByIds(change.changedIds, rowAccess)
      : [];

  const selectedRowIdsProp =
    selection.selectedCount === 0
      ? []
      : selection.type === "explicit" &&
          (selection.ids?.length ?? 0) > 0 &&
          (selection.ids?.length ?? 0) <= INLINE_SELECTED_ID_CAP
        ? selection.ids
        : undefined;

  let selectedRowIdsCache: string[] | null = null;
  let selectedRowsCache: RowData[] | null = null;

  let explicitIdSet: Set<string> | null = null;
  let excludedIdSet: Set<string> | null = null;

  const getExplicitIdSet = (): Set<string> => {
    if (!explicitIdSet) {
      if (selection.ids && selection.ids.length > 0) {
        explicitIdSet = new Set(selection.ids);
      } else if (
        selection.type === "explicit" &&
        selection.selectedCount > 0
      ) {
        explicitIdSet = new Set(
          resolveSelectedIdsFromModel(selection, rowAccess),
        );
      } else {
        explicitIdSet = new Set();
      }
    }
    return explicitIdSet;
  };

  const getExcludedIdSet = (): Set<string> => {
    if (!excludedIdSet) {
      excludedIdSet = new Set(selection.excludedIds ?? []);
    }
    return excludedIdSet;
  };

  const isRowSelected = (rowId: string): boolean => {
    if (selection.selectedCount === 0) return false;
    if (selection.type === "explicit") {
      return getExplicitIdSet().has(rowId);
    }
    return !getExcludedIdSet().has(rowId);
  };

  return {
    selectionType: selection.type,
    selectedCount: selection.selectedCount,
    selectedRowIds: selectedRowIdsProp,
    changeKind: change.kind,
    changedRowIds: [...change.changedIds],
    changedRows,
    source,
    isRowSelected,
    getSelectedRowIds() {
      if (!selectedRowIdsCache) {
        selectedRowIdsCache = displayRows
          ? resolveSelectedIdsFromDisplayRows(
              selection,
              displayRows,
              rowAccess.resolveRowId,
            )
          : resolveSelectedIdsFromModel(
              selection,
              rowAccess,
            );
      }
      return selectedRowIdsCache;
    },
    getSelectedRows() {
      if (!selectedRowsCache) {
        selectedRowsCache = displayRows
          ? resolveSelectedRowsFromDisplayRows(
              selection,
              displayRows,
              rowAccess.resolveRowId,
            )
          : resolveSelectedRowsFromModel(
              selection,
              rowAccess,
            );
      }
      return selectedRowsCache;
    },
    forEachSelectedRow(callback) {
      if (displayRows) {
        forEachSelectedRowFromDisplayRows(
          selection,
          displayRows,
          rowAccess.resolveRowId,
          callback,
        );
        return;
      }
      forEachSelectedRowFromModel(selection, rowAccess, callback);
    },
  };
}

export { EAGER_CHANGED_ROW_CAP, INLINE_SELECTED_ID_CAP };
