/** CSV Export V1 - Stage 4C Worker transport client tests. */

import { describe, expect, it, vi } from "vitest";

import { estimateCsvProjectedBytes } from "../../../../features/csv-export/estimateCsvProjectedBytes";
import type {
  CsvChunkRequest,
  CsvCompleteResponse,
  CsvEncodedChunkResponse,
  CsvWorkerProjectionValue,
  CsvWorkerRequest,
} from "../csvExportProtocol";
import {
  type CsvExportWorkerCallbacks,
  CsvExportWorkerClient,
  type CsvExportWorkerFailure,
  type CsvExportWorkerOutputType,
  type CsvExportWorkerTaskHandle,
  type CsvExportWorkerTransport,
} from "../csvExportWorkerClient";

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

interface PostedRequest {
  message: CsvWorkerRequest;
  transfer: Transferable[] | undefined;
}

class FakeTransport implements CsvExportWorkerTransport {
  readonly attempted: CsvWorkerRequest[] = [];
  readonly posted: PostedRequest[] = [];
  unsubscribeCount = 0;
  unsubscribeErrorCount = 0;
  terminateCount = 0;
  onPost: ((message: CsvWorkerRequest) => void) | null = null;
  throwOnPost: ((message: CsvWorkerRequest) => unknown) | null = null;
  private responseHandler: ((message: unknown) => void) | null = null;
  private errorHandler: ((error: unknown) => void) | null = null;

  post(message: CsvWorkerRequest, transfer?: Transferable[]): void {
    this.attempted.push(message);
    const error = this.throwOnPost?.(message);
    if (error !== null && error !== undefined) throw error;
    this.posted.push({ message, transfer });
    this.onPost?.(message);
  }

  subscribe(handler: (message: unknown) => void): () => void {
    this.responseHandler = handler;
    return () => {
      this.unsubscribeCount++;
      this.responseHandler = null;
    };
  }

  subscribeError(handler: (error: unknown) => void): () => void {
    this.errorHandler = handler;
    return () => {
      this.unsubscribeErrorCount++;
      this.errorHandler = null;
    };
  }

  terminate(): void {
    this.terminateCount++;
  }

  emit(message: unknown): void {
    this.responseHandler?.(message);
  }

  emitError(error: unknown): void {
    this.errorHandler?.(error);
  }
}

interface CallbackHarness {
  callbacks: CsvExportWorkerCallbacks;
  acceptedBytes: Uint8Array<ArrayBuffer>[];
  ready: ReturnType<typeof vi.fn>;
  chunks: Array<{
    sequence: number;
    rowCount: number;
    byteLength: number;
    final: boolean;
  }>;
  completions: CsvCompleteResponse[];
  failures: CsvExportWorkerFailure[];
  cancelled: ReturnType<typeof vi.fn>;
}

function callbackHarness(
  acceptBytes: (
    bytes: Uint8Array<ArrayBuffer>,
  ) => void | Promise<void> = () => undefined,
): CallbackHarness {
  const acceptedBytes: Uint8Array<ArrayBuffer>[] = [];
  const ready = vi.fn();
  const chunks: CallbackHarness["chunks"] = [];
  const completions: CsvCompleteResponse[] = [];
  const failures: CsvExportWorkerFailure[] = [];
  const cancelled = vi.fn();
  return {
    callbacks: {
      acceptBytes: (bytes) => {
        acceptedBytes.push(bytes);
        return acceptBytes(bytes);
      },
      onReady: ready,
      onChunkAccepted: (result) => chunks.push(result),
      onComplete: (result) => completions.push(result),
      onFailure: (failure) => failures.push(failure),
      onCancelled: cancelled,
    },
    acceptedBytes,
    ready,
    chunks,
    completions,
    failures,
    cancelled,
  };
}

const ENCODING = {
  delimiter: ",",
  quoteMode: "minimal" as const,
  lineEnding: "\n" as const,
  utf8Bom: false,
  formulaProtection: "escape" as const,
};

function start(
  client: CsvExportWorkerClient,
  taskId: number,
  harness: CallbackHarness,
  outputType: CsvExportWorkerOutputType = "text",
) {
  return client.start({
    taskId,
    plannedColumnCount: 2,
    encoding: ENCODING,
    outputType,
    callbacks: harness.callbacks,
  });
}

