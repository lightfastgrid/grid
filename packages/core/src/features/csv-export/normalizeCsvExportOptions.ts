/**
 * CSV Export V1 - pure default normalization (Stage 0).
 *
 * Freezes the Section 8 defaults and validates bounded scalar options. This
 * module performs no row/column scanning and no execution work. Output-target
 * byte ceilings are resolved separately by {@link resolveMaxOutputBytes}
 * because the output target is not known while normalizing grid-level defaults.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Sections 7 and 8.
 */

import { CsvExportInvalidOptionsError } from "./csvExportErrors";
import type {
  CsvColumnScope,
  CsvExportDefaults,
  CsvFormulaProtection,
  CsvLineEnding,
  CsvQuoteMode,
  CsvRowScope,
} from "./csvExportTypes";

// -- Frozen scalar defaults (Section 8) ---------------------------------

export const CSV_EXPORT_DEFAULT_FILE_NAME = "export.csv";
export const CSV_EXPORT_DEFAULT_DELIMITER = ",";
export const CSV_EXPORT_DEFAULT_QUOTE_MODE: CsvQuoteMode = "minimal";
export const CSV_EXPORT_DEFAULT_LINE_ENDING: CsvLineEnding = "\r\n";
export const CSV_EXPORT_DEFAULT_FORMULA_PROTECTION: CsvFormulaProtection = "escape";

// -- Frozen output-target byte ceilings (Section 8) ---------------------

const MIB = 1024 * 1024;
/** Text output retains the whole string; capped lower by default. */
export const CSV_EXPORT_DEFAULT_MAX_TEXT_BYTES = 64 * MIB;
/** Blob and browser-download outputs retain full bytes; capped higher. */
export const CSV_EXPORT_DEFAULT_MAX_BLOB_BYTES = 512 * MIB;
/** Writable-stream output is unbounded by default (O(chunkSize) memory). */
export const CSV_EXPORT_DEFAULT_MAX_STREAM_BYTES = Number.POSITIVE_INFINITY;

/** Default synthetic row-number column header. */
export const CSV_EXPORT_DEFAULT_ROW_NUMBER_HEADER = "Row";
/** Default synthetic row-number starting index. */
export const CSV_EXPORT_DEFAULT_ROW_NUMBER_START = 1;

/**
 * Normalized row-number configuration. `false` disables the synthetic column;
 * when enabled, both the header name and start index are fully resolved (never
 * optional).
 */
export type NormalizedCsvRowNumbers =
  | { enabled: false }
  | { enabled: true; headerName: string; startAt: number };

/**
 * Fully-resolved JSON-safe CSV defaults. `includeColumnGroupHeaders` preserves
 * its tri-state (`undefined` = follow the grid's group-header display setting).
 * `maxOutputBytes` stays `undefined` unless the caller configured an explicit
 * ceiling; the per-target default is applied by {@link resolveMaxOutputBytes}.
 */
export interface NormalizedCsvExportDefaults {
  enabled: boolean;
  fileName: string;
  rows: CsvRowScope;
  columns: CsvColumnScope;
  includeColumnHeaders: boolean;
  includeColumnGroupHeaders: boolean | undefined;
  includePinnedTopRows: boolean;
  includePinnedBottomRows: boolean;
  includeInternalColumns: boolean;
  includeUtilityColumns: boolean;
  includeRowNumbers: NormalizedCsvRowNumbers;
  useValueFormatter: boolean;
  delimiter: string;
  quoteMode: CsvQuoteMode;
  lineEnding: CsvLineEnding;
  utf8Bom: boolean;
  formulaProtection: CsvFormulaProtection;
  maxOutputBytes: number | undefined;
}

function cloneRowScope(scope: CsvRowScope): CsvRowScope {
  if (scope.mode === "ids") {
    return { mode: "ids", ids: [...scope.ids] };
  }
  return { mode: scope.mode };
}

function cloneColumnScope(scope: CsvColumnScope): CsvColumnScope {
  if (scope.mode === "fields") {
    return { mode: "fields", fields: [...scope.fields] };
  }
  return { mode: scope.mode };
}

/**
 * Validate a row-number start index: a non-negative safe integer. Rejects
 * negatives, fractionals, NaN, +/-Infinity, and values beyond
 * `Number.MAX_SAFE_INTEGER`. Throws {@link CsvExportInvalidOptionsError}.
 */
function validateRowNumberStartAt(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CsvExportInvalidOptionsError(
      `includeRowNumbers.startAt must be a non-negative safe integer (received ${value}).`,
    );
  }
}

