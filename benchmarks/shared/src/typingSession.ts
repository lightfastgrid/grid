import type {
  QuickSearchExecutionEvidence,
  QuickSearchPendingTransition,
  QuickSearchPrefixDispatch,
  QuickSearchPrefixSettlement,
  QuickSearchTypingOptions,
  QuickSearchTypingSessionResult,
  QuickSearchTypingVariant,
} from "./benchmarkProtocol.ts";
import { waitAnimationFrames, waitForPredicate, waitWithTimeout } from "./completion.ts";
import { fromAgGridFilterModel, fromLightFastGridFilterModel, textContainsFilter, toAgGridFilterModel, toLightFastGridFilterModel } from "./neutralFilter.ts";

export const QUICK_SEARCH_TYPING_PREFIXES = ["P", "Pa", "Pat", "Pate", "Patel"] as const;
export const QUICK_SEARCH_TYPING_INTERVAL_MS = 120;
export const QUICK_SEARCH_FINAL_TEXT = "Patel";

export type QuickSearchTypingAdapter = {
  readonly product: "lightfastgrid" | "ag-grid" | "baseline";
  setText(text: string): void;
  subscribeAccepted(handler: (text: string) => void): () => void;
  subscribePending?(handler: (pending: boolean) => void): () => void;
  getAcceptedText(): string;
  getDisplayedRowCount(): number;
  isPending?(): boolean;
  assertFreshQuickSearch?(): void;
};

export type LightFastGridTypingGrid = {
  on(
    event: "quick-filter:changed",
    handler: (event: { quickFilterText: string }) => void,
  ): () => void;
  on(
    event: "quick-search-pending:changed",
    handler: (event: { pending: boolean }) => void,
  ): () => void;
  getQuickFilterText(): string;
};

export function createLightFastGridTypingAdapter(options: {
  grid: LightFastGridTypingGrid;
  setText: (text: string) => void;
  getDisplayedRowCount: () => number;
}): QuickSearchTypingAdapter {
  let pending = false;
  return {
    product: "lightfastgrid",
    setText: options.setText,
    subscribeAccepted(handler) {
      return options.grid.on("quick-filter:changed", (event) => {
        handler(event.quickFilterText);
      });
    },
    subscribePending(handler) {
      return options.grid.on("quick-search-pending:changed", (event) => {
        pending = event.pending;
        handler(event.pending);
      });
    },
    getAcceptedText: () => options.grid.getQuickFilterText() ?? "",
    getDisplayedRowCount: options.getDisplayedRowCount,
    isPending: () => pending,
    assertFreshQuickSearch() {
      const text = options.grid.getQuickFilterText() ?? "";
      if (text.trim().length > 0) {
        throw new Error(
          `cold typing inherited prior Quick Search state ${JSON.stringify(text)}`,
        );
      }
    },
  };
}

export type AgGridTypingApi = {
  addEventListener(event: "filterChanged", listener: () => void): void;
  removeEventListener(event: "filterChanged", listener: () => void): void;
  setGridOption(key: "quickFilterText", value: string): void;
  getGridOption(key: "quickFilterText"): unknown;
  getDisplayedRowCount(): number;
};

export function createAgGridTypingAdapter(api: AgGridTypingApi): QuickSearchTypingAdapter {
  return {
    product: "ag-grid",
    setText(text) {
      api.setGridOption("quickFilterText", text);
    },
    subscribeAccepted(handler) {
      const listener = () => {
        handler(String(api.getGridOption("quickFilterText") ?? ""));
      };
      api.addEventListener("filterChanged", listener);
      return () => api.removeEventListener("filterChanged", listener);
    },
    getAcceptedText: () => String(api.getGridOption("quickFilterText") ?? ""),
    getDisplayedRowCount: () => api.getDisplayedRowCount(),
    assertFreshQuickSearch() {
      const text = String(api.getGridOption("quickFilterText") ?? "");
      if (text.trim().length > 0) {
        throw new Error(
          `cold typing inherited prior Quick Search state ${JSON.stringify(text)}`,
        );
      }
    },
  };
}

export function createLightFastGridColumnFilterTypingAdapter(options: {
  readonly field: string;
  setFilterModel(model: Record<string, unknown>): void;
  getFilterModel(): Record<string, unknown>;
  subscribeFilterChanged(handler: () => void): () => void;
  getDisplayedRowCount(): number;
}): QuickSearchTypingAdapter {
  const acceptedText = () => {
    const condition = fromLightFastGridFilterModel(options.getFilterModel()).conditions.find(
      (entry) => entry.field === options.field,
    );
    return condition && condition.kind === "text" ? condition.value : "";
  };
  return {
    product: "lightfastgrid",
    setText(text) {
      options.setFilterModel(toLightFastGridFilterModel(textContainsFilter(options.field, text)));
    },
    subscribeAccepted(handler) {
      return options.subscribeFilterChanged(() => {
        handler(acceptedText());
      });
    },
    getAcceptedText: acceptedText,
    getDisplayedRowCount: options.getDisplayedRowCount,
    assertFreshQuickSearch() {
      const text = acceptedText();
      if (text.trim().length > 0) {
        throw new Error(
          `cold column-filter typing inherited prior filter ${JSON.stringify(text)}`,
        );
      }
    },
  };
}

