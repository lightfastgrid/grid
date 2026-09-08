import type { GridBenchmarkAcceptedState } from "../../../shared/src/benchmarkProtocol.ts";
import type {
  FilterExecutionEvidence,
  QuickSearchExecutionEvidence,
  QuickSearchTypingSessionResult,
} from "../../../shared/src/benchmarkProtocol.ts";
import {
  parseRowIndex0,
  type ExpectedFilterScenario,
  type ExpectedOperations,
} from "../../../shared/src/expectedOperations.ts";
import { isEmptyNeutralFilter, neutralFilterEquals } from "../../../shared/src/neutralFilter.ts";
import { LFG_QUICK_SEARCH_WORKER_THRESHOLD } from "../../../shared/src/lfgQuickSearchMode.ts";
import type { RuntimeVisibleState } from "../metrics/schema.ts";

export type InvalidSampleCode =
  | "page-error"
  | "unhandled-rejection"
  | "console-error"
  | "protocol-timeout"
  | "incorrect-accepted-model"
  | "incorrect-displayed-count"
  | "failed-scroll-settlement"
  | "unavailable-required-instrumentation"
  | "protocol-error"
  | "invalid-setup-state"
  | "worker-route-unconfirmed"
  | "unexpected-worker-route"
  | "missing-producer"
  | "unexpected-producer"
  | "scenario-contamination";

export type InvalidMeasuredSampleLike = {
  readonly valid: boolean;
  readonly role: string;
  readonly operation?: string | null;
  readonly invalidReason?: string | null;
  readonly invalidMessage?: string | null;
  readonly lfgMode?: string | null;
  readonly appId?: string | null;
  readonly lane?: string | null;
};

export function isExpectedBelowThresholdWorkerRouteInvalid(
  sample: InvalidMeasuredSampleLike,
  rowCount: number,
): boolean {
  if (sample.valid) return false;
  if (sample.invalidReason !== "worker-route-unconfirmed") return false;
  if (sample.lfgMode !== "workerIsolated") return false;
  return rowCount > 0 && rowCount < LFG_QUICK_SEARCH_WORKER_THRESHOLD;
}

export function unexpectedInvalidMeasuredSamples(
  samples: readonly InvalidMeasuredSampleLike[],
  rowCount: number,
): InvalidMeasuredSampleLike[] {
  return samples.filter(
    (sample) =>
      sample.role === "measured" &&
      sample.valid === false &&
      !isExpectedBelowThresholdWorkerRouteInvalid(sample, rowCount),
  );
}

export function unexpectedInvalidMeasuredReasons(
  samples: readonly InvalidMeasuredSampleLike[],
  rowCount: number,
): string[] {
  return unexpectedInvalidMeasuredSamples(samples, rowCount).map((sample) => {
    const where = [sample.lane, sample.appId, sample.operation].filter(Boolean).join(" ");
    return `unexpected invalid measured sample${where ? ` (${where})` : ""}: ${sample.invalidReason ?? "unknown"}${sample.invalidMessage ? ` ${sample.invalidMessage}` : ""}`;
  });
}

export type CorrectnessFailure = {
  readonly code: InvalidSampleCode;
  readonly message: string;
};

function emptyAccepted(accepted: GridBenchmarkAcceptedState): boolean {
  return (
    accepted.sort.length === 0 &&
    accepted.filterFields.length === 0 &&
    isEmptyNeutralFilter(accepted.filterModel) &&
    accepted.quickSearch.trim().length === 0
  );
}

export function validateMount(
  visible: RuntimeVisibleState,
  expected: ExpectedOperations,
): CorrectnessFailure | null {
  if (visible.displayedRowCount !== expected.rowCount) {
    return {
      code: "incorrect-displayed-count",
      message: `mount displayedRowCount ${visible.displayedRowCount} !== ${expected.rowCount}`,
    };
  }
  if (visible.renderedRowCount <= 0) {
    return {
      code: "incorrect-displayed-count",
      message: "mount renderedRowCount must be greater than 0",
    };
  }
  return null;
}

