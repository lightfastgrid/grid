#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LANES, appDir } from "./lib/paths.mjs";
import { assertBundleSizeReport } from "./lib/report-schema.mjs";
import { isForbiddenVanillaModuleId } from "../shared/vite.app.mjs";
import {
  LIGHTFASTGRID_BENCHMARK_HEADER_ROWS,
  readLightFastGridDisplayedRowCount,
  readLightFastGridProcessedDisplayedRowCount,
} from "../shared/src/displayedRowCount.ts";
import { waitForGridEvent } from "../shared/src/completion.ts";
import {
  agGridMountIsReady,
  agGridMountShellIsClear,
} from "../shared/src/agGridMountReadiness.ts";
import { waitForLightFastGridQuickSearchSettlement } from "../shared/src/lightfastgridSettlement.ts";
import {
  lightFastGridQuickSearchMountConfig,
  resolveLfgQuickSearchModeFromSearch,
} from "../shared/src/lfgQuickSearchMode.ts";
import { runQuickSearchTypingSession } from "../shared/src/typingSession.ts";
import { validateQuickSearchExecutionRoute, validateFilterExecutionEvidence } from "../tests/performance/fixtures/correctness.ts";
import { buildRuntimeSchedule } from "../tests/performance/fixtures/schedule.ts";
import { computeExpectedOperations } from "../shared/src/expectedOperations.ts";
import {
  FILTER_COMBINED_MODEL,
  FILTER_NUMBER_MODEL,
  FILTER_TEXT_MODEL,
  isolatedFilterPlan,
  requiredOperationsForPurpose,
} from "../shared/src/filterScenarios.ts";
import {
  countRowsMatchingNeutralFilter,
  fromAgGridFilterModel,
  fromLightFastGridFilterModel,
  numberBetweenFilter,
  textContainsFilter,
  toAgGridFilterModel,
  toLightFastGridFilterModel,
} from "../shared/src/neutralFilter.ts";
import { attachLightFastGridProducerProbe } from "../shared/src/lightfastgridProducer.ts";
import { buildLfgFilterEvidence } from "../shared/src/filterExecution.ts";
import { collectDuplicateWeightingReasons, buildFilterModeComparison } from "../tests/performance/metrics/modeComparison.ts";
import { CANONICAL_PUBLIC_COLUMN_COUNT, CANONICAL_PUBLIC_ROW_COUNT } from "../shared/src/canonicalPublicScenario.ts";
import { getScenario } from "../shared/src/scenarios.ts";
import {
  assertPromotableRuntimeArtifact,
  collectFilterProducerPromotionReasons,
} from "./lib/assert-runtime-promotion.mjs";

function hostWithAriaRowCount(value) {
  return {
    querySelector(selector) {
      if (selector !== ".lfg-grid-surface") return null;
      return {
        getAttribute(name) {
          return name === "aria-rowcount" ? String(value) : null;
        },
      };
    },
  };
}

const FULL_DATASET = 10_000;
const FULL_ARIA = FULL_DATASET + LIGHTFASTGRID_BENCHMARK_HEADER_ROWS;
const NARROWED = 17;
const NARROWED_ARIA = NARROWED + LIGHTFASTGRID_BENCHMARK_HEADER_ROWS;

assert.equal(
  readLightFastGridDisplayedRowCount(hostWithAriaRowCount(FULL_ARIA)),
  FULL_DATASET,
  "initial displayed count is the full dataset",
);
assert.equal(
  readLightFastGridDisplayedRowCount(hostWithAriaRowCount(NARROWED_ARIA)),
  NARROWED,
  "Quick Search narrows the displayed count",
);
assert.equal(
  readLightFastGridDisplayedRowCount(hostWithAriaRowCount(FULL_ARIA)),
  FULL_DATASET,
  "clearing Quick Search restores the full count",
);

const reactCount = readLightFastGridDisplayedRowCount(hostWithAriaRowCount(NARROWED_ARIA));
const vanillaCount = readLightFastGridDisplayedRowCount(hostWithAriaRowCount(NARROWED_ARIA));
assert.equal(
  reactCount,
  vanillaCount,
  "React and Vanilla drivers use the same displayed-row helper",
);

assert.equal(LANES.react.baselineAppId, "react-baseline");
assert.equal(LANES.vanilla.baselineAppId, "vanilla-baseline");
assert.deepEqual(LANES.react.gridAppIds, ["lightfastgrid", "ag-grid"]);
assert.deepEqual(LANES.vanilla.gridAppIds, ["lightfastgrid-vanilla", "ag-grid-vanilla"]);

