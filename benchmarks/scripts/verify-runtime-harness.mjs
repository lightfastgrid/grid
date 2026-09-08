#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeExpectedOperations } from "../shared/src/expectedOperations.ts";
import {
  validateFilter,
  validateQuickSearch,
  isExpectedBelowThresholdWorkerRouteInvalid,
  unexpectedInvalidMeasuredReasons,
} from "../tests/performance/fixtures/correctness.ts";
import {
  resolveRunPublication,
  writeOrchestratorCompleteMarker,
  writeRuntimeEvidence,
  writeRuntimeEvidenceSafely,
} from "../tests/performance/fixtures/evidence.ts";
import {
  failAfterEvidenceWrite,
  harnessFailureFrom,
  markSlotFailuresRecovered,
  rootHarnessFailure,
  throwPreservingOriginal,
} from "../tests/performance/fixtures/harnessFailures.ts";
import { RUNTIME_PROFILES } from "../tests/performance/fixtures/profiles.ts";
import {
  acquireOwnedContext,
  cleanupOwnedSlot,
  closeOwnedContext,
  runOwnedSlot,
} from "../tests/performance/fixtures/slotLifecycle.ts";
import { isAlreadyClosedCleanupError } from "../tests/performance/fixtures/alreadyClosed.ts";
import { evaluateSetupReset } from "../tests/performance/fixtures/workload.ts";
import {
  assertMergedRuntimeReport,
  assertRuntimeSummary,
} from "../tests/performance/metrics/schema.ts";
import { buildQuickSearchModeComparison, collectQuickSearchComparisonReasons } from "../tests/performance/metrics/modeComparison.ts";
import { equalComputeConfirmed } from "../tests/performance/fixtures/cpuThrottle.ts";
import {
  collectWarmupPublicationReasons,
  nextWarmupDecision,
  shouldRetryWarmup,
  warmupAttemptSucceeded,
} from "../tests/performance/fixtures/warmupRetry.ts";

const expected = computeExpectedOperations("normal");

const cpuThrottle = {
  requestedRate: 4,
  appliedRate: 4,
  cdpAvailable: true,
  appliedBeforeTimedWork: true,
  failureReason: null,
  chromiumProduct: "HeadlessChrome/test",
  policy: "cdp-4x",
  cdpThrottleApplied: true,
  equalComputeNote: null,
  workerThrottle: {
    attempted: true,
    required: false,
    targetsThrottled: 0,
    targetUrls: [],
    attempts: [],
    appliedRate: null,
    confirmedEquivalentToPage: false,
    failureReason: "test fixture does not attach a Worker target",
    equalComputePolicy: "unconfirmed",
  },
};

const nativeCpuThrottle = {
  requestedRate: 1,
  appliedRate: 1,
  cdpAvailable: true,
  appliedBeforeTimedWork: true,
  failureReason: null,
  chromiumProduct: "HeadlessChrome/test",
  policy: "native-1x",
  cdpThrottleApplied: false,
  equalComputeNote:
    "Native 1x: CDP CPU throttling was not applied to the page or Worker. Equal compute is native machine speed. This does not prove 4x throttled performance.",
  workerThrottle: {
    attempted: false,
    required: false,
    targetsThrottled: 0,
    targetUrls: [],
    attempts: [],
    appliedRate: null,
    confirmedEquivalentToPage: true,
    failureReason: null,
    equalComputePolicy: "native-unthrottled",
  },
};

function environmentFixture(dirty = true) {
  return {
    git: { commit: "abc1234", dirtyWorktree: dirty },
    os: { platform: "darwin", release: "test" },
    cpu: { model: "test" },
    memory: { totalBytes: 1 },
    node: { version: "v22.0.0" },
    pnpm: { version: "10.33.2" },
    browser: { name: "chromium", version: "141.0.0" },
    packages: {},
    profile: "publish",
    viewport: { width: 1280, height: 720 },
    headless: true,
    rowCount: expected.rowCount,
    columnCount: expected.columnCount,
    warmupRounds: 3,
    measuredRounds: 10,
    deterministicSeed: expected.seed,
    playwright: { version: "1.56.1" },
    cpuThrottle,
  };
}

function methodologyFixture(profile) {
  return {
    phase: 1,
    buildMode: "runtime",
    browserName: "chromium",
    profile: profile.id,
    statisticsRole: profile.statisticsRole,
    provisional: true,
  };
}

function measuredSample(appId, operation, durationMs, round = 0) {
  const lane = appId.includes("vanilla") ? "vanilla" : "react";
  return {
    lane,
    appId,
    round,
    slotIndex: round,
    operation,
    valid: true,
    role: "measured",
    durationMs,
    uxDurationMs: null,
    generationMs: operation === "mount" ? 1 : null,
    observers: null,
    visible: null,
    accepted: null,
    domNodeCount: null,
    invalidReason: null,
    invalidMessage: null,
    lfgMode: null,
    scenarioId: null,
    typingSession: null,
    executionEvidence: null,
    cpuThrottle: null,
  };
}

const APPS = ["lightfastgrid", "ag-grid", "lightfastgrid-vanilla", "ag-grid-vanilla"];
const OPS = [
  "mount",
  "sort",
  "filterTextApply",
  "quickSearch",
  "clearOperations",
  "scrollTo",
];

function fillMeasuredSamples(count, durationMs = 20) {
  const samples = [];
  for (const appId of APPS) {
    for (const operation of OPS) {
      for (let round = 0; round < count; round += 1) {
        samples.push(measuredSample(appId, operation, durationMs, round));
      }
    }
  }
  return samples;
}