function rowEnds(values: readonly number[]): Uint32Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(values.length * Uint32Array.BYTES_PER_ELEMENT);
  const result: Uint32Array<ArrayBuffer> = new Uint32Array(buffer);
  for (let i = 0; i < values.length; i++) result[i] = values[i]!;
  return result;
}

function chunk(
  taskId: number,
  sequence: number,
  values: CsvWorkerProjectionValue[],
  ends: readonly number[],
  final: boolean,
): CsvChunkRequest {
  let estimatedBytes = 0;
  for (const value of values) {
    estimatedBytes += estimateCsvProjectedBytes(value);
  }
  return {
    kind: "csv:chunk",
    taskId,
    sequence,
    values,
    rowEnds: rowEnds(ends),
    estimatedBytes,
    final,
  };
}

function bytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function encoded(
  taskId: number,
  sequence: number,
  value: Uint8Array<ArrayBuffer>,
  rowCount: number,
  final: boolean,
): CsvEncodedChunkResponse {
  return {
    kind: "csv:encodedChunk",
    taskId,
    sequence,
    bytes: value,
    rowCount,
    final,
  };
}

function complete(
  taskId: number,
  rowCount: number,
  byteLength: number,
): CsvCompleteResponse {
  return { kind: "csv:complete", taskId, rowCount, byteLength };
}

describe("csvExportWorkerClient - readiness and one-chunk backpressure", () => {
  it("stores active state before synchronous ready and response delivery", () => {
    const transport = new FakeTransport();
    const harness = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    transport.onPost = (message) => {
      if (message.kind === "csv:start") {
        transport.emit({ kind: "csv:ready", taskId: message.taskId });
      } else if (message.kind === "csv:chunk") {
        const output = bytes("a\n");
        transport.emit(encoded(message.taskId, message.sequence, output, 1, true));
        transport.emit(complete(message.taskId, 1, output.byteLength));
      }
    };

    const handle = start(client, 1, harness);
    expect(harness.ready).toHaveBeenCalledTimes(1);
    expect(handle.postChunk(chunk(1, 0, ["a"], [1], true))).toBe(true);
    expect(harness.chunks).toEqual([
      { sequence: 0, rowCount: 1, byteLength: 2, final: true },
    ]);
    expect(harness.completions).toEqual([complete(1, 1, 2)]);
    expect(harness.failures).toEqual([]);
  });

  it("allows exactly one in-flight chunk through asynchronous byte acceptance", async () => {
    const gate = deferred<void>();
    const transport = new FakeTransport();
    const harness = callbackHarness(() => gate.promise);
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 1, harness);
    const first = chunk(1, 0, ["a"], [1], false);
    const second = chunk(1, 1, ["b"], [1], false);

    expect(handle.postChunk(first)).toBe(false);
    transport.emit({ kind: "csv:ready", taskId: 1 });
    expect(handle.postChunk(first)).toBe(true);
    expect(handle.postChunk(second)).toBe(false);
    transport.emit(encoded(1, 0, bytes("a\n"), 1, false));
    expect(handle.postChunk(second)).toBe(false);

    gate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.chunks).toHaveLength(1);
    expect(handle.postChunk(second)).toBe(true);
  });

  it("accepts encoded bytes exactly once and treats a duplicate response as terminal", async () => {
    const gate = deferred<void>();
    const transport = new FakeTransport();
    const harness = callbackHarness(() => gate.promise);
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 1, harness);
    transport.emit({ kind: "csv:ready", taskId: 1 });
    handle.postChunk(chunk(1, 0, ["a"], [1], false));
    const response = encoded(1, 0, bytes("a\n"), 1, false);

    transport.emit(response);
    transport.emit(response);

    expect(harness.acceptedBytes).toHaveLength(1);
    expect(harness.failures).toHaveLength(1);
    expect(harness.failures[0]?.kind).toBe("protocol");
    gate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.chunks).toEqual([]);
    expect(harness.failures).toHaveLength(1);
  });

  it("transfers rowEnds by identity while retaining values ownership", () => {
    const transport = new FakeTransport();
    const harness = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 7, harness);
    transport.emit({ kind: "csv:ready", taskId: 7 });
    const message = chunk(7, 0, ["owned", 42], [2], false);
    const originalValues = message.values;
    const originalRowEndsBuffer = message.rowEnds.buffer;

    expect(handle.postChunk(message)).toBe(true);
    const posted = transport.posted[1]!;
    expect(posted.message).toBe(message);
    expect(message.values).toBe(originalValues);
    expect(posted.transfer).toEqual([originalRowEndsBuffer]);
    expect(posted.transfer?.[0]).toBe(originalRowEndsBuffer);
    expect(posted.transfer).not.toContain(message.values);
  });

  it("defers completion until final asynchronous byte acceptance", async () => {
    const gate = deferred<void>();
    const transport = new FakeTransport();
    const harness = callbackHarness(() => gate.promise);
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 1, harness);
    transport.emit({ kind: "csv:ready", taskId: 1 });
    expect(handle.postChunk(chunk(1, 0, ["a"], [1], true))).toBe(true);
    const output = bytes("a\n");
    transport.emit(encoded(1, 0, output, 1, true));
    transport.emit(complete(1, 1, output.byteLength));

    expect(harness.completions).toEqual([]);
    expect(harness.chunks).toEqual([]);
    gate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.chunks).toHaveLength(1);
    expect(harness.completions).toEqual([complete(1, 1, 2)]);
  });
});

