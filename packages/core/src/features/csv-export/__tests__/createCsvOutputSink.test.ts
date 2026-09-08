import { describe, expect, it } from "vitest";

import { createCsvOutputSink } from "../createCsvOutputSink";
import { CsvByteLimitedSink } from "../csvByteLimitedSink";
import type { CsvDownloadEnvironment } from "../csvDownloadSink";
import { CsvExportSizeLimitError } from "../csvExportErrors";

function noopDownloadEnv(): CsvDownloadEnvironment {
  return {
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => undefined,
    createAnchor: () => ({
      setHref: () => undefined,
      setDownload: () => undefined,
      click: () => undefined,
      remove: () => undefined,
    }),
  };
}

describe("createCsvOutputSink - selection", () => {
  it("selects the text sink", () => {
    const sink = createCsvOutputSink(
      { type: "text" },
      { maxOutputBytes: Infinity, fileName: "x.csv" },
    );
    void sink.write(new TextEncoder().encode("a"));
    const result = sink.close();
    expect(result).toMatchObject({ outputType: "text", text: "a" });
  });

  it("selects the blob sink", () => {
    const sink = createCsvOutputSink(
      { type: "blob" },
      { maxOutputBytes: Infinity, fileName: "x.csv" },
    );
    void sink.write(new Uint8Array([1]));
    expect(sink.close()).toMatchObject({ outputType: "blob" });
  });

  it("selects the download sink with an injected environment", () => {
    const sink = createCsvOutputSink(
      { type: "download" },
      { maxOutputBytes: Infinity, fileName: "orders.csv", downloadEnvironment: noopDownloadEnv() },
    );
    void sink.write(new Uint8Array([1]));
    expect(sink.close()).toMatchObject({ outputType: "download", fileName: "orders.csv" });
  });

  it("selects the stream sink", async () => {
    const stream = new WritableStream<Uint8Array>({ write() {} });
    const sink = createCsvOutputSink(
      { type: "stream", writable: stream },
      { maxOutputBytes: Infinity, fileName: "x.csv" },
    );
    await sink.write(new Uint8Array([1, 2]));
    expect(await sink.close()).toMatchObject({ outputType: "stream", byteLength: 2 });
  });

  it("wraps the sink in the byte guard", () => {
    const sink = createCsvOutputSink(
      { type: "blob" },
      { maxOutputBytes: 2, fileName: "x.csv" },
    );
    expect(sink).toBeInstanceOf(CsvByteLimitedSink);
    expect(() => sink.write(new Uint8Array([1, 2, 3]))).toThrow(
      CsvExportSizeLimitError,
    );
  });
});
