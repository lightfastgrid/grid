import { describe, expect, it } from "vitest";

import { createCsvContentRowCursor } from "../csvContentRowCursor";
import type { CsvContentRow } from "../csvExportTypes";
import type { CsvProjectedValue } from "../csvProjectedValue";
import { type CsvEncodingOptions, CsvEncodingSession } from "../csvUtf8Encoder";
import { normalizeCsvExportOptions } from "../normalizeCsvExportOptions";

/** Drain a structured content row to a flat projected-value array (test only). */
function expandContent(row: CsvContentRow): CsvProjectedValue[] {
  const cursor = createCsvContentRowCursor(row);
  const out: CsvProjectedValue[] = [];
  while (!cursor.step(out, 1024)) {
    /* drain */
  }
  return out;
}

const enc = new TextEncoder();
const BOM = Uint8Array.from([0xef, 0xbb, 0xbf]);

function opts(over: Partial<CsvEncodingOptions> = {}): CsvEncodingOptions {
  return {
    delimiter: ",",
    quoteMode: "minimal",
    lineEnding: "\r\n",
    utf8Bom: false,
    formulaProtection: "escape",
    ...over,
  };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Drive a full session (BOM + rows) into one byte array for assertion only. */
function runSession(
  options: CsvEncodingOptions,
  rows: CsvProjectedValue[][],
): Uint8Array {
  const session = new CsvEncodingSession(options);
  const chunks: Uint8Array[] = [session.emitBom()];
  for (const row of rows) chunks.push(session.encodeRow(row));
  chunks.push(session.finish());
  return concat(chunks);
}

describe("csvEncoding - test 1: scalar value types", () => {
  it("encodes empty/null/undefined/string/number/boolean/bigint", () => {
    const bytes = runSession(opts(), [[null, undefined, "", "abc", 42, true, 10n]]);
    expect(bytes).toEqual(enc.encode(",,,abc,42,true,10\r\n"));
  });
});

describe("csvEncoding - test 2: escaping", () => {
  it("quotes delimiter/quote/CR/LF/CRLF and doubles quotes; Unicode is bare", () => {
    const bytes = runSession(opts(), [
      ["a,b", 'a"b', "a\rb", "a\nb", "a\r\nb", "café"],
    ]);
    const expected =
      '"a,b","a""b","a\rb","a\nb","a\r\nb",café\r\n';
    expect(bytes).toEqual(enc.encode(expected));
  });
});

describe("csvEncoding - test 3: quote modes", () => {
  it("minimal quotes only special fields", () => {
    expect(runSession(opts(), [["a", "b,c"]])).toEqual(enc.encode('a,"b,c"\r\n'));
  });

  it("always quotes every field", () => {
    expect(runSession(opts({ quoteMode: "always" }), [["a", "b"]])).toEqual(
      enc.encode('"a","b"\r\n'),
    );
  });

  it("never emits field text verbatim (unsafe; structure not preserved)", () => {
    expect(runSession(opts({ quoteMode: "never" }), [["a,b", 'x"y']])).toEqual(
      enc.encode('a,b,x"y\r\n'),
    );
  });
});

describe("csvEncoding - test 4: line endings", () => {
  it("emits one CRLF per row with exactly one final ending", () => {
    expect(runSession(opts(), [["r1"], ["r2"]])).toEqual(
      enc.encode("r1\r\nr2\r\n"),
    );
  });

  it("supports LF line endings", () => {
    expect(runSession(opts({ lineEnding: "\n" }), [["r1"], ["r2"]])).toEqual(
      enc.encode("r1\nr2\n"),
    );
  });
});

describe("csvEncoding - test 5: UTF-8 BOM", () => {
  it("emits a BOM-only payload for an empty export", () => {
    expect(runSession(opts({ utf8Bom: true }), [])).toEqual(BOM);
  });

  it("emits the BOM once before content", () => {
    expect(runSession(opts({ utf8Bom: true }), [["a"]])).toEqual(
      concat([BOM, enc.encode("a\r\n")]),
    );
  });

  it("produces empty bytes for an empty export when BOM is disabled", () => {
    expect(runSession(opts(), [])).toEqual(new Uint8Array(0));
  });

  it("does not repeat the BOM across multiple emitBom / encodeRow calls", () => {
    const session = new CsvEncodingSession(opts({ utf8Bom: true }));
    expect(session.emitBom()).toEqual(BOM);
    expect(session.emitBom()).toEqual(new Uint8Array(0));
    expect(session.encodeRow(["a"])).toEqual(enc.encode("a\r\n"));
  });

  it("lazily prepends the BOM on the first row when emitBom was not called", () => {
    const session = new CsvEncodingSession(opts({ utf8Bom: true }));
    expect(session.encodeRow(["a"])).toEqual(concat([BOM, enc.encode("a\r\n")]));
    expect(session.encodeRow(["b"])).toEqual(enc.encode("b\r\n"));
  });
});

describe("csvEncoding - test 6: formula protection in encoding", () => {
  it("escapes risky fields and quotes when needed", () => {
    const bytes = runSession(opts(), [
      ["=SUM(A1)", "@cmd", "+1", " -3", "\tx"],
    ]);
    expect(bytes).toEqual(enc.encode("'=SUM(A1),'@cmd,'+1,' -3,'\tx\r\n"));
  });

  it("quotes an escaped value that still contains a CR", () => {
    expect(runSession(opts(), [["\rx"]])).toEqual(enc.encode('"\'\rx"\r\n'));
  });

  it("does not escape when formulaProtection is none", () => {
    expect(runSession(opts({ formulaProtection: "none" }), [["=danger"]])).toEqual(
      enc.encode("=danger\r\n"),
    );
  });

  it("applies protection to header-style and custom-content rows alike", () => {
    // A header row is just projected values through the same session.
    expect(runSession(opts(), [["=Header"]])).toEqual(enc.encode("'=Header\r\n"));
    const content = expandContent([{ value: "=danger" }]);
    expect(runSession(opts(), [content])).toEqual(enc.encode("'=danger\r\n"));
  });
});

describe("csvEncoding - test 7: native negatives vs strings", () => {
  it("keeps native negative number/bigint numeric but escapes the string", () => {
    expect(runSession(opts(), [[-42, "-42"]])).toEqual(enc.encode("-42,'-42\r\n"));
    expect(runSession(opts(), [[-42n]])).toEqual(enc.encode("-42\r\n"));
  });
});

describe("csvEncoding - test 8: structured content and mergeAcross", () => {
  it("expands mergeAcross into value plus N empty fields", () => {
    const row = expandContent([{ value: "A", mergeAcross: 2 }, { value: "B" }]);
    expect(row).toEqual(["A", undefined, undefined, "B"]);
    expect(runSession(opts(), [row])).toEqual(enc.encode("A,,,B\r\n"));
  });

  it("treats mergeAcross 0 as no extra fields", () => {
    expect(expandContent([{ value: "A", mergeAcross: 0 }])).toEqual(["A"]);
  });
});

describe("csvEncoding - test 9: delimiter validation", () => {
  it("normalization still rejects an invalid delimiter", () => {
    expect(() => normalizeCsvExportOptions({ delimiter: "ab" })).toThrow();
  });

  it("encodes with a configured non-comma delimiter", () => {
    expect(runSession(opts({ delimiter: ";" }), [["a", "b;c"]])).toEqual(
      enc.encode('a;"b;c"\r\n'),
    );
  });
});

describe("csvEncoding - Unicode byte parity and no mutation", () => {
  it("matches TextEncoder bytes for multi-byte and astral characters", () => {
    expect(runSession(opts(), [["café", "日本語", "\u{1f680}"]])).toEqual(
      enc.encode("café,日本語,\u{1f680}\r\n"),
    );
  });

  it("does not mutate the input value array or content rows", () => {
    const values: readonly CsvProjectedValue[] = Object.freeze(["a", "b"]);
    new CsvEncodingSession(opts()).encodeRow(values);
    expect(values).toEqual(["a", "b"]);

    const content: CsvContentRow = [{ value: "A", mergeAcross: 1 }];
    Object.freeze(content);
    expandContent(content);
    expect(content).toEqual([{ value: "A", mergeAcross: 1 }]);
  });
});

describe("csvEncoding - resumable row chunk encoding", () => {
  it("encodes a wide row in bounded batches equal to one-shot bytes", () => {
    const fieldCount = 100_000;
    const values: CsvProjectedValue[] = Array.from(
      { length: fieldCount },
      (_v, i) => i,
    );

    const oneShot = concat([
      new CsvEncodingSession(opts()).encodeRow(values),
    ]);

    const session = new CsvEncodingSession(opts());
    const chunks: Uint8Array[] = [];
    const batchSize = 1000;
    for (let i = 0; i < values.length; i += batchSize) {
      const batch = values.slice(i, i + batchSize);
      const endRow = i + batchSize >= values.length;
      chunks.push(session.encodeRowChunk(batch, { endRow }));
    }
    expect(concat(chunks)).toEqual(oneShot);
    expect(session.emittedRowCount).toBe(1);
  });

  it("processes only the supplied batch and keeps delimiters exact", () => {
    const session = new CsvEncodingSession(opts());
    const a = session.encodeRowChunk(["x", "y"], { endRow: false });
    const b = session.encodeRowChunk(["z"], { endRow: true });
    expect(a).toEqual(enc.encode("x,y"));
    expect(b).toEqual(enc.encode(",z\r\n"));
    expect(concat([a, b])).toEqual(enc.encode("x,y,z\r\n"));
  });

  it("emits no line ending before finalization and exactly one after", () => {
    const session = new CsvEncodingSession(opts());
    const mid = session.encodeRowChunk(["a"], { endRow: false });
    expect(mid).toEqual(enc.encode("a"));
    expect(session.emittedRowCount).toBe(0);
    const end = session.encodeRowChunk(["b"], { endRow: true });
    expect(end).toEqual(enc.encode(",b\r\n"));
    expect(session.emittedRowCount).toBe(1);
  });

  it("performs no later work after an intermediate chunk is discarded", () => {
    const session = new CsvEncodingSession(opts());
    const first = session.encodeRowChunk(["a", "b"], { endRow: false });
    expect(first).toEqual(enc.encode("a,b"));
    // Drop the session without finalizing: no bytes are produced afterwards.
    expect(session.emittedRowCount).toBe(0);
  });

  it("finalizes an empty row as a single line ending", () => {
    const session = new CsvEncodingSession(opts());
    expect(session.encodeRowChunk([], { endRow: true })).toEqual(enc.encode("\r\n"));
    expect(session.emittedRowCount).toBe(1);
  });

  it("emits the BOM once with a multi-chunk first row", () => {
    const session = new CsvEncodingSession(opts({ utf8Bom: true }));
    const a = session.encodeRowChunk(["a"], { endRow: false });
    const b = session.encodeRowChunk(["b"], { endRow: true });
    expect(a).toEqual(concat([BOM, enc.encode("a")]));
    expect(b).toEqual(enc.encode(",b\r\n"));
  });

  it("rejects encodeRow while a chunked row is in progress", () => {
    const session = new CsvEncodingSession(opts());
    session.encodeRowChunk(["a"], { endRow: false });
    expect(() => session.encodeRow(["b"])).toThrow();
  });

  it("copies options so later caller mutation does not affect the session", () => {
    const options = opts();
    const session = new CsvEncodingSession(options);
    options.delimiter = ";";
    options.utf8Bom = true;
    options.quoteMode = "always";
    expect(session.encodeRow(["a", "b"])).toEqual(enc.encode("a,b\r\n"));
  });
});

describe("csvEncoding - terminal finalization", () => {
  it("finish() throws while a chunked row is still open", () => {
    const session = new CsvEncodingSession(opts());
    session.encodeRowChunk(["a"], { endRow: false });
    expect(() => session.finish()).toThrow();
  });

  it("empty non-final chunk throws (no zero-progress transition)", () => {
    const session = new CsvEncodingSession(opts());
    expect(() => session.encodeRowChunk([], { endRow: false })).toThrow();
  });

  it("empty finalization emits one empty row", () => {
    const session = new CsvEncodingSession(opts());
    expect(session.encodeRowChunk([], { endRow: true })).toEqual(enc.encode("\r\n"));
    expect(session.emittedRowCount).toBe(1);
  });

  it("finish() returns the BOM once for a BOM-only empty export", () => {
    const session = new CsvEncodingSession(opts({ utf8Bom: true }));
    expect(session.finish()).toEqual(BOM);
    expect(session.finish()).toEqual(new Uint8Array(0));
  });

  it("finish() after content returns empty and does not repeat the BOM", () => {
    const session = new CsvEncodingSession(opts({ utf8Bom: true }));
    expect(session.encodeRow(["a"])).toEqual(concat([BOM, enc.encode("a\r\n")]));
    expect(session.finish()).toEqual(new Uint8Array(0));
  });

  it("finish() returns empty when emitBom already sent the BOM", () => {
    const session = new CsvEncodingSession(opts({ utf8Bom: true }));
    expect(session.emitBom()).toEqual(BOM);
    expect(session.finish()).toEqual(new Uint8Array(0));
  });

  it("is terminal: encodeRow/encodeRowChunk throw after finish", () => {
    const session = new CsvEncodingSession(opts());
    session.finish();
    expect(() => session.encodeRow(["a"])).toThrow();
    expect(() => session.encodeRowChunk(["a"], { endRow: true })).toThrow();
  });

  it("repeated finish() is idempotent and emitBom after finish adds nothing", () => {
    const session = new CsvEncodingSession(opts({ utf8Bom: true }));
    expect(session.finish()).toEqual(BOM);
    expect(session.finish()).toEqual(new Uint8Array(0));
    expect(session.emitBom()).toEqual(new Uint8Array(0));
  });
});