assert.equal(isForbiddenVanillaModuleId("node_modules/react/index.js"), true);
assert.equal(isForbiddenVanillaModuleId("node_modules/react-dom/client.js"), true);
assert.equal(isForbiddenVanillaModuleId("node_modules/react/jsx-runtime.js"), true);
assert.equal(
  isForbiddenVanillaModuleId("node_modules/@lightfastgrid/react/dist/index.mjs"),
  true,
);
assert.equal(isForbiddenVanillaModuleId("node_modules/@lightfastgrid/core/dist/index.mjs"), false);
assert.equal(isForbiddenVanillaModuleId("node_modules/ag-grid-community/dist/package/main.esm.mjs"), false);

const validReport = {
  methodology: { buildMode: "bundle" },
  lanes: {
    react: {
      baselineAppId: "react-baseline",
      incrementalGridEstimate: {
        lightfastgrid: { isEstimate: true, baselineAppId: "react-baseline" },
        "ag-grid": { isEstimate: true, baselineAppId: "react-baseline" },
      },
    },
    vanilla: {
      baselineAppId: "vanilla-baseline",
      incrementalGridEstimate: {
        "lightfastgrid-vanilla": { isEstimate: true, baselineAppId: "vanilla-baseline" },
        "ag-grid-vanilla": { isEstimate: true, baselineAppId: "vanilla-baseline" },
      },
    },
  },
};
assertBundleSizeReport(validReport);
assert.throws(
  () =>
    assertBundleSizeReport({
      ...validReport,
      incrementalGridEstimate: validReport.lanes.react.incrementalGridEstimate,
    }),
  /must not have a top-level incrementalGridEstimate/,
);
assert.throws(
  () =>
    assertBundleSizeReport({
      ...validReport,
      lanes: {
        ...validReport.lanes,
        vanilla: {
          ...validReport.lanes.vanilla,
          incrementalGridEstimate: {
            "lightfastgrid-vanilla": {
              isEstimate: true,
              baselineAppId: "react-baseline",
            },
          },
        },
      },
    }),
  /matching vanilla baseline/,
);

let timeoutUnsubscribed = 0;
await assert.rejects(
  () =>
    waitForGridEvent({
      appLabel: "TestApp",
      operation: "sort",
      timeoutMs: 40,
      subscribe: () => () => {
        timeoutUnsubscribed += 1;
      },
      afterSubscribe: () => {},
    }),
  /TestApp sort did not receive an accepted event timed out after 40ms/,
);
assert.equal(timeoutUnsubscribed, 1, "timed-out waits must unsubscribe listeners");

let thrownUnsubscribed = 0;
await assert.rejects(
  () =>
    waitForGridEvent({
      appLabel: "TestApp",
      operation: "filter",
      timeoutMs: 1_000,
      subscribe: () => () => {
        thrownUnsubscribed += 1;
      },
      afterSubscribe: () => {
        throw new Error("boom");
      },
    }),
  /TestApp filter command failed: boom/,
);
assert.equal(thrownUnsubscribed, 1, "thrown commands must unsubscribe listeners");

let successUnsubscribed = 0;
const accepted = await waitForGridEvent({
  appLabel: "TestApp",
  operation: "quickSearch",
  timeoutMs: 1_000,
  subscribe: (handler) => {
    handler("ok");
    return () => {
      successUnsubscribed += 1;
    };
  },
  afterSubscribe: () => {},
});
assert.equal(accepted, "ok");
assert.equal(successUnsubscribed, 1, "successful waits must unsubscribe listeners");

assert.equal(
  readLightFastGridProcessedDisplayedRowCount({
    state: {
      captureReadSnapshot() {
        return { fullView: { rowCount: NARROWED }, currentPageView: { rowCount: NARROWED } };
      },
    },
  }),
  NARROWED,
  "processed displayed count comes from the snapshot row model, not source rows",
);
assert.throws(
  () =>
    readLightFastGridProcessedDisplayedRowCount({
      getRows() {
        return Array.from({ length: FULL_DATASET });
      },
      getRowCount() {
        return FULL_DATASET;
      },
    }),
  /processed displayed-row count is unavailable/,
);

