import type { ColumnPinningLayout } from "../../features/column-pinning/columnPinningLayout";
import type { PooledCell, PooledRow } from "../../internal/poolTypes";
import type { GridLayoutMetrics } from "../../layout/gridLayoutMetrics";
import { CSS } from "../../rendering/const/css-classes";
import { ROW_HEIGHT } from "../../rendering/helpers/gridConstants";
import {
  type ColumnWindow,
  populateRow,
  type PopulateRowOptions,
} from "../../rendering/helpers/populateRow";
import type { ColumnDef, GridSkeleton } from "../../types";

import type { PinnedRowEntry } from "./rowPinningRenderModel";

/**
 * Row-pinned lane DOM for one side (top OR bottom).
 *
 * Each side gets up to three sub-lanes — left / center / right — so pinned
 * columns inside a row-pinned row render in horizontally fixed sub-lanes
 * exactly like normal body rows. The center sub-lane horizontally virtualizes
 * via VirtualWindowSync; left/right sub-lanes bind all pinned columns once
 * and are not touched on horizontal scroll.
 *
 * Cell-styling resolver + version pass through `bindOptions` into every
 * sub-lane's `populateRow` call, so cell styling applies to row-pinned
 * top/bottom center, left, and right sub-lane cells alongside the normal
 * body wiring. Selection/column-selection class updates continue to flow
 * through dedicated DOM walks in the renderer (they do not bump the lane
 * fingerprint).
 *
 * Reuse is fingerprint-driven: the same `entries` ref, the same
 * left/center/right column refs, the same `dataRevision`, the same
 * `rowClassVersion`, and the same cell-styling resolver presence +
 * `cellClassVersion` short-circuit the rebind path entirely.
 */
export interface PinnedRowLaneState {
  /** Center sub-lane: scrolls/virtualizes horizontally. Always present when entries exist. */
  centerLayer: HTMLDivElement;
  /** Left sub-lane: sticky on both axes; created only when there are left-pinned columns. */
  leftLayer: HTMLDivElement | undefined;
  /** Right sub-lane: sticky on both axes; created only when there are right-pinned columns. */
  rightLayer: HTMLDivElement | undefined;

  /** Pool rows for the center sub-lane (consumed by VirtualWindowSync). */
  centerPoolRows: PooledRow[];
  /** Pool rows for the left sub-lane (fully bound here; untouched on h-scroll). */
  leftPoolRows: PooledRow[];
  /** Pool rows for the right sub-lane (fully bound here; untouched on h-scroll). */
  rightPoolRows: PooledRow[];

  /** Structural fingerprint used to decide reuse vs rebuild. */
  rowCount: number;
  centerCellCount: number;
  leftCount: number;
  rightCount: number;

  /** ──── Skip-rebind fingerprint (cleared by structural rebuild). ────
   *
   * Reuse is short-circuited when ALL of the following are unchanged since
   * the last bind: entries ref, left/center/right column refs, dataRevision,
   * rowClassVersion, cellClassVersion AND cellClassResolverActive presence.
   * Selection / column-selection visuals are refreshed via dedicated DOM
   * walks in the renderer, so they intentionally do not gate this
   * fingerprint.
   *
   * `lastRowClassVersion` + `lastCellClassVersion` participate so runtime
   * `grid.setRowStyling(...)` (row-styling) AND column-level cellClass
   * changes (which bump `cellClassVersion` without touching data revision
   * or column refs) flush through to lane pool rows. `lastCellClassResolverActive`
   * catches the case where the resolver presence flips at the same default
   * version (e.g. cell styling dropped on render N+1 with version 0).
   */
  lastEntries: PinnedRowEntry[] | null;
  lastCenterColumns: ColumnDef[] | null;
  lastLeftColumns: ColumnDef[] | null;
  lastRightColumns: ColumnDef[] | null;
  lastDataRevision: number;
  lastRowClassVersion: number;
  lastCellClassVersion: number;
  lastCellClassResolverActive: boolean;
}

interface SubLaneClasses {
  centerLayer: string;
  leftLayer: string;
  rightLayer: string;
}

function classesFor(side: "top" | "bottom"): SubLaneClasses {
  if (side === "top") {
    return {
      centerLayer: "lfg-row-pinned-top-layer",
      leftLayer: "lfg-row-pinned-top-left-layer",
      rightLayer: "lfg-row-pinned-top-right-layer",
    };
  }
  return {
    centerLayer: "lfg-row-pinned-bottom-layer",
    leftLayer: "lfg-row-pinned-bottom-left-layer",
    rightLayer: "lfg-row-pinned-bottom-right-layer",
  };
}

