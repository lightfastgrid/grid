import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { makeSnapshot } from "../../../../features/csv-export/__tests__/support";
import type {
  CsvExportDefaults,
  CsvExportProgress,
} from "../../../../features/csv-export/csvExportTypes";
import type {
  CsvOutputSink,
  CsvSinkResult,
} from "../../../../features/csv-export/csvOutputSink";
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
import { executeCsvExportMainThread } from "../csvExportMainThread";
import type { CsvExportProjectionRuntime } from "../csvExportProjectionProducer";
import type {
  CsvWorkerRequest,
} from "../csvExportProtocol";
import {
  CsvExportWorkerClient,
  type CsvExportWorkerFailure,
  type CsvExportWorkerOutputType,
  type CsvExportWorkerTransport,
} from "../csvExportWorkerClient";
import {
  type CsvExportWorkerExecutionCompletion,
  type CsvExportWorkerExecutionHandle,
  executeCsvExportWorker,
} from "../csvExportWorkerExecution";
import { CsvExportWorkerRuntime } from "../csvExportWorkerRuntime";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
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
    flushAll(limit = 100_000) {
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
  private index = 0;

  constructor(private readonly indexes: readonly number[]) {
    this.knownRowCount = indexes.length;
  }

  step(out: number[], maxWorkUnits: number): boolean {
    let remaining = Math.max(1, Math.floor(maxWorkUnits));
    while (remaining > 0 && this.index < this.indexes.length) {
      out.push(this.indexes[this.index++]!);
      remaining--;
    }
    return this.index >= this.indexes.length;
  }
}

class TestTransport implements CsvExportWorkerTransport {
  readonly posted: CsvWorkerRequest[] = [];
  onPost: ((message: CsvWorkerRequest) => void) | null = null;
  private responseHandler: ((message: unknown) => void) | null = null;
  private errorHandler: ((error: unknown) => void) | null = null;
  private runtime: CsvExportWorkerRuntime | null = null;

  enableLoopback(): void {
    this.runtime = new CsvExportWorkerRuntime((response) => this.emit(response));
  }

  post(message: CsvWorkerRequest): void {
    this.posted.push(message);
    this.onPost?.(message);
    this.runtime?.handleMessage(message);
  }

  subscribe(handler: (message: unknown) => void): () => void {
    this.responseHandler = handler;
    return () => {
      this.responseHandler = null;
    };
  }

  subscribeError(handler: (error: unknown) => void): () => void {
    this.errorHandler = handler;
    return () => {
      this.errorHandler = null;
    };
  }

  emit(response: unknown): void {
    this.responseHandler?.(response);
  }

  emitError(error: unknown): void {
    this.errorHandler?.(error);
  }
}

interface SinkControl {
  write?: (
    bytes: Uint8Array<ArrayBuffer>,
    writeIndex: number,
  ) => Promise<void> | void;
  close?: () => Promise<CsvSinkResult> | CsvSinkResult;
  abort?: (reason: unknown) => Promise<void> | void;
}

class RecordingSink implements CsvOutputSink {
  readonly chunks: Uint8Array<ArrayBuffer>[] = [];
  readonly abortReasons: unknown[] = [];
  closeCount = 0;

  constructor(
    readonly outputType: CsvExportWorkerOutputType = "text",
    private readonly control: SinkControl = {},
  ) {}

  write(bytes: Uint8Array<ArrayBuffer>): Promise<void> | void {
    const index = this.chunks.length;
    this.chunks.push(Uint8Array.from(bytes));
    return this.control.write?.(bytes, index);
  }

  close(): Promise<CsvSinkResult> | CsvSinkResult {
    this.closeCount++;
    return this.control.close?.() ?? this.result();
  }

  abort(reason: unknown): Promise<void> | void {
    this.abortReasons.push(reason);
    return this.control.abort?.(reason);
  }

