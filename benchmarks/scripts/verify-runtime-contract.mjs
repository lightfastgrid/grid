#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RUNTIME_GRID_APP_IDS } from "./lib/paths.mjs";
import { summarizeNumeric } from "../tests/performance/metrics/summarize.ts";
import { assertRuntimeSummary } from "../tests/performance/metrics/schema.ts";
import { RUNTIME_PROFILES } from "../tests/performance/fixtures/profiles.ts";
import { buildRuntimeSchedule } from "../tests/performance/fixtures/schedule.ts";
import { computeExpectedOperations } from "../shared/src/expectedOperations.ts";
import { getScenario } from "../shared/src/scenarios.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const operations = JSON.parse(
  readFileSync(join(root, "tests/performance/fixtures/operations.json"), "utf8"),
);
assert.equal(operations.sort.field, "name");
assert.equal(operations.filter.field, "status");
assert.equal(operations.filters.text.value, "Active");
assert.equal(operations.filters.numberRange.minimum, 25000);
assert.equal(operations.filters.numberRange.maximum, 75000);
assert.equal(operations.filters.numberRange.inclusive, true);
assert.equal(operations.filters.combined.logic, "and");
assert.deepEqual(operations.filters.typing.prefixes, ["P", "Pa", "Pat", "Pate", "Patel"]);
assert.equal(operations.filters.typing.intervalMs, 120);
assert.equal(operations.quickSearch.text, "Patel");
assert.deepEqual(operations.quickSearchTyping.prefixes, ["P", "Pa", "Pat", "Pate", "Patel"]);
assert.equal(operations.quickSearchTyping.intervalMs, 120);
assert.ok(operations.scrollTo.top > 0);

assert.deepEqual(RUNTIME_GRID_APP_IDS, [
  "lightfastgrid",
  "ag-grid",
  "lightfastgrid-vanilla",
  "ag-grid-vanilla",
]);