const processedReact = readLightFastGridProcessedDisplayedRowCount({
  state: { captureReadSnapshot: () => ({ fullView: { rowCount: 42 } }) },
});
const processedVanilla = readLightFastGridProcessedDisplayedRowCount({
  state: { captureReadSnapshot: () => ({ fullView: { rowCount: 42 } }) },
});
assert.equal(processedReact, processedVanilla);

if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
}

{
  let pending = true;
  const sawPending = true;
  setTimeout(() => {
    pending = false;
  }, 15);
  const started = Date.now();
  await waitForLightFastGridQuickSearchSettlement({
    appLabel: "TestApp",
    operation: "quickSearch",
    isPending: () => pending,
    sawPending: () => sawPending,
  });
  const elapsed = Date.now() - started;
  assert.ok(
    elapsed < 5_000,
    `pending latch must clear when pending becomes false even if sawPending stays true (elapsed ${elapsed}ms)`,
  );
}

for (const id of ["lightfastgrid", "lightfastgrid-vanilla"]) {
  const protocol = readFileSync(
    join(appDir(id), "src", id === "lightfastgrid" ? "protocol.tsx" : "protocol.ts"),
    "utf8",
  );
  assert.doesNotMatch(protocol, /setLoading/);
  assert.doesNotMatch(protocol, /resyncInspection/);
  assert.doesNotMatch(protocol, /waitForLightFastGridAriaCountChange|2_500|2500/);
  const quickSearchStart = protocol.indexOf("async quickSearch(");
  const typeStart = protocol.indexOf("async typeQuickSearch(");
  const clearStart = protocol.indexOf("async clearOperations(");
  const visibleStart = protocol.indexOf("getVisibleState(");
  assert.ok(quickSearchStart >= 0 && typeStart > quickSearchStart && clearStart > typeStart);
  const quickSearch = protocol.slice(quickSearchStart, typeStart);
  const clear = protocol.slice(clearStart, protocol.indexOf("async scrollTo("));
  const visible = protocol.slice(visibleStart);
  for (const [method, body] of [
    ["quickSearch", quickSearch],
    ["clearOperations", clear],
  ]) {
    assert.match(
      body,
      /waitForLightFastGridQuickSearchSettlement/,
      `${id} ${method} must use the shared pending-then-two-frames settlement`,
    );
    assert.match(
      body,
      /quick-search-pending:changed/,
      `${id} ${method} must subscribe to pending before the command path`,
    );
    assert.doesNotMatch(
      body,
      /isPending:\s*\(\)\s*=>\s*sawPending\s*\|\|/,
      `${id} ${method} must not latch sawPending as still pending`,
    );
  }
  assert.match(
    visible,
    /readLightFastGridProcessedDisplayedRowCount/,
    `${id} correctness inspection uses the processed row model after timing`,
  );
  assert.match(
    protocol.slice(typeStart, clearStart),
    /runQuickSearchTypingSession/,
    `${id} typeQuickSearch must use the shared typing helper`,
  );
}

{
  assert.equal(resolveLfgQuickSearchModeFromSearch(""), "productDefault");
  assert.equal(
    resolveLfgQuickSearchModeFromSearch("?lfgQuickSearchMode=workerIsolated"),
    "workerIsolated",
  );
  assert.throws(() => resolveLfgQuickSearchModeFromSearch("?lfgQuickSearchMode=nope"));
  const worker = lightFastGridQuickSearchMountConfig("workerIsolated", 100_000);
  const main = lightFastGridQuickSearchMountConfig("mainThreadIsolated", 100_000);
  const production = lightFastGridQuickSearchMountConfig("workerProductionOptimized", 100_000);
  assert.deepEqual(worker.quickFilter, main.quickFilter);
  assert.equal(worker.cache, false);
  assert.equal(worker.prewarm, false);
  assert.equal(worker.quickSearchThreshold, 25_000);
  assert.equal(main.quickSearchThreshold, 100_001);
  assert.equal(main.forcedMainThread, true);
  assert.equal(production.cache, true);
  assert.equal(production.prewarm, true);
  assert.equal(production.quickSearchThreshold, 25_000);
}

