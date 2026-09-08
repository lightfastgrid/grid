export const QUICK_SEARCH_SCENARIO_IDS = [
  "coldFullQuery",
  "coldRealisticTyping",
  "primedDifferentQuery",
  "repeatedSameQuery",
  "settledIncremental",
] as const;

export type QuickSearchScenarioId = (typeof QUICK_SEARCH_SCENARIO_IDS)[number];

export const QUICK_SEARCH_PRIMING_TEXT = "Morgan";

export function isQuickSearchScenarioId(value: unknown): value is QuickSearchScenarioId {
  return (
    value === "coldFullQuery" ||
    value === "coldRealisticTyping" ||
    value === "primedDifferentQuery" ||
    value === "repeatedSameQuery" ||
    value === "settledIncremental"
  );
}

export type IsolatedQuickSearchStep = {
  readonly scenarioId: QuickSearchScenarioId;
  readonly remount: true;
  readonly unrecordedPrepQuery: string | null;
  readonly measuredOperation:
    | "quickSearch"
    | "quickSearchTypingBurst"
    | "quickSearchPrimedDifferent"
    | "quickSearchRepeatedSame"
    | "quickSearchTypingSettled";
};

/**
 * Each measured Quick Search scenario starts on a fresh grid instance.
 * Clearing accepted text is not a substitute for remounting.
 */
export function isolatedQuickSearchPlan(): readonly IsolatedQuickSearchStep[] {
  return [
    {
      scenarioId: "coldFullQuery",
      remount: true,
      unrecordedPrepQuery: null,
      measuredOperation: "quickSearch",
    },
    {
      scenarioId: "coldRealisticTyping",
      remount: true,
      unrecordedPrepQuery: null,
      measuredOperation: "quickSearchTypingBurst",
    },
    {
      scenarioId: "primedDifferentQuery",
      remount: true,
      unrecordedPrepQuery: QUICK_SEARCH_PRIMING_TEXT,
      measuredOperation: "quickSearchPrimedDifferent",
    },
    {
      scenarioId: "repeatedSameQuery",
      remount: true,
      unrecordedPrepQuery: "Patel",
      measuredOperation: "quickSearchRepeatedSame",
    },
    {
      scenarioId: "settledIncremental",
      remount: true,
      unrecordedPrepQuery: null,
      measuredOperation: "quickSearchTypingSettled",
    },
  ];
}