function writeToTemp(overrides = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "lfg-runtime-evidence-"));
  const profile = overrides.profile ?? RUNTIME_PROFILES.publish;
  const written = writeRuntimeEvidence({
    runDir,
    runId: "test-run",
    profile,
    expected,
    schedule: { algorithm: "alternating-ab-ba" },
    environment: overrides.environment ?? environmentFixture(overrides.dirtyWorktree ?? true),
    methodology: methodologyFixture(profile),
    cpuThrottle: overrides.cpuThrottle ?? cpuThrottle,
    samples: overrides.samples ?? [],
    complete: overrides.complete ?? false,
    publishable: overrides.publishable ?? false,
    publishableDeniedReasons: overrides.publishableDeniedReasons ?? ["test"],
    fatalRunReasons: overrides.fatalRunReasons ?? [],
    fatalReason: overrides.fatalReason ?? null,
    harnessFailures: overrides.harnessFailures ?? [],
    ...overrides.rest,
  });
  return { runDir, written };
}

{
  const failure = evaluateSetupReset(
    {
      ok: false,
      durationMs: 12,
      observers: null,
      visible: null,
      accepted: null,
      domNodeCount: null,
      error: "clear failed",
    },
    [{ kind: "console-error", message: "boom" }],
    expected,
  );
  assert.equal(failure?.code, "invalid-setup-state");
  assert.match(failure.message, /clear failed/);
  assert.match(failure.message, /console-error: boom/);
}

{
  const ok = evaluateSetupReset(
    {
      ok: true,
      durationMs: 5,
      observers: null,
      visible: {
        displayedRowCount: expected.rowCount,
        renderedRowCount: 10,
        firstRenderedRowId: "r-0",
        lastRenderedRowId: "r-9",
        scrollTop: 0,
        scrollLeft: 0,
        columnCount: expected.columnCount,
      },
      accepted: { sort: [], filterFields: [], quickSearch: "" },
      domNodeCount: 1,
      error: null,
    },
    [],
    expected,
  );
  assert.equal(ok, null);
}

{
  const accepted = {
    sort: [{ field: "name", direction: "asc" }],
    filterFields: ["status"],
    quickSearch: "",
  };
  const visible = {
    displayedRowCount: expected.filter.displayedRowCount,
    renderedRowCount: 10,
    firstRenderedRowId: "r-0",
    lastRenderedRowId: "r-9",
    scrollTop: 0,
    scrollLeft: 0,
    columnCount: expected.columnCount,
  };
  const filterFailure = validateFilter(accepted, visible, expected);
  assert.equal(filterFailure?.code, "incorrect-accepted-model");
  assert.match(filterFailure.message, /sort or Quick Search/);
}

{
  const accepted = {
    sort: [],
    filterFields: ["status"],
    quickSearch: "Patel",
  };
  const visible = {
    displayedRowCount: expected.quickSearch.displayedRowCount,
    renderedRowCount: 10,
    firstRenderedRowId: "r-0",
    lastRenderedRowId: "r-9",
    scrollTop: 0,
    scrollLeft: 0,
    columnCount: expected.columnCount,
  };
  const qsFailure = validateQuickSearch(accepted, visible, expected);
  assert.equal(qsFailure?.code, "incorrect-accepted-model");
  assert.match(qsFailure.message, /sort or column filters/);
}

{
  const publication = resolveRunPublication({
    profile: RUNTIME_PROFILES.publish,
    complete: false,
    dirtyWorktree: true,
    harnessFailures: [
      {
        lane: "react",
        appId: "lightfastgrid",
        round: 0,
        slotIndex: 0,
        phase: "preparation",
        message: "prepareScenario exploded",
        stack: "Error: prepareScenario exploded",
      },
    ],
    publishableDeniedReasons: [],
    fatalRunReasons: [],
  });
  assert.equal(publication.complete, false);
  assert.equal(publication.publishable, false);
  assert.match(publication.fatalReason ?? "", /preparation/);
}

function harnessFailure(phase, message, extra = {}) {
  return {
    lane: extra.lane ?? "react",
    appId: extra.appId ?? "lightfastgrid",
    round: extra.round ?? 0,
    slotIndex: extra.slotIndex ?? 0,
    lfgMode: extra.lfgMode ?? null,
    warmupAttempt: extra.warmupAttempt ?? null,
    phase,
    message,
    stack: extra.stack ?? `Error: ${message}`,
    secondary: extra.secondary,
  };
}

{
  const missing = "lightfastgrid quickSearch has 0 valid measured samples";
  const publication = resolveRunPublication({
    profile: RUNTIME_PROFILES.publish,
    complete: false,
    dirtyWorktree: false,
    harnessFailures: [harnessFailure("operation", "protocol timed out")],
    publishableDeniedReasons: [missing],
    fatalRunReasons: [missing],
  });
  assert.equal(publication.fatalReason, "harness operation: protocol timed out");
  assert.equal(publication.complete, false);
  assert.equal(publication.publishable, false);
  assert.ok(publication.fatalRunReasons.includes(missing));
  assert.equal(publication.fatalRunReasons[0], "harness operation: protocol timed out");
}

{
  const missing = "lightfastgrid quickSearch has 0 valid measured samples";
  const publication = resolveRunPublication({
    profile: RUNTIME_PROFILES.publish,
    complete: false,
    dirtyWorktree: false,
    harnessFailures: [],
    publishableDeniedReasons: [missing],
    fatalRunReasons: [missing],
  });
  assert.equal(publication.fatalReason, missing);
  assert.equal(publication.complete, false);
  assert.equal(publication.publishable, false);
}

{
  const publication = resolveRunPublication({
    profile: RUNTIME_PROFILES.smoke,
    complete: true,
    dirtyWorktree: false,
    harnessFailures: [],
    publishableDeniedReasons: ["smoke profile is diagnostic, not a public timing candidate"],
    fatalRunReasons: [],
  });
  assert.equal(publication.fatalReason, null);
  assert.equal(publication.complete, true);
  assert.equal(publication.publishable, false);
}

