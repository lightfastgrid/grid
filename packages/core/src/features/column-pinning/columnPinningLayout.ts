import type { ColumnDef } from "../../types";

export interface ColumnPinningLayout {
  leftPinned: ColumnDef[];
  center: ColumnDef[];
  rightPinned: ColumnDef[];
  ordered: ColumnDef[];
}

export function buildColumnPinningLayout(
  columns: readonly ColumnDef[],
): ColumnPinningLayout {
  const leftPinned: ColumnDef[] = [];
  const center: ColumnDef[] = [];
  const rightPinned: ColumnDef[] = [];

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]!;
    if (col.pinned === "left") {
      leftPinned.push(col);
    } else if (col.pinned === "right") {
      rightPinned.push(col);
    } else {
      center.push(col);
    }
  }

  const ordered = leftPinned.concat(center, rightPinned);

  return { leftPinned, center, rightPinned, ordered };
}
