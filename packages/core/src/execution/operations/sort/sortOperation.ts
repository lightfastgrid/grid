/**
 * Sort as an {@link ExecutionOperation}.
 *
 * Thin wrapper that adapts the sort execution pieces in this module to
 * the generic operation contract. Pure delegation — no sort logic lives
 * here. {@link GridExecutionService} schedules this operation through
 * the generic {@link OperationExecutionRunner}.
 */

import type { ExecutionOperation, RowIndexExecutionResult } from "../types";

import { executeSortMainThread } from "./sortMainThread";
import { sortParityFixtures } from "./sortParityFixtures";
import { executeWorkerSortPayload } from "./sortWorkerAlgorithm";
import { SortWorkerClient } from "./sortWorkerClient";
import type { WorkerSortEligibility } from "./sortWorkerEligibility";
import { resolveWorkerSortEligibility } from "./sortWorkerEligibility";
import type { WorkerSortPayload } from "./sortWorkerPayload";
import { buildWorkerSortPayload } from "./sortWorkerPayload";
import type { SortOperationInput } from "./types";

/**
 * Row count at or above which sort should run asynchronously (and in a
 * Worker when eligible).
 */
export const SORT_OPERATION_THRESHOLD = 25_000;

/** The sort operation, wired to the existing sort implementation. */
export const sortOperation: ExecutionOperation<
  SortOperationInput,
  RowIndexExecutionResult,
  WorkerSortPayload,
  Uint32Array,
  RowIndexExecutionResult,
  WorkerSortEligibility
> = {
  name: "sort",
  threshold: SORT_OPERATION_THRESHOLD,

  getWorkUnitCount: (input) =>
    input.sourceIndexes ? input.sourceIndexes.length : input.rows.length,

  mainThread: {
    execute: (input) =>
      executeSortMainThread(
        input.rows,
        input.sortModel,
        input.columns,
        input.ctx,
        input.sourceIndexes,
      ),
  },

  worker: {
    resolveEligibility: (input) =>
      input.sourceIndexes
        ? { eligible: false, entries: [], reason: "source-indexes-subset" }
        : resolveWorkerSortEligibility(input.sortModel, input.columns),

    buildPayload: (input, eligibility) =>
      buildWorkerSortPayload(input.rows, eligibility),

    executePayload: (payload) => executeWorkerSortPayload(payload).indexes,

    createClient: () => new SortWorkerClient(),
  },

  // executeSortMainThread already returns the normalized result.
  normalizeMainOutput: (output) => output,

  normalizeWorkerOutput: (indexes) => ({ kind: "indexes", indexes }),

  // Delegates to the cache boundary carried on the input, when one is
  // provided. OperationExecutionRunner consults this before executing.
  cache: {
    tryResolve: (input) => input.cache?.tryResolve(input) ?? null,
    record: (input, output, producer) => {
      input.cache?.record?.(input, output, producer);
    },
  },

  parityFixtures: sortParityFixtures,
};