{
  const unconfirmed = validateQuickSearchExecutionRoute(
    {
      product: "lightfastgrid",
      mode: "workerIsolated",
      rowCount: 10_000,
      quickSearchThreshold: 25_000,
      cache: false,
      prewarm: false,
      pendingObserved: false,
      workerEligibleByCount: false,
      producer: "unknown",
      workerRouteConfirmed: false,
      forcedMainThread: false,
      cacheQuickFilter: null,
      notes: [],
    },
    "workerIsolated",
  );
  assert.equal(unconfirmed?.code, "missing-producer");
  const unexpected = validateQuickSearchExecutionRoute(
    {
      product: "lightfastgrid",
      mode: "mainThreadIsolated",
      rowCount: 100_000,
      quickSearchThreshold: 100_001,
      cache: false,
      prewarm: false,
      pendingObserved: true,
      workerEligibleByCount: true,
      producer: "worker",
      workerRouteConfirmed: true,
      forcedMainThread: true,
      cacheQuickFilter: null,
      notes: [],
    },
    "mainThreadIsolated",
  );
  assert.equal(unexpected?.code, "unexpected-producer");
}

{
  const identities = buildRuntimeSchedule(1, 1).lanes.react.slots.map(
    (slot) => `${slot.appId}:${slot.purpose}:${slot.lfgMode ?? "default"}`,
  );
  assert.deepEqual(identities.slice(0, 6), [
    "lightfastgrid:competitive:default",
    "ag-grid:competitive:default",
    "lightfastgrid:quickSearch:workerIsolated",
    "lightfastgrid:quickSearch:mainThreadIsolated",
    "lightfastgrid:quickSearch:workerProductionOptimized",
    "ag-grid:quickSearch:default",
  ]);
}

{
  const prefixes = ["P", "Pa", "Pat", "Pate", "Patel"];
  const issued = [];
  let accepted = "";
  const burst = await runQuickSearchTypingSession(
    {
      product: "baseline",
      setText(text) {
        issued.push({ text, at: performance.now() });
        if (text === "Patel") accepted = text;
      },
      subscribeAccepted() {
        return () => undefined;
      },
      getAcceptedText: () => accepted,
      getDisplayedRowCount: () => 17,
    },
    { variant: "burst", prefixes, intervalMs: 40 },
    "focused-burst",
  );
  assert.deepEqual(
    issued.map((entry) => entry.text),
    prefixes,
  );
  assert.equal(burst.finalText, "Patel");
  assert.equal(burst.cadenceWaitMs, 160);
  assert.ok(
    burst.finalKeystrokeToFinalPaintMs < burst.firstKeystrokeToFinalPaintMs,
    "processing latency must exclude the typing cadence",
  );
  for (let index = 1; index < issued.length; index += 1) {
    const gap = issued[index].at - issued[index - 1].at;
    assert.ok(gap < 200, `burst must not wait for intermediate settlement (gap ${gap}ms)`);
  }
}

{
  const prefixes = ["P", "Pa", "Pat", "Pate", "Patel"];
  const counts = { P: 50, Pa: 40, Pat: 30, Pate: 20, Patel: 10 };
  const settlements = [];
  let accepted = "";
  const settled = await runQuickSearchTypingSession(
    {
      product: "baseline",
      setText(text) {
        accepted = text;
      },
      subscribeAccepted() {
        return () => undefined;
      },
      getAcceptedText: () => accepted,
      getDisplayedRowCount: () => counts[accepted] ?? 0,
    },
    { variant: "settledIncremental", prefixes, intervalMs: 40 },
    "focused-settled",
  );
  assert.equal(settled.prefixSettlements.length, prefixes.length);
  for (const prefix of prefixes) {
    const row = settled.prefixSettlements.find((entry) => entry.prefix === prefix);
    assert.equal(row.displayedRowCount, counts[prefix]);
    settlements.push(row.durationMs);
  }
  assert.ok(settlements.every((value) => typeof value === "number"));
}

{
  const prefixes = ["P", "Pa", "Pat", "Pate", "Patel"];
  let issued = "";
  let patelReads = 0;
  let threw = false;
  try {
    await runQuickSearchTypingSession(
      {
        product: "baseline",
        setText(text) {
          issued = text;
        },
        subscribeAccepted() {
          return () => undefined;
        },
        getAcceptedText: () => {
          if (issued !== "Patel") return issued;
          patelReads += 1;
          return patelReads > 1 ? "Pat" : "Patel";
        },
        getDisplayedRowCount: () => 0,
      },
      { variant: "burst", prefixes, intervalMs: 5 },
      "focused-stale",
    );
  } catch (error) {
    threw = /stale Quick Search result/.test(error instanceof Error ? error.message : String(error));
  }
  assert.equal(threw, true, "stale earlier results must not replace the final accepted text");
}

