import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  isQuickSearchOnlyOperation,
} from "../../../shared/src/filterScenarios.ts";
import type { CpuThrottleResult } from "./cpuThrottle.ts";
import {
  formatHarnessFatalReason,
  rootHarnessFailure,
  type HarnessFailure,
} from "./harnessFailures.ts";
import type { RuntimeProfile } from "./profiles.ts";
import type { IterationOperationRecord } from "./workload.ts";
import type { ExpectedOperations } from "../../../shared/src/expectedOperations.ts";
import {
  P95_MIN_VALID_SAMPLES,
  RUNTIME_OPERATION_IDS,
  type FilterModeComparison,
  type QuickSearchModeComparison,
  type RuntimeSummaryJson,
} from "../metrics/schema.ts";
import { summarizeNumeric, summarizeObservers } from "../metrics/summarize.ts";
import {
  collectDuplicateWeightingReasons,
  collectFilterComparisonReasons,
  collectQuickSearchComparisonReasons,
  buildFilterModeComparison,
  buildQuickSearchModeComparison,
} from "../metrics/modeComparison.ts";
import { RAF_GAP_THRESHOLD_MS } from "../../../shared/src/benchmarkProtocol.ts";

export type RawSample = IterationOperationRecord & {
  readonly role: "warmup" | "measured";
  readonly warmupAttempt?: 0 | 1 | null;
  readonly lane: "react" | "vanilla";
  readonly appId: string;
  readonly round: number;
  readonly slotIndex: number;
};

export type ErrorRecord = {
  readonly lane: "react" | "vanilla" | null;
  readonly appId: string | null;
  readonly round: number | null;
  readonly slotIndex?: number | null;
  readonly lfgMode?: string | null;
  readonly warmupAttempt?: 0 | 1 | null;
  readonly operation: string | null;
  readonly code: string;
  readonly message: string;
  readonly role: "warmup" | "measured" | "harness";
  readonly phase?: string;
  readonly stack?: string | null;
  readonly secondary?: boolean;
  readonly recovered?: boolean;
};

