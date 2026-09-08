import { defaultNormalizer } from "../../../features/quick-search/normalizer";
import type { RowIndexExecutionResult } from "../types";

import {
  executeQuickSearchMainThreadFallback,
  type QuickSearchMainThreadFallbackConfig,
} from "./quickSearchMainThreadFallback";
import { parseQueryParts } from "./quickSearchMatcher";
import type { QuickSearchOperationInput } from "./types";

interface ParsedQuickSearchQuery {
  normalizedText: string;
  queryParts: string[];
  isEmpty: boolean;
}

function parseQuickSearchQuery(input: QuickSearchOperationInput): ParsedQuickSearchQuery {
  const normalizer = defaultNormalizer;
  const normalizedText = normalizer.normalizeQuery(input.quickFilterText);
  const qfOpts = typeof input.quickFilter === "object" ? input.quickFilter : undefined;
  const parser = qfOpts?.parser;
  const queryParts = parser ? parser(normalizedText) : parseQueryParts(normalizedText);
  const isEmpty = normalizedText.trim().length === 0 || queryParts.length === 0;
  return { normalizedText, queryParts, isEmpty };
}

function upstreamIdentityResult(input: QuickSearchOperationInput): RowIndexExecutionResult {
  if (input.sourceIndexes) {
    return { kind: "indexes", indexes: new Uint32Array(input.sourceIndexes) };
  }
  return { kind: "identity", rowCount: input.rows.length };
}

function buildFallbackConfig(
  input: QuickSearchOperationInput,
  parsed: ParsedQuickSearchQuery,
  options?: { smallInputThreshold?: number },
): QuickSearchMainThreadFallbackConfig {
  const qfOpts = typeof input.quickFilter === "object" ? input.quickFilter : undefined;
  return {
    rows: input.rows,
    columns: input.columns,
    normalizedText: parsed.normalizedText,
    queryParts: parsed.queryParts,
    quickFilter: input.quickFilter,
    parser: qfOpts?.parser,
    matcher: qfOpts?.matcher,
    sourceIndexes: input.sourceIndexes ?? null,
    includeHiddenColumns: qfOpts?.includeHiddenColumns,
    smallInputThreshold: options?.smallInputThreshold,
  };
}

/** Synchronous quick-search execution for immediate main-thread path. */
export function executeQuickSearchSync(
  input: QuickSearchOperationInput,
): RowIndexExecutionResult {
  const parsed = parseQuickSearchQuery(input);
  if (parsed.isEmpty) {
    return upstreamIdentityResult(input);
  }

  const results: Uint32Array[] = [];
  executeQuickSearchMainThreadFallback(
    buildFallbackConfig(input, parsed, { smallInputThreshold: Number.POSITIVE_INFINITY }),
    (indexes) => {
      results.push(indexes);
    },
  );

  const result = results[0];
  if (result === undefined) {
    return upstreamIdentityResult(input);
  }
  return { kind: "indexes", indexes: result };
}

/** Cooperative chunked quick-search execution for deferred main-thread path. */
export function executeQuickSearchAsync(
  input: QuickSearchOperationInput,
  onComplete: (result: RowIndexExecutionResult) => void,
): { cancel(): void } {
  const parsed = parseQuickSearchQuery(input);
  if (parsed.isEmpty) {
    onComplete(upstreamIdentityResult(input));
    return { cancel() {} };
  }

  return executeQuickSearchMainThreadFallback(
    buildFallbackConfig(input, parsed),
    (indexes) => onComplete({ kind: "indexes", indexes }),
  );
}