  bytes(): Uint8Array<ArrayBuffer> {
    const length = this.chunks.reduce(
      (total, chunk) => total + chunk.byteLength,
      0,
    );
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  text(): string {
    return new TextDecoder().decode(this.bytes());
  }

  private result(): CsvSinkResult {
    const bytes = this.bytes();
    if (this.outputType === "text") {
      return {
        outputType: "text",
        byteLength: bytes.byteLength,
        text: new TextDecoder().decode(bytes),
      };
    }
    if (this.outputType === "download") {
      return {
        outputType: "download",
        byteLength: bytes.byteLength,
        fileName: "export.csv",
      };
    }
    if (this.outputType === "blob") {
      return {
        outputType: "blob",
        byteLength: bytes.byteLength,
        blob: new Blob([bytes]),
      };
    }
    return { outputType: "stream", byteLength: bytes.byteLength };
  }
}

function dataColumn(column: ColumnDef): CsvPlannedColumn {
  return { kind: "data", column, field: column.field };
}

interface HarnessOptions {
  backend?: ManualSchedulerBackend;
  rows?: readonly RowData[];
  plannedColumns?: readonly CsvPlannedColumn[];
  groupHeaderPlan?: CsvGroupHeaderPlan;
  normalizedOverrides?: CsvExportDefaults;
  runtime?: CsvExportProjectionRuntime;
  outputType?: CsvExportWorkerOutputType;
  sink?: RecordingSink;
  transport?: TestTransport;
  loopback?: boolean;
  createFreshSink?: () => RecordingSink;
  onWorkerClientUnusable?: (failure: CsvExportWorkerFailure) => void;
  onProgress?: (progress: CsvExportProgress) => void;
  onCommit?: (result: CsvExportWorkerExecutionCompletion) => void;
}

interface Harness {
  backend: ManualSchedulerBackend;
  transport: TestTransport;
  client: CsvExportWorkerClient;
  sink: RecordingSink;
  freshSinks: RecordingSink[];
  handle: CsvExportWorkerExecutionHandle;
  completions: CsvExportWorkerExecutionCompletion[];
  cancellations: unknown[];
  errors: unknown[];
  progress: CsvExportProgress[];
  commits: CsvExportWorkerExecutionCompletion[];
  getPlanCount(): number;
  getFreshSinkCount(): number;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const rows = options.rows ?? [];
  const snapshot = makeSnapshot({ sourceRows: rows });
  const indexes = rows.map((_row, index) => index);
  const backend = options.backend ?? manualSchedulerBackend();
  const transport = options.transport ?? new TestTransport();
  if (options.loopback !== false) transport.enableLoopback();
  const client = new CsvExportWorkerClient(transport);
  const outputType = options.outputType ?? "text";
  const sink = options.sink ?? new RecordingSink(outputType);
  const freshSinks: RecordingSink[] = [];
  let planCount = 0;
  let freshSinkCount = 0;
  const completions: CsvExportWorkerExecutionCompletion[] = [];
  const commits: CsvExportWorkerExecutionCompletion[] = [];
  const cancellations: unknown[] = [];
  const errors: unknown[] = [];
  const progress: CsvExportProgress[] = [];
  const handle = executeCsvExportWorker({
    snapshot,
    createRowPlan: () => {
      planCount++;
      return new ArrayRowPlan(indexes);
    },
    plannedColumns: options.plannedColumns ?? [],
    groupHeaderPlan: options.groupHeaderPlan ?? { rows: [] },
    normalized: normalizeCsvExportOptions({
      includeColumnHeaders: false,
      ...options.normalizedOverrides,
    }),
    runtime: options.runtime ?? {},
    scheduler: new CooperativeScheduler(backend),
    now: () => 0,
    workerClient: client,
    taskId: 71,
    outputType,
    sink,
    createFreshSink: () => {
      freshSinkCount++;
      const fresh = options.createFreshSink?.() ?? new RecordingSink(outputType);
      freshSinks.push(fresh);
      return fresh;
    },
    onProgress: (event) => {
      progress.push(event);
      options.onProgress?.(event);
    },
    onWorkerClientUnusable: options.onWorkerClientUnusable,
    onCommit: (result) => {
      commits.push(result);
      options.onCommit?.(result);
    },
    onComplete: (result) => completions.push(result),
    onCancelled: (reason) => cancellations.push(reason),
    onError: (error) => errors.push(error),
  });
  return {
    backend,
    transport,
    client,
    sink,
    freshSinks,
    handle,
    completions,
    commits,
    cancellations,
    errors,
    progress,
    getPlanCount: () => planCount,
    getFreshSinkCount: () => freshSinkCount,
  };
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function startMessages(transport: TestTransport): CsvWorkerRequest[] {
  return transport.posted.filter((message) => message.kind === "csv:start");
}

describe("csvExportWorkerExecution - Worker happy path and backpressure", () => {
  it("projects, encodes, and closes exactly once with exported-row metadata", () => {
    const shouldExportRow = vi.fn(({ row }: { row: RowData }) => row.keep === true);
    const harness = createHarness({
      rows: [
        { value: "A", keep: true },
        { value: "B", keep: false },
        { value: "C", keep: true },
      ],
      plannedColumns: [dataColumn({ field: "value", headerName: "Value" })],
      normalizedOverrides: { includeColumnHeaders: true },
      runtime: {
        prependContent: [[{ value: "before" }]],
        appendContent: [[{ value: "after" }]],
        shouldExportRow,
      },
    });

    expect(harness.backend.pendingCount()).toBe(1);
    expect(harness.sink.chunks).toEqual([]);
    harness.backend.flushAll();

    expect(harness.sink.text()).toBe("before\r\nValue\r\nA\r\nC\r\nafter\r\n");
    expect(harness.sink.closeCount).toBe(1);
    expect(harness.sink.abortReasons).toEqual([]);
    expect(harness.completions).toHaveLength(1);
    expect(harness.completions[0]).toMatchObject({ rowCount: 2, columnCount: 1 });
    expect(shouldExportRow).toHaveBeenCalledTimes(3);
    expect(startMessages(harness.transport)).toHaveLength(1);
  });

  it("waits for each sink-accepted Worker chunk before projection continues", async () => {
    const firstWrite = deferred<void>();
    const processCell = vi.fn(({ rawValue }: { rawValue: unknown }) =>
      String(rawValue),
    );
    const long = "x".repeat(70_000);
    const sink = new RecordingSink("text", {
      write: (_bytes, index) => (index === 0 ? firstWrite.promise : undefined),
    });
    const harness = createHarness({
      rows: [{ first: long, second: "tail" }],
      plannedColumns: [
        dataColumn({ field: "first" }),
        dataColumn({ field: "second" }),
      ],
      runtime: { processCell },
      sink,
    });

    harness.backend.flushOne();
    expect(sink.chunks).toHaveLength(1);
    expect(processCell).toHaveBeenCalledTimes(1);
    expect(harness.backend.pendingCount()).toBe(0);

    firstWrite.resolve(undefined);
    await settleMicrotasks();
    expect(harness.backend.pendingCount()).toBe(1);
    expect(processCell).toHaveBeenCalledTimes(1);

    harness.backend.flushAll();
    expect(processCell).toHaveBeenCalledTimes(2);
    expect(sink.chunks.length).toBeGreaterThan(1);
    expect(harness.completions).toHaveLength(1);
  });

  it("defers sink close until final byte acceptance and producer completion", async () => {
    const finalWrite = deferred<void>();
    const sink = new RecordingSink("text", { write: () => finalWrite.promise });
    const harness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      sink,
    });

    harness.backend.flushAll();
    expect(sink.chunks).toHaveLength(1);
    expect(sink.closeCount).toBe(0);
    expect(harness.completions).toEqual([]);

    finalWrite.resolve(undefined);
    await settleMicrotasks();
    expect(sink.closeCount).toBe(1);
    expect(harness.completions).toEqual([]);
    harness.backend.flushAll();
    expect(harness.completions).toHaveLength(1);
  });

