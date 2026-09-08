import { readFileSync } from "node:fs";
import { describe, expect, it, type Mock,vi } from "vitest";

import type {
  CsvWorkerRequest,
} from "../../../execution/operations/csv-export/csvExportProtocol";
import type {
  CsvExportWorkerTransport,
} from "../../../execution/operations/csv-export/csvExportWorkerClient";
import { CsvExportWorkerClientOwner } from "../../../execution/operations/csv-export/csvExportWorkerClientOwner";
import { CsvExportWorkerRuntime } from "../../../execution/operations/csv-export/csvExportWorkerRuntime";
import type {
  CooperativeScheduleOptions,
  CooperativeSchedulerBackend,
} from "../../../scheduling/CooperativeScheduler";
import { CooperativeScheduler } from "../../../scheduling/CooperativeScheduler";
import type { RowData } from "../../../types";
import { CsvExportController } from "../CsvExportController";
import {
  CsvExportCancelledError,
  CsvExportDisabledError,
  CsvExportInvalidOptionsError,
} from "../csvExportErrors";
import type { CsvExportSnapshot } from "../csvExportSnapshot";
import type {
  CsvExportDefaults,
  CsvExportProgress,
  CsvExportResult,
  CsvOutputTarget,
} from "../csvExportTypes";
import type {
  CsvByteChunk,
  CsvOutputSink,
  CsvSinkResult,
} from "../csvOutputSink";

import { makeSnapshot, membership } from "./support";