{
  const host = {
    querySelector(selector) {
      return selector.includes(".ag-row") ? {} : null;
    },
  };
  const api = { getDisplayedRowCount: () => 10_000 };
  assert.equal(
    agGridMountIsReady({
      generation: 2,
      currentGeneration: 2,
      api,
      host,
      expectedDisplayedRowCount: 10_000,
    }),
    true,
  );
  assert.equal(
    agGridMountIsReady({
      generation: 1,
      currentGeneration: 2,
      api,
      host,
      expectedDisplayedRowCount: 10_000,
    }),
    false,
    "a stale mount generation must not satisfy the new grid",
  );
  assert.equal(
    agGridMountIsReady({
      generation: 2,
      currentGeneration: 2,
      api: { getDisplayedRowCount: () => 10_000 },
      host: { querySelector: () => null },
      expectedDisplayedRowCount: 10_000,
    }),
    false,
    "API count without current-generation DOM rows is not ready",
  );
  assert.equal(
    agGridMountIsReady({
      generation: 2,
      currentGeneration: 2,
      api: {
        getDisplayedRowCount: () => 10_000,
        isDestroyed: () => true,
        getGridElement: () => host,
      },
      host,
      expectedDisplayedRowCount: 10_000,
    }),
    false,
    "a destroyed API must not satisfy remount readiness",
  );
  assert.equal(
    agGridMountIsReady({
      generation: 2,
      currentGeneration: 2,
      api: {
        getDisplayedRowCount: () => 10_000,
        getGridElement: () => ({
          querySelector(selector) {
            return selector.includes(".ag-row") ? {} : null;
          },
        }),
      },
      host: null,
      expectedDisplayedRowCount: 10_000,
    }),
    true,
    "current getGridElement rows are sufficient without a host ref",
  );
  assert.equal(
    agGridMountIsReady({
      generation: 2,
      currentGeneration: 2,
      api: {
        getDisplayedRowCount: () => 10_000,
        getGridElement: () => ({ querySelector: () => null }),
      },
      host,
      expectedDisplayedRowCount: 10_000,
    }),
    false,
    "stale host rows must not satisfy a current API whose getGridElement has no rows",
  );
  assert.equal(
    agGridMountIsReady({
      generation: 3,
      currentGeneration: 3,
      api: { getDisplayedRowCount: () => 0 },
      host: {
        querySelector(selector) {
          return selector.includes("ag-overlay") ? {} : null;
        },
      },
      expectedDisplayedRowCount: 0,
    }),
    true,
  );
  assert.equal(agGridMountShellIsClear(null), false);
  assert.equal(
    agGridMountShellIsClear({ querySelector: () => null }),
    true,
  );
  assert.equal(
    agGridMountShellIsClear({
      querySelector(selector) {
        return selector.includes("ag-root-wrapper") ? {} : null;
      },
    }),
    false,
    "a remaining AG Grid root means the previous mount is not clear",
  );
}

{
  const scenario = getScenario("runtime-publish");
  assert.equal(scenario.rowCount, CANONICAL_PUBLIC_ROW_COUNT);
  assert.equal(scenario.columnCount, CANONICAL_PUBLIC_COLUMN_COUNT);
  const smoke = computeExpectedOperations("normal");
  assert.equal(smoke.rowCount, 10_000);
  assert.equal(smoke.columnCount, 20);
  assert.ok(smoke.filters.text.displayedRowCount < smoke.rowCount);
  assert.ok(smoke.filters.numberRange.displayedRowCount < smoke.rowCount);
  assert.ok(
    smoke.filters.combined.displayedRowCount <= Math.min(
      smoke.filters.text.displayedRowCount,
      smoke.filters.numberRange.displayedRowCount,
    ),
  );
  assert.equal(smoke.filters.typing.intervalMs, 120);
  assert.equal(smoke.datasetSha256, "effd2a0a99eb88890199b2e7b56f207fb4427fe88c53129f2d47f2ab480a9a55");
}

