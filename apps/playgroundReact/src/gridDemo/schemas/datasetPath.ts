/** Reference AG Grid dataset (source for transform script). */
export const GRID_DEMO_SOURCE_DATASET_FILE =
  "ag-grid-100000x22-with-columns.json";

/**
 * Default committed showcase dataset in the repository-root `schemas/` folder.
 * Larger committed tiers (10k, 100k) are listed in `grid-demo-datasets.json`.
 * Served at `/grid-demo/schemas/*` (not bundled).
 */
export const GRID_DEMO_DATASET_FILE =
  "lightfastgrid-customer-operations-1k.json";

export const GRID_DEMO_DATASET_MANIFEST_FILE = "grid-demo-datasets.json";

export const GRID_DEMO_DATASET_URL = `/grid-demo/schemas/${GRID_DEMO_DATASET_FILE}`;

export const GRID_DEMO_DATASET_MANIFEST_URL =
  `/grid-demo/schemas/${GRID_DEMO_DATASET_MANIFEST_FILE}`;
