import { isFilterClearOperation } from "../../../shared/src/filterScenarios.ts";
import { interpretProductionQuickSearchProducer } from "../../../shared/src/lfgQuickSearchMode.ts";
import { P95_MIN_VALID_SAMPLES } from "./schema.ts";
import { summarizeNumeric } from "./summarize.ts";
import type {
  FilterModeComparison,
  FilterModeComparisonLane,
  ModeComparisonCell,
  QuickSearchModeComparison,
  QuickSearchModeComparisonLane,
  RuntimeOperationId,
} from "./schema.ts";

type ModeSample = {
  readonly lane?: "react" | "vanilla";
  readonly appId: string;
  readonly round?: number;
  readonly slotIndex?: number;
  readonly warmupAttempt?: 0 | 1 | null;
  readonly operation: RuntimeOperationId | string;
  readonly lfgMode?: string | null;
  readonly purpose?: "competitive" | "quickSearch" | null;
  readonly scenarioId?: string | null;
  readonly valid: boolean;
  readonly role: "warmup" | "measured";
  readonly durationMs: number | null;
  readonly uxDurationMs?: number | null;
  readonly observers?: {
    readonly longTask?: {
      readonly supported: boolean;
      readonly maxMs?: number;
      readonly over50msCount?: number;
    };
  } | null;
  readonly executionEvidence?: {
    readonly workerRouteConfirmed?: boolean | null;
    readonly producer?: "worker" | "mainThread" | "cache" | "unknown" | "none" | null;
    readonly rowCount?: number | null;
    readonly quickSearchThreshold?: number | null;
  } | null;
  readonly cpuThrottle?: {
    readonly workerThrottle?: {
      readonly required?: boolean;
      readonly confirmedEquivalentToPage?: boolean;
      readonly attempts?: ReadonlyArray<{ readonly acknowledged?: boolean }>;
      readonly failureReason?: string | null;
    };
  } | null;
  readonly invalidReason?: string | null;
};

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return summarizeNumeric(values).median;
}

function p95Of(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return summarizeNumeric(values).p95;
}

function emptyProducerDistribution() {
  return { worker: 0, mainThread: 0, cache: 0, unknown: 0, none: 0 };
}

function producerDistribution(
  samples: readonly ModeSample[],
  options?: { readonly workerClaimsApplicable?: boolean },
) {
  const distribution = emptyProducerDistribution();
  const workerClaimsApplicable = options?.workerClaimsApplicable !== false;
  for (const sample of samples) {
    const producer = sample.executionEvidence?.producer ?? "unknown";
    if (!workerClaimsApplicable) {
      if (producer === "worker") {
        distribution.worker += 1;
      } else {
        distribution.none += 1;
      }
      continue;
    }
    if (
      producer === "worker" ||
      producer === "mainThread" ||
      producer === "cache" ||
      producer === "unknown" ||
      producer === "none"
    ) {
      distribution[producer] += 1;
    } else {
      distribution.unknown += 1;
    }
  }
  return distribution;
}

function workerThrottleProof(samples: readonly ModeSample[], required: boolean) {
  const attempts = samples.flatMap((sample) => sample.cpuThrottle?.workerThrottle?.attempts ?? []);
  const confirmed = required
    ? samples.length > 0 &&
      samples.every((sample) => sample.cpuThrottle?.workerThrottle?.confirmedEquivalentToPage === true)
    : true;
  const failure =
    samples
      .map((sample) => sample.cpuThrottle?.workerThrottle?.failureReason)
      .find((reason) => typeof reason === "string" && reason.length > 0) ?? null;
  return {
    required,
    confirmed,
    acknowledgedAttemptCount: attempts.filter((attempt) => attempt.acknowledged === true).length,
    attemptCount: attempts.length,
    failureReason: confirmed ? null : failure ?? (required ? "Worker throttle acknowledgement missing" : null),
  };
}

