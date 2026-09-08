/**
 * CSV Export V1 - public type contract (Stage 0).
 *
 * These names are the binding public surface for CSV export. They are frozen
 * here before any execution, worker, Grid, or adapter wiring exists. The
 * Runtime methods (`exportDataAsCsv` / `getDataAsCsv`) are described by the
 * standalone {@link CsvExportCapability} contract. Core Grid integration owns
 * those methods; the React imperative handle remains a separate adapter step.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 7.
 */

import type { ColumnDef, RowData } from "../../types";

// -- Scopes -------------------------------------------------------------

export type CsvRowScope =
  | { mode: "filteredAndSorted" }
  | { mode: "currentPage" }
  | { mode: "all" }
  | { mode: "selected" }
  | { mode: "ids"; ids: readonly string[] };

export type CsvColumnScope =
  | { mode: "visible" }
  | { mode: "all" }
  | { mode: "selected" }
  | { mode: "fields"; fields: readonly string[] };

// -- Encoding / output enums --------------------------------------------

export type CsvQuoteMode = "minimal" | "always" | "never";
export type CsvFormulaProtection = "escape" | "none";
export type CsvLineEnding = "\r\n" | "\n";

export type CsvOutputTarget =
  | { type: "download" }
  | { type: "text" }
  | { type: "blob" }
  | { type: "stream"; writable: WritableStream<Uint8Array> };

// -- Structured custom content ------------------------------------------

export interface CsvContentCell {
  value: string | number | boolean | bigint | null | undefined;
  mergeAcross?: number;
}

export type CsvContentRow = readonly CsvContentCell[];

// -- JSON-safe defaults -------------------------------------------------

/**
 * JSON-safe CSV configuration. Every member is serializable; functions,
 * `AbortSignal`, `Blob`, and `WritableStream` are runtime-only and live on
 * {@link CsvExportParams} instead. This split keeps grid-level defaults free
 * of non-serializable inputs.
 */
export interface CsvExportDefaults {
  enabled?: boolean;
  fileName?: string;
  rows?: CsvRowScope;
  columns?: CsvColumnScope;
  includeColumnHeaders?: boolean;
  /**
   * Tri-state. When omitted, group-header rows follow the grid's
   * `columnGroupHeaders` display setting. Explicit `true` forces structural
   * group headers; explicit `false` always omits them.
   */
  includeColumnGroupHeaders?: boolean;
  includePinnedTopRows?: boolean;
  includePinnedBottomRows?: boolean;
  includeInternalColumns?: boolean;
  includeUtilityColumns?: boolean;
  includeRowNumbers?:
    | boolean
    | {
        headerName?: string;
        startAt?: number;
      };
  useValueFormatter?: boolean;
  delimiter?: string;
  quoteMode?: CsvQuoteMode;
  lineEnding?: CsvLineEnding;
  utf8Bom?: boolean;
  formulaProtection?: CsvFormulaProtection;
  maxOutputBytes?: number;
}

// -- Callback parameter shapes ------------------------------------------

export interface CsvProcessCellParams {
  row: RowData;
  rowId: string;
  rowIndex: number;
  sourceRowIndex: number;
  column: ColumnDef;
  field: string;
  rawValue: unknown;
  formattedValue: string;
}

export interface CsvProcessHeaderParams {
  column: ColumnDef;
  field: string;
  headerName: string;
}

export interface CsvProcessGroupHeaderParams {
  groupId: string;
  headerName: string;
  level: number;
  fields: readonly string[];
}

export interface CsvShouldExportRowParams {
  row: RowData;
  rowId: string;
  rowIndex: number;
  sourceRowIndex: number;
}

// -- Progress -----------------------------------------------------------

export interface CsvExportProgress {
  taskId: number;
  phase: "planning" | "projecting" | "encoding" | "finalizing";
  processedRows: number;
  totalRows: number;
  emittedBytes: number;
}

// -- Per-call params (defaults + runtime-only inputs) -------------------

export interface CsvExportParams extends CsvExportDefaults {
  output?: CsvOutputTarget;
  prependContent?: readonly CsvContentRow[];
  appendContent?: readonly CsvContentRow[];
  shouldExportRow?: (params: CsvShouldExportRowParams) => boolean;
  processCell?: (
    params: CsvProcessCellParams,
  ) => string | number | boolean | bigint | null | undefined;
  processHeader?: (params: CsvProcessHeaderParams) => string;
  processGroupHeader?: (params: CsvProcessGroupHeaderParams) => string;
  onProgress?: (progress: CsvExportProgress) => void;
  signal?: AbortSignal;
}

// -- Result / task handle -----------------------------------------------

export interface CsvExportResult {
  taskId: number;
  outputType: CsvOutputTarget["type"];
  rowCount: number;
  columnCount: number;
  byteLength: number;
  durationMs: number;
  fileName?: string;
  text?: string;
  blob?: Blob;
}

export interface CsvExportTask {
  readonly id: number;
  readonly promise: Promise<CsvExportResult>;
  cancel(): void;
}

// -- Standalone grid configuration/events contracts --------------------

/**
 * Framework-neutral CSV configuration merged into the Grid options contract.
 */
export interface CsvExportGridOptions {
  csvExport?: boolean | CsvExportDefaults;
}

/** Observer callbacks mapped to the typed `csv-export:*` core events. */
export interface CsvExportEventCallbacks {
  onCsvExportProgress?: (event: CsvExportProgress) => void;
  onCsvExportCompleted?: (event: CsvExportResult) => void;
  onCsvExportCancelled?: (event: { taskId: number }) => void;
  onCsvExportError?: (event: { taskId: number; error: unknown }) => void;
}

/**
 * @deprecated Use `CsvExportGridOptions` and `CsvExportEventCallbacks` to keep
 * configuration separate from observation.
 */
export interface CsvExportGridProps
  extends CsvExportGridOptions,
    CsvExportEventCallbacks {}

// -- Capability seam ----------------------------------------------------

/**
 * Frozen Grid/adapter method signatures for CSV export. Core Grid implements
 * these exact two signatures; adapters can expose them in their own stage.
 */
export interface CsvExportCapability {
  exportDataAsCsv(params?: CsvExportParams): CsvExportTask;
  getDataAsCsv(params?: Omit<CsvExportParams, "output">): Promise<string>;
}