export function createAgGridColumnFilterTypingAdapter(options: {
  readonly field: string;
  setFilterModel(model: Record<string, unknown> | null): void;
  getFilterModel(): Record<string, unknown> | null;
  onFilterChanged(): void;
  addEventListener(event: "filterChanged", listener: () => void): void;
  removeEventListener(event: "filterChanged", listener: () => void): void;
  getDisplayedRowCount(): number;
}): QuickSearchTypingAdapter {
  const acceptedText = () => {
    const condition = fromAgGridFilterModel(options.getFilterModel()).conditions.find(
      (entry) => entry.field === options.field,
    );
    return condition && condition.kind === "text" ? condition.value : "";
  };
  return {
    product: "ag-grid",
    setText(text) {
      options.setFilterModel(toAgGridFilterModel(textContainsFilter(options.field, text)));
      options.onFilterChanged();
    },
    subscribeAccepted(handler) {
      const listener = () => {
        handler(acceptedText());
      };
      options.addEventListener("filterChanged", listener);
      return () => options.removeEventListener("filterChanged", listener);
    },
    getAcceptedText: acceptedText,
    getDisplayedRowCount: options.getDisplayedRowCount,
    assertFreshQuickSearch() {
      const text = acceptedText();
      if (text.trim().length > 0) {
        throw new Error(
          `cold column-filter typing inherited prior filter ${JSON.stringify(text)}`,
        );
      }
    },
  };
}

