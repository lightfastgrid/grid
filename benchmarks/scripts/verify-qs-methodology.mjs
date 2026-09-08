#!/usr/bin/env node
import assert from "node:assert/strict";

import { buildLfgQuickSearchEvidence, interpretProductionQuickSearchProducer, lightFastGridQuickSearchMountConfig } from "../shared/src/lfgQuickSearchMode.ts";
import { attachLightFastGridProducerProbe } from "../shared/src/lightfastgridProducer.ts";
import { isolatedQuickSearchPlan, QUICK_SEARCH_PRIMING_TEXT } from "../shared/src/quickSearchScenarios.ts";
import { runQuickSearchTypingSession } from "../shared/src/typingSession.ts";
import { validateQuickSearchExecutionRoute } from "../tests/performance/fixtures/correctness.ts";
import {
  allRequiredWorkerSlotsAcknowledged,
  awaitNestedThrottleAcknowledgement,
  claimWorkerThrottleTarget,
  createMonotonicCdpCommandId,
  mergeWorkerThrottleAttempts,
  nestedCdpResponseSucceeded,
  parseNestedCdpMessage,
  workerTargetIdentity,
} from "../tests/performance/fixtures/nestedCdp.ts";
import { buildQuickSearchModeComparison, collectQuickSearchComparisonReasons } from "../tests/performance/metrics/modeComparison.ts";

function spinMs(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Intentionally block the current thread.
  }
}

{
  const prefixes = ["P", "Pa", "Pat", "Pate", "Patel"];
  let accepted = "";
  const setTextOrder = [];
  const burst = await runQuickSearchTypingSession(
    {
      product: "baseline",
      setText(text) {
        setTextOrder.push({ text, at: performance.now() });
        if (text === "Patel") spinMs(25);
        accepted = text;
      },
      subscribeAccepted() {
        return () => undefined;
      },
      getAcceptedText: () => accepted,
      getDisplayedRowCount: () => 17,
    },
    { variant: "burst", prefixes, intervalMs: 5 },
    "blocking-setText",
  );
  const lastDispatch = burst.dispatchTimestampsMs[burst.dispatchTimestampsMs.length - 1];
  const lastSetText = setTextOrder[setTextOrder.length - 1].at;
  assert.ok(
    lastDispatch <= lastSetText,
    "dispatch timestamp must be captured before adapter.setText(prefix)",
  );
  assert.ok(
    burst.finalKeystrokeToFinalPaintMs >= 25,
    `blocking setText must be included in final-keystroke latency, got ${burst.finalKeystrokeToFinalPaintMs}`,
  );
  assert.ok(
    burst.firstKeystrokeToFinalPaintMs >= burst.finalKeystrokeToFinalPaintMs,
    "UX duration must include the blocked final keystroke",
  );
}

{
  const prefixes = ["P", "Pa", "Pat", "Pate", "Patel"];
  let accepted = "";
  const delayed = await runQuickSearchTypingSession(
    {
      product: "baseline",
      setText(text) {
        if (text === "P") spinMs(40);
        accepted = text;
      },
      subscribeAccepted() {
        return () => undefined;
      },
      getAcceptedText: () => accepted,
      getDisplayedRowCount: () => 17,
    },
    { variant: "burst", prefixes, intervalMs: 10 },
    "blocked-cadence",
  );
  assert.ok(
    delayed.dispatchDelaysMs[1] >= 20,
    `blocked main thread must appear as dispatch delay, got ${delayed.dispatchDelaysMs[1]}`,
  );
  assert.equal(delayed.scheduledTimestampsMs.length, prefixes.length);
  assert.equal(delayed.dispatchTimestampsMs.length, prefixes.length);
  assert.equal(delayed.prefixDispatches.length, prefixes.length);
}

