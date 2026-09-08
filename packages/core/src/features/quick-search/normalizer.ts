/**
 * Quick-search text normalizer.
 *
 * Shared between main-thread fallback and worker execution so both
 * paths produce identical matching semantics. Uses locale-insensitive
 * `String.prototype.toUpperCase()` — never `toLocaleUpperCase()`.
 */

const NORMALIZER_VERSION = "qs-norm-v1";

export interface NormalizerOptions {
  readonly version?: string;
}

export interface QuickSearchNormalizer {
  normalizeValue(value: unknown): string;
  normalizeQuery(text: string): string;
  readonly signature: string;
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return String(value);
}

export function createNormalizer(options?: NormalizerOptions): QuickSearchNormalizer {
  const version = options?.version ?? NORMALIZER_VERSION;

  return {
    normalizeValue(value: unknown): string {
      return valueToString(value).toUpperCase();
    },

    normalizeQuery(text: string): string {
      return text.toUpperCase();
    },

    get signature(): string {
      return version;
    },
  };
}

export const defaultNormalizer: QuickSearchNormalizer = createNormalizer();

export function getNormalizerSignature(normalizer: QuickSearchNormalizer): string {
  return normalizer.signature;
}
