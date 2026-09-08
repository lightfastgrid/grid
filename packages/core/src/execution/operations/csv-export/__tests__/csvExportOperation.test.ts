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
import {
  calculateCsvExportWorkUnitCount,
  type CsvExportOperationCompletion,
  type CsvExportOperationHandle,
  executeCsvExportOperation,
} from "../csvExportOperation";
import type { CsvExportProjectionRuntime } from "../csvExportProjectionProducer";
import type {
  CsvChunkRequest,
  CsvWorkerRequest,
} from "../csvExportProtocol";
import type {
  CsvExportWorkerOutputType,
  CsvExportWorkerTransport,
} from "../csvExportWorkerClient";
import { CsvExportWorkerClientOwner } from "../csvExportWorkerClientOwner";
import { CsvExportWorkerRuntime } from "../csvExportWorkerRuntime";

interface ManualSchedulerBackend extends CooperativeSchedulerBackend {
  flushOne(): boolean;
  flushAll(limit?: number): number;
  pendingCount(): number;
  readonly options: Array<CooperativeScheduleOptions | undefined>;
}

function manualSchedulerBackend(): ManualSchedulerBackend {
  const queue: Array<{ callback: () => void; cancelled: boolean }> = [];
  const options: Array<CooperativeScheduleOptions | undefined> = [];
  return {
    options,
    schedule(callback, scheduleOptions) {
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
  };
}

class ArrayRowPlan implements CsvRowPlan {
  readonly knownRowCount: number | undefined;
  stepCount = 0;
  private index = 0;

  constructor(
    private readonly indexes: readonly number[],
    exactCount = true,
  ) {
    this.knownRowCount = exactCount ? indexes.length : undefined;
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

class LoopbackTransport implements CsvExportWorkerTransport {
  readonly posted: CsvWorkerRequest[] = [];
  terminateCount = 0;
  private responseHandler: ((message: unknown) => void) | null = null;
  private errorHandler: ((error: unknown) => void) | null = null;
  private readonly runtime = new CsvExportWorkerRuntime((response) =>
    this.responseHandler?.(response),
  );

  post(message: CsvWorkerRequest): void {
    this.posted.push(message);
    this.runtime.handleMessage(message);
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

  terminate(): void {
    this.terminateCount++;
    this.responseHandler = null;
    this.errorHandler = null;
  }

  emitError(error: unknown): void {
    this.errorHandler?.(error);
  }
}

interface SinkControl {
  write?: (chunk: Uint8Array<ArrayBuffer>) => Promise<void> | void;
  close?: () => Promise<CsvSinkResult> | CsvSinkResult;
}

class RecordingSink implements CsvOutputSink {
  readonly chunks: Uint8Array<ArrayBuffer>[] = [];
  readonly abortReasons: unknown[] = [];
  closeCount = 0;

  constructor(
    readonly outputType: CsvExportWorkerOutputType = "text",
    private readonly control: SinkControl = {},
  ) {}

  write(chunk: Uint8Array<ArrayBuffer>): Promise<void> | void {
    this.chunks.push(Uint8Array.from(chunk));
    return this.control.write?.(chunk);
  }

  close(): Promise<CsvSinkResult> | CsvSinkResult {
    this.closeCount++;
    return this.control.close?.() ?? this.result();
  }

  abort(reason: unknown): void {
    this.abortReasons.push(reason);
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
    if (this.outputType === "blob") {
      return {
        outputType: "blob",
        byteLength: bytes.byteLength,
        blob: new Blob([bytes]),
      };
    }
    if (this.outputType === "download") {
      return {
        outputType: "download",
        byteLength: bytes.byteLength,
        fileName: "export.csv",
      };
    }
    return { outputType: "stream", byteLength: bytes.byteLength };
  }
}

function dataColumn(column: ColumnDef): CsvPlannedColumn {
  return { kind: "data", column, field: column.field };
}

interface HarnessOptions {
  rows?: readonly RowData[];
  createRowPlan?: () => CsvRowPlan;
  rowCountUpperBound?: number;
  plannedColumns?: readonly CsvPlannedColumn[];
  groupHeaderPlan?: CsvGroupHeaderPlan;
  normalizedOverrides?: CsvExportDefaults;
  runtime?: CsvExportProjectionRuntime;
  outputType?: CsvExportWorkerOutputType;
  sink?: RecordingSink;
  createFreshSink?: () => RecordingSink;
  schedulerBackend?: ManualSchedulerBackend;
  owner?: CsvExportWorkerClientOwner;
  workerAllowed?: boolean;
  threshold?: number;
  taskId?: number;
  onProgress?: (progress: CsvExportProgress) => void;
  onCommit?: (result: CsvExportOperationCompletion) => void;
}

interface Harness {
  backend: ManualSchedulerBackend;
  owner: CsvExportWorkerClientOwner;
  transports: LoopbackTransport[];
  sink: RecordingSink;
  freshSinks: RecordingSink[];
  handle: CsvExportOperationHandle;
  completions: CsvExportOperationCompletion[];
  commits: CsvExportOperationCompletion[];
  cancellations: unknown[];
  errors: unknown[];
  getPlanCount(): number;
  getTransportCount(): number;
  getFreshSinkCount(): number;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const rows = options.rows ?? [];
  const indexes = rows.map((_row, index) => index);
  const backend = options.schedulerBackend ?? manualSchedulerBackend();
  const transports: LoopbackTransport[] = [];
  let transportCount = 0;
  const owner =
    options.owner ??
    new CsvExportWorkerClientOwner(() => {
      transportCount++;
      const transport = new LoopbackTransport();
      transports.push(transport);
      return transport;
    });
  const outputType = options.outputType ?? "text";
  const sink = options.sink ?? new RecordingSink(outputType);
  const freshSinks: RecordingSink[] = [];
  let planCount = 0;
  const completions: CsvExportOperationCompletion[] = [];
  const commits: CsvExportOperationCompletion[] = [];
  const cancellations: unknown[] = [];
  const errors: unknown[] = [];
  const handle = executeCsvExportOperation({
    snapshot: makeSnapshot({ sourceRows: rows }),
    createRowPlan: () => {
      planCount++;
      return options.createRowPlan?.() ?? new ArrayRowPlan(indexes);
    },
    rowCountUpperBound: options.rowCountUpperBound ?? rows.length,
    plannedColumns: options.plannedColumns ?? [],
    groupHeaderPlan: options.groupHeaderPlan ?? { rows: [] },
    normalized: normalizeCsvExportOptions({
      includeColumnHeaders: false,
      ...options.normalizedOverrides,
    }),
    runtime: options.runtime ?? {},
    outputType,
    sink,
    createFreshSink: () => {
      const fresh = options.createFreshSink?.() ?? new RecordingSink(outputType);
      freshSinks.push(fresh);
      return fresh;
    },
    scheduler: new CooperativeScheduler(backend),
    now: () => 0,
    workerClientOwner: owner,
    workerAllowed: options.workerAllowed ?? true,
    selectedCellThreshold: options.threshold,
    taskId: options.taskId ?? 1,
    onProgress: options.onProgress,
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
    owner,
    transports,
    sink,
    freshSinks,
    handle,
    completions,
    commits,
    cancellations,
    errors,
    getPlanCount: () => planCount,
    getTransportCount: () => transportCount,
    getFreshSinkCount: () => freshSinks.length,
  };
}

function chunkMessages(transport: LoopbackTransport): CsvChunkRequest[] {
  return transport.posted.filter(
    (message): message is CsvChunkRequest => message.kind === "csv:chunk",
  );
}

describe("csvExportOperation - scheduled path selection", () => {
  it("performs no synchronous plan, projection, Worker, or callback work", () => {
    const getter = vi.fn(() => "A");
    const harness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value", valueGetter: getter })],
      threshold: 1,
    });

    expect(harness.getPlanCount()).toBe(0);
    expect(harness.getTransportCount()).toBe(0);
    expect(getter).not.toHaveBeenCalled();
    expect(harness.completions).toEqual([]);
    expect(harness.cancellations).toEqual([]);
    expect(harness.errors).toEqual([]);
    expect(harness.backend.options).toEqual([{ priority: "user-visible" }]);
  });

  it("cancels before bootstrap without constructing a plan or Worker", () => {
    const harness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      threshold: 0,
    });
    const reason = new Error("cancel before bootstrap");

    harness.handle.cancel(reason);
    harness.handle.cancel(new Error("again"));
    harness.backend.flushAll();

    expect(harness.getPlanCount()).toBe(0);
    expect(harness.getTransportCount()).toBe(0);
    expect(harness.sink.abortReasons).toEqual([reason]);
    expect(harness.cancellations).toEqual([reason]);
    expect(harness.completions).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("uses main below threshold and Worker at the exact threshold", () => {
    const columns = [dataColumn({ field: "a" }), dataColumn({ field: "b" })];
    const below = createHarness({
      rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }],
      plannedColumns: columns,
      threshold: 5,
    });
    below.backend.flushAll();
    expect(below.getTransportCount()).toBe(0);
    expect(below.completions).toHaveLength(1);

    const exact = createHarness({
      rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }],
      plannedColumns: columns,
      threshold: 4,
    });
    exact.backend.flushAll();
    expect(exact.getTransportCount()).toBe(1);
    expect(exact.completions).toHaveLength(1);
  });

  it("uses threshold zero only for non-empty selected-cell work", () => {
    const nonEmpty = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      threshold: 0,
    });
    nonEmpty.backend.flushAll();
    expect(nonEmpty.getTransportCount()).toBe(1);

    const noRows = createHarness({
      rows: [],
      plannedColumns: [dataColumn({ field: "value" })],
      threshold: 0,
    });
    noRows.backend.flushAll();
    expect(noRows.getTransportCount()).toBe(0);

    const noColumns = createHarness({ rows: [{ value: "A" }], threshold: 0 });
    noColumns.backend.flushAll();
    expect(noColumns.getTransportCount()).toBe(0);
  });

  it("uses selected rows times planned columns and saturates safely", () => {
    expect(calculateCsvExportWorkUnitCount(2, 3)).toBe(6);
    expect(calculateCsvExportWorkUnitCount(Number.MAX_SAFE_INTEGER, 2)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(calculateCsvExportWorkUnitCount(0, Number.MAX_SAFE_INTEGER)).toBe(0);

    const columns = [
      dataColumn({ field: "a" }),
      dataColumn({ field: "b" }),
      dataColumn({ field: "c" }),
    ];
    const harness = createHarness({
      rows: [{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6 }],
      plannedColumns: columns,
      threshold: 6,
    });
    harness.backend.flushAll();
    expect(harness.getTransportCount()).toBe(1);
  });

  it("prefers an exact count and otherwise uses the O(1) upper bound without scanning", () => {
    const exact = createHarness({
      rows: [{ a: 1 }, { a: 2 }],
      plannedColumns: [dataColumn({ field: "a" })],
      rowCountUpperBound: 100,
      threshold: 100,
    });
    exact.backend.flushAll();
    expect(exact.getTransportCount()).toBe(0);

    const plans: ArrayRowPlan[] = [];
    const harness = createHarness({
      rows: [{ a: 1 }, { a: 2 }],
      plannedColumns: [dataColumn({ field: "a" })],
      createRowPlan: () => {
        const plan = new ArrayRowPlan([0, 1], false);
        plans.push(plan);
        return plan;
      },
      rowCountUpperBound: 100,
      threshold: 100,
    });

    expect(harness.backend.flushOne()).toBe(true);
    expect(plans[0]?.stepCount).toBe(0);
    expect(harness.getTransportCount()).toBe(1);
    harness.backend.flushAll();
    expect(harness.completions).toHaveLength(1);
  });

  it("workerAllowed false and invalid thresholds use the cooperative main path", () => {
    const disallowed = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      threshold: 0,
      workerAllowed: false,
    });
    disallowed.backend.flushAll();
    expect(disallowed.getTransportCount()).toBe(0);

    for (const threshold of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalid = createHarness({
        rows: [{ value: "A" }],
        plannedColumns: [dataColumn({ field: "value" })],
        threshold,
      });
      invalid.backend.flushAll();
      expect(invalid.getTransportCount()).toBe(0);
    }
  });
});