export function validateSort(
  accepted: GridBenchmarkAcceptedState,
  visible: RuntimeVisibleState,
  expected: ExpectedOperations,
): CorrectnessFailure | null {
  const sort = accepted.sort;
  if (
    sort.length !== 1 ||
    sort[0]?.field !== expected.sort.field ||
    sort[0]?.direction !== expected.sort.direction
  ) {
    return {
      code: "incorrect-accepted-model",
      message: `sort model ${JSON.stringify(sort)} !== ${expected.sort.field}:${expected.sort.direction}`,
    };
  }
  if (
    accepted.filterFields.length > 0 ||
    !isEmptyNeutralFilter(accepted.filterModel) ||
    accepted.quickSearch.trim().length > 0
  ) {
    return {
      code: "incorrect-accepted-model",
      message: "sort left filter or Quick Search active",
    };
  }
  if (visible.displayedRowCount !== expected.rowCount) {
    return {
      code: "incorrect-displayed-count",
      message: `sort displayedRowCount ${visible.displayedRowCount} !== ${expected.rowCount}`,
    };
  }
  if (!visible.firstRenderedRowId) {
    return {
      code: "incorrect-accepted-model",
      message: "sort did not expose a firstRenderedRowId for representative-row inspection",
    };
  }
  if (!expected.sort.representativeRowIds.includes(visible.firstRenderedRowId)) {
    return {
      code: "incorrect-accepted-model",
      message: `sort firstRenderedRowId ${visible.firstRenderedRowId} is not a ${expected.sort.minName} representative row`,
    };
  }
  return null;
}

export function validateFilter(
  accepted: GridBenchmarkAcceptedState,
  visible: RuntimeVisibleState,
  expected: ExpectedOperations,
): CorrectnessFailure | null {
  return validateFilterScenario(accepted, visible, expected.filters.text);
}

export function validateFilterScenario(
  accepted: GridBenchmarkAcceptedState,
  visible: RuntimeVisibleState,
  expected: ExpectedFilterScenario,
): CorrectnessFailure | null {
  if (accepted.sort.length > 0 || accepted.quickSearch.trim().length > 0) {
    return {
      code: "incorrect-accepted-model",
      message: "filter left sort or Quick Search active",
    };
  }
  if (!neutralFilterEquals(accepted.filterModel, expected.model)) {
    return {
      code: "incorrect-accepted-model",
      message: `accepted filter model ${JSON.stringify(accepted.filterModel)} !== ${JSON.stringify(expected.model)}`,
    };
  }
  const expectedFields = expected.model.conditions.map((condition) => condition.field);
  const missing = expectedFields.filter((field) => !accepted.filterFields.includes(field));
  if (missing.length > 0) {
    return {
      code: "incorrect-accepted-model",
      message: `filter fields ${JSON.stringify(accepted.filterFields)} missing ${JSON.stringify(missing)}`,
    };
  }
  if (visible.displayedRowCount !== expected.displayedRowCount) {
    return {
      code: "incorrect-displayed-count",
      message: `filter displayedRowCount ${visible.displayedRowCount} !== ${expected.displayedRowCount}`,
    };
  }
  return null;
}

export function validateFilterClear(
  accepted: GridBenchmarkAcceptedState,
  visible: RuntimeVisibleState,
  expected: ExpectedOperations,
): CorrectnessFailure | null {
  if (!emptyAccepted(accepted)) {
    return {
      code: "incorrect-accepted-model",
      message: `clear filter left accepted state ${JSON.stringify(accepted)}`,
    };
  }
  if (visible.displayedRowCount !== expected.rowCount) {
    return {
      code: "incorrect-displayed-count",
      message: `clear filter displayedRowCount ${visible.displayedRowCount} !== ${expected.rowCount}`,
    };
  }
  return null;
}