{
  const lfg = toLightFastGridFilterModel(FILTER_COMBINED_MODEL);
  const ag = toAgGridFilterModel(FILTER_COMBINED_MODEL);
  assert.deepEqual(fromLightFastGridFilterModel(lfg), FILTER_COMBINED_MODEL);
  assert.deepEqual(fromAgGridFilterModel(ag), FILTER_COMBINED_MODEL);
  assert.equal(ag.amount?.operator, "AND");
  assert.equal(ag.amount?.conditions?.[0]?.type, "greaterThanOrEqual");
  assert.equal(ag.amount?.conditions?.[1]?.type, "lessThanOrEqual");
  const text = textContainsFilter("status", "Active");
  const number = numberBetweenFilter("amount", 25_000, 75_000);
  assert.equal(FILTER_TEXT_MODEL.conditions[0].operator, "contains");
  assert.equal(FILTER_NUMBER_MODEL.conditions[0].inclusive, true);
  const rows = [
    { id: "1", status: "Active", amount: 25_000 },
    { id: "2", status: "Active", amount: 24_999 },
    { id: "3", status: "Idle", amount: 50_000 },
    { id: "4", status: "Active", amount: 75_000 },
  ];
  assert.equal(countRowsMatchingNeutralFilter(rows, text), 3);
  assert.equal(countRowsMatchingNeutralFilter(rows, number), 3, "numeric between is inclusive");
  assert.equal(countRowsMatchingNeutralFilter(rows, FILTER_COMBINED_MODEL), 2);
}

{
  const plan = isolatedFilterPlan();
  assert.equal(plan.length, 7);
  assert.ok(plan.every((step) => step.remount === true));
  assert.deepEqual(
    plan.map((step) => step.measuredOperation),
    [
      "filterTextApply",
      "filterTextClear",
      "filterNumberRangeApply",
      "filterNumberRangeClear",
      "filterCombinedApply",
      "filterCombinedClear",
      "filterTypingBurst",
    ],
  );
  assert.deepEqual(requiredOperationsForPurpose("quickSearch"), [
    "quickSearch",
    "quickSearchPrimedDifferent",
    "quickSearchRepeatedSame",
    "quickSearchTypingBurst",
    "quickSearchTypingSettled",
  ]);
}

{
  let filterComplete = null;
  const delayed = [];
  const execution = {
    scheduleFilter(_rows, _model, _cols, onComplete) {
      onComplete({ producer: "worker", requestId: 1 });
      return 1;
    },
    scheduleSort(_rows, _model, _cols, onComplete) {
      onComplete({ producer: "mainThread", requestId: 2 });
      return 2;
    },
  };
  const probe = attachLightFastGridProducerProbe({ execution });
  probe.beginCommand();
  execution.scheduleFilter([], {}, {}, (completion) => {
    filterComplete = completion.producer;
  });
  assert.equal(probe.filterCommandEvidence().producer, "worker");
  assert.equal(probe.filterCommandEvidence().scheduled, true);
  assert.equal(filterComplete, "worker");
  probe.beginCommand();
  execution.scheduleSort([], [], [], () => undefined);
  assert.equal(probe.sortCommandEvidence().producer, "mainThread");
  probe.detach();

  const staleExecution = {
    scheduleFilter(_rows, _model, _cols, onComplete) {
      delayed.push(onComplete);
      return delayed.length;
    },
  };
  const staleProbe = attachLightFastGridProducerProbe({ execution: staleExecution });
  staleProbe.beginCommand();
  staleExecution.scheduleFilter([], {}, {}, () => undefined);
  assert.equal(staleProbe.filterCommandEvidence().producer, "unknown");
  assert.equal(staleProbe.filterCommandEvidence().scheduled, true);
  staleProbe.beginCommand();
  assert.equal(
    staleProbe.filterCommandEvidence().producer,
    "none",
    "unrecorded Apply followed by Clear cannot inherit Apply producer",
  );
  assert.equal(staleProbe.filterCommandEvidence().scheduled, false);
  delayed[0]({ producer: "worker", requestId: 1 });
  assert.equal(
    staleProbe.filterCommandEvidence().producer,
    "none",
    "stale Apply completion cannot cross a Clear checkpoint",
  );
  const applyEvidence = buildLfgFilterEvidence({
    operation: "filter",
    rowCount: 100_000,
    producer: "worker",
    scheduled: true,
  });
  const clearEvidence = buildLfgFilterEvidence({
    operation: "filter",
    rowCount: 100_000,
    producer: "none",
    scheduled: false,
  });
  assert.equal(applyEvidence.workerRouteConfirmed, true);
  assert.equal(clearEvidence.workerRouteConfirmed, null);
  assert.equal(clearEvidence.producer, "none");
  staleProbe.detach();
}

