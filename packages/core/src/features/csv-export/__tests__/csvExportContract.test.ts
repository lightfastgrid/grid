import { describe, expect, it } from "vitest";

import type {
  ColumnDef,
  CsvColumnScope,
  CsvContentCell,
  CsvContentRow,
  CsvExportCapability,
  CsvExportDefaults,
  CsvExportParams,
  CsvExportProgress,
  CsvExportResult,
  CsvExportTask,
  CsvOutputTarget,
  CsvRowScope,
  ExecutionThresholds,
  LightFastGridColDef,
  LightFastGridDefaultColDef,
  LightFastGridProps,
} from "../../../index";
// Public value exports proven through the package root barrel.
import { CsvExportDisabledError, CsvExportError } from "../../../index";
// CsvExportGridProps stays feature-owned while its fields are inherited by
// LightFastGridProps. Import it from the feature barrel, not the package root.
import type { CsvExportGridProps } from "../index";

// -- Type-level assertion helpers ---------------------------------------

type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

/** Compiles only when the type argument resolves to `true`. */
function assertTrue<_T extends true>(): void {
  /* type-level assertion - no runtime behavior */
}

type ExpectedExport = (params?: CsvExportParams) => CsvExportTask;
type ExpectedGet = (params?: Omit<CsvExportParams, "output">) => Promise<string>;

describe("CSV export contract - frozen capability signatures", () => {
  it("CsvExportCapability freezes the exact two future method signatures", () => {
    // exportDataAsCsv(params?: CsvExportParams): CsvExportTask
    assertTrue<
      IsExact<
        Parameters<CsvExportCapability["exportDataAsCsv"]>,
        Parameters<ExpectedExport>
      >
    >();
    assertTrue<
      IsExact<
        ReturnType<CsvExportCapability["exportDataAsCsv"]>,
        ReturnType<ExpectedExport>
      >
    >();
    // getDataAsCsv(params?: Omit<CsvExportParams,"output">): Promise<string>
    assertTrue<
      IsExact<
        Parameters<CsvExportCapability["getDataAsCsv"]>,
        Parameters<ExpectedGet>
      >
    >();
    assertTrue<
      IsExact<
        ReturnType<CsvExportCapability["getDataAsCsv"]>,
        ReturnType<ExpectedGet>
      >
    >();
    expect(true).toBe(true);
  });

  it("JSON-safe defaults exclude runtime-only inputs; params include them", () => {
    assertTrue<IsExact<HasKey<CsvExportDefaults, "output">, false>>();
    assertTrue<IsExact<HasKey<CsvExportDefaults, "signal">, false>>();
    assertTrue<IsExact<HasKey<CsvExportDefaults, "processCell">, false>>();
    assertTrue<IsExact<HasKey<CsvExportDefaults, "processHeader">, false>>();
    assertTrue<IsExact<HasKey<CsvExportDefaults, "shouldExportRow">, false>>();
    assertTrue<IsExact<HasKey<CsvExportDefaults, "onProgress">, false>>();
    assertTrue<IsExact<HasKey<CsvExportDefaults, "prependContent">, false>>();
    assertTrue<IsExact<HasKey<CsvExportDefaults, "appendContent">, false>>();

    assertTrue<IsExact<HasKey<CsvExportParams, "output">, true>>();
    assertTrue<IsExact<HasKey<CsvExportParams, "signal">, true>>();
    assertTrue<IsExact<HasKey<CsvExportParams, "processCell">, true>>();
    assertTrue<IsExact<HasKey<CsvExportParams, "onProgress">, true>>();

    assertTrue<CsvExportParams extends CsvExportDefaults ? true : false>();
    expect(true).toBe(true);
  });

  it("extended existing public types carry the CSV fields", () => {
    assertTrue<IsExact<HasKey<ColumnDef, "exportable">, true>>();
    assertTrue<IsExact<HasKey<ColumnDef, "exportValueField">, true>>();
    assertTrue<IsExact<HasKey<LightFastGridColDef, "exportable">, true>>();
    assertTrue<
      IsExact<HasKey<LightFastGridColDef, "exportValueField">, true>
    >();
    assertTrue<IsExact<HasKey<LightFastGridDefaultColDef, "exportable">, true>>();
    assertTrue<
      IsExact<HasKey<LightFastGridDefaultColDef, "exportValueField">, true>
    >();
    assertTrue<IsExact<HasKey<ExecutionThresholds, "csvExport">, true>>();
    expect(true).toBe(true);
  });
});

describe("CSV export contract - extended existing public types", () => {
  it("LightFastGridColDef accepts exportable and exportValueField", () => {
    const column: LightFastGridColDef = {
      field: "price",
      exportable: false,
      exportValueField: "priceExport",
    };
    expect(column.exportable).toBe(false);
    expect(column.exportValueField).toBe("priceExport");
  });

  it("ColumnDef accepts exportable and exportValueField", () => {
    const column: ColumnDef = {
      field: "price",
      exportable: false,
      exportValueField: "priceExport",
    };
    expect(column.exportable).toBe(false);
    expect(column.exportValueField).toBe("priceExport");
  });

  it("defaultColDef accepts exportable and exportValueField", () => {
    const def: LightFastGridDefaultColDef = {
      exportable: true,
      exportValueField: "export",
    };
    expect(def.exportable).toBe(true);
    expect(def.exportValueField).toBe("export");
  });

  it("ExecutionThresholds accepts csvExport (measured in cells)", () => {
    const thresholds: ExecutionThresholds = { csvExport: 100_000 };
    expect(thresholds.csvExport).toBe(100_000);
  });
});

describe("CSV export contract - JSON-safe defaults shape", () => {
  it("grid-level defaults accept only JSON-safe configuration", () => {
    const gridProps: CsvExportGridProps = {
      csvExport: {
        fileName: "orders.csv",
        rows: { mode: "filteredAndSorted" },
        columns: { mode: "visible" },
        utf8Bom: true,
        formulaProtection: "escape",
      },
    };
    expect(gridProps.csvExport).toBeTruthy();
    const rootProps: LightFastGridProps = gridProps;
    expect(rootProps.csvExport).toBe(gridProps.csvExport);
  });

  it("scopes, output targets, and content cells are structurally valid", () => {
    const rows: CsvRowScope = { mode: "ids", ids: ["a", "b"] };
    const columns: CsvColumnScope = { mode: "fields", fields: ["x"] };
    const output: CsvOutputTarget = { type: "text" };
    const cell: CsvContentCell = { value: 42, mergeAcross: 2 };
    const contentRow: CsvContentRow = [cell];
    expect(rows.mode).toBe("ids");
    expect(columns.mode).toBe("fields");
    expect(output.type).toBe("text");
    expect(contentRow).toHaveLength(1);
  });
});

describe("CSV export contract - public package error exports", () => {
  it("re-exports the typed CSV error classes from the package root", () => {
    const error = new CsvExportDisabledError();
    expect(error).toBeInstanceOf(CsvExportError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("csv-export/disabled");
  });

  it("progress and result shapes are usable at the type boundary", () => {
    const progress: CsvExportProgress = {
      taskId: 1,
      phase: "encoding",
      processedRows: 10,
      totalRows: 20,
      emittedBytes: 512,
    };
    const result: CsvExportResult = {
      taskId: 1,
      outputType: "blob",
      rowCount: 20,
      columnCount: 3,
      byteLength: 1024,
      durationMs: 5,
    };
    expect(progress.phase).toBe("encoding");
    expect(result.outputType).toBe("blob");
  });
});
