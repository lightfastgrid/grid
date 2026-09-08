/**
 * Main-thread quick-search fallback executor.
 *
 * Pure, cancellable, chunked scan over source rows when worker execution
 * is unavailable or ineligible. Produces the same matching semantics as
 * the worker query engine's scan path.
 */

import type { QuickSearchNormalizer } from "../../../features/quick-search/normalizer";
import { defaultNormalizer } from "../../../features/quick-search/normalizer";
import { buildNormalizedRowAggregateText } from "../../../features/quick-search/rowAggregateText";
import { resolveSearchableColumns } from "../../../features/quick-search/searchableColumns";
import type { CooperativeHandle } from "../../../scheduling/CooperativeScheduler";
import { CooperativeScheduler } from "../../../scheduling/CooperativeScheduler";
import type {
  ColumnDef,
  QuickFilterMatcher,
  QuickFilterOptions,
  QuickFilterParser,
  RowData,
} from "../../../types";

import { parseQueryParts, rowTextMatchesParts } from "./quickSearchMatcher";
import type { QuickSearchExecutionHandle } from "./quickSearchQueryEngine";

export const DEFAULT_FALLBACK_TIME_BUDGET_MS = 8;
export const DEFAULT_FALLBACK_MAX_ROWS_PER_CHUNK = 5000;
const DEFAULT_SMALL_INPUT_THRESHOLD = 500;

export interface QuickSearchMainThreadFallbackConfig {
  rows: readonly RowData[];
  columns: readonly ColumnDef[];
  /** Already normalized through the shared normalizer. */
  normalizedText?: string;
  /** Raw query text — normalized via `normalizer` when `normalizedText` is omitted. */
  rawText?: string;
  normalizer?: QuickSearchNormalizer;
  /** Pre-parsed query parts — skips parser re-run when provided. */
  queryParts?: string[];
  quickFilter?: boolean | QuickFilterOptions;
  parser?: QuickFilterParser;
  matcher?: QuickFilterMatcher;
  /** Upstream filtered order; null = full dataset in identity order. */
  sourceIndexes?: Uint32Array | null;
  includeHiddenColumns?: boolean;
  scheduler?: CooperativeScheduler;
  /** Test hooks */
  timeBudgetMs?: number;
  maxRowsPerChunk?: number;
  now?: () => number;
  smallInputThreshold?: number;
}

interface ExecutionState {
  cancelled: boolean;
  pending: CooperativeHandle | null;
}

function resolveNormalizedText(config: QuickSearchMainThreadFallbackConfig): string {
  if (config.normalizedText !== undefined) return config.normalizedText;
  const normalizer = config.normalizer ?? defaultNormalizer;
  return normalizer.normalizeQuery(config.rawText ?? "");
}

function resolveQueryParts(
  normalizedText: string,
  parser?: QuickFilterParser,
): string[] {
  return parser ? parser(normalizedText) : parseQueryParts(normalizedText);
}

function isEmptyQuery(normalizedText: string, queryParts: string[]): boolean {
  return normalizedText.trim().length === 0 || queryParts.length === 0;
}

function createMatcher(
  matcher: QuickFilterMatcher | undefined,
): (rowText: string, queryParts: string[]) => boolean {
  if (matcher) {
    return (rowText, queryParts) => matcher({ rowText, queryParts });
  }
  return rowTextMatchesParts;
}

function resolveIncludeHidden(
  config: QuickSearchMainThreadFallbackConfig,
): boolean | undefined {
  const qfOpts = typeof config.quickFilter === "object" ? config.quickFilter : undefined;
  return config.includeHiddenColumns ?? qfOpts?.includeHiddenColumns;
}

function resolveSearchableColumnDefs(
  config: QuickSearchMainThreadFallbackConfig,
): ColumnDef[] {
  return resolveSearchableColumns(config.columns, {
    includeHiddenColumns: resolveIncludeHidden(config),
  });
}