{
  let threw = false;
  try {
    await runQuickSearchTypingSession(
      {
        product: "baseline",
        setText() {},
        subscribeAccepted() {
          return () => undefined;
        },
        getAcceptedText: () => "Patel",
        getDisplayedRowCount: () => 0,
        assertFreshQuickSearch() {
          throw new Error('cold typing inherited prior Quick Search state "Patel"');
        },
      },
      { variant: "burst", prefixes: ["P", "Pa", "Pat", "Pate", "Patel"], intervalMs: 5 },
      "contaminated-typing",
    );
  } catch (error) {
    threw = /inherited prior Quick Search/.test(error instanceof Error ? error.message : String(error));
  }
  assert.equal(threw, true, "cold typing must reject a grid that already has Quick Search state");
}

{
  const config = lightFastGridQuickSearchMountConfig("workerIsolated", 100_000);
  const pendingUnknown = buildLfgQuickSearchEvidence({
    config,
    rowCount: 100_000,
    pendingObserved: true,
    producer: "unknown",
  });
  assert.equal(pendingUnknown.pendingObserved, true);
  assert.equal(pendingUnknown.workerEligibleByCount, true);
  assert.equal(pendingUnknown.producer, "unknown");
  assert.equal(
    pendingUnknown.workerRouteConfirmed,
    false,
    "pendingObserved must not produce workerRouteConfirmed",
  );

  const workerNoPending = buildLfgQuickSearchEvidence({
    config,
    rowCount: 100_000,
    pendingObserved: false,
    producer: "worker",
  });
  assert.equal(workerNoPending.pendingObserved, false);
  assert.equal(workerNoPending.workerRouteConfirmed, true);

  const cacheHit = buildLfgQuickSearchEvidence({
    config: lightFastGridQuickSearchMountConfig("workerProductionOptimized", 100_000),
    rowCount: 100_000,
    pendingObserved: false,
    producer: "cache",
  });
  assert.equal(cacheHit.producer, "cache");
  assert.equal(cacheHit.workerRouteConfirmed, false, "cache must not be marketed as Worker execution");
}

{
  const execution = {
    scheduleQuickSearch(_input, onComplete) {
      onComplete({
        producer: "worker",
        quickFilterText: "Patel",
        requestId: 7,
      });
      return 7;
    },
  };
  const probe = attachLightFastGridProducerProbe({ execution });
  execution.scheduleQuickSearch({}, () => undefined);
  assert.equal(probe.producerForAcceptedText("Patel"), "worker");
  assert.equal(probe.producerForAcceptedText("Morgan"), "unknown");
  probe.detach();
}

{
  const pendingUnknown = validateQuickSearchExecutionRoute(
    {
      product: "lightfastgrid",
      mode: "workerIsolated",
      rowCount: 10_000,
      quickSearchThreshold: 25_000,
      cache: false,
      prewarm: false,
      pendingObserved: true,
      workerEligibleByCount: true,
      producer: "unknown",
      workerRouteConfirmed: false,
      forcedMainThread: false,
      cacheQuickFilter: null,
      notes: [],
    },
    "workerIsolated",
  );
  assert.equal(pendingUnknown?.code, "missing-producer");

  const forcedPendingOk = validateQuickSearchExecutionRoute(
    {
      product: "lightfastgrid",
      mode: "mainThreadIsolated",
      rowCount: 10_000,
      quickSearchThreshold: 10_001,
      cache: false,
      prewarm: false,
      pendingObserved: true,
      workerEligibleByCount: false,
      producer: "mainThread",
      workerRouteConfirmed: false,
      forcedMainThread: true,
      cacheQuickFilter: null,
      notes: [],
    },
    "mainThreadIsolated",
  );
  assert.equal(forcedPendingOk, null, "forced main thread may observe pending as deferred fallback");

  const forcedCache = validateQuickSearchExecutionRoute(
    {
      product: "lightfastgrid",
      mode: "mainThreadIsolated",
      rowCount: 10_000,
      quickSearchThreshold: 10_001,
      cache: false,
      prewarm: false,
      pendingObserved: false,
      workerEligibleByCount: false,
      producer: "cache",
      workerRouteConfirmed: false,
      forcedMainThread: true,
      cacheQuickFilter: null,
      notes: [],
    },
    "mainThreadIsolated",
  );
  assert.equal(forcedCache?.code, "unexpected-producer");

  const productionUnknown = validateQuickSearchExecutionRoute(
    {
      product: "lightfastgrid",
      mode: "workerProductionOptimized",
      rowCount: 100_000,
      quickSearchThreshold: 25_000,
      cache: true,
      prewarm: true,
      pendingObserved: false,
      workerEligibleByCount: true,
      producer: "unknown",
      workerRouteConfirmed: false,
      forcedMainThread: false,
      cacheQuickFilter: null,
      notes: [],
    },
    "workerProductionOptimized",
  );
  assert.equal(productionUnknown?.code, "missing-producer");
}

