import type { NeutralFilterModel } from "./benchmarkProtocol.ts";
import {
  andFilter,
  numberBetweenFilter,
  textContainsFilter,
} from "./neutralFilter.ts";
import {
  QUICK_SEARCH_FINAL_TEXT,
  QUICK_SEARCH_TYPING_INTERVAL_MS,
  QUICK_SEARCH_TYPING_PREFIXES,
} from "./typingSession.ts";

export const FILTER_SCENARIO_IDS = [
  "textApply",
  "textClear",
  "numberRangeApply",
  "numberRangeClear",
  "combinedApply",
  "combinedClear",
  "typingBurst",
] as const;

export type FilterScenarioId = (typeof FILTER_SCENARIO_IDS)[number];

export type FilterOperationId =
  | "filterTextApply"
  | "filterTextClear"
  | "filterNumberRangeApply"
  | "filterNumberRangeClear"
  | "filterCombinedApply"
  | "filterCombinedClear"
  | "filterTypingBurst";

export const FILTER_TEXT_FIELD = "status";
export const FILTER_TEXT_VALUE = "Active";
export const FILTER_NUMBER_FIELD = "amount";
export const FILTER_NUMBER_MINIMUM = 25_000;
export const FILTER_NUMBER_MAXIMUM = 75_000;
export const FILTER_TYPING_FIELD = "name";

export const FILTER_TEXT_MODEL: NeutralFilterModel = textContainsFilter(
  FILTER_TEXT_FIELD,
  FILTER_TEXT_VALUE,
);
export const FILTER_NUMBER_MODEL: NeutralFilterModel = numberBetweenFilter(
  FILTER_NUMBER_FIELD,
  FILTER_NUMBER_MINIMUM,
  FILTER_NUMBER_MAXIMUM,
);
export const FILTER_COMBINED_MODEL: NeutralFilterModel = andFilter(
  FILTER_TEXT_MODEL,
  FILTER_NUMBER_MODEL,
);

export type IsolatedFilterStep = {
  readonly scenarioId: FilterScenarioId;
  readonly remount: true;
  readonly unrecordedApply: NeutralFilterModel | null;
  readonly measuredOperation: FilterOperationId;
  readonly method: "applyFilterModel" | "clearFilterModel" | "typeColumnFilter";
  readonly applyModel: NeutralFilterModel | null;
};

export function isolatedFilterPlan(): readonly IsolatedFilterStep[] {
  return [
    {
      scenarioId: "textApply",
      remount: true,
      unrecordedApply: null,
      measuredOperation: "filterTextApply",
      method: "applyFilterModel",
      applyModel: FILTER_TEXT_MODEL,
    },
    {
      scenarioId: "textClear",
      remount: true,
      unrecordedApply: FILTER_TEXT_MODEL,
      measuredOperation: "filterTextClear",
      method: "clearFilterModel",
      applyModel: null,
    },
    {
      scenarioId: "numberRangeApply",
      remount: true,
      unrecordedApply: null,
      measuredOperation: "filterNumberRangeApply",
      method: "applyFilterModel",
      applyModel: FILTER_NUMBER_MODEL,
    },
    {
      scenarioId: "numberRangeClear",
      remount: true,
      unrecordedApply: FILTER_NUMBER_MODEL,
      measuredOperation: "filterNumberRangeClear",
      method: "clearFilterModel",
      applyModel: null,
    },
    {
      scenarioId: "combinedApply",
      remount: true,
      unrecordedApply: null,
      measuredOperation: "filterCombinedApply",
      method: "applyFilterModel",
      applyModel: FILTER_COMBINED_MODEL,
    },
    {
      scenarioId: "combinedClear",
      remount: true,
      unrecordedApply: FILTER_COMBINED_MODEL,
      measuredOperation: "filterCombinedClear",
      method: "clearFilterModel",
      applyModel: null,
    },
    {
      scenarioId: "typingBurst",
      remount: true,
      unrecordedApply: null,
      measuredOperation: "filterTypingBurst",
      method: "typeColumnFilter",
      applyModel: textContainsFilter(FILTER_TYPING_FIELD, QUICK_SEARCH_FINAL_TEXT),
    },
  ];
}

export function isFilterScenarioId(value: unknown): value is FilterScenarioId {
  return FILTER_SCENARIO_IDS.includes(value as FilterScenarioId);
}

export function isFilterOperationId(value: unknown): value is FilterOperationId {
  return (
    value === "filterTextApply" ||
    value === "filterTextClear" ||
    value === "filterNumberRangeApply" ||
    value === "filterNumberRangeClear" ||
    value === "filterCombinedApply" ||
    value === "filterCombinedClear" ||
    value === "filterTypingBurst"
  );
}

export const FILTER_CLEAR_OPERATIONS = [
  "filterTextClear",
  "filterNumberRangeClear",
  "filterCombinedClear",
] as const;

export const FILTER_SCHEDULED_OPERATIONS = [
  "filterTextApply",
  "filterNumberRangeApply",
  "filterCombinedApply",
  "filterTypingBurst",
] as const;

export function isFilterClearOperation(value: unknown): boolean {
  return (FILTER_CLEAR_OPERATIONS as readonly string[]).includes(String(value));
}

export function isFilterScheduledOperation(value: unknown): boolean {
  return (FILTER_SCHEDULED_OPERATIONS as readonly string[]).includes(String(value));
}

export function filterWorkerClaimsApplicable(operation: unknown): boolean {
  return isFilterScheduledOperation(operation) || operation === "sort";
}

export const FILTER_TYPING_PREFIXES = QUICK_SEARCH_TYPING_PREFIXES;
export const FILTER_TYPING_INTERVAL_MS = QUICK_SEARCH_TYPING_INTERVAL_MS;
export const FILTER_TYPING_FINAL_TEXT = QUICK_SEARCH_FINAL_TEXT;

export const ORDINARY_COMPETITIVE_OPERATIONS = [
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
] as const;

export const QUICK_SEARCH_ONLY_OPERATIONS = [
  "quickSearch",
  "quickSearchPrimedDifferent",
  "quickSearchRepeatedSame",
  "quickSearchTypingBurst",
  "quickSearchTypingSettled",
] as const;

export type SlotPurpose = "competitive" | "quickSearch";

export function requiredOperationsForPurpose(
  purpose: SlotPurpose,
): readonly string[] {
  return purpose === "quickSearch"
    ? QUICK_SEARCH_ONLY_OPERATIONS
    : ORDINARY_COMPETITIVE_OPERATIONS;
}

export function isQuickSearchOnlyOperation(value: string): boolean {
  return (QUICK_SEARCH_ONLY_OPERATIONS as readonly string[]).includes(value);
}

export function isOrdinaryCompetitiveOperation(value: string): boolean {
  return (ORDINARY_COMPETITIVE_OPERATIONS as readonly string[]).includes(value);
}