function createPooledRow(cellCount: number, rowHeight: number): PooledRow {
  const element = document.createElement("div");
  element.className = CSS.ROW;
  element.style.height = `${rowHeight}px`;

  const cells: PooledCell[] = [];
  for (let i = 0; i < cellCount; i++) {
    const cellEl = document.createElement("div");
    cellEl.className = CSS.CELL;
    element.appendChild(cellEl);
    cells.push({ element: cellEl, value: "" });
  }

  return {
    element,
    cells,
    rowIndex: -1,
    rowVersion: 0,
    rowId: null,
  };
}

function identityWindow(slotCount: number): ColumnWindow {
  return {
    startIndex: 0,
    slotCount,
    toPhysicalCol: (v: number) => v,
  };
}

/**
 * Build one sub-lane.
 *
 * - Center sub-lanes are flow layers: they reserve `entries.length * rowHeight`
 *   of layout space so the body rows shift down/up to make room for pinned
 *   rows. Pooled rows stack via normal flow inside.
 * - Overlay sub-lanes (left + right) are zero-height sticky overlays — they
 *   must NOT participate in flow because the existing `.lfg-pinned-left-layer`
 *   (column-pinned lane) sits at `left: 0` next to them. A floated layer with
 *   real height would push the column-pinned lane to the right, leaving a gap
 *   under the row-pinned row. Pooled rows are absolutely positioned at
 *   `top: i * rowHeight` inside the zero-height sticky box (same trick the
 *   column-pinned lane already uses for `.lfg-pinned-row`).
 */
function buildSubLane(
  className: string,
  entries: PinnedRowEntry[],
  cellCount: number,
  overlay: boolean,
  rowHeight: number,
): { layer: HTMLDivElement; poolRows: PooledRow[] } {
  const layer = document.createElement("div");
  layer.className = className;
  if (!overlay) {
    layer.style.height = `${entries.length * rowHeight}px`;
  }

  const poolRows: PooledRow[] = [];
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < entries.length; i++) {
    const row = createPooledRow(cellCount, rowHeight);
    if (overlay) {
      // Absolute inside the zero-height sticky parent. Sticky establishes the
      // positioning context; absolute children render outside the 0px box but
      // remain inside the sticky's painted area as long as overflow: visible.
      row.element.style.position = "absolute";
      row.element.style.left = "0";
      row.element.style.top = `${i * rowHeight}px`;
    }
    poolRows.push(row);
    fragment.appendChild(row.element);
  }

  layer.appendChild(fragment);
  return { layer, poolRows };
}

/**
 * Bind `entries` into `poolRows` using `populateRow`. When `force` is true the
 * per-row dirty-skip is invalidated first (used when column refs change but
 * row identity / dataRevision do not).
 */
function rebindSubLane(
  poolRows: PooledRow[],
  entries: PinnedRowEntry[],
  columns: ColumnDef[],
  window: ColumnWindow,
  bindOptions: PopulateRowOptions,
  force: boolean,
): void {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const poolRow = poolRows[i]!;
    if (force) poolRow.rowVersion = -1;
    populateRow(poolRow, entry.row, columns, entry.displayIndex, window, bindOptions);
  }
}

/**
 * Update flow-mode lane height after row count change. Overlay sub-lanes
 * (left / right) intentionally have no inline height — see {@link buildSubLane}.
 */
function setFlowLayerHeight(
  layer: HTMLDivElement | undefined,
  rowCount: number,
  rowHeight: number,
): void {
  if (layer) layer.style.height = `${rowCount * rowHeight}px`;
}

function setSkeletonTopLayer(
  skeleton: GridSkeleton,
  side: "top" | "bottom",
  layer: HTMLDivElement | undefined,
): void {
  if (side === "top") skeleton.rowPinnedTopLayer = layer;
  else skeleton.rowPinnedBottomLayer = layer;
}

function insertGroup(
  skeleton: GridSkeleton,
  side: "top" | "bottom",
  centerLayer: HTMLDivElement,
  leftLayer: HTMLDivElement | undefined,
  rightLayer: HTMLDivElement | undefined,
): void {
  // Deterministic order within each side group: center → left → right.
  if (side === "top") {
    // Top group inserts right after the header.
    let anchor: Node | null = skeleton.header.nextSibling;
    skeleton.scrollContainer.insertBefore(centerLayer, anchor);
    anchor = centerLayer.nextSibling;
    if (leftLayer) {
      skeleton.scrollContainer.insertBefore(leftLayer, anchor);
      anchor = leftLayer.nextSibling;
    }
    if (rightLayer) {
      skeleton.scrollContainer.insertBefore(rightLayer, anchor);
    }
  } else {
    // Bottom group always appends at end of scrollContainer.
    skeleton.scrollContainer.appendChild(centerLayer);
    if (leftLayer) skeleton.scrollContainer.appendChild(leftLayer);
    if (rightLayer) skeleton.scrollContainer.appendChild(rightLayer);
  }
}

