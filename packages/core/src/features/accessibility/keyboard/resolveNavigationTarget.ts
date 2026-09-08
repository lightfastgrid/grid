import type { VisualRowLayout } from "../../../internal/layoutTypes";

import {
  copyKeyboardTarget,
  createKeyboardTargetState,
  KEYBOARD_NAVIGATION_MOVED,
  KEYBOARD_NAVIGATION_UNCHANGED,
  type KeyboardMoveDirection,
  type KeyboardNavigationResult,
  keyboardTargetsEqual,
  type KeyboardTargetState,
  type KeyboardWritingDirection,
  setBodyCellTarget,
  setFloatingFilterTarget,
  setGroupHeaderTarget,
  setLeafHeaderTarget,
} from "./keyboardTarget";
import type {
  KeyboardGroupTargetSpan,
  KeyboardNavigationPlan,
} from "./navigationPlan";
import { resolveInitialKeyboardTarget } from "./resolveInitialTarget";
import {
  keyboardDisplayIndexAtVisual,
  keyboardVisualRowCount,
} from "./visualRows";

export interface KeyboardNavigationContext {
  plan: KeyboardNavigationPlan;
  rowLayout: VisualRowLayout;
  pageSize: number;
  writingDirection: KeyboardWritingDirection;
}

export interface KeyboardNavigationScratch {
  readonly normalized: KeyboardTargetState;
  readonly candidate: KeyboardTargetState;
}

export function createKeyboardNavigationScratch(): KeyboardNavigationScratch {
  return {
    normalized: createKeyboardTargetState(),
    candidate: createKeyboardTargetState(),
  };
}

