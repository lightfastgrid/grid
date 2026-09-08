import type { Page } from "@playwright/test";

import type {
  FilterExecutionEvidence,
  GridBenchmarkRuntimeSample,
  NeutralFilterModel,
  QuickSearchExecutionEvidence,
  QuickSearchTypingSessionResult,
} from "../../../shared/src/benchmarkProtocol.ts";
import { RUNTIME_OPERATIONS, type ExpectedOperations } from "../../../shared/src/expectedOperations.ts";
import {
  isolatedFilterPlan,
  type SlotPurpose,
} from "../../../shared/src/filterScenarios.ts";
import type { LfgQuickSearchMode } from "../../../shared/src/lfgQuickSearchMode.ts";
import {
  isolatedQuickSearchPlan,
  type QuickSearchScenarioId,
} from "../../../shared/src/quickSearchScenarios.ts";
import type { RuntimeOperationId } from "../metrics/schema.ts";
import type { CpuThrottleResult } from "./cpuThrottle.ts";
import {
  validateClear,
  validateColumnFilterTyping,
  validateFilterClear,
  validateFilterExecutionEvidence,
  validateFilterScenario,
  validateMount,
  validateQuickSearch,
  validateQuickSearchExecutionRoute,
  validateQuickSearchQuery,
  validateScroll,
  validateSort,
  validateTypingSession,
  type CorrectnessFailure,
  type InvalidSampleCode,
} from "./correctness.ts";
import { HarnessPhaseError } from "./harnessFailures.ts";
import type { PageIssue } from "./pageGuards.ts";
import {
  classifyProtocolError,
  destroyGrid,
  measureProtocolCall,
  prepareScenario,
  type ProtocolCallResult,
} from "./protocolClient.ts";

export type IterationOperationRecord = {
  readonly operation: RuntimeOperationId;
  readonly valid: boolean;
  readonly role: "warmup" | "measured";
  readonly durationMs: number | null;
  readonly uxDurationMs: number | null;
  readonly generationMs: number | null;
  readonly observers: GridBenchmarkRuntimeSample | null;
  readonly visible: ProtocolCallResult["visible"];
  readonly accepted: ProtocolCallResult["accepted"];
  readonly domNodeCount: number | null;
  readonly invalidReason: InvalidSampleCode | null;
  readonly invalidMessage: string | null;
  readonly lfgMode: LfgQuickSearchMode | null;
  readonly purpose: SlotPurpose;
  readonly scenarioId: string | null;
  readonly typingSession: QuickSearchTypingSessionResult | null;
  readonly executionEvidence: QuickSearchExecutionEvidence | FilterExecutionEvidence | null;
  readonly cpuThrottle: CpuThrottleResult | null;
};

function issuesFailure(issues: readonly PageIssue[]): CorrectnessFailure | null {
  const first = issues[0];
  if (!first) return null;
  return { code: first.kind, message: first.message };
}

function typingDuration(result: ProtocolCallResult): {
  durationMs: number | null;
  uxDurationMs: number | null;
} {
  const session = result.typingSession;
  if (!session) {
    return { durationMs: result.durationMs, uxDurationMs: null };
  }
  return {
    durationMs: session.finalKeystrokeToFinalPaintMs,
    uxDurationMs: session.firstKeystrokeToFinalPaintMs,
  };
}

function classifyMeasuredError(message: string): InvalidSampleCode {
  if (/inherited prior Quick Search/i.test(message) || /inherited prior filter/i.test(message)) {
    return "scenario-contamination";
  }
  return classifyProtocolError(message);
}

export function evaluateSetupReset(
  result: ProtocolCallResult,
  issues: readonly PageIssue[],
  expected: ExpectedOperations,
): CorrectnessFailure | null {
  const reasons: string[] = [];
  if (!result.ok) {
    reasons.push(result.error ?? "setup reset protocol error");
  }
  for (const issue of issues) {
    reasons.push(`${issue.kind}: ${issue.message}`);
  }
  if (!result.accepted || !result.visible) {
    reasons.push("setup reset returned no accepted/visible state");
  } else {
    const correctness = validateClear(result.accepted, result.visible, expected);
    if (correctness) reasons.push(correctness.message);
  }
  if (reasons.length === 0) return null;
  return {
    code: "invalid-setup-state",
    message: `setup reset failed: ${reasons.join("; ")}`,
  };
}