{
  assert.equal(
    validateFilterExecutionEvidence({
      product: "lightfastgrid",
      operation: "sort",
      producer: "unknown",
      scheduled: false,
      rowCount: 10_000,
      workerThreshold: 25_000,
      workerRouteConfirmed: null,
      notes: [],
    }, "sort"),
    null,
    "unknown sort producer is a documented Core scheduler bypass, not a Worker claim",
  );
  assert.equal(
    validateFilterExecutionEvidence({
      product: "lightfastgrid",
      operation: "filter",
      producer: "unknown",
      scheduled: true,
      rowCount: 10_000,
      workerThreshold: 25_000,
      workerRouteConfirmed: null,
      notes: [],
    }, "filter")?.code,
    "missing-producer",
  );
  assert.equal(
    validateFilterExecutionEvidence({
      product: "lightfastgrid",
      operation: "filter",
      producer: "none",
      scheduled: false,
      rowCount: 100_000,
      workerThreshold: 25_000,
      workerRouteConfirmed: null,
      notes: [],
    }, "clear"),
    null,
    "Clear none/not-applicable evidence is valid",
  );
  assert.equal(
    validateFilterExecutionEvidence({
      product: "lightfastgrid",
      operation: "filter",
      producer: "worker",
      scheduled: true,
      rowCount: 100_000,
      workerThreshold: 25_000,
      workerRouteConfirmed: true,
      notes: [],
    }, "clear")?.code,
    "unexpected-producer",
    "Clear cannot inherit Apply Worker producer",
  );
  assert.equal(
    validateFilterExecutionEvidence({
      product: "lightfastgrid",
      operation: "filter",
      producer: "worker",
      scheduled: true,
      rowCount: 100_000,
      workerThreshold: 25_000,
      workerRouteConfirmed: true,
      notes: [],
    }, "filter"),
    null,
    "Apply retains direct producer evidence",
  );
}

{
  const clearWorker = buildFilterModeComparison(
    [
      {
        appId: "lightfastgrid",
        operation: "filterTextClear",
        lfgMode: null,
        purpose: "competitive",
        scenarioId: "textClear",
        valid: true,
        role: "measured",
        durationMs: 12,
        executionEvidence: { producer: "worker", workerRouteConfirmed: true },
      },
    ],
    true,
  );
  assert.equal(clearWorker.lanes.react.filterTextClear.lightfastgrid.medianMs, 12);
  assert.equal(clearWorker.lanes.react.filterTextClear.lightfastgrid.workerRouteConfirmed, null);
  assert.equal(clearWorker.lanes.react.filterTextClear.lightfastgrid.producerDistribution.worker, 1);
  assert.ok(
    clearWorker.provisionalReasons.some((reason) => /Clear must not be treated as Filter Worker/.test(reason)),
  );
  const clearNone = buildFilterModeComparison(
    [
      {
        appId: "lightfastgrid",
        operation: "filterTextClear",
        lfgMode: null,
        purpose: "competitive",
        scenarioId: "textClear",
        valid: true,
        role: "measured",
        durationMs: 12,
        executionEvidence: { producer: "none", workerRouteConfirmed: null },
      },
      {
        appId: "lightfastgrid",
        operation: "filterTextApply",
        lfgMode: null,
        purpose: "competitive",
        scenarioId: "textApply",
        valid: true,
        role: "measured",
        durationMs: 20,
        executionEvidence: { producer: "worker", workerRouteConfirmed: true },
      },
    ],
    true,
  );
  assert.equal(clearNone.lanes.react.filterTextClear.lightfastgrid.medianMs, 12);
  assert.equal(clearNone.lanes.react.filterTextClear.lightfastgrid.producerDistribution.none, 1);
  assert.equal(clearNone.lanes.react.filterTextClear.lightfastgrid.producerDistribution.worker, 0);
  assert.equal(clearNone.lanes.react.filterTextApply.lightfastgrid.producerDistribution.worker, 1);
  assert.ok(
    collectFilterProducerPromotionReasons(clearWorker).some((reason) => /Clear/.test(reason)),
  );
  assert.deepEqual(
    collectFilterProducerPromotionReasons({
      lanes: {
        react: {
          filterTextApply: {
            lightfastgrid: {
              validSampleCount: 20,
              producerDistribution: { worker: 20, mainThread: 0, cache: 0, unknown: 0, none: 0 },
            },
          },
          filterTextClear: {
            lightfastgrid: {
              validSampleCount: 20,
              workerRouteConfirmed: null,
              producerDistribution: { worker: 0, mainThread: 0, cache: 0, unknown: 0, none: 20 },
            },
          },
        },
      },
    }),
    [],
  );
}