  it("emits Worker finalizing and terminal progress from scheduled publication", async () => {
    const closeGate = deferred<CsvSinkResult>();
    const sink = new RecordingSink("text", { close: () => closeGate.promise });
    const observer = vi.fn();
    const harness = createHarness({
      rows: [{ value: "A" }, { value: "B" }],
      plannedColumns: [dataColumn({ field: "value" })],
      sink,
      onProgress: observer,
    });

    harness.backend.flushAll();
    expect(sink.closeCount).toBe(1);
    expect(harness.progress).toEqual([
      {
        taskId: 71,
        phase: "finalizing",
        processedRows: 2,
        totalRows: 2,
        emittedBytes: sink.bytes().byteLength,
      },
    ]);

    closeGate.resolve({
      outputType: "text",
      byteLength: sink.bytes().byteLength,
      text: sink.text(),
    });
    await settleMicrotasks();

    expect(observer).toHaveBeenCalledTimes(1);
    expect(harness.completions).toEqual([]);
    expect(harness.backend.pendingCount()).toBe(1);

    harness.backend.flushOne();
    expect(observer).toHaveBeenCalledTimes(2);
    expect(harness.progress[harness.progress.length - 1]).toEqual({
      taskId: 71,
      phase: "finalizing",
      processedRows: 2,
      totalRows: 2,
      emittedBytes: sink.bytes().byteLength,
    });
    expect(harness.commits).toHaveLength(1);
    expect(harness.completions).toHaveLength(1);
  });

