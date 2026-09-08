import type { CsvExportParams } from "@lightfastgrid/core";

import type { DemoGridGetter } from "../../runtime/types.ts";

import {
  type AdvancedExportOptions,
  buildAdvancedExportParams,
} from "./advancedExportModel.ts";

export const DEMO_CSV_FILE_NAME = "lightfastgrid-demo.csv";

export type DemoExportSelection = {
  rowCount: number;
  columnCount: number;
};

export function readDemoExportSelection(
  getGrid: DemoGridGetter,
): DemoExportSelection {
  const grid = getGrid();
  if (!grid) return { rowCount: 0, columnCount: 0 };
  return {
    rowCount: grid.getSelectedRowIds().length,
    columnCount: grid.getSelectedColumnIds().length,
  };
}

function startExport(
  getGrid: DemoGridGetter,
  params: CsvExportParams,
  onComplete?: () => void,
): void {
  const task = getGrid()?.exportDataAsCsv(params);
  if (!task) return;
  void task.promise
    .then(() => {
      onComplete?.();
    })
    .catch((error: unknown) => {
      console.error("CSV export failed", error);
    });
}

/** Default demo export — filtered + sorted display rows, visible columns. */
export function exportDemoCsv(
  getGrid: DemoGridGetter,
  onComplete?: () => void,
): void {
  startExport(
    getGrid,
    {
      fileName: DEMO_CSV_FILE_NAME,
      rows: { mode: "filteredAndSorted" },
      columns: { mode: "visible" },
    },
    onComplete,
  );
}

export function exportFilteredAndSortedCsv(
  getGrid: DemoGridGetter,
  onComplete?: () => void,
): void {
  exportDemoCsv(getGrid, onComplete);
}

export function exportCurrentPageCsv(
  getGrid: DemoGridGetter,
  onComplete?: () => void,
): void {
  startExport(
    getGrid,
    {
      fileName: DEMO_CSV_FILE_NAME,
      rows: { mode: "currentPage" },
      columns: { mode: "visible" },
    },
    onComplete,
  );
}

export function exportSelectedRowsCsv(
  getGrid: DemoGridGetter,
  onComplete?: () => void,
): void {
  startExport(
    getGrid,
    {
      fileName: DEMO_CSV_FILE_NAME,
      rows: { mode: "selected" },
      columns: { mode: "visible" },
    },
    onComplete,
  );
}

export function exportSelectedColumnsCsv(
  getGrid: DemoGridGetter,
  onComplete?: () => void,
): void {
  startExport(
    getGrid,
    {
      fileName: DEMO_CSV_FILE_NAME,
      rows: { mode: "filteredAndSorted" },
      columns: { mode: "selected" },
    },
    onComplete,
  );
}

function readAdvancedExportColumns(
  getGrid: DemoGridGetter,
): { field: string; visible: boolean }[] {
  const grid = getGrid();
  if (!grid) return [];
  const visibilityByField = new Map(
    grid.getColumnVisibilityState().map((entry) => [entry.field, entry.visible]),
  );
  return grid.getColumns().map((column) => ({
    field: column.field,
    visible: visibilityByField.get(column.field) ?? column.visible !== false,
  }));
}

export function downloadAdvancedExportCsv(
  getGrid: DemoGridGetter,
  options: AdvancedExportOptions,
  onComplete?: () => void,
): void {
  startExport(
    getGrid,
    buildAdvancedExportParams(options, readAdvancedExportColumns(getGrid)),
    onComplete,
  );
}

export async function copyAdvancedExportText(
  getGrid: DemoGridGetter,
  options: AdvancedExportOptions,
): Promise<boolean> {
  const grid = getGrid();
  if (!grid) return false;
  const { fileName: _fileName, ...params } = buildAdvancedExportParams(
    options,
    readAdvancedExportColumns(getGrid),
  );
  const text = await grid.getDataAsCsv(params);
  await navigator.clipboard.writeText(text);
  return true;
}