function clamp(value: number, max: number): number {
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

function clampRange(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizedOrdinal(plan: KeyboardNavigationPlan, value: number): number {
  const max = plan.columns.length - 1;
  if (max < 0 || !Number.isFinite(value)) return 0;
  return clamp(Math.trunc(value), max);
}

function normalizedPageSize(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

function bodyDataColumnOrdinal(
  plan: KeyboardNavigationPlan,
  ordinal: number,
): number {
  if (plan.columns[ordinal]?.column.internal === undefined) return ordinal;
  const next = plan.nextDataColumnOrdinal[ordinal] ?? -1;
  if (next >= 0) return next;
  return plan.previousDataColumnOrdinal[ordinal] ?? -1;
}

function findContainingSpanIndex(
  spans: readonly KeyboardGroupTargetSpan[],
  ordinal: number,
): number {
  let low = 0;
  let high = spans.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const span = spans[middle]!;
    if (ordinal < span.startColumnOrdinal) high = middle - 1;
    else if (ordinal > span.endColumnOrdinal) low = middle + 1;
    else return middle;
  }
  return -1;
}

function writeGroupAtLevel(
  target: KeyboardTargetState,
  plan: KeyboardNavigationPlan,
  level: number,
  ordinal: number,
): boolean {
  const row = plan.groupRows[level];
  if (row === undefined) return false;
  const spanIndex = findContainingSpanIndex(row.spans, ordinal);
  if (spanIndex < 0) return false;
  const span = row.spans[spanIndex]!;
  setGroupHeaderTarget(
    target,
    level,
    spanIndex,
    clamp(ordinal, span.endColumnOrdinal),
  );
  return true;
}

function writeLowestGroup(
  target: KeyboardTargetState,
  plan: KeyboardNavigationPlan,
  ordinal: number,
): boolean {
  for (let level = plan.groupRows.length - 1; level >= 0; level--) {
    if (writeGroupAtLevel(target, plan, level, ordinal)) return true;
  }
  return false;
}

function normalizeCurrent(
  current: Readonly<KeyboardTargetState>,
  ctx: KeyboardNavigationContext,
  target: KeyboardTargetState,
): boolean {
  if (ctx.plan.columns.length === 0) return false;
  const kind: unknown = current.kind;
  if (
    kind !== "groupHeader" &&
    kind !== "leafHeader" &&
    kind !== "floatingFilter" &&
    kind !== "bodyCell"
  ) {
    return false;
  }
  const ordinal = normalizedOrdinal(
    ctx.plan,
    current.kind === "groupHeader"
      ? current.anchorColumnOrdinal
      : current.columnOrdinal,
  );
  if (current.kind === "groupHeader") {
    const row = ctx.plan.groupRows[current.level];
    const span = row?.spans[current.spanIndex];
    if (span !== undefined) {
      setGroupHeaderTarget(
        target,
        current.level,
        current.spanIndex,
        clampRange(
          ordinal,
          span.startColumnOrdinal,
          span.endColumnOrdinal,
        ),
      );
      return true;
    }
    setLeafHeaderTarget(target, ordinal);
    return true;
  }
  if (current.kind === "leafHeader") {
    setLeafHeaderTarget(target, ordinal);
    return true;
  }
  if (current.kind === "floatingFilter") {
    if (ctx.plan.hasFloatingFilterRow) setFloatingFilterTarget(target, ordinal);
    else setLeafHeaderTarget(target, ordinal);
    return true;
  }
  const rowCount = keyboardVisualRowCount(ctx.rowLayout);
  if (rowCount === 0) {
    setLeafHeaderTarget(target, ordinal);
    return true;
  }
  const visual = Number.isFinite(current.visualRowIndex)
    ? clamp(Math.trunc(current.visualRowIndex), rowCount - 1)
    : 0;
  const bodyOrdinal = bodyDataColumnOrdinal(ctx.plan, ordinal);
  if (bodyOrdinal < 0) {
    setLeafHeaderTarget(target, ordinal);
    return true;
  }
  setBodyCellTarget(
    target,
    visual,
    keyboardDisplayIndexAtVisual(ctx.rowLayout, visual),
    bodyOrdinal,
  );
  return true;
}

function horizontalDelta(
  direction: "left" | "right",
  writingDirection: KeyboardWritingDirection,
): -1 | 1 {
  const rtl = writingDirection === "rtl";
  return direction === "left" ? (rtl ? 1 : -1) : (rtl ? -1 : 1);
}

function moveHorizontal(
  current: Readonly<KeyboardTargetState>,
  direction: "left" | "right",
  ctx: KeyboardNavigationContext,
  target: KeyboardTargetState,
): boolean {
  const delta = horizontalDelta(direction, ctx.writingDirection);
  if (current.kind === "groupHeader") {
    const row = ctx.plan.groupRows[current.level];
    if (row === undefined) return false;
    const next = current.spanIndex + delta;
    const span = row.spans[next];
    if (span === undefined) return false;
    setGroupHeaderTarget(
      target,
      current.level,
      next,
      delta > 0 ? span.startColumnOrdinal : span.endColumnOrdinal,
    );
    return true;
  }
  const next = current.kind === "bodyCell"
    ? delta < 0
      ? ctx.plan.previousDataColumnOrdinal[current.columnOrdinal]
      : ctx.plan.nextDataColumnOrdinal[current.columnOrdinal]
    : current.columnOrdinal + delta;
  if (next === undefined) return false;
  if (next < 0 || next >= ctx.plan.columns.length) return false;
  if (current.kind === "leafHeader") setLeafHeaderTarget(target, next);
  else if (current.kind === "floatingFilter") setFloatingFilterTarget(target, next);
  else setBodyCellTarget(
    target,
    current.visualRowIndex,
    current.displayRowIndex,
    next,
  );
  return true;
}

function moveHomeEnd(
  current: Readonly<KeyboardTargetState>,
  direction: "home" | "end",
  ctx: KeyboardNavigationContext,
  target: KeyboardTargetState,
): boolean {
  if (current.kind === "groupHeader") {
    const row = ctx.plan.groupRows[current.level];
    if (row === undefined || row.spans.length === 0) return false;
    const spanIndex = direction === "home" ? 0 : row.spans.length - 1;
    const span = row.spans[spanIndex]!;
    setGroupHeaderTarget(
      target,
      current.level,
      spanIndex,
      direction === "home"
        ? span.startColumnOrdinal
        : span.endColumnOrdinal,
    );
    return true;
  }
  const ordinal = current.kind === "bodyCell"
    ? direction === "home"
      ? ctx.plan.firstDataColumnOrdinal
      : ctx.plan.lastDataColumnOrdinal
    : direction === "home"
      ? 0
      : ctx.plan.columns.length - 1;
  if (ordinal < 0) return false;
  if (current.kind === "leafHeader") setLeafHeaderTarget(target, ordinal);
  else if (current.kind === "floatingFilter") setFloatingFilterTarget(target, ordinal);
  else setBodyCellTarget(
    target,
    current.visualRowIndex,
    current.displayRowIndex,
    ordinal,
  );
  return true;
}

function moveVertical(
  current: Readonly<KeyboardTargetState>,
  direction: "up" | "down" | "pageUp" | "pageDown",
  ctx: KeyboardNavigationContext,
  target: KeyboardTargetState,
): boolean {
  const ordinal = current.kind === "groupHeader"
    ? current.anchorColumnOrdinal
    : current.columnOrdinal;
  if (current.kind === "groupHeader") {
    if (direction === "up") {
      return current.level > 0 &&
        writeGroupAtLevel(target, ctx.plan, current.level - 1, ordinal);
    }
    if (direction !== "down") return false;
    if (writeGroupAtLevel(target, ctx.plan, current.level + 1, ordinal)) return true;
    setLeafHeaderTarget(target, ordinal);
    return true;
  }
  if (current.kind === "leafHeader") {
    if (direction === "up") return writeLowestGroup(target, ctx.plan, ordinal);
    if (direction !== "down") return false;
    if (ctx.plan.hasFloatingFilterRow) setFloatingFilterTarget(target, ordinal);
    else if (keyboardVisualRowCount(ctx.rowLayout) > 0) {
      const bodyOrdinal = bodyDataColumnOrdinal(ctx.plan, ordinal);
      if (bodyOrdinal < 0) return false;
      setBodyCellTarget(
        target,
        0,
        keyboardDisplayIndexAtVisual(ctx.rowLayout, 0),
        bodyOrdinal,
      );
    } else return false;
    return true;
  }
  if (current.kind === "floatingFilter") {
    if (direction === "up") {
      setLeafHeaderTarget(target, ordinal);
      return true;
    }
    if (direction !== "down" || keyboardVisualRowCount(ctx.rowLayout) === 0) {
      return false;
    }
    const bodyOrdinal = bodyDataColumnOrdinal(ctx.plan, ordinal);
    if (bodyOrdinal < 0) return false;
    setBodyCellTarget(
      target,
      0,
      keyboardDisplayIndexAtVisual(ctx.rowLayout, 0),
      bodyOrdinal,
    );
    return true;
  }

  const rowCount = keyboardVisualRowCount(ctx.rowLayout);
  if (rowCount === 0) return false;
  const page = normalizedPageSize(ctx.pageSize);
  const delta = direction === "up"
    ? -1
    : direction === "down"
      ? 1
      : direction === "pageUp"
        ? -page
        : page;
  const next = current.visualRowIndex + delta;
  if (next < 0 && direction === "up") {
    if (ctx.plan.hasFloatingFilterRow) setFloatingFilterTarget(target, ordinal);
    else setLeafHeaderTarget(target, ordinal);
    return true;
  }
  const clamped = clamp(next, rowCount - 1);
  setBodyCellTarget(
    target,
    clamped,
    keyboardDisplayIndexAtVisual(ctx.rowLayout, clamped),
    ordinal,
  );
  return clamped !== current.visualRowIndex;
}

function writeFirstTarget(
  plan: KeyboardNavigationPlan,
  target: KeyboardTargetState,
): boolean {
  if (plan.columns.length === 0) return false;
  const top = plan.groupRows[0];
  const span = top?.spans[0];
  if (span !== undefined) {
    setGroupHeaderTarget(target, 0, 0, span.startColumnOrdinal);
  } else {
    setLeafHeaderTarget(target, 0);
  }
  return true;
}

function writeLastTarget(
  ctx: KeyboardNavigationContext,
  target: KeyboardTargetState,
): boolean {
  const lastColumn = ctx.plan.columns.length - 1;
  if (lastColumn < 0) return false;
  const rows = keyboardVisualRowCount(ctx.rowLayout);
  if (rows === 0 || ctx.plan.lastDataColumnOrdinal < 0) {
    setLeafHeaderTarget(target, lastColumn);
  }
  else setBodyCellTarget(
    target,
    rows - 1,
    keyboardDisplayIndexAtVisual(ctx.rowLayout, rows - 1),
    ctx.plan.lastDataColumnOrdinal,
  );
  return true;
}

/**
 * Resolve one move into retained scratch. The returned result is a frozen
 * module constant; no target or result object is allocated per call.
 */
export function resolveKeyboardNavigationTarget(
  current: Readonly<KeyboardTargetState>,
  direction: KeyboardMoveDirection,
  ctx: KeyboardNavigationContext,
  scratch: KeyboardNavigationScratch,
): KeyboardNavigationResult {
  if (current.kind === "none") {
    return resolveInitialKeyboardTarget(ctx.plan, ctx.rowLayout, scratch.candidate)
      ? KEYBOARD_NAVIGATION_MOVED
      : KEYBOARD_NAVIGATION_UNCHANGED;
  }
  if (!normalizeCurrent(current, ctx, scratch.normalized)) {
    return KEYBOARD_NAVIGATION_UNCHANGED;
  }

  const normalized = scratch.normalized;
  let wrote = false;
  switch (direction) {
    case "left":
    case "right":
      wrote = moveHorizontal(normalized, direction, ctx, scratch.candidate);
      break;
    case "home":
    case "end":
      wrote = moveHomeEnd(normalized, direction, ctx, scratch.candidate);
      break;
    case "firstTarget":
      wrote = writeFirstTarget(ctx.plan, scratch.candidate);
      break;
    case "lastTarget":
      wrote = writeLastTarget(ctx, scratch.candidate);
      break;
    case "up":
    case "down":
    case "pageUp":
    case "pageDown":
      wrote = moveVertical(normalized, direction, ctx, scratch.candidate);
      break;
  }
  if (!wrote || keyboardTargetsEqual(normalized, scratch.candidate)) {
    copyKeyboardTarget(scratch.candidate, normalized);
    return KEYBOARD_NAVIGATION_UNCHANGED;
  }
  return KEYBOARD_NAVIGATION_MOVED;
}
