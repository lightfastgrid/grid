import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type BrowserContext } from "@playwright/test";

import { computeExpectedOperations } from "../../../shared/src/expectedOperations.ts";
import { assertCanonicalPublicScenario } from "../../../shared/src/canonicalPublicScenario.ts";
import { applyCpuThrottling, equalComputeConfirmed, mergeThrottleResults, workerThrottleRequiredForSlot, type CpuThrottleResult } from "../fixtures/cpuThrottle.ts";
import {
  buildFilterComparisonForRun,
  buildQuickSearchComparisonForRun,
  resolveRunPublication,
  writeOrchestratorCompleteMarker,
  writeRuntimeEvidenceSafely,
  type RawSample,
} from "../fixtures/evidence.ts";
import {
  failAfterEvidenceWrite,
  formatHarnessFatalReason,
  harnessFailureFrom,
  harnessPhaseOf,
  markSlotFailuresRecovered,
  rootHarnessFailure,
  type HarnessFailure,
  type HarnessPhase,
} from "../fixtures/harnessFailures.ts";
import { attachPageGuards } from "../fixtures/pageGuards.ts";
import { startRuntimePreview, stopAllOwnedProcesses } from "../fixtures/previewServer.ts";
import { isPublicCandidateProfile, resolveRuntimeProfile } from "../fixtures/profiles.ts";
import { readMeta, waitForProtocol } from "../fixtures/protocolClient.ts";
import { buildRuntimeSchedule, requiredOperationsForPurpose, type ScheduleSlot } from "../fixtures/schedule.ts";
import {
  acquireOwnedContext,
  closeOwnedContext,
  runOwnedSlot,
} from "../fixtures/slotLifecycle.ts";
import { runIteration } from "../fixtures/workload.ts";
import { unexpectedInvalidMeasuredReasons } from "../fixtures/correctness.ts";
import {
  isFilterClearOperation,
  ORDINARY_COMPETITIVE_OPERATIONS,
  QUICK_SEARCH_ONLY_OPERATIONS,
} from "../../../shared/src/filterScenarios.ts";
import {
  collectWarmupPublicationReasons,
  nextWarmupDecision,
  shouldRetryWarmup,
  warmupAttemptSucceeded,
} from "../fixtures/warmupRetry.ts";

test.describe.configure({ mode: "serial" });

