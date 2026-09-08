import { columnPixelWidth } from "../../internal/columnSizing";
import type { ColumnDef } from "../../types";

function pinSide(col: ColumnDef): "left" | "center" | "right" {
  if (col.pinned === "left") return "left";
  if (col.pinned === "right") return "right";
  return "center";
}

/** True when both arrays have the same fields in the same order with the same pin side. */
export function columnsStructureMatch(
  prev: ColumnDef[],
  next: ColumnDef[],
): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < next.length; i++) {
    const a = next[i];
    const b = prev[i];
    if (a === undefined || b === undefined) return false;
    if (a.field !== b.field || pinSide(a) !== pinSide(b)) return false;
  }
  return true;
}

/** True when every column has the same pixel width in both arrays. */
export function columnsWidthMatch(
  prev: ColumnDef[],
  next: ColumnDef[],
): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < next.length; i++) {
    const a = next[i];
    const b = prev[i];
    if (a === undefined || b === undefined) return false;
    if (columnPixelWidth(a) !== columnPixelWidth(b)) return false;
  }
  return true;
}
