import { describe, expect, it, vi } from "vitest";

import { makeSnapshot } from "../../../../features/csv-export/__tests__/support";
import type { CsvExportSnapshot } from "../../../../features/csv-export/csvExportSnapshot";
import type {
  CsvContentRow,
  CsvExportDefaults,
  CsvExportProgress,
} from "../../../../features/csv-export/csvExportTypes";
import type {
  CsvByteChunk,
  CsvOutputSink,
  CsvSinkResult,
} from "../../../../features/csv-export/csvOutputSink";
import { AbstractCsvSink } from "../../../../features/csv-export/csvOutputSink";
import { CsvEncodingSession } from "../../../../features/csv-export/csvUtf8Encoder";
import { normalizeCsvExportOptions } from "../../../../features/csv-export/normalizeCsvExportOptions";
import type { CsvPlannedColumn } from "../../../../features/csv-export/planCsvColumnScope";
import type { CsvGroupHeaderPlan } from "../../../../features/csv-export/planCsvGroupHeaders";
import type { CsvRowPlan } from "../../../../features/csv-export/planCsvRowScope";
import type {
  CooperativeScheduleOptions,
  CooperativeSchedulerBackend,
} from "../../../../scheduling/CooperativeScheduler";
import { CooperativeScheduler } from "../../../../scheduling/CooperativeScheduler";
import type { ColumnDef, RowData } from "../../../../types";
import {
  type CsvExportMainThreadBudgets,
  type CsvExportMainThreadCompletion,
  type CsvExportMainThreadHandle,
  type CsvExportMainThreadRuntime,
  DEFAULT_CSV_PROGRESS_INTERVAL_MS,
  executeCsvExportMainThread,
} from "../csvExportMainThread";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface ManualSchedulerBackend extends CooperativeSchedulerBackend {
  flushOne(): boolean;
  flushAll(limit?: number): number;
  pendingCount(): number;
  failNextSchedule(error: unknown): void;
  readonly options: Array<CooperativeScheduleOptions | undefined>;
}

function manualSchedulerBackend(): ManualSchedulerBackend {
  const queue: Array<{ callback: () => void; cancelled: boolean }> = [];
  const options: Array<CooperativeScheduleOptions | undefined> = [];
  let nextScheduleFailure: unknown = undefined;
  return {
    options,
    schedule(callback, scheduleOptions) {
      if (nextScheduleFailure !== undefined) {
        const error = nextScheduleFailure;
        nextScheduleFailure = undefined;
        throw error;
      }
      const entry = { callback, cancelled: false };
      queue.push(entry);
      options.push(scheduleOptions);
      return {
        cancel() {
          entry.cancelled = true;
        },
      };
    },
    flushOne() {
      while (queue.length > 0) {
        const entry = queue.shift()!;
        if (entry.cancelled) continue;
        entry.callback();
        return true;
      }
      return false;
    },
    flushAll(limit = 10_000) {
      let count = 0;
      while (this.flushOne()) {
        count++;
        if (count > limit) throw new Error("scheduler did not quiesce");
      }
      return count;
    },
    pendingCount() {
      return queue.filter((entry) => !entry.cancelled).length;
    },
    failNextSchedule(error) {
      nextScheduleFailure = error;
    },
  };
}

class ArrayRowPlan implements CsvRowPlan {
  readonly knownRowCount: number;
  stepCount = 0;
  private index = 0;

  constructor(private readonly indexes: readonly number[]) {
    this.knownRowCount = indexes.length;
  }

  step(out: number[], maxWorkUnits: number): boolean {
    this.stepCount++;
    let remaining = Math.max(1, Math.floor(maxWorkUnits));
    while (remaining > 0 && this.index < this.indexes.length) {
      out.push(this.indexes[this.index++]!);
      remaining--;
    }
    return this.index >= this.indexes.length;
  }
}

class UnknownCountRowPlan implements CsvRowPlan {
  readonly knownRowCount = undefined;
  private index = 0;

  constructor(private readonly indexes: readonly number[]) {}

  step(out: number[], maxWorkUnits: number): boolean {
    let remaining = Math.max(1, Math.floor(maxWorkUnits));
    while (remaining > 0 && this.index < this.indexes.length) {
      out.push(this.indexes[this.index++]!);
      remaining--;
    }
    return this.index >= this.indexes.length;
  }
}

interface SinkControl {
  write?: (chunk: CsvByteChunk, writeIndex: number) => Promise<void> | void;
  close?: () => Promise<CsvSinkResult> | CsvSinkResult;
  abort?: (reason: unknown) => Promise<void> | void;
}

class RecordingSink implements CsvOutputSink {
  readonly chunks: Uint8Array[] = [];
  readonly receivedChunks: CsvByteChunk[] = [];
  readonly abortReasons: unknown[] = [];
  writeCount = 0;
  closeCount = 0;

  constructor(private readonly control: SinkControl = {}) {}

  write(chunk: CsvByteChunk): Promise<void> | void {
    this.receivedChunks.push(chunk);
    this.chunks.push(Uint8Array.from(chunk));
    const writeIndex = this.writeCount++;
    return this.control.write?.(chunk, writeIndex);
  }

  close(): Promise<CsvSinkResult> | CsvSinkResult {
    this.closeCount++;
    return (
      this.control.close?.() ?? {
        outputType: "blob",
        byteLength: this.chunks.reduce(
          (total, chunk) => total + chunk.byteLength,
          0,
        ),
      }
    );
  }

  abort(reason: unknown): Promise<void> | void {
    this.abortReasons.push(reason);
    return this.control.abort?.(reason);
  }
}

