/**
 * Default quick-search parser/matcher semantics.
 *
 * Shared by every execution path — chunked scan, trigram candidate
 * verification, lazy-narrowing verification, and the future main-thread
 * fallback — so all paths produce identical results. Inputs are already
 * normalized (uppercased) by the shared normalizer.
 */

/** Split normalized query text on whitespace, dropping empty parts. */
export function parseQueryParts(normalizedText: string): string[] {
  return normalizedText.split(/\s+/).filter((part) => part.length > 0);
}

/** AND semantics: every part must appear as a substring of the row text. */
export function rowTextMatchesParts(rowText: string, parts: string[]): boolean {
  for (const part of parts) {
    if (!rowText.includes(part)) return false;
  }
  return true;
}
