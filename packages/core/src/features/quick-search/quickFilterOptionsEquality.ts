import type {
  QuickFilterMatcher,
  QuickFilterOptions,
  QuickFilterParser,
} from "../../types";

import { isQuickFilterEnabled } from "./quickFilterConfig";

export function quickFilterOptionsEqual(
  a: boolean | QuickFilterOptions | undefined,
  b: boolean | QuickFilterOptions | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b;
  if (typeof a === "boolean" || typeof b === "boolean") return false;
  return (
    a.enabled === b.enabled &&
    a.includeHiddenColumns === b.includeHiddenColumns &&
    a.cache === b.cache &&
    a.prewarm === b.prewarm &&
    a.parser === b.parser &&
    a.matcher === b.matcher
  );
}

/**
 * Dependency-relevant quick-filter values after normalizing boolean / object /
 * undefined representations. Cache and prewarm are intentionally excluded.
 *
 * When disabled, parser/matcher are cleared so disabled representations compare
 * equal regardless of unused custom handlers.
 */
interface NormalizedQuickFilterDependency {
  readonly enabled: boolean;
  readonly includeHiddenColumns: boolean;
  readonly parser: QuickFilterParser | undefined;
  readonly matcher: QuickFilterMatcher | undefined;
}

function normalizeQuickFilterDependency(
  quickFilter: boolean | QuickFilterOptions | undefined,
): NormalizedQuickFilterDependency {
  const enabled = isQuickFilterEnabled(quickFilter);
  if (!enabled) {
    return {
      enabled: false,
      includeHiddenColumns: false,
      parser: undefined,
      matcher: undefined,
    };
  }

  if (typeof quickFilter !== "object") {
    // `true` or `undefined` — enabled defaults.
    return {
      enabled: true,
      includeHiddenColumns: false,
      parser: undefined,
      matcher: undefined,
    };
  }

  return {
    enabled: true,
    includeHiddenColumns: quickFilter.includeHiddenColumns ?? false,
    parser: quickFilter.parser,
    matcher: quickFilter.matcher,
  };
}

/**
 * Equality for options that affect dependency-plan descriptors / signatures /
 * workerSafe. Ignores cache and prewarm so those can change without rebuilding
 * the plan or clearing retained dirty deltas.
 */
export function quickFilterDependencyOptionsEqual(
  a: boolean | QuickFilterOptions | undefined,
  b: boolean | QuickFilterOptions | undefined,
): boolean {
  if (a === b) return true;
  const left = normalizeQuickFilterDependency(a);
  const right = normalizeQuickFilterDependency(b);
  return (
    left.enabled === right.enabled &&
    left.includeHiddenColumns === right.includeHiddenColumns &&
    left.parser === right.parser &&
    left.matcher === right.matcher
  );
}

export function quickFilterConfigKey(
  quickFilter: boolean | QuickFilterOptions | undefined,
): string {
  if (quickFilter === undefined) return "undefined";
  if (typeof quickFilter === "boolean") return `boolean:${quickFilter}`;
  return JSON.stringify({
    enabled: quickFilter.enabled,
    includeHiddenColumns: quickFilter.includeHiddenColumns,
    cache: quickFilter.cache,
    prewarm: quickFilter.prewarm,
  });
}