function cell(
  scenarioId: string,
  identity: string,
  modeId: string,
  label: string,
  competitor: boolean,
  samples: readonly ModeSample[],
  durationKey: "durationMs" | "uxDurationMs",
  notes: readonly string[],
  throttleRequired: boolean,
  workerClaimsApplicable = true,
): ModeComparisonCell {
  const attempted = samples.filter((sample) => sample.role === "measured");
  const valid = attempted.filter(
    (sample) => sample.valid && typeof sample[durationKey] === "number",
  );
  const durations = valid.map((sample) => sample[durationKey] as number);
  const longest = valid
    .map((sample) =>
      sample.observers?.longTask && sample.observers.longTask.supported
        ? sample.observers.longTask.maxMs
        : null,
    )
    .filter((value): value is number => typeof value === "number");
  const over50 = valid
    .map((sample) =>
      sample.observers?.longTask && sample.observers.longTask.supported
        ? sample.observers.longTask.over50msCount
        : null,
    )
    .filter((value): value is number => typeof value === "number");
  const confirmed = valid
    .map((sample) => sample.executionEvidence?.workerRouteConfirmed)
    .find((value) => value === true);
  const denied = valid.some((sample) => sample.executionEvidence?.workerRouteConfirmed === false);
  const throttle = workerThrottleProof(valid.length > 0 ? valid : attempted, throttleRequired);
  const invalidCodes = [
    ...new Set(
      attempted
        .filter((sample) => !sample.valid && sample.invalidReason)
        .map((sample) => sample.invalidReason as string),
    ),
  ];
  const provisionalReasons: string[] = [];
  if (!scenarioId) provisionalReasons.push("scenario identity is missing");
  if (throttleRequired && !throttle.confirmed) {
    provisionalReasons.push(
      throttle.failureReason ?? "equivalent Worker CPU throttling was not acknowledged",
    );
  }
  if (!workerClaimsApplicable) {
    if (
      valid.some(
        (sample) =>
          sample.executionEvidence?.producer === "worker" ||
          sample.executionEvidence?.workerRouteConfirmed === true,
      )
    ) {
      provisionalReasons.push("Filter Clear must not be treated as Filter Worker evidence");
    }
  } else {
    if (modeId === "workerIsolated" && valid.some((sample) => sample.executionEvidence?.producer !== "worker")) {
      provisionalReasons.push("workerIsolated sample lacks producer worker");
    }
    if (
      modeId === "mainThreadIsolated" &&
      valid.some((sample) => sample.executionEvidence?.producer && sample.executionEvidence.producer !== "mainThread")
    ) {
      provisionalReasons.push("forcedMainThread sample reported a producer other than mainThread");
    }
    if (valid.some((sample) => sample.executionEvidence?.producer === "unknown") && throttleRequired) {
      provisionalReasons.push("public-candidate Worker comparison cannot use producer unknown");
    }
    if (modeId === "workerProductionOptimized") {
      for (const sample of valid) {
        const producer = sample.executionEvidence?.producer ?? "unknown";
        const interpretation = interpretProductionQuickSearchProducer({
          producer: producer === "none" ? "unknown" : producer,
          rowCount: sample.executionEvidence?.rowCount ?? 0,
          quickSearchThreshold: sample.executionEvidence?.quickSearchThreshold ?? null,
        });
        if (interpretation.workerComparisonProvisional) {
          for (const note of interpretation.notes) {
            if (!provisionalReasons.includes(note)) provisionalReasons.push(note);
          }
        }
      }
      if (
        valid.some(
          (sample) =>
            sample.executionEvidence?.producer === "cache" &&
            sample.executionEvidence?.workerRouteConfirmed === true,
        )
      ) {
        provisionalReasons.push("cache producer must not be labeled as Worker execution");
      }
    }
  }
  return {
    scenarioId,
    identity,
    modeId,
    label,
    competitor,
    validSampleCount: valid.length,
    invalidSampleCount: attempted.filter((sample) => !sample.valid).length,
    medianMs: medianOf(durations),
    p95Ms: p95Of(durations),
    p95SampleCountEligible: valid.length >= P95_MIN_VALID_SAMPLES,
    uxMedianMs:
      durationKey === "uxDurationMs"
        ? medianOf(durations)
        : medianOf(
            valid
              .map((sample) => sample.uxDurationMs)
              .filter((value): value is number => typeof value === "number"),
          ),
    longestMainThreadTaskMs: longest.length > 0 ? Math.max(...longest) : null,
    longTasksOver50CountSum: over50.length > 0 ? over50.reduce((sum, value) => sum + value, 0) : null,
    producerDistribution: producerDistribution(valid.length > 0 ? valid : attempted, {
      workerClaimsApplicable,
    }),
    workerRouteConfirmed: workerClaimsApplicable
      ? confirmed === true
        ? true
        : denied
          ? false
          : valid[0]?.executionEvidence?.workerRouteConfirmed ?? null
      : null,
    workerThrottleProof: throttle,
    correctnessState: {
      valid: valid.length > 0 && invalidCodes.length === 0,
      invalidCodes,
    },
    provisionalReasons,
    notes,
  };
}