function createFakeCdpSession() {
  const listeners = new Map();
  return {
    on(event, handler) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    off(event, handler) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((entry) => entry !== handler),
      );
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
    listenerCount(event) {
      return (listeners.get(event) ?? []).length;
    },
  };
}

{
  const ids = createMonotonicCdpCommandId(9);
  assert.equal(ids(), 9);
  assert.equal(ids(), 10);
  const seen = new Set();
  assert.equal(claimWorkerThrottleTarget(seen, "t1", "s1"), true);
  assert.equal(claimWorkerThrottleTarget(seen, "t1", "s1"), false, "duplicate target session must be skipped");
  assert.equal(claimWorkerThrottleTarget(seen, "t1", "s2"), false, "same target with a new session must not double-throttle");
  assert.equal(claimWorkerThrottleTarget(seen, "t2", "s3"), true);
}

{
  assert.equal(nestedCdpResponseSucceeded({ id: 1, result: {} }, 1), true);
  assert.equal(nestedCdpResponseSucceeded({ id: 1 }, 1), false, "send without result is not acknowledgement");
  assert.equal(nestedCdpResponseSucceeded({ id: 1, error: { message: "unsupported" } }, 1), false);
  assert.equal(parseNestedCdpMessage("{not json") , null);
}

{
  const session = createFakeCdpSession();
  const ack = awaitNestedThrottleAcknowledgement({
    session,
    sessionId: "sess-a",
    targetId: "target-a",
    commandId: 11,
    timeoutMs: 200,
    sendThrottle: async () => {
      session.emit("Target.receivedMessageFromTarget", {
        sessionId: "sess-a",
        message: JSON.stringify({ id: 11, result: {} }),
      });
    },
  });
  assert.deepEqual(await ack, { ok: true });
  assert.equal(session.listenerCount("Target.receivedMessageFromTarget"), 0);
  assert.equal(session.listenerCount("Target.detachedFromTarget"), 0);
}

{
  const session = createFakeCdpSession();
  const ack = awaitNestedThrottleAcknowledgement({
    session,
    sessionId: "sess-a",
    commandId: 12,
    timeoutMs: 200,
    sendThrottle: async () => {
      session.emit("Target.receivedMessageFromTarget", {
        sessionId: "sess-a",
        message: JSON.stringify({ id: 12, error: { message: "unsupported method" } }),
      });
    },
  });
  const result = await ack;
  assert.equal(result.ok, false);
  assert.match(result.failureReason, /unsupported method/);
  assert.equal(session.listenerCount("Target.receivedMessageFromTarget"), 0);
}

{
  const session = createFakeCdpSession();
  const ack = awaitNestedThrottleAcknowledgement({
    session,
    sessionId: "sess-a",
    commandId: 13,
    timeoutMs: 30,
    sendThrottle: async () => undefined,
  });
  const result = await ack;
  assert.equal(result.ok, false);
  assert.match(result.failureReason, /timed out/);
  assert.equal(session.listenerCount("Target.receivedMessageFromTarget"), 0);
}

