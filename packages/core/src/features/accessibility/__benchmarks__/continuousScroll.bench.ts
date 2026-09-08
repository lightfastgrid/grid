// @vitest-environment jsdom
import { afterAll, beforeAll } from "vitest";
import { bench } from "vitest";

import { Grid } from "../../../Grid";
import { BUILT_IN_FEATURE_FACTORIES } from "../../registry";

interface QueuedFrame {
  readonly id: number;
  readonly callback: FrameRequestCallback;
}

interface BenchmarkGrid {
  readonly grid: Grid;
  readonly container: HTMLDivElement;
  readonly viewport: HTMLElement;
  readonly queue: QueuedFrame[];
  readonly scrollEvent: Event;
  nextScrollTop: number;
}

let nextFrameId = 1;
let activeQueue: QueuedFrame[] | null = null;
const cancelledFrameIds = new Set<number>();
let withAccessibility: BenchmarkGrid;
let withoutAccessibility: BenchmarkGrid;
let sharedRows: Array<Record<string, number | string>>;
let sharedColumns: Array<{ field: string; width: number }>;
let originalRequestAnimationFrame: typeof requestAnimationFrame;
let originalCancelAnimationFrame: typeof cancelAnimationFrame;
const SCROLL_STEP_PX = 160;
const PAIRED_MEDIAN_WARMUP_STEPS = 200;
const PAIRED_MEDIAN_SAMPLE_STEPS = 2_000;
const PAIRED_MEDIAN_RUNS = 5;
const BENCHMARK_OPTIONS = Object.freeze({
  time: 3_000,
  warmupTime: 500,
  warmupIterations: 50,
});

function runFrame(queue: QueuedFrame[]): void {
  const frameCount = queue.length;
  const callbacks = queue.splice(0, frameCount);
  activeQueue = queue;
  for (const frame of callbacks) {
    if (!cancelledFrameIds.delete(frame.id)) {
      frame.callback(performance.now());
    }
  }
  activeQueue = null;
}

function drainFrames(queue: QueuedFrame[]): void {
  for (let frame = 0; frame < 20 && queue.length > 0; frame += 1) {
    runFrame(queue);
  }
}

function createRowsAndColumns(): {
  readonly rows: Array<Record<string, number | string>>;
  readonly columns: Array<{ field: string; width: number }>;
} {
  const columns = Array.from({ length: 80 }, (_, index) => ({
    field: `c${index}`,
    width: 100,
  }));
  const rows = Array.from({ length: 2_000 }, (_, rowIndex) => {
    const row: Record<string, number | string> = { id: `r${rowIndex}` };
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      row[`c${columnIndex}`] = rowIndex + columnIndex;
    }
    return row;
  });
  return { rows, columns };
}

function createBenchmarkGrid(
  omitAccessibility: boolean,
  rows: Array<Record<string, number | string>>,
  columns: Array<{ field: string; width: number }>,
): BenchmarkGrid {
  const queue: QueuedFrame[] = [];
  activeQueue = queue;
  const accessibilityIndex = BUILT_IN_FEATURE_FACTORIES.findIndex(
    (factory) => factory.name === "accessibility",
  );
  const accessibilityFactory =
    BUILT_IN_FEATURE_FACTORIES[accessibilityIndex];
  if (accessibilityIndex < 0 || accessibilityFactory === undefined) {
    throw new Error(
      "Accessibility scroll benchmark could not locate its feature factory",
    );
  }
  if (omitAccessibility) {
    Reflect.deleteProperty(BUILT_IN_FEATURE_FACTORIES, accessibilityIndex);
  }

  let grid: Grid;
  try {
    grid = new Grid({
      rows,
      columns,
      getRowId: (row) => String(row.id),
    });
  } finally {
    if (omitAccessibility) {
      Reflect.set(
        BUILT_IN_FEATURE_FACTORIES,
        accessibilityIndex,
        accessibilityFactory,
      );
    }
  }

  const container = document.createElement("div");
  Object.assign(container.style, { height: "320px", width: "640px" });
  document.body.appendChild(container);
  grid.mount(container);
  drainFrames(queue);
  activeQueue = null;

  const viewport = container.querySelector<HTMLElement>(".lfg-viewport");
  if (viewport === null) {
    throw new Error("Accessibility scroll benchmark viewport was not created");
  }
  return {
    grid,
    container,
    viewport,
    queue,
    scrollEvent: new Event("scroll"),
    nextScrollTop: 0,
  };
}

function destroyBenchmarkGrid(target: BenchmarkGrid): void {
  activeQueue = target.queue;
  target.grid.destroy();
  activeQueue = null;
  target.container.remove();
}

function continuousScrollStep(target: BenchmarkGrid): void {
  activeQueue = target.queue;
  target.nextScrollTop = (target.nextScrollTop + SCROLL_STEP_PX) % 20_000;
  target.viewport.scrollTop = target.nextScrollTop;
  target.viewport.dispatchEvent(target.scrollEvent);
  runFrame(target.queue);
  activeQueue = null;
}