{
  const missing = "lightfastgrid quickSearch has 0 valid measured samples";
  const harnessReason = "harness operation: protocol timed out";
  const publication = resolveRunPublication({
    profile: RUNTIME_PROFILES.publish,
    complete: false,
    dirtyWorktree: false,
    harnessFailures: [
      harnessFailure("teardown", "Target page, context or browser has been closed", {
        secondary: true,
      }),
      harnessFailure("operation", "protocol timed out"),
    ],
    publishableDeniedReasons: [missing, harnessReason],
    fatalRunReasons: [missing, harnessReason, harnessReason],
  });
  assert.equal(publication.fatalReason, harnessReason);
  assert.equal(
    publication.fatalRunReasons.filter((reason) => reason === harnessReason).length,
    1,
  );
  assert.ok(publication.fatalRunReasons.includes(missing));
}

{
  const publication = resolveRunPublication({
    profile: RUNTIME_PROFILES.publish,
    complete: false,
    dirtyWorktree: false,
    harnessFailures: [],
    publishableDeniedReasons: [],
    fatalRunReasons: [],
  });
  assert.equal(publication.fatalReason, "run is incomplete");
}

{
  const publication = resolveRunPublication({
    profile: RUNTIME_PROFILES.publish,
    complete: true,
    dirtyWorktree: false,
    harnessFailures: [
      harnessFailure("teardown", "Target page, context or browser has been closed", {
        secondary: true,
      }),
    ],
    publishableDeniedReasons: ["dirty worktree; figures are provisional"],
    fatalRunReasons: [],
  });
  assert.equal(publication.fatalReason, null);
  assert.equal(publication.complete, true);
}

function assertEvidenceFiles(runDir) {
  for (const name of [
    "errors.json",
    "schedule.json",
    "environment.json",
    "methodology.json",
    "raw-samples.json",
    "summary.json",
  ]) {
    assert.equal(existsSync(join(runDir, name)), true, `missing ${name}`);
  }
}

{
  const { runDir, written } = writeToTemp({
    complete: false,
    publishable: false,
    fatalReason: "harness preparation: prepareScenario exploded",
    fatalRunReasons: ["harness preparation: prepareScenario exploded"],
    publishableDeniedReasons: ["harness preparation: prepareScenario exploded"],
    harnessFailures: [
      {
        lane: "react",
        appId: "lightfastgrid",
        round: 0,
        slotIndex: 0,
        phase: "preparation",
        message: "prepareScenario exploded",
        stack: "Error: prepareScenario exploded",
      },
    ],
  });
  assertEvidenceFiles(runDir);
  assert.equal(written.complete, false);
  assert.equal(written.publishable, false);
  assert.equal(written.fatalReason, "harness preparation: prepareScenario exploded");
  const errors = JSON.parse(readFileSync(join(runDir, "errors.json"), "utf8"));
  assert.equal(errors.harnessFailures[0].phase, "preparation");
  assert.equal(errors.harnessFailures[0].lane, "react");
  assert.equal(errors.harnessFailures[0].appId, "lightfastgrid");
  assert.equal(errors.harnessFailures[0].round, 0);
  assert.equal(errors.harnessFailures[0].slotIndex, 0);
  assert.match(errors.harnessFailures[0].message, /prepareScenario exploded/);
  assert.ok(errors.harnessFailures[0].stack);
  assert.equal(errors.errors[0].phase, "preparation");
  assert.equal(errors.errors[0].slotIndex, 0);
  assertMergedRuntimeReport(written);
}

{
  const { runDir, written } = writeToTemp({
    complete: false,
    publishable: false,
    fatalReason: "harness protocol-discovery: protocol missing",
    fatalRunReasons: ["harness protocol-discovery: protocol missing"],
    publishableDeniedReasons: ["harness protocol-discovery: protocol missing"],
    harnessFailures: [
      {
        lane: "vanilla",
        appId: "ag-grid-vanilla",
        round: 1,
        slotIndex: 3,
        phase: "protocol-discovery",
        message: "protocol missing",
        stack: "Error: protocol missing",
      },
    ],
  });
  assertEvidenceFiles(runDir);
  assert.equal(written.complete, false);
  assert.equal(written.publishable, false);
  const errors = JSON.parse(readFileSync(join(runDir, "errors.json"), "utf8"));
  assert.equal(errors.harnessFailures[0].phase, "protocol-discovery");
  assertMergedRuntimeReport(written);
}

{
  const { runDir, written } = writeToTemp({
    complete: false,
    publishable: false,
    fatalReason: "harness operation: unexpected boom",
    fatalRunReasons: ["harness operation: unexpected boom"],
    publishableDeniedReasons: ["harness operation: unexpected boom"],
    samples: [measuredSample("lightfastgrid", "mount", 10, 0)],
    harnessFailures: [
      {
        lane: "react",
        appId: "lightfastgrid",
        round: 0,
        slotIndex: 0,
        phase: "operation",
        message: "unexpected boom",
        stack: "Error: unexpected boom",
      },
    ],
  });
  assertEvidenceFiles(runDir);
  const raw = JSON.parse(readFileSync(join(runDir, "raw-samples.json"), "utf8"));
  assert.equal(raw.complete, false);
  assert.equal(raw.samples.length, 1);
  assert.equal(written.lanes.react.applications.lightfastgrid.operations.mount.validSampleCount, 1);
  assertMergedRuntimeReport(written);
}

