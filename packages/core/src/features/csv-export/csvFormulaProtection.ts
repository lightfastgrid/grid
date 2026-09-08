/**
 * CSV Export V1 - formula-injection protection (Stage 2C).
 *
 * Runs AFTER value formatting and `processCell`, on the typed projected value.
 * With `formulaProtection: "escape"`, risky STRING values are prefixed with a
 * single quote (`'`) before quoting. Native `number`/`bigint`/`boolean` (and
 * `null`/`undefined`) are never escaped, so numeric `-42` stays numeric while a
 * formatter/callback-produced string `"-42"` is escaped. `"none"` is an opt-out.
 * Headers and structured custom content use the same policy. Inputs are never
 * mutated.
 *
 * Leading-whitespace handling follows Unicode/ECMAScript `trimStart` whitespace
 * via an allocation-free code-unit scan (no per-cell trimmed-string allocation).
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 14.
 */

import type { CsvFormulaProtection } from "./csvExportTypes";
import type { CsvProjectedValue } from "./csvProjectedValue";

/** Formula-trigger first characters after any leading whitespace. */
const TRIGGER_CHARS = new Set(["=", "+", "-", "@"]);

const CHAR_TAB = 0x09;
const CHAR_CR = 0x0d;

/**
 * ECMAScript `trimStart` whitespace (WhiteSpace + LineTerminator), matched by
 * UTF-16 code unit. Every member is a single BMP code unit, so a `charCodeAt`
 * scan is exact and allocation-free.
 */
function isTrimStartWhitespace(code: number): boolean {
  return (
    code === 0x09 || // tab
    code === 0x0a || // line feed
    code === 0x0b || // vertical tab
    code === 0x0c || // form feed
    code === 0x0d || // carriage return
    code === 0x20 || // space
    code === 0xa0 || // no-break space
    code === 0xfeff || // zero-width no-break space
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 || // line separator
    code === 0x2029 || // paragraph separator
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/**
 * A string is risky when, after skipping any leading whitespace, its first
 * non-whitespace character is a formula trigger (`= + - @`), OR the string
 * begins with a TAB/CR and is not whitespace-only. Whitespace-only strings
 * (including empty) are safe.
 */
export function isFormulaRisky(value: string): boolean {
  let i = 0;
  while (i < value.length && isTrimStartWhitespace(value.charCodeAt(i))) i++;
  if (i >= value.length) return false; // whitespace-only (or empty)
  if (TRIGGER_CHARS.has(value.charAt(i))) return true;
  const lead = value.charCodeAt(0);
  return lead === CHAR_TAB || lead === CHAR_CR;
}

/** Apply formula protection to a projected value; non-strings pass through. */
export function applyCsvFormulaProtection(
  value: CsvProjectedValue,
  mode: CsvFormulaProtection,
): CsvProjectedValue {
  if (mode === "none") return value;
  if (typeof value !== "string") return value;
  return isFormulaRisky(value) ? `'${value}` : value;
}
