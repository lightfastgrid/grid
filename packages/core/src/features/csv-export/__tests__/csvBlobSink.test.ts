import { afterEach, describe, expect, it, vi } from "vitest";

import { CsvBlobSink } from "../csvBlobSink";
import { CsvExportSinkError } from "../csvExportErrors";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CsvBlobSink - blob output (test 54)", () => {
  it("produces exactly one Blob with the exact MIME type", async () => {
    const RealBlob = globalThis.Blob;
    let blobCount = 0;
    class CountingBlob extends RealBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        blobCount++;
      }
    }
    vi.stubGlobal("Blob", CountingBlob);

    const sink = new CsvBlobSink();
    void sink.write(new Uint8Array([0x61, 0x2c])); // "a,"
    void sink.write(new Uint8Array([0x62])); // "b"
    expect(blobCount).toBe(0); // no per-write Blob
    const result = await sink.close();
    expect(blobCount).toBe(1); // exactly one Blob at close
    expect(result.blob?.type).toBe("text/csv;charset=utf-8");
    expect(result.blob?.size).toBe(3);
    expect(result.byteLength).toBe(3);
  });

  it("wraps a Blob construction failure in CsvExportSinkError with cause", () => {
    const cause = new Error("blob boom");
    class ThrowingBlob {
      constructor() {
        throw cause;
      }
    }
    vi.stubGlobal("Blob", ThrowingBlob);

    const sink = new CsvBlobSink();
    void sink.write(new Uint8Array([1]));
    try {
      void sink.close();
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CsvExportSinkError);
      if (error instanceof CsvExportSinkError) expect(error.cause).toBe(cause);
    }
  });

  it("does not mutate input chunks", () => {
    const chunk = new Uint8Array([1, 2, 3]);
    const copy = Uint8Array.from(chunk);
    const sink = new CsvBlobSink();
    void sink.write(chunk);
    void sink.close();
    expect(chunk).toEqual(copy);
  });
});