export function validateColumnFilterTyping(
  accepted: GridBenchmarkAcceptedState,
  visible: RuntimeVisibleState,
  expected: ExpectedOperations,
  session: QuickSearchTypingSessionResult | null,
): CorrectnessFailure | null {
  const typing = expected.filters.typing;
  const modelFailure = validateFilterScenario(accepted, visible, {
    model: typing.model,
    displayedRowCount: typing.finalDisplayedRowCount,
  });
  if (modelFailure) return modelFailure;
  if (!session) {
    return {
      code: "protocol-error",
      message: "typeColumnFilter returned no session result",
    };
  }
  const expectedText = typing.model.conditions[0]?.kind === "text" ? typing.model.conditions[0].value : "";
  if (session.finalText !== expectedText) {
    return {
      code: "incorrect-accepted-model",
      message: `typed filter finalText "${session.finalText}" !== "${expectedText}"`,
    };
  }
  if (session.finalDisplayedRowCount !== typing.finalDisplayedRowCount) {
    return {
      code: "incorrect-displayed-count",
      message: `typed filter displayedRowCount ${session.finalDisplayedRowCount} !== ${typing.finalDisplayedRowCount}`,
    };
  }
  if (visible.displayedRowCount !== typing.finalDisplayedRowCount) {
    return {
      code: "incorrect-displayed-count",
      message: `typed filter visible displayedRowCount ${visible.displayedRowCount} !== ${typing.finalDisplayedRowCount}`,
    };
  }
  if (
    session.dispatchTimestampsMs.length !== session.prefixes.length ||
    session.scheduledTimestampsMs.length !== session.prefixes.length ||
    session.dispatchDelaysMs.length !== session.prefixes.length
  ) {
    return {
      code: "protocol-error",
      message: "typed filter is missing scheduled or actual dispatch timestamps",
    };
  }
  return null;
}

export type FilterEvidenceCommand = "filter" | "clear" | "sort";

export function validateFilterExecutionEvidence(
  evidence: FilterExecutionEvidence | QuickSearchExecutionEvidence | null,
  command: FilterEvidenceCommand = "filter",
): CorrectnessFailure | null {
  if (!evidence) {
    return {
      code: "protocol-error",
      message: "filter/sort execution evidence is missing",
    };
  }
  const product = evidence.product;
  const producer = evidence.producer ?? "unknown";
  const operation =
    "operation" in evidence && evidence.operation === "sort" ? "sort" : command;
  if (product === "ag-grid" || product === "baseline") {
    if ("workerRouteConfirmed" in evidence && evidence.workerRouteConfirmed === true) {
      return {
        code: "protocol-error",
        message: "AG Grid evidence must not invent a Worker producer",
      };
    }
    if (producer === "worker") {
      return {
        code: "protocol-error",
        message: "AG Grid evidence must not invent a Worker producer",
      };
    }
    return null;
  }
  if (operation === "clear") {
    if (producer !== "none") {
      return {
        code: "unexpected-producer",
        message:
          "Filter Clear does not schedule Filter execution and cannot inherit Apply producer evidence",
      };
    }
    if ("workerRouteConfirmed" in evidence && evidence.workerRouteConfirmed === true) {
      return {
        code: "protocol-error",
        message: "Filter Clear must not set workerRouteConfirmed; Clear is not Filter Worker evidence",
      };
    }
    return null;
  }
  if (producer === "none") {
    return {
      code: "missing-producer",
      message:
        "LightFastGrid Filter Apply/typing and Sort require a scheduled completion producer; none is valid only for Clear",
    };
  }
  if (producer === "unknown") {
    if (operation === "sort") {
      return null;
    }
    return {
      code: "missing-producer",
      message:
        "LightFastGrid filter/sort requires direct completion producer evidence; pending, eligibility, and Worker construction are not proof",
    };
  }
  if (producer === "cache" && evidence.workerRouteConfirmed === true) {
    return {
      code: "protocol-error",
      message: "cache producer cannot set workerRouteConfirmed; cache is not Worker execution",
    };
  }
  return null;
}