describe("csvExportWorkerClient - cancellation and replacement", () => {
  it("cancels locally before ready and ignores every late response", () => {
    const transport = new FakeTransport();
    const harness = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 1, harness);

    handle.cancel();
    handle.cancel();
    transport.emit({ kind: "csv:ready", taskId: 1 });
    transport.emit(encoded(1, 0, bytes("late"), 1, true));
    transport.emit(complete(1, 1, 4));

    expect(harness.cancelled).toHaveBeenCalledTimes(1);
    expect(harness.ready).not.toHaveBeenCalled();
    expect(harness.acceptedBytes).toEqual([]);
    expect(harness.completions).toEqual([]);
    expect(harness.failures).toEqual([]);
  });

  it("cancels an in-flight chunk before its encoded response", () => {
    const transport = new FakeTransport();
    const harness = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 1, harness);
    transport.emit({ kind: "csv:ready", taskId: 1 });
    expect(handle.postChunk(chunk(1, 0, ["a"], [1], false))).toBe(true);

    handle.cancel();
    transport.emit(encoded(1, 0, bytes("a\n"), 1, false));

    expect(harness.cancelled).toHaveBeenCalledTimes(1);
    expect(harness.acceptedBytes).toEqual([]);
    expect(harness.chunks).toEqual([]);
  });

  it("observes pending byte settlement after cancel without later callbacks", async () => {
    const gate = deferred<void>();
    const transport = new FakeTransport();
    const harness = callbackHarness(() => gate.promise);
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 1, harness);
    transport.emit({ kind: "csv:ready", taskId: 1 });
    handle.postChunk(chunk(1, 0, ["a"], [1], false));
    transport.emit(encoded(1, 0, bytes("a\n"), 1, false));

    handle.cancel();
    gate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.cancelled).toHaveBeenCalledTimes(1);
    expect(harness.chunks).toEqual([]);
    expect(harness.completions).toEqual([]);
    expect(harness.failures).toEqual([]);
  });

  it("cancels while final completion waits for byte acceptance", async () => {
    const gate = deferred<void>();
    const transport = new FakeTransport();
    const harness = callbackHarness(() => gate.promise);
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 1, harness);
    transport.emit({ kind: "csv:ready", taskId: 1 });
    handle.postChunk(chunk(1, 0, ["a"], [1], true));
    transport.emit(encoded(1, 0, bytes("a\n"), 1, true));
    transport.emit(complete(1, 1, 2));

    handle.cancel();
    gate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.cancelled).toHaveBeenCalledTimes(1);
    expect(harness.chunks).toEqual([]);
    expect(harness.completions).toEqual([]);
    expect(harness.failures).toEqual([]);
  });

  it("uses logical handle tokens across replacement tasks", () => {
    const transport = new FakeTransport();
    const first = callbackHarness();
    const second = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    const oldHandle = start(client, 1, first);
    const currentHandle = start(client, 2, second);
    transport.emit({ kind: "csv:ready", taskId: 1 });
    transport.emit({ kind: "csv:ready", taskId: 2 });

    oldHandle.cancel();
    expect(oldHandle.postChunk(chunk(1, 0, ["old"], [1], true))).toBe(false);
    expect(currentHandle.postChunk(chunk(2, 0, ["new"], [1], false))).toBe(
      true,
    );

    expect(first.cancelled).toHaveBeenCalledTimes(1);
    expect(second.cancelled).not.toHaveBeenCalled();
    expect(second.ready).toHaveBeenCalledTimes(1);
  });
});

