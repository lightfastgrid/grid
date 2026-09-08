import type { ColumnDef } from "../types";

import {
  isCombinedRowControlsColumn,
  isRowDragHostColumn,
  isSelectionHostColumn,
} from "./rowControlColumns";
import { isRowDragColumn } from "./rowDragColumn";
import { isSelectionColumn } from "./selectionColumn";

export type InternalColumnKind = "selection" | "row-drag" | "row-controls";

/**
 * True for any core-owned system column (selection, row-drag, combined controls).
 * Use kind-specific helpers when rendering or behavior is unique to one kind.
 */
export function isInternalColumn(
  col: Pick<ColumnDef, "field" | "internal">,
): boolean {
  return (
    isSelectionColumn(col) ||
    isRowDragColumn(col) ||
    isCombinedRowControlsColumn(col)
  );
}

export {
  isCombinedRowControlsColumn,
  isRowDragColumn,
  isRowDragHostColumn,
  isSelectionColumn,
  isSelectionHostColumn,
};
