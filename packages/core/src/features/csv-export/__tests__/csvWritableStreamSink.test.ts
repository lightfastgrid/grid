import { describe, expect, it } from "vitest";

import { CsvExportSinkError } from "../csvExportErrors";
import { CsvWritableStreamSink } from "../csvWritableStreamSink";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Recorder {
  writes: Uint8Array[];
  closeCount: number;
  abortCount: number;
  abortReasons: unknown[];
}

function makeControlledStream(control: {
  onWrite?: (chunk: Uint8Array, rec: Recorder) => Promise<void> | void;
}): { stream: WritableStream<Uint8Array>; rec: Recorder } {
  const rec: Recorder = { writes: [], closeCount: 0, abortCount: 0, abortReasons: [] };
  const stream = new WritableStream<Uint8Array>({
    write(chunk) {
      rec.writes.push(chunk);
      return control.onWrite?.(chunk, rec);
    },
    close() {
      rec.closeCount++;
    },
    abort(reason) {
      rec.abortCount++;
      rec.abortReasons.push(reason);
    },
  });
  return { stream, rec };
}

describe("CsvWritableStreamSink - backpressure and close (test 56)", () => {
  it("does not resolve a write until the underlying write resolves", async () => {
    const gate = deferred();
    const { stream, rec } = makeControlledStream({ onWrite: () => gate.promise });
    const sink = new CsvWritableStreamSink(stream);

    let done = false;
    const p = Promise.resolve(sink.write(new Uint8Array([1]))).then(() => {
      done = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(rec.writes).toHaveLength(1);
    expect(done).toBe(false); // caller cannot treat the write as accepted yet

    gate.resolve();
    await p;
    expect(done).toBe(true);
  });

  it("closes the underlying stream exactly once (idempotent close)", async () => {
    const { stream, rec } = makeControlledStream({});
    const sink = new CsvWritableStreamSink(stream);
    await sink.write(new Uint8Array([1, 2]));
    const result = await sink.close();
    await sink.close(); // idempotent
    expect(rec.closeCount).toBe(1);
    expect(result).toMatchObject({ outputType: "stream", byteLength: 2 });
  });

  it("fails a write after close deterministically", async () => {
    const { stream } = makeControlledStream({});
    const sink = new CsvWritableStreamSink(stream);
    await sink.close();
    expect(() => sink.write(new Uint8Array([1]))).toThrow(CsvExportSinkError);
  });

  it("preserves the cause when the underlying write rejects", async () => {
    const cause = new Error("write boom");
    const { stream } = makeControlledStream({
      onWrite: () => Promise.reject(cause),
    });
    const sink = new CsvWritableStreamSink(stream);
    await expect(sink.write(new Uint8Array([1]))).rejects.toMatchObject({
      name: "CsvExportSinkError",
      cause,
    });
  });
});

describe("CsvWritableStreamSink - abort (test 57)", () => {
  it("aborts exactly once and repeated abort is a no-op", async () => {
    const { stream, rec } = makeControlledStream({});
    const sink = new CsvWritableStreamSink(stream);
    await sink.abort("cancel");
    await sink.abort("again");
    expect(rec.abortCount).toBe(1);
    expect(rec.abortReasons).toEqual(["cancel"]);
  });

  it("does not close after abort", async () => {
    const { stream, rec } = makeControlledStream({});
    const sink = new CsvWritableStreamSink(stream);
    await sink.abort("cancel");
    expect(() => sink.close()).toThrow(CsvExportSinkError);
    expect(rec.closeCount).toBe(0);
  });

  it("aborts cleanly after a write failure and blocks a later close", async () => {
    const cause = new Error("write boom");
    const { stream } = makeControlledStream({
      onWrite: () => Promise.reject(cause),
    });
    const sink = new CsvWritableStreamSink(stream);
    await Promise.resolve(sink.write(new Uint8Array([1]))).catch(() => undefined);
    // Abort after the failure resolves (the stream is already errored) and the
    // sink becomes terminal: a later write and close both fail deterministically.
    await sink.abort("cancel");
    expect(() => sink.write(new Uint8Array([2]))).toThrow(CsvExportSinkError);
    expect(() => sink.close()).toThrow(CsvExportSinkError);
  });
});

interface FakeStreamControl {
  close?: () => Promise<void>;
  abort?: (reason: unknown) => Promise<void>;
  releaseLock?: () => void;
}

interface FakeStreamRecorder {
  closeCount: number;
  abortCount: number;
  abortReasons: unknown[];
  releaseCount: number;
}

function makeFakeWriterStream(
  control: FakeStreamControl,
): { stream: WritableStream<Uint8Array>; rec: FakeStreamRecorder } {
  const rec: FakeStreamRecorder = {
    closeCount: 0,
    abortCount: 0,
    abortReasons: [],
    releaseCount: 0,
  };
  const writer: WritableStreamDefaultWriter<Uint8Array> = {
    closed: Promise.resolve(undefined),
    desiredSize: 1,
    ready: Promise.resolve(undefined),
    write: () => Promise.resolve(),
    close: () => {
      rec.closeCount++;
      return control.close ? control.close() : Promise.resolve();
    },
    abort: (reason?: unknown) => {
      rec.abortCount++;
      rec.abortReasons.push(reason);
      return control.abort ? control.abort(reason) : Promise.resolve();
    },
    releaseLock: () => {
      rec.releaseCount++;
      control.releaseLock?.();
    },
  };
  const stream: WritableStream<Uint8Array> = {
    locked: true,
    abort: () => Promise.resolve(),
    close: () => Promise.resolve(),
    getWriter: () => writer,
  };
  return { stream, rec };
}

describe("CsvWritableStreamSink - releaseLock failures (P3)", () => {
  it("wraps a releaseLock failure on close and releases once", async () => {
    const cause = new Error("release boom");
    const { stream, rec } = makeFakeWriterStream({
      releaseLock: () => {
        throw cause;
      },
    });
    const sink = new CsvWritableStreamSink(stream);
    await expect(sink.close()).rejects.toMatchObject({
      name: "CsvExportSinkError",
      cause,
    });
    expect(rec.releaseCount).toBe(1);
  });

  it("keeps the close failure primary when releaseLock also fails", async () => {
    const closeCause = new Error("close boom");
    const { stream } = makeFakeWriterStream({
      close: () => Promise.reject(closeCause),
      releaseLock: () => {
        throw new Error("release boom");
      },
    });
    const sink = new CsvWritableStreamSink(stream);
    await expect(sink.close()).rejects.toMatchObject({
      name: "CsvExportSinkError",
      cause: closeCause,
    });
  });

  it("wraps a releaseLock failure on abort and releases once", async () => {
    const cause = new Error("release boom");
    const { stream, rec } = makeFakeWriterStream({
      releaseLock: () => {
        throw cause;
      },
    });
    const sink = new CsvWritableStreamSink(stream);
    await expect(sink.abort("cancel")).rejects.toMatchObject({
      name: "CsvExportSinkError",
      cause,
    });
    expect(rec.releaseCount).toBe(1);
  });

  it("releases the lock at most once across repeated close", async () => {
    const { stream, rec } = makeFakeWriterStream({});
    const sink = new CsvWritableStreamSink(stream);
    await sink.close();
    await sink.close(); // idempotent; no second release
    expect(rec.releaseCount).toBe(1);
  });
});

describe("CsvWritableStreamSink - abort during asynchronous close", () => {
  it("rejects logical close immediately and coordinates abort and release", async () => {
    const closeGate = deferred();
    const abortGate = deferred();
    const { stream, rec } = makeFakeWriterStream({
      close: () => closeGate.promise,
      abort: () => abortGate.promise,
    });
    const sink = new CsvWritableStreamSink(stream);
    const reason = new Error("cancel close");

    const closePromise = sink.close();
    const abortPromise = sink.abort(reason);

    // Logical cancellation does not wait for either physical operation.
    await expect(closePromise).rejects.toMatchObject({
      name: "CsvExportSinkError",
      cause: reason,
    });
    expect(rec).toMatchObject({
      closeCount: 1,
      abortCount: 1,
      abortReasons: [reason],
      releaseCount: 0,
    });

    await sink.abort("again");
    expect(rec.abortCount).toBe(1);

    abortGate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(rec.releaseCount).toBe(0);

    closeGate.resolve();
    await abortPromise;
    expect(rec.releaseCount).toBe(1);
    expect(() => sink.close()).toThrow(CsvExportSinkError);
  });

  it("keeps a completed close successful when it wins before abort", async () => {
    const closeGate = deferred();
    const { stream, rec } = makeFakeWriterStream({
      close: () => closeGate.promise,
    });
    const sink = new CsvWritableStreamSink(stream);
    const closePromise = sink.close();

    closeGate.resolve();
    await expect(closePromise).resolves.toMatchObject({
      outputType: "stream",
      byteLength: 0,
    });
    await sink.abort("late");

    expect(rec.closeCount).toBe(1);
    expect(rec.abortCount).toBe(0);
    expect(rec.releaseCount).toBe(1);
  });

  it("keeps cancellation and operation failures primary over release failure", async () => {
    const closeGate = deferred();
    const abortGate = deferred();
    const closeCause = new Error("close boom");
    const abortCause = new Error("abort boom");
    const releaseCause = new Error("release boom");
    const cancellationReason = new Error("cancel finalization");
    const { stream, rec } = makeFakeWriterStream({
      close: () => closeGate.promise,
      abort: () => abortGate.promise,
      releaseLock: () => {
        throw releaseCause;
      },
    });
    const sink = new CsvWritableStreamSink(stream);

    const closePromise = sink.close();
    const abortPromise = sink.abort(cancellationReason);
    const closeExpectation = expect(closePromise).rejects.toMatchObject({
      name: "CsvExportSinkError",
      cause: cancellationReason,
    });
    const abortExpectation = expect(abortPromise).rejects.toMatchObject({
      name: "CsvExportSinkError",
      cause: abortCause,
    });

    closeGate.reject(closeCause);
    abortGate.reject(abortCause);

    await closeExpectation;
    await abortExpectation;
    expect(rec.closeCount).toBe(1);
    expect(rec.abortCount).toBe(1);
    expect(rec.releaseCount).toBe(1);
  });
});