const playwrightConfig = readFileSync(join(root, "playwright.config.ts"), "utf8");
assert.match(playwrightConfig, /fullyParallel:\s*false/);
assert.match(playwrightConfig, /workers:\s*1/);
assert.match(playwrightConfig, /browserName:\s*"chromium"/);
assert.doesNotMatch(playwrightConfig, /firefox|webkit/);
assert.doesNotMatch(playwrightConfig, /projects:\s*\[/);
assert.match(playwrightConfig, /orchestrator\.spec\.ts/);

const throttleSource = readFileSync(
  join(root, "tests/performance/fixtures/cpuThrottle.ts"),
  "utf8",
);
assert.match(throttleSource, /newCDPSession/);
assert.match(throttleSource, /Emulation\.setCPUThrottlingRate/);
assert.match(throttleSource, /Browser\.getVersion/);
assert.match(throttleSource, /rate:\s*4|requestedRate: rate/);
assert.match(throttleSource, /workerThrottle/);
assert.match(throttleSource, /confirmedEquivalentToPage/);
assert.match(throttleSource, /Target\.sendMessageToTarget/);
assert.match(throttleSource, /quickSearchWorker/);
assert.match(throttleSource, /awaitNestedThrottleAcknowledgement|receivedMessageFromTarget/);
assert.match(throttleSource, /claimWorkerThrottleTarget|nextCommandId/);
assert.match(throttleSource, /applyCdpThrottle|native-1x|cdpThrottleApplied/);
assert.match(throttleSource, /equalComputeConfirmed/);

const orchestrator = readFileSync(
  join(root, "tests/performance/runtime/orchestrator.spec.ts"),
  "utf8",
);
assert.match(orchestrator, /buildRuntimeSchedule/);
assert.match(orchestrator, /applyCpuThrottling/);
assert.match(orchestrator, /writeRuntimeEvidenceSafely/);
assert.match(orchestrator, /writeOrchestratorCompleteMarker/);
assert.match(orchestrator, /failAfterEvidenceWrite/);
assert.match(orchestrator, /acquireOwnedContext/);
assert.match(orchestrator, /runOwnedSlot/);
assert.match(orchestrator, /closeOwnedContext/);
assert.match(orchestrator, /let context: BrowserContext \| null = null/);
assert.match(orchestrator, /trace\.incomplete\.zip/);
assert.doesNotMatch(orchestrator, /const context = await browser\.newContext/);
assert.match(orchestrator, /lfgQuickSearchMode/);
assert.match(orchestrator, /typeQuickSearch|quickSearchTypingBurst/);
assert.match(orchestrator, /workerThrottle/);
assert.match(orchestrator, /buildQuickSearchComparisonForRun/);
assert.match(orchestrator, /collectWarmupPublicationReasons/);
assert.match(orchestrator, /shouldRetryWarmup/);
assert.match(orchestrator, /markSlotFailuresRecovered/);
assert.match(orchestrator, /warmupAttempt:\s*0/);
assert.match(orchestrator, /stopAllOwnedProcesses/);
assert.match(orchestrator, /lfgMode: current\.lfgMode/);
assert.match(orchestrator, /applyCdpThrottle/);

const protocolClient = readFileSync(
  join(root, "tests/performance/fixtures/protocolClient.ts"),
  "utf8",
);
const durationAt = protocolClient.indexOf("const durationMs = performance.now() - started");
const visibleAt = protocolClient.indexOf("visible: api.getVisibleState()");
assert.ok(durationAt >= 0 && visibleAt > durationAt, "getVisibleState must run after durationMs is captured");
assert.doesNotMatch(protocolClient, /resyncInspection/);

assert.equal(RUNTIME_PROFILES.smoke.scenario, "normal");
assert.equal(RUNTIME_PROFILES.smoke.warmupRounds, 1);
assert.equal(RUNTIME_PROFILES.smoke.measuredRounds, 1);
assert.equal(RUNTIME_PROFILES.smoke.cpuThrottleRequired, false);
assert.equal(RUNTIME_PROFILES.smoke.statisticsRole, "diagnostic");
assert.match(RUNTIME_PROFILES.smoke.workerEligibilityNote, /not Worker performance evidence/i);

assert.equal(RUNTIME_PROFILES.publish.scenario, "runtime-publish");
assert.equal(RUNTIME_PROFILES.publish.warmupRounds, 3);
assert.ok(RUNTIME_PROFILES.publish.measuredRounds >= 10);
assert.equal(RUNTIME_PROFILES.publish.cpuThrottlePolicy, "cdp-4x");
assert.equal(RUNTIME_PROFILES["publish-native"].scenario, "runtime-publish");
assert.equal(RUNTIME_PROFILES["publish-native"].cpuThrottlePolicy, "native-1x");
assert.equal(RUNTIME_PROFILES["publish-native"].cpuThrottleRequired, false);
assert.equal(RUNTIME_PROFILES["publish-native"].cpuThrottleRate, 1);
assert.equal(RUNTIME_PROFILES["publish-native"].statisticsRole, "public-candidate");
assert.equal(RUNTIME_PROFILES["publish-native"].warmupRounds, 3);
assert.ok(RUNTIME_PROFILES["publish-native"].measuredRounds >= 10);

assert.equal(RUNTIME_PROFILES.trace.tracing, true);
assert.equal(RUNTIME_PROFILES.trace.statisticsRole, "diagnostic");

const reactSchedule = buildRuntimeSchedule(1, 2).lanes.react.slots.map(
  (slot) => `${slot.appId}:${slot.purpose}:${slot.lfgMode ?? "default"}`,
);
assert.deepEqual(reactSchedule, [
  "lightfastgrid:competitive:default",
  "ag-grid:competitive:default",
  "lightfastgrid:quickSearch:workerIsolated",
  "lightfastgrid:quickSearch:mainThreadIsolated",
  "lightfastgrid:quickSearch:workerProductionOptimized",
  "ag-grid:quickSearch:default",
  "ag-grid:quickSearch:default",
  "lightfastgrid:quickSearch:workerProductionOptimized",
  "lightfastgrid:quickSearch:mainThreadIsolated",
  "lightfastgrid:quickSearch:workerIsolated",
  "ag-grid:competitive:default",
  "lightfastgrid:competitive:default",
  "lightfastgrid:competitive:default",
  "ag-grid:competitive:default",
  "lightfastgrid:quickSearch:workerIsolated",
  "lightfastgrid:quickSearch:mainThreadIsolated",
  "lightfastgrid:quickSearch:workerProductionOptimized",
  "ag-grid:quickSearch:default",
]);

const expected = computeExpectedOperations("normal");
assert.equal(expected.rowCount, 10000);
assert.equal(expected.columnCount, 20);
assert.ok(expected.filter.displayedRowCount > 0);
assert.ok(expected.filter.displayedRowCount < expected.rowCount);
assert.ok(expected.filters.numberRange.displayedRowCount > 0);
assert.ok(expected.filters.combined.displayedRowCount <= expected.filters.text.displayedRowCount);
assert.ok(expected.filters.combined.displayedRowCount <= expected.filters.numberRange.displayedRowCount);
assert.equal(expected.filters.typing.intervalMs, 120);
assert.equal(expected.datasetSha256.length, 64);
assert.equal(expected.columnSchemaSha256.length, 64);
assert.deepEqual(expected.quickSearch.typingPrefixes, ["P", "Pa", "Pat", "Pate", "Patel"]);
assert.equal(expected.quickSearch.typingIntervalMs, 120);
assert.equal(expected.quickSearch.primingText, "Morgan");
assert.ok(expected.quickSearch.typingDisplayedRowCounts.Patel === expected.quickSearch.displayedRowCount);
assert.ok(expected.quickSearch.typingDisplayedRowCounts.P >= expected.quickSearch.displayedRowCount);
assert.ok(expected.sort.representativeRowIds.length > 0);
assert.equal(expected.scroll.tolerancePx, 2);

const summary = summarizeNumeric([10, 20, 30, 40, 50]);
assert.equal(summary.n, 5);
assert.equal(summary.median, 30);
assert.equal(summary.p50, 30);
assert.equal(summary.p75, 40);

const emptyApps = {
  react: {
    lane: "react",
    applications: {
      lightfastgrid: { appId: "lightfastgrid", lane: "react", operations: {} },
      "ag-grid": { appId: "ag-grid", lane: "react", operations: {} },
    },
  },
  vanilla: {
    lane: "vanilla",
    applications: {
      "lightfastgrid-vanilla": {
        appId: "lightfastgrid-vanilla",
        lane: "vanilla",
        operations: {},
      },
      "ag-grid-vanilla": { appId: "ag-grid-vanilla", lane: "vanilla", operations: {} },
    },
  },
};

assert.throws(
  () =>
    assertRuntimeSummary({
      generatedAt: "",
      runId: "x",
      profile: "smoke",
      complete: true,
      publishable: false,
      publishableDeniedReasons: [],
      fatalReason: null,
      winner: "lightfastgrid",
      methodology: { buildMode: "runtime", browserName: "chromium" },
      environment: {},
      cpuThrottle: {
        requestedRate: 4,
        appliedRate: 4,
        cdpAvailable: true,
        appliedBeforeTimedWork: true,
        failureReason: null,
        chromiumProduct: "HeadlessChrome/141.0.7390.37",
      },
      lanes: emptyApps,
    }),
  /must not declare a winner/,
);

const harnessFailures = readFileSync(
  join(root, "tests/performance/fixtures/harnessFailures.ts"),
  "utf8",
);
assert.match(harnessFailures, /context-create/);
assert.match(harnessFailures, /page-create/);
assert.match(harnessFailures, /guard-attach/);
assert.match(harnessFailures, /rootHarnessFailure/);
assert.match(harnessFailures, /formatHarnessFatalReason/);

const evidence = readFileSync(
  join(root, "tests/performance/fixtures/evidence.ts"),
  "utf8",
);
assert.match(evidence, /rootHarnessFailure/);
assert.match(evidence, /quickSearchModeComparison/);
assert.match(evidence, /collectQuickSearchComparisonReasons|comparisonReasonsForPublication/);
assert.match(evidence, /formatHarnessFatalReason/);
assert.match(evidence, /writeOrchestratorCompleteMarker/);

const slotLifecycle = readFileSync(
  join(root, "tests/performance/fixtures/slotLifecycle.ts"),
  "utf8",
);
assert.match(slotLifecycle, /cleanupOwnedSlot/);
assert.match(slotLifecycle, /isAlreadyClosedCleanupError/);
assert.match(slotLifecycle, /tracingStarted && options\.stopTracing/);

const instrumentation = readFileSync(join(root, "shared/src/instrumentation.ts"), "utf8");
assert.match(instrumentation, /supported:\s*true/);
assert.match(instrumentation, /supported:\s*false/);
const pageGuards = readFileSync(join(root, "tests/performance/fixtures/pageGuards.ts"), "utf8");
assert.match(pageGuards, /unhandledrejection/);
assert.match(pageGuards, /unhandled-rejection/);

const runRuntime = readFileSync(join(root, "scripts/run-runtime.mjs"), "utf8");
assert.match(runRuntime, /publish-native/);
assert.match(runRuntime, /fatalPublishReasons/);
assert.match(runRuntime, /assertMergedRuntimeReport/);
assert.doesNotMatch(runRuntime, /if \(!summary\.publishable\) \{\s*throw/);
assert.doesNotMatch(runRuntime, /playwright",\s*\["install"/);

const workload = readFileSync(join(root, "tests/performance/fixtures/workload.ts"), "utf8");
assert.match(workload, /evaluateSetupReset/);
assert.match(workload, /invalid-setup-state/);
assert.match(workload, /durationMs: null/);
assert.doesNotMatch(
  workload,
  /await measureProtocolCall\(page, "clearOperations"[\s\S]*?await drainIssues\(\);\s*await runOp\(filter/,
);

const settlement = readFileSync(join(root, "shared/src/lightfastgridSettlement.ts"), "utf8");
assert.doesNotMatch(settlement, /2_500|2500|aria-rowcount/);
assert.match(settlement, /waitForLightFastGridQuickSearchSettlement/);

const typing = readFileSync(join(root, "shared/src/typingSession.ts"), "utf8");
assert.match(typing, /QUICK_SEARCH_TYPING_INTERVAL_MS = 120/);
assert.match(typing, /"P", "Pa", "Pat", "Pate", "Patel"/);
assert.match(typing, /variant === "burst"/);
assert.match(typing, /finalKeystrokeToFinalPaintMs/);
assert.match(typing, /cadenceWaitMs/);
assert.doesNotMatch(typing, /setTimeout\(resolve, 2500\)|sleep\(.*final/);
const dispatchAt = typing.indexOf("const dispatchAtMs = performance.now()");
const setTextAt = typing.indexOf("adapter.setText(prefix)");
assert.ok(
  dispatchAt >= 0 && setTextAt > dispatchAt,
  "burst dispatch timestamp must be captured before adapter.setText(prefix)",
);

const lfgMode = readFileSync(join(root, "shared/src/lfgQuickSearchMode.ts"), "utf8");
assert.match(lfgMode, /workerIsolated/);
assert.match(lfgMode, /mainThreadIsolated/);
assert.match(lfgMode, /workerProductionOptimized/);
assert.match(lfgMode, /ROW_COUNT|rowCount \+ 1/);
assert.match(lfgMode, /cache: false, prewarm: false/);
assert.match(lfgMode, /producer === "worker"/);
assert.match(lfgMode, /interpretProductionQuickSearchProducer/);
assert.match(lfgMode, /supportsWorkerPerformanceClaim/);

for (const rel of [
  "apps/lightfastgrid/src/protocol.tsx",
  "apps/lightfastgrid-vanilla/src/protocol.ts",
  "apps/ag-grid/src/protocol.tsx",
  "apps/ag-grid-vanilla/src/protocol.ts",
  "apps/react-baseline/src/protocol.tsx",
  "apps/vanilla-baseline/src/protocol.ts",
]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.match(source, /async typeQuickSearch/, `${rel} must implement typeQuickSearch`);
  assert.match(source, /getQuickSearchExecutionEvidence/, `${rel} must implement getQuickSearchExecutionEvidence`);
  assert.match(source, /async applyFilterModel/, `${rel} must implement applyFilterModel`);
  assert.match(source, /async typeColumnFilter/, `${rel} must implement typeColumnFilter`);
  assert.match(source, /getFilterExecutionEvidence/, `${rel} must implement getFilterExecutionEvidence`);
}
for (const rel of [
  "apps/lightfastgrid/src/protocol.tsx",
  "apps/lightfastgrid-vanilla/src/protocol.ts",
]) {
  const source = readFileSync(join(root, rel), "utf8");
  assert.match(
    source,
    /attachLightFastGridProducerProbe/,
    `${rel} must attach the benchmark-only Quick Search producer probe`,
  );
  assert.match(source, /beginCommand/, `${rel} must checkpoint producer evidence per command`);
}

const lfgReact = readFileSync(join(root, "apps/lightfastgrid/src/protocol.tsx"), "utf8");
assert.match(
  lfgReact,
  /import \{ flushSync \} from "react-dom";/,
  "LightFastGrid React benchmark teardown must import flushSync",
);
assert.match(
  lfgReact,
  /async destroy\(\)[\s\S]*?flushSync\(\(\) => \{[\s\S]*?status="Destroyed"[\s\S]*?\}\);/,
  "LightFastGrid React benchmark must commit the destroyed shell before a fresh remount",
);

const producerProbeSrc = readFileSync(join(root, "shared/src/lightfastgridProducer.ts"), "utf8");
assert.match(producerProbeSrc, /beginCommand/);
assert.match(producerProbeSrc, /filterCommandEvidence/);
assert.match(producerProbeSrc, /producer: "none"/);
assert.match(producerProbeSrc, /duringSchedule/);

const correctnessSrc = readFileSync(join(root, "tests/performance/fixtures/correctness.ts"), "utf8");
assert.match(correctnessSrc, /cannot inherit Apply producer evidence/);
assert.match(correctnessSrc, /command === "clear"|operation === "clear"/);

const agReact = readFileSync(join(root, "apps/ag-grid/src/protocol.tsx"), "utf8");
const agVanilla = readFileSync(join(root, "apps/ag-grid-vanilla/src/protocol.ts"), "utf8");
assert.match(agReact, /cacheQuickFilter/);
assert.match(agVanilla, /cacheQuickFilter:\s*true/);
assert.doesNotMatch(agReact, /2_500|2500/);
assert.doesNotMatch(agVanilla, /2_500|2500/);

const architecture = readFileSync(
  join(root, "../engineering/architectures/benchmarks/GRID_COMPARISON_BENCHMARK_V1_ARCHITECTURE.md"),
  "utf8",
);
assert.match(architecture, /typeQuickSearch/);
assert.match(architecture, /workerIsolated/);
assert.match(architecture, /forcedMainThread/);
assert.match(architecture, /120 ms/);
assert.match(architecture, /quickSearchModeComparison/);
assert.match(architecture, /Required-test count: 56/);
assert.match(architecture, /publish-native/);
assert.match(architecture, /collectQuickSearchComparisonReasons/);
assert.match(architecture, /100,000 × 50/);
assert.match(architecture, /filterTextApply/);

const readme = readFileSync(join(root, "README.md"), "utf8");
assert.match(readme, /typeQuickSearch/);
assert.match(readme, /workerIsolated/);
assert.match(readme, /forcedMainThread|mainThreadIsolated/);
assert.match(readme, /cacheQuickFilter/);
assert.match(readme, /publish-native|runtime:native/);
assert.match(readme, /process\.execPath/);
assert.match(readme, /SIGKILL of the harness/);
assert.match(readme, /100,000 × 50/);
assert.match(readme, /filterTextApply/);

const previewServer = readFileSync(
  join(root, "tests/performance/fixtures/previewServer.ts"),
  "utf8",
);
assert.match(previewServer, /process\.execPath/);
assert.match(previewServer, /vite\/package\.json/);
assert.match(previewServer, /bin\/vite\.js/);
assert.doesNotMatch(previewServer, /spawn\(\s*["']pnpm["']/);
assert.doesNotMatch(previewServer, /\bpkill\b/);

const staticPreview = readFileSync(
  join(root, "scripts/verify-static-preview.mjs"),
  "utf8",
);
assert.match(staticPreview, /process\.execPath/);
assert.match(staticPreview, /resolveViteCli/);
assert.doesNotMatch(staticPreview, /spawn\(\s*["']pnpm["']/);

const ownedProcess = readFileSync(
  join(root, "tests/performance/fixtures/ownedProcess.ts"),
  "utf8",
);
assert.match(ownedProcess, /SIGKILL cannot be caught/);
assert.match(ownedProcess, /handleHarnessInterrupt/);
assert.match(ownedProcess, /130/);
assert.match(ownedProcess, /143/);
assert.doesNotMatch(ownedProcess, /\bpkill\b/);
assert.doesNotMatch(ownedProcess, /void stopAllOwnedProcesses\(\)/);

assert.match(previewServer, /throwPreviewStartFailure/);
assert.match(previewServer, /AggregateError/);

assert.match(orchestrator, /unexpectedInvalidMeasuredReasons/);

const harnessFailuresSrc = readFileSync(
  join(root, "tests/performance/fixtures/harnessFailures.ts"),
  "utf8",
);
assert.match(harnessFailuresSrc, /warmupAttempt !== 0/);
assert.match(harnessFailuresSrc, /failure\.lane !== identity\.lane/);
assert.match(harnessFailuresSrc, /WarmupRecoveryIdentity/);

assert.match(workload, /quickSearchTypingBurst/);
assert.match(workload, /quickSearchPrimedDifferent/);
assert.match(workload, /quickSearchRepeatedSame/);
assert.match(workload, /isolatedQuickSearchPlan/);
assert.match(workload, /isolatedFilterPlan/);
assert.match(workload, /applyFilterModel/);
assert.match(workload, /typeColumnFilter/);
assert.doesNotMatch(workload, /quickSearchWarm/);
assert.match(workload, /finalKeystrokeToFinalPaintMs/);
assert.match(workload, /purpose === "quickSearch"/);

const filterScenariosSrc = readFileSync(
  join(root, "shared/src/filterScenarios.ts"),
  "utf8",
);
assert.match(filterScenariosSrc, /filterTextApply/);
assert.match(filterScenariosSrc, /filterNumberRangeApply/);
assert.match(filterScenariosSrc, /filterCombinedApply/);
assert.match(filterScenariosSrc, /filterTypingBurst/);
assert.match(filterScenariosSrc, /purpose === "quickSearch"/);

assert.equal(RUNTIME_PROFILES.publish.scenario, "runtime-publish");
assert.equal(getScenario("runtime-publish").rowCount, 100_000);
assert.equal(getScenario("runtime-publish").columnCount, 50);

const evidenceSrc = readFileSync(
  join(root, "tests/performance/fixtures/evidence.ts"),
  "utf8",
);
assert.match(evidenceSrc, /filterModeComparison/);
assert.match(evidenceSrc, /buildFilterComparisonForRun|buildFilterModeComparison/);

const promotionSrc = readFileSync(
  join(root, "scripts/lib/assert-runtime-promotion.mjs"),
  "utf8",
);
assert.match(promotionSrc, /publish-native/);
assert.match(promotionSrc, /CANONICAL_PUBLIC_ROW_COUNT/);
assert.match(promotionSrc, /must not declare a winner/);
assert.match(promotionSrc, /Filter comparison must be non-provisional/);
assert.match(promotionSrc, /collectFilterProducerPromotionReasons/);
assert.match(promotionSrc, /must not treat Clear as Filter Worker evidence/);

const evidenceVerifier = readFileSync(
  join(root, "scripts/verify-runtime-evidence.mjs"),
  "utf8",
);
assert.match(evidenceVerifier, /SHA-256/);
assert.match(evidenceVerifier, /must not declare a winner/);
assert.match(evidenceVerifier, /rowCount/);

console.log(
  "Runtime contract verified: CDP throttle command, smoke/publish profiles, AB/BA competitive+Quick Search schedule, typing prefixes, Worker-mode matrix, no ranking field, observers report availability.",
);
