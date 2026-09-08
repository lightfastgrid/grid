import type { ExecutionOperation, RowIndexExecutionResult } from "../types";

import { executeFilterOperation } from "./filterMainThread";
import { filterParityFixtures } from "./filterParityFixtures";
import { executeWorkerFilterPayload } from "./filterWorkerAlgorithm";
import { FilterWorkerClient } from "./filterWorkerClient";
import type { WorkerFilterEligibility } from "./filterWorkerEligibility";
import { resolveWorkerFilterEligibility } from "./filterWorkerEligibility";
import type { WorkerFilterPayload } from "./filterWorkerPayload";
import { buildWorkerFilterPayload } from "./filterWorkerPayload";
import type { FilterOperationInput } from "./types";

export const FILTER_OPERATION_THRESHOLD = 25_000;

export const filterOperation: ExecutionOperation<
  FilterOperationInput,
  RowIndexExecutionResult,
  WorkerFilterPayload,
  Uint32Array,
  RowIndexExecutionResult,
  WorkerFilterEligibility
> = {
  name: "filter",
  threshold: FILTER_OPERATION_THRESHOLD,

  getWorkUnitCount: (input) =>
    input.sourceIndexes ? input.sourceIndexes.length : input.rows.length,

  mainThread: {
    execute: (input) => executeFilterOperation(input),
  },

  worker: {
    resolveEligibility: (input) =>
      resolveWorkerFilterEligibility(
        input.filterModel,
        input.columnsByField,
        input.getCellValue,
      ),

    buildPayload: (input, eligibility) =>
      buildWorkerFilterPayload(
        input.rows,
        input.filterModel,
        input.columnsByField,
        eligibility,
        input.sourceIndexes,
      ),

    executePayload: (payload) =>
      executeWorkerFilterPayload(payload).indexes,

    createClient: () => new FilterWorkerClient(),
  },

  normalizeMainOutput: (output) => output,

  normalizeWorkerOutput: (indexes) => ({ kind: "indexes", indexes }),

  parityFixtures: filterParityFixtures,
};
