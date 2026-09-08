/**
 * CSV Export V1 - cooperative projected-byte estimate (shared).
 *
 * Used by the main-thread executor and the Worker projection-chunk builder.
 * This is a cooperative ceiling estimate only, not an encoded-output limit:
 * strings cost two bytes per UTF-16 code unit, numbers eight bytes, booleans
 * one byte, bigints sixteen bytes, and null/undefined zero bytes.
 */

import type { CsvProjectedValue } from "./csvProjectedValue";

const MAX_COUNTER = Number.MAX_SAFE_INTEGER;

/** Saturating projected-byte estimate for one typed projected value. */
export function estimateCsvProjectedBytes(value: CsvProjectedValue): number {
  if (value === null || value === undefined) return 0;
  switch (typeof value) {
    case "string":
      return Math.min(MAX_COUNTER, value.length * 2);
    case "number":
      return 8;
    case "boolean":
      return 1;
    case "bigint":
      return 16;
  }
}