class AsyncCloseSink extends AbstractCsvSink {
  abortCount = 0;
  closeCount = 0;

  constructor(private readonly closeGate: Deferred<void>) {
    super();
  }

  protected handleWrite(_chunk: CsvByteChunk): void {
    // no-op
  }

  protected handleClose(): Promise<CsvSinkResult> {
    this.closeCount++;
    return this.closeGate.promise.then(() => ({
      outputType: "blob",
      byteLength: 0,
    }));
  }

  protected handleAbort(): void {
    this.abortCount++;
  }
}

function dataColumn(column: ColumnDef): CsvPlannedColumn {
  return { kind: "data", column, field: column.field };
}

function rowNumberColumn(startAt = 1): CsvPlannedColumn {
  return { kind: "rowNumber", headerName: "Row", startAt };
}

function decodeChunks(chunks: readonly Uint8Array[]): string {
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

function lastProgress(
  progress: readonly CsvExportProgress[],
): CsvExportProgress | undefined {
  return progress.length === 0 ? undefined : progress[progress.length - 1];
}

interface HarnessOptions {
  backend?: ManualSchedulerBackend;
  rows?: readonly RowData[];
  snapshot?: CsvExportSnapshot;
  rowPlan?: CsvRowPlan;
  plannedColumns?: readonly CsvPlannedColumn[];
  groupHeaderPlan?: CsvGroupHeaderPlan;
  runtime?: CsvExportMainThreadRuntime;
  sink?: CsvOutputSink;
  now?: () => number;
  budgets?: Partial<CsvExportMainThreadBudgets>;
  normalizedOverrides?: CsvExportDefaults;
  taskId?: number;
  onProgress?: (progress: CsvExportProgress) => void;
}

interface Harness {
  backend: ManualSchedulerBackend;
  handle: CsvExportMainThreadHandle;
  sink: CsvOutputSink;
  completions: CsvExportMainThreadCompletion[];
  cancellations: unknown[];
  errors: unknown[];
  progress: CsvExportProgress[];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const rows = options.rows ?? [];
  const snapshot = options.snapshot ?? makeSnapshot({ sourceRows: rows });
  const rowPlan = options.rowPlan ?? new ArrayRowPlan(rows.map((_row, i) => i));
  const backend = options.backend ?? manualSchedulerBackend();
  const sink = options.sink ?? new RecordingSink();
  const completions: CsvExportMainThreadCompletion[] = [];
  const cancellations: unknown[] = [];
  const errors: unknown[] = [];
  const progress: CsvExportProgress[] = [];
  const normalized = normalizeCsvExportOptions({
    includeColumnHeaders: false,
    ...options.normalizedOverrides,
  });
  const handle = executeCsvExportMainThread({
    snapshot,
    rowPlan,
    plannedColumns: options.plannedColumns ?? [],
    groupHeaderPlan: options.groupHeaderPlan ?? { rows: [] },
    normalized,
    runtime: options.runtime ?? {},
    sink,
    scheduler: new CooperativeScheduler(backend),
    now: options.now ?? (() => 0),
    taskId: options.taskId ?? 1,
    onProgress:
      options.onProgress ??
      ((event) => {
        progress.push(event);
      }),
    budgets: options.budgets,
    onComplete: (result) => completions.push(result),
    onCancelled: (reason) => cancellations.push(reason),
    onError: (error) => errors.push(error),
  });
  return { backend, handle, sink, completions, cancellations, errors, progress };
}

describe("csvExportMainThread - cooperative start (tests 37-38)", () => {
  it("starts with zero projection, callback, encoding, or sink work", () => {
    const valueGetter = vi.fn(() => "A");
    const shouldExportRow = vi.fn(() => true);
    const rowPlan = new ArrayRowPlan([0]);
    const sink = new RecordingSink();
    const harness = createHarness({
      rows: [{ id: "a" }],
      rowPlan,
      plannedColumns: [dataColumn({ field: "name", valueGetter })],
      runtime: { shouldExportRow },
      sink,
    });

    expect(rowPlan.stepCount).toBe(0);
    expect(valueGetter).not.toHaveBeenCalled();
    expect(shouldExportRow).not.toHaveBeenCalled();
    expect(sink.writeCount).toBe(0);
    expect(sink.closeCount).toBe(0);
    expect(harness.completions).toEqual([]);
    expect(harness.backend.pendingCount()).toBe(1);
  });

  it("uses user-visible scheduling and may complete a small export in one slice", () => {
    const harness = createHarness();

    expect(harness.backend.options).toEqual([{ priority: "user-visible" }]);
    expect(harness.backend.flushOne()).toBe(true);
    expect(harness.completions).toHaveLength(1);
    expect(harness.backend.pendingCount()).toBe(0);
  });
});

describe("csvExportMainThread - independent slice ceilings (test 39)", () => {
  it("yields independently at the time ceiling", () => {
    let clock = 0;
    const harness = createHarness({
      now: () => clock++,
      budgets: {
        timeBudgetMs: 1,
        maxRowsPerSlice: 10_000,
        maxProjectedBytesPerSlice: 1_000_000,
        maxEncodedBytesPerSlice: 1_000_000,
      },
    });

    const slices = harness.backend.flushAll();
    expect(slices).toBeGreaterThan(1);
    expect(harness.completions).toHaveLength(1);
  });

  it("inspects at most the row ceiling in each slice", () => {
    const rowPlan = new ArrayRowPlan([0, 1, 2]);
    const harness = createHarness({
      rows: [{ v: 1 }, { v: 2 }, { v: 3 }],
      rowPlan,
      plannedColumns: [dataColumn({ field: "v" })],
      budgets: {
        maxRowsPerSlice: 1,
        maxProjectedBytesPerSlice: 1_000_000,
        maxEncodedBytesPerSlice: 1_000_000,
      },
    });

    let previousStepCount = 0;
    while (harness.backend.flushOne()) {
      expect(rowPlan.stepCount - previousStepCount).toBeLessThanOrEqual(1);
      previousStepCount = rowPlan.stepCount;
    }
    expect(rowPlan.stepCount).toBe(3);
    expect(harness.completions[0]?.rowCount).toBe(3);
  });

  it("yields independently at the projected-byte ceiling", () => {
    const getters = [0, 1, 2].map((index) => vi.fn(() => `v${index}`));
    const harness = createHarness({
      rows: [{}],
      plannedColumns: getters.map((valueGetter, index) =>
        dataColumn({ field: `c${index}`, valueGetter }),
      ),
      budgets: {
        maxRowsPerSlice: 10_000,
        maxProjectedBytesPerSlice: 1,
        maxEncodedBytesPerSlice: 1_000_000,
        maxCellsPerBatch: 64,
      },
    });

    harness.backend.flushOne();
    expect(getters.reduce((sum, getter) => sum + getter.mock.calls.length, 0)).toBe(1);
    expect(harness.backend.pendingCount()).toBe(1);
    harness.backend.flushAll();
    expect(getters.map((getter) => getter.mock.calls.length)).toEqual([1, 1, 1]);
    expect(harness.completions).toHaveLength(1);
  });

  it("yields independently at the encoded-byte ceiling", () => {
    const sink = new RecordingSink();
    const harness = createHarness({
      rows: [{ a: "a", b: "b", c: "c" }],
      plannedColumns: ["a", "b", "c"].map((field) => dataColumn({ field })),
      sink,
      budgets: {
        maxRowsPerSlice: 10_000,
        maxProjectedBytesPerSlice: 1_000_000,
        maxEncodedBytesPerSlice: 1,
        maxCellsPerBatch: 1,
      },
    });

    harness.backend.flushOne();
    expect(sink.writeCount).toBe(1);
    expect(harness.backend.pendingCount()).toBe(1);
    harness.backend.flushAll();
    expect(sink.writeCount).toBeGreaterThan(1);
    expect(harness.completions).toHaveLength(1);
  });

  it("sanitizes invalid limits and clamps the hard field batch cap", () => {
    const row: RowData = {};
    const columns = Array.from({ length: 100 }, (_unused, index) => {
      const field = `c${index}`;
      row[field] = index;
      return dataColumn({ field });
    });
    const sink = new RecordingSink();
    const harness = createHarness({
      rows: [row],
      plannedColumns: columns,
      sink,
      budgets: {
        timeBudgetMs: 0,
        maxRowsPerSlice: -1,
        maxProjectedBytesPerSlice: Number.NaN,
        maxEncodedBytesPerSlice: Number.POSITIVE_INFINITY,
        maxCellsPerBatch: 1_000_000,
      },
    });

    harness.backend.flushAll();
    expect(sink.writeCount).toBe(2); // 64 fields, then the remaining 36.
    expect(harness.completions[0]).toMatchObject({ rowCount: 1, columnCount: 100 });
  });
});

describe("csvExportMainThread - progress and continuity (tests 40-41)", () => {
  it("makes progress even when the injected clock is immediately exhausted", () => {
    let clock = 0;
    const harness = createHarness({
      rows: [{ a: 1 }, { a: 2 }],
      plannedColumns: [dataColumn({ field: "a" })],
      now: () => (clock += 100),
      budgets: { timeBudgetMs: 1 },
    });

    const slices = harness.backend.flushAll();
    expect(slices).toBeGreaterThan(2);
    expect(harness.completions[0]?.rowCount).toBe(2);
  });

  it("preserves exact output across many slices and contiguous skipped-row numbers", () => {
    const rows = [
      { id: "a", name: "A" },
      { id: "skip", name: "B" },
      { id: "c", name: "C" },
    ];
    const plannedColumns = [rowNumberColumn(), dataColumn({ field: "name", headerName: "Name" })];
    const prependContent: readonly CsvContentRow[] = [
      [{ value: "P", mergeAcross: 1 }],
    ];
    const groupHeaderPlan: CsvGroupHeaderPlan = {
      rows: [
        {
          level: 0,
          segments: [
            { run: null, startColumnIndex: 0, span: 1 },
            {
              run: {
                groupId: "people",
                headerName: "People",
                level: 0,
                fields: ["name"],
              },
              startColumnIndex: 1,
              span: 1,
            },
          ],
        },
      ],
    };
    const shouldParams: Array<{ rowIndex: number; sourceRowIndex: number }> = [];
    const processParams: Array<{ rowIndex: number; sourceRowIndex: number }> = [];
    const sink = new RecordingSink();
    const harness = createHarness({
      rows,
      plannedColumns,
      groupHeaderPlan,
      runtime: {
        prependContent,
        appendContent: [[{ value: "Z" }]],
        shouldExportRow: ({ rowId, rowIndex, sourceRowIndex }) => {
          shouldParams.push({ rowIndex, sourceRowIndex });
          return rowId !== "skip";
        },
        processCell: ({ formattedValue, rowIndex, sourceRowIndex }) => {
          processParams.push({ rowIndex, sourceRowIndex });
          return formattedValue;
        },
      },
      sink,
      normalizedOverrides: {
        includeColumnHeaders: true,
        utf8Bom: true,
        lineEnding: "\n",
      },
      budgets: {
        maxRowsPerSlice: 1,
        maxProjectedBytesPerSlice: 1,
        maxEncodedBytesPerSlice: 1,
        maxCellsPerBatch: 1,
      },
    });

    expect(harness.backend.flushAll()).toBeGreaterThan(10);
    expect(decodeChunks(sink.chunks)).toBe(
      "\uFEFFP,\n,People\nRow,Name\n1,A\n2,C\nZ\n",
    );
    expect(shouldParams).toEqual([
      { rowIndex: 0, sourceRowIndex: 0 },
      { rowIndex: 1, sourceRowIndex: 1 },
      { rowIndex: 2, sourceRowIndex: 2 },
    ]);
    expect(processParams).toEqual([
      { rowIndex: 0, sourceRowIndex: 0 },
      { rowIndex: 2, sourceRowIndex: 2 },
    ]);
    expect(harness.completions[0]).toMatchObject({ rowCount: 2, columnCount: 2 });
  });
});

describe("csvExportMainThread - cancellation ownership (test 42)", () => {
  it("cancels before start without performing scheduled work", () => {
    const sink = new RecordingSink();
    const harness = createHarness({ sink });
    const reason = new Error("cancel before start");

    harness.handle.cancel(reason);
    harness.handle.cancel(new Error("again"));
    harness.backend.flushAll();

    expect(sink.abortReasons).toEqual([reason]);
    expect(sink.writeCount).toBe(0);
    expect(sink.closeCount).toBe(0);
    expect(harness.cancellations).toEqual([reason]);
    expect(harness.completions).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("cancels reentrantly during projection and encodes no later work", () => {
    const reason = new Error("cancel in processCell");
    const owner: { handle: CsvExportMainThreadHandle | null } = { handle: null };
    const processCell = vi.fn(() => {
      owner.handle?.cancel(reason);
      return "cancelled";
    });
    const sink = new RecordingSink();
    const harness = createHarness({
      rows: [{ a: 1, b: 2 }],
      plannedColumns: [dataColumn({ field: "a" }), dataColumn({ field: "b" })],
      runtime: { processCell },
      sink,
    });
    owner.handle = harness.handle;

    harness.backend.flushAll();
    expect(processCell).toHaveBeenCalledTimes(1);
    expect(sink.writeCount).toBe(0);
    expect(sink.abortReasons).toEqual([reason]);
    expect(harness.cancellations).toEqual([reason]);
    expect(harness.completions).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("guards one captured shouldExportRow callback against reentrant cancellation", () => {
    const reason = new Error("cancel in shouldExportRow");
    const owner: { handle: CsvExportMainThreadHandle | null } = { handle: null };
    const valueGetter = vi.fn(() => "value");
    const valueFormatter = vi.fn(() => "formatted");
    const processCell = vi.fn(() => "processed");
    const shouldExportRow = vi.fn(() => {
      owner.handle?.cancel(reason);
      return true;
    });
    const sink = new RecordingSink();
    const harness = createHarness({
      rows: [{ value: "source" }],
      plannedColumns: [
        dataColumn({ field: "value", valueGetter, valueFormatter }),
      ],
      runtime: { shouldExportRow, processCell },
      sink,
    });
    owner.handle = harness.handle;

    harness.backend.flushAll();

    expect(shouldExportRow).toHaveBeenCalledTimes(1);
    expect(valueGetter).not.toHaveBeenCalled();
    expect(valueFormatter).not.toHaveBeenCalled();
    expect(processCell).not.toHaveBeenCalled();
    expect(sink.writeCount).toBe(0);
    expect(sink.abortReasons).toEqual([reason]);
    expect(harness.cancellations).toEqual([reason]);
    expect(harness.completions).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("cancels during a pending write and ignores its late resolution", async () => {
    const writeGate = deferred<void>();
    const sink = new RecordingSink({ write: () => writeGate.promise });
    const harness = createHarness({
      rows: [{ a: "A" }],
      plannedColumns: [dataColumn({ field: "a" })],
      sink,
    });
    const reason = new Error("cancel pending write");

    harness.backend.flushOne();
    expect(sink.writeCount).toBe(1);
    expect(harness.backend.pendingCount()).toBe(0);
    harness.handle.cancel(reason);
    writeGate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    harness.backend.flushAll();

    expect(sink.abortReasons).toEqual([reason]);
    expect(sink.writeCount).toBe(1);
    expect(harness.cancellations).toEqual([reason]);
    expect(harness.completions).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("cancels during asynchronous close and suppresses late completion", async () => {
    const closeGate = deferred<void>();
    const sink = new AsyncCloseSink(closeGate);
    const harness = createHarness({ sink });
    const reason = new Error("cancel pending close");

    harness.backend.flushOne();
    expect(sink.closeCount).toBe(1);
    harness.handle.cancel(reason);
    expect(sink.abortCount).toBe(1);
    closeGate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    harness.backend.flushAll();

    expect(harness.cancellations).toEqual([reason]);
    expect(harness.completions).toEqual([]);
    expect(harness.errors).toEqual([]);
  });
});

describe("csvExportMainThread - hot-path allocation ownership", () => {
  it("reuses one projected-value batch across a multi-batch wide row", () => {
    const encodeSpy = vi.spyOn(CsvEncodingSession.prototype, "encodeRowChunk");
    try {
      const row: RowData = {};
      const columns = Array.from({ length: 100 }, (_unused, index) => {
        const field = `c${index}`;
        row[field] = index;
        return dataColumn({ field });
      });
      const harness = createHarness({
        rows: [row],
        plannedColumns: columns,
        budgets: { maxCellsPerBatch: 8 },
      });

      harness.backend.flushAll();

      const batches = encodeSpy.mock.calls.map(([values]) => values);
      expect(batches.length).toBeGreaterThan(1);
      expect(batches.every((values) => values === batches[0])).toBe(true);
      expect(batches[0]).toEqual([]);
      expect(harness.completions).toHaveLength(1);
    } finally {
      encodeSpy.mockRestore();
    }
  });

  it("passes the encoder-owned byte chunk directly to the sink", () => {
    const encodeSpy = vi.spyOn(CsvEncodingSession.prototype, "encodeRowChunk");
    try {
      const sink = new RecordingSink();
      const harness = createHarness({
        rows: [{ value: "direct" }],
        plannedColumns: [dataColumn({ field: "value" })],
        sink,
      });

      harness.backend.flushAll();

      expect(encodeSpy).toHaveBeenCalledTimes(1);
      expect(sink.receivedChunks[0]).toBe(encodeSpy.mock.results[0]?.value);
      expect(harness.completions).toHaveLength(1);
    } finally {
      encodeSpy.mockRestore();
    }
  });
});

describe("csvExportMainThread - sink backpressure and terminals", () => {
  it("permits only one pending sink write and resumes through the scheduler", async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const sink = new RecordingSink({
      write: (_chunk, index) => gates[index]?.promise,
    });
    const harness = createHarness({
      rows: [{ a: "A", b: "B", c: "C" }],
      plannedColumns: ["a", "b", "c"].map((field) => dataColumn({ field })),
      sink,
      budgets: { maxCellsPerBatch: 1 },
    });

    harness.backend.flushOne();
    expect(sink.writeCount).toBe(1);
    expect(harness.backend.pendingCount()).toBe(0);
    expect(harness.backend.flushOne()).toBe(false);

    gates[0]!.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.backend.pendingCount()).toBe(1);
    expect(sink.writeCount).toBe(1);

    harness.backend.flushOne();
    expect(sink.writeCount).toBe(2);
    expect(harness.backend.pendingCount()).toBe(0);
    gates[1]!.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    harness.backend.flushOne();
    expect(sink.writeCount).toBe(3);
    expect(harness.backend.pendingCount()).toBe(0);
    gates[2]!.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    harness.backend.flushAll();
    expect(sink.closeCount).toBe(1);
    expect(harness.completions).toHaveLength(1);
  });

  it("emits correct empty-export and BOM-only output", () => {
    const emptySink = new RecordingSink();
    const empty = createHarness({ sink: emptySink });
    empty.backend.flushAll();
    expect(emptySink.chunks).toEqual([]);
    expect(empty.completions[0]).toMatchObject({ rowCount: 0, columnCount: 0 });

    const bomSink = new RecordingSink();
    const bom = createHarness({
      sink: bomSink,
      normalizedOverrides: { utf8Bom: true },
    });
    bom.backend.flushAll();
    expect(Array.from(bomSink.chunks[0] ?? [])).toEqual([0xef, 0xbb, 0xbf]);
    expect(bom.completions[0]).toMatchObject({ rowCount: 0, columnCount: 0 });
  });

  it("keeps callback and sink failures primary and terminates exactly once", async () => {
    const callbackError = new Error("callback failed");
    const callbackSink = new RecordingSink();
    const callbackHarness = createHarness({
      rows: [{ a: 1 }],
      plannedColumns: [dataColumn({ field: "a" })],
      runtime: {
        processCell: () => {
          throw callbackError;
        },
      },
      sink: callbackSink,
    });
    callbackHarness.backend.flushAll();
    expect(callbackHarness.errors).toEqual([callbackError]);
    expect(callbackSink.abortReasons).toEqual([callbackError]);
    expect(callbackHarness.cancellations).toEqual([]);
    expect(callbackHarness.completions).toEqual([]);

    const sinkError = new Error("sink failed");
    const failingSink = new RecordingSink({
      write: () => Promise.reject(sinkError),
    });
    const sinkHarness = createHarness({
      rows: [{ a: 1 }],
      plannedColumns: [dataColumn({ field: "a" })],
      sink: failingSink,
    });
    sinkHarness.backend.flushOne();
    await Promise.resolve();
    await Promise.resolve();
    expect(sinkHarness.errors).toEqual([sinkError]);
    expect(failingSink.abortReasons).toEqual([sinkError]);
    expect(sinkHarness.cancellations).toEqual([]);
    expect(sinkHarness.completions).toEqual([]);
  });
});

describe("csvExportMainThread - throttled progress (test 43)", () => {
  it("emits no progress before the first scheduler flush", () => {
    const harness = createHarness({
      rows: [{ a: 1 }],
      plannedColumns: [dataColumn({ field: "a" })],
      taskId: 7,
    });

    expect(harness.progress).toEqual([]);
    expect(harness.backend.pendingCount()).toBe(1);
  });

  it("emits projecting first from the first scheduled continuation", () => {
    const harness = createHarness({
      rows: [{ a: 1 }],
      plannedColumns: [dataColumn({ field: "a" })],
      taskId: 9,
      budgets: {
        maxRowsPerSlice: 1,
        maxProjectedBytesPerSlice: 1,
        maxEncodedBytesPerSlice: 1,
        maxCellsPerBatch: 1,
      },
    });

    harness.backend.flushOne();
    expect(harness.progress[0]).toMatchObject({
      taskId: 9,
      phase: "projecting",
      processedRows: 0,
      totalRows: 1,
      emittedBytes: 0,
    });
  });

  it("suppresses same-phase events before the progress interval", () => {
    let clock = 0;
    const harness = createHarness({
      rows: [{ a: 1 }, { a: 2 }, { a: 3 }],
      plannedColumns: [dataColumn({ field: "a" })],
      now: () => clock,
      budgets: {
        maxRowsPerSlice: 1,
        maxProjectedBytesPerSlice: 1_000_000,
        maxEncodedBytesPerSlice: 1_000_000,
      },
    });

    harness.backend.flushOne();
    const afterFirst = harness.progress.length;
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    expect(harness.progress.every((event) => event.phase === "projecting")).toBe(
      true,
    );

    harness.backend.flushOne();
    expect(harness.progress).toHaveLength(afterFirst);

    clock = DEFAULT_CSV_PROGRESS_INTERVAL_MS - 1;
    harness.backend.flushOne();
    expect(harness.progress).toHaveLength(afterFirst);
  });

  it("emits immediately on a public phase change to finalizing", () => {
    const clock = 0;
    const harness = createHarness({
      rows: [{ a: "A" }],
      plannedColumns: [dataColumn({ field: "a" })],
      now: () => clock,
      budgets: {
        maxRowsPerSlice: 1,
        maxProjectedBytesPerSlice: 1,
        maxEncodedBytesPerSlice: 1,
        maxCellsPerBatch: 1,
      },
    });

    harness.backend.flushOne();
    expect(harness.progress[0]?.phase).toBe("projecting");
    const projectingCount = harness.progress.length;

    while (
      harness.progress.every((event) => event.phase === "projecting") &&
      harness.backend.flushOne()
    ) {
      // Drain until finalizing appears without advancing the clock.
    }

    const finalizing = harness.progress.find((event) => event.phase === "finalizing");
    expect(finalizing).toBeDefined();
    expect(harness.progress.length).toBeGreaterThan(projectingCount);
    expect(clock).toBe(0);
  });

  it("emits after the injected clock reaches the progress interval", () => {
    let clock = 0;
    const harness = createHarness({
      rows: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }],
      plannedColumns: [dataColumn({ field: "a" })],
      now: () => clock,
      budgets: {
        maxRowsPerSlice: 1,
        maxProjectedBytesPerSlice: 1_000_000,
        maxEncodedBytesPerSlice: 1_000_000,
      },
    });

    harness.backend.flushOne();
    const afterFirst = harness.progress.length;
    clock = DEFAULT_CSV_PROGRESS_INTERVAL_MS;
    harness.backend.flushOne();
    expect(harness.progress.length).toBeGreaterThan(afterFirst);
    expect(lastProgress(harness.progress)).toMatchObject({
      phase: "projecting",
      totalRows: 4,
    });
    expect(lastProgress(harness.progress)!.processedRows).toBeGreaterThan(0);
  });

  it("reports known totalRows from rowPlan.knownRowCount while active", () => {
    const harness = createHarness({
      rows: [{ a: 1 }, { a: 2 }],
      plannedColumns: [dataColumn({ field: "a" })],
      rowPlan: new ArrayRowPlan([0, 1]),
      budgets: {
        maxRowsPerSlice: 1,
        maxProjectedBytesPerSlice: 1,
        maxEncodedBytesPerSlice: 1,
        maxCellsPerBatch: 1,
      },
    });

    harness.backend.flushOne();
    expect(harness.progress[0]?.totalRows).toBe(2);
  });

  it("uses totalRows 0 while unknown and exact candidate count at completion", () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    const harness = createHarness({
      rows,
      plannedColumns: [dataColumn({ field: "a" })],
      rowPlan: new UnknownCountRowPlan([0, 1, 2]),
      budgets: {
        maxRowsPerSlice: 1,
        maxProjectedBytesPerSlice: 1_000_000,
        maxEncodedBytesPerSlice: 1_000_000,
      },
    });

    harness.backend.flushOne();
    expect(harness.progress[0]).toMatchObject({
      phase: "projecting",
      totalRows: 0,
    });

    harness.backend.flushAll();
    const finalEvent = lastProgress(harness.progress)!;
    expect(finalEvent).toMatchObject({
      phase: "finalizing",
      processedRows: 3,
      totalRows: 3,
    });
    expect(harness.completions[0]?.rowCount).toBe(3);
  });

  it("keeps shouldExportRow skips inside processedRows", () => {
    const harness = createHarness({
      rows: [{ id: "a" }, { id: "skip" }, { id: "c" }],
      plannedColumns: [dataColumn({ field: "id" })],
      runtime: {
        shouldExportRow: ({ rowId }) => rowId !== "skip",
      },
    });

    harness.backend.flushAll();
    const finalEvent = lastProgress(harness.progress)!;
    expect(finalEvent.processedRows).toBe(3);
    expect(finalEvent.totalRows).toBe(3);
    expect(harness.completions[0]?.rowCount).toBe(2);
  });

  it("increases emittedBytes for async writes only after resolution", async () => {
    const writeGate = deferred<void>();
    const sink = new RecordingSink({ write: () => writeGate.promise });
    const harness = createHarness({
      rows: [{ a: "A" }],
      plannedColumns: [dataColumn({ field: "a" })],
      sink,
    });

    harness.backend.flushOne();
    expect(sink.writeCount).toBe(1);
    const beforeResolve = harness.progress.map((event) => event.emittedBytes);
    expect(beforeResolve.every((bytes) => bytes === 0)).toBe(true);

    writeGate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    // Promise resolution must not publish progress; the continuation does.
    expect(harness.progress.every((event) => event.emittedBytes === 0)).toBe(true);
    expect(harness.backend.pendingCount()).toBe(1);

    harness.backend.flushAll();

    const afterResolve = harness.progress.filter((event) => event.emittedBytes > 0);
    expect(afterResolve.length).toBeGreaterThan(0);
    expect(lastProgress(harness.progress)?.emittedBytes).toBe(
      harness.completions[0]?.sinkResult.byteLength,
    );
  });

  it("does not increase emittedBytes for rejected writes", async () => {
    const sinkError = new Error("write rejected");
    const sink = new RecordingSink({
      write: () => Promise.reject(sinkError),
    });
    const harness = createHarness({
      rows: [{ a: "A" }],
      plannedColumns: [dataColumn({ field: "a" })],
      sink,
    });

    harness.backend.flushOne();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.errors).toEqual([sinkError]);
    expect(harness.progress.every((event) => event.emittedBytes === 0)).toBe(true);
    expect(harness.progress.every((event) => event.phase === "projecting")).toBe(
      true,
    );
    expect(harness.completions).toEqual([]);
  });

  it("emits final progress once with candidate count and sink byteLength", () => {
    const sink = new RecordingSink();
    const harness = createHarness({
      rows: [{ a: "A" }, { a: "B" }],
      plannedColumns: [dataColumn({ field: "a" })],
      sink,
      taskId: 42,
    });

    harness.backend.flushAll();

    const byteLength = harness.completions[0]?.sinkResult.byteLength;
    expect(byteLength).toBe(
      sink.chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    );
    expect(lastProgress(harness.progress)).toMatchObject({
      taskId: 42,
      phase: "finalizing",
      processedRows: 2,
      totalRows: 2,
      emittedBytes: byteLength,
    });
    expect(harness.completions).toHaveLength(1);

    const lengthAfterComplete = harness.progress.length;
    harness.backend.flushAll();
    expect(harness.progress).toHaveLength(lengthAfterComplete);
  });

  it("emits no terminal progress on cancel, error, or late async settlements", async () => {
    const cancelGate = deferred<void>();
    const cancelSink = new RecordingSink({ write: () => cancelGate.promise });
    const cancelled = createHarness({
      rows: [{ a: "A" }],
      plannedColumns: [dataColumn({ field: "a" })],
      sink: cancelSink,
    });
    cancelled.backend.flushOne();
    const progressBeforeCancel = cancelled.progress.length;
    cancelled.handle.cancel(new Error("stop"));
    cancelGate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    cancelled.backend.flushAll();
    expect(cancelled.progress).toHaveLength(progressBeforeCancel);
    expect(cancelled.progress.every((event) => event.phase === "projecting")).toBe(
      true,
    );
    expect(cancelled.completions).toEqual([]);

    const closeGate = deferred<void>();
    const closeSink = new AsyncCloseSink(closeGate);
    const closeCancelled = createHarness({ sink: closeSink });
    closeCancelled.backend.flushOne();
    const beforeCloseCancel = closeCancelled.progress.length;
    closeCancelled.handle.cancel(new Error("close cancel"));
    closeGate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    closeCancelled.backend.flushAll();
    expect(closeCancelled.progress).toHaveLength(beforeCloseCancel);
    expect(closeCancelled.completions).toEqual([]);

    const failSink = new RecordingSink({
      write: () => {
        throw new Error("sync sink failure");
      },
    });
    const failed = createHarness({
      rows: [{ a: "A" }],
      plannedColumns: [dataColumn({ field: "a" })],
      sink: failSink,
    });
    failed.backend.flushAll();
    expect(failed.errors).toHaveLength(1);
    expect(failed.progress.every((event) => event.phase === "projecting")).toBe(
      true,
    );
    expect(failed.progress.every((event) => event.emittedBytes === 0)).toBe(true);
    expect(failed.completions).toEqual([]);
  });

  it("ignores invalid and backward clocks without flooding progress", () => {
    const readings = [0, Number.NaN, Number.POSITIVE_INFINITY, -5, 10, 10];
    let index = 0;
    const harness = createHarness({
      rows: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }],
      plannedColumns: [dataColumn({ field: "a" })],
      now: () => readings[Math.min(index++, readings.length - 1)]!,
      budgets: {
        maxRowsPerSlice: 1,
        maxProjectedBytesPerSlice: 1_000_000,
        maxEncodedBytesPerSlice: 1_000_000,
      },
    });

    harness.backend.flushAll();
    const projecting = harness.progress.filter((event) => event.phase === "projecting");
    expect(projecting.length).toBeLessThanOrEqual(3);
    expect(lastProgress(harness.progress)?.phase).toBe("finalizing");
    expect(harness.completions).toHaveLength(1);
  });
});

describe("csvExportMainThread - progress scheduling and clock hardening", () => {
  it("defers async-write progress to one user-visible continuation", async () => {
    let clock = 0;
    const writeGate = deferred<void>();
    const sink = new RecordingSink({ write: () => writeGate.promise });
    const harness = createHarness({
      rows: [{ a: "A" }, { a: "B" }],
      plannedColumns: [dataColumn({ field: "a" })],
      sink,
      now: () => clock,
      budgets: {
        maxRowsPerSlice: 10_000,
        maxProjectedBytesPerSlice: 1_000_000,
        maxEncodedBytesPerSlice: 1,
        maxCellsPerBatch: 1,
      },
    });

    harness.backend.flushOne();
    expect(sink.writeCount).toBe(1);
    expect(harness.backend.pendingCount()).toBe(0);
    const progressBeforeResolve = harness.progress.length;
    expect(harness.progress.every((event) => event.emittedBytes === 0)).toBe(true);

    clock = DEFAULT_CSV_PROGRESS_INTERVAL_MS + 10;
    writeGate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.progress).toHaveLength(progressBeforeResolve);
    expect(harness.progress.every((event) => event.emittedBytes === 0)).toBe(true);
    expect(harness.backend.pendingCount()).toBe(1);

    harness.backend.flushOne();
    expect(lastProgress(harness.progress)?.emittedBytes).toBeGreaterThan(0);
    expect(lastProgress(harness.progress)?.phase).toBe("projecting");
  });

  it("does not emit same-phase progress per batch under a constant clock", () => {
    const row: RowData = {};
    const columns = Array.from({ length: 64 }, (_unused, index) => {
      const field = `c${index}`;
      row[field] = index;
      return dataColumn({ field });
    });
    const harness = createHarness({
      rows: [row],
      plannedColumns: columns,
      now: () => 0,
      budgets: {
        maxRowsPerSlice: 10_000,
        maxProjectedBytesPerSlice: 1,
        maxEncodedBytesPerSlice: 1_000_000,
        maxCellsPerBatch: 8,
      },
    });

    const slices = harness.backend.flushAll();
    expect(slices).toBeGreaterThan(4);

    const projecting = harness.progress.filter((event) => event.phase === "projecting");
    expect(projecting).toHaveLength(1);
    expect(lastProgress(harness.progress)?.phase).toBe("finalizing");
    expect(harness.completions).toHaveLength(1);
  });

  it("still emits phase-change and final progress immediately under a constant clock", () => {
    const harness = createHarness({
      rows: [{ a: "A" }],
      plannedColumns: [dataColumn({ field: "a" })],
      now: () => 0,
    });

    harness.backend.flushAll();

    expect(harness.progress[0]?.phase).toBe("projecting");
    const finalizing = harness.progress.filter((event) => event.phase === "finalizing");
    expect(finalizing.length).toBeGreaterThanOrEqual(1);
    expect(lastProgress(harness.progress)).toMatchObject({
      phase: "finalizing",
      processedRows: 1,
      totalRows: 1,
      emittedBytes: harness.completions[0]?.sinkResult.byteLength,
    });

    const lengthAfterComplete = harness.progress.length;
    harness.backend.flushAll();
    expect(harness.progress).toHaveLength(lengthAfterComplete);
  });

  it("suppresses pending progress when cancelled between async resolve and flush", async () => {
    const writeGate = deferred<void>();
    const sink = new RecordingSink({ write: () => writeGate.promise });
    const harness = createHarness({
      rows: [{ a: "A" }],
      plannedColumns: [dataColumn({ field: "a" })],
      sink,
    });

    harness.backend.flushOne();
    const progressBeforeResolve = harness.progress.length;
    expect(harness.progress.every((event) => event.emittedBytes === 0)).toBe(true);

    writeGate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.backend.pendingCount()).toBe(1);
    expect(harness.progress).toHaveLength(progressBeforeResolve);

    harness.handle.cancel(new Error("cancel before progress flush"));
    expect(harness.backend.pendingCount()).toBe(0);
    harness.backend.flushAll();

    expect(harness.progress).toHaveLength(progressBeforeResolve);
    expect(harness.progress.every((event) => event.emittedBytes === 0)).toBe(true);
    expect(harness.completions).toEqual([]);
    expect(harness.cancellations).toHaveLength(1);
  });
});

