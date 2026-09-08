/**
 * CSV Export V1 - typed error contract (Stage 0).
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 24.
 *
 * Parameter-shape validation may throw synchronously (it is bounded by
 * options, not rows). Data-dependent failures reject the task promise. Wrapped
 * callback / worker / sink failures preserve their original `cause`.
 *
 * No execution behavior lives here - only the error types and their stable
 * codes.
 */

/**
 * Options bag for CSV export errors. Mirrors the standard `ErrorOptions.cause`
 * contract, declared locally because the project targets the ES2020 lib (which
 * predates `Error.cause`).
 */
export interface CsvExportErrorOptions {
  cause?: unknown;
}

/** Stable, machine-readable discriminant for every CSV export error. */
export type CsvExportErrorCode =
  | "csv-export/disabled"
  | "csv-export/invalid-options"
  | "csv-export/unknown-row"
  | "csv-export/unknown-column"
  | "csv-export/duplicate-row"
  | "csv-export/duplicate-column"
  | "csv-export/size-limit"
  | "csv-export/cancelled"
  | "csv-export/worker"
  | "csv-export/sink";

/**
 * Base class for every CSV export error. Carries a stable `code` and preserves
 * an optional `cause` (declared locally for the ES2020 lib target).
 */
export class CsvExportError extends Error {
  readonly code: CsvExportErrorCode;
  readonly cause?: unknown;

  constructor(
    code: CsvExportErrorCode,
    message: string,
    options?: CsvExportErrorOptions,
  ) {
    super(message);
    this.name = "CsvExportError";
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/** Export was requested while `csvExport` is disabled. No Worker is created. */
export class CsvExportDisabledError extends CsvExportError {
  constructor(message = "CSV export is disabled.", options?: CsvExportErrorOptions) {
    super("csv-export/disabled", message, options);
    this.name = "CsvExportDisabledError";
  }
}

/** A bounded option (delimiter, byte limit, ...) failed parameter validation. */
export class CsvExportInvalidOptionsError extends CsvExportError {
  constructor(message: string, options?: CsvExportErrorOptions) {
    super("csv-export/invalid-options", message, options);
    this.name = "CsvExportInvalidOptionsError";
  }
}

/** An explicit row id in an `ids` scope did not resolve to a known row. */
export class CsvExportUnknownRowError extends CsvExportError {
  readonly rowId: string;

  constructor(rowId: string, options?: CsvExportErrorOptions) {
    super("csv-export/unknown-row", `Unknown export row id: ${rowId}`, options);
    this.name = "CsvExportUnknownRowError";
    this.rowId = rowId;
  }
}

/** An explicit field in a `fields` scope did not resolve to a known column. */
export class CsvExportUnknownColumnError extends CsvExportError {
  readonly field: string;

  constructor(field: string, options?: CsvExportErrorOptions) {
    super(
      "csv-export/unknown-column",
      `Unknown export column field: ${field}`,
      options,
    );
    this.name = "CsvExportUnknownColumnError";
    this.field = field;
  }
}

/** A row id appeared more than once in an explicit `ids` scope. */
export class CsvExportDuplicateRowError extends CsvExportError {
  readonly rowId: string;

  constructor(rowId: string, options?: CsvExportErrorOptions) {
    super(
      "csv-export/duplicate-row",
      `Duplicate export row id: ${rowId}`,
      options,
    );
    this.name = "CsvExportDuplicateRowError";
    this.rowId = rowId;
  }
}

/** A field appeared more than once in an explicit `fields` scope. */
export class CsvExportDuplicateColumnError extends CsvExportError {
  readonly field: string;

  constructor(field: string, options?: CsvExportErrorOptions) {
    super(
      "csv-export/duplicate-column",
      `Duplicate export column field: ${field}`,
      options,
    );
    this.name = "CsvExportDuplicateColumnError";
    this.field = field;
  }
}

/** Emitted output exceeded the configured maximum byte limit. */
export class CsvExportSizeLimitError extends CsvExportError {
  readonly emittedBytes: number;
  readonly maxOutputBytes: number;

  constructor(emittedBytes: number, maxOutputBytes: number, options?: CsvExportErrorOptions) {
    super(
      "csv-export/size-limit",
      `CSV export exceeded the maximum output size of ${maxOutputBytes} bytes.`,
      options,
    );
    this.name = "CsvExportSizeLimitError";
    this.emittedBytes = emittedBytes;
    this.maxOutputBytes = maxOutputBytes;
  }
}

/** The task was cancelled (via `task.cancel()`, `AbortSignal`, or replacement). */
export class CsvExportCancelledError extends CsvExportError {
  constructor(message = "CSV export was cancelled.", options?: CsvExportErrorOptions) {
    super("csv-export/cancelled", message, options);
    this.name = "CsvExportCancelledError";
  }
}

/** The encoding Worker failed. Preserves the underlying `cause`. */
export class CsvExportWorkerError extends CsvExportError {
  constructor(message = "CSV export worker failed.", options?: CsvExportErrorOptions) {
    super("csv-export/worker", message, options);
    this.name = "CsvExportWorkerError";
  }
}

/** An output sink (stream / blob / download) failed. Preserves `cause`. */
export class CsvExportSinkError extends CsvExportError {
  constructor(message = "CSV export output sink failed.", options?: CsvExportErrorOptions) {
    super("csv-export/sink", message, options);
    this.name = "CsvExportSinkError";
  }
}
