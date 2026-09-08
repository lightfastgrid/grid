/**
 * Pure functions that compute the visible row/column windows from scroll state.
 * No side effects, no DOM, no mutable renderer state — easy to unit-test.
 */

import type { ColumnDef } from "../../types";
import { POOL_SIDE_BUFFER_ROWS } from "../helpers/calculatePoolSize";
import type { ColumnWidthOverride } from "../helpers/columnLayout";

import {
  buildCachedColumnLayout,
  computeColumnWindowFromLayout,
} from "./columnLayoutCache";

export interface RowWindow {
  startIndex: number;
}

export interface ColWindowResult {
  startCol: number;
  slotCount: number;
  edges: readonly number[];
  key: string;
  totalWidth: number;
}

export function computeRowWindow(
  scrollTop: number,
  dataLength: number,
  poolSize: number,
  rowHeight: number,
  headerHeight: number,
  suppressVirtualization: boolean,
): RowWindow {
  const rawStart = suppressVirtualization
    ? 0
    : Math.floor((scrollTop - headerHeight) / rowHeight) -
      POOL_SIDE_BUFFER_ROWS;
  const maxStart = Math.max(0, dataLength - poolSize);
  return { startIndex: Math.max(0, Math.min(rawStart, maxStart)) };
}

export function computeColumnWindow(
  scrollLeft: number,
  columns: ColumnDef[],
  columnSlotCount: number,
  suppressVirtualization: boolean,
  liveOverride?: ColumnWidthOverride | null,
): ColWindowResult {
  const layout = buildCachedColumnLayout(columns, liveOverride ?? null);
  return computeColumnWindowFromLayout(
    scrollLeft,
    layout,
    columnSlotCount,
    suppressVirtualization,
  );
}