function select(
  samples: readonly ModeSample[],
  appId: string,
  operation: RuntimeOperationId,
  lfgMode: string | null,
  scenarioId: string,
): ModeSample[] {
  return samples.filter((sample) => {
    if (sample.appId !== appId) return false;
    if (sample.operation !== operation) return false;
    if (lfgMode === null ? sample.lfgMode != null : sample.lfgMode !== lfgMode) return false;
    if (sample.purpose != null && sample.purpose !== "quickSearch") return false;
    if (sample.scenarioId != null && sample.scenarioId !== scenarioId) return false;
    if (sample.scenarioId == null && sample.role === "measured") return false;
    return true;
  });
}

function selectCompetitive(
  samples: readonly ModeSample[],
  appId: string,
  operation: RuntimeOperationId,
  scenarioId: string,
): ModeSample[] {
  return samples.filter((sample) => {
    if (sample.appId !== appId) return false;
    if (sample.operation !== operation) return false;
    if (sample.purpose != null && sample.purpose !== "competitive") return false;
    if (appId.includes("lightfastgrid") && sample.lfgMode != null) return false;
    if (sample.scenarioId != null && sample.scenarioId !== scenarioId) return false;
    return true;
  });
}

function laneTable(
  lane: "react" | "vanilla",
  samples: readonly ModeSample[],
  requireCdpWorkerThrottle: boolean,
): QuickSearchModeComparisonLane {
  const lfg = lane === "react" ? "lightfastgrid" : "lightfastgrid-vanilla";
  const ag = lane === "react" ? "ag-grid" : "ag-grid-vanilla";
  const burst = "quickSearchTypingBurst" as const;
  const cold = "quickSearch" as const;
  const primed = "quickSearchPrimedDifferent" as const;
  const repeated = "quickSearchRepeatedSame" as const;
  const settled = "quickSearchTypingSettled" as const;
  const worker = (scenarioId: string, operation: RuntimeOperationId, notes: readonly string[]) =>
    cell(
      scenarioId,
      `${lfg}/workerIsolated`,
      "workerIsolated",
      "LFG Worker isolated",
      true,
      select(samples, lfg, operation, "workerIsolated", scenarioId),
      "durationMs",
      notes,
      requireCdpWorkerThrottle,
    );
  const forced = (scenarioId: string, operation: RuntimeOperationId, notes: readonly string[]) =>
    cell(
      scenarioId,
      `${lfg}/mainThreadIsolated`,
      "mainThreadIsolated",
      "LFG forced main thread",
      false,
      select(samples, lfg, operation, "mainThreadIsolated", scenarioId),
      "durationMs",
      notes,
      false,
    );
  const production = (scenarioId: string, operation: RuntimeOperationId, notes: readonly string[]) =>
    cell(
      scenarioId,
      `${lfg}/workerProductionOptimized`,
      "workerProductionOptimized",
      "LFG production optimized",
      true,
      select(samples, lfg, operation, "workerProductionOptimized", scenarioId),
      "durationMs",
      notes,
      requireCdpWorkerThrottle,
    );
  const agCell = (scenarioId: string, operation: RuntimeOperationId, notes: readonly string[]) =>
    cell(
      scenarioId,
      ag,
      "agGridBaseline",
      "AG Grid",
      true,
      select(samples, ag, operation, null, scenarioId),
      "durationMs",
      notes,
      false,
    );
  return {
    lane,
    coldFullQuery: {
      workerIsolated: worker("coldFullQuery", cold, []),
      forcedMainThread: forced("coldFullQuery", cold, ["Not a competitor."]),
      productionOptimized: production("coldFullQuery", cold, []),
      agGrid: agCell("coldFullQuery", cold, ["cacheQuickFilter true; no LFG-style Worker."]),
    },
    coldRealisticTyping: {
      workerIsolated: worker("coldRealisticTyping", burst, [
        "durationMs is final keystroke → final paint; cadence is excluded. Primary real-user typing result.",
      ]),
      forcedMainThread: forced("coldRealisticTyping", burst, [
        "Not a competitor. durationMs is final keystroke → final paint.",
      ]),
      productionOptimized: production("coldRealisticTyping", burst, [
        "durationMs is final keystroke → final paint; cadence is excluded.",
      ]),
      agGrid: agCell("coldRealisticTyping", burst, [
        "durationMs is final keystroke → final paint; cadence is excluded.",
      ]),
    },
    primedDifferentQuery: {
      workerIsolated: worker("primedDifferentQuery", primed, [
        "Primed with a different query; preparation is excluded. Label is primedDifferentQuery, not prewarmReady.",
      ]),
      forcedMainThread: forced("primedDifferentQuery", primed, ["Not a competitor."]),
      productionOptimized: production("primedDifferentQuery", primed, [
        "Primed with a different query; preparation is excluded.",
      ]),
      agGrid: agCell("primedDifferentQuery", primed, ["Primed with a different query; not a repeated-query cache hit."]),
    },
    repeatedSameQuery: {
      workerIsolated: worker("repeatedSameQuery", repeated, ["Repeated same query after settlement and clear on the same instance."]),
      forcedMainThread: forced("repeatedSameQuery", repeated, ["Not a competitor."]),
      productionOptimized: production("repeatedSameQuery", repeated, [
        "Preserve exact producer; cache hits are not Worker executions.",
      ]),
      agGrid: agCell("repeatedSameQuery", repeated, ["Repeated query with cacheQuickFilter."]),
    },
    settledIncremental: {
      workerIsolated: worker("settledIncremental", settled, ["Diagnostic only; excluded from the primary realistic-typing comparison."]),
      forcedMainThread: forced("settledIncremental", settled, ["Not a competitor. Diagnostic only."]),
      productionOptimized: production("settledIncremental", settled, ["Diagnostic only."]),
      agGrid: agCell("settledIncremental", settled, ["Diagnostic only."]),
    },
    responsiveness: {
      workerIsolated: worker("coldRealisticTyping", burst, [
        "Responsiveness uses longest main-thread long task during the cold realistic typing session.",
      ]),
      forcedMainThread: forced("coldRealisticTyping", burst, ["Not a competitor."]),
      productionOptimized: production("coldRealisticTyping", burst, []),
      agGrid: agCell("coldRealisticTyping", burst, []),
    },
  };
}

