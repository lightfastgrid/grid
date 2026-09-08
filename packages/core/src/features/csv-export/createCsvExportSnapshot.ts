/**
 * Assemble the immutable CSV task snapshot from feature-neutral captures.
 *
 * Construction is O(1) with respect to rows and membership collections, and
 * O(columns) for the feature-neutral logical layout. The authoritative
 * selection universe is the captured full-view count. Row identity remains
 * lazy and is resolved only when CsvRowPlan requests a source index.
 */

import type {
  LogicalColumnLayoutInput,
  LogicalColumnLayoutReadSnapshot,
} from "../../internal/columnLayoutReadSnapshot";
import type {
  ImmutableIdMembership,
  RowSelectionReadSnapshot,
} from "../../internal/readSnapshots";
import type { GridReadSnapshot } from "../../state/GridReadSnapshot";
import type { RowData } from "../../types";

import type { CsvExportSnapshot, CsvRowIdResolver } from "./csvExportSnapshot";

export interface CreateCsvExportSnapshotInput {
  readonly state: GridReadSnapshot;
  readonly capabilities: {
    captureLogicalColumnLayoutSnapshot(
      input: LogicalColumnLayoutInput,
    ): LogicalColumnLayoutReadSnapshot;
    captureRowSelectionSnapshot(
      universeRowCount: number,
    ): RowSelectionReadSnapshot;
    captureColumnSelectionSnapshot(): ImmutableIdMembership<string>;
  };
  /** Existing GridContext/RowIdentityService-backed resolver. */
  readonly resolveRowId: (row: RowData, sourceIndex: number) => string;
}

export function createCsvExportSnapshot(
  input: CreateCsvExportSnapshotInput,
): CsvExportSnapshot {
  const sourceRows = input.state.sourceRows;
  const resolveRowId = input.resolveRowId;
  const columnLayout = input.capabilities.captureLogicalColumnLayoutSnapshot({
    visibleUserColumns: input.state.visibleUserColumns,
    allUserLeafColumns: input.state.allUserLeafColumns,
  });
  const selectedRows = input.capabilities.captureRowSelectionSnapshot(
    input.state.fullView.rowCount,
  );
  const selectedColumns =
    input.capabilities.captureColumnSelectionSnapshot();
  const rowIds: CsvRowIdResolver = {
    getRowIdBySourceIndex(sourceIndex): string {
      const row = sourceRows[sourceIndex];
      if (row === undefined) {
        throw new RangeError(`CSV source row index ${sourceIndex} is out of range`);
      }
      return resolveRowId(row, sourceIndex);
    },
  };

  return {
    sourceRows,
    pageView: input.state.currentPageView,
    fullView: input.state.fullView,
    visibleColumns: columnLayout.visibleColumns,
    allLeafColumns: columnLayout.allLeafColumns,
    groupMetaByField: input.state.groupMetaByField,
    rowPinState: input.state.rowPinState,
    selectedRowIds: selectedRows,
    selectedColumnIds: selectedColumns,
    rowIds,
    groupHeaderDisplayEnabled: input.state.groupHeaderDisplayEnabled,
    sourceLayoutRevision: input.state.sourceLayoutRevision,
    dataRevision: input.state.dataRevision,
    columnSchemaRevision: input.state.columnRevision,
  };
}
