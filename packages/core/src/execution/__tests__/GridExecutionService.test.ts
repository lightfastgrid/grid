/**
 * Focused tests for GridExecutionService worker-sort wiring.
 *
 * Uses a fake Worker (via FakeWorker on globalThis.Worker) to verify:
 * - eligible large sorts route to the worker client
 * - ineligible sorts fall back to main-thread async path
 * - worker errors fall back to main-thread path
 * - stale worker responses are ignored
 * - cancelSort / destroy lifecycle
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ColumnDef, RowData, SortModel } from "../../types";
import {
  ASYNC_SORT_ROW_THRESHOLD,
  GridExecutionService,
} from "../GridExecutionService";
import type { SortTaskCompletion } from "../GridTaskTypes";
import { DEFAULT_CSV_EXPORT_WORKER_CELL_THRESHOLD } from "../operations/csv-export/csvExportOperation";
import type { SortOperationCache } from "../operations/sort";
import { executeWorkerSortPayload } from "../operations/sort/sortWorkerAlgorithm";
import { resolveWorkerSortEligibility } from "../operations/sort/sortWorkerEligibility";
import { buildWorkerSortPayload } from "../operations/sort/sortWorkerPayload";
import type { SortWorkerRequest, SortWorkerResponse } from "../operations/sort/sortWorkerTypes";

// ── Fake Worker ───────────────────────────────────────────────────────

type MessageHandler = ((event: MessageEvent<SortWorkerResponse>) => void) | null;
type ErrorHandler = ((event: ErrorEvent) => void) | null;

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failOnConstruct = false;

  onmessage: MessageHandler = null;
  onerror: ErrorHandler = null;
  terminated = false;
  posted: SortWorkerRequest[] = [];

  constructor() {
    if (FakeWorker.failOnConstruct) {
      throw new Error("Worker construction failed");
    }
    FakeWorker.instances.push(this);
  }

  postMessage(data: SortWorkerRequest): void {
    this.posted.push(data);
  }

  terminate(): void {
    this.terminated = true;
  }

  simulateSuccess(requestId: number, indexes: Uint32Array): void {
    const response: SortWorkerResponse = {
      kind: "sort:success",
      requestId,
      indexes,
    };
    this.onmessage?.({ data: response } as MessageEvent<SortWorkerResponse>);
  }

  simulateError(requestId: number, message: string): void {
    const response: SortWorkerResponse = {
      kind: "sort:error",
      requestId,
      message,
    };
    this.onmessage?.({ data: response } as MessageEvent<SortWorkerResponse>);
  }

  simulateWorkerError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

// ── Test helpers ──────────────────────────────────────────────────────

function makeLargeRows(count: number = ASYNC_SORT_ROW_THRESHOLD): RowData[] {
  const rows: RowData[] = new Array(count);
  for (let i = 0; i < count; i++) {
    rows[i] = { score: count - i, name: `row${i}` };
  }
  return rows;
}

function makeSmallRows(): RowData[] {
  return [{ score: 3 }, { score: 1 }, { score: 2 }];
}

const simpleCols: ColumnDef[] = [
  { field: "score", sortable: true } as ColumnDef,
  { field: "name", sortable: true } as ColumnDef,
];

const ascSort: SortModel = [{ field: "score", sort: "asc" }];

/** Flush RAF + setTimeout microtask pair used by main-thread path. */
async function flushMainThreadSort(): Promise<void> {
  // RAF callback
  await new Promise<void>((r) => setTimeout(r, 0));
  // setTimeout(runSort, 0) inside the RAF callback
  await new Promise<void>((r) => setTimeout(r, 0));
}

/**
 * Compute the expected sorted indexes for a worker-eligible sort,
 * using the same pipeline the service uses.
 */
