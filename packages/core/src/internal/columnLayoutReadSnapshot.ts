import type { ColumnDef } from "../types";

/** Effective user-column inputs captured from GridState at task start. */
export interface LogicalColumnLayoutInput {
  readonly visibleUserColumns: readonly ColumnDef[];
  readonly allUserLeafColumns: readonly ColumnDef[];
}

/**
 * Feature-neutral logical column layout captured for a headless task.
 *
 * The visible list includes feature-owned internal columns and follows
 * pinned-left, center, pinned-right display order. The all-leaf list retains
 * user source-definition order while including applicable internal columns.
 */
export interface LogicalColumnLayoutReadSnapshot {
  readonly visibleColumns: readonly ColumnDef[];
  readonly allLeafColumns: readonly ColumnDef[];
}
