import type { ImmutableKeyedMembership } from "../internal/readSnapshots";
import type { RowView } from "../row-model/rowOrder";
import type {
  ColumnDef,
  ColumnGroupPathMeta,
  RowData,
  RowPinPosition,
} from "../types";

/**
 * Generic immutable state read captured for headless operations.
 *
 * Collection stability is owned by GridState/RowStore; this contract contains
 * no CSV policy and is not exported from the package root.
 */
export interface GridReadSnapshot {
  readonly sourceRows: readonly RowData[];
  readonly currentPageView: RowView;
  readonly fullView: RowView;
  /** Effective visible user columns before feature-owned transforms. */
  readonly visibleUserColumns: readonly ColumnDef[];
  /** Effective user leaves, including hidden, in source-definition order. */
  readonly allUserLeafColumns: readonly ColumnDef[];
  readonly groupMetaByField: Readonly<Record<string, ColumnGroupPathMeta>>;
  readonly groupHeaderDisplayEnabled: boolean;
  readonly rowPinState: ImmutableKeyedMembership<string, RowPinPosition>;
  readonly sourceLayoutRevision: number;
  readonly dataRevision: number;
  /** GridState revision only; feature-owned runtime order lives in captured arrays. */
  readonly columnRevision: number;
}
