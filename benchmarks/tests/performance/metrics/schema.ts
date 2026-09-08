import type { GridBenchmarkRuntimeSample } from "../../../shared/src/benchmarkProtocol.ts";
import { RAF_GAP_THRESHOLD_MS } from "../../../shared/src/benchmarkProtocol.ts";
import type { CpuThrottleResult } from "../fixtures/cpuThrottle.ts";
import type { InvalidSampleCode } from "../fixtures/correctness.ts";
import type { RuntimeProfileId } from "../fixtures/profiles.ts";
import type { NumericSummary, SecondaryObserverSummary } from "./summarize.ts";

export const RUNTIME_OPERATION_IDS = [
  "mount",
  "sort",
  "filterTextApply",
  "filterTextClear",
  "filterNumberRangeApply",
  "filterNumberRangeClear",
  "filterCombinedApply",
  "filterCombinedClear",
  "filterTypingBurst",
  "quickSearch",
  "quickSearchPrimedDifferent",
  "quickSearchRepeatedSame",
  "quickSearchTypingBurst",
  "quickSearchTypingSettled",
  "scrollTo",
  "clearOperations",
] as const;

export type RuntimeOperationId = (typeof RUNTIME_OPERATION_IDS)[number];

export type RuntimeVisibleState = {
  readonly displayedRowCount: number;
  readonly renderedRowCount: number;
  readonly firstRenderedRowId: string | null;
  readonly lastRenderedRowId: string | null;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly columnCount: number;
};

export const P95_MIN_VALID_SAMPLES = 10;

export type RuntimeOperationSummary = {
  readonly operation: RuntimeOperationId;
  readonly validSampleCount: number;
  readonly invalidSampleCount: number;
  readonly statisticsRole: "diagnostic" | "public-candidate";
  readonly p95SampleCountEligible: boolean;
  readonly primaryMetric: "median durationMs of protocol settlement";
  readonly summary: NumericSummary | null;
  readonly observers: SecondaryObserverSummary;
};

export type RuntimeAppSummary = {
  readonly appId: string;
  readonly lane: "react" | "vanilla";
  readonly operations: Record<RuntimeOperationId, RuntimeOperationSummary>;
};

export type RuntimeLaneSummary = {
  readonly lane: "react" | "vanilla";
  readonly applications: Record<string, RuntimeAppSummary>;
};

export type ModeComparisonCell = {
  readonly scenarioId: string;
  readonly identity: string;
  readonly modeId: string;
  readonly label: string;
  readonly competitor: boolean;
  readonly validSampleCount: number;
  readonly invalidSampleCount: number;
  readonly medianMs: number | null;
  readonly p95Ms: number | null;
  readonly p95SampleCountEligible: boolean;
  readonly uxMedianMs: number | null;
  readonly longestMainThreadTaskMs: number | null;
  readonly longTasksOver50CountSum: number | null;
  readonly producerDistribution: {
    readonly worker: number;
    readonly mainThread: number;
    readonly cache: number;
    readonly unknown: number;
    readonly none: number;
  };
  readonly workerRouteConfirmed: boolean | null;
  readonly workerThrottleProof: {
    readonly required: boolean;
    readonly confirmed: boolean;
    readonly acknowledgedAttemptCount: number;
    readonly attemptCount: number;
    readonly failureReason: string | null;
  };
  readonly correctnessState: {
    readonly valid: boolean;
    readonly invalidCodes: readonly string[];
  };
  readonly provisionalReasons: readonly string[];
  readonly notes: readonly string[];
};

