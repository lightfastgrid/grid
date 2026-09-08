import type { QuickFilterCacheMode, QuickFilterOptions } from "../../types";

/**
 * Determine whether the quick filter feature is enabled.
 *
 * - `undefined` → enabled (opt-in text activation).
 * - `true` → enabled.
 * - `false` → disabled; no quick-search scheduling or filtering.
 * - `{ enabled: false }` → disabled.
 * - `{ enabled: true }` or `{ ... }` without `enabled` → enabled.
 */
export function isQuickFilterEnabled(
  quickFilter: boolean | QuickFilterOptions | undefined,
): boolean {
  if (quickFilter === false) return false;
  if (typeof quickFilter === "object" && quickFilter.enabled === false) return false;
  return true;
}

/**
 * Determine whether a quick filter is both enabled and has a non-empty
 * query — i.e. quick-search work should be scheduled and results applied.
 */
export function isQuickFilterActive(
  text: string,
  quickFilter: boolean | QuickFilterOptions | undefined,
): boolean {
  if (!isQuickFilterEnabled(quickFilter)) return false;
  return text.trim().length > 0;
}

/** Extract `includeHiddenColumns` from a quick-filter config value. */
export function getIncludeHiddenColumns(
  quickFilter: boolean | QuickFilterOptions | undefined,
): boolean {
  if (typeof quickFilter === "object") {
    return quickFilter.includeHiddenColumns ?? false;
  }
  return false;
}

/** Resolve quick-search worker cache mode. Defaults to `"auto"`. */
export function getQuickFilterCacheMode(
  quickFilter: boolean | QuickFilterOptions | undefined,
): QuickFilterCacheMode {
  if (typeof quickFilter === "object") {
    return quickFilter.cache ?? "auto";
  }
  return "auto";
}

/** Resolve quick-filter worker snapshot prewarm mode. Defaults to `"auto"`. */
export function getQuickFilterPrewarmMode(
  quickFilter: boolean | QuickFilterOptions | undefined,
): boolean | "auto" {
  if (typeof quickFilter === "object" && quickFilter.prewarm !== undefined) {
    return quickFilter.prewarm;
  }
  return "auto";
}

export interface ShouldQuickFilterPrewarmInput {
  quickFilter: boolean | QuickFilterOptions | undefined;
  rowCount: number;
  threshold: number;
  workerEligible: boolean;
}

/** Whether background worker snapshot prewarm should run for the current config. */
export function shouldQuickFilterPrewarm(input: ShouldQuickFilterPrewarmInput): boolean {
  if (!isQuickFilterEnabled(input.quickFilter)) return false;
  if (!input.workerEligible) return false;

  const mode = getQuickFilterPrewarmMode(input.quickFilter);
  if (mode === false) return false;
  if (mode === "auto") return input.rowCount >= input.threshold;
  return true;
}
