/**
 * CSV Export V1 - feature-owned projected value type (Stage 2B).
 *
 * A projected cell/header value stays typed until encoding. Native `number`,
 * `boolean`, and `bigint` values are preserved (not stringified) whenever no
 * formatter or `processCell` converts them, so later formula protection can
 * distinguish numeric `-42` from the string `"-42"`. `null`/`undefined` remain
 * empty-value primitives. Only unsupported `object`/`function`/`symbol` raw
 * values without a formatter are converted with `String(value)`.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 12.
 */

export type CsvProjectedValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined;

/** String form for the `formattedValue` callback argument and encoding. */
export function csvEmptyStringify(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Preserve a raw value as a typed projected value when no formatter/callback
 * converts it. Native scalar types pass through; unsupported reference/callable
 * values fall back to `String(value)`; `null`/`undefined` stay empty.
 */
export function toTypedProjectedValue(raw: unknown): CsvProjectedValue {
  if (raw === null || raw === undefined) return raw;
  switch (typeof raw) {
    case "number":
    case "boolean":
    case "bigint":
    case "string":
      return raw;
    default:
      return String(raw);
  }
}
