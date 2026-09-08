/**
 * CSV Export V1 - pure field escaping/quoting (Stage 2C).
 *
 * Operates on an already stringified (and formula-protected) field. Minimal
 * quoting wraps a field containing the delimiter, `"`, CR, or LF; embedded
 * double quotes are doubled. `always` quotes every field. `never` emits the
 * field text verbatim: it applies no quoting and is unsafe - it does not
 * preserve CSV field structure when the text contains the delimiter, quotes,
 * CR, or LF (per the source-of-truth contract).
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 13.1.
 */

import type { CsvQuoteMode } from "./csvExportTypes";

export interface CsvFieldEncodingOptions {
  delimiter: string;
  quoteMode: CsvQuoteMode;
}

export function encodeCsvField(
  field: string,
  options: CsvFieldEncodingOptions,
): string {
  if (options.quoteMode === "never") {
    // Verbatim field text: no quoting. Unsafe - does not preserve CSV field
    // structure when the text contains the delimiter, quotes, CR, or LF.
    return field;
  }
  const needsQuote =
    options.quoteMode === "always" ||
    field.includes(options.delimiter) ||
    field.includes('"') ||
    field.includes("\r") ||
    field.includes("\n");
  if (!needsQuote) return field;
  return `"${field.replace(/"/g, '""')}"`;
}
