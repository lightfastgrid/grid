/**
 * CSV Export V1 - immutable export snapshot contract (Stage 1).
 *
 * One logical snapshot is captured per export task before any row projection.
 * Capturing it is O(1) with respect to rows and selected cells: every large
 * collection is an immutable reference already owned by its feature (source
 * rows, RowViews, column arrays) or an O(1) read-membership view over a set
 * the selection feature already maintains.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 15.
 */

import type {
  ImmutableIdMembership,
  ImmutableKeyedMembership,
  RowSelectionReadSnapshot,
} from "../../internal/readSnapshots";
import type { RowView } from "../../row-model/rowOrder";
import type { ColumnDef, ColumnGroupPathMeta, RowData, RowPinPosition } from "../../types";

/**
 * O(1) read-membership view over row pin placement captured at task start.
 * `get` returns the lane for a pinned row, or `undefined` for unpinned center.
 */
export type CsvRowPinReadSnapshot = ImmutableKeyedMembership<
  string,
  RowPinPosition
>;

/**
 * O(1) read-membership view over the selected row ids captured at task start.
 * Insertion order is irrelevant to CSV order; only membership is read.
 */
export type CsvSelectionReadSnapshot = RowSelectionReadSnapshot;

/** O(1) read-membership view over the selected column fields at task start. */
export type CsvColumnSelectionReadSnapshot = ImmutableIdMembership<string>;

/**
 * Stable row-id resolver keyed by source-array index. Capture resolves no IDs;
 * a later planner lookup may pass the captured row reference to the existing
 * feature-neutral identity service without reading export fields.
 */
export interface CsvRowIdResolver {
  getRowIdBySourceIndex(sourceIndex: number): string;
}

/**
 * Immutable logical snapshot for one export task.
 *
 * `sourceRows`, `pageView`, `fullView`, `visibleColumns`, and `allLeafColumns`
 * are references, never copies. Row scopes emit source indexes into these; no
 * `RowData` object is ever cloned by the planner.
 */
export interface CsvExportSnapshot {
  /** Source rows in original insertion order. Never mutated. */
  sourceRows: readonly RowData[];
  /** Current paginated display view (`currentPage` scope). */
  pageView: RowView;
  /** Full unpaginated display view (`filteredAndSorted` / `selected` scopes). */
  fullView: RowView;
  /** Effective visible columns in lane order (left-pinned, center, right-pinned). */
  visibleColumns: readonly ColumnDef[];
  /**
   * All user leaves including hidden in source-definition order, plus
   * applicable feature-owned internal columns.
   */
  allLeafColumns: readonly ColumnDef[];
  /** Group ancestry metadata keyed by leaf field. */
  groupMetaByField: Readonly<Record<string, ColumnGroupPathMeta>>;
  /** O(1) row pin membership view (absent = unpinned center). */
  rowPinState: CsvRowPinReadSnapshot;
  /** Selected row ids membership view. */
  selectedRowIds: CsvSelectionReadSnapshot;
  /** Selected column fields membership view. */
  selectedColumnIds: CsvColumnSelectionReadSnapshot;
  /** Stable row-id resolver over source indexes. */
  rowIds: CsvRowIdResolver;
  /**
   * Captured group-header display-enabled state. Drives the tri-state
   * `includeColumnGroupHeaders` default (omitted follows this value).
   */
  groupHeaderDisplayEnabled: boolean;
  /** Row source-layout identity (source row ordering/insertion). */
  sourceLayoutRevision: number;
  /** Data revision (row content identity). */
  dataRevision: number;
  /**
   * Captured GridState revision. Effective runtime order is owned by the
   * immutable column arrays and must not be inferred from this scalar.
   */
  columnSchemaRevision: number;
}
