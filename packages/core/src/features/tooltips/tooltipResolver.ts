/**
 * Pure resolver for cell tooltip text.
 *
 * No DOM access. No side effects. Errors thrown from user callbacks
 * propagate to the caller — by design, so misbehaving getters surface
 * loudly during development.
 *
 * Resolution order:
 *   1. If `tooltipValueGetter` is defined, call it. The getter receives the
 *      full params including both raw `value` and `formattedValue`.
 *   2. If `tooltipValueGetter` is not defined and `tooltip === true`, use
 *      `formattedValue` as the tooltip text.
 *   3. If neither is set (or `tooltip` is `false` / `undefined`), return
 *      `null` — no tooltip.
 *
 * Empty / whitespace-only results are normalized to `null`.
 */

import type { TooltipValueGetter, TooltipValueGetterParams } from "./types";

export interface ResolveTooltipInput {
  tooltip?: boolean;
  tooltipValueGetter?: TooltipValueGetter;
  params: TooltipValueGetterParams;
}

/**
 * Resolve tooltip text for a cell.
 *
 * Returns a non-empty string or `null`. Errors from `tooltipValueGetter`
 * are NOT caught — they propagate to the caller.
 */
export function resolveTooltip(input: ResolveTooltipInput): string | null {
  // 1. Functional getter takes priority over boolean flag. GridState already
  //    blocks default-getter inheritance when `tooltip: false`, so an explicit
  //    column getter always wins here.
  if (input.tooltipValueGetter !== undefined) {
    const result = input.tooltipValueGetter(input.params);
    return normalizeResult(result);
  }

  // 2. Boolean `tooltip: true` — use formatted display text.
  if (input.tooltip === true) {
    return normalizeResult(input.params.formattedValue);
  }

  // 3. No tooltip config.
  return null;
}

/** Normalize a string result: `null`/`undefined` → `null`, empty/whitespace → `null`. */
function normalizeResult(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value.trim().length === 0) return null;
  return value;
}