test("interleaved runtime protocol measurement", async ({ browser }) => {
  const profile = resolveRuntimeProfile();
  const runDir = process.env.LFG_BENCH_RUN_DIR;
  const runId = process.env.LFG_BENCH_RUN_ID;
  if (!runDir || !runId) {
    throw new Error("LFG_BENCH_RUN_DIR and LFG_BENCH_RUN_ID must be set by run-runtime.mjs");
  }

  test.setTimeout(isPublicCandidateProfile(profile.id) ? 3_600_000 : 2_400_000);

  const harnessFailures: HarnessFailure[] = [];
  const samples: RawSample[] = [];
  const throttleResults: CpuThrottleResult[] = [];
  let browserUserAgent: string | null = null;
  let expected = null as ReturnType<typeof computeExpectedOperations> | null;
  let schedule: ReturnType<typeof buildRuntimeSchedule> | null = null;
  let tracingCompleted = false;
  let tracingIncomplete = false;
  let runError: unknown = null;
  let complete = false;
  let context: BrowserContext | null = null;
  const current: {
    lane: "react" | "vanilla" | null;
    appId: string | null;
    round: number | null;
    slotIndex: number | null;
    lfgMode: string | null;
    purpose: "competitive" | "quickSearch" | null;
    warmupAttempt: 0 | 1 | null;
    phase: HarnessPhase | null;
  } = {
    lane: null,
    appId: null,
    round: null,
    slotIndex: null,
    lfgMode: null,
    purpose: null,
    warmupAttempt: null,
    phase: null,
  };

  const recordFailure = (
    phase: HarnessPhase,
    error: unknown,
    options?: { secondary?: boolean },
  ) => {
    harnessFailures.push(
      harnessFailureFrom(error, {
        phase,
        lane: current.lane,
        appId: current.appId,
        round: current.round,
        slotIndex: current.slotIndex,
        lfgMode: current.lfgMode,
        warmupAttempt: current.warmupAttempt,
        secondary: options?.secondary,
      }),
    );
  };

  try {
    current.phase = "context-create";
    context = await acquireOwnedContext(
      () =>
        browser.newContext({
          viewport: { width: 1280, height: 720 },
        }),
      recordFailure,
    );
    const browserContext = context;

    current.phase = "preparation";
    expected = computeExpectedOperations(profile.scenario);
    assertCanonicalPublicScenario(profile.id, {
      name: profile.scenario,
      rowCount: expected.rowCount,
      columnCount: expected.columnCount,
    });
    schedule = buildRuntimeSchedule(profile.warmupRounds, profile.measuredRounds);
    const traceSlot =
      profile.tracing
        ? schedule.lanes.react.slots.find(
            (slot) =>
              slot.role === "measured" &&
              slot.appId === "lightfastgrid" &&
              slot.lfgMode === "workerIsolated",
          )
        : null;

    let warmupRetryExhausted = false;

    const runScheduledSlot = async (slot: ScheduleSlot, slotIndex: number, warmupAttempt: 0 | 1) => {
      current.lane = slot.lane;
      current.appId = slot.appId;
      current.round = slot.round;
      current.slotIndex = slotIndex;
      current.lfgMode = slot.lfgMode ?? null;
      current.purpose = slot.purpose;
      current.warmupAttempt = slot.role === "warmup" ? warmupAttempt : null;
      const isTraceSlot =
        Boolean(traceSlot) &&
        warmupAttempt === 0 &&
        slot.lane === traceSlot?.lane &&
        slot.appId === traceSlot.appId &&
        slot.round === traceSlot.round &&
        slot.lfgMode === traceSlot.lfgMode;
      const samplesBefore = samples.length;
      await runOwnedSlot({
        setPhase: (phase) => {
          current.phase = phase;
        },
        startPreview: () => startRuntimePreview(slot.appId),
        createPage: async () => {
          const page = await browserContext.newPage();
          page.setDefaultTimeout(profile.protocolTimeoutMs + 10_000);
          return page;
        },
        attachGuards: (page) => attachPageGuards(page),
        startTracing: isTraceSlot
          ? async () => {
              await browserContext.tracing.start({
                screenshots: true,
                snapshots: true,
                sources: false,
              });
            }
          : undefined,
        stopTracing: isTraceSlot
          ? async (incomplete) => {
              await browserContext.tracing.stop({
                path: join(runDir, incomplete ? "trace.incomplete.zip" : "trace.zip"),
              });
            }
          : undefined,
        hasPrimaryFailure: () => Boolean(rootHarnessFailure(harnessFailures)),
        recordFailure,
        onTracingState: (state) => {
          if (isTraceSlot) {
            tracingCompleted = state.tracingCompleted;
            tracingIncomplete = state.tracingIncomplete;
          }
        },
        work: async ({ preview, page, guards }) => {
          current.phase = "navigation";
          try {
            const modeQuery = slot.lfgMode ? `&lfgQuickSearchMode=${slot.lfgMode}` : "";
            const origin = `${preview.origin}/?protocolTimeoutMs=${profile.protocolTimeoutMs}${modeQuery}`;
            await page.goto(origin, { waitUntil: "domcontentloaded" });
          } catch (error) {
            recordFailure("navigation", error);
            throw error;
          }

          current.phase = "protocol-discovery";
          try {
            await waitForProtocol(page, profile.protocolTimeoutMs);
            const meta = await readMeta(page);
            expect(meta.appId).toBe(slot.appId);
            expect(meta.lane).toBe(slot.lane);
            browserUserAgent = await page.evaluate(() => navigator.userAgent);
            const hostCount = await page.locator("[data-benchmark-host]").count();
            expect(hostCount).toBeLessThanOrEqual(1);
          } catch (error) {
            recordFailure("protocol-discovery", error);
            throw error;
          }

          current.phase = "throttling";
          let throttleHandle;
          try {
            throttleHandle = await applyCpuThrottling(page, profile.cpuThrottleRate, {
              workerThrottleRequired:
                profile.cpuThrottleRequired &&
                workerThrottleRequiredForSlot(slot.lfgMode),
              applyCdpThrottle: profile.cpuThrottlePolicy === "cdp-4x",
              policy: profile.cpuThrottlePolicy,
            });
            const throttle = throttleHandle.snapshot();
            if (profile.cpuThrottleRequired && throttle.appliedRate !== profile.cpuThrottleRate) {
              throttleResults.push(throttle);
              throw new Error(
                `Publish profile requires 4x CDP CPU throttling before timed work. ${throttle.failureReason ?? "unavailable"}`,
              );
            }
            if (profile.cpuThrottlePolicy === "native-1x" && throttle.cdpThrottleApplied) {
              throttleResults.push(throttle);
              throw new Error("publish-native must not apply CDP CPU throttling to the page or Worker");
            }
          } catch (error) {
            recordFailure("throttling", error);
            throw error;
          }

          current.phase = "preparation";
          try {
            const records = await runIteration(page, {
              scenario: profile.scenario,
              role: slot.role,
              expected: expected!,
              protocolTimeoutMs: profile.protocolTimeoutMs,
              drainIssues: () => guards.drain(),
              lfgMode: slot.lfgMode,
              purpose: slot.purpose,
            });
            current.phase = "operation";
            const throttle = await throttleHandle.refresh();
            throttleResults.push(throttle);
            for (const record of records) {
              samples.push({
                ...record,
                cpuThrottle: throttle,
                lane: slot.lane,
                appId: slot.appId,
                round: slot.round,
                slotIndex,
                warmupAttempt: slot.role === "warmup" ? warmupAttempt : null,
              });
            }
          } catch (error) {
            recordFailure(harnessPhaseOf(error) ?? current.phase ?? "operation", error);
            throw error;
          }
        },
      });
      return samples.slice(samplesBefore);
    };

    for (const lane of ["react", "vanilla"] as const) {
      let slotIndex = 0;
      for (const slot of schedule.lanes[lane].slots) {
        if (slot.role === "warmup") {
          let firstSucceeded = false;
          let firstThrew = false;
          let firstSamples: RawSample[] = [];
          try {
            firstSamples = await runScheduledSlot(slot, slotIndex, 0);
            firstSucceeded = warmupAttemptSucceeded(
              firstSamples,
              requiredOperationsForPurpose(slot.purpose),
            );
          } catch (error) {
            firstThrew = true;
            if (!shouldRetryWarmup(profile)) throw error;
          }
          const decision = nextWarmupDecision({
            retryAllowed: shouldRetryWarmup(profile),
            attempt: 0,
            succeeded: firstSucceeded && !firstThrew,
          });
          if (decision === "retry") {
            try {
              const retrySamples = await runScheduledSlot(slot, slotIndex, 1);
              if (warmupAttemptSucceeded(retrySamples, requiredOperationsForPurpose(slot.purpose))) {
                markSlotFailuresRecovered(harnessFailures, {
                  lane: slot.lane,
                  appId: slot.appId,
                  lfgMode: slot.lfgMode ?? null,
                  round: slot.round,
                  slotIndex,
                  warmupAttempt: 0,
                });
              } else {
                warmupRetryExhausted = true;
              }
            } catch (retryError) {
              warmupRetryExhausted = true;
              throw retryError;
            }
          } else if (decision === "exhaust") {
            warmupRetryExhausted = true;
          }
        } else {
          await runScheduledSlot(slot, slotIndex, 0);
        }
        slotIndex += 1;
      }
    }
    complete = rootHarnessFailure(harnessFailures) == null && !warmupRetryExhausted;
  } catch (error) {
    runError = error;
    if (!rootHarnessFailure(harnessFailures)) {
      recordFailure(harnessPhaseOf(error) ?? current.phase ?? "operation", error);
    }
    complete = false;
  } finally {
    const contextCloseWasPrimary = await closeOwnedContext(context, (error, kind) => {
      recordFailure("teardown", error, { secondary: kind === "secondary" });
    });
    if (contextCloseWasPrimary) complete = false;
    try {
      await stopAllOwnedProcesses();
    } catch (error) {
      recordFailure("teardown", error);
      complete = false;
    }
    if (rootHarnessFailure(harnessFailures)) complete = false;

    const cpuThrottle = mergeThrottleResults(throttleResults);
    if (!expected) {
      try {
        expected = computeExpectedOperations(profile.scenario);
      } catch {
        expected = null;
      }
    }
    if (!schedule) {
      try {
        schedule = buildRuntimeSchedule(profile.warmupRounds, profile.measuredRounds);
      } catch {
        schedule = null;
      }
    }
    const environmentPath = join(runDir, "environment.partial.json");
    const environment = existsSync(environmentPath)
      ? JSON.parse(readFileSync(environmentPath, "utf8"))
      : {};
    environment.browser = {
      name: "chromium",
      version: cpuThrottle.chromiumProduct ?? browserUserAgent,
      userAgent: browserUserAgent,
      headless: true,
      note: "Chromium product comes from CDP Browser.getVersion when available; userAgent is the Playwright page UA.",
    };
    environment.cpuThrottle = cpuThrottle;
    environment.profile = profile.id;
    environment.cpuThrottlePolicy = profile.cpuThrottlePolicy;
    environment.viewport = { width: 1280, height: 720 };
    environment.headless = true;
    environment.rowCount = expected?.rowCount ?? 0;
    environment.columnCount = expected?.columnCount ?? 0;
    environment.datasetSha256 = expected?.datasetSha256 ?? null;
    environment.columnSchemaSha256 = expected?.columnSchemaSha256 ?? null;
    environment.warmupRounds = profile.warmupRounds;
    environment.measuredRounds = profile.measuredRounds;
    environment.deterministicSeed = expected?.seed ?? 20260906;
    environment.playwright = environment.playwright ?? { version: "pending-merge" };

    const publishableDeniedReasons: string[] = [];
    const fatalRunReasons: string[] = [];
    if (profile.statisticsRole !== "public-candidate") {
      publishableDeniedReasons.push(`${profile.id} profile is diagnostic, not a public timing candidate`);
    }
    if (profile.tracing) {
      publishableDeniedReasons.push("trace mode changes performance and is excluded from published timings");
    }
    if (environment.git?.dirtyWorktree) {
      publishableDeniedReasons.push("dirty worktree; figures are provisional");
    }
    if (cpuThrottle.appliedRate !== profile.cpuThrottleRate) {
      const reason = cpuThrottle.failureReason ?? "requested CPU throttle was not applied";
      publishableDeniedReasons.push(reason);
      if (profile.cpuThrottleRequired) fatalRunReasons.push(reason);
    }
    if (profile.cpuThrottlePolicy === "native-1x" && cpuThrottle.cdpThrottleApplied === true) {
      publishableDeniedReasons.push(
        "publish-native applied CDP CPU throttling; native 1x equal compute requires no page or Worker CDP throttle",
      );
    }
    if (profile.cpuThrottlePolicy === "cdp-4x" && !cpuThrottle.workerThrottle.confirmedEquivalentToPage) {
      const reason =
        cpuThrottle.workerThrottle.failureReason ??
        "equivalent Quick Search Worker CPU throttling was not confirmed";
      publishableDeniedReasons.push(reason);
    }
    const identities: Array<{
      appId: string;
      lfgMode: string | null;
      purpose: "competitive" | "quickSearch";
      label: string;
      operations: readonly string[];
    }> = [
      {
        appId: "lightfastgrid",
        lfgMode: null,
        purpose: "competitive",
        label: "lightfastgrid competitive default",
        operations: ORDINARY_COMPETITIVE_OPERATIONS,
      },
      {
        appId: "ag-grid",
        lfgMode: null,
        purpose: "competitive",
        label: "ag-grid competitive",
        operations: ORDINARY_COMPETITIVE_OPERATIONS,
      },
      {
        appId: "lightfastgrid",
        lfgMode: "workerIsolated",
        purpose: "quickSearch",
        label: "lightfastgrid workerIsolated",
        operations: QUICK_SEARCH_ONLY_OPERATIONS,
      },
      {
        appId: "lightfastgrid",
        lfgMode: "mainThreadIsolated",
        purpose: "quickSearch",
        label: "lightfastgrid forcedMainThread",
        operations: QUICK_SEARCH_ONLY_OPERATIONS,
      },
      {
        appId: "lightfastgrid",
        lfgMode: "workerProductionOptimized",
        purpose: "quickSearch",
        label: "lightfastgrid workerProductionOptimized",
        operations: QUICK_SEARCH_ONLY_OPERATIONS,
      },
      {
        appId: "ag-grid",
        lfgMode: null,
        purpose: "quickSearch",
        label: "ag-grid quickSearch",
        operations: QUICK_SEARCH_ONLY_OPERATIONS,
      },
      {
        appId: "lightfastgrid-vanilla",
        lfgMode: null,
        purpose: "competitive",
        label: "lightfastgrid-vanilla competitive default",
        operations: ORDINARY_COMPETITIVE_OPERATIONS,
      },
      {
        appId: "ag-grid-vanilla",
        lfgMode: null,
        purpose: "competitive",
        label: "ag-grid-vanilla competitive",
        operations: ORDINARY_COMPETITIVE_OPERATIONS,
      },
      {
        appId: "lightfastgrid-vanilla",
        lfgMode: "workerIsolated",
        purpose: "quickSearch",
        label: "lightfastgrid-vanilla workerIsolated",
        operations: QUICK_SEARCH_ONLY_OPERATIONS,
      },
      {
        appId: "lightfastgrid-vanilla",
        lfgMode: "mainThreadIsolated",
        purpose: "quickSearch",
        label: "lightfastgrid-vanilla forcedMainThread",
        operations: QUICK_SEARCH_ONLY_OPERATIONS,
      },
      {
        appId: "lightfastgrid-vanilla",
        lfgMode: "workerProductionOptimized",
        purpose: "quickSearch",
        label: "lightfastgrid-vanilla workerProductionOptimized",
        operations: QUICK_SEARCH_ONLY_OPERATIONS,
      },
      {
        appId: "ag-grid-vanilla",
        lfgMode: null,
        purpose: "quickSearch",
        label: "ag-grid-vanilla quickSearch",
        operations: QUICK_SEARCH_ONLY_OPERATIONS,
      },
    ];
    for (const identity of identities) {
      for (const operation of identity.operations) {
        const valid = samples.filter(
          (sample) =>
            sample.appId === identity.appId &&
            sample.lfgMode === identity.lfgMode &&
            sample.purpose === identity.purpose &&
            sample.operation === operation &&
            sample.role === "measured" &&
            sample.valid,
        ).length;
        if (profile.statisticsRole === "public-candidate" && valid < profile.measuredRounds) {
          const reason = `${identity.label} ${operation} has ${valid} valid measured samples; ${profile.measuredRounds} required`;
          publishableDeniedReasons.push(reason);
          fatalRunReasons.push(reason);
        }
      }
    }

    for (const sample of samples) {
      const isQuickSearchOp =
        sample.operation === "quickSearch" ||
        sample.operation === "quickSearchPrimedDifferent" ||
        sample.operation === "quickSearchRepeatedSame" ||
        sample.operation === "quickSearchTypingBurst" ||
        sample.operation === "quickSearchTypingSettled";
      if (!isQuickSearchOp || sample.role !== "measured") continue;
      if (!sample.scenarioId) {
        const reason = `${sample.appId} ${sample.operation} is missing Quick Search scenario identity`;
        if (!publishableDeniedReasons.includes(reason)) publishableDeniedReasons.push(reason);
      }
      const producer = sample.executionEvidence?.producer ?? "unknown";
      if (sample.lfgMode === "workerIsolated" && sample.valid && producer !== "worker") {
        const reason = `${sample.appId} workerIsolated ${sample.operation} lacks producer worker`;
        if (!publishableDeniedReasons.includes(reason)) publishableDeniedReasons.push(reason);
      }
      if (
        sample.lfgMode === "mainThreadIsolated" &&
        sample.valid &&
        producer !== "mainThread"
      ) {
        const reason = `${sample.appId} forcedMainThread ${sample.operation} reported producer ${producer}`;
        if (!publishableDeniedReasons.includes(reason)) publishableDeniedReasons.push(reason);
      }
      if (
        (sample.lfgMode === "workerIsolated" || sample.lfgMode === "workerProductionOptimized") &&
        producer === "unknown"
      ) {
        const reason = `${sample.appId} ${sample.lfgMode} ${sample.operation} is missing direct producer evidence`;
        if (!publishableDeniedReasons.includes(reason)) publishableDeniedReasons.push(reason);
      }
      if (
        profile.cpuThrottlePolicy === "cdp-4x" &&
        (sample.lfgMode === "workerIsolated" || sample.lfgMode === "workerProductionOptimized") &&
        sample.cpuThrottle?.workerThrottle.confirmedEquivalentToPage !== true
      ) {
        const reason =
          "equivalent Worker CPU throttling was not acknowledged for every contributing Worker sample";
        if (!publishableDeniedReasons.includes(reason)) publishableDeniedReasons.push(reason);
      }
    }
    for (const sample of samples) {
      const isFilterOrSort =
        sample.operation === "sort" ||
        sample.operation.startsWith("filter");
      if (!isFilterOrSort || sample.role !== "measured") continue;
      if (!sample.appId.includes("lightfastgrid")) continue;
      const producer = sample.executionEvidence?.producer ?? "unknown";
      if (isFilterClearOperation(sample.operation)) {
        if (producer === "worker" || sample.executionEvidence?.workerRouteConfirmed === true) {
          const reason = `${sample.appId} ${sample.operation} must not claim Filter Worker execution; Clear does not schedule Filter`;
          if (!publishableDeniedReasons.includes(reason)) publishableDeniedReasons.push(reason);
        }
        continue;
      }
      if (producer === "unknown" || producer === "none") {
        const reason = `${sample.appId} ${sample.purpose} ${sample.operation} is missing direct producer evidence`;
        if (!publishableDeniedReasons.includes(reason)) publishableDeniedReasons.push(reason);
      }
      if (producer === "cache" && sample.executionEvidence?.workerRouteConfirmed === true) {
        const reason = `${sample.appId} ${sample.operation} labeled a cache producer as Worker execution`;
        if (!publishableDeniedReasons.includes(reason)) publishableDeniedReasons.push(reason);
      }
    }

    const warmupSlots = schedule
      ? [...schedule.lanes.react.slots, ...schedule.lanes.vanilla.slots].filter((slot) => slot.role === "warmup")
      : [];
    const warmupReasons = collectWarmupPublicationReasons({
      profile,
      warmupSlots,
      samples,
    });
    for (const reason of warmupReasons.denied) {
      if (!publishableDeniedReasons.includes(reason)) publishableDeniedReasons.push(reason);
    }
    for (const reason of warmupReasons.fatal) {
      if (!fatalRunReasons.includes(reason)) fatalRunReasons.push(reason);
    }
    if (warmupReasons.fatal.length > 0) complete = false;

    const unexpectedMeasured = unexpectedInvalidMeasuredReasons(
      samples,
      expected?.rowCount ?? 0,
    );
    for (const reason of unexpectedMeasured) {
      if (!fatalRunReasons.includes(reason)) fatalRunReasons.push(reason);
    }
    if (unexpectedMeasured.length > 0) complete = false;

    const quickSearchModeComparison = buildQuickSearchComparisonForRun({
      samples,
      workerThrottleConfirmed: equalComputeConfirmed(cpuThrottle),
      profile,
    });
    const filterModeComparison = buildFilterComparisonForRun({
      samples,
      workerThrottleConfirmed: equalComputeConfirmed(cpuThrottle),
      profile,
    });

    let publication = resolveRunPublication({
      profile,
      complete,
      dirtyWorktree: Boolean(environment.git?.dirtyWorktree),
      harnessFailures,
      publishableDeniedReasons,
      fatalRunReasons,
      quickSearchModeComparison,
      filterModeComparison,
    });

    const methodology = {
      phase: 1,
      buildMode: "runtime",
      browserName: "chromium",
      profile: profile.id,
      scenario: profile.scenario,
      rowCount: expected?.rowCount ?? null,
      columnCount: expected?.columnCount ?? null,
      datasetSha256: expected?.datasetSha256 ?? null,
      columnSchemaSha256: expected?.columnSchemaSha256 ?? null,
      warmupRounds: profile.warmupRounds,
      measuredRounds: profile.measuredRounds,
      warmupExcludedFromStatistics: true,
      viewport: { width: 1280, height: 720 },
      headless: true,
      cpuThrottle,
      protocolTimeoutMs: profile.protocolTimeoutMs,
      primaryMetric: "median durationMs of protocol settlement",
      statisticsRole: profile.statisticsRole,
      intendsPublicCandidateStatistics: profile.statisticsRole === "public-candidate",
      lanesAreIndependent:
        "React and Vanilla are separate comparison lanes. Never subtract across lanes or combine them into one ranking.",
      generationExcluded:
        "prepareScenario generationMs is recorded separately and is never treated as grid mount or operation time.",
      interleaving:
        "Each lane uses deterministic AB/BA rounds so product order is not confounded with Playwright project grouping.",
      cpuThrottlePolicy: profile.cpuThrottlePolicy,
      equalComputeNote: cpuThrottle.equalComputeNote,
      workerEligibility: profile.workerEligibilityNote,
      rafGapThresholdMs: 20,
      rafGapNote: "rAF gaps over 20ms are scheduling delays, not dropped frames.",
      scrollTopTolerancePx: expected?.scroll.tolerancePx ?? 2,
      tracing: profile.tracing,
      tracingIncomplete,
      traceCompleted: tracingCompleted,
      traceTarget: profile.tracing
        ? {
            lane: "react",
            appId: "lightfastgrid",
            note: "One identified measured LightFastGrid React iteration.",
          }
        : null,
      provisional: Boolean(environment.git?.dirtyWorktree) || publication.publishableDeniedReasons.length > 0 || !publication.complete,
      publicationPermission: "report-level publishable only",
      p95Note:
        "p95SampleCountEligible means the operation has enough valid samples for a P95. It is not permission to publish figures.",
    };

    current.phase = "evidence-write";
    const written = writeRuntimeEvidenceSafely({
      runDir,
      runId,
      profile,
      expected,
      schedule: schedule ?? { error: "schedule was not built" },
      environment,
      methodology,
      cpuThrottle,
      samples,
      complete: publication.complete,
      publishable: publication.publishable,
      publishableDeniedReasons: publication.publishableDeniedReasons,
      fatalRunReasons: publication.fatalRunReasons,
      fatalReason: publication.fatalReason,
      harnessFailures,
      quickSearchModeComparison,
      filterModeComparison,
    });
    if (written.writeError) {
      recordFailure("evidence-write", written.writeError);
      complete = false;
      publication = resolveRunPublication({
        profile,
        complete: false,
        dirtyWorktree: Boolean(environment.git?.dirtyWorktree),
        harnessFailures,
        publishableDeniedReasons,
        fatalRunReasons,
        quickSearchModeComparison,
        filterModeComparison,
      });
    }

    let markerError: unknown = null;
    try {
      writeOrchestratorCompleteMarker(runDir, {
        ok: publication.complete && written.writeError == null,
        runId,
        complete: publication.complete,
        fatalRunReasons: publication.fatalRunReasons,
        fatalReason: publication.fatalReason,
      });
    } catch (error) {
      markerError = error;
      recordFailure("evidence-write", error);
    }

    failAfterEvidenceWrite(runError, written.writeError ?? markerError);
  }

  const primary = rootHarnessFailure(harnessFailures);
  if (primary) {
    throw new Error(formatHarnessFatalReason(primary));
  }
  expect(complete).toBe(true);
});