export function collectQuickSearchComparisonReasons(
  comparison: QuickSearchModeComparison,
): string[] {
  const reasons: string[] = [...comparison.provisionalReasons];
  for (const lane of [comparison.lanes.react, comparison.lanes.vanilla]) {
    for (const table of [
      lane.coldFullQuery,
      lane.coldRealisticTyping,
      lane.primedDifferentQuery,
      lane.repeatedSameQuery,
      lane.settledIncremental,
      lane.responsiveness,
    ]) {
      for (const item of Object.values(table)) {
        for (const reason of item.provisionalReasons) {
          if (!reasons.includes(reason)) reasons.push(reason);
        }
      }
    }
  }
  return reasons;
}

export function buildQuickSearchModeComparison(
  samples: readonly ModeSample[],
  workerThrottleConfirmed: boolean,
  extraProvisionalReasons: readonly string[] = [],
  options?: { readonly requireCdpWorkerThrottle?: boolean },
): QuickSearchModeComparison {
  const requireCdpWorkerThrottle = options?.requireCdpWorkerThrottle !== false;
  const reused = samples.filter((sample) => {
    if (!sample.scenarioId || typeof sample.operation !== "string") return false;
    if (sample.operation === "quickSearchTypingBurst" && sample.scenarioId !== "coldRealisticTyping") {
      return true;
    }
    if (sample.operation === "quickSearch" && sample.scenarioId !== "coldFullQuery") return true;
    return false;
  });
  const provisionalReasons = [
    ...(workerThrottleConfirmed
      ? []
      : [
          "Equivalent CPU throttling of the Quick Search Worker target was not acknowledged on every required Worker slot. Worker-vs-main-thread numbers are provisional and not a public competitive claim.",
        ]),
    ...(reused.length > 0
      ? ["A sample was reused across incompatible Quick Search scenario identities"]
      : []),
    ...extraProvisionalReasons,
  ];
  const lanes = {
    react: laneTable("react", samples, requireCdpWorkerThrottle),
    vanilla: laneTable("vanilla", samples, requireCdpWorkerThrottle),
  };
  const comparison = {
    workerThrottleConfirmed,
    provisional: provisionalReasons.length > 0,
    provisionalReasons,
    interpretation: {
      workerIsNotAutomaticallyFaster: true as const,
      reportLatencyAndResponsivenessSideBySide: true as const,
      noWinnerField: true as const,
      forcedMainThreadIsNotACompetitor: true as const,
      noLatencyWinWithoutLowerCompletion: true as const,
      noWorkerWinFromSmallerLongTaskAlone: true as const,
      advantageAttribution: [
        "Worker execution is not automatically a lower completion-time result; it primarily protects main-thread responsiveness.",
        "Report settlement latency and responsiveness side by side.",
        "Do not claim a Worker win merely because the longest main-thread task is smaller.",
        "Do not claim a latency win unless the measured completion result is also lower.",
        "Preserve unfavorable results.",
        "Attribute any advantage to Worker execution, cache reuse, prewarming, cancellation of stale prefixes, or a combination — never mix preparation into primed or repeated-query latency.",
        "Do not market cache producers as Worker executions.",
      ],
    },
    comparisons: [
      {
        id: "workerIsolatedVsForcedMainThread" as const,
        leftIdentity: "workerIsolated",
        rightIdentity: "forcedMainThread",
        leftIsCompetitor: true,
        rightIsCompetitor: false,
        note: "Same LightFastGrid algorithm; only execution.thresholds.quickSearch differs. Forced main thread is not a competitor.",
      },
      {
        id: "workerIsolatedVsAgGrid" as const,
        leftIdentity: "workerIsolated",
        rightIdentity: "agGrid",
        leftIsCompetitor: true,
        rightIsCompetitor: true,
        note: "LFG Worker isolated versus the single optimized AG Grid baseline for the same scenario identity. Never reuse a repeated-query AG sample as the cold-typing result.",
      },
      {
        id: "productionOptimizedVsAgGrid" as const,
        leftIdentity: "workerProductionOptimized",
        rightIdentity: "agGrid",
        leftIsCompetitor: true,
        rightIsCompetitor: true,
        note: "LFG recommended production config (cache and prewarm on) versus the same AG Grid baseline for the same scenario identity.",
      },
    ],
    lanes,
  };
  const mergedReasons = collectQuickSearchComparisonReasons(comparison);
  return {
    ...comparison,
    provisionalReasons: mergedReasons,
    provisional: mergedReasons.length > 0,
  };
}

