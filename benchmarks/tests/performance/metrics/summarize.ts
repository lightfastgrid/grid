import type { GridBenchmarkRuntimeSample } from "../../../shared/src/benchmarkProtocol.ts";

export type NumericSummary = {
  readonly n: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly median: number;
  readonly p50: number;
  readonly p75: number;
  readonly p95: number;
  readonly stdev: number | null;
};

export type SecondaryObserverSummary = {
  readonly longTask: {
    readonly supportedSampleCount: number;
    readonly unsupportedSampleCount: number;
    readonly maxMs: number | null;
    readonly countSum: number | null;
    readonly totalMsSum: number | null;
    readonly reasonIfUnsupported: string | null;
  };
  readonly rafGaps: {
    readonly supportedSampleCount: number;
    readonly unsupportedSampleCount: number;
    readonly maxMs: number | null;
    readonly countSum: number | null;
    readonly thresholdMs: number;
    readonly note: string;
    readonly reasonIfUnsupported: string | null;
  };
  readonly heap: {
    readonly supportedSampleCount: number;
    readonly unsupportedSampleCount: number;
    readonly maxUsedBytes: number | null;
    readonly reasonIfUnsupported: string | null;
  };
};

export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) {
    throw new Error("Cannot compute a percentile of an empty sample");
  }
  const rank = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.ceil(p * sortedAscending.length) - 1),
  );
  return sortedAscending[rank]!;
}

export function summarizeNumeric(values: readonly number[]): NumericSummary {
  if (values.length === 0) {
    throw new Error("Cannot summarize an empty sample");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const n = sorted.length;
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const median =
    n % 2 === 0
      ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2
      : sorted[Math.floor(n / 2)]!;
  let stdev: number | null = null;
  if (n > 1) {
    const variance =
      sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
    stdev = Math.sqrt(variance);
  }
  return {
    n,
    min,
    max,
    mean,
    median,
    p50: median,
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
    stdev,
  };
}

export function summarizeObservers(
  samples: ReadonlyArray<{ observers: GridBenchmarkRuntimeSample | null }>,
): SecondaryObserverSummary {
  const longSupported = [];
  const longUnsupported = [];
  const rafSupported = [];
  const rafUnsupported = [];
  const heapSupported = [];
  const heapUnsupported = [];
  for (const sample of samples) {
    const observers = sample.observers;
    if (!observers) continue;
    if (observers.longTask.supported) longSupported.push(observers.longTask);
    else longUnsupported.push(observers.longTask);
    if (observers.rafGaps.supported) rafSupported.push(observers.rafGaps);
    else rafUnsupported.push(observers.rafGaps);
    if (observers.heap.supported) heapSupported.push(observers.heap);
    else heapUnsupported.push(observers.heap);
  }
  return {
    longTask: {
      supportedSampleCount: longSupported.length,
      unsupportedSampleCount: longUnsupported.length,
      maxMs: longSupported.length ? Math.max(...longSupported.map((value) => value.maxMs)) : null,
      countSum: longSupported.length
        ? longSupported.reduce((sum, value) => sum + value.count, 0)
        : null,
      totalMsSum: longSupported.length
        ? longSupported.reduce((sum, value) => sum + value.totalMs, 0)
        : null,
      reasonIfUnsupported: longUnsupported[0]?.reason ?? null,
    },
    rafGaps: {
      supportedSampleCount: rafSupported.length,
      unsupportedSampleCount: rafUnsupported.length,
      maxMs: rafSupported.length ? Math.max(...rafSupported.map((value) => value.maxMs)) : null,
      countSum: rafSupported.length
        ? rafSupported.reduce((sum, value) => sum + value.count, 0)
        : null,
      thresholdMs: 20,
      note: "rAF gaps over the threshold are scheduling delays, not dropped frames.",
      reasonIfUnsupported: rafUnsupported[0]?.reason ?? null,
    },
    heap: {
      supportedSampleCount: heapSupported.length,
      unsupportedSampleCount: heapUnsupported.length,
      maxUsedBytes: heapSupported.length
        ? Math.max(...heapSupported.map((value) => value.usedBytes))
        : null,
      reasonIfUnsupported: heapUnsupported[0]?.reason ?? null,
    },
  };
}
