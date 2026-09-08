import { describe, expect, it } from "vitest";

import { CsvExportSinkError } from "../csvExportErrors";
import {
  AbstractCsvSink,
  type CsvByteChunk,
  type CsvSinkResult,
} from "../csvOutputSink";

type CloseBehavior = () => Promise<CsvSinkResult> | CsvSinkResult;

class TestSink extends AbstractCsvSink {
  released = 0;

  constructor(private readonly behavior: CloseBehavior) {
    super();
  }

  protected handleWrite(_chunk: CsvByteChunk): void {
    /* no-op */
  }
  protected handleClose(): Promise<CsvSinkResult> | CsvSinkResult {
    return this.behavior();
  }
  protected handleAbort(): void {
    this.released++;
  }
}

const RESULT: CsvSinkResult = { outputType: "blob", byteLength: 0 };

describe("AbstractCsvSink - synchronous close failure", () => {
  it("transitions to failed, reproduces the same error, and blocks writes", () => {
    const error = new Error("sync close boom");
    const sink = new TestSink(() => {
      throw error;
    });

    let first: unknown;
    try {
      void sink.close();
    } catch (e) {
      first = e;
    }
    expect(first).toBe(error);

    // Repeated close reproduces the identical failure (never null/success).
    expect(() => sink.close()).toThrow(error);
    let second: unknown;
    try {
      void sink.close();
    } catch (e) {
      second = e;
    }
    expect(second).toBe(error);

    // write while failed throws a sink error.
    expect(() => sink.write(new Uint8Array([1]))).toThrow(CsvExportSinkError);
  });
});

describe("AbstractCsvSink - asynchronous close rejection", () => {
  it("retains the same rejected promise and blocks writes", async () => {
    const error = new Error("async close boom");
    const sink = new TestSink(() => Promise.reject(error));

    const p1 = sink.close();
    const p2 = sink.close(); // while closing: same promise
    expect(p1).toBe(p2);

    await expect(p1).rejects.toBe(error);

    // After settling, repeated close reproduces the same rejected promise.
    const p3 = sink.close();
    await expect(p3).rejects.toBe(error);

    expect(() => sink.write(new Uint8Array([1]))).toThrow(CsvExportSinkError);
  });
});

describe("AbstractCsvSink - asynchronous close success", () => {
  it("returns the same pending promise, then caches the result", async () => {
    let resolveClose!: (r: CsvSinkResult) => void;
    const sink = new TestSink(
      () =>
        new Promise<CsvSinkResult>((resolve) => {
          resolveClose = resolve;
        }),
    );

    const p1 = sink.close();
    const p2 = sink.close(); // still closing: identical promise
    expect(p1).toBe(p2);

    // write while closing is blocked.
    expect(() => sink.write(new Uint8Array([1]))).toThrow(CsvExportSinkError);

    resolveClose(RESULT);
    await expect(p1).resolves.toBe(RESULT);

    // After success, close returns the cached result value.
    expect(sink.close()).toBe(RESULT);
    expect(() => sink.write(new Uint8Array([1]))).toThrow(CsvExportSinkError);
  });
});

describe("AbstractCsvSink - abort interactions", () => {
  it("abort after successful close is a no-op", () => {
    const sink = new TestSink(() => RESULT);
    void sink.close();
    void sink.abort("late");
    expect(sink.released).toBe(0); // handleAbort not invoked after close
  });

  it("abort is idempotent", () => {
    const sink = new TestSink(() => RESULT);
    void sink.abort("a");
    void sink.abort("b");
    expect(sink.released).toBe(1);
  });

  it("abort during close rejects immediately and discards a late success", async () => {
    let resolveClose!: (result: CsvSinkResult) => void;
    const sink = new TestSink(
      () =>
        new Promise<CsvSinkResult>((resolve) => {
          resolveClose = resolve;
        }),
    );
    const reason = new Error("cancel finalization");

    const closePromise = sink.close();
    void sink.abort(reason);

    // This settles while the underlying close is still deliberately pending.
    await expect(closePromise).rejects.toMatchObject({
      name: "CsvExportSinkError",
      cause: reason,
    });
    expect(sink.released).toBe(1);

    void sink.abort("again");
    expect(sink.released).toBe(1);
    expect(() => sink.write(new Uint8Array([1]))).toThrow(CsvExportSinkError);
    expect(() => sink.close()).toThrow(CsvExportSinkError);

    resolveClose(RESULT);
    await Promise.resolve();
    await Promise.resolve();

    // The completed underlying close cannot publish a result or resurrect state.
    expect(() => sink.close()).toThrow(CsvExportSinkError);
    expect(sink.released).toBe(1);
  });

  it("observes and discards a late close rejection after abort", async () => {
    let rejectClose!: (reason: unknown) => void;
    const sink = new TestSink(
      () =>
        new Promise<CsvSinkResult>((_resolve, reject) => {
          rejectClose = reject;
        }),
    );
    const reason = { type: "cancel" };
    const closePromise = sink.close();

    void sink.abort(reason);
    await expect(closePromise).rejects.toMatchObject({
      name: "CsvExportSinkError",
      cause: reason,
    });

    rejectClose(new Error("late close failure"));
    await Promise.resolve();
    await Promise.resolve();

    expect(() => sink.close()).toThrow(CsvExportSinkError);
    expect(sink.released).toBe(1);
  });

  it("retains reentrant cancellation over a synchronous close result", () => {
    const reason = new Error("cancel from close");
    const sink: TestSink = new TestSink(() => {
      void sink.abort(reason);
      return RESULT;
    });

    let closeError: unknown;
    try {
      void sink.close();
    } catch (error) {
      closeError = error;
    }

    expect(closeError).toBeInstanceOf(CsvExportSinkError);
    if (closeError instanceof CsvExportSinkError) {
      expect(closeError.cause).toBe(reason);
    }
    expect(sink.released).toBe(1);
    let repeatedCloseError: unknown;
    try {
      void sink.close();
    } catch (error) {
      repeatedCloseError = error;
    }
    expect(repeatedCloseError).toBe(closeError);
    void sink.abort("again");
    expect(sink.released).toBe(1);
  });

  it("retains reentrant cancellation and observes either late promise outcome", async () => {
    const resolveReason = new Error("cancel before late resolve");
    let resolveClose!: (result: CsvSinkResult) => void;
    const resolvingSink: TestSink = new TestSink(() => {
      void resolvingSink.abort(resolveReason);
      return new Promise<CsvSinkResult>((resolve) => {
        resolveClose = resolve;
      });
    });

    const resolvingClose = resolvingSink.close();
    await expect(resolvingClose).rejects.toMatchObject({
      name: "CsvExportSinkError",
      cause: resolveReason,
    });
    resolveClose(RESULT);
    await Promise.resolve();
    await Promise.resolve();
    expect(() => resolvingSink.close()).toThrow(CsvExportSinkError);
    expect(resolvingSink.released).toBe(1);

    const rejectReason = new Error("cancel before late reject");
    let rejectClose!: (reason: unknown) => void;
    const rejectingSink: TestSink = new TestSink(() => {
      void rejectingSink.abort(rejectReason);
      return new Promise<CsvSinkResult>((_resolve, reject) => {
        rejectClose = reject;
      });
    });

    const rejectingClose = rejectingSink.close();
    await expect(rejectingClose).rejects.toMatchObject({
      name: "CsvExportSinkError",
      cause: rejectReason,
    });
    rejectClose(new Error("discarded physical close failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect(() => rejectingSink.close()).toThrow(CsvExportSinkError);
    expect(rejectingSink.released).toBe(1);
  });
});
