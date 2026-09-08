import type {
  CsvColumnScope,
  CsvExportParams,
  CsvLineEnding,
} from "@lightfastgrid/core";

/** Demo ID column — not the CSV synthetic `includeRowNumbers` feature. */
export const DEMO_ROW_NUMBER_FIELD = "__rowNumber";

/** Mutually exclusive scope presets from the Advanced export design. */
export type AdvancedExportScope =
  | "allRows"
  | "allColumns"
  | "visibleColumns";

export type AdvancedExportDelimiter = "," | ";" | "|" | "\t";

export type AdvancedExportOutput = "download" | "copy";

export type AdvancedExportOptions = {
  scope: AdvancedExportScope;
  includeColumnHeaders: boolean;
  /** When false, omit the demo ID (`__rowNumber`) column from the CSV. */
  includeRowNumbers: boolean;
  includeUtilityColumns: boolean;
  useValueFormatter: boolean;
  delimiter: AdvancedExportDelimiter;
  utf8Bom: boolean;
  lineEnding: CsvLineEnding;
  output: AdvancedExportOutput;
  fileName: string;
};

export type AdvancedExportColumnInput = {
  field: string;
  visible?: boolean;
};

export const DEFAULT_ADVANCED_EXPORT_OPTIONS: AdvancedExportOptions = {
  scope: "visibleColumns",
  includeColumnHeaders: true,
  includeRowNumbers: true,
  includeUtilityColumns: true,
  useValueFormatter: true,
  delimiter: ",",
  utf8Bom: true,
  lineEnding: "\r\n",
  output: "download",
  fileName: "lightfastgrid-export.csv",
};

export const ADVANCED_EXPORT_SCOPE_OPTIONS = [
  {
    value: "allRows" as const,
    label: "All source rows",
    description: "Ignore filter, sort, and page.",
  },
  {
    value: "allColumns" as const,
    label: "All columns including hidden",
    description: "Export every leaf column.",
  },
  {
    value: "visibleColumns" as const,
    label: "Visible columns only",
    description: "Pinned + center columns currently shown.",
    recommended: true,
  },
] as const;

export const ADVANCED_EXPORT_DELIMITER_OPTIONS = [
  { value: "," as const, label: "comma (,)" },
  { value: ";" as const, label: "semicolon (;)" },
  { value: "|" as const, label: "pipe (|)" },
  { value: "\t" as const, label: "tab" },
] as const;

export const ADVANCED_EXPORT_LINE_ENDING_OPTIONS = [
  { value: "\r\n" as const, label: "CRLF (\\r\\n)" },
  { value: "\n" as const, label: "LF (\\n)" },
] as const;

/**
 * Resolve explicit export fields for the chosen scope.
 * `includeRowNumbers` gates the demo ID column (not CSV synthetic row numbers).
 */
export function resolveAdvancedExportColumnFields(
  columns: readonly AdvancedExportColumnInput[],
  options: Pick<AdvancedExportOptions, "scope" | "includeRowNumbers">,
): string[] {
  const scoped =
    options.scope === "allColumns"
      ? columns
      : columns.filter((column) => column.visible !== false);
  return scoped
    .map((column) => column.field)
    .filter(
      (field) =>
        options.includeRowNumbers || field !== DEMO_ROW_NUMBER_FIELD,
    );
}

function resolveAdvancedExportColumns(
  columns: readonly AdvancedExportColumnInput[],
  options: AdvancedExportOptions,
): CsvColumnScope {
  return {
    mode: "fields",
    fields: resolveAdvancedExportColumnFields(columns, options),
  };
}

/** Map Advanced UI state → `CsvExportParams` (download path). */
export function buildAdvancedExportParams(
  options: AdvancedExportOptions,
  columns: readonly AdvancedExportColumnInput[],
): CsvExportParams {
  const rows =
    options.scope === "allRows"
      ? ({ mode: "all" } as const)
      : ({ mode: "filteredAndSorted" } as const);

  return {
    fileName: normalizeExportFileName(options.fileName),
    rows,
    columns: resolveAdvancedExportColumns(columns, options),
    includeColumnHeaders: options.includeColumnHeaders,
    // Demo ID column is handled via field exclusion above — never add a
    // second synthetic "Row" column from the CSV API.
    includeRowNumbers: false,
    includeUtilityColumns: options.includeUtilityColumns,
    useValueFormatter: options.useValueFormatter,
    delimiter: options.delimiter,
    utf8Bom: options.utf8Bom,
    lineEnding: options.lineEnding,
  };
}

export function normalizeExportFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return DEFAULT_ADVANCED_EXPORT_OPTIONS.fileName;
  return trimmed.toLowerCase().endsWith(".csv") ? trimmed : `${trimmed}.csv`;
}