{
  const independentEqualDurations = collectDuplicateWeightingReasons([
    {
      lane: "react",
      appId: "ag-grid",
      round: 3,
      slotIndex: 18,
      operation: "filterTextApply",
      purpose: "competitive",
      valid: true,
      role: "measured",
      durationMs: 50,
      scenarioId: "textApply",
    },
    {
      lane: "react",
      appId: "ag-grid",
      round: 4,
      slotIndex: 29,
      operation: "filterTextApply",
      purpose: "competitive",
      valid: true,
      role: "measured",
      durationMs: 50,
      scenarioId: "textApply",
    },
  ]);
  assert.ok(
    !independentEqualDurations.some((reason) => /reused under more than one scenario/.test(reason)),
    "equal timer values from independent rounds are not reused samples",
  );

  const reusedMeasurement = collectDuplicateWeightingReasons([
    {
      lane: "react",
      appId: "ag-grid",
      round: 3,
      slotIndex: 18,
      operation: "filterTextApply",
      purpose: "competitive",
      valid: true,
      role: "measured",
      durationMs: 50,
      scenarioId: "textApply",
    },
    {
      lane: "react",
      appId: "ag-grid",
      round: 3,
      slotIndex: 18,
      operation: "filterTextApply",
      purpose: "competitive",
      valid: true,
      role: "measured",
      durationMs: 50,
      scenarioId: "differentScenario",
    },
  ]);
  assert.ok(
    reusedMeasurement.some((reason) => /reused under more than one scenario/.test(reason)),
    "one schedule-owned measurement cannot populate two scenario identities",
  );

  const pooled = collectDuplicateWeightingReasons([
    {
      appId: "lightfastgrid",
      operation: "mount",
      lfgMode: "workerIsolated",
      purpose: "quickSearch",
      valid: true,
      role: "measured",
      durationMs: 10,
    },
  ]);
  assert.ok(pooled.some((reason) => /Ordinary competitive operations must not/.test(reason)));
  const competitiveQs = collectDuplicateWeightingReasons([
    {
      appId: "lightfastgrid",
      operation: "quickSearch",
      lfgMode: null,
      purpose: "competitive",
      valid: true,
      role: "measured",
      durationMs: 10,
      scenarioId: "coldFullQuery",
    },
  ]);
  assert.ok(competitiveQs.some((reason) => /must not be pooled/.test(reason) || /must not record Quick Search/.test(reason)));
}

{
  assert.throws(
    () =>
      assertPromotableRuntimeArtifact(
        { profile: "smoke", publishable: false, complete: true },
        { git: { dirtyWorktree: true } },
        { scenario: "normal", rowCount: 10_000, columnCount: 20 },
      ),
    /not promotable/,
  );
  assert.throws(
    () =>
      assertPromotableRuntimeArtifact(
        { profile: "publish-native", publishable: false, complete: true, winner: "lightfastgrid" },
        { git: { dirtyWorktree: false } },
        { scenario: "runtime-publish", rowCount: 100_000, columnCount: 50 },
      ),
    /winner/,
  );
  assert.throws(
    () =>
      assertPromotableRuntimeArtifact(
        {
          profile: "publish-native",
          publishable: true,
          complete: true,
          quickSearchModeComparison: { provisional: false },
          filterModeComparison: {
            provisional: false,
            lanes: {
              react: {
                filterTextClear: {
                  lightfastgrid: {
                    validSampleCount: 20,
                    workerRouteConfirmed: true,
                    producerDistribution: { worker: 20, mainThread: 0, cache: 0, unknown: 0, none: 0 },
                  },
                },
              },
            },
          },
        },
        {
          git: { dirtyWorktree: false },
          packages: {},
          playwright: { version: "1" },
          browser: { name: "chromium" },
        },
        {
          scenario: "runtime-publish",
          rowCount: 100_000,
          columnCount: 50,
          datasetSha256: "a".repeat(64),
          columnSchemaSha256: "b".repeat(64),
        },
      ),
    /Clear/,
  );
}

console.log(
  "Focused helper tests passed: displayed-row counts, matching baselines, vanilla React-module denylist, listener cleanup, Quick Search settlement order, typing burst, Worker-mode matrix, AG Grid remount readiness and teardown, canonical 100k×50, neutral filters, producer probe, duplicate-weighting.",
);
