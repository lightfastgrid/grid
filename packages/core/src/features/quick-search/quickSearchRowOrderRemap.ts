import {
  createIndexedRowOrder,
  getRowOrderLength,
  type RowOrder,
} from "../../row-model/rowOrder";
import type { RowData } from "../../types";

export interface QuickSearchLayoutSnapshot {
  previousRows: readonly RowData[];
  previousRowIdToIndex: ReadonlyMap<string, number>;
  previousOrder: RowOrder;
}

function buildSourceIndexToRowId(
  rowIdToIndex: ReadonlyMap<string, number>,
  rowCount: number,
): Array<string | null> {
  const out = new Array<string | null>(rowCount).fill(null);
  for (const [rowId, sourceIndex] of rowIdToIndex) {
    if (sourceIndex >= 0 && sourceIndex < rowCount) {
      out[sourceIndex] = rowId;
    }
  }
  return out;
}

function sourceIndexAt(order: RowOrder, displayIndex: number): number {
  return order.kind === "identity" ? displayIndex : order.indexes[displayIndex]!;
}

/**
 * Map a pre-layout RowOrder onto post-layout source indexes by row id.
 * Returns null when ids are unavailable or no rows survive the remap.
 */
export function remapRowOrderByRowIds(
  snapshot: QuickSearchLayoutSnapshot,
  nextRowIdToIndex: ReadonlyMap<string, number>,
): RowOrder | null {
  if (nextRowIdToIndex.size === 0) return null;

  const { previousRows, previousRowIdToIndex, previousOrder } = snapshot;
  if (previousRowIdToIndex.size === 0) return null;

  const indexToRowId = buildSourceIndexToRowId(
    previousRowIdToIndex,
    previousRows.length,
  );
  const length = getRowOrderLength(previousOrder);
  const remapped: number[] = [];

  for (let display = 0; display < length; display++) {
    const previousSourceIndex = sourceIndexAt(previousOrder, display);
    if (previousSourceIndex < 0 || previousSourceIndex >= previousRows.length) {
      continue;
    }
    const rowId = indexToRowId[previousSourceIndex];
    if (rowId === null || rowId === undefined) continue;
    const nextSourceIndex = nextRowIdToIndex.get(rowId);
    if (nextSourceIndex === undefined) continue;
    remapped.push(nextSourceIndex);
  }

  if (remapped.length === 0) return null;
  return createIndexedRowOrder(Uint32Array.from(remapped));
}