{
  const session = createFakeCdpSession();
  const ack = awaitNestedThrottleAcknowledgement({
    session,
    sessionId: "sess-a",
    commandId: 14,
    timeoutMs: 200,
    sendThrottle: async () => {
      session.emit("Target.detachedFromTarget", { sessionId: "sess-a" });
    },
  });
  const result = await ack;
  assert.equal(result.ok, false);
  assert.match(result.failureReason, /detached/);
  assert.equal(session.listenerCount("Target.detachedFromTarget"), 0);
}

{
  const sameUrl = "blob:http://localhost/quickSearchWorker.js";
  const left = {
    targetId: "t1",
    sessionId: "s1",
    url: sameUrl,
    commandId: 1,
    acknowledged: true,
    appliedRate: 4,
    failureReason: null,
    acknowledgedBeforeTimedWork: true,
  };
  const right = {
    targetId: "t2",
    sessionId: "s2",
    url: sameUrl,
    commandId: 2,
    acknowledged: false,
    appliedRate: null,
    failureReason: "timeout",
    acknowledgedBeforeTimedWork: false,
  };
  assert.notEqual(workerTargetIdentity("t1", "s1"), workerTargetIdentity("t2", "s2"));
  const merged = mergeWorkerThrottleAttempts([left, right], true);
  assert.equal(merged.confirmedEquivalentToPage, false);
  assert.equal(
    mergeWorkerThrottleAttempts(
      [
        { ...left, acknowledged: true },
        { ...right, acknowledged: true, failureReason: null, appliedRate: 4 },
      ],
      true,
    ).confirmedEquivalentToPage,
    true,
  );
  const urlOnly = mergeWorkerThrottleAttempts(
    [{ ...left, acknowledged: false, failureReason: "never parsed nested result" }],
    true,
  );
  assert.equal(urlOnly.confirmedEquivalentToPage, false, "URL presence is not throttle acknowledgement");
}

{
  assert.equal(
    allRequiredWorkerSlotsAcknowledged([
      { required: true, confirmedEquivalentToPage: true },
      { required: true, confirmedEquivalentToPage: false },
    ]),
    false,
    "one failed Worker slot must make aggregate confirmation false; some() is invalid",
  );
  assert.equal(
    allRequiredWorkerSlotsAcknowledged([
      { required: false, confirmedEquivalentToPage: true },
      { required: true, confirmedEquivalentToPage: true },
    ]),
    true,
  );
  assert.equal(
    mergeWorkerThrottleAttempts([], true).confirmedEquivalentToPage,
    false,
    "required Worker throttle with zero attempts is not confirmed",
  );
}

{
  const plan = isolatedQuickSearchPlan();
  assert.deepEqual(
    plan.map((step) => step.scenarioId),
    [
      "coldFullQuery",
      "coldRealisticTyping",
      "primedDifferentQuery",
      "repeatedSameQuery",
      "settledIncremental",
    ],
  );
  assert.ok(plan.every((step) => step.remount === true));
  const typing = plan.find((step) => step.scenarioId === "coldRealisticTyping");
  assert.equal(typing.unrecordedPrepQuery, null);
  assert.equal(typing.measuredOperation, "quickSearchTypingBurst");
  const primed = plan.find((step) => step.scenarioId === "primedDifferentQuery");
  assert.equal(primed.unrecordedPrepQuery, QUICK_SEARCH_PRIMING_TEXT);
  assert.equal(primed.measuredOperation, "quickSearchPrimedDifferent");
  const repeated = plan.find((step) => step.scenarioId === "repeatedSameQuery");
  assert.equal(repeated.unrecordedPrepQuery, "Patel");
  assert.equal(repeated.measuredOperation, "quickSearchRepeatedSame");
  assert.ok(!plan.some((step) => String(step.measuredOperation).includes("Warm")));
  const typingIndex = plan.findIndex((step) => step.scenarioId === "coldRealisticTyping");
  const prior = plan[typingIndex - 1];
  assert.equal(prior.scenarioId, "coldFullQuery");
  assert.equal(plan[typingIndex].remount, true, "cold typing must remount instead of inheriting the prior Patel query");
}