const FILTER_OPERATIONS = [
  "filterTextApply",
  "filterTextClear",
  "filterNumberRangeApply",
  "filterNumberRangeClear",
  "filterCombinedApply",
  "filterCombinedClear",
  "filterTypingBurst",
] as const;

const FILTER_SCENARIO_BY_OPERATION: Record<(typeof FILTER_OPERATIONS)[number], string> = {
  filterTextApply: "textApply",
  filterTextClear: "textClear",
  filterNumberRangeApply: "numberRangeApply",
  filterNumberRangeClear: "numberRangeClear",
  filterCombinedApply: "combinedApply",
  filterCombinedClear: "combinedClear",
  filterTypingBurst: "typingBurst",
};

function filterLaneTable(
  lane: "react" | "vanilla",
  samples: readonly ModeSample[],
  requireCdpWorkerThrottle: boolean,
): FilterModeComparisonLane {
  const lfg = lane === "react" ? "lightfastgrid" : "lightfastgrid-vanilla";
  const ag = lane === "react" ? "ag-grid" : "ag-grid-vanilla";
  const pair = (operation: (typeof FILTER_OPERATIONS)[number]) => {
    const scenarioId = FILTER_SCENARIO_BY_OPERATION[operation];
    const clear = isFilterClearOperation(operation);
    const lfgNotes = [
      "Canonical LightFastGrid identity for ordinary competitive operations. Quick Search modes do not contribute these samples.",
    ];
    if (clear) {
      lfgNotes.push(
        "Filter Clear does not schedule Filter execution. Latency and correctness are recorded; producer and Worker claims are not applicable.",
      );
    }
    return {
      lightfastgrid: cell(
        scenarioId,
        `${lfg}/productDefault`,
        "productDefault",
        "LFG product default",
        true,
        selectCompetitive(samples, lfg, operation, scenarioId),
        "durationMs",
        lfgNotes,
        requireCdpWorkerThrottle,
        !clear,
      ),
      agGrid: cell(
        scenarioId,
        ag,
        "agGridBaseline",
        "AG Grid",
        true,
        selectCompetitive(samples, ag, operation, scenarioId),
        "durationMs",
        [
          "This harness observes AG Grid's public filterChanged lifecycle and does not invent a Worker producer.",
          ...(clear
            ? [
                "Filter Clear does not schedule Filter execution. Latency and correctness are recorded; producer and Worker claims are not applicable.",
              ]
            : []),
        ],
        false,
        !clear,
      ),
    };
  };
  return {
    lane,
    filterTextApply: pair("filterTextApply"),
    filterTextClear: pair("filterTextClear"),
    filterNumberRangeApply: pair("filterNumberRangeApply"),
    filterNumberRangeClear: pair("filterNumberRangeClear"),
    filterCombinedApply: pair("filterCombinedApply"),
    filterCombinedClear: pair("filterCombinedClear"),
    filterTypingBurst: pair("filterTypingBurst"),
  };
}

