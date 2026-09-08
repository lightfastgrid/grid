/**
 * Pure helper that computes column widths to fill a target viewport width.
 *
 * No DOM access. No side effects. Unit-testable in isolation.
 *
 * Algorithm:
 *   1. Filter eligible columns (visible, non-pinned, non-internal, non-suppressed).
 *   2. Use current effective widths as proportional weights.
 *   3. Distribute target width proportionally.
 *   4. Clamp to minWidth / maxWidth.
 *   5. Redistribute remaining width among unclamped columns.
 *   6. Round to integers; adjust final column to absorb rounding error.
 */

import {
  clampColumnWidth,
  columnPixelWidth,
} from "../../internal/columnSizing";
import { isInternalColumn } from "../../internal/internalColumns";
import type { ColumnDef } from "../../types";

export interface SizeToFitColumn {
  field: string;
  currentWidth: number;
  minWidth: number;
  maxWidth: number;
}

export interface SizeToFitResult {
  /** Map of field → new width (integers). Empty if no eligible columns. */
  widths: Record<string, number>;
}

/**
 * Determine whether a column is eligible for size-to-fit.
 *
 * Excludes:
 * - hidden columns
 * - pinned left/right columns
 * - internal system columns (selection, row-drag)
 * - action columns (`cellKind: "actions"`)
 * - columns with `suppressSizeToFit: true`
 * - non-resizable columns (`resizable: false`)
 */
export function isSizeToFitEligible(col: ColumnDef): boolean {
  if (col.visible === false) return false;
  if (col.pinned === "left" || col.pinned === "right") return false;
  if (isInternalColumn(col)) return false;
  if (col.cellKind === "actions") return false;
  if (col.suppressSizeToFit === true) return false;
  if (col.resizable === false) return false;
  return true;
}

/**
 * Build the eligible column list from effective column defs.
 */
export function buildSizeToFitColumns(columns: ColumnDef[]): SizeToFitColumn[] {
  const result: SizeToFitColumn[] = [];
  for (const col of columns) {
    if (!isSizeToFitEligible(col)) continue;
    result.push({
      field: col.field,
      currentWidth: columnPixelWidth(col),
      minWidth: col.minWidth ?? 48,
      maxWidth: col.maxWidth ?? 4000,
    });
  }
  return result;
}

/**
 * Compute new widths so eligible columns fill `targetWidth`.
 *
 * Returns an empty `widths` map if there are no eligible columns or
 * `targetWidth <= 0`.
 */
export function computeSizeToFit(
  columns: SizeToFitColumn[],
  targetWidth: number,
): SizeToFitResult {
  if (columns.length === 0 || targetWidth <= 0) {
    return { widths: {} };
  }

  const n = columns.length;
  const result: number[] = new Array(n);
  const clamped: boolean[] = new Array(n).fill(false);

  // Iterative proportional distribution with clamping.
  // Each pass distributes remaining width among unclamped columns.
  // Terminates when no column is newly clamped (max n iterations).
  const remaining = targetWidth;

  for (let pass = 0; pass < n; pass++) {
    let newlyClamped = false;
    let clampedTotal = 0;
    let unclampedWeight = 0;

    // First: identify unclamped columns and their weight.
    for (let i = 0; i < n; i++) {
      if (clamped[i]) {
        clampedTotal += result[i]!;
      } else {
        unclampedWeight += columns[i]!.currentWidth;
      }
    }

    const available = remaining - clampedTotal;
    if (unclampedWeight <= 0) break;

    // Distribute proportionally among unclamped columns.
    for (let i = 0; i < n; i++) {
      if (clamped[i]) continue;
      const col = columns[i]!;
      const proportional = (col.currentWidth / unclampedWeight) * available;
      const clampedWidth = clampColumnWidth(
        { field: col.field, minWidth: col.minWidth, maxWidth: col.maxWidth },
        proportional,
      );

      if (clampedWidth !== Math.round(proportional)) {
        result[i] = clampedWidth;
        clamped[i] = true;
        newlyClamped = true;
      } else {
        result[i] = proportional;
      }
    }

    if (!newlyClamped) break;
  }

  // Round to integers.
  let intSum = 0;
  for (let i = 0; i < n; i++) {
    result[i] = Math.round(result[i]!);
    intSum += result[i]!;
  }

  // Absorb rounding error on the last unclamped column.
  const diff = Math.round(targetWidth) - intSum;
  if (diff !== 0) {
    // Find the last unclamped column to absorb the difference.
    for (let i = n - 1; i >= 0; i--) {
      if (!clamped[i]) {
        const col = columns[i]!;
        const adjusted = clampColumnWidth(
          { field: col.field, minWidth: col.minWidth, maxWidth: col.maxWidth },
          result[i]! + diff,
        );
        result[i] = adjusted;
        break;
      }
    }
  }

  // Build result map.
  const widths: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    widths[columns[i]!.field] = result[i]!;
  }

  return { widths };
}

/**
 * Compute widths for selected eligible columns, with min-width fallback
 * when the reserved (unselected) width exceeds the viewport.
 *
 * - If available > sum of min widths, distributes proportionally.
 * - If available <= sum of min widths, sets each selected column to its min.
 * - Never resizes unselected columns.
 *
 * Pure helper — no DOM access.
 */
export function computeSizeSelectedToFit(
  allColumns: ColumnDef[],
  selectedEligible: SizeToFitColumn[],
  viewportWidth: number,
): SizeToFitResult {
  if (selectedEligible.length === 0 || viewportWidth <= 0) {
    return { widths: {} };
  }

  const eligibleFields = new Set<string>();
  for (const col of selectedEligible) eligibleFields.add(col.field);

  const reserved = computeReservedWidth(allColumns, eligibleFields);
  const available = viewportWidth - reserved;

  // Sum of min widths for selected eligible columns.
  let minTotal = 0;
  for (const col of selectedEligible) minTotal += col.minWidth;

  if (available <= minTotal) {
    // Not enough space — set each to its minWidth.
    const widths: Record<string, number> = {};
    for (const col of selectedEligible) {
      widths[col.field] = col.minWidth;
    }
    return { widths };
  }

  // Enough space — distribute proportionally.
  return computeSizeToFit(selectedEligible, available);
}

/**
 * Compute the total width reserved by non-eligible visible columns
 * (pinned, internal, actions, suppressed, non-resizable).
 *
 * Pure helper — no DOM access.
 */
export function computeReservedWidth(
  columns: ColumnDef[],
  eligibleFields: Set<string>,
): number {
  let reserved = 0;
  for (const col of columns) {
    if (col.visible === false) continue;
    if (col.pinned === "left" || col.pinned === "right") {
      reserved += columnPixelWidth(col);
    } else if (!eligibleFields.has(col.field)) {
      reserved += columnPixelWidth(col);
    }
  }
  return reserved;
}
