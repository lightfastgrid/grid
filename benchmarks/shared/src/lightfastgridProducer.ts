/**
 * Benchmark-only probe of Quick Search, filter, and sort completion producers.
 *
 * Packed Core labels each execution completion as cache | mainThread | worker
 * on GridExecutionService. That field is not a public Grid API. This helper
 * wraps the live instance's private `execution` object the same way displayed-
 * row inspection reads private `state`.
 *
 * Filter and sort evidence is command-scoped. beginCommand() starts a new
 * session; only schedule* calls and completions from that session can be
 * attributed. Stale or cancelled completions from an earlier command cannot
 * become the next command's producer. Filter Clear does not call
 * scheduleFilter, so its producer is `none` (not applicable).
 *
 * It does not change scheduling, eligibility, cache, or Worker algorithms.
 * Pending state, row count, Worker URL, and Worker creation are never used
 * as producer proof.
 */

export type ExecutionProducer = "worker" | "mainThread" | "cache" | "unknown";

export type FilterCommandProducer = ExecutionProducer | "none";

export type QuickSearchProducer = ExecutionProducer;

export type QuickSearchProducerRecord = {
  readonly producer: Exclude<ExecutionProducer, "unknown">;
  readonly text: string;
  readonly requestId: number;
};

export type FilterProducerRecord = {
  readonly producer: Exclude<ExecutionProducer, "unknown">;
  readonly requestId: number;
  readonly generation: number;
};

export type SortProducerRecord = {
  readonly producer: Exclude<ExecutionProducer, "unknown">;
  readonly requestId: number;
  readonly generation: number;
};

export type FilterCommandEvidenceSnapshot = {
  readonly producer: FilterCommandProducer;
  readonly scheduled: boolean;
};

export type SortCommandEvidenceSnapshot = {
  readonly producer: ExecutionProducer;
  readonly scheduled: boolean;
};

type CompletionLike = {
  readonly producer?: unknown;
  readonly quickFilterText?: unknown;
  readonly requestId?: unknown;
};

type ExecutionLike = {
  scheduleQuickSearch?: (
    input: unknown,
    onComplete: (completion: CompletionLike) => void,
  ) => number;
  scheduleFilter?: (
    rows: unknown,
    filterModel: unknown,
    columnsByField: unknown,
    onComplete: (completion: CompletionLike) => void,
    getCellValue?: unknown,
    sourceIndexes?: unknown,
  ) => number;
  scheduleSort?: (
    rows: unknown,
    sortModel: unknown,
    columns: unknown,
    onComplete: (completion: CompletionLike) => void,
    ctx?: unknown,
    cache?: unknown,
    sourceIndexes?: unknown,
  ) => number;
};

type GridLike = {
  execution?: ExecutionLike;
};

export type LightFastGridProducerProbe = {
  beginCommand(): void;
  producerForAcceptedText(text: string): ExecutionProducer;
  filterCommandEvidence(): FilterCommandEvidenceSnapshot;
  sortCommandEvidence(): SortCommandEvidenceSnapshot;
  records(): readonly QuickSearchProducerRecord[];
  filterRecords(): readonly FilterProducerRecord[];
  sortRecords(): readonly SortProducerRecord[];
  detach(): void;
};

export function isQuickSearchProducer(
  value: unknown,
): value is Exclude<ExecutionProducer, "unknown"> {
  return value === "worker" || value === "mainThread" || value === "cache";
}

export const isExecutionProducer = isQuickSearchProducer;

function wrapCompletion(
  original: ((...args: never[]) => unknown) | undefined,
  target: object,
  record: (completion: CompletionLike) => void,
): ((...args: never[]) => unknown) | undefined {
  if (typeof original !== "function") return original;
  const bound = original.bind(target);
  return ((...args: never[]) => {
    const onCompleteIndex = args.findIndex((value) => typeof value === "function");
    if (onCompleteIndex < 0) return bound(...args);
    const onComplete = args[onCompleteIndex] as (completion: CompletionLike) => void;
    const nextArgs = [...args];
    nextArgs[onCompleteIndex] = ((completion: CompletionLike) => {
      record(completion);
      onComplete(completion);
    }) as never;
    return bound(...(nextArgs as never[]));
  }) as (...args: never[]) => unknown;
}

function wrapScheduledCompletion(
  original: ((...args: never[]) => unknown) | undefined,
  target: object,
  onScheduled: (requestId: number) => void,
  onCompletion: (
    completion: CompletionLike,
    returnedRequestId: number,
    duringSchedule: boolean,
  ) => void,
): ((...args: never[]) => unknown) | undefined {
  if (typeof original !== "function") return original;
  const bound = original.bind(target);
  return ((...args: never[]) => {
    const onCompleteIndex = args.findIndex((value) => typeof value === "function");
    let returnedRequestId = -1;
    let duringSchedule = true;
    try {
      if (onCompleteIndex < 0) {
        const requestId = bound(...args);
        if (typeof requestId === "number") {
          returnedRequestId = requestId;
          onScheduled(requestId);
        }
        return requestId;
      }
      const onComplete = args[onCompleteIndex] as (completion: CompletionLike) => void;
      const nextArgs = [...args];
      nextArgs[onCompleteIndex] = ((completion: CompletionLike) => {
        onCompletion(completion, returnedRequestId, duringSchedule);
        onComplete(completion);
      }) as never;
      const requestId = bound(...(nextArgs as never[]));
      if (typeof requestId === "number") {
        returnedRequestId = requestId;
        onScheduled(requestId);
      }
      return requestId;
    } finally {
      duringSchedule = false;
    }
  }) as (...args: never[]) => unknown;
}