{
  const repeatedAg = {
    appId: "ag-grid",
    operation: "quickSearchRepeatedSame",
    scenarioId: "repeatedSameQuery",
    lfgMode: null,
    valid: true,
    role: "measured",
    durationMs: 9,
    uxDurationMs: null,
    observers: null,
    executionEvidence: { producer: "unknown", workerRouteConfirmed: null },
  };
  const comparison = buildQuickSearchModeComparison([repeatedAg], true);
  assert.equal(comparison.lanes.react.coldRealisticTyping.agGrid.validSampleCount, 0);
  assert.equal(comparison.lanes.react.coldFullQuery.agGrid.validSampleCount, 0);
  assert.equal(comparison.lanes.react.repeatedSameQuery.agGrid.validSampleCount, 1);
  assert.equal(comparison.lanes.react.repeatedSameQuery.agGrid.scenarioId, "repeatedSameQuery");
  assert.equal(comparison.lanes.react.coldRealisticTyping.agGrid.scenarioId, "coldRealisticTyping");
  assert.equal(comparison.lanes.react.coldFullQuery.forcedMainThread.competitor, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(comparison, "winner"));
  assert.ok(!("typingBurst" in comparison.lanes.react));
  assert.ok(!("warmCache" in comparison.lanes.react));
}

{
  const missingScenario = buildQuickSearchModeComparison(
    [
      {
        appId: "lightfastgrid",
        operation: "quickSearchTypingBurst",
        scenarioId: "repeatedSameQuery",
        lfgMode: "workerIsolated",
        valid: true,
        role: "measured",
        durationMs: 12,
        executionEvidence: { producer: "worker", workerRouteConfirmed: true },
      },
    ],
    true,
  );
  assert.ok(
    missingScenario.provisionalReasons.some((reason) => /incompatible Quick Search scenario/.test(reason)),
  );
  assert.equal(missingScenario.lanes.react.coldRealisticTyping.workerIsolated.validSampleCount, 0);
}

function productionEvidence(producer, rowCount, extras = {}) {
  return {
    product: "lightfastgrid",
    mode: "workerProductionOptimized",
    rowCount,
    quickSearchThreshold: 25_000,
    cache: true,
    prewarm: true,
    pendingObserved: false,
    workerEligibleByCount: rowCount >= 25_000,
    producer,
    workerRouteConfirmed: producer === "worker",
    forcedMainThread: false,
    cacheQuickFilter: null,
    notes: [],
    ...extras,
  };
}

{
  const below = interpretProductionQuickSearchProducer({
    producer: "mainThread",
    rowCount: 10_000,
    quickSearchThreshold: 25_000,
  });
  assert.equal(below.sampleValid, true, "10k production mainThread is a valid diagnostic sample");
  assert.equal(below.supportsWorkerPerformanceClaim, false);
  assert.equal(below.workerComparisonProvisional, false);
  assert.equal(validateQuickSearchExecutionRoute(productionEvidence("mainThread", 10_000), "workerProductionOptimized"), null);

  const worker = interpretProductionQuickSearchProducer({
    producer: "worker",
    rowCount: 100_000,
    quickSearchThreshold: 25_000,
  });
  assert.equal(worker.sampleValid, true);
  assert.equal(worker.supportsWorkerPerformanceClaim, true);
  assert.equal(worker.workerComparisonProvisional, false);
  assert.equal(validateQuickSearchExecutionRoute(productionEvidence("worker", 100_000), "workerProductionOptimized"), null);

  const fallback = interpretProductionQuickSearchProducer({
    producer: "mainThread",
    rowCount: 100_000,
    quickSearchThreshold: 25_000,
  });
  assert.equal(fallback.sampleValid, true, "100k production mainThread is retained");
  assert.equal(fallback.supportsWorkerPerformanceClaim, false);
  assert.equal(fallback.workerComparisonProvisional, true);
  assert.equal(validateQuickSearchExecutionRoute(productionEvidence("mainThread", 100_000), "workerProductionOptimized"), null);

  const cache = interpretProductionQuickSearchProducer({
    producer: "cache",
    rowCount: 100_000,
    quickSearchThreshold: 25_000,
  });
  assert.equal(cache.sampleValid, true);
  assert.equal(cache.supportsWorkerPerformanceClaim, false);
  assert.match(cache.notes.join(" "), /not be described as Worker/);
  const cacheEvidence = productionEvidence("cache", 100_000, { workerRouteConfirmed: false });
  assert.equal(cacheEvidence.workerRouteConfirmed, false, "cache must not be labeled Worker execution");
  assert.equal(validateQuickSearchExecutionRoute(cacheEvidence, "workerProductionOptimized"), null);
  const cacheMislabel = validateQuickSearchExecutionRoute(
    productionEvidence("cache", 100_000, { workerRouteConfirmed: true }),
    "workerProductionOptimized",
  );
  assert.equal(cacheMislabel?.code, "protocol-error");

  const unknown = interpretProductionQuickSearchProducer({
    producer: "unknown",
    rowCount: 100_000,
    quickSearchThreshold: 25_000,
  });
  assert.equal(unknown.sampleValid, false);
  assert.equal(validateQuickSearchExecutionRoute(productionEvidence("unknown", 100_000, { workerRouteConfirmed: false }), "workerProductionOptimized")?.code, "missing-producer");
}

