import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type { RowData } from "../../types";

export type RowPinPosition = "top" | "bottom";

export interface RowPinState {
  readonly [rowId: string]: RowPinPosition;
}

export interface PinnedRowEntry {
  /** Position of this row in display order. */
  displayIndex: number;
  rowId: string;
  row: RowData;
}

export interface RowPinningRenderModel {
  top: PinnedRowEntry[];
  bottom: PinnedRowEntry[];
  /**
   * Map a center body row index to its display index.
   *
   * `null` signals an identity mapping (`center[i] === i`) — the no-pin
   * fast path and the case where no pinned id resolves to a row.
   * Downstream consumers skip the per-index call entirely and use
   * `centerRowCount` for length. When non-null, each call costs
   * O(pinned count), which is small by construction.
   */
  centerToDisplayIndex: ((centerIndex: number) => number) | null;
  /** Always populated. Equals `displayRows.rowCount` when no pins are active. */
  centerRowCount: number;
}

type ResolveRowId = (row: RowData, index: number) => string;

const EMPTY_MODEL: RowPinningRenderModel = {
  top: [],
  bottom: [],
  centerToDisplayIndex: null,
  centerRowCount: 0,
};

function pinStateSignature(state: RowPinState): string {
  const keys = Object.keys(state);
  if (keys.length === 0) return "";
  keys.sort();
  let sig = "";
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) sig += "\0";
    sig += keys[i]! + "\0" + state[keys[i]!];
  }
  return sig;
}

/**
 * Build the center → display index mapper for a set of pinned display
 * indices (sorted ascending). Each excluded index at or below the
 * running display position shifts the mapping up by one.
 */
function createCenterMapper(
  excludedDisplayIndices: number[],
): (centerIndex: number) => number {
  return (centerIndex: number): number => {
    let displayIndex = centerIndex;
    for (let k = 0; k < excludedDisplayIndices.length; k++) {
      if (excludedDisplayIndices[k]! <= displayIndex) displayIndex++;
      else break;
    }
    return displayIndex;
  };
}