{
  const { runDir, written } = writeToTemp({
    profile: RUNTIME_PROFILES.smoke,
    complete: true,
    publishable: false,
    dirtyWorktree: false,
    publishableDeniedReasons: ["smoke profile is diagnostic, not a public timing candidate"],
    fatalRunReasons: [],
    fatalReason: null,
    samples: fillMeasuredSamples(1),
    rest: {},
  });
  assertEvidenceFiles(runDir);
  assert.equal(written.complete, true);
  assert.equal(written.publishable, false);
  assert.equal(
    written.lanes.react.applications.lightfastgrid.operations.quickSearch.p95SampleCountEligible,
    false,
  );
  assert.equal(written.methodology.intendsPublicCandidateStatistics, false);
  assert.equal(written.methodology.p95HasSufficientSamples, false);
  assert.doesNotMatch(JSON.stringify(written), /publicP95/);
  assertRuntimeSummary(written);
  assert.equal(written.quickSearchModeComparison.interpretation.noWinnerField, true);
  assert.equal(written.quickSearchModeComparison.interpretation.forcedMainThreadIsNotACompetitor, true);
  assert.equal(written.quickSearchModeComparison.lanes.react.coldFullQuery.forcedMainThread.competitor, false);
  assert.equal(written.quickSearchModeComparison.lanes.react.coldFullQuery.workerIsolated.competitor, true);
  assert.equal(written.quickSearchModeComparison.lanes.react.coldFullQuery.agGrid.competitor, true);
  assert.equal(written.quickSearchModeComparison.provisional, true);
  assert.ok(
    written.quickSearchModeComparison.comparisons.some(
      (pair) => pair.id === "workerIsolatedVsForcedMainThread" && pair.rightIsCompetitor === false,
    ),
  );
  assert.doesNotMatch(JSON.stringify(written.quickSearchModeComparison), /"winner"/);
}

{
  const { written } = writeToTemp({
    profile: RUNTIME_PROFILES.publish,
    complete: true,
    publishable: false,
    dirtyWorktree: true,
    publishableDeniedReasons: ["dirty worktree; figures are provisional"],
    fatalRunReasons: [],
    fatalReason: null,
    samples: fillMeasuredSamples(10),
  });
  assert.equal(written.complete, true);
  assert.equal(written.publishable, false);
  assert.equal(written.methodology.intendsPublicCandidateStatistics, true);
  assert.equal(written.methodology.p95HasSufficientSamples, true);
  assert.equal(
    written.lanes.react.applications.lightfastgrid.operations.quickSearch.p95SampleCountEligible,
    true,
  );
  assert.doesNotMatch(JSON.stringify(written), /"publicP95"/);
  assertMergedRuntimeReport(written);
}

{
  const dirty = JSON.parse(
    JSON.stringify(
      writeToTemp({
        profile: RUNTIME_PROFILES.publish,
        complete: true,
        publishable: false,
        dirtyWorktree: true,
        publishableDeniedReasons: ["dirty worktree; figures are provisional"],
        fatalRunReasons: [],
        fatalReason: null,
        samples: fillMeasuredSamples(10),
      }).written,
    ),
  );
  dirty.publishable = true;
  assert.throws(() => assertMergedRuntimeReport(dirty), /dirty\/provisional/);
}

{
  const incomplete = JSON.parse(
    JSON.stringify(
      writeToTemp({
        complete: false,
        publishable: false,
        fatalReason: "fatal",
        fatalRunReasons: ["fatal"],
        publishableDeniedReasons: ["fatal"],
      }).written,
    ),
  );
  incomplete.publishable = true;
  incomplete.complete = false;
  assert.throws(() => assertRuntimeSummary(incomplete), /publishable: true requires complete: true/);
}

{
  const smokePublic = JSON.parse(
    JSON.stringify(
      writeToTemp({
        profile: RUNTIME_PROFILES.smoke,
        complete: true,
        publishable: false,
        publishableDeniedReasons: ["smoke"],
        samples: fillMeasuredSamples(1),
      }).written,
    ),
  );
  smokePublic.lanes.react.applications.lightfastgrid.operations.quickSearch.p95SampleCountEligible = true;
  assert.throws(() => assertMergedRuntimeReport(smokePublic), /smoke statistics must not set p95SampleCountEligible/);
}

{
  let caught = null;
  try {
    throwPreservingOriginal(new Error("original boom"), new Error("write boom"));
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AggregateError);
  assert.match(caught.message, /original boom/);
  assert.match(caught.message, /write boom/);
}

{
  const runDir = mkdtempSync(join(tmpdir(), "lfg-runtime-evidence-safe-"));
  const result = writeRuntimeEvidenceSafely({
    runDir,
    runId: "safe",
    profile: RUNTIME_PROFILES.smoke,
    expected,
    schedule: {},
    environment: environmentFixture(false),
    methodology: methodologyFixture(RUNTIME_PROFILES.smoke),
    cpuThrottle,
    samples: fillMeasuredSamples(1),
    complete: true,
    publishable: false,
    publishableDeniedReasons: ["smoke"],
    fatalRunReasons: [],
    fatalReason: null,
    harnessFailures: [],
  });
  assert.equal(result.writeError, null);
  assert.equal(result.summary?.complete, true);
}

{
  let caught = null;
  try {
    failAfterEvidenceWrite(new Error("run boom"), new Error("write boom"));
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AggregateError);
  assert.match(caught.message, /run boom/);
  assert.match(caught.message, /write boom/);
}

{
  let caught = null;
  try {
    failAfterEvidenceWrite(null, new Error("write boom"));
  } catch (error) {
    caught = error;
  }
  assert.equal(caught instanceof Error, true);
  assert.equal(caught.message, "write boom");
}

{
  failAfterEvidenceWrite(null, null);
}

{
  const runDir = mkdtempSync(join(tmpdir(), "lfg-runtime-marker-"));
  writeOrchestratorCompleteMarker(runDir, {
    ok: true,
    runId: "marker",
    complete: false,
    fatalRunReasons: ["run is incomplete"],
    fatalReason: "run is incomplete",
  });
  const marker = JSON.parse(readFileSync(join(runDir, "orchestrator-complete.json"), "utf8"));
  assert.equal(marker.ok, false);
}

{
  assert.equal(
    isAlreadyClosedCleanupError(new Error("Target page, context or browser has been closed")),
    true,
  );
  assert.equal(isAlreadyClosedCleanupError(new Error("detach boom")), false);
}