export type QuickSearchModeComparisonLane = {
  readonly lane: "react" | "vanilla";
  readonly coldFullQuery: {
    readonly workerIsolated: ModeComparisonCell;
    readonly forcedMainThread: ModeComparisonCell;
    readonly productionOptimized: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
  readonly coldRealisticTyping: {
    readonly workerIsolated: ModeComparisonCell;
    readonly forcedMainThread: ModeComparisonCell;
    readonly productionOptimized: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
  readonly primedDifferentQuery: {
    readonly workerIsolated: ModeComparisonCell;
    readonly forcedMainThread: ModeComparisonCell;
    readonly productionOptimized: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
  readonly repeatedSameQuery: {
    readonly workerIsolated: ModeComparisonCell;
    readonly forcedMainThread: ModeComparisonCell;
    readonly productionOptimized: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
  readonly settledIncremental: {
    readonly workerIsolated: ModeComparisonCell;
    readonly forcedMainThread: ModeComparisonCell;
    readonly productionOptimized: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
  readonly responsiveness: {
    readonly workerIsolated: ModeComparisonCell;
    readonly forcedMainThread: ModeComparisonCell;
    readonly productionOptimized: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
};

export type QuickSearchModePairId =
  | "workerIsolatedVsForcedMainThread"
  | "workerIsolatedVsAgGrid"
  | "productionOptimizedVsAgGrid";

export type QuickSearchModePair = {
  readonly id: QuickSearchModePairId;
  readonly leftIdentity: string;
  readonly rightIdentity: string;
  readonly leftIsCompetitor: boolean;
  readonly rightIsCompetitor: boolean;
  readonly note: string;
};

export type QuickSearchModeComparison = {
  readonly workerThrottleConfirmed: boolean;
  readonly provisional: boolean;
  readonly provisionalReasons: readonly string[];
  readonly interpretation: {
    readonly workerIsNotAutomaticallyFaster: true;
    readonly reportLatencyAndResponsivenessSideBySide: true;
    readonly noWinnerField: true;
    readonly forcedMainThreadIsNotACompetitor: true;
    readonly noLatencyWinWithoutLowerCompletion: true;
    readonly noWorkerWinFromSmallerLongTaskAlone: true;
    readonly advantageAttribution: readonly string[];
  };
  readonly comparisons: readonly QuickSearchModePair[];
  readonly lanes: {
    readonly react: QuickSearchModeComparisonLane;
    readonly vanilla: QuickSearchModeComparisonLane;
  };
};

export type FilterModeComparisonLane = {
  readonly lane: "react" | "vanilla";
  readonly filterTextApply: {
    readonly lightfastgrid: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
  readonly filterTextClear: {
    readonly lightfastgrid: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
  readonly filterNumberRangeApply: {
    readonly lightfastgrid: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
  readonly filterNumberRangeClear: {
    readonly lightfastgrid: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
  readonly filterCombinedApply: {
    readonly lightfastgrid: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
  readonly filterCombinedClear: {
    readonly lightfastgrid: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
  readonly filterTypingBurst: {
    readonly lightfastgrid: ModeComparisonCell;
    readonly agGrid: ModeComparisonCell;
  };
};

export type FilterModeComparison = {
  readonly workerThrottleConfirmed: boolean;
  readonly provisional: boolean;
  readonly provisionalReasons: readonly string[];
  readonly interpretation: {
    readonly workerIsNotAutomaticallyFaster: true;
    readonly reportLatencyAndResponsivenessSideBySide: true;
    readonly noWinnerField: true;
    readonly canonicalProductIdentity: true;
    readonly noDuplicateWeighting: true;
    readonly agGridMeasuredOncePerScenario: true;
  };
  readonly lanes: {
    readonly react: FilterModeComparisonLane;
    readonly vanilla: FilterModeComparisonLane;
  };
};

export type RuntimeSummaryJson = {
  readonly generatedAt: string;
  readonly runId: string;
  readonly profile: RuntimeProfileId;
  readonly complete: boolean;
  readonly publishable: boolean;
  readonly publishableDeniedReasons: readonly string[];
  readonly fatalRunReasons?: readonly string[];
  readonly fatalReason: string | null;
  readonly methodology: Record<string, unknown>;
  readonly environment: Record<string, unknown>;
  readonly cpuThrottle: CpuThrottleResult;
  readonly quickSearchModeComparison?: QuickSearchModeComparison;
  readonly filterModeComparison?: FilterModeComparison;
  readonly lanes: {
    readonly react: RuntimeLaneSummary;
    readonly vanilla: RuntimeLaneSummary;
  };
};

export function assertNoWinner(value: unknown, label: string): void {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "winner")) {
    throw new Error(`${label} must not declare a winner or ranking`);
  }
}

export function assertNoPublicP95Claims(value: unknown, label: string): void {
  if (!value || typeof value !== "object") return;
  if (Object.prototype.hasOwnProperty.call(value, "publicP95")) {
    throw new Error(`${label} must not claim publicP95; publication permission is report-level publishable only`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPublicP95Claims(entry, `${label}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") {
      assertNoPublicP95Claims(child, `${label}.${key}`);
    }
  }
}

export function assertQuickSearchModeComparison(value: QuickSearchModeComparison): void {
  assertNoWinner(value, "quickSearchModeComparison");
  if (!value.interpretation?.noWinnerField) {
    throw new Error("quickSearchModeComparison.interpretation.noWinnerField must be true");
  }
  if (!value.interpretation.forcedMainThreadIsNotACompetitor) {
    throw new Error("forced main thread must not be presented as a competitor");
  }
  if (!value.interpretation.workerIsNotAutomaticallyFaster) {
    throw new Error("Worker execution is not automatically a lower completion-time result");
  }
  const requiredPairIds: QuickSearchModePairId[] = [
    "workerIsolatedVsForcedMainThread",
    "workerIsolatedVsAgGrid",
    "productionOptimizedVsAgGrid",
  ];
  const ids = new Set(value.comparisons.map((pair) => pair.id));
  for (const id of requiredPairIds) {
    if (!ids.has(id)) {
      throw new Error(`quickSearchModeComparison missing comparison ${id}`);
    }
  }
  for (const lane of ["react", "vanilla"] as const) {
    const tables = value.lanes[lane];
    if (tables.coldFullQuery.forcedMainThread.competitor) {
      throw new Error(`${lane} forced main thread must not be a competitor`);
    }
    if (tables.coldRealisticTyping.forcedMainThread.competitor) {
      throw new Error(`${lane} forced main thread must not be a competitor`);
    }
    if (tables.primedDifferentQuery.forcedMainThread.competitor) {
      throw new Error(`${lane} forced main thread must not be a competitor`);
    }
    if (tables.repeatedSameQuery.forcedMainThread.competitor) {
      throw new Error(`${lane} forced main thread must not be a competitor`);
    }
    if (tables.settledIncremental.forcedMainThread.competitor) {
      throw new Error(`${lane} forced main thread must not be a competitor`);
    }
    if (!tables.coldFullQuery.workerIsolated.competitor || !tables.coldFullQuery.agGrid.competitor) {
      throw new Error(`${lane} Worker isolated and AG Grid must remain comparison identities`);
    }
    if (tables.coldFullQuery.workerIsolated.scenarioId !== "coldFullQuery") {
      throw new Error(`${lane} coldFullQuery cells must retain scenario identity`);
    }
    if (tables.coldRealisticTyping.workerIsolated.scenarioId !== "coldRealisticTyping") {
      throw new Error(`${lane} coldRealisticTyping cells must retain scenario identity`);
    }
    if (tables.primedDifferentQuery.agGrid.scenarioId !== "primedDifferentQuery") {
      throw new Error(`${lane} primedDifferentQuery AG cells must not reuse another scenario identity`);
    }
    if (tables.repeatedSameQuery.agGrid.scenarioId !== "repeatedSameQuery") {
      throw new Error(`${lane} repeatedSameQuery AG cells must not reuse another scenario identity`);
    }
  }
}

export function assertFilterModeComparison(value: FilterModeComparison): void {
  assertNoWinner(value, "filterModeComparison");
  if (!value.interpretation?.noWinnerField) {
    throw new Error("filterModeComparison.interpretation.noWinnerField must be true");
  }
  if (!value.interpretation.canonicalProductIdentity) {
    throw new Error("filter comparison must use one canonical LightFastGrid identity");
  }
  if (!value.interpretation.noDuplicateWeighting) {
    throw new Error("filter comparison must not duplicate-weight Quick Search modes");
  }
  if (!value.interpretation.agGridMeasuredOncePerScenario) {
    throw new Error("AG Grid must be measured once per equivalent filter scenario");
  }
  for (const lane of ["react", "vanilla"] as const) {
    const tables = value.lanes[lane];
    for (const [name, pair] of Object.entries(tables)) {
      if (name === "lane") continue;
      const cells = pair as { lightfastgrid: ModeComparisonCell; agGrid: ModeComparisonCell };
      if (!cells.lightfastgrid?.competitor || !cells.agGrid?.competitor) {
        throw new Error(`${lane} ${name} must keep LightFastGrid and AG Grid as competitors`);
      }
      if (cells.lightfastgrid.modeId !== "productDefault") {
        throw new Error(`${lane} ${name} LightFastGrid filter identity must be productDefault`);
      }
      if (cells.agGrid.modeId !== "agGridBaseline") {
        throw new Error(`${lane} ${name} AG Grid filter identity must stay agGridBaseline`);
      }
      if (String(name).includes("Clear")) {
        if (cells.lightfastgrid.workerRouteConfirmed === true) {
          throw new Error(`${lane} ${name} must not confirm a Filter Worker route for Clear`);
        }
        if ((cells.lightfastgrid.producerDistribution?.worker ?? 0) > 0) {
          throw new Error(`${lane} ${name} must not treat Clear as Filter Worker evidence`);
        }
      }
    }
  }
}

export function assertRuntimeSummary(report: RuntimeSummaryJson): void {
  assertNoWinner(report, "runtime summary");
  assertNoPublicP95Claims(report, "runtime summary");
  if (typeof report.complete !== "boolean") {
    throw new Error("runtime summary.complete must be boolean");
  }
  if (report.publishable && !report.complete) {
    throw new Error("publishable: true requires complete: true");
  }
  if (report.fatalReason && report.publishable) {
    throw new Error("fatal reasons force publishable: false");
  }
  if (report.fatalRunReasons && report.fatalRunReasons.length > 0 && report.publishable) {
    throw new Error("fatal reasons force publishable: false");
  }
  if (report.methodology.buildMode !== "runtime") {
    throw new Error('runtime summary methodology.buildMode must be "runtime"');
  }
  if (report.methodology.browserName !== "chromium") {
    throw new Error("Phase 1 runtime summary must be Chromium-only");
  }
  if (!report.lanes.react || !report.lanes.vanilla) {
    throw new Error("runtime summary must include independent react and vanilla lanes");
  }
  if (report.lanes.react.lane !== "react" || report.lanes.vanilla.lane !== "vanilla") {
    throw new Error("runtime lanes must not be mixed");
  }
  if (report.quickSearchModeComparison) {
    assertQuickSearchModeComparison(report.quickSearchModeComparison);
  }
  if (report.filterModeComparison) {
    assertFilterModeComparison(report.filterModeComparison);
  }
  const required = {
    react: ["lightfastgrid", "ag-grid"],
    vanilla: ["lightfastgrid-vanilla", "ag-grid-vanilla"],
  } as const;
  for (const [lane, ids] of Object.entries(required)) {
    const applications = report.lanes[lane as "react" | "vanilla"].applications;
    for (const id of ids) {
      if (!applications[id]) {
        throw new Error(`runtime summary missing ${lane} application ${id}`);
      }
      if (applications[id]!.lane !== lane) {
        throw new Error(`${id} is recorded under ${lane} but app.lane is ${applications[id]!.lane}`);
      }
    }
    for (const id of Object.keys(applications)) {
      if (!(ids as readonly string[]).includes(id)) {
        throw new Error(`runtime summary has unexpected ${lane} application ${id}`);
      }
    }
  }
}

export function assertMergedRuntimeReport(report: RuntimeSummaryJson): void {
  assertRuntimeSummary(report);
  const throttle = report.cpuThrottle;
  if (report.profile === "publish-native") {
    if (throttle.requestedRate !== 1) {
      throw new Error(`publish-native cpuThrottle.requestedRate must be 1, got ${throttle.requestedRate}`);
    }
    if (throttle.appliedRate !== 1) {
      throw new Error(`publish-native cpuThrottle.appliedRate must be 1, got ${throttle.appliedRate}`);
    }
    if (throttle.cdpThrottleApplied === true) {
      throw new Error("publish-native must not apply CDP CPU throttling to the page or Worker");
    }
  } else if (throttle.requestedRate !== 4) {
    throw new Error(`cpuThrottle.requestedRate must be 4, got ${throttle.requestedRate}`);
  }
  if (typeof throttle.cdpAvailable !== "boolean") {
    throw new Error("cpuThrottle.cdpAvailable must be recorded");
  }
  if (report.profile !== "publish-native" && throttle.appliedRate !== 4 && throttle.failureReason == null) {
    throw new Error("cpuThrottle must record failureReason when 4x was not applied");
  }
  if (!throttle.workerThrottle || typeof throttle.workerThrottle.confirmedEquivalentToPage !== "boolean") {
    throw new Error("cpuThrottle.workerThrottle.confirmedEquivalentToPage must be recorded");
  }
  if (!report.quickSearchModeComparison) {
    throw new Error("merged runtime report must include quickSearchModeComparison tables");
  }
  assertQuickSearchModeComparison(report.quickSearchModeComparison);
  if (!report.filterModeComparison) {
    throw new Error("merged runtime report must include filterModeComparison tables");
  }
  assertFilterModeComparison(report.filterModeComparison);
  const environment = report.environment;
  const requiredEnv = [
    "git",
    "os",
    "cpu",
    "memory",
    "node",
    "pnpm",
    "browser",
    "packages",
    "profile",
    "viewport",
    "headless",
    "rowCount",
    "columnCount",
    "warmupRounds",
    "measuredRounds",
    "deterministicSeed",
    "playwright",
    "cpuThrottle",
  ];
  for (const key of requiredEnv) {
    if (environment[key] == null) {
      throw new Error(`merged runtime environment is missing ${key}`);
    }
  }
  const git = environment.git as { commit?: unknown; dirtyWorktree?: unknown } | undefined;
  if (!git || typeof git.commit !== "string" || typeof git.dirtyWorktree !== "boolean") {
    throw new Error("merged runtime environment.git must include commit and dirtyWorktree");
  }
  const browser = environment.browser as { name?: unknown; version?: unknown } | undefined;
  if (!browser || browser.name !== "chromium" || typeof browser.version !== "string") {
    throw new Error("merged runtime environment.browser must record Chromium version");
  }
  const playwright = environment.playwright as { version?: unknown } | undefined;
  if (!playwright || typeof playwright.version !== "string") {
    throw new Error("merged runtime environment.playwright.version must be recorded after merge");
  }
  if (typeof report.methodology.provisional !== "boolean") {
    throw new Error("merged methodology.provisional must be set after environment merge");
  }
  if (typeof report.methodology.intendsPublicCandidateStatistics !== "boolean") {
    throw new Error("merged methodology.intendsPublicCandidateStatistics must be recorded");
  }
  if (typeof report.methodology.p95HasSufficientSamples !== "boolean") {
    throw new Error("merged methodology.p95HasSufficientSamples must be recorded");
  }
  if (report.methodology.intendsPublicCandidateStatistics && report.profile !== "publish" && report.profile !== "publish-native") {
    throw new Error("only publish and publish-native profiles may intend public-candidate statistics");
  }
  if (report.profile !== "publish" && report.profile !== "publish-native" && report.methodology.p95HasSufficientSamples) {
    throw new Error("smoke and trace runs cannot expose public P95 sample eligibility");
  }
  if (report.publishable && report.profile !== "publish" && report.profile !== "publish-native") {
    throw new Error("only a complete publish or publish-native profile may be publishable");
  }
  if (report.environment.git && (report.environment.git as { dirtyWorktree?: unknown }).dirtyWorktree === true) {
    if (report.publishable) {
      throw new Error("dirty/provisional runs cannot be publishable");
    }
  }
  if (report.methodology.provisional === true && report.publishable) {
    throw new Error("provisional runs cannot be publishable");
  }
  for (const lane of ["react", "vanilla"] as const) {
    for (const app of Object.values(report.lanes[lane].applications)) {
      for (const operation of Object.values(app.operations)) {
        const longTask = operation.observers.longTask;
        if (longTask.supportedSampleCount === 0 && longTask.maxMs !== null) {
          throw new Error(`${app.appId} ${operation.operation} unsupported long-task must not appear as a numeric zero`);
        }
        const heap = operation.observers.heap;
        if (heap.supportedSampleCount === 0 && heap.maxUsedBytes !== null) {
          throw new Error(`${app.appId} ${operation.operation} unsupported heap must not appear as a numeric zero`);
        }
        const raf = operation.observers.rafGaps;
        if (raf.supportedSampleCount === 0 && raf.maxMs !== null) {
          throw new Error(`${app.appId} ${operation.operation} unsupported rAF gaps must not appear as a numeric zero`);
        }
        if (report.profile === "smoke" && operation.p95SampleCountEligible) {
          throw new Error("smoke statistics must not set p95SampleCountEligible");
        }
        if (report.profile === "trace" && operation.p95SampleCountEligible) {
          throw new Error("trace statistics must not set p95SampleCountEligible");
        }
        if (operation.p95SampleCountEligible && operation.validSampleCount < P95_MIN_VALID_SAMPLES) {
          throw new Error(
            `${app.appId} ${operation.operation} cannot be p95SampleCountEligible with ${operation.validSampleCount} valid samples`,
          );
        }
        if (operation.p95SampleCountEligible && operation.statisticsRole !== "public-candidate") {
          throw new Error(`${app.appId} ${operation.operation} p95SampleCountEligible requires public-candidate statisticsRole`);
        }
        if (Object.prototype.hasOwnProperty.call(operation, "publicP95")) {
          throw new Error(`${app.appId} ${operation.operation} must not claim publicP95`);
        }
      }
    }
  }
  if (report.publishable && !report.quickSearchModeComparison.workerThrottleConfirmed) {
    throw new Error(
      "publishable reports cannot claim Worker-vs-main-thread numbers without confirmed Worker CPU throttling",
    );
  }
  if (report.publishable && report.quickSearchModeComparison.provisional) {
    throw new Error(
      "publishable: true is incompatible with quickSearchModeComparison.provisional: true",
    );
  }
  if (report.publishable && report.filterModeComparison.provisional) {
    throw new Error(
      "publishable: true is incompatible with filterModeComparison.provisional: true",
    );
  }
}

export function fatalPublishReasons(report: RuntimeSummaryJson): readonly string[] {
  if (!report.complete) {
    return [report.fatalReason ?? "run is incomplete", ...(report.fatalRunReasons ?? [])];
  }
  if (report.fatalRunReasons && report.fatalRunReasons.length > 0) {
    return report.fatalRunReasons;
  }
  return report.publishableDeniedReasons.filter(
    (reason) =>
      !/dirty worktree|diagnostic, not a public|trace mode changes performance|Worker CPU throttl|Worker target|Worker-vs-main-thread|quickSearchModeComparison\.provisional|not a Worker-performance claim|equivalent Worker CPU throttling was not acknowledged|Native 1x/i.test(
        reason,
      ),
  );
}

export function assertPublishableThrottle(
  report: RuntimeSummaryJson,
): void {
  if (report.profile === "publish") {
    if (report.cpuThrottle.appliedRate !== 4 || !report.cpuThrottle.cdpAvailable) {
      throw new Error(
        `publish profile requires 4x CDP CPU throttling; appliedRate=${report.cpuThrottle.appliedRate} reason=${report.cpuThrottle.failureReason}`,
      );
    }
    return;
  }
  if (report.profile === "publish-native") {
    if (report.cpuThrottle.requestedRate !== 1 || report.cpuThrottle.appliedRate !== 1) {
      throw new Error(
        `publish-native profile requires native 1x with no CDP throttle; requestedRate=${report.cpuThrottle.requestedRate} appliedRate=${report.cpuThrottle.appliedRate}`,
      );
    }
    if (report.cpuThrottle.cdpThrottleApplied === true) {
      throw new Error("publish-native must not apply CDP CPU throttling");
    }
  }
}

export type ObserverSample = GridBenchmarkRuntimeSample;
export type SampleInvalidCode = InvalidSampleCode;
export { RAF_GAP_THRESHOLD_MS };