describe("csvExportWorkerClient - reentrant starts and task identity", () => {
  it("lets a cancellation callback's newer start win over the outer replacement", () => {
    const transport = new FakeTransport();
    const first = callbackHarness();
    const second = callbackHarness();
    const third = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    const thirdOwner: { handle: CsvExportWorkerTaskHandle | null } = {
      handle: null,
    };
    first.callbacks.onCancelled = () => {
      first.cancelled();
      thirdOwner.handle = start(client, 3, third);
    };
    start(client, 1, first);

    const outerHandle = start(client, 2, second);

    expect(
      transport.attempted
        .filter((message) => message.kind === "csv:start")
        .map((message) => message.taskId),
    ).toEqual([1, 3]);
    expect(
      transport.attempted
        .filter((message) => message.kind === "csv:cancel")
        .map((message) => message.taskId),
    ).toEqual([1]);
    expect(second.cancelled).toHaveBeenCalledTimes(1);
    expect(outerHandle.postChunk(chunk(2, 0, ["stale"], [1], true))).toBe(
      false,
    );
    outerHandle.cancel();

    transport.emit({ kind: "csv:ready", taskId: 1 });
    transport.emit({ kind: "csv:ready", taskId: 2 });
    transport.emit(encoded(1, 0, bytes("old"), 1, true));
    transport.emit(complete(2, 0, 0));
    expect(third.ready).not.toHaveBeenCalled();

    transport.emit({ kind: "csv:ready", taskId: 3 });
    expect(third.ready).toHaveBeenCalledTimes(1);
    expect(thirdOwner.handle).not.toBeNull();
    expect(
      thirdOwner.handle?.postChunk(chunk(3, 0, ["current"], [1], false)),
    ).toBe(true);
    expect(third.failures).toEqual([]);
    expect(third.cancelled).not.toHaveBeenCalled();
  });

  it("does not resurrect the outer start when the newer task settles synchronously", () => {
    const transport = new FakeTransport();
    const first = callbackHarness();
    const second = callbackHarness();
    const third = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    transport.onPost = (message) => {
      if (message.kind === "csv:start" && message.taskId === 3) {
        transport.emit({ kind: "csv:cancelled", taskId: 3 });
      }
    };
    first.callbacks.onCancelled = () => {
      first.cancelled();
      start(client, 3, third);
    };
    start(client, 1, first);

    const outerHandle = start(client, 2, second);

    expect(
      transport.attempted
        .filter((message) => message.kind === "csv:start")
        .map((message) => message.taskId),
    ).toEqual([1, 3]);
    expect(third.cancelled).toHaveBeenCalledTimes(1);
    expect(second.cancelled).toHaveBeenCalledTimes(1);
    expect(outerHandle.postChunk(chunk(2, 0, ["never"], [1], true))).toBe(
      false,
    );
    transport.emit({ kind: "csv:ready", taskId: 2 });
    expect(second.ready).not.toHaveBeenCalled();
  });

  it("rejects invalid, reused, and lower task ids without cancelling current work", () => {
    const transport = new FakeTransport();
    const current = callbackHarness();
    const reused = callbackHarness();
    const lower = callbackHarness();
    const invalid = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    const currentHandle = start(client, 10, current);
    const attemptedBefore = transport.attempted.length;

    const reusedHandle = start(client, 10, reused);
    const lowerHandle = start(client, 9, lower);
    const invalidHandle = start(client, -1, invalid);

    expect(transport.attempted).toHaveLength(attemptedBefore);
    expect(current.cancelled).not.toHaveBeenCalled();
    for (const rejected of [reused, lower, invalid]) {
      expect(rejected.failures).toHaveLength(1);
      expect(rejected.failures[0]).toMatchObject({
        kind: "protocol",
        canRestartOnMain: true,
      });
    }
    expect(reusedHandle.postChunk(chunk(10, 0, ["x"], [1], true))).toBe(false);
    expect(lowerHandle.postChunk(chunk(9, 0, ["x"], [1], true))).toBe(false);
    invalidHandle.cancel();

    transport.emit({ kind: "csv:ready", taskId: 10 });
    expect(currentHandle.postChunk(chunk(10, 0, ["kept"], [1], false))).toBe(
      true,
    );
  });

  it("consumes a task id even when posting its start fails", () => {
    const transport = new FakeTransport();
    transport.throwOnPost = (message) =>
      message.kind === "csv:start" ? new Error("post failed") : null;
    const first = callbackHarness();
    const reused = callbackHarness();
    const client = new CsvExportWorkerClient(transport);

    start(client, 5, first);
    const attemptsAfterFailure = transport.attempted.length;
    start(client, 5, reused);

    expect(
      transport.attempted.filter((message) => message.kind === "csv:start"),
    ).toHaveLength(1);
    expect(transport.attempted).toHaveLength(attemptsAfterFailure);
    expect(first.failures[0]?.kind).toBe("worker");
    expect(reused.failures[0]?.kind).toBe("protocol");
  });

  it("admits MAX_SAFE_INTEGER once and rejects every later start", () => {
    const transport = new FakeTransport();
    const maximum = callbackHarness();
    const reused = callbackHarness();
    const lower = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    start(client, Number.MAX_SAFE_INTEGER, maximum);
    const attemptsAfterMaximum = transport.attempted.length;

    start(client, Number.MAX_SAFE_INTEGER, reused);
    start(client, Number.MAX_SAFE_INTEGER - 1, lower);

    expect(transport.attempted).toHaveLength(attemptsAfterMaximum);
    expect(maximum.cancelled).not.toHaveBeenCalled();
    expect(reused.failures[0]?.kind).toBe("protocol");
    expect(lower.failures[0]?.kind).toBe("protocol");
  });
});