  it("does not close when first finalizing progress cancels Worker execution", () => {
    const reason = new Error("cancel at Worker finalizing");
    const sink = new RecordingSink("text");
    let handle: CsvExportWorkerExecutionHandle | null = null;
    const harness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
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
    expect(
      harness.progress.filter((progress) => progress.phase === "finalizing"),
    ).toHaveLength(1);
  });

  it("defers async close publication after scheduler failure without changing committed success", async () => {
    const backend = manualSchedulerBackend();
    const closeGate = deferred<CsvSinkResult>();
    const sink = new RecordingSink("text", { close: () => closeGate.promise });
    const observer = vi.fn();
    const harness = createHarness({
      backend,
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      sink,
      onProgress: observer,
    });

    backend.flushAll();
    expect(sink.closeCount).toBe(1);
    expect(observer).toHaveBeenCalledTimes(1);
    backend.failNextSchedule(new Error("terminal schedule failed"));
    closeGate.resolve({ outputType: "text", byteLength: 3, text: "A\r\n" });

    await Promise.resolve();
    expect(harness.commits).toHaveLength(1);
    expect(harness.completions).toEqual([]);
    expect(observer).toHaveBeenCalledTimes(1);
    harness.handle.cancel(new Error("too late"));
    expect(harness.cancellations).toEqual([]);
    expect(sink.abortReasons).toEqual([]);

    await Promise.resolve();
    expect(harness.completions).toHaveLength(1);
    expect(observer).toHaveBeenCalledTimes(2);
    expect(harness.errors).toEqual([]);
    expect(harness.cancellations).toEqual([]);
  });

  it("defers synchronous close publication when terminal scheduling throws", async () => {
    const backend = manualSchedulerBackend();
    const sink = new RecordingSink("text", {
      close: () => {
        backend.failNextSchedule(new Error("terminal schedule failed"));
        return { outputType: "text", byteLength: 3, text: "A\r\n" };
      },
    });
    const observer = vi.fn();
    const harness = createHarness({
      backend,
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      sink,
      onProgress: observer,
    });

    backend.flushAll();
    expect(harness.commits).toHaveLength(1);
    expect(harness.completions).toEqual([]);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(sink.abortReasons).toEqual([]);

    await Promise.resolve();
    expect(harness.completions).toHaveLength(1);
    expect(observer).toHaveBeenCalledTimes(2);
    expect(harness.errors).toEqual([]);
    expect(harness.cancellations).toEqual([]);
  });
});