function idleFilterEvidence(): FilterCommandEvidenceSnapshot {
  return { producer: "none", scheduled: false };
}

function idleSortEvidence(): SortCommandEvidenceSnapshot {
  return { producer: "unknown", scheduled: false };
}

export function attachLightFastGridProducerProbe(grid: unknown): LightFastGridProducerProbe {
  const execution = (grid as GridLike | null | undefined)?.execution;
  const originalQuickSearch = execution?.scheduleQuickSearch;
  const originalFilter = execution?.scheduleFilter;
  const originalSort = execution?.scheduleSort;
  if (!execution) {
    return {
      beginCommand: () => undefined,
      producerForAcceptedText: () => "unknown",
      filterCommandEvidence: () => idleFilterEvidence(),
      sortCommandEvidence: () => idleSortEvidence(),
      records: () => [],
      filterRecords: () => [],
      sortRecords: () => [],
      detach: () => undefined,
    };
  }

  const quickSearchRecords: QuickSearchProducerRecord[] = [];
  const filterRecords: FilterProducerRecord[] = [];
  const sortRecords: SortProducerRecord[] = [];
  const liveFilterRequests = new Map<number, number>();
  const liveSortRequests = new Map<number, number>();
  const scheduledFilterGenerations = new Set<number>();
  const scheduledSortGenerations = new Set<number>();
  let currentCommandGeneration = 0;

  const resolveGeneration = (
    requestId: number,
    liveRequests: Map<number, number>,
    duringSchedule: boolean,
  ): number | null => {
    const known = liveRequests.get(requestId);
    if (known !== undefined) return known;
    if (duringSchedule) return currentCommandGeneration;
    return null;
  };

  const wrappedQuickSearch = wrapCompletion(
    originalQuickSearch as ((...args: never[]) => unknown) | undefined,
    execution,
    (completion) => {
      if (!isExecutionProducer(completion.producer)) return;
      quickSearchRecords.push({
        producer: completion.producer,
        text: typeof completion.quickFilterText === "string" ? completion.quickFilterText : "",
        requestId: typeof completion.requestId === "number" ? completion.requestId : -1,
      });
    },
  );
  const wrappedFilter = wrapScheduledCompletion(
    originalFilter as ((...args: never[]) => unknown) | undefined,
    execution,
    (requestId) => {
      liveFilterRequests.set(requestId, currentCommandGeneration);
      scheduledFilterGenerations.add(currentCommandGeneration);
    },
    (completion, returnedRequestId, duringSchedule) => {
      if (!isExecutionProducer(completion.producer)) {
        if (duringSchedule) scheduledFilterGenerations.add(currentCommandGeneration);
        return;
      }
      const requestId =
        typeof completion.requestId === "number" ? completion.requestId : returnedRequestId;
      const generation = resolveGeneration(requestId, liveFilterRequests, duringSchedule);
      if (generation === null) return;
      liveFilterRequests.set(requestId, generation);
      scheduledFilterGenerations.add(generation);
      filterRecords.push({
        producer: completion.producer,
        requestId,
        generation,
      });
    },
  );
  const wrappedSort = wrapScheduledCompletion(
    originalSort as ((...args: never[]) => unknown) | undefined,
    execution,
    (requestId) => {
      liveSortRequests.set(requestId, currentCommandGeneration);
      scheduledSortGenerations.add(currentCommandGeneration);
    },
    (completion, returnedRequestId, duringSchedule) => {
      if (!isExecutionProducer(completion.producer)) {
        if (duringSchedule) scheduledSortGenerations.add(currentCommandGeneration);
        return;
      }
      const requestId =
        typeof completion.requestId === "number" ? completion.requestId : returnedRequestId;
      const generation = resolveGeneration(requestId, liveSortRequests, duringSchedule);
      if (generation === null) return;
      liveSortRequests.set(requestId, generation);
      scheduledSortGenerations.add(generation);
      sortRecords.push({
        producer: completion.producer,
        requestId,
        generation,
      });
    },
  );

  if (wrappedQuickSearch) execution.scheduleQuickSearch = wrappedQuickSearch as ExecutionLike["scheduleQuickSearch"];
  if (wrappedFilter) execution.scheduleFilter = wrappedFilter as ExecutionLike["scheduleFilter"];
  if (wrappedSort) execution.scheduleSort = wrappedSort as ExecutionLike["scheduleSort"];

  return {
    beginCommand() {
      currentCommandGeneration += 1;
    },
    producerForAcceptedText(text) {
      const match = [...quickSearchRecords].reverse().find((entry) => entry.text === text);
      return match?.producer ?? "unknown";
    },
    filterCommandEvidence() {
      const scheduled = scheduledFilterGenerations.has(currentCommandGeneration);
      if (!scheduled) return idleFilterEvidence();
      const match = [...filterRecords]
        .reverse()
        .find((entry) => entry.generation === currentCommandGeneration);
      return {
        producer: match?.producer ?? "unknown",
        scheduled: true,
      };
    },
    sortCommandEvidence() {
      const scheduled = scheduledSortGenerations.has(currentCommandGeneration);
      if (!scheduled) return idleSortEvidence();
      const match = [...sortRecords]
        .reverse()
        .find((entry) => entry.generation === currentCommandGeneration);
      return {
        producer: match?.producer ?? "unknown",
        scheduled: true,
      };
    },
    records: () => quickSearchRecords,
    filterRecords: () => filterRecords,
    sortRecords: () => sortRecords,
    detach() {
      if (originalQuickSearch) execution.scheduleQuickSearch = originalQuickSearch;
      if (originalFilter) execution.scheduleFilter = originalFilter;
      if (originalSort) execution.scheduleSort = originalSort;
    },
  };
}