interface ManualSchedulerBackend extends CooperativeSchedulerBackend {
  readonly options: Array<CooperativeScheduleOptions | undefined>;
  flushOne(): boolean;
  flushAll(limit?: number): number;
  pendingCount(): number;
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

function concatenate(chunks: readonly CsvByteChunk[]): Uint8Array<ArrayBuffer> {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

interface RecordingSinkOptions {
  close?: () => Promise<CsvSinkResult> | CsvSinkResult;
  write?: (chunk: CsvByteChunk) => Promise<void> | void;
}

class RecordingSink implements CsvOutputSink {
  readonly chunks: CsvByteChunk[] = [];
  readonly abortReasons: unknown[] = [];
  closeCount = 0;

  constructor(
    readonly target: CsvOutputTarget,
    private readonly fileName: string,
    private readonly options: RecordingSinkOptions = {},
  ) {}

  write(chunk: CsvByteChunk): Promise<void> | void {
    this.chunks.push(Uint8Array.from(chunk));
    return this.options.write?.(chunk);
  }

  close(): Promise<CsvSinkResult> | CsvSinkResult {
    this.closeCount++;
    return this.options.close?.() ?? this.createResult();
  }

  abort(reason: unknown): void {
    this.abortReasons.push(reason);
  }

  text(): string {
    return new TextDecoder().decode(concatenate(this.chunks));
  }

  private createResult(): CsvSinkResult {
    const bytes = concatenate(this.chunks);
    switch (this.target.type) {
      case "text":
        return {
          outputType: "text",
          byteLength: bytes.byteLength,
          text: new TextDecoder().decode(bytes),
        };
      case "blob":
        return {
          outputType: "blob",
          byteLength: bytes.byteLength,
          blob: new Blob([bytes]),
        };
      case "download":
        return {
          outputType: "download",
          byteLength: bytes.byteLength,
          fileName: this.fileName,
        };
      case "stream":
        return { outputType: "stream", byteLength: bytes.byteLength };
    }
  }
}

class LoopbackTransport implements CsvExportWorkerTransport {
  readonly posted: CsvWorkerRequest[] = [];
  terminateCount = 0;
  private responseHandler: ((message: unknown) => void) | null = null;
  private readonly runtime = new CsvExportWorkerRuntime((response) => {
    this.responseHandler?.(response);
  });

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

  subscribeError(_handler: (error: unknown) => void): () => void {
    return () => undefined;
  }

  terminate(): void {
    this.terminateCount++;
    this.responseHandler = null;
  }
}

class FailOnChunkTransport implements CsvExportWorkerTransport {
  readonly posted: CsvWorkerRequest[] = [];
  terminateCount = 0;
  private responseHandler: ((message: unknown) => void) | null = null;
  private errorHandler: ((error: unknown) => void) | null = null;

  post(message: CsvWorkerRequest): void {
    this.posted.push(message);
    if (message.kind === "csv:start") {
      this.responseHandler?.({ kind: "csv:ready", taskId: message.taskId });
    } else if (message.kind === "csv:chunk") {
      this.errorHandler?.(new Error("worker transport failed"));
    }
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
}

interface ControllerHarnessOptions {
  config?: boolean | CsvExportDefaults;
  snapshot?: CsvExportSnapshot;
  owner?: CsvExportWorkerClientOwner;
  threshold?: number;
  sinkOptions?: RecordingSinkOptions;
  observers?: {
    onProgress?: (progress: CsvExportProgress) => void;
    onCompleted?: (result: CsvExportResult) => void;
    onCancelled?: (event: { taskId: number }) => void;
    onError?: (event: { taskId: number; error: unknown }) => void;
  };
}

interface ControllerHarness {
  readonly backend: ManualSchedulerBackend;
  readonly controller: CsvExportController;
  readonly owner: CsvExportWorkerClientOwner;
  readonly sinks: RecordingSink[];
  readonly sinkCalls: Array<{
    target: CsvOutputTarget;
    options: { maxOutputBytes: number; fileName: string };
  }>;
  readonly captureSnapshot: Mock<[], CsvExportSnapshot>;
  now: number;
}

function defaultSnapshot(rows: readonly RowData[] = [{ id: "a", value: "A" }]): CsvExportSnapshot {
  return makeSnapshot({
    sourceRows: rows,
    visibleColumns: [{ field: "value", headerName: "Value" }],
    allLeafColumns: [{ field: "value", headerName: "Value" }],
  });
}

function createHarness(options: ControllerHarnessOptions = {}): ControllerHarness {
  const backend = manualSchedulerBackend();
  const snapshot = options.snapshot ?? defaultSnapshot();
  const captureSnapshot = vi.fn(() => snapshot);
  const owner = options.owner ?? new CsvExportWorkerClientOwner(() => {
    throw new Error("Worker should not be created");
  });
  const sinks: RecordingSink[] = [];
  const sinkCalls: ControllerHarness["sinkCalls"] = [];
  let currentNow = 10;
  const controller = new CsvExportController({
    getConfig: () => options.config,
    captureSnapshot,
    scheduler: new CooperativeScheduler(backend),
    workerClientOwner: owner,
    getSelectedCellThreshold: () => options.threshold ?? Number.MAX_SAFE_INTEGER,
    now: () => currentNow,
    createOutputSink: (target, sinkOptions) => {
      sinkCalls.push({ target, options: { ...sinkOptions } });
      const sink = new RecordingSink(target, sinkOptions.fileName, options.sinkOptions);
      sinks.push(sink);
      return sink;
    },
    ...options.observers,
  });
  return {
    backend,
    controller,
    owner,
    sinks,
    sinkCalls,
    captureSnapshot,
    get now() {
      return currentNow;
    },
    set now(value: number) {
      currentNow = value;
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function drain(harness: ControllerHarness): Promise<void> {
  for (let i = 0; i < 100; i++) {
    harness.backend.flushAll();
    await flushMicrotasks();
    if (harness.backend.pendingCount() === 0) return;
  }
  throw new Error("controller did not quiesce");
}

describe("CsvExportController - scheduled bootstrap and configuration", () => {
  it("performs only bounded validation and scheduling on the API caller stack", async () => {
    const progress = vi.fn();
    const processCell = vi.fn(() => "projected");
    const harness = createHarness({ observers: { onProgress: progress } });

    const task = harness.controller.exportDataAsCsv({ processCell });
    void task.promise.catch(() => undefined);

    expect(harness.captureSnapshot).not.toHaveBeenCalled();
    expect(harness.sinks).toEqual([]);
    expect(processCell).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(harness.owner.getWorkerClientIfCreated()).toBeNull();
    expect(harness.backend.options).toEqual([{ priority: "user-visible" }]);

    expect(harness.backend.flushOne()).toBe(true);
    expect(harness.captureSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.sinks).toHaveLength(1);
    expect(progress).toHaveBeenCalledWith({
      taskId: task.id,
      phase: "planning",
      processedRows: 0,
      totalRows: 0,
      emittedBytes: 0,
    });
    expect(processCell).not.toHaveBeenCalled();

    await drain(harness);
    await expect(task.promise).resolves.toMatchObject({ outputType: "download" });
    expect(processCell).toHaveBeenCalledTimes(1);
  });

  it("merges JSON defaults with replacing call scopes without mutating either input", async () => {
    const defaults: CsvExportDefaults = {
      fileName: "grid.csv",
      rows: { mode: "ids", ids: ["a"] },
      columns: { mode: "fields", fields: ["value"] },
      includeRowNumbers: { headerName: "Grid #", startAt: 4 },
      includeColumnHeaders: false,
      delimiter: ";",
      maxOutputBytes: 900,
    };
    const params = {
      rows: { mode: "all" } as const,
      columns: { mode: "visible" } as const,
      includeRowNumbers: { headerName: "Call #", startAt: 7 },
      delimiter: "|",
      output: { type: "text" } as const,
    };
    const defaultsBefore = structuredClone(defaults);
    const paramsBefore = structuredClone(params);
    const harness = createHarness({ config: defaults });

    const task = harness.controller.exportDataAsCsv(params);
    await drain(harness);
    const result = await task.promise;

    expect(result.text).toBe("7|A\r\n");
    expect(harness.sinkCalls[0]).toEqual({
      target: { type: "text" },
      options: { maxOutputBytes: 900, fileName: "grid.csv" },
    });
    expect(defaults).toEqual(defaultsBefore);
    expect(params).toEqual(paramsBefore);
  });

  it("keeps invalid bounded option failures synchronous", () => {
    const harness = createHarness();

    expect(() =>
      harness.controller.exportDataAsCsv({ delimiter: "::" }),
    ).toThrow(CsvExportInvalidOptionsError);
    expect(harness.backend.pendingCount()).toBe(0);
    expect(harness.captureSnapshot).not.toHaveBeenCalled();
  });

  it("applies the absolute grid disable gate and pre-aborted cancellation without work", async () => {
    const disabled = createHarness({ config: false });
    const disabledTask = disabled.controller.exportDataAsCsv({ enabled: true });
    const disabledOutcome = disabledTask.promise.catch((error: unknown) => error);
    expect(disabled.captureSnapshot).not.toHaveBeenCalled();
    expect(disabled.sinks).toEqual([]);

    const abort = new AbortController();
    const reason = new Error("already aborted");
    abort.abort(reason);
    const cancelled = createHarness();
    const cancelledTask = cancelled.controller.exportDataAsCsv({ signal: abort.signal });
    const cancelledOutcome = cancelledTask.promise.catch((error: unknown) => error);
    expect(cancelled.captureSnapshot).not.toHaveBeenCalled();
    expect(cancelled.sinks).toEqual([]);

    await flushMicrotasks();
    expect(await disabledOutcome).toBeInstanceOf(CsvExportDisabledError);
    const cancellation = await cancelledOutcome;
    expect(cancellation).toBeInstanceOf(CsvExportCancelledError);
    expect(cancellation).toMatchObject({ cause: reason });
    expect(disabled.owner.getWorkerClientIfCreated()).toBeNull();
    expect(cancelled.owner.getWorkerClientIfCreated()).toBeNull();

    const requestDisabled = createHarness({ config: true });
    const requestDisabledTask = requestDisabled.controller.exportDataAsCsv({
      enabled: false,
    });
    const requestDisabledOutcome = requestDisabledTask.promise.catch(
      (error: unknown) => error,
    );
    await flushMicrotasks();
    expect(await requestDisabledOutcome).toBeInstanceOf(CsvExportDisabledError);
    expect(requestDisabled.captureSnapshot).not.toHaveBeenCalled();
  });

  it("defaults to download while getDataAsCsv forces the text engine", async () => {
    const downloadHarness = createHarness();
    const download = downloadHarness.controller.exportDataAsCsv();
    await drain(downloadHarness);
    await expect(download.promise).resolves.toMatchObject({
      outputType: "download",
      fileName: "export.csv",
    });
    expect(downloadHarness.sinkCalls[0]?.target).toEqual({ type: "download" });

    const textHarness = createHarness();
    const text = textHarness.controller.getDataAsCsv({ includeColumnHeaders: false });
    await drain(textHarness);
    await expect(text).resolves.toBe("A\r\n");
    expect(textHarness.sinkCalls[0]?.target).toEqual({ type: "text" });
  });
});

describe("CsvExportController - result and terminal ownership", () => {
  it.each(["text", "blob", "download", "stream"] as const)(
    "maps the %s sink-owned result",
    async (type) => {
      const harness = createHarness();
      const output: CsvOutputTarget =
        type === "stream"
          ? { type, writable: new WritableStream<Uint8Array>() }
          : { type };

      const task = harness.controller.exportDataAsCsv({ output });
      harness.now = 25;
      await drain(harness);
      const result = await task.promise;

      expect(result).toMatchObject({
        taskId: task.id,
        outputType: type,
        rowCount: 1,
        columnCount: 1,
        durationMs: 0,
      });
      if (type === "text") expect(result.text).toBe("Value\r\nA\r\n");
      if (type === "blob") expect(result.blob).toBeInstanceOf(Blob);
      if (type === "download") expect(result.fileName).toBe("export.csv");
    },
  );

  it("cancels scheduled work idempotently through task and AbortSignal", async () => {
    const cancelled = vi.fn();
    const harness = createHarness({ observers: { onCancelled: cancelled } });
    const task = harness.controller.exportDataAsCsv();
    const outcome = task.promise.catch((error: unknown) => error);
    task.cancel();
    task.cancel();
    harness.backend.flushAll();
    await flushMicrotasks();

    expect(await outcome).toBeInstanceOf(CsvExportCancelledError);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(harness.captureSnapshot).not.toHaveBeenCalled();

    const abort = new AbortController();
    const signalled = createHarness();
    const signalTask = signalled.controller.exportDataAsCsv({ signal: abort.signal });
    const signalOutcome = signalTask.promise.catch((error: unknown) => error);
    abort.abort("signal reason");
    signalled.backend.flushAll();
    await flushMicrotasks();

    expect(await signalOutcome).toMatchObject({
      code: "csv-export/cancelled",
      cause: "signal reason",
    });
    expect(signalled.captureSnapshot).not.toHaveBeenCalled();
  });

  it("cancels a replacement before capturing its snapshot and makes stale handles inert", async () => {
    const order: string[] = [];
    const harness = createHarness({
      observers: {
        onCancelled: ({ taskId }) => order.push(`cancel:${taskId}`),
      },
    });
    harness.captureSnapshot.mockImplementation(() => {
      order.push("capture");
      return defaultSnapshot();
    });
    const first = harness.controller.exportDataAsCsv();
    const firstOutcome = first.promise.catch((error: unknown) => error);
    const second = harness.controller.exportDataAsCsv({ output: { type: "text" } });
    first.cancel();

    expect(first.id).toBe(0);
    expect(second.id).toBe(1);
    expect(order).toEqual([]);
    await flushMicrotasks();
    expect(order).toEqual(["cancel:0"]);
    harness.backend.flushOne();
    expect(order).toEqual(["cancel:0", "capture"]);
    await drain(harness);

    expect(await firstOutcome).toBeInstanceOf(CsvExportCancelledError);
    await expect(second.promise).resolves.toMatchObject({ taskId: 1 });
  });

  it("suppresses a late close completion after replacement", async () => {
    let resolveClose!: (result: CsvSinkResult) => void;
    const closePromise = new Promise<CsvSinkResult>((resolve) => {
      resolveClose = resolve;
    });
    const completed = vi.fn();
    const harness = createHarness({
      sinkOptions: { close: () => closePromise },
      observers: { onCompleted: completed },
    });
    const first = harness.controller.exportDataAsCsv({ output: { type: "text" } });
    const firstOutcome = first.promise.catch((error: unknown) => error);
    harness.backend.flushAll();
    expect(harness.sinks[0]?.closeCount).toBe(1);

    const second = harness.controller.exportDataAsCsv({ output: { type: "text" } });
    const secondOutcome = second.promise.catch((error: unknown) => error);
    expect(harness.sinks[0]?.abortReasons).toHaveLength(1);
    resolveClose({ outputType: "text", byteLength: 1, text: "late" });
    await flushMicrotasks();
    first.cancel();
    harness.controller.destroy();
    await flushMicrotasks();

    expect(await firstOutcome).toBeInstanceOf(CsvExportCancelledError);
    expect(await secondOutcome).toBeInstanceOf(CsvExportCancelledError);
    expect(completed).not.toHaveBeenCalled();
  });

  it("prevents Worker close when first finalizing progress cancels the task", async () => {
    const taskRef: {
      current: ReturnType<CsvExportController["exportDataAsCsv"]> | null;
    } = { current: null };
    const completed = vi.fn();
    const harness = createHarness({
      owner: new CsvExportWorkerClientOwner(() => new LoopbackTransport()),
      threshold: 0,
      observers: { onCompleted: completed },
    });
    const task = harness.controller.exportDataAsCsv({
      output: { type: "text" },
      includeColumnHeaders: false,
      onProgress: (progress) => {
        if (progress.phase === "finalizing") taskRef.current?.cancel();
      },
    });
    taskRef.current = task;
    const outcome = task.promise.catch((error: unknown) => error);

    await drain(harness);

    expect(await outcome).toBeInstanceOf(CsvExportCancelledError);
    expect(harness.sinks[0]?.closeCount).toBe(0);
    expect(harness.sinks[0]?.abortReasons).toHaveLength(1);
    expect(completed).not.toHaveBeenCalled();
  });

  it("prevents old Worker close when first finalizing progress starts a replacement", async () => {
    let replacement: ReturnType<CsvExportController["exportDataAsCsv"]> | null = null;
    const harness = createHarness({
      owner: new CsvExportWorkerClientOwner(() => new LoopbackTransport()),
      threshold: 0,
    });
    const first = harness.controller.exportDataAsCsv({
      output: { type: "text" },
      includeColumnHeaders: false,
      onProgress: (progress) => {
        if (progress.phase === "finalizing" && replacement === null) {
          replacement = harness.controller.exportDataAsCsv({
            output: { type: "text" },
            includeColumnHeaders: false,
          });
        }
      },
    });
    const firstOutcome = first.promise.catch((error: unknown) => error);

    await drain(harness);

    expect(await firstOutcome).toBeInstanceOf(CsvExportCancelledError);
    expect(harness.sinks[0]?.closeCount).toBe(0);
    expect(harness.sinks[0]?.abortReasons).toHaveLength(1);
    expect(replacement).not.toBeNull();
    await expect(replacement!.promise).resolves.toMatchObject({ text: "A\r\n" });
    expect(harness.sinks[1]?.closeCount).toBe(1);
  });

  it.each([
    ["main", "task.cancel"],
    ["main", "AbortSignal"],
    ["main", "replacement"],
    ["main", "destroy"],
    ["worker", "task.cancel"],
    ["worker", "AbortSignal"],
    ["worker", "replacement"],
    ["worker", "destroy"],
  ] as const)(
    "keeps committed asynchronous %s close successful after %s",
    async (path, action) => {
      let resolveClose!: (result: CsvSinkResult) => void;
      const closePromise = new Promise<CsvSinkResult>((resolve) => {
        resolveClose = resolve;
      });
      const abort = new AbortController();
      const owner =
        path === "worker"
          ? new CsvExportWorkerClientOwner(() => new LoopbackTransport())
          : undefined;
      const harness = createHarness({
        owner,
        threshold: path === "worker" ? 0 : Number.MAX_SAFE_INTEGER,
        sinkOptions: { close: () => closePromise },
      });
      const task = harness.controller.exportDataAsCsv({
        output: { type: "text" },
        includeColumnHeaders: false,
        signal: abort.signal,
      });

      harness.backend.flushAll();
      expect(harness.sinks[0]?.closeCount).toBe(1);
      resolveClose({ outputType: "text", byteLength: 3, text: "A\r\n" });
      await flushMicrotasks();

      let replacement: ReturnType<CsvExportController["exportDataAsCsv"]> | null = null;
      switch (action) {
        case "task.cancel":
          task.cancel();
          break;
        case "AbortSignal":
          abort.abort("too late");
          break;
        case "replacement":
          replacement = harness.controller.exportDataAsCsv({
            output: { type: "text" },
            includeColumnHeaders: false,
          });
          break;
        case "destroy":
          harness.controller.destroy();
          break;
      }
      await drain(harness);

      await expect(task.promise).resolves.toMatchObject({
        outputType: "text",
        text: "A\r\n",
      });
      expect(harness.sinks[0]?.abortReasons).toEqual([]);
      if (replacement !== null) {
        await expect(replacement.promise).resolves.toMatchObject({ text: "A\r\n" });
      }
    },
  );

  it("contains observer exceptions and preserves exactly one successful terminal result", async () => {
    const completed = vi.fn(() => {
      throw new Error("observer complete");
    });
    const progress = vi.fn(() => {
      throw new Error("observer progress");
    });
    const harness = createHarness({
      observers: { onProgress: progress, onCompleted: completed },
    });
    const localProgress = vi.fn(() => {
      throw new Error("local progress");
    });

    const first = harness.controller.exportDataAsCsv({
      output: { type: "text" },
      onProgress: localProgress,
    });
    await drain(harness);
    await expect(first.promise).resolves.toMatchObject({ taskId: 0 });
    expect(completed).toHaveBeenCalledTimes(1);

    const second = harness.controller.exportDataAsCsv({ output: { type: "text" } });
    await drain(harness);
    await expect(second.promise).resolves.toMatchObject({ taskId: 1 });
    expect(completed).toHaveBeenCalledTimes(2);
  });

  it.each(["main", "worker"] as const)(
    "makes reentrant cancel from terminal %s progress inert after commit",
    async (path) => {
      const taskRef: {
        current: ReturnType<CsvExportController["exportDataAsCsv"]> | null;
      } = { current: null };
      let finalizingCount = 0;
      const owner =
        path === "worker"
          ? new CsvExportWorkerClientOwner(() => new LoopbackTransport())
          : undefined;
      const harness = createHarness({
        owner,
        threshold: path === "worker" ? 0 : Number.MAX_SAFE_INTEGER,
      });

      const task = harness.controller.exportDataAsCsv({
        output: { type: "text" },
        includeColumnHeaders: false,
        onProgress: (progress) => {
          if (progress.phase !== "finalizing") return;
          finalizingCount++;
          if (finalizingCount === 2) taskRef.current?.cancel();
        },
      });
      taskRef.current = task;

      await drain(harness);

      await expect(task.promise).resolves.toMatchObject({
        taskId: task.id,
        outputType: "text",
        text: "A\r\n",
      });
      expect(harness.sinks[0]?.abortReasons).toEqual([]);
    },
  );

  it.each(["main", "worker"] as const)(
    "lets terminal %s progress start a replacement without cancelling the old task",
    async (path) => {
      let second: ReturnType<CsvExportController["exportDataAsCsv"]> | null = null;
      let finalizingCount = 0;
      const owner =
        path === "worker"
          ? new CsvExportWorkerClientOwner(() => new LoopbackTransport())
          : undefined;
      const harness = createHarness({
        owner,
        threshold: path === "worker" ? 0 : Number.MAX_SAFE_INTEGER,
      });

      const first = harness.controller.exportDataAsCsv({
        output: { type: "text" },
        includeColumnHeaders: false,
        onProgress: (progress) => {
          if (progress.phase !== "finalizing") return;
          finalizingCount++;
          if (finalizingCount === 2) {
            second = harness.controller.exportDataAsCsv({
              output: { type: "text" },
              includeColumnHeaders: false,
            });
          }
        },
      });

      await drain(harness);

      await expect(first.promise).resolves.toMatchObject({
        taskId: first.id,
        text: "A\r\n",
      });
      expect(second).not.toBeNull();
      await expect(second!.promise).resolves.toMatchObject({
        taskId: second!.id,
        text: "A\r\n",
      });
      expect(harness.sinks[0]?.abortReasons).toEqual([]);
    },
  );

  it("preserves a projection callback error when the error observer throws", async () => {
    const primary = new Error("process cell failed");
    const errorObserver = vi.fn((_event: { taskId: number; error: unknown }) => {
      throw new Error("observer failed");
    });
    const completed = vi.fn();
    const harness = createHarness({
      observers: { onError: errorObserver, onCompleted: completed },
    });
    const task = harness.controller.exportDataAsCsv({
      output: { type: "text" },
      processCell: () => {
        throw primary;
      },
    });

    await drain(harness);

    await expect(task.promise).rejects.toBe(primary);
    expect(errorObserver).toHaveBeenCalledTimes(1);
    expect(errorObserver.mock.calls[0]?.[0]).toMatchObject({
      taskId: task.id,
      error: primary,
    });
    expect(completed).not.toHaveBeenCalled();
  });

  it("destroys once, cancels active work, and destroys the reusable owner once", async () => {
    const transport = new LoopbackTransport();
    const owner = new CsvExportWorkerClientOwner(() => transport);
    const reusable = owner.getOrCreateWorkerClient();
    const harness = createHarness({ owner });
    const task = harness.controller.exportDataAsCsv();
    const outcome = task.promise.catch((error: unknown) => error);

    harness.controller.destroy();
    harness.controller.destroy();
    harness.backend.flushAll();
    await flushMicrotasks();

    expect(await outcome).toBeInstanceOf(CsvExportCancelledError);
    expect(owner.getWorkerClientIfCreated()).toBeNull();
    expect(transport.terminateCount).toBe(1);
    expect(reusable).toBeDefined();
    expect(harness.captureSnapshot).not.toHaveBeenCalled();
  });
});

describe("CsvExportController - snapshot capture and rejected request ownership", () => {
  it("captures the immutable snapshot before planning progress observers run", async () => {
    const snapshotA = defaultSnapshot([{ id: "a", value: "A" }]);
    const snapshotB = defaultSnapshot([{ id: "b", value: "B" }]);
    let currentSnapshot = snapshotA;
    const harness = createHarness({
      observers: {
        onProgress: (progress) => {
          if (progress.phase === "planning") currentSnapshot = snapshotB;
        },
      },
    });
    harness.captureSnapshot.mockImplementation(() => currentSnapshot);

    const task = harness.controller.exportDataAsCsv({
      output: { type: "text" },
      includeColumnHeaders: false,
    });
    await drain(harness);

    await expect(task.promise).resolves.toMatchObject({ text: "A\r\n" });
    expect(harness.captureSnapshot).toHaveBeenCalledTimes(1);
  });

  it("stops planning, sink creation, and operation start after planning cancellation", async () => {
    const taskRef: { current: ReturnType<CsvExportController["exportDataAsCsv"]> | null } = {
      current: null,
    };
    const harness = createHarness({
      observers: {
        onProgress: (progress) => {
          if (progress.phase === "planning") taskRef.current?.cancel();
        },
      },
    });

    const task = harness.controller.exportDataAsCsv({ output: { type: "text" } });
    taskRef.current = task;
    const outcome = task.promise.catch((error: unknown) => error);
    harness.backend.flushAll();
    await flushMicrotasks();

    expect(harness.captureSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.sinks).toEqual([]);
    expect(await outcome).toBeInstanceOf(CsvExportCancelledError);
  });

  it("does not let disabled or pre-aborted rejected requests replace an active task", async () => {
    let resolveClose!: (result: CsvSinkResult) => void;
    const closePromise = new Promise<CsvSinkResult>((resolve) => {
      resolveClose = resolve;
    });
    const harness = createHarness({
      sinkOptions: { close: () => closePromise },
    });
    const active = harness.controller.exportDataAsCsv({
      output: { type: "text" },
      includeColumnHeaders: false,
    });
    harness.backend.flushAll();
    expect(harness.sinks[0]?.closeCount).toBe(1);

    const disabled = harness.controller.exportDataAsCsv({
      enabled: false,
      output: { type: "text" },
    });
    const disabledOutcome = disabled.promise.catch((error: unknown) => error);
    const abort = new AbortController();
    abort.abort("pre-aborted");
    const preAborted = harness.controller.exportDataAsCsv({
      signal: abort.signal,
      output: { type: "text" },
    });
    const preAbortedOutcome = preAborted.promise.catch((error: unknown) => error);
    await flushMicrotasks();

    expect(await disabledOutcome).toBeInstanceOf(CsvExportDisabledError);
    expect(await preAbortedOutcome).toBeInstanceOf(CsvExportCancelledError);
    expect(harness.sinks[0]?.abortReasons).toEqual([]);

    resolveClose({ outputType: "text", byteLength: 3, text: "A\r\n" });
    await flushMicrotasks();
    await drain(harness);

    await expect(active.promise).resolves.toMatchObject({ text: "A\r\n" });
  });
});

describe("CsvExportController - operation integration", () => {
  it("reuses a healthy Worker owner across successful tasks", async () => {
    const transport = new LoopbackTransport();
    let factoryCalls = 0;
    const owner = new CsvExportWorkerClientOwner(() => {
      factoryCalls++;
      return transport;
    });
    const harness = createHarness({ owner, threshold: 0 });

    const first = harness.controller.exportDataAsCsv({ output: { type: "text" } });
    await drain(harness);
    await expect(first.promise).resolves.toMatchObject({ rowCount: 1 });
    const client = owner.getWorkerClientIfCreated();

    const second = harness.controller.exportDataAsCsv({ output: { type: "text" } });
    await drain(harness);
    await expect(second.promise).resolves.toMatchObject({ rowCount: 1 });

    expect(factoryCalls).toBe(1);
    expect(owner.getWorkerClientIfCreated()).toBe(client);
  });

  it("creates a fresh row plan and sink only for permitted Worker fallback", async () => {
    const rows: RowData[] = [{ id: "a", value: "A" }];
    let rowIdCalls = 0;
    const snapshot = makeSnapshot({
      sourceRows: rows,
      visibleColumns: [{ field: "value" }],
      allLeafColumns: [{ field: "value" }],
      selectedRowIds: membership(["a"]),
      rowIds: {
        getRowIdBySourceIndex(sourceIndex) {
          rowIdCalls++;
          return String(rows[sourceIndex]?.id);
        },
      },
    });
    const transport = new FailOnChunkTransport();
    const owner = new CsvExportWorkerClientOwner(() => transport);
    const harness = createHarness({ snapshot, owner, threshold: 0 });

    const task = harness.controller.exportDataAsCsv({
      output: { type: "text" },
      rows: { mode: "selected" },
      includeColumnHeaders: false,
    });
    await drain(harness);
    const result = await task.promise;

    expect(result.text).toBe("A\r\n");
    // Each execution resolves once in selected-row planning and once during
    // projection. Four calls therefore prove the fallback restarted at row 0.
    expect(rowIdCalls).toBe(4);
    expect(harness.sinks).toHaveLength(2);
    expect(harness.sinks[0]?.abortReasons).toHaveLength(1);
    expect(owner.getWorkerClientIfCreated()).toBeNull();
    expect(transport.terminateCount).toBe(1);
  });

  it("keeps controller dependencies free of renderer and unrelated feature imports", () => {
    const source = readFileSync(
      new URL("../CsvExportController.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(
      /from\s+["'][^"']*(?:renderer|DomGridRenderer|DomFeatureHost|quick-search|filters?|column-menu|headerMenu)/i,
    );
  });
});