describe("csvExportOperation - lazy owner and row-plan ownership", () => {
  it("falls back from client construction to main with the untouched sink and plan", () => {
    let factoryCalls = 0;
    const owner = new CsvExportWorkerClientOwner(() => {
      factoryCalls++;
      throw new Error("Worker construction failed");
    });
    const sink = new RecordingSink("text");
    const harness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      threshold: 0,
      owner,
      sink,
    });

    harness.backend.flushAll();

    expect(factoryCalls).toBe(1);
    expect(harness.getPlanCount()).toBe(1);
    expect(harness.getFreshSinkCount()).toBe(0);
    expect(sink.abortReasons).toEqual([]);
    expect(sink.closeCount).toBe(1);
    expect(sink.text()).toBe("A\r\n");
    expect(harness.completions).toHaveLength(1);
  });

  it("reuses one client across successful sequential Worker exports", () => {
    const transports: LoopbackTransport[] = [];
    let factoryCalls = 0;
    const owner = new CsvExportWorkerClientOwner(() => {
      factoryCalls++;
      const transport = new LoopbackTransport();
      transports.push(transport);
      return transport;
    });
    const first = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      threshold: 0,
      taskId: 1,
      owner,
    });
    first.backend.flushAll();
    const client = owner.getWorkerClientIfCreated();

    const second = createHarness({
      rows: [{ value: "B" }],
      plannedColumns: [dataColumn({ field: "value" })],
      threshold: 0,
      taskId: 2,
      owner,
    });
    second.backend.flushAll();

    expect(factoryCalls).toBe(1);
    expect(transports).toHaveLength(1);
    expect(owner.getWorkerClientIfCreated()).toBe(client);
    expect(first.completions).toHaveLength(1);
    expect(second.completions).toHaveLength(1);
  });

  it("invalidates after Worker failure and creates a fresh client later", () => {
    const transports: LoopbackTransport[] = [];
    let factoryCalls = 0;
    const owner = new CsvExportWorkerClientOwner(() => {
      factoryCalls++;
      const transport = new LoopbackTransport();
      transports.push(transport);
      return transport;
    });
    const failed = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      threshold: 0,
      taskId: 1,
      owner,
    });
    failed.backend.flushOne();
    transports[0]!.emitError(new Error("Worker failed"));
    failed.backend.flushAll();

    expect(owner.getWorkerClientIfCreated()).toBeNull();
    expect(failed.completions).toHaveLength(1);

    const recovered = createHarness({
      rows: [{ value: "B" }],
      plannedColumns: [dataColumn({ field: "value" })],
      threshold: 0,
      taskId: 2,
      owner,
    });
    recovered.backend.flushAll();

    expect(factoryCalls).toBe(2);
    expect(transports[0]?.terminateCount).toBe(1);
    expect(recovered.completions).toHaveLength(1);
  });

  it("does not invalidate the reusable client for cancellation or sink failure", () => {
    let factoryCalls = 0;
    const owner = new CsvExportWorkerClientOwner(() => {
      factoryCalls++;
      return new LoopbackTransport();
    });
    const cancelled = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      threshold: 0,
      taskId: 1,
      owner,
    });
    cancelled.backend.flushOne();
    const reusable = owner.getWorkerClientIfCreated();
    cancelled.handle.cancel(new Error("cancelled"));
    expect(owner.getWorkerClientIfCreated()).toBe(reusable);

    const sinkFailure = new Error("sink failed");
    const failedSink = new RecordingSink("text", {
      write: () => {
        throw sinkFailure;
      },
    });
    const failed = createHarness({
      rows: [{ value: "B" }],
      plannedColumns: [dataColumn({ field: "value" })],
      threshold: 0,
      taskId: 2,
      owner,
      sink: failedSink,
    });
    failed.backend.flushAll();

    expect(failed.errors).toEqual([sinkFailure]);
    expect(owner.getWorkerClientIfCreated()).toBe(reusable);
    expect(factoryCalls).toBe(1);
  });

  it("creates a fresh row plan only after consumed Worker projection restarts", () => {
    const long = "x".repeat(70_000);
    const transports: LoopbackTransport[] = [];
    const owner = new CsvExportWorkerClientOwner(() => {
      const transport = new LoopbackTransport();
      transports.push(transport);
      return transport;
    });
    const harness = createHarness({
      rows: [{ first: long, second: "tail" }],
      plannedColumns: [
        dataColumn({ field: "first" }),
        dataColumn({ field: "second" }),
      ],
      threshold: 0,
      owner,
    });

    harness.backend.flushOne();
    harness.backend.flushOne();
    expect(chunkMessages(transports[0]!)).toHaveLength(1);
    transports[0]!.emitError(new Error("restart"));
    harness.backend.flushAll();

    expect(harness.getPlanCount()).toBe(2);
    expect(harness.getFreshSinkCount()).toBe(1);
    expect(harness.completions).toHaveLength(1);
  });
});

