import type { ExecutionOptions } from "@lightfastgrid/core";

/** Workers run at 10,000 rows and above (1k stays on the main thread). */
export const GRID_DEMO_WORKER_ROW_THRESHOLD = 10_000;

export const gridDemoExecution: ExecutionOptions = {
  thresholds: {
    sort: GRID_DEMO_WORKER_ROW_THRESHOLD,
    filter: GRID_DEMO_WORKER_ROW_THRESHOLD,
    quickSearch: GRID_DEMO_WORKER_ROW_THRESHOLD,
  },
};