function computeExpectedIndexes(
  rows: RowData[],
  sortModel: SortModel,
  columns: ColumnDef[],
): Uint32Array {
  const eligibility = resolveWorkerSortEligibility(sortModel, columns);
  const payload = buildWorkerSortPayload(rows, eligibility)!;
  return executeWorkerSortPayload(payload).indexes;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("GridExecutionService worker wiring", () => {
  let originalWorker: typeof globalThis.Worker;
  let originalRAF: typeof globalThis.requestAnimationFrame;
  let originalCAF: typeof globalThis.cancelAnimationFrame;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
    originalRAF = globalThis.requestAnimationFrame;
    originalCAF = globalThis.cancelAnimationFrame;
    FakeWorker.instances = [];
    FakeWorker.failOnConstruct = false;
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
    // Use real setTimeout-based RAF simulation for deterministic tests.
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      return setTimeout(() => cb(performance.now()), 0) as unknown as number;
    };
    globalThis.cancelAnimationFrame = (id: number): void => {
      clearTimeout(id);
    };
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
  });

  it("normalizes and resets the selected-cell CSV Worker threshold", () => {
    const svc = new GridExecutionService({
      thresholds: { csvExport: 12.9 },
    });

    expect(svc.getCsvExportThreshold()).toBe(12);
    expect(svc.getExecutionThreshold("csvExport")).toBe(12);

    svc.setExecutionOptions({ thresholds: { csvExport: -1 } });
    expect(svc.getCsvExportThreshold()).toBe(
      DEFAULT_CSV_EXPORT_WORKER_CELL_THRESHOLD,
    );

    svc.setExecutionOptions();
    expect(svc.getCsvExportThreshold()).toBe(
      DEFAULT_CSV_EXPORT_WORKER_CELL_THRESHOLD,
    );
    svc.destroy();
  });

  // ── Worker path ─────────────────────────────────────────────────────

  it("eligible large sort uses SortWorkerClient and completes with normalized indexes", () => {
    const svc = new GridExecutionService();
    const rows = makeLargeRows();
    const onComplete = vi.fn();

    const requestId = svc.scheduleSort(rows, ascSort, simpleCols, onComplete);
    expect(requestId).toBe(1);

    // Worker should have been created and received a message.
    expect(FakeWorker.instances.length).toBe(1);
    const worker = FakeWorker.instances[0]!;
    expect(worker.posted.length).toBe(1);
    expect(worker.posted[0]!.kind).toBe("sort");
    expect(worker.posted[0]!.requestId).toBe(1);

    // Simulate worker success with correct sorted indexes.
    const indexes = computeExpectedIndexes(rows, ascSort, simpleCols);
    worker.simulateSuccess(1, indexes);

    expect(onComplete).toHaveBeenCalledOnce();
    const completion: SortTaskCompletion = onComplete.mock.calls[0]![0];
    expect(completion.kind).toBe("sort");
    expect(completion.requestId).toBe(1);
    expect(completion.result.kind).toBe("indexes");
    if (completion.result.kind === "indexes") {
      expect(completion.result.indexes).toBe(indexes);
    }
    expect(completion.producer).toBe("worker");
    expect(completion.sourceRows).toBe(rows);
    expect(completion.sortModel).toBe(ascSort);

    svc.destroy();
  });

  // ── Main-thread fallbacks ───────────────────────────────────────────

  it("small row count uses main-thread path (no worker)", async () => {
    const svc = new GridExecutionService();
    const rows = makeSmallRows();
    const onComplete = vi.fn();

    svc.scheduleSort(rows, ascSort, simpleCols, onComplete);
    expect(FakeWorker.instances.length).toBe(0);

    await flushMainThreadSort();

    expect(onComplete).toHaveBeenCalledOnce();
    const completion: SortTaskCompletion = onComplete.mock.calls[0]![0];
    expect(completion.result.kind).toBe("indexes");
    expect(completion.producer).toBe("mainThread");
    svc.destroy();
  });

  it("ineligible valueGetter sort falls back to main-thread path", async () => {
    const svc = new GridExecutionService();
    const rows = makeLargeRows();
    const cols: ColumnDef[] = [
      { field: "score", sortable: true, valueGetter: () => 0 } as ColumnDef,
    ];
    const onComplete = vi.fn();

    svc.scheduleSort(rows, ascSort, cols, onComplete);
    // No worker created — fell back.
    expect(FakeWorker.instances.length).toBe(0);

    await flushMainThreadSort();

    expect(onComplete).toHaveBeenCalledOnce();
    svc.destroy();
  });

  it("ineligible custom comparator sort falls back to main-thread path", async () => {
    const svc = new GridExecutionService();
    const rows = makeLargeRows();
    const cols: ColumnDef[] = [
      {
        field: "score",
        sortable: true,
        sortComparator: (a: unknown, b: unknown) => (a as number) - (b as number),
      } as ColumnDef,
    ];
    const onComplete = vi.fn();

    svc.scheduleSort(rows, ascSort, cols, onComplete);
    expect(FakeWorker.instances.length).toBe(0);

    await flushMainThreadSort();

    expect(onComplete).toHaveBeenCalledOnce();
    svc.destroy();
  });

  it("empty sort model uses main-thread path (no worker)", async () => {
    const svc = new GridExecutionService();
    const rows = makeLargeRows();
    const onComplete = vi.fn();

    svc.scheduleSort(rows, [], simpleCols, onComplete);
    expect(FakeWorker.instances.length).toBe(0);

    await flushMainThreadSort();

    expect(onComplete).toHaveBeenCalledOnce();
    svc.destroy();
  });

  // ── Worker error fallback ───────────────────────────────────────────

  it("worker error falls back to main-thread path for latest request", async () => {
    const svc = new GridExecutionService();
    const rows = makeLargeRows();
    const onComplete = vi.fn();

    svc.scheduleSort(rows, ascSort, simpleCols, onComplete);
    expect(FakeWorker.instances.length).toBe(1);

    const worker = FakeWorker.instances[0]!;
    worker.simulateWorkerError("module load failed");

    // onComplete not called yet — fallback schedules main-thread sort.
    expect(onComplete).not.toHaveBeenCalled();

    await flushMainThreadSort();

    expect(onComplete).toHaveBeenCalledOnce();
    const completion: SortTaskCompletion = onComplete.mock.calls[0]![0];
    expect(completion.result.kind).toBe("indexes");
    svc.destroy();
  });

  it("worker sort:error response falls back to main-thread path", async () => {
    const svc = new GridExecutionService();
    const rows = makeLargeRows();
    const onComplete = vi.fn();

    svc.scheduleSort(rows, ascSort, simpleCols, onComplete);
    const worker = FakeWorker.instances[0]!;
    worker.simulateError(1, "sort crashed");

    await flushMainThreadSort();

    expect(onComplete).toHaveBeenCalledOnce();
    svc.destroy();
  });

  // ── Stale responses ─────────────────────────────────────────────────

  it("stale worker success after newer request is ignored", () => {
    const svc = new GridExecutionService();
    const rows = makeLargeRows();
    const onComplete1 = vi.fn();
    const onComplete2 = vi.fn();

    svc.scheduleSort(rows, ascSort, simpleCols, onComplete1);
    // Second request supersedes first.
    svc.scheduleSort(rows, ascSort, simpleCols, onComplete2);

    // Both go through the same worker instance.
    expect(FakeWorker.instances.length).toBe(1);
    const worker = FakeWorker.instances[0]!;
    expect(worker.posted.length).toBe(2);

    // Stale response for request 1.
    worker.simulateSuccess(1, new Uint32Array(rows.length));
    expect(onComplete1).not.toHaveBeenCalled();
    expect(onComplete2).not.toHaveBeenCalled();

    // Active response for request 2.
    const indexes = computeExpectedIndexes(rows, ascSort, simpleCols);
    worker.simulateSuccess(2, indexes);
    expect(onComplete2).toHaveBeenCalledOnce();
    expect(onComplete1).not.toHaveBeenCalled();

    svc.destroy();
  });

  // ── cancelSort ──────────────────────────────────────────────────────

  it("cancelSort cancels worker request", () => {
    const svc = new GridExecutionService();
    const rows = makeLargeRows();
    const onComplete = vi.fn();

    svc.scheduleSort(rows, ascSort, simpleCols, onComplete);
    expect(FakeWorker.instances.length).toBe(1);

    svc.cancelSort();

    // Worker response after cancel should be ignored.
    const worker = FakeWorker.instances[0]!;
    worker.simulateSuccess(1, new Uint32Array(rows.length));
    expect(onComplete).not.toHaveBeenCalled();

    svc.destroy();
  });

  // ── destroy ─────────────────────────────────────────────────────────

  it("destroy destroys worker client", () => {
    const svc = new GridExecutionService();
    const rows = makeLargeRows();

    svc.scheduleSort(rows, ascSort, simpleCols, vi.fn());
    expect(FakeWorker.instances.length).toBe(1);
    const worker = FakeWorker.instances[0]!;

    svc.destroy();

    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  // ── Worker constructor failure ──────────────────────────────────────

  it("worker constructor failure falls back to main-thread path", async () => {
    FakeWorker.failOnConstruct = true;

    const svc = new GridExecutionService();
    const rows = makeLargeRows();
    const onComplete = vi.fn();

    svc.scheduleSort(rows, ascSort, simpleCols, onComplete);

    // Worker construction failed — should fall back.
    await flushMainThreadSort();

    expect(onComplete).toHaveBeenCalledOnce();
    svc.destroy();
  });

  // ── Sort operation cache ────────────────────────────────────────────

  it("cache hit completes immediately without creating a worker", () => {
    const svc = new GridExecutionService();
    const rows = makeLargeRows();
    const onComplete = vi.fn();
    const cache: SortOperationCache = {
      tryResolve: () => ({ kind: "identity", rowCount: rows.length }),
      record: vi.fn(),
    };

    svc.scheduleSort(rows, ascSort, simpleCols, onComplete, undefined, cache);

    expect(FakeWorker.instances.length).toBe(0);
    expect(onComplete).toHaveBeenCalledOnce();
    const completion: SortTaskCompletion = onComplete.mock.calls[0]![0];
    expect(completion.result).toEqual({
      kind: "identity",
      rowCount: rows.length,
    });
    expect(completion.producer).toBe("cache");
    svc.destroy();
  });

  it("worker success records through the provided cache", () => {
    const svc = new GridExecutionService();
    const rows = makeLargeRows();
    const onComplete = vi.fn();
    const record = vi.fn();
    const cache: SortOperationCache = {
      tryResolve: () => null,
      record,
    };

    svc.scheduleSort(rows, ascSort, simpleCols, onComplete, undefined, cache);
    expect(FakeWorker.instances.length).toBe(1);

    const indexes = computeExpectedIndexes(rows, ascSort, simpleCols);
    FakeWorker.instances[0]!.simulateSuccess(1, indexes);

    expect(onComplete).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledOnce();
    const [input, output, producer] = record.mock.calls[0]!;
    expect(input.rows).toBe(rows);
    expect(output).toEqual({ kind: "indexes", indexes });
    expect(producer).toBe("worker");
    svc.destroy();
  });

  // ── Unsupported payload values ──────────────────────────────────────

  it("payload with unsupported object values falls back to main-thread", async () => {
    const svc = new GridExecutionService();
    const count = ASYNC_SORT_ROW_THRESHOLD;
    const rows: RowData[] = new Array(count);
    for (let i = 0; i < count; i++) {
      // score is an object — buildWorkerSortPayload returns null.
      rows[i] = { score: { value: count - i } };
    }
    const onComplete = vi.fn();

    svc.scheduleSort(rows, ascSort, simpleCols, onComplete);
    // No worker — payload builder returned null.
    expect(FakeWorker.instances.length).toBe(0);

    await flushMainThreadSort();

    expect(onComplete).toHaveBeenCalledOnce();
    svc.destroy();
  });
});
