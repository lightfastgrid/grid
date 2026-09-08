import { buildColumnPinningGeometry, columnWidthWithOverride } from "../../features/column-pinning/columnPinningGeometry";
import type { ColumnPinningLayout } from "../../features/column-pinning/columnPinningLayout";
import type { ColumnWidthOverride } from "../../internal/layoutTypes";
import type { ColumnDef } from "../../types";

import { fieldToCssToken } from "./columnGeometryVars";

/**
 * Sets `--col-{token}-left`, `--col-{token}-width` for every column and
 * `--lfg-total-width` and `--lfg-left-pinned-width` on the grid root.
 *
 * When a pinning layout is provided, left-pinned columns get offsets
 * starting at 0 and center columns get offsets starting at leftPinnedWidth.
 */
export function applyColumnWidthVars(
  root: HTMLElement,
  columns: ColumnDef[],
  override?: ColumnWidthOverride | null,
  pinningLayout?: ColumnPinningLayout | null,
): void {
  if (pinningLayout && (pinningLayout.leftPinned.length > 0 || pinningLayout.rightPinned.length > 0)) {
    applyColumnWidthVarsPinned(root, pinningLayout, override);
    return;
  }

  let x = 0;
  for (const col of columns) {
    const token = fieldToCssToken(col.field);
    const width = columnWidthWithOverride(col, override);
    root.style.setProperty(`--col-${token}-left`, `${x}px`);
    root.style.setProperty(`--col-${token}-width`, `${width}px`);
    x += width;
  }

  root.style.setProperty("--lfg-total-width", `${x}px`);
  root.style.setProperty("--lfg-left-pinned-width", "0px");
  root.style.setProperty("--lfg-right-pinned-width", "0px");
}

function applyColumnWidthVarsPinned(
  root: HTMLElement,
  layout: ColumnPinningLayout,
  override?: ColumnWidthOverride | null,
): void {
  const geo = buildColumnPinningGeometry(layout, override);

  for (const col of layout.leftPinned) {
    const token = fieldToCssToken(col.field);
    root.style.setProperty(`--col-${token}-left`, `${geo.leftOffsetsByField.get(col.field)!}px`);
    root.style.setProperty(`--col-${token}-width`, `${columnWidthWithOverride(col, override)}px`);
  }

  for (const col of layout.center) {
    const token = fieldToCssToken(col.field);
    root.style.setProperty(`--col-${token}-left`, `${geo.leftPinnedWidth + geo.centerOffsetsByField.get(col.field)!}px`);
    root.style.setProperty(`--col-${token}-width`, `${columnWidthWithOverride(col, override)}px`);
  }

  for (const col of layout.rightPinned) {
    const token = fieldToCssToken(col.field);
    root.style.setProperty(`--col-${token}-left`, `${geo.rightOffsetsByField.get(col.field)!}px`);
    root.style.setProperty(`--col-${token}-width`, `${columnWidthWithOverride(col, override)}px`);
  }

  root.style.setProperty("--lfg-left-pinned-width", `${geo.leftPinnedWidth}px`);
  root.style.setProperty("--lfg-right-pinned-width", `${geo.rightPinnedWidth}px`);
  root.style.setProperty("--lfg-total-width", `${geo.totalWidth}px`);
}
