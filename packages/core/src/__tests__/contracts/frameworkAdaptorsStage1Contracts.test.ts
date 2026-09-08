import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type {
  CsvExportEventCallbacks,
  CsvExportGridOptions,
  CsvExportGridProps,
  Grid,
  GridAdapterApi,
  GridApi,
  GridCreateOptions,
  GridEventCallbacks,
  GridEventSource,
  GridHooks,
  GridLifecycle,
  GridOptions,
  LightFastGridHandle,
  LightFastGridProps,
} from "../../../src";

type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type ExpectedGridEventCallbackKey =
  | "onGridReady"
  | "onColumnResized"
  | "onSelectionChanged"
  | "onColumnSelectionChanged"
  | "onColumnOrderChanged"
  | "onRowOrderChanged"
  | "onSortChanged"
  | "onFilterChanged"
  | "onColumnPinChanged"
  | "onRowPinChanged"
  | "onColumnVisibilityChanged"
  | "onPaginationChanged"
  | "onFocusedCellChanged"
  | "onCellShellAction"
  | "onCellValueChanged"
  | "onRowDataUpdated"
  | "onQuickFilterChanged"
  | "onQuickSearchPendingChanged"
  | "onAsyncTransactionsFlushed"
  | "onCsvExportProgress"
  | "onCsvExportCompleted"
  | "onCsvExportCancelled"
  | "onCsvExportError";

type ExpectedDynamicSetterKey =
  | "setColumnMenu"
  | "setCellMenu"
  | "setCellRenderers"
  | "setHeaderRenderers"
  | "setCellShellOverlays"
  | "setCsvExportConfig"
  | "setBeforeCellEditCommitHook";

function assertTrue<T extends true>(_value: T): void {}

describe("framework adaptors Stage 1 contracts", () => {
  it("separates CSV configuration from CSV observers", () => {
    assertTrue<IsExact<HasKey<CsvExportGridOptions, "csvExport">, true>>(true);
    assertTrue<
      IsExact<HasKey<CsvExportGridOptions, "onCsvExportProgress">, false>
    >(true);
    assertTrue<
      IsExact<HasKey<CsvExportEventCallbacks, "csvExport">, false>
    >(true);
    assertTrue<
      IsExact<
        HasKey<CsvExportEventCallbacks, "onCsvExportProgress">,
        true
      >
    >(true);
    assertTrue<
      IsExact<
        keyof CsvExportGridProps,
        "csvExport" | keyof CsvExportEventCallbacks
      >
    >(true);
  });

  it("keeps the pre-commit mutation hook outside GridEventCallbacks", () => {
    assertTrue<
      IsExact<HasKey<GridEventCallbacks, "onBeforeCellEditCommit">, false>
    >(true);
    assertTrue<
      IsExact<HasKey<GridEventCallbacks, "onCellValueChanged">, true>
    >(true);
    assertTrue<
      IsExact<keyof GridEventCallbacks, ExpectedGridEventCallbackKey>
    >(true);
  });

  it("keeps the neutral callback bridge outside renderer hot paths", () => {
    const bridgeSource = readFileSync(
      resolve("src/adapters/gridEventCallbacks.ts"),
      "utf8",
    );
    expect(bridgeSource).not.toMatch(
      /rendering|VirtualWindowSync|populateRow|ring-buffer|poolTypes/,
    );

    const rendererFiles = [
      "src/rendering/DomGridRenderer.ts",
      "src/rendering/ring-buffer/VirtualWindowSync.ts",
      "src/rendering/dom/DomPoolManager.ts",
      "src/rendering/helpers/populateRow.ts",
    ];
    for (const file of rendererFiles) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).not.toMatch(
        /gridEventCallbacks|subscribeGridEventCallbacks|GridEventCallbacks/,
      );
    }
  });

  it("keeps ordinary and CSV producers on one event path", () => {
    const gridSource = readFileSync(resolve("src/Grid.ts"), "utf8");
    const csvFeatureSource = readFileSync(
      resolve("src/features/csv-export/csvExportFeature.ts"),
      "utf8",
    );

    expect(gridSource).not.toMatch(
      /this\.on(?!BeforeCellEditCommit)[A-Z][A-Za-z]+Callback/,
    );
    expect(csvFeatureSource).not.toMatch(/onCsvExport[A-Z]/);
    expect(csvFeatureSource).not.toMatch(
      /getGridProperty\("onCsvExport/,
    );
  });

  it("replaces the mixed mutation seam with the seven explicit setters", () => {
    assertTrue<
      IsExact<Extract<keyof Grid, ExpectedDynamicSetterKey>, ExpectedDynamicSetterKey>
    >(true);

    const gridSource = readFileSync(resolve("src/Grid.ts"), "utf8");
    const registrySource = readFileSync(
      resolve("src/features/registry.ts"),
      "utf8",
    );
    expect(gridSource).not.toMatch(/\bupdateCallbacks\b|\bliveProps\b/);
    expect(registrySource).not.toMatch(/\bgetGridProperty\b/);
  });

  it("separates framework-neutral options, hooks, APIs, and lifecycle exactly", () => {
    type ReactOnlyKey = "height" | "className" | "style" | "immutableRows";

    assertTrue<IsExact<Extract<keyof GridOptions, ReactOnlyKey>, never>>(true);
    assertTrue<
      IsExact<Extract<keyof GridOptions, keyof GridEventCallbacks>, never>
    >(true);
    assertTrue<
      IsExact<keyof GridHooks, "onBeforeCellEditCommit">
    >(true);
    assertTrue<
      IsExact<
        keyof GridCreateOptions,
        keyof GridOptions | keyof GridHooks | keyof GridEventCallbacks
      >
    >(true);
    assertTrue<IsExact<LightFastGridProps, GridCreateOptions>>(true);
    assertTrue<IsExact<Extract<keyof GridApi, "getInstance">, never>>(true);
    assertTrue<
      IsExact<
        Exclude<keyof LightFastGridHandle, keyof GridApi>,
        "getInstance"
      >
    >(true);
    assertTrue<IsExact<Grid extends GridAdapterApi ? true : false, true>>(true);
    assertTrue<IsExact<Grid extends GridEventSource ? true : false, true>>(true);
    assertTrue<IsExact<Grid extends GridLifecycle ? true : false, true>>(true);
  });

  it("does not expose rowIdField as a supported GridOptions identity API", () => {
    assertTrue<IsExact<HasKey<GridOptions, "rowIdField">, false>>(true);
    const typesSource = readFileSync(resolve("src/types.ts"), "utf8");
    expect(typesSource).not.toMatch(/^\s*rowIdField\?:/m);
  });
});