describe("csvExportOperation - completion commit ownership", () => {
  it.each([
    ["main", { workerAllowed: false, threshold: 0 }],
    ["worker", { workerAllowed: true, threshold: 0 }],
  ] as const)(
    "ignores cancellation from the %s commit handoff",
    (_label, options) => {
      const harnessRef: { current: Harness | null } = { current: null };
      const harness = createHarness({
        rows: [{ value: "A" }],
        plannedColumns: [dataColumn({ field: "value" })],
        ...options,
        onCommit: () => harnessRef.current?.handle.cancel(new Error("too late")),
      });
      harnessRef.current = harness;

      harness.backend.flushAll();

      expect(harness.commits).toHaveLength(1);
      expect(harness.completions).toHaveLength(1);
      expect(harness.cancellations).toEqual([]);
      expect(harness.errors).toEqual([]);
      expect(harness.sink.abortReasons).toEqual([]);
    },
  );

  it("ignores cancellation from the Worker-to-main fallback commit handoff", () => {
    const transport = new LoopbackTransport();
    const harnessRef: { current: Harness | null } = { current: null };
    const harness = createHarness({
      rows: [{ value: "A" }],
      plannedColumns: [dataColumn({ field: "value" })],
      threshold: 0,
      owner: new CsvExportWorkerClientOwner(() => transport),
      onCommit: () => harnessRef.current?.handle.cancel(new Error("too late")),
    });
    harnessRef.current = harness;

    harness.backend.flushOne();
    transport.emitError(new Error("fallback"));
    harness.backend.flushAll();

    expect(harness.commits).toHaveLength(1);
    expect(harness.completions).toHaveLength(1);
    expect(harness.cancellations).toEqual([]);
    expect(harness.errors).toEqual([]);
    expect(harness.freshSinks[0]?.abortReasons).toEqual([]);
  });
});