export function createRowPinningRenderModelBuilder(): (
  displayRows: DisplayRowReader,
  pinState: RowPinState,
  resolveRowId: ResolveRowId,
) => RowPinningRenderModel {
  let cachedDisplayRows: DisplayRowReader | null = null;
  let cachedSignature = "";
  let cachedResolveRowId: ResolveRowId | null = null;
  let cachedModel: RowPinningRenderModel = EMPTY_MODEL;

  // Row id → display index, built lazily with one O(n) scan when pin
  // state is non-empty. Cached by (DisplayRowReader ref, resolveRowId
  // ref) so repeated pin-state changes over the same display rows cost
  // O(pinned count), not O(total rows). The same scan records
  // `validDisplayIndices` when any reader slot returns undefined — the
  // defensive sparse case, where center mapping must skip invalid rows.
  // Real `DisplayRowReader`s have no gaps, so it stays `null`.
  interface RowIdIndex {
    map: Map<string, number>;
    /** Valid display indices, only when undefined rows were detected. */
    validDisplayIndices: number[] | null;
  }
  let idIndexDisplayRows: DisplayRowReader | null = null;
  let idIndexResolveRowId: ResolveRowId | null = null;
  let idIndex: RowIdIndex | null = null;

  function getRowIdIndex(
    displayRows: DisplayRowReader,
    resolveRowId: ResolveRowId,
  ): RowIdIndex {
    if (
      idIndex !== null &&
      displayRows === idIndexDisplayRows &&
      resolveRowId === idIndexResolveRowId
    ) {
      return idIndex;
    }
    const map = new Map<string, number>();
    let validDisplayIndices: number[] | null = null;
    for (let i = 0; i < displayRows.rowCount; i++) {
      const row = displayRows.getRowData(i);
      if (row === undefined) {
        if (validDisplayIndices === null) {
          // First invalid slot — backfill the valid indices seen so far.
          validDisplayIndices = [];
          for (let v = 0; v < i; v++) validDisplayIndices.push(v);
        }
        continue;
      }
      map.set(resolveRowId(row, i), i);
      validDisplayIndices?.push(i);
    }
    idIndexDisplayRows = displayRows;
    idIndexResolveRowId = resolveRowId;
    idIndex = { map, validDisplayIndices };
    return idIndex;
  }

  return function buildRowPinningRenderModel(
    displayRows: DisplayRowReader,
    pinState: RowPinState,
    resolveRowId: ResolveRowId,
  ): RowPinningRenderModel {
    const sig = pinStateSignature(pinState);

    if (sig === "") {
      // Fast path: no pins active. Identity mapping, no row id
      // resolution, no per-row work.
      if (displayRows === cachedDisplayRows && cachedSignature === "") {
        return cachedModel;
      }
      cachedDisplayRows = displayRows;
      cachedSignature = sig;
      cachedResolveRowId = null;
      cachedModel = {
        top: [],
        bottom: [],
        centerToDisplayIndex: null,
        centerRowCount: displayRows.rowCount,
      };
      return cachedModel;
    }

    if (
      displayRows === cachedDisplayRows &&
      sig === cachedSignature &&
      resolveRowId === cachedResolveRowId
    ) {
      return cachedModel;
    }

    // Resolve pinned ids through the cached id index — O(pinned count)
    // after the index is built once per (displayRows, resolveRowId).
    const index = getRowIdIndex(displayRows, resolveRowId);

    const top: PinnedRowEntry[] = [];
    const bottom: PinnedRowEntry[] = [];
    for (const rowId of Object.keys(pinState)) {
      const displayIndex = index.map.get(rowId);
      if (displayIndex === undefined) continue; // missing id — do not render
      const row = displayRows.getRowData(displayIndex);
      if (row === undefined) continue;
      const entry: PinnedRowEntry = { displayIndex, rowId, row };
      if (pinState[rowId] === "top") top.push(entry);
      else bottom.push(entry);
    }
    // Pinned lanes follow current display/sort order.
    top.sort((a, b) => a.displayIndex - b.displayIndex);
    bottom.sort((a, b) => a.displayIndex - b.displayIndex);

    const pinnedCount = top.length + bottom.length;
    let centerToDisplayIndex: ((centerIndex: number) => number) | null = null;
    let centerRowCount: number;

    if (index.validDisplayIndices !== null) {
      // Defensive sparse case: the reader reported undefined rows.
      // Center contains only valid, unpinned display rows — build a
      // small explicit mapping from the recorded valid indices.
      const pinnedDisplayIndices = new Set<number>();
      for (const e of top) pinnedDisplayIndices.add(e.displayIndex);
      for (const e of bottom) pinnedDisplayIndices.add(e.displayIndex);
      const center = index.validDisplayIndices.filter(
        (d) => !pinnedDisplayIndices.has(d),
      );
      centerRowCount = center.length;
      centerToDisplayIndex = (centerIndex: number): number =>
        center[centerIndex] ?? -1;
    } else {
      centerRowCount = displayRows.rowCount - pinnedCount;
      if (pinnedCount > 0) {
        const excluded = new Array<number>(pinnedCount);
        for (let i = 0; i < top.length; i++) excluded[i] = top[i]!.displayIndex;
        for (let i = 0; i < bottom.length; i++) {
          excluded[top.length + i] = bottom[i]!.displayIndex;
        }
        excluded.sort((a, b) => a - b);
        centerToDisplayIndex = createCenterMapper(excluded);
      }
    }

    cachedDisplayRows = displayRows;
    cachedSignature = sig;
    cachedResolveRowId = resolveRowId;
    cachedModel = {
      top,
      bottom,
      centerToDisplayIndex,
      centerRowCount,
    };
    return cachedModel;
  };
}
