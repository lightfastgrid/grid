import type {
  QuickSearchExecutionEvidence,
  QuickSearchProducer,
} from "./benchmarkProtocol.ts";

export const LFG_QUICK_SEARCH_MODES = [
  "workerIsolated",
  "mainThreadIsolated",
  "workerProductionOptimized",
] as const;

export type LfgQuickSearchMode = (typeof LFG_QUICK_SEARCH_MODES)[number];

export const LFG_QUICK_SEARCH_WORKER_THRESHOLD = 25_000;

export type LfgQuickSearchModeOrDefault = LfgQuickSearchMode | "productDefault";

export type LightFastGridQuickSearchMountConfig = {
  readonly mode: LfgQuickSearchModeOrDefault;
  readonly forcedMainThread: boolean;
  readonly quickFilter: true | { enabled: true; cache: boolean; prewarm: boolean };
  readonly execution: { thresholds: { quickSearch: number } } | undefined;
  readonly quickSearchThreshold: number | null;
  readonly cache: boolean | "auto" | null;
  readonly prewarm: boolean | "auto" | null;
};

export function isLfgQuickSearchMode(value: string | null | undefined): value is LfgQuickSearchMode {
  return (
    value === "workerIsolated" ||
    value === "mainThreadIsolated" ||
    value === "workerProductionOptimized"
  );
}

export function resolveLfgQuickSearchModeFromSearch(
  search = typeof window !== "undefined" ? window.location.search : "",
): LfgQuickSearchModeOrDefault {
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(
    "lfgQuickSearchMode",
  );
  if (raw == null || raw === "" || raw === "productDefault") return "productDefault";
  if (isLfgQuickSearchMode(raw)) return raw;
  throw new Error(
    `Unknown lfgQuickSearchMode "${raw}". Use workerIsolated, mainThreadIsolated, workerProductionOptimized, or omit for productDefault.`,
  );
}

export function lightFastGridQuickSearchMountConfig(
  mode: LfgQuickSearchModeOrDefault,
  rowCount: number,
): LightFastGridQuickSearchMountConfig {
  if (mode === "productDefault") {
    return {
      mode,
      forcedMainThread: false,
      quickFilter: true,
      execution: undefined,
      quickSearchThreshold: LFG_QUICK_SEARCH_WORKER_THRESHOLD,
      cache: "auto",
      prewarm: "auto",
    };
  }
  if (mode === "workerIsolated") {
    return {
      mode,
      forcedMainThread: false,
      quickFilter: { enabled: true, cache: false, prewarm: false },
      execution: { thresholds: { quickSearch: LFG_QUICK_SEARCH_WORKER_THRESHOLD } },
      quickSearchThreshold: LFG_QUICK_SEARCH_WORKER_THRESHOLD,
      cache: false,
      prewarm: false,
    };
  }
  if (mode === "mainThreadIsolated") {
    const threshold = rowCount + 1;
    return {
      mode,
      forcedMainThread: true,
      quickFilter: { enabled: true, cache: false, prewarm: false },
      execution: { thresholds: { quickSearch: threshold } },
      quickSearchThreshold: threshold,
      cache: false,
      prewarm: false,
    };
  }
  return {
    mode,
    forcedMainThread: false,
    quickFilter: { enabled: true, cache: true, prewarm: true },
    execution: { thresholds: { quickSearch: LFG_QUICK_SEARCH_WORKER_THRESHOLD } },
    quickSearchThreshold: LFG_QUICK_SEARCH_WORKER_THRESHOLD,
    cache: true,
    prewarm: true,
  };
}

export type ProductionProducerInterpretation = {
  readonly sampleValid: boolean;
  readonly invalidCode: "missing-producer" | null;
  readonly invalidMessage: string | null;
  readonly supportsWorkerPerformanceClaim: boolean;
  readonly workerComparisonProvisional: boolean;
  readonly notes: readonly string[];
};