function sleepUntil(targetNow: number): Promise<void> {
  const delay = Math.max(0, targetNow - performance.now());
  if (delay === 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

function resolveTypingOptions(options: QuickSearchTypingOptions): {
  prefixes: readonly string[];
  intervalMs: number;
  variant: QuickSearchTypingVariant;
} {
  const prefixes = options.prefixes ?? QUICK_SEARCH_TYPING_PREFIXES;
  if (prefixes.length === 0) {
    throw new Error("typeQuickSearch requires at least one prefix");
  }
  const last = prefixes[prefixes.length - 1];
  if (last !== QUICK_SEARCH_FINAL_TEXT) {
    throw new Error(
      `typeQuickSearch final prefix must be "${QUICK_SEARCH_FINAL_TEXT}", got ${JSON.stringify(last)}`,
    );
  }
  return {
    prefixes,
    intervalMs: options.intervalMs ?? QUICK_SEARCH_TYPING_INTERVAL_MS,
    variant: options.variant,
  };
}

async function waitForFinalPaint(
  adapter: QuickSearchTypingAdapter,
  finalText: string,
  pending: { current: boolean; observed: boolean },
  label: string,
): Promise<void> {
  await waitWithTimeout(
    `${label} final accepted query`,
    waitForPredicate(() => adapter.getAcceptedText() === finalText, undefined, {
      label: `${label} final accepted query`,
    }),
  );
  const pendingNow = () => Boolean(adapter.isPending?.() ?? pending.current);
  if (pending.observed || pendingNow()) {
    await waitWithTimeout(
      `${label} pending stayed true after final prefix`,
      waitForPredicate(() => !pendingNow(), undefined, {
        label: `${label} pending stayed true after final prefix`,
      }),
    );
  }
  await waitAnimationFrames(2);
  if (adapter.getAcceptedText() !== finalText) {
    throw new Error(
      `stale Quick Search result replaced the final accepted text (expected "${finalText}", got ${JSON.stringify(adapter.getAcceptedText())})`,
    );
  }
}

export async function runQuickSearchTypingSession(
  adapter: QuickSearchTypingAdapter,
  options: QuickSearchTypingOptions,
  appLabel: string,
): Promise<QuickSearchTypingSessionResult> {
  const { prefixes, intervalMs, variant } = resolveTypingOptions(options);
  const finalText = prefixes[prefixes.length - 1]!;
  const offs: Array<() => void> = [];
  const acceptedQueryEvents: Array<{ text: string; atMs: number }> = [];
  const pendingTransitions: QuickSearchPendingTransition[] = [];
  const pending = { current: false, observed: false };
  let issuedIndex = -1;
  let supersededAcceptedCount = 0;

  if (variant === "burst") {
    adapter.assertFreshQuickSearch?.();
  }

  offs.push(
    adapter.subscribeAccepted((text) => {
      acceptedQueryEvents.push({ text, atMs: performance.now() });
      const issued = issuedIndex >= 0 ? prefixes[issuedIndex] : "";
      if (issued && text !== issued && text !== finalText) {
        supersededAcceptedCount += 1;
      }
    }),
  );
  if (adapter.subscribePending) {
    offs.push(
      adapter.subscribePending((value) => {
        pending.current = value;
        if (value) pending.observed = true;
        pendingTransitions.push({ pending: value, atMs: performance.now() });
      }),
    );
  }

  const prefixSettlements: QuickSearchPrefixSettlement[] = [];
  const prefixDispatches: QuickSearchPrefixDispatch[] = [];
  const scheduledTimestampsMs: number[] = [];
  const dispatchTimestampsMs: number[] = [];
  const dispatchDelaysMs: number[] = [];
  const sessionStart = performance.now();
  let firstKeystrokeMs = sessionStart;
  let lastKeystrokeMs = sessionStart;

  const dispatchPrefix = (index: number, prefix: string): number => {
    const scheduledAtMs = sessionStart + index * intervalMs;
    const dispatchAtMs = performance.now();
    const dispatchDelayMs = Math.max(0, dispatchAtMs - scheduledAtMs);
    issuedIndex = index;
    scheduledTimestampsMs.push(scheduledAtMs);
    dispatchTimestampsMs.push(dispatchAtMs);
    dispatchDelaysMs.push(dispatchDelayMs);
    prefixDispatches.push({ prefix, scheduledAtMs, dispatchAtMs, dispatchDelayMs });
    if (index === 0) firstKeystrokeMs = dispatchAtMs;
    lastKeystrokeMs = dispatchAtMs;
    adapter.setText(prefix);
    return dispatchAtMs;
  };

  try {
    if (variant === "burst") {
      for (let index = 0; index < prefixes.length; index += 1) {
        await sleepUntil(sessionStart + index * intervalMs);
        dispatchPrefix(index, prefixes[index]!);
      }
      await waitForFinalPaint(adapter, finalText, pending, `${appLabel} typeQuickSearch burst`);
    } else {
      for (let index = 0; index < prefixes.length; index += 1) {
        const prefix = prefixes[index]!;
        const started = dispatchPrefix(index, prefix);
        await waitWithTimeout(
          `${appLabel} typeQuickSearch settled ${prefix}`,
          waitForPredicate(() => adapter.getAcceptedText() === prefix, undefined, {
            label: `${appLabel} typeQuickSearch settled ${prefix}`,
          }),
        );
        const pendingNow = () => Boolean(adapter.isPending?.() ?? pending.current);
        if (pending.observed || pendingNow()) {
          await waitWithTimeout(
            `${appLabel} typeQuickSearch settled ${prefix} pending`,
            waitForPredicate(() => !pendingNow(), undefined, {
              label: `${appLabel} typeQuickSearch settled ${prefix} pending`,
            }),
          );
        }
        await waitAnimationFrames(2);
        const painted = performance.now();
        prefixSettlements.push({
          prefix,
          durationMs: painted - started,
          displayedRowCount: adapter.getDisplayedRowCount(),
          acceptedText: adapter.getAcceptedText(),
        });
      }
    }
  } finally {
    for (const off of offs) off();
  }

  const painted = performance.now();
  const cadenceWaitMs = Math.max(0, (prefixes.length - 1) * intervalMs);
  return {
    variant,
    prefixes: [...prefixes],
    intervalMs,
    inputTimestampsMs: dispatchTimestampsMs,
    scheduledTimestampsMs,
    dispatchTimestampsMs,
    dispatchDelaysMs,
    prefixDispatches,
    acceptedQueryEvents,
    pendingTransitions,
    firstKeystrokeToFinalPaintMs: painted - firstKeystrokeMs,
    finalKeystrokeToFinalPaintMs: painted - lastKeystrokeMs,
    cadenceWaitMs,
    pendingObserved: pending.observed,
    supersededAcceptedCount,
    finalText: adapter.getAcceptedText(),
    finalDisplayedRowCount: adapter.getDisplayedRowCount(),
    prefixSettlements: variant === "settledIncremental" ? prefixSettlements : [],
  };
}

export function baselineTypingEvidence(): QuickSearchExecutionEvidence {
  return {
    product: "baseline",
    mode: "notApplicable",
    rowCount: 0,
    quickSearchThreshold: null,
    cache: null,
    prewarm: null,
    pendingObserved: false,
    workerEligibleByCount: null,
    producer: "unknown",
    workerRouteConfirmed: null,
    forcedMainThread: false,
    cacheQuickFilter: null,
    notes: ["Baseline host does not execute a grid Quick Search."],
  };
}

export async function runBaselineTypingSession(
  options: QuickSearchTypingOptions,
): Promise<QuickSearchTypingSessionResult> {
  let accepted = "";
  return runQuickSearchTypingSession(
    {
      product: "baseline",
      setText(text) {
        accepted = text;
      },
      subscribeAccepted() {
        return () => undefined;
      },
      getAcceptedText: () => accepted,
      getDisplayedRowCount: () => 0,
    },
    options,
    "baseline",
  );
}