function removeAllLayers(state: PinnedRowLaneState): void {
  state.centerLayer.remove();
  state.leftLayer?.remove();
  state.rightLayer?.remove();
}

function updateFingerprint(
  state: PinnedRowLaneState,
  entries: PinnedRowEntry[],
  leftColumns: ColumnDef[],
  centerColumns: ColumnDef[],
  rightColumns: ColumnDef[],
  dataRevision: number,
  rowClassVersion: number,
  cellClassVersion: number,
  cellClassResolverActive: boolean,
): void {
  state.lastEntries = entries;
  state.lastLeftColumns = leftColumns;
  state.lastCenterColumns = centerColumns;
  state.lastRightColumns = rightColumns;
  state.lastDataRevision = dataRevision;
  state.lastRowClassVersion = rowClassVersion;
  state.lastCellClassVersion = cellClassVersion;
  state.lastCellClassResolverActive = cellClassResolverActive;
}

/**
 * Sync the row-pinned lane DOM for one side.
 *
 * Fast path: when the fingerprint (entries ref, left/center/right column refs,
 * dataRevision) is unchanged, this is a no-op aside from height updates.
 * Structural rebuilds happen when row count / sub-lane cell counts change.
 */
export function syncRowPinLaneDom(
  skeleton: GridSkeleton,
  entries: PinnedRowEntry[],
  pinningLayout: ColumnPinningLayout,
  centerSlotCount: number,
  side: "top" | "bottom",
  existing: PinnedRowLaneState | undefined,
  bindOptions: PopulateRowOptions,
  layoutMetrics?: GridLayoutMetrics,
): PinnedRowLaneState | undefined {
  if (entries.length === 0) {
    if (existing) {
      removeAllLayers(existing);
      setSkeletonTopLayer(skeleton, side, undefined);
    }
    return undefined;
  }

  const leftColumns = pinningLayout.leftPinned;
  const rightColumns = pinningLayout.rightPinned;
  const centerColumns = pinningLayout.center;
  const leftCount = leftColumns.length;
  const rightCount = rightColumns.length;
  const dataRevision = bindOptions.dataRevision ?? 0;
  const rowClassVersion = bindOptions.rowClassVersion ?? 0;
  const cellClassVersion = bindOptions.cellClassVersion ?? 0;
  const cellClassResolverActive = bindOptions.resolveCellClasses !== undefined;

  const classes = classesFor(side);

  // Fast reuse path — structure unchanged.
  if (
    existing &&
    existing.rowCount === entries.length &&
    existing.centerCellCount === centerSlotCount &&
    existing.leftCount === leftCount &&
    existing.rightCount === rightCount
  ) {
    // Only the center sub-lane reserves flow space; left/right overlays have
    // height: 0 and lay out their rows absolutely (see buildSubLane).
    const rh = layoutMetrics?.rowHeight ?? ROW_HEIGHT;
    setFlowLayerHeight(existing.centerLayer, entries.length, rh);

    const structuralUnchanged =
      existing.lastEntries === entries &&
      existing.lastCenterColumns === centerColumns &&
      existing.lastLeftColumns === leftColumns &&
      existing.lastRightColumns === rightColumns &&
      existing.lastDataRevision === dataRevision;
    const rowClassFresh = existing.lastRowClassVersion === rowClassVersion;
    const cellClassFresh =
      existing.lastCellClassVersion === cellClassVersion &&
      existing.lastCellClassResolverActive === cellClassResolverActive;
    const fingerprintUnchanged =
      structuralUnchanged && rowClassFresh && cellClassFresh;

    if (fingerprintUnchanged) {
      // Nothing in the lane's binding inputs changed — skip the per-row work.
      // (Selection / column-selection visuals are refreshed separately by the
      // renderer's dedicated DOM walks; they do not gate this fingerprint.)
      return existing;
    }

    // Detect a styling-only cache miss: structural inputs unchanged but EITHER
    // rowClassVersion OR cellClassVersion / resolver presence bumped. In that
    // case we do NOT force `populateRow` to rebind cells/text — populateRow's
    // managed-class diff (row classes) and cell-styling fast pass (cell
    // classes) refresh classes WITHOUT touching cell text/value, while the
    // cell-rebind path's dirty-skip catches because rowId / rowVersion /
    // columnVersion all still match.
    const stylingOnly = structuralUnchanged && (!rowClassFresh || !cellClassFresh);

    // Center sub-lane: rebind with identity window. VirtualWindowSync will
    // immediately rebind with the actual horizontal window in the same render
    // path (see DomGridRenderer.syncRowPinLanesAndWindow). We force the row
    // dirty-skip ONLY when something other than the styling version changed
    // (column refs, dataRevision, entries) — styling-only updates run
    // populateRow without the force so cells/text are not re-bound.
    // When change metadata is present (update-only txn with stable order),
    // skip force so populateRow's change-set check can skip unchanged rows.
    const hasChangeMetadata = bindOptions.changedRows !== undefined;
    const force = !stylingOnly && !hasChangeMetadata;
    rebindSubLane(
      existing.centerPoolRows,
      entries,
      centerColumns,
      identityWindow(centerSlotCount),
      bindOptions,
      force,
    );

    if (existing.leftLayer) {
      rebindSubLane(
        existing.leftPoolRows,
        entries,
        leftColumns,
        identityWindow(leftCount),
        bindOptions,
        force,
      );
    }
    if (existing.rightLayer) {
      rebindSubLane(
        existing.rightPoolRows,
        entries,
        rightColumns,
        identityWindow(rightCount),
        bindOptions,
        force,
      );
    }

    updateFingerprint(
      existing,
      entries,
      leftColumns,
      centerColumns,
      rightColumns,
      dataRevision,
      rowClassVersion,
      cellClassVersion,
      cellClassResolverActive,
    );
    return existing;
  }

  // Rebuild path — drop any previous sub-lanes for this side.
  if (existing) removeAllLayers(existing);

  const rebuildRh = layoutMetrics?.rowHeight ?? ROW_HEIGHT;
  const center = buildSubLane(
    classes.centerLayer,
    entries,
    centerSlotCount,
    /* overlay */ false,
    rebuildRh,
  );
  rebindSubLane(
    center.poolRows,
    entries,
    centerColumns,
    identityWindow(centerSlotCount),
    bindOptions,
    true, // fresh pool rows — force first bind
  );

  let left: { layer: HTMLDivElement; poolRows: PooledRow[] } | undefined;
  if (leftCount > 0) {
    left = buildSubLane(classes.leftLayer, entries, leftCount, /* overlay */ true, rebuildRh);
    rebindSubLane(
      left.poolRows,
      entries,
      leftColumns,
      identityWindow(leftCount),
      bindOptions,
      true,
    );
  }

  let right: { layer: HTMLDivElement; poolRows: PooledRow[] } | undefined;
  if (rightCount > 0) {
    right = buildSubLane(classes.rightLayer, entries, rightCount, /* overlay */ true, rebuildRh);
    rebindSubLane(
      right.poolRows,
      entries,
      rightColumns,
      identityWindow(rightCount),
      bindOptions,
      true,
    );
  }

  insertGroup(skeleton, side, center.layer, left?.layer, right?.layer);
  setSkeletonTopLayer(skeleton, side, center.layer);

  return {
    centerLayer: center.layer,
    leftLayer: left?.layer,
    rightLayer: right?.layer,
    centerPoolRows: center.poolRows,
    leftPoolRows: left?.poolRows ?? [],
    rightPoolRows: right?.poolRows ?? [],
    rowCount: entries.length,
    centerCellCount: centerSlotCount,
    leftCount,
    rightCount,
    lastEntries: entries,
    lastLeftColumns: leftColumns,
    lastCenterColumns: centerColumns,
    lastRightColumns: rightColumns,
    lastDataRevision: dataRevision,
    lastRowClassVersion: rowClassVersion,
    lastCellClassVersion: cellClassVersion,
    lastCellClassResolverActive: cellClassResolverActive,
  };
}