function normalizeRowNumbers(
  value: CsvExportDefaults["includeRowNumbers"],
): NormalizedCsvRowNumbers {
  if (value === undefined || value === false) return { enabled: false };
  if (value === true) {
    return {
      enabled: true,
      headerName: CSV_EXPORT_DEFAULT_ROW_NUMBER_HEADER,
      startAt: CSV_EXPORT_DEFAULT_ROW_NUMBER_START,
    };
  }
  // Explicit "" header is preserved; only omission falls back to "Row".
  const headerName = value.headerName ?? CSV_EXPORT_DEFAULT_ROW_NUMBER_HEADER;
  const startAt = value.startAt ?? CSV_EXPORT_DEFAULT_ROW_NUMBER_START;
  validateRowNumberStartAt(startAt);
  return { enabled: true, headerName, startAt };
}

/**
 * Validate a delimiter: exactly one Unicode code point, not a double quote,
 * CR, or LF. Comma, semicolon, pipe, tab, and single non-ASCII code points are
 * valid. Throws {@link CsvExportInvalidOptionsError} on failure.
 */
function validateDelimiter(delimiter: string): void {
  const codePoints = [...delimiter];
  if (codePoints.length !== 1) {
    throw new CsvExportInvalidOptionsError(
      `delimiter must be exactly one Unicode code point (received ${codePoints.length}).`,
    );
  }
  if (delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
    throw new CsvExportInvalidOptionsError(
      'delimiter must not be a double quote, carriage return, or line feed.',
    );
  }
}

/**
 * Validate an explicitly configured byte ceiling. A configured value must be
 * finite and greater than zero. NaN, positive infinity, negative infinity,
 * zero, and negative finite values are all rejected - so the stored default
 * stays JSON-safe. Users never need to pass infinity: an omitted stream limit
 * resolves to internal unlimited via {@link resolveMaxOutputBytes}.
 */
function validateMaxOutputBytes(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new CsvExportInvalidOptionsError(
      `maxOutputBytes must be a finite number of bytes greater than zero (received ${value}).`,
    );
  }
}

/**
 * Normalize `boolean | CsvExportDefaults | undefined` into fully-resolved
 * JSON-safe defaults. Input objects and nested scope objects are never
 * mutated. `false` and `{ enabled: false }` normalize to a disabled config.
 *
 * Bounded parameter validation (delimiter, byte ceiling) may throw
 * {@link CsvExportInvalidOptionsError} synchronously.
 */
export function normalizeCsvExportOptions(
  input: boolean | CsvExportDefaults | undefined,
): NormalizedCsvExportDefaults {
  const source: CsvExportDefaults =
    input === undefined || input === true
      ? {}
      : input === false
        ? { enabled: false }
        : input;

  const enabled = source.enabled !== false;

  const delimiter = source.delimiter ?? CSV_EXPORT_DEFAULT_DELIMITER;
  validateDelimiter(delimiter);

  if (source.maxOutputBytes !== undefined) {
    validateMaxOutputBytes(source.maxOutputBytes);
  }

  return {
    enabled,
    fileName: source.fileName ?? CSV_EXPORT_DEFAULT_FILE_NAME,
    rows: source.rows ? cloneRowScope(source.rows) : { mode: "filteredAndSorted" },
    columns: source.columns ? cloneColumnScope(source.columns) : { mode: "visible" },
    includeColumnHeaders: source.includeColumnHeaders ?? true,
    // Tri-state preserved: omission follows the grid's group-header display.
    includeColumnGroupHeaders: source.includeColumnGroupHeaders,
    includePinnedTopRows: source.includePinnedTopRows ?? true,
    includePinnedBottomRows: source.includePinnedBottomRows ?? true,
    includeInternalColumns: source.includeInternalColumns ?? false,
    includeUtilityColumns: source.includeUtilityColumns ?? false,
    includeRowNumbers: normalizeRowNumbers(source.includeRowNumbers),
    useValueFormatter: source.useValueFormatter ?? true,
    delimiter,
    quoteMode: source.quoteMode ?? CSV_EXPORT_DEFAULT_QUOTE_MODE,
    lineEnding: source.lineEnding ?? CSV_EXPORT_DEFAULT_LINE_ENDING,
    utf8Bom: source.utf8Bom ?? false,
    formulaProtection:
      source.formulaProtection ?? CSV_EXPORT_DEFAULT_FORMULA_PROTECTION,
    maxOutputBytes: source.maxOutputBytes,
  };
}

/**
 * Resolve the effective output-byte ceiling for a given output target. A
 * caller-configured (positive finite) limit applies to every target, including
 * stream; otherwise the per-target default is used. An omitted stream limit
 * resolves to internal unlimited (`Number.POSITIVE_INFINITY`) - users never
 * pass infinity explicitly.
 */
export function resolveMaxOutputBytes(
  configured: number | undefined,
  outputType: "download" | "text" | "blob" | "stream",
): number {
  if (configured !== undefined) return configured;
  switch (outputType) {
    case "text":
      return CSV_EXPORT_DEFAULT_MAX_TEXT_BYTES;
    case "blob":
    case "download":
      return CSV_EXPORT_DEFAULT_MAX_BLOB_BYTES;
    case "stream":
      return CSV_EXPORT_DEFAULT_MAX_STREAM_BYTES;
  }
}
