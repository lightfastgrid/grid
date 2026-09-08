import { describe, expect, it } from "vitest";

import { CsvBlobSink } from "../csvBlobSink";
import { CsvExportSinkError } from "../csvExportErrors";

describe("AbstractCsvSink - lifecycle transitions", () => {
  it("write after close throws deterministically", () => {
    const sink = new CsvBlobSink();
    void sink.write(new Uint8Array([1]));
    void sink.close();
    expect(() => sink.write(new Uint8Array([2]))).toThrow(CsvExportSinkError);
  });

  it("write after abort throws deterministically", () => {
    const sink = new CsvBlobSink();
    void sink.abort("stop");
    expect(() => sink.write(new Uint8Array([2]))).toThrow(CsvExportSinkError);
  });

  it("close is idempotent and returns the same result", () => {
    const sink = new CsvBlobSink();
    void sink.write(new Uint8Array([1, 2, 3]));
    const first = sink.close();
    const second = sink.close();
    expect(second).toBe(first);
  });

  it("close after abort throws (close and abort cannot both finalize)", () => {
    const sink = new CsvBlobSink();
    void sink.abort("stop");
    expect(() => sink.close()).toThrow(CsvExportSinkError);
  });

  it("abort after close is a no-op", () => {
    const sink = new CsvBlobSink();
    void sink.write(new Uint8Array([1]));
    void sink.close();
    expect(() => sink.abort("late")).not.toThrow();
  });

  it("abort is idempotent", () => {
    const sink = new CsvBlobSink();
    void sink.abort("a");
    expect(() => sink.abort("b")).not.toThrow();
  });
});