export function removeRowPinLane(
  skeleton: GridSkeleton,
  side: "top" | "bottom",
  existing: PinnedRowLaneState | undefined,
): void {
  if (existing) removeAllLayers(existing);
  setSkeletonTopLayer(skeleton, side, undefined);
}

/**
 * Iterate every PooledRow held by a lane state — used by the renderer to walk
 * lane DOM for selection / column-selection class refreshes without leaking
 * row-pinning structure into those features.
 */
export function forEachRowPinLanePoolRow(
  state: PinnedRowLaneState | undefined,
  cb: (row: PooledRow) => void,
): void {
  if (!state) return;
  for (const r of state.centerPoolRows) cb(r);
  for (const r of state.leftPoolRows) cb(r);
  for (const r of state.rightPoolRows) cb(r);
}

/**
 * Visit each row-pinned logical row as its retained center/left/right physical
 * lane rows. The callback receives scalars only; no projection object or
 * throwaway array is created.
 */
export function forEachLogicalRowPinLanePoolRow(
  state: PinnedRowLaneState | undefined,
  cb: (
    center: PooledRow,
    left: PooledRow | null,
    right: PooledRow | null,
  ) => void,
): void {
  if (!state) return;
  for (let index = 0; index < state.centerPoolRows.length; index += 1) {
    cb(
      state.centerPoolRows[index]!,
      state.leftPoolRows[index] ?? null,
      state.rightPoolRows[index] ?? null,
    );
  }
}