export function validateQuickSearchQuery(
  accepted: GridBenchmarkAcceptedState,
  visible: RuntimeVisibleState,
  text: string,
  displayedRowCount: number,
): CorrectnessFailure | null {
  if (accepted.quickSearch !== text) {
    return {
      code: "incorrect-accepted-model",
      message: `quickSearch "${accepted.quickSearch}" !== "${text}"`,
    };
  }
  if (accepted.sort.length > 0 || accepted.filterFields.length > 0) {
    return {
      code: "incorrect-accepted-model",
      message: "quickSearch left sort or column filters active",
    };
  }
  if (visible.displayedRowCount !== displayedRowCount) {
    return {
      code: "incorrect-displayed-count",
      message: `quickSearch displayedRowCount ${visible.displayedRowCount} !== ${displayedRowCount}`,
    };
  }
  return null;
}

export function validateQuickSearch(
  accepted: GridBenchmarkAcceptedState,
  visible: RuntimeVisibleState,
  expected: ExpectedOperations,
): CorrectnessFailure | null {
  return validateQuickSearchQuery(
    accepted,
    visible,
    expected.quickSearch.text,
    expected.quickSearch.displayedRowCount,
  );
}

export function validateClear(
  accepted: GridBenchmarkAcceptedState,
  visible: RuntimeVisibleState,
  expected: ExpectedOperations,
): CorrectnessFailure | null {
  if (!emptyAccepted(accepted)) {
    return {
      code: "incorrect-accepted-model",
      message: `clearOperations left accepted state ${JSON.stringify(accepted)}`,
    };
  }
  if (visible.displayedRowCount !== expected.rowCount) {
    return {
      code: "incorrect-displayed-count",
      message: `clearOperations displayedRowCount ${visible.displayedRowCount} !== ${expected.rowCount}`,
    };
  }
  return null;
}

export function validateScroll(
  visible: RuntimeVisibleState,
  expected: ExpectedOperations,
): CorrectnessFailure | null {
  const delta = Math.abs(visible.scrollTop - expected.scroll.top);
  if (delta > expected.scroll.tolerancePx) {
    return {
      code: "failed-scroll-settlement",
      message: `scrollTop ${visible.scrollTop} is ${delta}px from requested ${expected.scroll.top} (tolerance ${expected.scroll.tolerancePx}px)`,
    };
  }
  const first = parseRowIndex0(visible.firstRenderedRowId);
  const last = parseRowIndex0(visible.lastRenderedRowId);
  if (first === null || last === null) {
    return {
      code: "failed-scroll-settlement",
      message: `scroll did not expose rendered row ids (${visible.firstRenderedRowId}–${visible.lastRenderedRowId})`,
    };
  }
  const overlaps =
    last >= expected.scroll.expectedIndex0Low && first <= expected.scroll.expectedIndex0High;
  if (!overlaps) {
    return {
      code: "failed-scroll-settlement",
      message: `rendered rows ${first}–${last} do not overlap expected ${expected.scroll.expectedIndex0Low}–${expected.scroll.expectedIndex0High}`,
    };
  }
  return null;
}