{
  const failures = [];
  let caught = null;
  try {
    await acquireOwnedContext(async () => {
      throw new Error("context boom");
    }, (phase, error) => {
      failures.push({ phase, message: error instanceof Error ? error.message : String(error) });
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught instanceof Error && caught.message, "context boom");
  assert.deepEqual(failures, [{ phase: "context-create", message: "context boom" }]);
}

{
  const { runDir, written } = writeToTemp({
    complete: false,
    publishable: false,
    fatalReason: "harness context-create: context boom",
    fatalRunReasons: [
      "harness context-create: context boom",
      "lightfastgrid quickSearch has 0 valid measured samples",
    ],
    publishableDeniedReasons: ["harness context-create: context boom"],
    harnessFailures: [harnessFailure("context-create", "context boom")],
  });
  assertEvidenceFiles(runDir);
  assert.equal(written.fatalReason, "harness context-create: context boom");
  const errors = JSON.parse(readFileSync(join(runDir, "errors.json"), "utf8"));
  assert.equal(errors.harnessFailures[0].phase, "context-create");
}

{
  const order = [];
  const failures = [];
  let caught = null;
  try {
    await runOwnedSlot({
      startPreview: async () => {
        order.push("preview");
        return {
          stop: async () => {
            order.push("stop-preview");
          },
        };
      },
      createPage: async () => {
        throw new Error("page boom");
      },
      attachGuards: async () => ({
        detach: () => {
          order.push("detach");
        },
      }),
      work: async () => {
        order.push("work");
      },
      recordFailure: (phase, error) => {
        failures.push({
          phase,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught instanceof Error && caught.message, "page boom");
  assert.equal(failures[0]?.phase, "page-create");
  assert.deepEqual(order, ["preview", "stop-preview"]);
}

{
  const order = [];
  const failures = [];
  let caught = null;
  try {
    await runOwnedSlot({
      startPreview: async () => {
        throw new Error("preview boom");
      },
      createPage: async () => {
        order.push("page");
        return { close: async () => order.push("close") };
      },
      attachGuards: async () => ({ detach: () => order.push("detach") }),
      work: async () => {
        order.push("work");
      },
      recordFailure: (phase, error) => {
        failures.push({
          phase,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught instanceof Error && caught.message, "preview boom");
  assert.equal(failures[0]?.phase, "preview-start");
  assert.deepEqual(order, []);
}

{
  const order = [];
  const failures = [];
  let caught = null;
  try {
    await runOwnedSlot({
      startPreview: async () => ({
        stop: async () => {
          order.push("stop-preview");
        },
      }),
      createPage: async () => ({
        close: async () => {
          order.push("close-page");
        },
      }),
      attachGuards: async () => {
        throw new Error("guard boom");
      },
      work: async () => {
        order.push("work");
      },
      recordFailure: (phase, error) => {
        failures.push({
          phase,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught instanceof Error && caught.message, "guard boom");
  assert.equal(failures[0]?.phase, "guard-attach");
  assert.deepEqual(order, ["close-page", "stop-preview"]);
}

{
  const order = [];
  const failures = [];
  let caught = null;
  try {
    await runOwnedSlot({
      startPreview: async () => ({
        stop: async () => {
          order.push("stop-preview");
        },
      }),
      createPage: async () => ({
        close: async () => {
          order.push("close-page");
        },
      }),
      attachGuards: async () => ({
        detach: () => {
          order.push("detach");
        },
      }),
      work: async () => {
        const error = new Error("nav boom");
        failures.push({ phase: "navigation", message: error.message });
        throw error;
      },
      recordFailure: (phase, error) => {
        failures.push({
          phase,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught instanceof Error && caught.message, "nav boom");
  assert.ok(failures.some((failure) => failure.phase === "navigation"));
  assert.deepEqual(order, ["detach", "close-page", "stop-preview"]);
}

{
  const order = [];
  const failures = [];
  await runOwnedSlot({
    startPreview: async () => ({
      stop: async () => {
        order.push("stop-preview");
      },
    }),
    createPage: async () => ({
      close: async () => {
        order.push("close-page");
      },
    }),
    attachGuards: async () => ({
      detach: () => {
        order.push("detach");
        throw new Error("detach boom");
      },
    }),
    work: async () => {
      order.push("work");
    },
    recordFailure: (phase, error, options) => {
      failures.push({
        phase,
        message: error instanceof Error ? error.message : String(error),
        secondary: options?.secondary === true,
      });
    },
  });
  assert.deepEqual(order, ["work", "detach", "close-page", "stop-preview"]);
  assert.equal(failures[0]?.phase, "teardown");
  assert.equal(failures[0]?.secondary, false);
}

{
  const order = [];
  await cleanupOwnedSlot(
    {
      preview: {
        stop: async () => {
          order.push("stop");
        },
      },
      page: {
        close: async () => {
          order.push("close");
          throw new Error("close boom");
        },
      },
      guards: {
        detach: () => {
          order.push("detach");
        },
      },
    },
    () => {
      order.push("recorded");
    },
  );
  assert.deepEqual(order, ["detach", "close", "recorded", "stop"]);
}

{
  const recorded = [];
  const primary = await closeOwnedContext(
    {
      close: async () => {
        throw new Error("Target page, context or browser has been closed");
      },
    },
    (error, kind) => {
      recorded.push({
        kind,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  );
  assert.equal(primary, false);
  assert.equal(recorded[0]?.kind, "secondary");
}

{
  const recorded = [];
  const primary = await closeOwnedContext(
    {
      close: async () => {
        throw new Error("context close boom");
      },
    },
    (error, kind) => {
      recorded.push({ kind, message: error instanceof Error ? error.message : String(error) });
    },
  );
  assert.equal(primary, true);
  assert.equal(recorded[0]?.kind, "primary");
}

{
  const order = [];
  const tracing = { completed: true, incomplete: false };
  let caught = null;
  try {
    await runOwnedSlot({
      startPreview: async () => ({
        stop: async () => {
          order.push("stop-preview");
        },
      }),
      createPage: async () => ({
        close: async () => {
          order.push("close-page");
        },
      }),
      attachGuards: async () => ({
        detach: () => {
          order.push("detach");
        },
      }),
      startTracing: async () => {
        order.push("start-trace");
      },
      stopTracing: async () => {
        order.push("stop-trace");
        throw new Error("trace stop boom");
      },
      work: async () => {
        throw new Error("op boom");
      },
      recordFailure: (phase, error) => {
        order.push(`fail:${phase}:${error instanceof Error ? error.message : String(error)}`);
      },
      onTracingState: (state) => {
        tracing.completed = state.tracingCompleted;
        tracing.incomplete = state.tracingIncomplete;
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught instanceof Error && caught.message, "op boom");
  assert.equal(tracing.completed, false);
  assert.equal(tracing.incomplete, true);
  assert.ok(order.indexOf("stop-trace") < order.indexOf("detach"));
  assert.ok(order.includes("close-page"));
  assert.ok(order.includes("stop-preview"));
}

{
  const order = [];
  const result = await runOwnedSlot({
    startPreview: async () => ({
      stop: async () => {
        order.push("stop-preview");
      },
    }),
    createPage: async () => ({
      close: async () => {
        order.push("close-page");
      },
    }),
    attachGuards: async () => ({
      detach: () => {
        order.push("detach");
      },
    }),
    work: async () => {
      order.push("work");
    },
    recordFailure: () => {
      order.push("fail");
    },
  });
  assert.deepEqual(order, ["work", "detach", "close-page", "stop-preview"]);
  assert.equal(result.tracingCompleted, false);
  assert.equal(result.tracingIncomplete, false);
}

{
  const comparison = buildQuickSearchModeComparison([], false);
  assert.equal(comparison.provisional, true);
  const publication = resolveRunPublication({
    profile: RUNTIME_PROFILES.publish,
    complete: true,
    dirtyWorktree: false,
    harnessFailures: [],
    publishableDeniedReasons: [],
    fatalRunReasons: [],
    quickSearchModeComparison: comparison,
  });
  assert.equal(publication.complete, true);
  assert.equal(publication.publishable, false);
  assert.ok(publication.publishableDeniedReasons.some((reason) => /provisional/i.test(reason)));
  assert.ok(collectQuickSearchComparisonReasons(comparison).length > 0);
}

{
  const { written } = writeToTemp({
    profile: RUNTIME_PROFILES.publish,
    complete: true,
    publishable: false,
    dirtyWorktree: false,
    publishableDeniedReasons: ["test"],
    fatalRunReasons: [],
    fatalReason: null,
    samples: fillMeasuredSamples(10),
  });
  const forged = JSON.parse(JSON.stringify(written));
  forged.publishable = true;
  forged.methodology.provisional = false;
  forged.environment.git.dirtyWorktree = false;
  forged.quickSearchModeComparison.provisional = true;
  forged.quickSearchModeComparison.workerThrottleConfirmed = true;
  assert.throws(
    () => assertMergedRuntimeReport(forged),
    /publishable: true is incompatible with quickSearchModeComparison.provisional: true/,
  );
}

{
  assert.equal(shouldRetryWarmup(RUNTIME_PROFILES.publish), true);
  assert.equal(shouldRetryWarmup(RUNTIME_PROFILES["publish-native"]), true);
  assert.equal(shouldRetryWarmup(RUNTIME_PROFILES.smoke), false);
  assert.equal(nextWarmupDecision({ retryAllowed: true, attempt: 0, succeeded: true }), "success");
  assert.equal(nextWarmupDecision({ retryAllowed: true, attempt: 0, succeeded: false }), "retry");
  assert.equal(nextWarmupDecision({ retryAllowed: true, attempt: 1, succeeded: false }), "exhaust");
  assert.equal(nextWarmupDecision({ retryAllowed: false, attempt: 0, succeeded: false }), "record-diagnostic");
  assert.equal(
    warmupAttemptSucceeded(
      [
        { operation: "mount", valid: true },
        { operation: "sort", valid: true },
      ],
      ["mount", "sort"],
    ),
    true,
  );
  assert.equal(
    warmupAttemptSucceeded([{ operation: "mount", valid: false }, { operation: "sort", valid: true }], ["mount", "sort"]),
    false,
  );
}

{
  const slot = { lane: "react", appId: "lightfastgrid", lfgMode: "workerIsolated", round: 0 };
  const ops = ["mount", "quickSearch"];
  const failedFirst = ops.map((operation) => ({
    ...slot,
    role: "warmup",
    operation,
    valid: false,
    warmupAttempt: 0,
  }));
  const successfulRetry = ops.map((operation) => ({
    ...slot,
    role: "warmup",
    operation,
    valid: true,
    warmupAttempt: 1,
  }));
  const measured = ops.map((operation) => ({
    ...slot,
    role: "measured",
    operation,
    valid: true,
    warmupAttempt: null,
  }));
  const retryOk = collectWarmupPublicationReasons({
    profile: RUNTIME_PROFILES.publish,
    warmupSlots: [slot],
    samples: [...failedFirst, ...successfulRetry],
    requiredOps: ops,
  });
  assert.deepEqual(retryOk.fatal, []);
  const exhausted = collectWarmupPublicationReasons({
    profile: RUNTIME_PROFILES.publish,
    warmupSlots: [slot],
    samples: [...failedFirst, ...failedFirst.map((sample) => ({ ...sample, warmupAttempt: 1 }))],
    requiredOps: ops,
  });
  assert.ok(exhausted.fatal.some((reason) => /did not complete successfully/.test(reason)));
  const replaced = collectWarmupPublicationReasons({
    profile: RUNTIME_PROFILES.publish,
    warmupSlots: [slot],
    samples: [...failedFirst, ...measured],
    requiredOps: ops,
  });
  assert.ok(replaced.fatal.some((reason) => /must not replace it/.test(reason)));
  const smoke = collectWarmupPublicationReasons({
    profile: RUNTIME_PROFILES.smoke,
    warmupSlots: [slot],
    samples: failedFirst,
    requiredOps: ops,
  });
  assert.ok(smoke.denied.length > 0);
  assert.deepEqual(smoke.fatal, []);
}

{
  const warmup = harnessFailure("operation", "warmup protocol timed out");
  const teardown = harnessFailure("teardown", "Target page, context or browser has been closed", {
    secondary: true,
  });
  const root = rootHarnessFailure([teardown, warmup]);
  assert.equal(root.message, "warmup protocol timed out");
  const publication = resolveRunPublication({
    profile: RUNTIME_PROFILES.publish,
    complete: false,
    dirtyWorktree: false,
    harnessFailures: [teardown, warmup],
    publishableDeniedReasons: [],
    fatalRunReasons: [],
  });
  assert.match(publication.fatalReason ?? "", /warmup protocol timed out/);
  assert.equal(publication.publishable, false);
}

{
  const failures = [
    harnessFailure("operation", "warmup boom", {
      warmupAttempt: 0,
      lfgMode: "workerIsolated",
    }),
    harnessFailure("teardown", "Target page, context or browser has been closed", {
      secondary: true,
      warmupAttempt: 0,
      lfgMode: "workerIsolated",
    }),
  ];
  markSlotFailuresRecovered(failures, {
    lane: "react",
    appId: "lightfastgrid",
    lfgMode: "workerIsolated",
    round: 0,
    slotIndex: 0,
    warmupAttempt: 0,
  });
  assert.equal(failures[0].recovered, true);
  assert.equal(failures[1].recovered, undefined);
  assert.equal(failures[1].secondary, true);
  assert.equal(rootHarnessFailure(failures), undefined);
  const publication = resolveRunPublication({
    profile: RUNTIME_PROFILES.publish,
    complete: true,
    dirtyWorktree: false,
    harnessFailures: failures,
    publishableDeniedReasons: [],
    fatalRunReasons: [],
  });
  assert.equal(publication.complete, true);
  assert.equal(publication.fatalReason, null);
}

{
  const identity = {
    lane: "react",
    appId: "lightfastgrid",
    lfgMode: "workerIsolated",
    round: 0,
    slotIndex: 0,
    warmupAttempt: 0,
  };
  const reactVanilla = [
    harnessFailureFrom(new Error("react warmup"), {
      phase: "operation",
      lane: "react",
      appId: "lightfastgrid",
      lfgMode: "workerIsolated",
      round: 0,
      slotIndex: 0,
      warmupAttempt: 0,
    }),
    harnessFailureFrom(new Error("vanilla warmup"), {
      phase: "operation",
      lane: "vanilla",
      appId: "lightfastgrid-vanilla",
      lfgMode: "workerIsolated",
      round: 0,
      slotIndex: 0,
      warmupAttempt: 0,
    }),
  ];
  markSlotFailuresRecovered(reactVanilla, identity);
  assert.equal(reactVanilla[0].recovered, true);
  assert.equal(reactVanilla[1].recovered, undefined);
  assert.equal(rootHarnessFailure(reactVanilla)?.message, "vanilla warmup");

  const modeRound = [
    harnessFailureFrom(new Error("isolated"), {
      phase: "operation",
      ...identity,
    }),
    harnessFailureFrom(new Error("production"), {
      phase: "operation",
      ...identity,
      lfgMode: "workerProductionOptimized",
    }),
    harnessFailureFrom(new Error("round1"), {
      phase: "operation",
      ...identity,
      round: 1,
    }),
    harnessFailureFrom(new Error("ag"), {
      phase: "operation",
      ...identity,
      appId: "ag-grid",
      lfgMode: null,
    }),
  ];
  markSlotFailuresRecovered(modeRound, identity);
  assert.equal(modeRound[0].recovered, true);
  assert.equal(modeRound[1].recovered, undefined);
  assert.equal(modeRound[2].recovered, undefined);
  assert.equal(modeRound[3].recovered, undefined);

  const attempts = [
    harnessFailureFrom(new Error("attempt0"), {
      phase: "operation",
      ...identity,
      warmupAttempt: 0,
    }),
    harnessFailureFrom(new Error("attempt1"), {
      phase: "operation",
      ...identity,
      warmupAttempt: 1,
    }),
    harnessFailureFrom(new Error("measured"), {
      phase: "operation",
      ...identity,
      warmupAttempt: null,
    }),
  ];
  markSlotFailuresRecovered(attempts, identity);
  assert.equal(attempts[0].recovered, true);
  assert.equal(attempts[1].recovered, undefined);
  assert.equal(attempts[2].recovered, undefined);
  assert.equal(rootHarnessFailure(attempts)?.message, "attempt1");

  const exhausted = [
    harnessFailureFrom(new Error("attempt0"), {
      phase: "operation",
      ...identity,
      warmupAttempt: 0,
    }),
    harnessFailureFrom(new Error("attempt1"), {
      phase: "operation",
      ...identity,
      warmupAttempt: 1,
    }),
  ];
  assert.equal(exhausted[0].recovered, undefined);
  assert.equal(exhausted[1].recovered, undefined);
  assert.equal(rootHarnessFailure(exhausted)?.message, "attempt0");
  const exhaustedPublication = resolveRunPublication({
    profile: RUNTIME_PROFILES.publish,
    complete: false,
    dirtyWorktree: false,
    harnessFailures: exhausted,
    publishableDeniedReasons: ["required warmup slot did not complete successfully"],
    fatalRunReasons: ["required warmup slot did not complete successfully"],
  });
  assert.equal(exhaustedPublication.complete, false);
  assert.equal(exhaustedPublication.publishable, false);
  assert.match(exhaustedPublication.fatalReason ?? "", /attempt0/);

  const teardown = [
    harnessFailureFrom(new Error("warmup boom"), {
      phase: "operation",
      ...identity,
    }),
    harnessFailureFrom(new Error("Target page, context or browser has been closed"), {
      phase: "teardown",
      ...identity,
      secondary: true,
    }),
  ];
  markSlotFailuresRecovered(teardown, identity);
  assert.equal(teardown[0].recovered, true);
  assert.equal(teardown[1].recovered, undefined);
  assert.equal(teardown[1].secondary, true);
  assert.equal(rootHarnessFailure(teardown), undefined);
  const afterRetry = resolveRunPublication({
    profile: RUNTIME_PROFILES.publish,
    complete: true,
    dirtyWorktree: false,
    harnessFailures: teardown,
    publishableDeniedReasons: [],
    fatalRunReasons: [],
  });
  assert.equal(afterRetry.fatalReason, null);
  assert.doesNotMatch(afterRetry.fatalReason ?? "", /Target page, context or browser has been closed/);
}

{
  assert.equal(equalComputeConfirmed(cpuThrottle), false);
  assert.equal(equalComputeConfirmed(nativeCpuThrottle), true);
  const nativeWritten = writeToTemp({
    profile: RUNTIME_PROFILES["publish-native"],
    complete: true,
    publishable: false,
    dirtyWorktree: false,
    publishableDeniedReasons: ["test"],
    fatalRunReasons: [],
    fatalReason: null,
    samples: fillMeasuredSamples(10),
    cpuThrottle: nativeCpuThrottle,
    environment: {
      ...environmentFixture(false),
      profile: "publish-native",
      cpuThrottle: nativeCpuThrottle,
    },
  }).written;
  assert.equal(nativeWritten.profile, "publish-native");
  assert.equal(nativeWritten.cpuThrottle.requestedRate, 1);
  assert.equal(nativeWritten.cpuThrottle.cdpThrottleApplied, false);
  assert.match(nativeWritten.cpuThrottle.equalComputeNote ?? "", /does not prove 4x/i);
  const nativePublishable = JSON.parse(JSON.stringify(nativeWritten));
  nativePublishable.publishable = true;
  nativePublishable.methodology.provisional = false;
  nativePublishable.methodology.intendsPublicCandidateStatistics = true;
  nativePublishable.quickSearchModeComparison.provisional = false;
  nativePublishable.quickSearchModeComparison.provisionalReasons = [];
  nativePublishable.quickSearchModeComparison.workerThrottleConfirmed = true;
  nativePublishable.filterModeComparison.provisional = false;
  nativePublishable.filterModeComparison.provisionalReasons = [];
  nativePublishable.filterModeComparison.workerThrottleConfirmed = true;
  nativePublishable.publishableDeniedReasons = [];
  assertMergedRuntimeReport(nativePublishable);
  nativePublishable.quickSearchModeComparison.provisional = true;
  assert.throws(
    () => assertMergedRuntimeReport(nativePublishable),
    /publishable: true is incompatible with quickSearchModeComparison.provisional: true/,
  );
}

{
  const publication = resolveRunPublication({
    profile: RUNTIME_PROFILES["publish-native"],
    complete: true,
    dirtyWorktree: false,
    harnessFailures: [],
    publishableDeniedReasons: [],
    fatalRunReasons: [],
    quickSearchModeComparison: {
      workerThrottleConfirmed: true,
      provisional: false,
      provisionalReasons: [],
      interpretation: {
        workerIsNotAutomaticallyFaster: true,
        reportLatencyAndResponsivenessSideBySide: true,
        noWinnerField: true,
        forcedMainThreadIsNotACompetitor: true,
        noLatencyWinWithoutLowerCompletion: true,
        noWorkerWinFromSmallerLongTaskAlone: true,
        advantageAttribution: [],
      },
      comparisons: [],
      lanes: buildQuickSearchModeComparison([], true, [], { requireCdpWorkerThrottle: false }).lanes,
    },
  });
  assert.equal(publication.publishable, true);
  assert.doesNotMatch(JSON.stringify(publication), /"winner"/);
}

{
  const belowThreshold = {
    valid: false,
    role: "measured",
    operation: "quickSearch",
    invalidReason: "worker-route-unconfirmed",
    invalidMessage: 'workerIsolated requires producer "worker", got "mainThread"',
    lfgMode: "workerIsolated",
    appId: "lightfastgrid",
    lane: "react",
  };
  assert.equal(isExpectedBelowThresholdWorkerRouteInvalid(belowThreshold, 10_000), true);
  assert.equal(isExpectedBelowThresholdWorkerRouteInvalid(belowThreshold, 100_000), false);
  const remountTimeout = {
    valid: false,
    role: "measured",
    operation: "quickSearchTypingBurst",
    invalidReason: "invalid-setup-state",
    invalidMessage: "unrecorded remount failed: AG Grid React Community mount first data rendered timed out after 30000ms",
    lfgMode: null,
    appId: "ag-grid",
    lane: "react",
  };
  const unexpected = unexpectedInvalidMeasuredReasons(
    [belowThreshold, remountTimeout],
    10_000,
  );
  assert.equal(unexpected.length, 1);
  assert.match(unexpected[0], /ag-grid/);
  assert.match(unexpected[0], /invalid-setup-state/);
  assert.deepEqual(
    unexpectedInvalidMeasuredReasons([{ ...remountTimeout, role: "warmup" }, belowThreshold], 10_000),
    [],
  );
  const hidden = resolveRunPublication({
    profile: RUNTIME_PROFILES.smoke,
    complete: false,
    dirtyWorktree: false,
    harnessFailures: [],
    publishableDeniedReasons: [],
    fatalRunReasons: unexpected,
  });
  assert.equal(hidden.complete, false);
  assert.equal(hidden.publishable, false);
  assert.match(hidden.fatalReason ?? "", /invalid-setup-state/);
}

console.log(
  "Runtime harness tests passed: setup-reset validation, Filter/QS isolation, failure evidence files, P95 publication-state invariants, fatal-reason priority, owned slot lifecycle, warmup recovery identity, unexpected invalid measured samples.",
);
