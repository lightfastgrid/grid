/**
 * Pure lazy-narrowing eligibility for forward typing.
 *
 * When the next query is a monotonic forward refinement of the previous
 * one (`"ALI"` → `"ALIC"`), the previous result set is a valid CANDIDATE
 * source: with AND-substring semantics, refined matches are always a
 * subset of the previous matches. The planner must still verify every
 * candidate against the full matcher — the previous result is never
 * final truth.
 *
 * Backspace, replacement, reordering, snapshot/source/config change, or
 * a searchable-data revision change disqualifies narrowing.
 */

export interface LazyNarrowingPrevious {
  generation: number;
  searchableFieldsKey: string;
  normalizerSignature: string;
  sourceSignature: string;
  configSignature: string;
  normalizedText: string;
  searchableDataRevision: number;
  /** Final row indexes of the previous completed query. */
  indexes: Uint32Array;
}

export interface LazyNarrowingNext {
  generation: number;
  searchableFieldsKey: string;
  normalizerSignature: string;
  sourceSignature: string;
  configSignature: string;
  normalizedText: string;
  searchableDataRevision: number;
}

export function canNarrowFromPrevious(
  previous: LazyNarrowingPrevious | null,
  next: LazyNarrowingNext,
): boolean {
  if (previous === null) return false;
  if (previous.generation !== next.generation) return false;
  if (previous.searchableFieldsKey !== next.searchableFieldsKey) return false;
  if (previous.normalizerSignature !== next.normalizerSignature) return false;
  if (previous.sourceSignature !== next.sourceSignature) return false;
  if (previous.configSignature !== next.configSignature) return false;
  if (previous.searchableDataRevision !== next.searchableDataRevision) {
    return false;
  }

  const prevText = previous.normalizedText;
  const nextText = next.normalizedText;
  if (prevText.length === 0) return false;
  // Monotonic forward refinement: strictly appending to the previous
  // query. Shortening (backspace), replacement, and reordering all fail
  // this check and must replan from cache/index/scan.
  if (nextText.length <= prevText.length) return false;
  return nextText.startsWith(prevText);
}