function runSyncScan(
  config: QuickSearchMainThreadFallbackConfig,
  queryParts: string[],
  state: ExecutionState,
  onComplete: (indexes: Uint32Array) => void,
): void {
  const normalizer = config.normalizer ?? defaultNormalizer;
  const qfOpts = typeof config.quickFilter === "object" ? config.quickFilter : undefined;
  const matcherFn = createMatcher(config.matcher ?? qfOpts?.matcher);
  const searchableColumns = resolveSearchableColumnDefs(config);

  const src = config.sourceIndexes;
  const total = src !== null && src !== undefined ? src.length : config.rows.length;
  const idxAt = src !== null && src !== undefined ? (i: number) => src[i]! : (i: number) => i;
  const matches: number[] = [];

  for (let i = 0; i < total; i++) {
    if (state.cancelled) return;
    const rowIndex = idxAt(i);
    const rowText = buildNormalizedRowAggregateText(
      config.rows[rowIndex]!,
      searchableColumns,
      normalizer,
      rowIndex,
    );
    if (matcherFn(rowText, queryParts)) {
      matches.push(rowIndex);
    }
  }

  if (!state.cancelled) {
    onComplete(Uint32Array.from(matches));
  }
}

function runChunkedScan(
  config: QuickSearchMainThreadFallbackConfig,
  queryParts: string[],
  state: ExecutionState,
  onComplete: (indexes: Uint32Array) => void,
): void {
  const normalizer = config.normalizer ?? defaultNormalizer;
  const qfOpts = typeof config.quickFilter === "object" ? config.quickFilter : undefined;
  const matcherFn = createMatcher(config.matcher ?? qfOpts?.matcher);
  const searchableColumns = resolveSearchableColumnDefs(config);
  const scheduler = config.scheduler ?? new CooperativeScheduler();
  const timeBudgetMs = config.timeBudgetMs ?? DEFAULT_FALLBACK_TIME_BUDGET_MS;
  const maxRowsPerChunk = config.maxRowsPerChunk ?? DEFAULT_FALLBACK_MAX_ROWS_PER_CHUNK;
  const now = config.now ?? (() => performance.now());

  const src = config.sourceIndexes;
  const total = src !== null && src !== undefined ? src.length : config.rows.length;
  const idxAt = src !== null && src !== undefined ? (i: number) => src[i]! : (i: number) => i;
  const matches: number[] = [];
  let cursor = 0;

  const processChunk = (): void => {
    if (state.cancelled) return;

    const chunkStart = now();
    let processed = 0;

    while (cursor < total) {
      const rowIndex = idxAt(cursor);
      const rowText = buildNormalizedRowAggregateText(
        config.rows[rowIndex]!,
        searchableColumns,
        normalizer,
        rowIndex,
      );
      if (matcherFn(rowText, queryParts)) {
        matches.push(rowIndex);
      }
      cursor++;
      processed++;

      if (processed >= maxRowsPerChunk) break;
      if (now() - chunkStart >= timeBudgetMs) break;
    }

    if (cursor >= total) {
      state.pending = null;
      onComplete(Uint32Array.from(matches));
      return;
    }

    state.pending = scheduler.schedule(processChunk);
  };

  state.pending = scheduler.schedule(processChunk);
}

/**
 * Execute quick search on the main thread with cooperative chunking for
 * large inputs. Empty queries schedule no work and never call `onComplete`.
 */
export function executeQuickSearchMainThreadFallback(
  config: QuickSearchMainThreadFallbackConfig,
  onComplete: (indexes: Uint32Array) => void,
): QuickSearchExecutionHandle {
  const state: ExecutionState = { cancelled: false, pending: null };
  const handle: QuickSearchExecutionHandle = {
    cancel: () => {
      state.cancelled = true;
      state.pending?.cancel();
      state.pending = null;
    },
  };

  const qfOpts = typeof config.quickFilter === "object" ? config.quickFilter : undefined;
  const parser = config.parser ?? qfOpts?.parser;
  const normalizedText = config.normalizedText ?? resolveNormalizedText(config);
  const queryParts =
    config.queryParts ?? resolveQueryParts(normalizedText, parser);

  if (isEmptyQuery(normalizedText, queryParts)) {
    return handle;
  }

  const src = config.sourceIndexes;
  const total = src !== null && src !== undefined ? src.length : config.rows.length;
  const smallInputThreshold = config.smallInputThreshold ?? DEFAULT_SMALL_INPUT_THRESHOLD;

  if (total <= smallInputThreshold) {
    runSyncScan(config, queryParts, state, onComplete);
    return handle;
  }

  runChunkedScan(config, queryParts, state, onComplete);
  return handle;
}