export function interpretProductionQuickSearchProducer(options: {
  readonly producer: QuickSearchProducer;
  readonly rowCount: number;
  readonly quickSearchThreshold: number | null;
}): ProductionProducerInterpretation {
  const { producer, rowCount, quickSearchThreshold } = options;
  if (producer === "unknown") {
    return {
      sampleValid: false,
      invalidCode: "missing-producer",
      invalidMessage:
        "workerProductionOptimized requires direct completion producer evidence; pending and eligibility are not proof",
      supportsWorkerPerformanceClaim: false,
      workerComparisonProvisional: true,
      notes: ["unknown producer is invalid for production Quick Search samples."],
    };
  }
  const atOrAboveThreshold =
    typeof quickSearchThreshold === "number" && rowCount >= quickSearchThreshold;
  if (!atOrAboveThreshold) {
    return {
      sampleValid: true,
      invalidCode: null,
      invalidMessage: null,
      supportsWorkerPerformanceClaim: producer === "worker",
      workerComparisonProvisional: false,
      notes: [
        producer === "mainThread"
          ? "Below the Worker threshold, mainThread is expected and valid diagnostic evidence, not a Worker-performance claim."
          : `Below the Worker threshold, producer ${producer} is retained; only producer worker supports a Worker-performance claim.`,
      ],
    };
  }
  if (producer === "worker") {
    return {
      sampleValid: true,
      invalidCode: null,
      invalidMessage: null,
      supportsWorkerPerformanceClaim: true,
      workerComparisonProvisional: false,
      notes: ["At or above the Worker threshold, producer worker is eligible Worker-performance evidence."],
    };
  }
  if (producer === "cache") {
    return {
      sampleValid: true,
      invalidCode: null,
      invalidMessage: null,
      supportsWorkerPerformanceClaim: false,
      workerComparisonProvisional: false,
      notes: [
        "cache producer is a cache/prewarm result and must not be described as Worker execution.",
      ],
    };
  }
  return {
    sampleValid: true,
    invalidCode: null,
    invalidMessage: null,
    supportsWorkerPerformanceClaim: false,
    workerComparisonProvisional: true,
    notes: [
      "production sample used mainThread at or above the Worker threshold; retained as product performance, not a Worker-performance claim",
    ],
  };
}

export function buildLfgQuickSearchEvidence(options: {
  readonly config: LightFastGridQuickSearchMountConfig;
  readonly rowCount: number;
  readonly pendingObserved: boolean;
  readonly producer: QuickSearchProducer;
}): QuickSearchExecutionEvidence {
  const { config, rowCount, pendingObserved, producer } = options;
  const threshold = config.quickSearchThreshold;
  const workerEligibleByCount =
    typeof threshold === "number" && rowCount >= threshold && !config.forcedMainThread;
  const workerRouteConfirmed = producer === "worker";
  const notes: string[] = [];
  notes.push(
    `Completion producer is ${producer}. Pending and row-count eligibility are not producer proof.`,
  );
  if (config.mode === "workerIsolated") {
    notes.push("cache false, prewarm false, threshold 25000. Direct producer must be worker.");
    if (producer !== "worker") {
      notes.push(`workerIsolated producer was ${producer}, not worker.`);
    }
  }
  if (config.mode === "mainThreadIsolated") {
    notes.push(
      `forcedMainThread: threshold ${threshold} is greater than rowCount ${rowCount}. Do not describe this as the default configuration.`,
    );
    if (producer !== "mainThread") {
      notes.push(`forcedMainThread producer was ${producer}, not mainThread.`);
    }
  }
  if (config.mode === "workerProductionOptimized") {
    notes.push(
      "Recommended production config: cache true, prewarm true, threshold 25000. Preserve the exact producer; cache hits are not Worker executions.",
    );
    const interpretation = interpretProductionQuickSearchProducer({
      producer,
      rowCount,
      quickSearchThreshold: threshold,
    });
    for (const note of interpretation.notes) {
      if (!notes.includes(note)) notes.push(note);
    }
  }
  if (pendingObserved) {
    notes.push("quick-search-pending was observed; that is lifecycle evidence only.");
  }
  if (workerEligibleByCount) {
    notes.push("Row count is at or above the Worker threshold; eligibility is not route proof.");
  }
  return {
    product: "lightfastgrid",
    mode: config.mode,
    rowCount,
    quickSearchThreshold: threshold,
    cache: config.cache,
    prewarm: config.prewarm,
    pendingObserved,
    workerEligibleByCount,
    producer,
    workerRouteConfirmed,
    forcedMainThread: config.forcedMainThread,
    cacheQuickFilter: null,
    notes,
  };
}

export function buildAgGridQuickSearchEvidence(options: {
  readonly rowCount: number;
  readonly cacheQuickFilter: boolean;
}): QuickSearchExecutionEvidence {
  return {
    product: "ag-grid",
    mode: "agGridBaseline",
    rowCount: options.rowCount,
    quickSearchThreshold: null,
    cache: null,
    prewarm: null,
    pendingObserved: false,
    workerEligibleByCount: null,
    producer: "unknown",
    workerRouteConfirmed: null,
    forcedMainThread: false,
    cacheQuickFilter: options.cacheQuickFilter,
    notes: [
      options.cacheQuickFilter
        ? "AG Grid cacheQuickFilter is true. AG Grid has no LightFastGrid-style Quick Search Worker mode."
        : "AG Grid cacheQuickFilter is not enabled.",
    ],
  };
}
