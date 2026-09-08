const DATASET_PREFIX = "lightfastgrid-customer-operations";

export const GRID_DEMO_DATASET_SCHEMA = "customer-operations-v1";
export const GRID_DEMO_DATASET_SEED = 20_260_820;
export const GRID_DEMO_REFERENCE_DATE = "2026-08-01";

export const GRID_DEMO_DATASET_PROFILES = Object.freeze([
  Object.freeze({
    id: "customer-operations-1k",
    label: "1,000 rows",
    rowCount: 1_000,
    file: `${DATASET_PREFIX}-1k.json`,
    delivery: "repository",
    availability: "bundled",
  }),
  Object.freeze({
    id: "customer-operations-10k",
    label: "10,000 rows",
    rowCount: 10_000,
    file: `${DATASET_PREFIX}-10k.json`,
    delivery: "generated-static",
    availability: "local-or-cdn",
  }),
  Object.freeze({
    id: "customer-operations-100k",
    label: "100,000 rows",
    rowCount: 100_000,
    file: `${DATASET_PREFIX}-100k.json`,
    delivery: "generated-static",
    availability: "local-or-cdn",
  }),
  Object.freeze({
    id: "customer-operations-1m",
    label: "1,000,000 rows",
    rowCount: 1_000_000,
    file: null,
    delivery: "block",
    availability: "requires-block-loader",
  }),
]);

export const DEFAULT_GRID_DEMO_DATASET_PROFILE =
  GRID_DEMO_DATASET_PROFILES[0];

export function findGridDemoDatasetProfile(rowCount) {
  return (
    GRID_DEMO_DATASET_PROFILES.find(
      (profile) => profile.rowCount === rowCount,
    ) ?? null
  );
}

export function buildGridDemoDatasetManifest(columnCount) {
  return {
    schema: "lightfastgrid-demo-dataset-manifest-v1",
    defaultDatasetId: DEFAULT_GRID_DEMO_DATASET_PROFILE.id,
    columnCount,
    datasets: GRID_DEMO_DATASET_PROFILES.map((profile) => ({ ...profile })),
  };
}
