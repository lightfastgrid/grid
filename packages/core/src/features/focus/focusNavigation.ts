/**
 * Pure focused-cell navigation.
 *
 * Computes the next (display rowIndex, field) position for a navigation
 * direction. Navigation walks the *visual* layout — visual row order is
 * top-pinned → center → bottom-pinned, and column order is
 * left-pinned → center → right-pinned — then maps the chosen visual row
 * back to its display index. Index math only: no DOM, no store, no
 * events. Clamps at boundaries and returns `null` when no movement is
 * possible (so callers can skip preventDefault / events).
 *
 * Cost is O(pinned count) per step: pinned lanes are small arrays and
 * the center body is an O(1) mapper — never O(total rows).
 */

import type { VisualRowLayout } from "../../internal/layoutTypes";
import type { FocusMoveDirection } from "../../types";

/**
 * Internal navigation directions: the public {@link FocusMoveDirection}
 * set plus the Ctrl/Cmd+Home/End jumps composed by the keyboard layer.
 */
export type FocusNavigationDirection =
  | FocusMoveDirection
  | "firstCell"
  | "lastCell";

export interface FocusNavigationContext {
  /** Visual row order (top-pinned → center → bottom-pinned). */
  rowLayout: VisualRowLayout;
  /** Focusable column fields in visual order (left → center → right). */
  focusableFields: readonly string[];
  /** Visual rows jumped by pageUp/pageDown. */
  pageSize: number;
}

export interface FocusPosition {
  /** Display (view) index of the row. */
  rowIndex: number;
  field: string;
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(0, value), max);
}

/** Total rows across all visual lanes. */
export function visualRowCount(layout: VisualRowLayout): number {
  return (
    layout.topDisplayIndexes.length +
    layout.centerRowCount +
    layout.bottomDisplayIndexes.length
  );
}

/**
 * Whether a display row index belongs to a pinned lane (top or bottom).
 * Pinned lanes are small explicit arrays — O(pinned count), no alloc.
 */
export function isPinnedDisplayIndex(
  layout: VisualRowLayout,
  displayIndex: number,
): boolean {
  return (
    layout.topDisplayIndexes.includes(displayIndex) ||
    layout.bottomDisplayIndexes.includes(displayIndex)
  );
}

/** Visual position → display index. */
export function displayIndexAtVisual(
  layout: VisualRowLayout,
  visualIndex: number,
): number {
  const topLen = layout.topDisplayIndexes.length;
  if (visualIndex < topLen) return layout.topDisplayIndexes[visualIndex]!;

  const centerPos = visualIndex - topLen;
  if (centerPos < layout.centerRowCount) {
    return layout.centerToDisplayIndex
      ? layout.centerToDisplayIndex(centerPos)
      : centerPos; // identity (no pinning)
  }

  const bottomPos = centerPos - layout.centerRowCount;
  return layout.bottomDisplayIndexes[bottomPos]!;
}

/**
 * Display index → visual position. Center rows derive their position
 * from "non-pinned display indexes before me", which equals
 * `displayIndex − (pinned display indexes before it)`.
 */
export function visualIndexOfDisplay(
  layout: VisualRowLayout,
  displayIndex: number,
): number {
  const topLen = layout.topDisplayIndexes.length;
  const topPos = layout.topDisplayIndexes.indexOf(displayIndex);
  if (topPos >= 0) return topPos;

  const bottomPos = layout.bottomDisplayIndexes.indexOf(displayIndex);
  if (bottomPos >= 0) return topLen + layout.centerRowCount + bottomPos;

  let pinnedBefore = 0;
  for (const d of layout.topDisplayIndexes) if (d < displayIndex) pinnedBefore++;
  for (const d of layout.bottomDisplayIndexes) {
    if (d < displayIndex) pinnedBefore++;
  }
  return topLen + (displayIndex - pinnedBefore);
}

/**
 * Resolve the target position for a navigation step, or `null` when
 * the move is impossible (no rows/columns) or fully clamped (already
 * at the boundary).
 *
 * A `null` current position means "no cell focused yet": any direction
 * resolves to the first visual row + first focusable column (the
 * keyboard layer gates which keys may initiate focus).
 */
export function resolveNavigationTarget(
  current: FocusPosition | null,
  direction: FocusNavigationDirection,
  ctx: FocusNavigationContext,
): FocusPosition | null {
  const rows = visualRowCount(ctx.rowLayout);
  const fields = ctx.focusableFields;
  if (rows === 0 || fields.length === 0) return null;

  const lastVisual = rows - 1;
  const lastField = fields.length - 1;

  if (current === null) {
    return {
      rowIndex: displayIndexAtVisual(ctx.rowLayout, 0),
      field: fields[0]!,
    };
  }

  const visualIndex = clamp(
    visualIndexOfDisplay(ctx.rowLayout, current.rowIndex),
    lastVisual,
  );
  let fieldIndex = fields.indexOf(current.field);
  if (fieldIndex < 0) fieldIndex = 0;

  let nextVisual = visualIndex;
  let nextFieldIndex = fieldIndex;

  switch (direction) {
    case "up":
      nextVisual = clamp(visualIndex - 1, lastVisual);
      break;
    case "down":
      nextVisual = clamp(visualIndex + 1, lastVisual);
      break;
    case "left":
      nextFieldIndex = clamp(fieldIndex - 1, lastField);
      break;
    case "right":
      nextFieldIndex = clamp(fieldIndex + 1, lastField);
      break;
    case "home":
      nextFieldIndex = 0;
      break;
    case "end":
      nextFieldIndex = lastField;
      break;
    case "pageUp":
      nextVisual = clamp(visualIndex - Math.max(1, ctx.pageSize), lastVisual);
      break;
    case "pageDown":
      nextVisual = clamp(visualIndex + Math.max(1, ctx.pageSize), lastVisual);
      break;
    case "firstCell":
      nextVisual = 0;
      nextFieldIndex = 0;
      break;
    case "lastCell":
      nextVisual = lastVisual;
      nextFieldIndex = lastField;
      break;
  }

  if (nextVisual === visualIndex && nextFieldIndex === fieldIndex) return null;
  return {
    rowIndex: displayIndexAtVisual(ctx.rowLayout, nextVisual),
    field: fields[nextFieldIndex]!,
  };
}