describe("csvExportWorkerExecution - safe main fallback", () => {
  it.each(["text", "blob", "download"] as const)(
    "restarts %s output with one fresh sink and a fresh row plan",
    (outputType) => {
      const long = "x".repeat(70_000);
      const processCell = vi.fn(({ rawValue }: { rawValue: unknown }) =>
        String(rawValue),
      );
      const harness = createHarness({
        rows: [{ first: long, second: "tail" }],
        plannedColumns: [
          dataColumn({ field: "first" }),
          dataColumn({ field: "second" }),
        ],
        runtime: { processCell },
        outputType,
      });

      harness.backend.flushOne();
      expect(harness.sink.chunks).toHaveLength(1);
      harness.transport.emitError(new Error("worker failed"));
      harness.backend.flushAll();

      expect(harness.getPlanCount()).toBe(2);
      expect(harness.getFreshSinkCount()).toBe(1);
      expect(harness.sink.abortReasons).toHaveLength(1);
      expect(harness.freshSinks[0]?.closeCount).toBe(1);
      expect(harness.completions).toHaveLength(1);
      expect(harness.errors).toEqual([]);
      expect(processCell).toHaveBeenCalledTimes(3);
      expect(startMessages(harness.transport)).toHaveLength(1);
    },
  );

  it("reuses an untouched stream sink when failure precedes byte acceptance", () => {
    const transport = new TestTransport();
    const sink = new RecordingSink("stream");
    const harness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      outputType: "stream",
      sink,
      transport,
      loopback: false,
    });

    transport.emitError(new Error("startup failure"));
    harness.backend.flushAll();

    expect(harness.getFreshSinkCount()).toBe(0);
    expect(sink.abortReasons).toEqual([]);
    expect(sink.closeCount).toBe(1);
    expect(sink.text()).toBe("A\r\n");
    expect(harness.completions).toHaveLength(1);
  });

  it("does not restart a stream after byte acceptance starts", async () => {
    const long = "x".repeat(70_000);
    const writeGate = deferred<void>();
    const sink = new RecordingSink("stream", {
      write: () => writeGate.promise,
    });
    const harness = createHarness({
      rows: [{ first: long, second: "tail" }],
      plannedColumns: [
        dataColumn({ field: "first" }),
        dataColumn({ field: "second" }),
      ],
      outputType: "stream",
      sink,
    });

    harness.backend.flushOne();
    expect(sink.chunks).toHaveLength(1);
    const failure = new Error("worker failed after output");
    harness.transport.emitError(failure);
    harness.backend.flushAll();
    writeGate.resolve(undefined);
    await settleMicrotasks();

    expect(harness.getPlanCount()).toBe(1);
    expect(harness.getFreshSinkCount()).toBe(0);
    expect(sink.abortReasons).toEqual([failure]);
    expect(harness.errors).toEqual([failure]);
    expect(harness.completions).toEqual([]);
  });

  it("never restarts after a sink throw or rejection", async () => {
    const thrown = new Error("sink write threw");
    const throwSink = new RecordingSink("text", {
      write: () => {
        throw thrown;
      },
    });
    const throwHarness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      sink: throwSink,
    });
    throwHarness.backend.flushAll();
    expect(throwHarness.errors).toEqual([thrown]);
    expect(throwHarness.getFreshSinkCount()).toBe(0);
    expect(throwSink.abortReasons).toEqual([thrown]);

    const rejected = new Error("sink write rejected");
    const rejectSink = new RecordingSink("text", {
      write: () => Promise.reject(rejected),
    });
    const rejectHarness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      sink: rejectSink,
    });
    rejectHarness.backend.flushAll();
    await settleMicrotasks();
    expect(rejectHarness.errors).toEqual([rejected]);
    expect(rejectHarness.getFreshSinkCount()).toBe(0);
    expect(rejectSink.abortReasons).toEqual([rejected]);
  });

  it("produces byte-identical output to direct cooperative main execution", () => {
    const rows = [
      { a: "one,quoted", b: "λ" },
      { a: "=formula", b: 2 },
    ];
    const columns = [dataColumn({ field: "a" }), dataColumn({ field: "b" })];
    const transport = new TestTransport();
    const fallback = createHarness({
      rows,
      plannedColumns: columns,
      transport,
      loopback: false,
    });
    transport.emitError(new Error("restart on main"));
    fallback.backend.flushAll();

    const directBackend = manualSchedulerBackend();
    const directSink = new RecordingSink("text");
    executeCsvExportMainThread({
      snapshot: makeSnapshot({ sourceRows: rows }),
      rowPlan: new ArrayRowPlan([0, 1]),
      plannedColumns: columns,
      groupHeaderPlan: { rows: [] },
      normalized: normalizeCsvExportOptions({ includeColumnHeaders: false }),
      runtime: {},
      sink: directSink,
      scheduler: new CooperativeScheduler(directBackend),
      now: () => 0,
      taskId: 72,
      onComplete: vi.fn(),
      onCancelled: vi.fn(),
      onError: vi.fn(),
    });
    directBackend.flushAll();

    expect(fallback.freshSinks[0]?.bytes()).toEqual(directSink.bytes());
  });
});

