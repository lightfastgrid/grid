import type { CellShellKind } from "../types";

/** One virtualized row’s cell: DOM node + cached string for diffing updates. */
export interface PooledCell {
  element: HTMLDivElement;
  value: string;
  /**
   * Managed cell class names currently applied to {@link element}.
   *
   * Tracked separately from `element.className` so the cell-rebind path can
   * remove ONLY the classes it added (user-supplied cell styling) without
   * touching core classes (`lfg-cell`, `lfg-column-selected`, action /
   * selection cell chrome, etc.). `undefined` means "no managed classes
   * applied to this cell".
   */
  managedCellClasses?: string[];
  /**
   * Last `cellClassVersion` observed from {@link PopulateRowOptions}. Used by
   * the future styling-only fast path to skip recomputing managed classes
   * when none of the cell-styling inputs have changed.
   */
  lastCellClassVersion?: number;

  // ── Cell shell bookkeeping ──
  shellKind?: CellShellKind;
  shellKey?: string;
  shellRoot?: HTMLElement;
  shellClassNames?: string[];
  shellActionKey?: string;
}

/** One row in the DOM pool: layout row element, cells, and bookkeeping. */
export interface PooledRow {
  element: HTMLDivElement;
  cells: PooledCell[];
  /** Data row index currently bound, or -1 if idle. */
  rowIndex: number;
  /**
   * Mirrors `GridSnapshot.dataRevision` / store revision when this row was last
   * populated (for row-level dirty skip).
   */
  rowVersion: number;
  /** Resolved row id from user `getRowId`, object identity fallback, or primitive index fallback. */
  rowId: string | null;
  /** Horizontal ring version; bumps only on full horizontal resets. */
  lastColumnVersion?: number;
  /** Last translateY(px) applied; avoids redundant transform writes. */
  layoutTranslateY?: number;
  /** Last translateY(px) applied to pinned element; avoids redundant transform writes. */
  pinnedLayoutTranslateY?: number;
  /** Pinned-left row element (lives in the sticky pinned layer). */
  pinnedElement?: HTMLDivElement;
  /** Pinned-left cells (separate from center `cells`). */
  pinnedCells?: PooledCell[];
  /** Last translateY(px) applied to right-pinned element. */
  rightPinnedLayoutTranslateY?: number;
  /** Pinned-right row element (lives in the sticky right-pinned layer). */
  rightPinnedElement?: HTMLDivElement;
  /** Pinned-right cells (separate from center `cells`). */
  rightPinnedCells?: PooledCell[];

  /**
   * Managed row class names currently applied to {@link element} (and to
   * `pinnedElement` / `rightPinnedElement` when present).
   *
   * Tracked separately from `element.className` so the ring-buffer recycle
   * path can remove ONLY the classes it added (e.g. user-supplied row
   * styling) without touching core classes (`lfg-row`, `lfg-row-selected`,
   * row-drag indicators, etc.). `undefined` means "no managed classes
   * applied to this row".
   */
  managedRowClasses?: string[];
  /**
   * Last `rowClassVersion` observed from {@link PopulateRowOptions}. Used
   * with `rowId` / `rowVersion` to skip recomputing managed classes when
   * none of the row-styling inputs have changed.
   */
  lastRowClassVersion?: number;
  /**
   * Last `cellClassVersion` observed from {@link PopulateRowOptions}, tracked
   * at the row level so the outer dirty-skip in `populateRow` can detect a
   * cell-styling-only update and run a fast per-cell styling pass without
   * rebinding cell text. Per-cell `lastCellClassVersion` lives on each
   * {@link PooledCell} so the future styling-only render path can skip
   * already-fresh cells too.
   */
  lastCellClassVersion?: number;
  /**
   * Whether the last bind ran with a `resolveCellClasses` resolver supplied.
   * Tracked separately from `lastCellClassVersion` because resolver
   * **presence** can change between binds without `cellClassVersion`
   * differing (e.g., resolver dropped on render N+1 with the default
   * version of 0 still in place). Both the styling-only fast pass and the
   * outer dirty-skip use this to detect a presence transition (undefined →
   * resolver, or resolver → undefined) and react accordingly.
   */
  lastCellClassResolverActive?: boolean;
}