{
  const productionFallback = {
    appId: "lightfastgrid",
    operation: "quickSearch",
    scenarioId: "coldFullQuery",
    lfgMode: "workerProductionOptimized",
    valid: true,
    role: "measured",
    durationMs: 40,
    executionEvidence: {
      producer: "mainThread",
      workerRouteConfirmed: false,
      rowCount: 100_000,
      quickSearchThreshold: 25_000,
    },
  };
  const comparison = buildQuickSearchModeComparison([productionFallback], true, [], {
    requireCdpWorkerThrottle: false,
  });
  assert.equal(comparison.provisional, true);
  assert.ok(
    collectQuickSearchComparisonReasons(comparison).some((reason) =>
      /mainThread at or above the Worker threshold/.test(reason),
    ),
  );
  assert.equal(comparison.lanes.react.coldFullQuery.productionOptimized.validSampleCount, 1);
  assert.equal(comparison.lanes.react.coldFullQuery.productionOptimized.producerDistribution.mainThread, 1);
}

{
  const cacheCell = {
    appId: "lightfastgrid",
    operation: "quickSearch",
    scenarioId: "coldFullQuery",
    lfgMode: "workerProductionOptimized",
    valid: true,
    role: "measured",
    durationMs: 8,
    executionEvidence: {
      producer: "cache",
      workerRouteConfirmed: false,
      rowCount: 100_000,
      quickSearchThreshold: 25_000,
    },
  };
  const comparison = buildQuickSearchModeComparison([cacheCell], true, [], {
    requireCdpWorkerThrottle: false,
  });
  assert.equal(comparison.lanes.react.coldFullQuery.productionOptimized.workerRouteConfirmed, false);
  assert.equal(comparison.lanes.react.coldFullQuery.productionOptimized.producerDistribution.cache, 1);
  assert.doesNotMatch(JSON.stringify(comparison.lanes.react.coldFullQuery.productionOptimized), /"winner"/);
}

{
  const config = lightFastGridQuickSearchMountConfig("workerProductionOptimized", 100_000);
  const cacheHit = buildLfgQuickSearchEvidence({
    config,
    rowCount: 100_000,
    pendingObserved: false,
    producer: "cache",
  });
  assert.equal(cacheHit.workerRouteConfirmed, false);
  assert.match(cacheHit.notes.join(" "), /not Worker execution|cache\/prewarm|cache producer/);
}

console.log(
  "Quick Search methodology tests passed: burst timestamps, producer proof, nested CDP acknowledgement, scenario isolation, report schema.",
);
