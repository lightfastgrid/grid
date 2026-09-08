/**
 * Edit these hooks to reshape the gridDemo dataset.
 *
 * Run: pnpm transform:grid-demo-dataset
 * See transform-dataset.mjs --help
 */

import { buildGridDemoColumnDefs } from "./gridDemoColumnDefs.mjs";
import {
  GRID_DEMO_DATASET_SCHEMA,
  GRID_DEMO_DATASET_SEED,
  GRID_DEMO_REFERENCE_DATE,
} from "./gridDemoDatasetProfiles.mjs";
import { enrichGridDemoRow } from "./rowEnrichment.mjs";

export { ROW_NUMBER_FIELD } from "./gridDemoColumnDefs.mjs";

/**
 * @param {Record<string, unknown>} row
 * @param {number} index
 * @param {import("./transform-dataset.mjs").DatasetSource} source
 * @returns {Record<string, unknown>}
 */
export function transformRow(row, index, source) {
  void source;
  return enrichGridDemoRow(row, index);
}

/**
 * @param {unknown[]} columnDefs
 * @returns {unknown[]}
 */
export function transformColumnDefs(columnDefs) {
  void columnDefs;
  return buildGridDemoColumnDefs();
}

export function createGridDemoMetadata(columnDefs, rowCount) {
  return {
    schema: GRID_DEMO_DATASET_SCHEMA,
    description:
      "Deterministic customer-operations records with coherent account health, financial, engagement, geography, contract, and product data.",
    rowCount,
    columnCount: columnDefs.length,
    businessFieldCount: 23,
    utilityColumnCount: 3,
    seed: GRID_DEMO_DATASET_SEED,
    referenceDate: GRID_DEMO_REFERENCE_DATE,
    dataPolicy: "Synthetic, deterministic, and non-routable. Contains no real customer data.",
    leadingColumns: [
      "ID",
      "Customer",
      "Status",
      "Country",
      "Email",
      "Balance",
      "Created At",
      "Progress",
      "Rating",
      "Actions",
    ],
  };
}

/**
 * @param {import("./transform-dataset.mjs").DatasetSource} source
 * @returns {{ columnDefs: unknown[]; rowData: Record<string, unknown>[] }}
 */
export function transformDataset(source) {
  const columnDefs = transformColumnDefs(source.columnDefs ?? []);
  const rowData = (source.rowData ?? []).map((row, index) =>
    transformRow(row, index, source),
  );

  return {
    gridDemo: createGridDemoMetadata(columnDefs, rowData.length),
    columnDefs,
    rowData,
  };
}
