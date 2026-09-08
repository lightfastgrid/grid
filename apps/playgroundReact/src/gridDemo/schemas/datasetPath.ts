/** Reference AG Grid dataset (source for transform script). */
export const GRID_DEMO_SOURCE_DATASET_FILE =
  "ag-grid-100000x22-with-columns.json";

/**
 * Default committed showcase dataset. Larger generated tiers are described by
 * `grid-demo-datasets.json` and are loaded only when explicitly selected.
 * Served at `/grid-demo/schemas/*` (not bundled).
 */
export const GRID_DEMO_DATASET_FILE =
  "lightfastgrid-customer-operations-1k.json";

export const GRID_DEMO_DATASET_MANIFEST_FILE = "grid-demo-datasets.json";

export const GRID_DEMO_DATASET_URL = `/grid-demo/schemas/${GRID_DEMO_DATASET_FILE}`;

export const GRID_DEMO_DATASET_MANIFEST_URL =
  `/grid-demo/schemas/${GRID_DEMO_DATASET_MANIFEST_FILE}`;
