import { describe, expect, it } from "vitest";

import { CsvByteLimitedSink } from "../csvByteLimitedSink";
import {
  CsvExportSinkError,
  CsvExportSizeLimitError,
} from "../csvExportErrors";
import type { CsvByteChunk, CsvOutputSink, CsvSinkResult } from "../csvOutputSink";

class RecordingSink implements CsvOutputSink {
  readonly written: Uint8Array[] = [];
  closed = false;
  aborted = false;

  write(chunk: Uint8Array): void {
    this.written.push(chunk);
  }
  close(): CsvSinkResult {
    this.closed = true;
    return { outputType: "blob", byteLength: 0 };
  }
  abort(): void {
    this.aborted = true;
  }
}

function bytes(n: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(n);
}

describe("CsvByteLimitedSink - byte limit (test 58)", () => {
  it("accepts a chunk exactly at the bound", () => {
    const inner = new RecordingSink();
    const sink = new CsvByteLimitedSink(inner, 5);
    void sink.write(bytes(5));
    expect(sink.acceptedBytes).toBe(5);
    expect(inner.written).toHaveLength(1);
  });

  it("rejects a one-byte overflow without forwarding it", () => {
    const inner = new RecordingSink();
    const sink = new CsvByteLimitedSink(inner, 5);
    void sink.write(bytes(3));
    expect(() => sink.write(bytes(3))).toThrow(CsvExportSizeLimitError);
    expect(sink.acceptedBytes).toBe(3); // unchanged
    expect(inner.written).toHaveLength(1); // overflowing chunk not forwarded
  });

  it("zero-length chunks do not change accounting", () => {
    const inner = new RecordingSink();
    const sink = new CsvByteLimitedSink(inner, 5);
    void sink.write(bytes(0));
    expect(sink.acceptedBytes).toBe(0);
    expect(inner.written).toHaveLength(1);
  });

  it("treats Infinity as unlimited", () => {
    const inner = new RecordingSink();
    const sink = new CsvByteLimitedSink(inner, Number.POSITIVE_INFINITY);
    void sink.write(bytes(1_000_000));
    expect(sink.acceptedBytes).toBe(1_000_000);
    expect(inner.written).toHaveLength(1);
  });

  it("forwards close and abort to the inner sink", () => {
    const inner = new RecordingSink();
    const sink = new CsvByteLimitedSink(inner, 10);
    void sink.close();
    expect(inner.closed).toBe(true);

    const inner2 = new RecordingSink();
    const sink2 = new CsvByteLimitedSink(inner2, 10);
    void sink2.abort("stop");
    expect(inner2.aborted).toBe(true);
  });

  it("reports the size-limit error with emitted and max bytes", () => {
    const sink = new CsvByteLimitedSink(new RecordingSink(), 4);
    try {
      void sink.write(bytes(5));
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CsvExportSizeLimitError);
      if (error instanceof CsvExportSizeLimitError) {
        expect(error.emittedBytes).toBe(5);
        expect(error.maxOutputBytes).toBe(4);
      }
    }
  });
});

interface Gate {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}
function gate(): Gate {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Inner sink whose write can be sync-ok, sync-throw, or gated async. */
class ControlledInner implements CsvOutputSink {
  writeCount = 0;
  abortCount = 0;
  private currentGate: Gate | null = null;

  constructor(
    private readonly mode: "sync" | "syncThrow" | "async",
    private readonly error?: unknown,
  ) {}

  write(_chunk: CsvByteChunk): Promise<void> | void {
    this.writeCount++;
    if (this.mode === "syncThrow") throw this.error;
    if (this.mode === "sync") return;
    this.currentGate = gate();
    return this.currentGate.promise;
  }
  resolveWrite(): void {
    this.currentGate?.resolve();
  }
  rejectWrite(reason: unknown): void {
    this.currentGate?.reject(reason);
  }
  close(): CsvSinkResult {
    return { outputType: "blob", byteLength: 0 };
  }
  abort(): void {
    this.abortCount++;
  }
}

describe("CsvByteLimitedSink - transactional accounting", () => {
  it("sync inner-write throw leaves acceptedBytes unchanged", () => {
    const inner = new ControlledInner("syncThrow", new Error("boom"));
    const sink = new CsvByteLimitedSink(inner, 100);
    expect(() => sink.write(bytes(5))).toThrow("boom");
    expect(sink.acceptedBytes).toBe(0);
  });

  it("does not count an async write until it resolves", async () => {
    const inner = new ControlledInner("async");
    const sink = new CsvByteLimitedSink(inner, 100);
    const p = sink.write(bytes(5));
    expect(sink.acceptedBytes).toBe(0); // still pending
    inner.resolveWrite();
    await p;
    expect(sink.acceptedBytes).toBe(5); // counted exactly once
  });

  it("does not count an async write that rejects", async () => {
    const inner = new ControlledInner("async");
    const sink = new CsvByteLimitedSink(inner, 100);
    const p = sink.write(bytes(5));
    inner.rejectWrite(new Error("boom"));
    await expect(p).rejects.toThrow("boom");
    expect(sink.acceptedBytes).toBe(0);
  });

  it("rejects a second write while one is pending and never forwards it", async () => {
    const inner = new ControlledInner("async");
    const sink = new CsvByteLimitedSink(inner, 100);
    const p = sink.write(bytes(3));
    expect(() => sink.write(bytes(3))).toThrow(CsvExportSinkError);
    expect(inner.writeCount).toBe(1); // second write not forwarded
    inner.resolveWrite();
    await p;
  });

  it("a pending write cannot let another write bypass the limit", async () => {
    const inner = new ControlledInner("async");
    const sink = new CsvByteLimitedSink(inner, 5);
    const p = sink.write(bytes(3)); // pending, not yet counted
    // A second write is rejected by the pending guard, so no aggregate bypass.
    expect(() => sink.write(bytes(3))).toThrow(CsvExportSinkError);
    inner.resolveWrite();
    await p;
    expect(sink.acceptedBytes).toBe(3);
    // Now an over-limit write is rejected by the byte guard.
    expect(() => sink.write(bytes(3))).toThrow(CsvExportSizeLimitError);
  });

  it("close while a write is pending is rejected", async () => {
    const inner = new ControlledInner("async");
    const sink = new CsvByteLimitedSink(inner, 100);
    const p = sink.write(bytes(3));
    expect(() => sink.close()).toThrow(CsvExportSinkError);
    inner.resolveWrite();
    await p;
  });

  it("abort while a write is pending is forwarded once", async () => {
    const inner = new ControlledInner("async");
    const sink = new CsvByteLimitedSink(inner, 100);
    const p = sink.write(bytes(3));
    void sink.abort("cancel");
    expect(inner.abortCount).toBe(1);
    inner.resolveWrite();
    await p;
  });
});