export function validateTypingSession(
  accepted: GridBenchmarkAcceptedState,
  visible: RuntimeVisibleState,
  expected: ExpectedOperations,
  session: QuickSearchTypingSessionResult | null,
): CorrectnessFailure | null {
  const qs = validateQuickSearch(accepted, visible, expected);
  if (qs) return qs;
  if (!session) {
    return {
      code: "protocol-error",
      message: "typeQuickSearch returned no session result",
    };
  }
  if (session.finalText !== expected.quickSearch.text) {
    return {
      code: "incorrect-accepted-model",
      message: `typing session finalText "${session.finalText}" !== "${expected.quickSearch.text}"`,
    };
  }
  if (session.finalDisplayedRowCount !== expected.quickSearch.displayedRowCount) {
    return {
      code: "incorrect-displayed-count",
      message: `typing session displayedRowCount ${session.finalDisplayedRowCount} !== ${expected.quickSearch.displayedRowCount}`,
    };
  }
  if (session.variant === "burst") {
    if (
      session.dispatchTimestampsMs.length !== session.prefixes.length ||
      session.scheduledTimestampsMs.length !== session.prefixes.length ||
      session.dispatchDelaysMs.length !== session.prefixes.length
    ) {
      return {
        code: "protocol-error",
        message: "typing burst is missing scheduled or actual dispatch timestamps",
      };
    }
  }
  if (session.variant === "settledIncremental") {
    for (const prefix of expected.quickSearch.typingPrefixes) {
      const settlement = session.prefixSettlements.find((entry) => entry.prefix === prefix);
      const expectedCount = expected.quickSearch.typingDisplayedRowCounts[prefix];
      if (!settlement) {
        return {
          code: "incorrect-displayed-count",
          message: `settled typing missing prefix "${prefix}"`,
        };
      }
      if (settlement.displayedRowCount !== expectedCount) {
        return {
          code: "incorrect-displayed-count",
          message: `prefix "${prefix}" displayedRowCount ${settlement.displayedRowCount} !== ${expectedCount}`,
        };
      }
    }
  }
  return null;
}

export function validateQuickSearchExecutionRoute(
  evidence: QuickSearchExecutionEvidence | null,
  lfgMode: string | null,
): CorrectnessFailure | null {
  if (
    lfgMode !== "workerIsolated" &&
    lfgMode !== "mainThreadIsolated" &&
    lfgMode !== "workerProductionOptimized"
  ) {
    return null;
  }
  if (!evidence) {
    return {
      code: "protocol-error",
      message: "Quick Search execution evidence is missing",
    };
  }
  const producer = evidence.producer ?? "unknown";
  if (lfgMode === "workerIsolated") {
    if (producer === "unknown") {
      return {
        code: "missing-producer",
        message: "workerIsolated requires direct completion producer evidence; pending and eligibility are not proof",
      };
    }
    if (producer !== "worker") {
      return {
        code: "worker-route-unconfirmed",
        message: `workerIsolated requires producer "worker", got "${producer}"`,
      };
    }
    if (evidence.workerRouteConfirmed !== true) {
      return {
        code: "worker-route-unconfirmed",
        message: "workerIsolated workerRouteConfirmed must come from producer worker, not pending state",
      };
    }
  }
  if (lfgMode === "mainThreadIsolated") {
    if (evidence.forcedMainThread !== true) {
      return {
        code: "protocol-error",
        message: "mainThreadIsolated must record forcedMainThread",
      };
    }
    if (producer === "unknown") {
      return {
        code: "missing-producer",
        message: "forcedMainThread requires direct completion producer evidence",
      };
    }
    if (producer === "worker" || producer === "cache") {
      return {
        code: "unexpected-producer",
        message: `forcedMainThread producer must be mainThread, got "${producer}"`,
      };
    }
    if (producer !== "mainThread") {
      return {
        code: "unexpected-producer",
        message: `forcedMainThread producer must be mainThread, got "${producer}"`,
      };
    }
  }
  if (lfgMode === "workerProductionOptimized") {
    if (producer === "unknown") {
      return {
        code: "missing-producer",
        message:
          "workerProductionOptimized requires direct completion producer evidence; pending and eligibility are not proof",
      };
    }
    if (producer === "cache" && evidence.workerRouteConfirmed === true) {
      return {
        code: "protocol-error",
        message: "cache producer cannot set workerRouteConfirmed; cache is not Worker execution",
      };
    }
  }
  return null;
}