function median(samples: Float64Array): number {
  samples.sort();
  const middle = samples.length >> 1;
  return samples.length % 2 === 0
    ? (samples[middle - 1]! + samples[middle]!) / 2
    : samples[middle]!;
}

function measurePairedScrollMedians(
  withGrid: BenchmarkGrid,
  withoutGrid: BenchmarkGrid,
): {
  readonly withAccessibilityMs: number;
  readonly withoutAccessibilityMs: number;
  readonly overheadPercent: number;
} {
  for (let i = 0; i < PAIRED_MEDIAN_WARMUP_STEPS; i += 1) {
    continuousScrollStep(withGrid);
    continuousScrollStep(withoutGrid);
  }
  const withSamples = new Float64Array(PAIRED_MEDIAN_SAMPLE_STEPS);
  const withoutSamples = new Float64Array(PAIRED_MEDIAN_SAMPLE_STEPS);
  for (let i = 0; i < PAIRED_MEDIAN_SAMPLE_STEPS; i += 1) {
    if ((i & 1) === 0) {
      let started = performance.now();
      continuousScrollStep(withGrid);
      withSamples[i] = performance.now() - started;
      started = performance.now();
      continuousScrollStep(withoutGrid);
      withoutSamples[i] = performance.now() - started;
    } else {
      let started = performance.now();
      continuousScrollStep(withoutGrid);
      withoutSamples[i] = performance.now() - started;
      started = performance.now();
      continuousScrollStep(withGrid);
      withSamples[i] = performance.now() - started;
    }
  }
  const withAccessibilityMs = median(withSamples);
  const withoutAccessibilityMs = median(withoutSamples);
  return {
    withAccessibilityMs,
    withoutAccessibilityMs,
    overheadPercent:
      ((withAccessibilityMs - withoutAccessibilityMs) /
        withoutAccessibilityMs) *
      100,
  };
}

function measurePairedScrollMedianOfMedians(): {
  readonly runs: ReturnType<typeof measurePairedScrollMedians>[];
  readonly medianOverheadPercent: number;
} {
  const runs: ReturnType<typeof measurePairedScrollMedians>[] = [];
  for (let run = 0; run < PAIRED_MEDIAN_RUNS; run += 1) {
    const withGrid = createBenchmarkGrid(false, sharedRows, sharedColumns);
    const withoutGrid = createBenchmarkGrid(true, sharedRows, sharedColumns);
    try {
      runs.push(measurePairedScrollMedians(withGrid, withoutGrid));
    } finally {
      destroyBenchmarkGrid(withGrid);
      destroyBenchmarkGrid(withoutGrid);
    }
  }
  const overheads = new Float64Array(runs.length);
  for (let index = 0; index < runs.length; index += 1) {
    overheads[index] = runs[index]!.overheadPercent;
  }
  return {
    runs,
    medianOverheadPercent: median(overheads),
  };
}

beforeAll(() => {
  originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback): number => {
    if (activeQueue === null) {
      throw new Error("Benchmark requestAnimationFrame has no active queue");
    }
    const id = nextFrameId;
    nextFrameId += 1;
    activeQueue.push({ id, callback });
    return id;
  };
  globalThis.cancelAnimationFrame = (id): void => {
    cancelledFrameIds.add(id);
  };

  const dataset = createRowsAndColumns();
  sharedRows = dataset.rows;
  sharedColumns = dataset.columns;
  withAccessibility = createBenchmarkGrid(false, sharedRows, sharedColumns);
  withoutAccessibility = createBenchmarkGrid(true, sharedRows, sharedColumns);
  process.stdout.write(
    `accessibility-scroll-benchmark ${JSON.stringify({
      dataset: `${sharedRows.length}x${sharedColumns.length}`,
      viewport: "640x320",
      scrollStepPx: SCROLL_STEP_PX,
      physicalRows: withAccessibility.container.querySelectorAll(
        ".lfg-scroll-container > .lfg-row",
      ).length,
      physicalHeaderCells: withAccessibility.container.querySelectorAll(
        ".lfg-header-cell",
      ).length,
    })}\n`,
  );
  process.stdout.write(
    `accessibility-scroll-paired-median ${JSON.stringify({
      samples: PAIRED_MEDIAN_SAMPLE_STEPS,
      pairedRuns: PAIRED_MEDIAN_RUNS,
      ...measurePairedScrollMedianOfMedians(),
    })}\n`,
  );
});

afterAll(() => {
  destroyBenchmarkGrid(withAccessibility);
  destroyBenchmarkGrid(withoutAccessibility);
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
});

bench("continuous scroll with accessibility factory", () => {
  continuousScrollStep(withAccessibility);
}, BENCHMARK_OPTIONS);

bench("continuous scroll with accessibility factory omitted", () => {
  continuousScrollStep(withoutAccessibility);
}, BENCHMARK_OPTIONS);