export function collectFilterComparisonReasons(comparison: FilterModeComparison): string[] {
  const reasons: string[] = [...comparison.provisionalReasons];
  for (const lane of [comparison.lanes.react, comparison.lanes.vanilla]) {
    for (const [name, pair] of Object.entries(lane)) {
      if (name === "lane") continue;
      const cells = pair as { lightfastgrid: ModeComparisonCell; agGrid: ModeComparisonCell };
      for (const item of [cells.lightfastgrid, cells.agGrid]) {
        for (const reason of item.provisionalReasons) {
          if (!reasons.includes(reason)) reasons.push(reason);
        }
      }
    }
  }
  return reasons;
}

export function collectDuplicateWeightingReasons(samples: readonly ModeSample[]): string[] {
  const reasons: string[] = [];
  const ordinary = new Set([
    "mount",
    "sort",
    "filterTextApply",
    "filterTextClear",
    "filterNumberRangeApply",
    "filterNumberRangeClear",
    "filterCombinedApply",
    "filterCombinedClear",
    "filterTypingBurst",
    "clearOperations",
    "scrollTo",
  ]);
  const quickSearch = new Set([
    "quickSearch",
    "quickSearchPrimedDifferent",
    "quickSearchRepeatedSame",
    "quickSearchTypingBurst",
    "quickSearchTypingSettled",
  ]);
  const scenariosByMeasurement = new Map<string, Set<string>>();
  for (const sample of samples) {
    if (sample.role !== "measured") continue;
    if (
      sample.valid &&
      typeof sample.durationMs === "number" &&
      sample.lane != null &&
      sample.round != null &&
      sample.slotIndex != null
    ) {
      // A duration is a result, not a sample identity: independent browser rounds
      // can legitimately settle on the same timer value. Use the schedule-owned
      // coordinates to detect one physical measurement assigned to two scenarios.
      const measurementKey = [
        sample.lane,
        sample.appId,
        sample.purpose ?? "",
        sample.lfgMode ?? "",
        sample.round,
        sample.slotIndex,
        sample.warmupAttempt ?? "",
        sample.operation,
      ].join(":");
      const scenarios = scenariosByMeasurement.get(measurementKey) ?? new Set<string>();
      scenarios.add(sample.scenarioId ?? "");
      scenariosByMeasurement.set(measurementKey, scenarios);
      if (scenarios.size > 1) {
        const reason = "A measured sample was reused under more than one scenario identity";
        if (!reasons.includes(reason)) reasons.push(reason);
      }
    }
    if (
      sample.appId.includes("lightfastgrid") &&
      ordinary.has(String(sample.operation)) &&
      sample.lfgMode != null
    ) {
      const reason =
        "Ordinary competitive operations must not be recorded on Quick Search mode slots";
      if (!reasons.includes(reason)) reasons.push(reason);
    }
    if (
      sample.appId.includes("lightfastgrid") &&
      quickSearch.has(String(sample.operation)) &&
      sample.purpose === "competitive"
    ) {
      const reason =
        "Quick Search operations must not be pooled into the canonical competitive identity";
      if (!reasons.includes(reason)) reasons.push(reason);
    }
    if (
      ordinary.has(String(sample.operation)) &&
      sample.purpose === "quickSearch"
    ) {
      const reason = "Quick Search slots must not record Mount/Sort/Filter/Reset/Scroll samples";
      if (!reasons.includes(reason)) reasons.push(reason);
    }
    if (
      quickSearch.has(String(sample.operation)) &&
      sample.purpose === "competitive"
    ) {
      const reason = "Competitive slots must not record Quick Search samples";
      if (!reasons.includes(reason)) reasons.push(reason);
    }
  }
  return reasons;
}

