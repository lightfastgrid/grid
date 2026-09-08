import { describe, expect, it } from "vitest";

import { CsvExportSinkError } from "../csvExportErrors";
import { CsvTextSink } from "../csvTextSink";

describe("CsvTextSink - decoding (test 55)", () => {
  it("decodes UTF-8 characters split across chunk boundaries", async () => {
    // "café" = 63 61 66 C3 A9; split mid-é between C3 and A9.
    const sink = new CsvTextSink();
    void sink.write(new Uint8Array([0x63, 0x61, 0x66, 0xc3]));
    void sink.write(new Uint8Array([0xa9]));
    const result = await sink.close();
    expect(result).toMatchObject({ outputType: "text", text: "café", byteLength: 5 });
  });

  it("flushes the decoder once on close (incomplete tail becomes U+FFFD)", async () => {
    const sink = new CsvTextSink();
    void sink.write(new Uint8Array([0xc3])); // dangling lead byte
    const result = await sink.close();
    expect(result.text).toBe("�");
  });

  it("joins multiple parts once into the final text", async () => {
    const enc = new TextEncoder();
    const sink = new CsvTextSink();
    void sink.write(enc.encode("a,b\r\n"));
    void sink.write(enc.encode("c,d\r\n"));
    expect((await sink.close()).text).toBe("a,b\r\nc,d\r\n");
  });

  it("abort drops retained parts so close after abort fails", () => {
    const sink = new CsvTextSink();
    void sink.write(new TextEncoder().encode("data"));
    void sink.abort("stop");
    expect(() => sink.close()).toThrow(CsvExportSinkError);
  });

  it("does not mutate the input chunk", () => {
    const chunk = new Uint8Array([0x61, 0x62]);
    const copy = Uint8Array.from(chunk);
    const sink = new CsvTextSink();
    void sink.write(chunk);
    void sink.close();
    expect(chunk).toEqual(copy);
  });
});