export function setupResetInvalidRecord(
  operation: RuntimeOperationId,
  role: "warmup" | "measured",
  result: ProtocolCallResult,
  failure: CorrectnessFailure,
  scenarioId: string | null = null,
): IterationOperationRecord {
  return {
    operation,
    valid: false,
    role,
    durationMs: null,
    generationMs: null,
    observers: null,
    visible: result.visible,
    accepted: result.accepted,
    domNodeCount: result.domNodeCount,
    invalidReason: "invalid-setup-state",
    invalidMessage: failure.message,
    uxDurationMs: null,
    lfgMode: null,
    purpose: "competitive",
    scenarioId,
    typingSession: result.typingSession,
    executionEvidence: result.executionEvidence,
    cpuThrottle: null,
  };
}

export async function runIteration(
  page: Page,
  options: {
    readonly scenario: string;
    readonly role: "warmup" | "measured";
    readonly expected: ExpectedOperations;
    readonly protocolTimeoutMs: number;
    readonly drainIssues: () => Promise<PageIssue[]>;
    readonly lfgMode?: LfgQuickSearchMode | null;
    readonly purpose?: SlotPurpose;
  },
): Promise<IterationOperationRecord[]> {
  const { role, expected, protocolTimeoutMs, drainIssues } = options;
  const lfgMode = options.lfgMode ?? null;
  const purpose: SlotPurpose = options.purpose ?? "competitive";
  const timeoutMs = protocolTimeoutMs + 10_000;
  const records: IterationOperationRecord[] = [];

  const toRecord = (
    operation: RuntimeOperationId,
    result: ProtocolCallResult,
    failure: CorrectnessFailure | null,
    generation: number | null,
    durationOverride?: { durationMs: number | null; uxDurationMs: number | null },
    scenarioId: string | null = null,
  ): IterationOperationRecord => {
    const timed = durationOverride ?? typingDuration(result);
    return {
      operation,
      valid: failure == null,
      role,
      durationMs: timed.durationMs,
      uxDurationMs: timed.uxDurationMs,
      generationMs: generation,
      observers: result.observers,
      visible: result.visible,
      accepted: result.accepted,
      domNodeCount: result.domNodeCount,
      invalidReason: failure?.code ?? null,
      invalidMessage: failure?.message ?? null,
      lfgMode,
      purpose,
      scenarioId,
      typingSession: result.typingSession,
      executionEvidence: result.executionEvidence,
      cpuThrottle: null,
    };
  };

  let prepared;
  try {
    prepared = await prepareScenario(page, options.scenario);
  } catch (error) {
    throw new HarnessPhaseError("preparation", error);
  }
  const generationMs = prepared.generationMs;
  const ops = RUNTIME_OPERATIONS;
  const typingArgs = [
    {
      variant: "burst" as const,
      prefixes: [...ops.quickSearchTyping.prefixes],
      intervalMs: ops.quickSearchTyping.intervalMs,
    },
  ];
  const settledArgs = [
    {
      variant: "settledIncremental" as const,
      prefixes: [...ops.quickSearchTyping.prefixes],
      intervalMs: ops.quickSearchTyping.intervalMs,
    },
  ];
  const filterTypingArgs = [
    {
      field: ops.filterTyping.field,
      variant: "burst" as const,
      prefixes: [...ops.filterTyping.prefixes],
      intervalMs: ops.filterTyping.intervalMs,
    },
  ];

  const measured: Array<{
    operation: RuntimeOperationId;
    method: string;
    args: readonly unknown[];
    scenarioId: string | null;
    validate: (result: ProtocolCallResult) => CorrectnessFailure | null;
    duration?: (result: ProtocolCallResult) => { durationMs: number | null; uxDurationMs: number | null };
  }> = [
    {
      operation: "mount",
      method: "mount",
      args: [],
      scenarioId: null,
      validate: (result) =>
        result.visible ? validateMount(result.visible, expected) : {
          code: "protocol-error",
          message: "mount returned no visible state",
        },
    },
    {
      operation: "sort",
      method: "sort",
      args: [ops.sort.field, ops.sort.direction],
      scenarioId: null,
      validate: (result) => {
        if (!result.accepted || !result.visible) {
          return { code: "protocol-error", message: "sort returned no accepted/visible state" };
        }
        return (
          validateSort(result.accepted, result.visible, expected) ??
          validateFilterExecutionEvidence(result.executionEvidence, "sort")
        );
      },
    },
    {
      operation: "quickSearch",
      method: "quickSearch",
      args: [ops.quickSearch.text],
      scenarioId: "coldFullQuery",
      validate: (result) => {
        if (!result.accepted || !result.visible) {
          return { code: "protocol-error", message: "quickSearch returned no accepted/visible state" };
        }
        return (
          validateQuickSearch(result.accepted, result.visible, expected) ??
          validateQuickSearchExecutionRoute(result.executionEvidence, lfgMode)
        );
      },
    },
    {
      operation: "quickSearchPrimedDifferent",
      method: "quickSearch",
      args: [ops.quickSearch.text],
      scenarioId: "primedDifferentQuery",
      validate: (result) => {
        if (!result.accepted || !result.visible) {
          return { code: "protocol-error", message: "quickSearchPrimedDifferent returned no accepted/visible state" };
        }
        return (
          validateQuickSearch(result.accepted, result.visible, expected) ??
          validateQuickSearchExecutionRoute(result.executionEvidence, lfgMode)
        );
      },
    },
    {
      operation: "quickSearchRepeatedSame",
      method: "quickSearch",
      args: [ops.quickSearch.text],
      scenarioId: "repeatedSameQuery",
      validate: (result) => {
        if (!result.accepted || !result.visible) {
          return { code: "protocol-error", message: "quickSearchRepeatedSame returned no accepted/visible state" };
        }
        return (
          validateQuickSearch(result.accepted, result.visible, expected) ??
          validateQuickSearchExecutionRoute(result.executionEvidence, lfgMode)
        );
      },
    },
    {
      operation: "quickSearchTypingBurst",
      method: "typeQuickSearch",
      args: typingArgs,
      scenarioId: "coldRealisticTyping",
      validate: (result) => {
        if (!result.accepted || !result.visible) {
          return { code: "protocol-error", message: "typing burst returned no accepted/visible state" };
        }
        return (
          validateTypingSession(result.accepted, result.visible, expected, result.typingSession) ??
          validateQuickSearchExecutionRoute(result.executionEvidence, lfgMode)
        );
      },
      duration: typingDuration,
    },
    {
      operation: "quickSearchTypingSettled",
      method: "typeQuickSearch",
      args: settledArgs,
      scenarioId: "settledIncremental",
      validate: (result) => {
        if (!result.accepted || !result.visible) {
          return { code: "protocol-error", message: "settled typing returned no accepted/visible state" };
        }
        return (
          validateTypingSession(result.accepted, result.visible, expected, result.typingSession) ??
          validateQuickSearchExecutionRoute(result.executionEvidence, lfgMode)
        );
      },
      duration: typingDuration,
    },
    {
      operation: "clearOperations",
      method: "clearOperations",
      args: [],
      scenarioId: null,
      validate: (result) =>
        result.accepted && result.visible
          ? validateClear(result.accepted, result.visible, expected)
          : { code: "protocol-error", message: "clearOperations returned no accepted/visible state" },
    },
    {
      operation: "scrollTo",
      method: "scrollTo",
      args: [ops.scrollTo.top, ops.scrollTo.left],
      scenarioId: null,
      validate: (result) =>
        result.visible
          ? validateScroll(result.visible, expected)
          : { code: "protocol-error", message: "scrollTo returned no visible state" },
    },
  ];

  const byOp = Object.fromEntries(measured.map((spec) => [spec.operation, spec])) as Record<
    RuntimeOperationId,
    (typeof measured)[number]
  >;

  async function runOp(
    spec: (typeof measured)[number],
    generation: number | null,
  ): Promise<ProtocolCallResult> {
    const result = await measureProtocolCall(page, spec.method, spec.args, timeoutMs);
    const pageFailure = issuesFailure(await options.drainIssues());
    const timed = spec.duration?.(result);
    if (!result.ok) {
      const code = classifyMeasuredError(result.error ?? "protocol error");
      records.push(
        toRecord(
          spec.operation,
          result,
          { code, message: result.error ?? "protocol error" },
          generation,
          timed,
          spec.scenarioId,
        ),
      );
      return result;
    }
    if (pageFailure) {
      records.push(toRecord(spec.operation, result, pageFailure, generation, timed, spec.scenarioId));
      return result;
    }
    const correctness = spec.validate(result);
    records.push(toRecord(spec.operation, result, correctness, generation, timed, spec.scenarioId));
    return result;
  }

  async function runSetupReset(
    nextOperation: RuntimeOperationId,
    scenarioId: string | null = null,
  ): Promise<boolean> {
    const result = await measureProtocolCall(page, "clearOperations", [], timeoutMs);
    const issues = await drainIssues();
    const failure = evaluateSetupReset(result, issues, expected);
    if (!failure) return true;
    records.push({
      ...setupResetInvalidRecord(nextOperation, role, result, failure, scenarioId),
      lfgMode,
      purpose,
    });
    return false;
  }

  function invalidateScenario(
    operation: RuntimeOperationId,
    scenarioId: string,
    result: ProtocolCallResult,
    failure: CorrectnessFailure,
  ): void {
    records.push({
      ...setupResetInvalidRecord(operation, role, result, failure, scenarioId),
      lfgMode,
      purpose,
      scenarioId,
    });
  }

  async function remountFreshInstance(
    operation: RuntimeOperationId,
    scenarioId: string,
  ): Promise<boolean> {
    const result = await measureProtocolCall(page, "mount", [], timeoutMs);
    const issues = await drainIssues();
    if (!result.ok) {
      invalidateScenario(operation, scenarioId, result, {
        code: "invalid-setup-state",
        message: `unrecorded remount failed: ${result.error ?? "protocol error"}`,
      });
      return false;
    }
    const pageFailure = issuesFailure(issues);
    if (pageFailure) {
      invalidateScenario(operation, scenarioId, result, {
        code: "invalid-setup-state",
        message: `unrecorded remount failed: ${pageFailure.message}`,
      });
      return false;
    }
    if (!result.visible) {
      invalidateScenario(operation, scenarioId, result, {
        code: "invalid-setup-state",
        message: "unrecorded remount returned no visible state",
      });
      return false;
    }
    const mountFailure = validateMount(result.visible, expected);
    if (mountFailure) {
      invalidateScenario(operation, scenarioId, result, {
        code: "invalid-setup-state",
        message: `unrecorded remount failed: ${mountFailure.message}`,
      });
      return false;
    }
    return true;
  }

  async function runUnrecordedPrep(
    operation: RuntimeOperationId,
    scenarioId: QuickSearchScenarioId,
    text: string,
    displayedRowCount: number,
  ): Promise<boolean> {
    const result = await measureProtocolCall(page, "quickSearch", [text], timeoutMs);
    const issues = await drainIssues();
    if (!result.ok) {
      invalidateScenario(operation, scenarioId, result, {
        code: "invalid-setup-state",
        message: `unrecorded priming query ${JSON.stringify(text)} failed: ${result.error ?? "protocol error"}`,
      });
      return false;
    }
    const pageFailure = issuesFailure(issues);
    if (pageFailure) {
      invalidateScenario(operation, scenarioId, result, {
        code: "invalid-setup-state",
        message: `unrecorded priming query ${JSON.stringify(text)} failed: ${pageFailure.message}`,
      });
      return false;
    }
    if (!result.accepted || !result.visible) {
      invalidateScenario(operation, scenarioId, result, {
        code: "invalid-setup-state",
        message: `unrecorded priming query ${JSON.stringify(text)} returned no accepted/visible state`,
      });
      return false;
    }
    const correctness = validateQuickSearchQuery(
      result.accepted,
      result.visible,
      text,
      displayedRowCount,
    );
    if (correctness) {
      invalidateScenario(operation, scenarioId, result, {
        code: "invalid-setup-state",
        message: `unrecorded priming query ${JSON.stringify(text)} failed: ${correctness.message}`,
      });
      return false;
    }
    return runSetupReset(operation, scenarioId);
  }

  async function runUnrecordedFilterApply(
    operation: RuntimeOperationId,
    scenarioId: string,
    model: NeutralFilterModel,
    displayedRowCount: number,
  ): Promise<boolean> {
    const result = await measureProtocolCall(page, "applyFilterModel", [model], timeoutMs);
    const issues = await drainIssues();
    if (!result.ok) {
      invalidateScenario(operation, scenarioId, result, {
        code: "invalid-setup-state",
        message: `unrecorded filter apply failed: ${result.error ?? "protocol error"}`,
      });
      return false;
    }
    const pageFailure = issuesFailure(issues);
    if (pageFailure) {
      invalidateScenario(operation, scenarioId, result, {
        code: "invalid-setup-state",
        message: `unrecorded filter apply failed: ${pageFailure.message}`,
      });
      return false;
    }
    if (!result.accepted || !result.visible) {
      invalidateScenario(operation, scenarioId, result, {
        code: "invalid-setup-state",
        message: "unrecorded filter apply returned no accepted/visible state",
      });
      return false;
    }
    const correctness = validateFilterScenario(result.accepted, result.visible, {
      model,
      displayedRowCount,
    });
    if (correctness) {
      invalidateScenario(operation, scenarioId, result, {
        code: "invalid-setup-state",
        message: `unrecorded filter apply failed: ${correctness.message}`,
      });
      return false;
    }
    return true;
  }

  function expectedFilterCount(model: NeutralFilterModel): number {
    if (model === expected.filters.text.model) return expected.filters.text.displayedRowCount;
    if (model === expected.filters.numberRange.model) return expected.filters.numberRange.displayedRowCount;
    if (model === expected.filters.combined.model) return expected.filters.combined.displayedRowCount;
    return expected.filters.typing.finalDisplayedRowCount;
  }

  try {
    if (purpose === "quickSearch") {
      for (const step of isolatedQuickSearchPlan()) {
        const spec = byOp[step.measuredOperation];
        if (!(await remountFreshInstance(spec.operation, step.scenarioId))) continue;
        if (step.unrecordedPrepQuery) {
          const displayedRowCount =
            step.unrecordedPrepQuery === expected.quickSearch.primingText
              ? expected.quickSearch.primingDisplayedRowCount
              : expected.quickSearch.displayedRowCount;
          if (
            !(await runUnrecordedPrep(
              spec.operation,
              step.scenarioId,
              step.unrecordedPrepQuery,
              displayedRowCount,
            ))
          ) {
            continue;
          }
        }
        await runOp(spec, null);
      }
    } else {
      await runOp(byOp.mount, generationMs);
      await runOp(byOp.sort, null);
      for (const step of isolatedFilterPlan()) {
        if (!(await remountFreshInstance(step.measuredOperation, step.scenarioId))) continue;
        if (step.unrecordedApply) {
          if (
            !(await runUnrecordedFilterApply(
              step.measuredOperation,
              step.scenarioId,
              step.unrecordedApply,
              expectedFilterCount(step.unrecordedApply),
            ))
          ) {
            continue;
          }
        }
        const filterSpec = {
          operation: step.measuredOperation,
          method: step.method,
          args:
            step.method === "applyFilterModel"
              ? [step.applyModel]
              : step.method === "typeColumnFilter"
                ? filterTypingArgs
                : [],
          scenarioId: step.scenarioId,
          duration: step.method === "typeColumnFilter" ? typingDuration : undefined,
          validate: (result: ProtocolCallResult): CorrectnessFailure | null => {
            if (!result.accepted || !result.visible) {
              return {
                code: "protocol-error",
                message: `${step.measuredOperation} returned no accepted/visible state`,
              };
            }
            const correctness =
              step.method === "clearFilterModel"
                ? validateFilterClear(result.accepted, result.visible, expected)
                : step.method === "typeColumnFilter"
                  ? validateColumnFilterTyping(
                      result.accepted,
                      result.visible,
                      expected,
                      result.typingSession,
                    )
                  : validateFilterScenario(result.accepted, result.visible, {
                      model: step.applyModel ?? expected.filters.text.model,
                      displayedRowCount: expectedFilterCount(step.applyModel ?? expected.filters.text.model),
                    });
            return correctness ?? validateFilterExecutionEvidence(
              result.executionEvidence,
              step.method === "clearFilterModel" ? "clear" : "filter",
            );
          },
        };
        await runOp(filterSpec, null);
      }
      await runOp(byOp.clearOperations, null);
      await runOp(byOp.scrollTo, null);
    }
  } catch (error) {
    if (error instanceof HarnessPhaseError) throw error;
    throw new HarnessPhaseError("operation", error);
  } finally {
    try {
      await destroyGrid(page);
    } catch {
      // Destroy failures are recorded only if they leave a competing host; the
      // next slot starts a fresh page.
    }
  }

  return records;
}
