/**
 * CSV Export V1 - feature-owned public barrel (Stage 0).
 *
 * Re-exports the frozen public contract: types, typed errors, and the pure
 * default normalizer. Worker implementation details and adapter wiring remain
 * outside this barrel; core Grid ownership uses the internal headless seam.
 */

export type { CsvExportErrorCode, CsvExportErrorOptions } from "./csvExportErrors";
export {
  CsvExportCancelledError,
  CsvExportDisabledError,
  CsvExportDuplicateColumnError,
  CsvExportDuplicateRowError,
  CsvExportError,
  CsvExportInvalidOptionsError,
  CsvExportSinkError,
  CsvExportSizeLimitError,
  CsvExportUnknownColumnError,
  CsvExportUnknownRowError,
  CsvExportWorkerError,
} from "./csvExportErrors";
export type {
  CsvColumnScope,
  CsvContentCell,
  CsvContentRow,
  CsvExportCapability,
  CsvExportDefaults,
  CsvExportEventCallbacks,
  CsvExportGridOptions,
  CsvExportGridProps,
  CsvExportParams,
  CsvExportProgress,
  CsvExportResult,
  CsvExportTask,
  CsvFormulaProtection,
  CsvLineEnding,
  CsvOutputTarget,
  CsvProcessCellParams,
  CsvProcessGroupHeaderParams,
  CsvProcessHeaderParams,
  CsvQuoteMode,
  CsvRowScope,
  CsvShouldExportRowParams,
} from "./csvExportTypes";
export type {
  NormalizedCsvExportDefaults,
  NormalizedCsvRowNumbers,
} from "./normalizeCsvExportOptions";
export {
  CSV_EXPORT_DEFAULT_DELIMITER,
  CSV_EXPORT_DEFAULT_FILE_NAME,
  CSV_EXPORT_DEFAULT_FORMULA_PROTECTION,
  CSV_EXPORT_DEFAULT_LINE_ENDING,
  CSV_EXPORT_DEFAULT_MAX_BLOB_BYTES,
  CSV_EXPORT_DEFAULT_MAX_STREAM_BYTES,
  CSV_EXPORT_DEFAULT_MAX_TEXT_BYTES,
  CSV_EXPORT_DEFAULT_QUOTE_MODE,
  normalizeCsvExportOptions,
  resolveMaxOutputBytes,
} from "./normalizeCsvExportOptions";