export function buildFilterModeComparison(
  samples: readonly ModeSample[],
  workerThrottleConfirmed: boolean,
  extraProvisionalReasons: readonly string[] = [],
  options?: { readonly requireCdpWorkerThrottle?: boolean },
): FilterModeComparison {
  const requireCdpWorkerThrottle = options?.requireCdpWorkerThrottle === true;
  const duplicate = collectDuplicateWeightingReasons(samples);
  const provisionalReasons = [
    ...(workerThrottleConfirmed
      ? []
      : [
          "Equivalent CPU throttling of the Filter Worker target was not acknowledged. Worker-vs-main-thread Filter numbers are provisional and not a public competitive claim.",
        ]),
    ...duplicate,
    ...extraProvisionalReasons,
  ];
  const comparison: FilterModeComparison = {
    workerThrottleConfirmed,
    provisional: provisionalReasons.length > 0,
    provisionalReasons,
    interpretation: {
      workerIsNotAutomaticallyFaster: true,
      reportLatencyAndResponsivenessSideBySide: true,
      noWinnerField: true,
      canonicalProductIdentity: true,
      noDuplicateWeighting: true,
      agGridMeasuredOncePerScenario: true,
    },
    lanes: {
      react: filterLaneTable("react", samples, requireCdpWorkerThrottle),
      vanilla: filterLaneTable("vanilla", samples, requireCdpWorkerThrottle),
    },
  };
  const mergedReasons = collectFilterComparisonReasons(comparison);
  return {
    ...comparison,
    provisionalReasons: mergedReasons,
    provisional: mergedReasons.length > 0,
  };
}
