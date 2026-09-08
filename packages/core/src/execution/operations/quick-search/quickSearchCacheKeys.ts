/**
 * Deterministic cache key builders for the quick-search caches.
 *
 * Source-scoped result keys include `sourceSignature` — a cached row
 * order is only valid for the exact upstream filtered source it was
 * computed against. Full-match keys deliberately OMIT `sourceSignature`
 * because quick-search matching is row-local:
 *
 *   quickSearch(query, filteredRows)
 *     = quickSearch(query, allRows) ∩ filteredRows
 *
 * Both key families include `searchableDataRevision` so same-generation
 * queries cannot reuse results across data revisions. Layout changes
 * create a new generation, so `sourceLayoutRevision` is not needed here.
 */

export interface SourceResultKeyInput {
  generation: number;
  searchableFieldsKey: string;
  normalizerSignature: string;
  sourceSignature: string;
  configSignature: string;
  normalizedText: string;
  searchableDataRevision: number;
}

export interface FullMatchKeyInput {
  generation: number;
  searchableFieldsKey: string;
  normalizerSignature: string;
  configSignature: string;
  normalizedText: string;
  searchableDataRevision: number;
}

// JSON tuple encoding — component boundaries are quoted/escaped, so no
// character in signatures or user query text can alias two different
// inputs to the same key (query text is user-controlled and may contain
// any character, including would-be separators).
export function buildSourceResultKey(input: SourceResultKeyInput): string {
  return JSON.stringify([
    input.generation,
    input.searchableFieldsKey,
    input.normalizerSignature,
    input.sourceSignature,
    input.configSignature,
    input.normalizedText,
    input.searchableDataRevision,
  ]);
}

export function buildFullMatchKey(input: FullMatchKeyInput): string {
  return JSON.stringify([
    input.generation,
    input.searchableFieldsKey,
    input.normalizerSignature,
    input.configSignature,
    input.normalizedText,
    input.searchableDataRevision,
  ]);
}

/**
 * Full-match entries may only be stored when the query executed against
 * the FULL dataset. A source-subset scan misses rows outside that
 * source, so caching it as a full match would return wrong results
 * after a filter change.
 */
export function canStoreFullMatchEntry(
  executedSourceIndexes: Uint32Array | null,
): boolean {
  return executedSourceIndexes === null;
}
