import type { FilterExecutionEvidence, FilterProducer, SortExecutionEvidence } from "./benchmarkProtocol.ts";
import { LFG_QUICK_SEARCH_WORKER_THRESHOLD } from "./lfgQuickSearchMode.ts";

export const LFG_FILTER_WORKER_THRESHOLD = LFG_QUICK_SEARCH_WORKER_THRESHOLD;
export const LFG_SORT_WORKER_THRESHOLD = LFG_QUICK_SEARCH_WORKER_THRESHOLD;

export function workerRouteConfirmedForProducer(
  producer: FilterProducer,
): boolean | null {
  if (producer === "none") return null;
  return producer === "worker";
}

export function buildLfgFilterEvidence(options: {
  readonly operation: "filter" | "sort";
  readonly rowCount: number;
  readonly producer: FilterProducer;
  readonly scheduled?: boolean;
}): FilterExecutionEvidence {
  const threshold =
    options.operation === "sort" ? LFG_SORT_WORKER_THRESHOLD : LFG_FILTER_WORKER_THRESHOLD;
  const scheduled = options.scheduled ?? options.producer !== "none";
  const notes = [
    `Completion producer is ${options.producer}. Pending and row-count eligibility are not producer proof.`,
  ];
  if (options.producer === "none") {
    notes.push(
      "This command did not schedule Filter execution. Producer is not applicable and is not Filter Worker evidence.",
    );
  }
  if (options.producer === "cache") {
    notes.push("cache producer is a cache hit and must not be described as Worker execution.");
  }
  if (options.producer === "unknown") {
    notes.push("unknown producer is invalid for a LightFastGrid Worker claim.");
  }
  if (options.operation === "sort" && options.producer === "unknown") {
    notes.push(
      "Core does not call scheduleSort below the product sort threshold; unknown sort producer is a documented observation limit, not a Worker claim.",
    );
  }
  if (options.rowCount < threshold && options.producer === "mainThread") {
    notes.push(
      "Below the Worker threshold, mainThread is expected diagnostic evidence, not a Worker-performance claim.",
    );
  }
  return {
    product: "lightfastgrid",
    operation: options.operation,
    producer: options.producer,
    scheduled,
    rowCount: options.rowCount,
    workerThreshold: threshold,
    workerRouteConfirmed: workerRouteConfirmedForProducer(options.producer),
    notes,
  };
}

export function buildAgGridFilterEvidence(options: {
  readonly operation: "filter" | "sort";
  readonly rowCount: number;
  readonly producer?: FilterProducer;
}): FilterExecutionEvidence {
  const producer = options.producer ?? "unknown";
  const notes = [
    "This harness observes AG Grid's public completion lifecycle (filterChanged / sortChanged) and does not invent a Worker producer.",
  ];
  if (producer === "none") {
    notes.push(
      "Filter Clear does not schedule Filter execution in this harness. Producer is not applicable and is not Worker evidence.",
    );
  }
  return {
    product: "ag-grid",
    operation: options.operation,
    producer,
    scheduled: false,
    rowCount: options.rowCount,
    workerThreshold: null,
    workerRouteConfirmed: null,
    notes,
  };
}

export function baselineFilterEvidence(operation: "filter" | "sort"): SortExecutionEvidence {
  return {
    product: "baseline",
    operation,
    producer: "unknown",
    scheduled: false,
    rowCount: 0,
    workerThreshold: null,
    workerRouteConfirmed: null,
    notes: ["Baseline host does not execute a grid filter or sort."],
  };
}