describe("csvExportMainThread - close-success terminal ownership", () => {
  it("does not close when first finalizing progress cancels execution", () => {
    const reason = new Error("cancel at finalizing");
    const sink = new RecordingSink();
    let handle: CsvExportMainThreadHandle | null = null;
    const harness = createHarness({
      sink,
      onProgress: (progress) => {
        if (progress.phase === "finalizing") handle?.cancel(reason);
      },
    });
    handle = harness.handle;

    harness.backend.flushAll();

    expect(sink.closeCount).toBe(0);
    expect(sink.abortReasons).toEqual([reason]);
    expect(harness.cancellations).toEqual([reason]);
    expect(harness.completions).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("publishes committed async close success through a deferred fallback when scheduling throws", async () => {
    const closeGate = deferred<CsvSinkResult>();
    const sink = new RecordingSink({ close: () => closeGate.promise });
    const backend = manualSchedulerBackend();
    const terminalEvents: CsvExportProgress[] = [];
    const harness = createHarness({
      backend,
      sink,
      onProgress: (progress) => terminalEvents.push(progress),
    });

    backend.flushAll();
    expect(sink.closeCount).toBe(1);
    const progressBeforeCloseSuccess = terminalEvents.length;
    backend.failNextSchedule(new Error("terminal schedule failed"));
    closeGate.resolve({ outputType: "blob", byteLength: 0 });

    await Promise.resolve();
    expect(harness.completions).toEqual([]);
    expect(terminalEvents).toHaveLength(progressBeforeCloseSuccess);
    harness.handle.cancel(new Error("too late"));
    expect(harness.cancellations).toEqual([]);
    expect(sink.abortReasons).toEqual([]);

    await Promise.resolve();
    expect(harness.completions).toHaveLength(1);
    expect(harness.errors).toEqual([]);
    expect(harness.cancellations).toEqual([]);
    expect(terminalEvents).toHaveLength(progressBeforeCloseSuccess + 1);
    expect(terminalEvents[terminalEvents.length - 1]).toMatchObject({
      phase: "finalizing",
      emittedBytes: 0,
    });
  });
});
