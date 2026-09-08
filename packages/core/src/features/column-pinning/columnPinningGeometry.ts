import { columnPixelWidth } from "../../internal/columnSizing";
import type { ColumnWidthOverride } from "../../internal/layoutTypes";
import type { ColumnDef } from "../../types";

import type { ColumnPinningLayout } from "./columnPinningLayout";

export interface ColumnPinningGeometry {
  leftPinnedWidth: number;
  centerWidth: number;
  rightPinnedWidth: number;
  totalWidth: number;
  leftOffsetsByField: Map<string, number>;
  centerOffsetsByField: Map<string, number>;
  rightOffsetsByField: Map<string, number>;
}

export function columnWidthWithOverride(
  col: ColumnDef,
  override?: ColumnWidthOverride | null,
): number {
  return override?.field === col.field ? override.width : columnPixelWidth(col);
}

export function pinnedWidths(
  layout: ColumnPinningLayout,
): { left: number; right: number } {
  let left = 0;
  for (const col of layout.leftPinned) left += columnPixelWidth(col);
  let right = 0;
  for (const col of layout.rightPinned) right += columnPixelWidth(col);
  return { left, right };
}

export function buildColumnPinningGeometry(
  layout: ColumnPinningLayout,
  override?: ColumnWidthOverride | null,
): ColumnPinningGeometry {
  const leftOffsetsByField = new Map<string, number>();
  let leftPinnedWidth = 0;
  for (let i = 0; i < layout.leftPinned.length; i++) {
    const col = layout.leftPinned[i]!;
    leftOffsetsByField.set(col.field, leftPinnedWidth);
    leftPinnedWidth += columnWidthWithOverride(col, override);
  }

  const centerOffsetsByField = new Map<string, number>();
  let centerWidth = 0;
  for (let i = 0; i < layout.center.length; i++) {
    const col = layout.center[i]!;
    centerOffsetsByField.set(col.field, centerWidth);
    centerWidth += columnWidthWithOverride(col, override);
  }

  const rightOffsetsByField = new Map<string, number>();
  let rightPinnedWidth = 0;
  for (let i = 0; i < layout.rightPinned.length; i++) {
    const col = layout.rightPinned[i]!;
    rightOffsetsByField.set(col.field, rightPinnedWidth);
    rightPinnedWidth += columnWidthWithOverride(col, override);
  }

  return {
    leftPinnedWidth,
    centerWidth,
    rightPinnedWidth,
    totalWidth: leftPinnedWidth + centerWidth + rightPinnedWidth,
    leftOffsetsByField,
    centerOffsetsByField,
    rightOffsetsByField,
  };
}