describe("csvExportWorkerClient - failure policy and protocol terminals", () => {
  it("forbids stream fallback while byte acceptance is pending", async () => {
    const gate = deferred<void>();
    const transport = new FakeTransport();
    const harness = callbackHarness(() => gate.promise);
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 1, harness, "stream");
    transport.emit({ kind: "csv:ready", taskId: 1 });
    handle.postChunk(chunk(1, 0, ["a"], [1], false));
    transport.emit(encoded(1, 0, bytes("a\n"), 1, false));

    transport.emitError(new Error("worker failed during write"));

    expect(harness.failures[0]).toMatchObject({
      kind: "worker",
      canRestartOnMain: false,
    });
    gate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.failures).toHaveLength(1);
    expect(harness.chunks).toEqual([]);
  });

  it("forbids stream fallback on a protocol failure during acceptance", async () => {
    const gate = deferred<void>();
    const transport = new FakeTransport();
    const harness = callbackHarness(() => gate.promise);
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 1, harness, "stream");
    transport.emit({ kind: "csv:ready", taskId: 1 });
    handle.postChunk(chunk(1, 0, ["a"], [1], false));
    const response = encoded(1, 0, bytes("a\n"), 1, false);
    transport.emit(response);

    transport.emit(response);

    expect(harness.failures[0]).toMatchObject({
      kind: "protocol",
      canRestartOnMain: false,
    });
    gate.reject(new Error("late sink rejection"));
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.failures).toHaveLength(1);
    expect(harness.chunks).toEqual([]);
  });

  it("treats a reentrant transport error from acceptBytes as potentially visible", async () => {
    for (const settle of ["resolve", "reject"] as const) {
      const gate = deferred<void>();
      const transport = new FakeTransport();
      const harness = callbackHarness(() => {
        transport.emitError(new Error("reentrant worker failure"));
        return gate.promise;
      });
      const client = new CsvExportWorkerClient(transport);
      const handle = start(client, 1, harness, "stream");
      transport.emit({ kind: "csv:ready", taskId: 1 });
      handle.postChunk(chunk(1, 0, ["a"], [1], false));

      transport.emit(encoded(1, 0, bytes("a\n"), 1, false));

      expect(harness.failures[0]).toMatchObject({
        kind: "worker",
        canRestartOnMain: false,
      });
      if (settle === "resolve") {
        gate.resolve(undefined);
      } else {
        gate.reject(new Error("late rejection"));
      }
      await Promise.resolve();
      await Promise.resolve();
      expect(harness.failures).toHaveLength(1);
      expect(harness.chunks).toEqual([]);
      expect(harness.completions).toEqual([]);
    }
  });

  it("keeps a stream restartable before acceptBytes is invoked", () => {
    const transport = new FakeTransport();
    const harness = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 1, harness, "stream");
    transport.emit({ kind: "csv:ready", taskId: 1 });
    handle.postChunk(chunk(1, 0, ["a"], [1], false));

    transport.emitError(new Error("worker failed before encoded bytes"));

    expect(harness.acceptedBytes).toEqual([]);
    expect(harness.failures[0]).toMatchObject({
      kind: "worker",
      canRestartOnMain: true,
    });
  });

  it("keeps buffered output restartable while acceptance is pending", async () => {
    const gate = deferred<void>();
    const transport = new FakeTransport();
    const harness = callbackHarness(() => gate.promise);
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 1, harness, "blob");
    transport.emit({ kind: "csv:ready", taskId: 1 });
    handle.postChunk(chunk(1, 0, ["a"], [1], false));
    transport.emit(encoded(1, 0, bytes("a\n"), 1, false));

    transport.emitError(new Error("worker failed during buffered write"));

    expect(harness.failures[0]).toMatchObject({
      kind: "worker",
      canRestartOnMain: true,
    });
    gate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.failures).toHaveLength(1);
  });

  it("turns a synchronous start-post failure into one Worker terminal", () => {
    const transport = new FakeTransport();
    transport.throwOnPost = (message) =>
      message.kind === "csv:start" ? new Error("start post failed") : null;
    const harness = callbackHarness();
    const client = new CsvExportWorkerClient(transport);

    start(client, 1, harness);

    expect(harness.failures).toHaveLength(1);
    expect(harness.failures[0]).toMatchObject({
      kind: "worker",
      canRestartOnMain: true,
    });
    expect(harness.failures[0]?.error.message).toBe("start post failed");
  });

  it("allows main fallback for Worker failure before visible stream output", () => {
    const transport = new FakeTransport();
    const harness = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    start(client, 1, harness, "stream");

    transport.emitError(new Error("worker crashed"));

    expect(harness.failures).toHaveLength(1);
    expect(harness.failures[0]).toMatchObject({
      kind: "worker",
      canRestartOnMain: true,
    });
  });

  it("forbids stream fallback after an accepted byte write", () => {
    const transport = new FakeTransport();
    const harness = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    const handle = start(client, 1, harness, "stream");
    transport.emit({ kind: "csv:ready", taskId: 1 });
    handle.postChunk(chunk(1, 0, ["a"], [1], false));
    transport.emit(encoded(1, 0, bytes("a\n"), 1, false));

    transport.emit({
      kind: "csv:error",
      taskId: 1,
      code: "csv-worker/encoding-failed",
      message: "failed",
    });

    expect(harness.failures).toHaveLength(1);
    expect(harness.failures[0]).toMatchObject({
      kind: "worker",
      canRestartOnMain: false,
    });
  });

  it("allows buffered outputs to restart after accepted bytes", () => {
    for (const outputType of ["text", "blob", "download"] as const) {
      const transport = new FakeTransport();
      const harness = callbackHarness();
      const client = new CsvExportWorkerClient(transport);
      const handle = start(client, 1, harness, outputType);
      transport.emit({ kind: "csv:ready", taskId: 1 });
      handle.postChunk(chunk(1, 0, ["a"], [1], false));
      transport.emit(encoded(1, 0, bytes("a\n"), 1, false));
      transport.emit({ kind: "csv:ready", taskId: 1 });

      expect(harness.failures[0]).toMatchObject({
        kind: "protocol",
        canRestartOnMain: true,
      });
    }
  });

  it("treats sink throws and rejections as non-restartable terminal failures", async () => {
    const thrown = new Error("sink throw");
    const throwTransport = new FakeTransport();
    const throwHarness = callbackHarness(() => {
      throw thrown;
    });
    const throwClient = new CsvExportWorkerClient(throwTransport);
    const throwHandle = start(throwClient, 1, throwHarness);
    throwTransport.emit({ kind: "csv:ready", taskId: 1 });
    throwHandle.postChunk(chunk(1, 0, ["a"], [1], false));
    throwTransport.emit(encoded(1, 0, bytes("a\n"), 1, false));
    expect(throwHarness.failures[0]).toMatchObject({
      error: thrown,
      kind: "sink",
      canRestartOnMain: false,
    });

    const rejected = new Error("sink reject");
    const rejectTransport = new FakeTransport();
    const rejectHarness = callbackHarness(() => Promise.reject(rejected));
    const rejectClient = new CsvExportWorkerClient(rejectTransport);
    const rejectHandle = start(rejectClient, 2, rejectHarness);
    rejectTransport.emit({ kind: "csv:ready", taskId: 2 });
    rejectHandle.postChunk(chunk(2, 0, ["b"], [1], false));
    rejectTransport.emit(encoded(2, 0, bytes("b\n"), 1, false));
    await Promise.resolve();
    await Promise.resolve();
    expect(rejectHarness.failures[0]).toMatchObject({
      error: rejected,
      kind: "sink",
      canRestartOnMain: false,
    });
  });

  it("fails malformed, duplicate, premature-complete, and total-mismatch responses once", () => {
    const cases: Array<(transport: FakeTransport) => void> = [
      (transport) =>
        transport.emit({
          kind: "csv:encodedChunk",
          taskId: 1,
          sequence: 0,
          bytes: [1, 2],
          rowCount: 1,
          final: false,
        }),
      (transport) => {
        transport.emit({ kind: "csv:ready", taskId: 1 });
        transport.emit({ kind: "csv:ready", taskId: 1 });
      },
      (transport) => transport.emit(complete(1, 0, 0)),
      (transport) => {
        transport.emit({ kind: "csv:ready", taskId: 1 });
        const output = bytes("a\n");
        transport.onPost = (message) => {
          if (message.kind !== "csv:chunk") return;
          transport.emit(encoded(1, 0, output, 1, true));
          transport.emit(complete(1, 99, output.byteLength));
        };
      },
    ];

    for (const run of cases) {
      const transport = new FakeTransport();
      const harness = callbackHarness();
      const client = new CsvExportWorkerClient(transport);
      const handle = start(client, 1, harness);
      run(transport);
      if (transport.onPost !== null) {
        handle.postChunk(chunk(1, 0, ["a"], [1], true));
      }
      expect(harness.failures).toHaveLength(1);
      expect(harness.failures[0]?.kind).toBe("protocol");
      expect(harness.completions).toEqual([]);
      transport.emit({ kind: "csv:ready", taskId: 1 });
      expect(harness.failures).toHaveLength(1);
    }
  });

  it("ignores stale task responses without touching the replacement", () => {
    const transport = new FakeTransport();
    const first = callbackHarness();
    const second = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    start(client, 1, first);
    start(client, 2, second);

    transport.emit({ kind: "csv:ready", taskId: 1 });
    transport.emit(encoded(1, 0, bytes("stale"), 1, true));
    transport.emit(complete(1, 1, 5));
    transport.emit({
      kind: "csv:error",
      taskId: 1,
      code: "csv-worker/encoding-failed",
      message: "stale",
    });
    transport.emit({ kind: "csv:cancelled", taskId: 1 });

    expect(second.ready).not.toHaveBeenCalled();
    expect(second.acceptedBytes).toEqual([]);
    expect(second.failures).toEqual([]);
    expect(second.cancelled).not.toHaveBeenCalled();
  });

  it("suppresses cancel-post failure after the primary terminal failure", () => {
    const transport = new FakeTransport();
    const harness = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    start(client, 1, harness);
    transport.throwOnPost = (message) =>
      message.kind === "csv:cancel" ? new Error("cancel post failed") : null;

    transport.emitError(new Error("primary worker failure"));

    expect(harness.failures).toHaveLength(1);
    expect(harness.failures[0]?.error.message).toBe("primary worker failure");
  });
});

describe("csvExportWorkerClient - lifecycle and import boundary", () => {
  it("destroy cancels, unsubscribes, and terminates exactly once", () => {
    const transport = new FakeTransport();
    const harness = callbackHarness();
    const client = new CsvExportWorkerClient(transport);
    start(client, 1, harness);

    client.destroy();
    client.destroy();

    expect(harness.cancelled).toHaveBeenCalledTimes(1);
    expect(transport.unsubscribeCount).toBe(1);
    expect(transport.unsubscribeErrorCount).toBe(1);
    expect(transport.terminateCount).toBe(1);
    expect(
      transport.posted.filter(({ message }) => message.kind === "csv:cancel"),
    ).toHaveLength(1);
  });

  it("imports only protocol and task-id transport dependencies", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../csvExportWorkerClient.ts", import.meta.url), "utf8"),
    );
    const imports = Array.from(source.matchAll(/from "([^"]+)"/g), (match) =>
      match[1],
    );
    expect(imports).toEqual([
      "./csvExportProtocol",
      "./csvExportProtocol",
      "./csvExportTaskId",
    ]);
  });
});
