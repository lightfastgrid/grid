import type { ExecutionOperation, RowIndexExecutionResult } from "../types";

import { executeQuickSearchAsync, executeQuickSearchSync } from "./quickSearchMainThread";
import { quickSearchParityFixtures } from "./quickSearchParityFixtures";
import { executeQuickSearchWorkerPayload } from "./quickSearchWorkerAlgorithm";
import { QuickSearchWorkerClientAdapter } from "./quickSearchWorkerClientAdapter";
import type { QuickSearchWorkerEligibility } from "./quickSearchWorkerEligibility";
import { resolveQuickSearchWorkerEligibility } from "./quickSearchWorkerEligibility";
import type { QuickSearchWorkerPayload } from "./quickSearchWorkerPayload";
import { buildQuickSearchWorkerPayload } from "./quickSearchWorkerPayload";
import type { QuickSearchOperationInput } from "./types";

export const QUICK_SEARCH_OPERATION_THRESHOLD = 25_000;

export const quickSearchOperation: ExecutionOperation<
  QuickSearchOperationInput,
  RowIndexExecutionResult,
  QuickSearchWorkerPayload,
  Uint32Array | null,
  RowIndexExecutionResult,
  QuickSearchWorkerEligibility
> = {
  name: "quickSearch",
  threshold: QUICK_SEARCH_OPERATION_THRESHOLD,

  getWorkUnitCount: (input) =>
    input.sourceIndexes ? input.sourceIndexes.length : input.rows.length,

  mainThread: {
    execute: (input) => executeQuickSearchSync(input),
    executeAsync: (input, onComplete) =>
      executeQuickSearchAsync(input, onComplete),
  },

  worker: {
    resolveEligibility: (input) => resolveQuickSearchWorkerEligibility(input),

    buildPayload: (input, eligibility) => {
      if (!eligibility.eligible) return null;
      // Provider runs only on the large worker-eligible path, after the
      // runner has already cancelled prior worker work.
      const transfer = input.prepareWorkerTransfer?.();
      return buildQuickSearchWorkerPayload(
        input.rows,
        eligibility.descriptors,
        eligibility.fieldsSignature,
        input.quickFilterText,
        input.sourceIndexes,
        input.filteredOrderVersion,
        input.quickFilterCacheMode ?? "auto",
        input.sourceLayoutRevision,
        input.searchableDataRevision,
        transfer,
      );
    },

    executePayload: (payload) => executeQuickSearchWorkerPayload(payload),

    createClient: () => new QuickSearchWorkerClientAdapter(),
  },

  normalizeMainOutput: (output) => output,
  normalizeWorkerOutput: (indexes, input) => {
    if (indexes === null) {
      if (input.sourceIndexes) {
        return { kind: "indexes", indexes: new Uint32Array(input.sourceIndexes) };
      }
      return { kind: "identity", rowCount: input.rows.length };
    }
    return { kind: "indexes", indexes };
  },

  parityFixtures: quickSearchParityFixtures,
};