describe("csvExportWorkerExecution - cancellation and reentrancy", () => {
  it("cancels while waiting for ready or scheduled projection exactly once", () => {
    const waitingTransport = new TestTransport();
    const waiting = createHarness({ transport: waitingTransport, loopback: false });
    const waitingReason = new Error("cancel ready");
    waiting.handle.cancel(waitingReason);
    waiting.handle.cancel(new Error("again"));
    expect(waiting.cancellations).toEqual([waitingReason]);
    expect(waiting.sink.abortReasons).toEqual([waitingReason]);

    const projected = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
    });
    const projectedReason = new Error("cancel projection");
    projected.handle.cancel(projectedReason);
    projected.backend.flushAll();
    expect(projected.cancellations).toEqual([projectedReason]);
    expect(projected.sink.abortReasons).toEqual([projectedReason]);
    expect(projected.sink.chunks).toEqual([]);
  });

  it("makes pending-write settlements inert after cancellation", async () => {
    const writeGate = deferred<void>();
    const sink = new RecordingSink("text", { write: () => writeGate.promise });
    const harness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      sink,
    });
    harness.backend.flushAll();
    const reason = new Error("cancel write");
    harness.handle.cancel(reason);
    writeGate.resolve(undefined);
    await settleMicrotasks();

    expect(harness.cancellations).toEqual([reason]);
    expect(harness.completions).toEqual([]);
    expect(harness.errors).toEqual([]);
    expect(sink.abortReasons).toEqual([reason]);
  });

  it("cancels active fallback and late scheduled work stays inert", () => {
    const transport = new TestTransport();
    const harness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      transport,
      loopback: false,
    });
    transport.emitError(new Error("fallback"));
    const reason = new Error("cancel fallback");
    harness.handle.cancel(reason);
    harness.backend.flushAll();

    expect(harness.cancellations).toEqual([reason]);
    expect(harness.freshSinks[0]?.abortReasons).toEqual([reason]);
    expect(harness.completions).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("cancels asynchronous Worker-path close and ignores its late result", async () => {
    const closeGate = deferred<CsvSinkResult>();
    const sink = new RecordingSink("text", { close: () => closeGate.promise });
    const harness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      sink,
    });
    harness.backend.flushAll();
    expect(sink.closeCount).toBe(1);

    const reason = new Error("cancel close");
    harness.handle.cancel(reason);
    closeGate.resolve({ outputType: "text", byteLength: 3, text: "A\r\n" });
    await settleMicrotasks();

    expect(harness.cancellations).toEqual([reason]);
    expect(sink.abortReasons).toEqual([reason]);
    expect(harness.completions).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("makes cancellation after Worker close success but before publication inert", async () => {
    const closeGate = deferred<CsvSinkResult>();
    const sink = new RecordingSink("text", { close: () => closeGate.promise });
    const harness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      sink,
    });
    harness.backend.flushAll();
    expect(sink.closeCount).toBe(1);

    closeGate.resolve({ outputType: "text", byteLength: 3, text: "A\r\n" });
    await settleMicrotasks();
    expect(harness.backend.pendingCount()).toBe(1);

    const reason = new Error("too late");
    harness.handle.cancel(reason);
    harness.backend.flushAll();

    expect(harness.cancellations).toEqual([]);
    expect(sink.abortReasons).toEqual([]);
    expect(harness.errors).toEqual([]);
    expect(harness.completions).toHaveLength(1);
  });

  it("survives synchronous ready/completion and synchronous start failure", () => {
    const happy = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
    });
    happy.backend.flushAll();
    expect(happy.completions).toHaveLength(1);

    const failingTransport = new TestTransport();
    failingTransport.onPost = (message) => {
      if (message.kind === "csv:start") {
        failingTransport.emitError(new Error("synchronous start failure"));
      }
    };
    const fallback = createHarness({
      rows: [{ value: "B" }],
      plannedColumns: [dataColumn({ field: "value" })],
      transport: failingTransport,
      loopback: false,
    });
    fallback.backend.flushAll();

    expect(fallback.completions).toHaveLength(1);
    expect(fallback.freshSinks[0]?.text()).toBe("B\r\n");
    expect(startMessages(failingTransport)).toHaveLength(1);
    expect(fallback.getFreshSinkCount()).toBe(1);
  });

  it("contains no Worker factory, Grid, React, registry, or public API imports", () => {
    const source = readFileSync(
      new URL("../csvExportWorkerExecution.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /WorkerFactory|GridState|from ["'][^"']*Grid|react|registry|public-api/u,
    );
  });
});