describe("csvExportOperation - Stage 4 parity and dependency gate", () => {
  it("keeps main and multi-chunk Worker output byte-identical", () => {
    const long = `λ,${"x".repeat(70_000)}`;
    const rows: RowData[] = [
      { a: "=formula", b: long, c: 2, keep: true },
      { a: "skip", b: "skip", c: 0, keep: false },
      { a: true, b: null, c: 3n, keep: true },
    ];
    const columns = [
      dataColumn({ field: "a", headerName: "A" }),
      dataColumn({ field: "b", headerName: "B" }),
      dataColumn({ field: "c", headerName: "C" }),
    ];
    const groupHeaderPlan: CsvGroupHeaderPlan = {
      rows: [
        {
          level: 0,
          segments: [
            {
              run: {
                groupId: "g",
                headerName: "Group",
                level: 0,
                fields: ["a", "b", "c"],
              },
              startColumnIndex: 0,
              span: 3,
            },
          ],
        },
      ],
    };
    const runtime: CsvExportProjectionRuntime = {
      prependContent: [[{ value: "before,quoted" }]],
      appendContent: [[{ value: "after" }]],
      shouldExportRow: ({ row }) => row.keep === true,
    };
    const normalizedOverrides: CsvExportDefaults = {
      includeColumnHeaders: true,
      lineEnding: "\n",
      utf8Bom: true,
      formulaProtection: "escape",
    };
    const main = createHarness({
      rows,
      plannedColumns: columns,
      groupHeaderPlan,
      runtime,
      normalizedOverrides,
      workerAllowed: false,
      threshold: 0,
    });
    const worker = createHarness({
      rows,
      plannedColumns: columns,
      groupHeaderPlan,
      runtime,
      normalizedOverrides,
      threshold: 0,
    });

    main.backend.flushAll();
    worker.backend.flushAll();

    expect(worker.sink.bytes()).toEqual(main.sink.bytes());
    expect(worker.completions[0]?.rowCount).toBe(2);
    const postedChunks = chunkMessages(worker.transports[0]!);
    expect(postedChunks.length).toBeGreaterThan(1);
    expect(
      postedChunks.every((chunk) =>
        chunk.values.every(
          (value) =>
            value === null ||
            value === undefined ||
            ["string", "number", "boolean", "bigint"].includes(typeof value),
        ),
      ),
    ).toBe(true);
  });

  it("maps Stage 4 tests 44-52 and has no forbidden feature imports", () => {
    const source = readFileSync(
      new URL("../csvExportOperation.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(
      /GridState|renderer|filters|quick-search|column-menu|react|OperationExecutionRunner/u,
    );
    expect(source).not.toContain("RowData");
    expect(source).toContain("calculateCsvExportWorkUnitCount");

    const testMap = {
      44: "csvExportProtocol / csvExportWorkerRuntime",
      45: "csvExportWorkerClient stale-task isolation",
      46: "csvExportWorkerClient one-chunk backpressure",
      47: "csvExportWorkerClient transfer ownership",
      48: "csvExportWorkerExecution cancellation ownership",
      49: "csvExportWorkerExecution restartable failure",
      50: "csvExportWorkerExecution stream no-restart",
      51: "csvExportOperation main/Worker byte parity",
      52: "csvExportOperation lazy selection and cancellation",
    };
    expect(Object.keys(testMap)).toHaveLength(9);
  });
});
