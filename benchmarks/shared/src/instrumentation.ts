import {
  RAF_GAP_THRESHOLD_MS,
  type GridBenchmarkRuntimeSample,
} from "./benchmarkProtocol.ts";

type PerformanceWithMemory = Performance & {
  readonly memory?: { readonly usedJSHeapSize: number };
};

function readHeapUsedBytes(): number | null {
  const memory = (performance as PerformanceWithMemory).memory;
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
}

export function createRuntimeObservers(): {
  start(): void;
  stop(): GridBenchmarkRuntimeSample | null;
} {
  let longTaskCount = 0;
  let longTaskTotalMs = 0;
  let maxLongTaskMs = 0;
  let rafGapCount = 0;
  let maxRafGapMs = 0;
  let rafHandle = 0;
  let lastRaf = 0;
  let observing = false;
  let longTaskObserver: PerformanceObserver | null = null;
  let longTaskSupported = false;
  let longTaskReason = "Runtime observers were not started";
  let rafSupported = false;
  let rafReason = "Runtime observers were not started";

  const onRaf = (now: number) => {
    if (!observing) return;
    if (lastRaf > 0) {
      const gap = now - lastRaf;
      if (gap > RAF_GAP_THRESHOLD_MS) {
        rafGapCount += 1;
        if (gap > maxRafGapMs) maxRafGapMs = gap;
      }
    }
    lastRaf = now;
    rafHandle = requestAnimationFrame(onRaf);
  };

  return {
    start() {
      stopInternal();
      observing = true;
      longTaskCount = 0;
      longTaskTotalMs = 0;
      maxLongTaskMs = 0;
      rafGapCount = 0;
      maxRafGapMs = 0;
      lastRaf = 0;
      longTaskSupported = false;
      longTaskReason = "PerformanceObserver longtask is not available";
      rafSupported = false;
      rafReason = "requestAnimationFrame is not available";
      if (typeof PerformanceObserver !== "undefined") {
        try {
          longTaskObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              longTaskCount += 1;
              longTaskTotalMs += entry.duration;
              if (entry.duration > maxLongTaskMs) maxLongTaskMs = entry.duration;
            }
          });
          longTaskObserver.observe({ type: "longtask", buffered: false });
          longTaskSupported = true;
          longTaskReason = "";
        } catch (error) {
          longTaskObserver = null;
          longTaskSupported = false;
          longTaskReason =
            error instanceof Error
              ? error.message
              : "PerformanceObserver.observe({ type: \"longtask\" }) threw";
        }
      }
      if (typeof requestAnimationFrame === "function") {
        rafSupported = true;
        rafReason = "";
        rafHandle = requestAnimationFrame(onRaf);
      }
    },
    stop() {
      if (!observing) return null;
      const heapBytes = readHeapUsedBytes();
      const sample: GridBenchmarkRuntimeSample = {
        longTask: longTaskSupported
          ? {
              supported: true,
              count: longTaskCount,
              totalMs: longTaskTotalMs,
              maxMs: maxLongTaskMs,
              over50msCount: longTaskCount,
            }
          : { supported: false, reason: longTaskReason },
        rafGaps: rafSupported
          ? {
              supported: true,
              count: rafGapCount,
              maxMs: maxRafGapMs,
              thresholdMs: RAF_GAP_THRESHOLD_MS,
            }
          : { supported: false, reason: rafReason },
        heap:
          heapBytes === null
            ? {
                supported: false,
                reason: "performance.memory is not available in this Chromium session",
              }
            : { supported: true, usedBytes: heapBytes },
      };
      stopInternal();
      return sample;
    },
  };

  function stopInternal() {
    observing = false;
    if (rafHandle) cancelAnimationFrame(rafHandle);
    rafHandle = 0;
    longTaskObserver?.disconnect();
    longTaskObserver = null;
  }
}