describe("csvExportWorkerExecution - reusable-client invalidation", () => {
  it.each(["worker", "protocol"] as const)(
    "invalidates once for a restartable %s failure while fallback succeeds",
    (kind) => {
      const failures: CsvExportWorkerFailure[] = [];
      const transport = new TestTransport();
      const harness = createHarness({
        rows: [{ value: "A" }],
        plannedColumns: [dataColumn({ field: "value" })],
        transport,
        loopback: false,
        onWorkerClientUnusable: (failure) => failures.push(failure),
      });

      if (kind === "worker") {
        transport.emitError(new Error("worker failed"));
      } else {
        transport.emit({ kind: "invalid", taskId: 71 });
      }
      transport.emitError(new Error("late worker failure"));
      transport.emit({ kind: "invalid", taskId: 71 });
      harness.backend.flushAll();

      expect(failures).toHaveLength(1);
      expect(failures[0]?.kind).toBe(kind);
      expect(harness.completions).toHaveLength(1);
      expect(harness.errors).toEqual([]);
      expect(harness.getFreshSinkCount()).toBe(1);
      expect(startMessages(transport)).toHaveLength(1);
    },
  );

  it("does not invalidate for success, cancellation, sink, or projection failure", () => {
    const successfulInvalidation = vi.fn();
    const successful = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      onWorkerClientUnusable: successfulInvalidation,
    });
    successful.backend.flushAll();
    expect(successfulInvalidation).not.toHaveBeenCalled();

    const cancelledInvalidation = vi.fn();
    const cancelled = createHarness({
      transport: new TestTransport(),
      loopback: false,
      onWorkerClientUnusable: cancelledInvalidation,
    });
    cancelled.handle.cancel(new Error("cancelled"));
    expect(cancelledInvalidation).not.toHaveBeenCalled();

    const sinkInvalidation = vi.fn();
    const sinkFailure = new Error("sink failed");
    const sink = new RecordingSink("text", {
      write: () => {
        throw sinkFailure;
      },
    });
    const failedSink = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      sink,
      onWorkerClientUnusable: sinkInvalidation,
    });
    failedSink.backend.flushAll();
    expect(failedSink.errors).toEqual([sinkFailure]);
    expect(sinkInvalidation).not.toHaveBeenCalled();

    const projectionInvalidation = vi.fn();
    const projectionFailure = new Error("projection failed");
    const failedProjection = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [
        dataColumn({
          field: "value",
          valueGetter: () => {
            throw projectionFailure;
          },
        }),
      ],
      onWorkerClientUnusable: projectionInvalidation,
    });
    failedProjection.backend.flushAll();
    expect(failedProjection.errors).toEqual([projectionFailure]);
    expect(projectionInvalidation).not.toHaveBeenCalled();
  });

  it("allows reentrant client destruction without duplicating fallback or terminals", () => {
    const invalidation = vi.fn();
    const transport = new TestTransport();
    const harness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      transport,
      loopback: false,
      onWorkerClientUnusable: (failure) => {
        invalidation(failure);
        harness.client.destroy();
      },
    });

    transport.emitError(new Error("worker failed"));
    harness.backend.flushAll();
    transport.emitError(new Error("late"));

    expect(invalidation).toHaveBeenCalledTimes(1);
    expect(harness.completions).toHaveLength(1);
    expect(harness.cancellations).toEqual([]);
    expect(harness.errors).toEqual([]);
    expect(harness.getFreshSinkCount()).toBe(1);
    expect(startMessages(transport)).toHaveLength(1);
  });
});