function writeJson(directory: string, name: string, value: unknown): void {
  writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

function pushUnique(target: string[], reason: string): void {
  if (!target.includes(reason)) target.push(reason);
}

export function comparisonReasonsForPublication(
  comparison: QuickSearchModeComparison,
): string[] {
  return collectQuickSearchComparisonReasons(comparison);
}

export function filterComparisonReasonsForPublication(
  comparison: FilterModeComparison,
): string[] {
  return collectFilterComparisonReasons(comparison);
}

export function buildQuickSearchComparisonForRun(options: {
  readonly samples: readonly RawSample[];
  readonly workerThrottleConfirmed: boolean;
  readonly profile: RuntimeProfile;
}): QuickSearchModeComparison {
  const extra = [
    ...(options.profile.statisticsRole !== "public-candidate"
      ? ["Profile is diagnostic; Worker-vs-main-thread figures are not public claims."]
      : []),
    ...collectDuplicateWeightingReasons(options.samples),
  ];
  return buildQuickSearchModeComparison(options.samples, options.workerThrottleConfirmed, extra, {
    requireCdpWorkerThrottle: options.profile.cpuThrottlePolicy === "cdp-4x",
  });
}

export function buildFilterComparisonForRun(options: {
  readonly samples: readonly RawSample[];
  readonly workerThrottleConfirmed: boolean;
  readonly profile: RuntimeProfile;
}): FilterModeComparison {
  const extra = [
    ...(options.profile.statisticsRole !== "public-candidate"
      ? ["Profile is diagnostic; Worker-vs-main-thread figures are not public claims."]
      : []),
    ...collectDuplicateWeightingReasons(options.samples),
  ];
  return buildFilterModeComparison(options.samples, options.workerThrottleConfirmed, extra, {
    requireCdpWorkerThrottle: options.profile.cpuThrottlePolicy === "cdp-4x",
  });
}

export function resolveRunPublication(options: {
  readonly profile: RuntimeProfile;
  readonly complete: boolean;
  readonly dirtyWorktree: boolean;
  readonly harnessFailures: readonly HarnessFailure[];
  readonly publishableDeniedReasons: readonly string[];
  readonly fatalRunReasons: readonly string[];
  readonly quickSearchModeComparison?: QuickSearchModeComparison | null;
  readonly filterModeComparison?: FilterModeComparison | null;
}): {
  readonly complete: boolean;
  readonly publishable: boolean;
  readonly publishableDeniedReasons: string[];
  readonly fatalRunReasons: string[];
  readonly fatalReason: string | null;
} {
  const denied = [...options.publishableDeniedReasons];
  const fatal: string[] = [];
  const root = rootHarnessFailure(options.harnessFailures);
  const complete = options.complete && root == null;

  if (root) {
    const reason = formatHarnessFatalReason(root);
    pushUnique(denied, reason);
    pushUnique(fatal, reason);
  }
  for (const reason of options.fatalRunReasons) {
    pushUnique(denied, reason);
    pushUnique(fatal, reason);
  }

  let fatalReason: string | null = null;
  if (!complete) {
    fatalReason = fatal[0] ?? "run is incomplete";
    pushUnique(denied, fatalReason);
    pushUnique(fatal, fatalReason);
  }

  if (options.profile.statisticsRole !== "public-candidate") {
    pushUnique(denied, `${options.profile.id} profile is diagnostic, not a public timing candidate`);
  }
  if (options.dirtyWorktree && !denied.some((reason) => /dirty worktree/i.test(reason))) {
    denied.push("dirty worktree; figures are provisional");
  }

  if (options.quickSearchModeComparison) {
    if (options.quickSearchModeComparison.provisional) {
      pushUnique(denied, "quickSearchModeComparison.provisional is true; Worker-vs-main-thread figures are not a public claim");
    }
    for (const reason of comparisonReasonsForPublication(options.quickSearchModeComparison)) {
      pushUnique(denied, reason);
    }
  }

  if (options.filterModeComparison) {
    if (options.filterModeComparison.provisional) {
      pushUnique(denied, "filterModeComparison.provisional is true; Worker-vs-main-thread Filter figures are not a public claim");
    }
    for (const reason of filterComparisonReasonsForPublication(options.filterModeComparison)) {
      pushUnique(denied, reason);
    }
  }

  const publishable =
    complete &&
    denied.length === 0 &&
    fatal.length === 0 &&
    root == null &&
    options.fatalRunReasons.length === 0 &&
    options.quickSearchModeComparison?.provisional !== true &&
    options.filterModeComparison?.provisional !== true;

  return {
    complete,
    publishable,
    publishableDeniedReasons: denied,
    fatalRunReasons: fatal,
    fatalReason,
  };
}

export function writeOrchestratorCompleteMarker(
  runDir: string,
  payload: {
    readonly ok: boolean;
    readonly runId: string;
    readonly complete: boolean;
    readonly fatalRunReasons: readonly string[];
    readonly fatalReason: string | null;
  },
): void {
  writeJson(runDir, "orchestrator-complete.json", {
    ok: payload.ok === true && payload.complete === true,
    runId: payload.runId,
    fatalRunReasons: payload.fatalRunReasons,
    fatalReason: payload.fatalReason,
  });
}

export function writeRuntimeEvidence(options: {
  readonly runDir: string;
  readonly runId: string;
  readonly profile: RuntimeProfile;
  readonly expected: ExpectedOperations | null;
  readonly schedule: unknown;
  readonly environment: Record<string, unknown>;
  readonly methodology: Record<string, unknown>;
  readonly cpuThrottle: CpuThrottleResult;
  readonly samples: readonly RawSample[];
  readonly complete: boolean;
  readonly publishable: boolean;
  readonly publishableDeniedReasons: readonly string[];
  readonly fatalRunReasons: readonly string[];
  readonly fatalReason: string | null;
  readonly harnessFailures?: readonly HarnessFailure[];
  readonly quickSearchModeComparison?: QuickSearchModeComparison;
  readonly filterModeComparison?: FilterModeComparison;
}): RuntimeSummaryJson {
  mkdirSync(options.runDir, { recursive: true });
  const sampleErrors: ErrorRecord[] = options.samples
    .filter((sample) => !sample.valid)
    .map((sample) => ({
      lane: sample.lane,
      appId: sample.appId,
      round: sample.round,
      operation: sample.operation,
      code: sample.invalidReason ?? "protocol-error",
      message: sample.invalidMessage ?? "invalid sample",
      role: sample.role,
    }));
  const harnessErrors: ErrorRecord[] = (options.harnessFailures ?? []).map((failure) => ({
    lane: failure.lane,
    appId: failure.appId,
    round: failure.round,
    slotIndex: failure.slotIndex,
    lfgMode: failure.lfgMode ?? null,
    warmupAttempt: failure.warmupAttempt ?? null,
    operation: null,
    code: `harness-${failure.phase}`,
    message: failure.message,
    role: "harness",
    phase: failure.phase,
    stack: failure.stack,
    ...(failure.secondary === true ? { secondary: true } : {}),
    ...(failure.recovered === true ? { recovered: true } : {}),
  }));
  const errors = [...sampleErrors, ...harnessErrors];

  const lanes = {
    react: { lane: "react" as const, applications: {} as RuntimeSummaryJson["lanes"]["react"]["applications"] },
    vanilla: { lane: "vanilla" as const, applications: {} as RuntimeSummaryJson["lanes"]["vanilla"]["applications"] },
  };

  let p95HasSufficientSamples = options.profile.statisticsRole === "public-candidate";

  for (const appId of [
    "lightfastgrid",
    "ag-grid",
    "lightfastgrid-vanilla",
    "ag-grid-vanilla",
  ]) {
    const lane = appId.includes("vanilla") ? "vanilla" : "react";
    const usesPurpose = options.samples.some((sample) => sample.purpose != null);
    const appSamples = options.samples.filter((sample) => {
      if (sample.appId !== appId) return false;
      const qsOp = isQuickSearchOnlyOperation(sample.operation);
      if (usesPurpose) {
        if (qsOp) {
          if (sample.purpose !== "quickSearch") return false;
          if (appId.includes("lightfastgrid")) return sample.lfgMode === "workerIsolated";
          return true;
        }
        if (sample.purpose !== "competitive") return false;
        if (appId.includes("lightfastgrid")) return sample.lfgMode == null;
        return true;
      }
      if (!appId.includes("lightfastgrid")) return true;
      const tagged = options.samples.some(
        (entry) => entry.appId === appId && entry.lfgMode === "workerIsolated",
      );
      if (qsOp) {
        if (tagged) return sample.lfgMode === "workerIsolated";
        return sample.lfgMode == null || sample.lfgMode === "workerIsolated";
      }
      if (tagged) return sample.lfgMode == null;
      return sample.lfgMode == null || sample.lfgMode === "workerIsolated";
    });
    const operations = Object.fromEntries(
      RUNTIME_OPERATION_IDS.map((operation) => {
        const operationSamples = appSamples.filter((sample) => sample.operation === operation);
        const attemptedMeasured = operationSamples.filter((sample) => sample.role === "measured");
        const validMeasured = attemptedMeasured.filter(
          (sample) => sample.valid && typeof sample.durationMs === "number",
        );
        const invalidMeasured = attemptedMeasured.filter((sample) => !sample.valid);
        const durations = validMeasured.map((sample) => sample.durationMs as number);
        const p95SampleCountEligible =
          options.profile.statisticsRole === "public-candidate" &&
          durations.length >= P95_MIN_VALID_SAMPLES;
        if (attemptedMeasured.length > 0 && !p95SampleCountEligible) p95HasSufficientSamples = false;
        return [
          operation,
          {
            operation,
            validSampleCount: validMeasured.length,
            invalidSampleCount: invalidMeasured.length,
            statisticsRole: options.profile.statisticsRole,
            p95SampleCountEligible,
            primaryMetric: "median durationMs of protocol settlement" as const,
            summary: durations.length > 0 ? summarizeNumeric(durations) : null,
            observers: summarizeObservers(validMeasured),
          },
        ];
      }),
    );
    lanes[lane].applications[appId] = {
      appId,
      lane,
      operations: operations as RuntimeSummaryJson["lanes"]["react"]["applications"][string]["operations"],
    };
  }

  if (options.profile.statisticsRole !== "public-candidate") {
    p95HasSufficientSamples = false;
  }

  const methodology = {
    ...options.methodology,
    complete: options.complete,
    intendsPublicCandidateStatistics: options.profile.statisticsRole === "public-candidate",
    p95HasSufficientSamples,
  };

  const extraComparisonReasons = [
    ...(options.profile.statisticsRole !== "public-candidate"
      ? ["Profile is diagnostic; Worker-vs-main-thread figures are not public claims."]
      : []),
    ...collectDuplicateWeightingReasons(options.samples),
  ];
  const quickSearchModeComparison =
    options.quickSearchModeComparison ??
    buildQuickSearchModeComparison(
      options.samples,
      options.cpuThrottle.workerThrottle.confirmedEquivalentToPage === true,
      extraComparisonReasons,
      { requireCdpWorkerThrottle: options.profile.cpuThrottlePolicy === "cdp-4x" },
    );
  const filterModeComparison =
    options.filterModeComparison ??
    buildFilterModeComparison(
      options.samples,
      options.cpuThrottle.workerThrottle.confirmedEquivalentToPage === true,
      extraComparisonReasons,
      { requireCdpWorkerThrottle: options.profile.cpuThrottlePolicy === "cdp-4x" },
    );

  const summary: RuntimeSummaryJson = {
    generatedAt: new Date().toISOString(),
    runId: options.runId,
    profile: options.profile.id,
    complete: options.complete,
    publishable: options.publishable,
    publishableDeniedReasons: options.publishableDeniedReasons,
    fatalRunReasons: options.fatalRunReasons,
    fatalReason: options.fatalReason,
    methodology,
    environment: options.environment,
    cpuThrottle: options.cpuThrottle,
    quickSearchModeComparison,
    filterModeComparison,
    lanes,
  };

  writeJson(options.runDir, "summary.json", summary);
  writeJson(options.runDir, "raw-samples.json", {
    samples: options.samples,
    note: "Warmup samples are included with role=warmup and must be excluded from published statistics. Partial runs may contain fewer samples.",
    complete: options.complete,
  });
  writeJson(options.runDir, "environment.json", options.environment);
  writeJson(options.runDir, "methodology.json", methodology);
  writeJson(options.runDir, "errors.json", { errors, harnessFailures: options.harnessFailures ?? [] });
  writeJson(options.runDir, "schedule.json", options.schedule);
  if (options.expected) {
    writeJson(options.runDir, "expected-state.json", {
      ...options.expected,
      sort: {
        ...options.expected.sort,
        representativeRowCount: options.expected.sort.representativeRowIds.length,
      },
    });
  }
  writeJson(options.runDir, "secondary-observers.json", {
    rafGapThresholdMs: RAF_GAP_THRESHOLD_MS,
    rafGapNote:
      "rAF gaps over the threshold are scheduling delays, not dropped frames.",
  });
  return summary;
}

export function writeRuntimeEvidenceSafely(
  options: Parameters<typeof writeRuntimeEvidence>[0],
): { summary: RuntimeSummaryJson | null; writeError: unknown } {
  try {
    return { summary: writeRuntimeEvidence(options), writeError: null };
  } catch (error) {
    try {
      mkdirSync(options.runDir, { recursive: true });
      writeJson(options.runDir, "errors.json", {
        errors: [
          {
            lane: null,
            appId: null,
            round: null,
            operation: null,
            code: "harness-evidence-write",
            message: error instanceof Error ? error.message : String(error),
            role: "harness",
            phase: "evidence-write",
            stack: error instanceof Error ? error.stack ?? null : null,
          },
        ],
        harnessFailures: options.harnessFailures ?? [],
        originalFatalReason: options.fatalReason,
      });
    } catch {
      // Preserve the original benchmark error even if this fallback write fails.
    }
    return { summary: null, writeError: error };
  }
}
