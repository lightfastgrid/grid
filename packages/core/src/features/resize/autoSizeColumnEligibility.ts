/**
 * Determine whether a column is eligible for content-based autosize.
 *
 * Excludes:
 * - hidden columns (`visible: false`)
 * - internal system columns (selection, row-drag)
 * - action columns (`cellKind: "actions"`)
 * - non-resizable columns (`resizable: false` or selection column)
 *
 * Pinned columns ARE eligible if resizable — autosize is content-based,
 * not viewport-based.
 */

import { isColumnResizable } from "../../internal/columnSizing";
import { isInternalColumn } from "../../internal/internalColumns";
import type { ColumnDef } from "../../types";

export function isAutoSizeEligibleColumn(col: ColumnDef): boolean {
  if (col.visible === false) return false;
  if (isInternalColumn(col)) return false;
  if (col.cellKind === "actions") return false;
  if (!isColumnResizable(col)) return false;
  return true;
}
