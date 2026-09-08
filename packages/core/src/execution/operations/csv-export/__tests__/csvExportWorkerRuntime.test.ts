/**
 * CSV Export V1 - Stage 4B Worker encoder runtime tests.
 */

import { describe, expect, it } from "vitest";

import type { CsvProjectedValue } from "../../../../features/csv-export/csvProjectedValue";
import {
  type CsvEncodingOptions,
  CsvEncodingSession,
} from "../../../../features/csv-export/csvUtf8Encoder";
import { estimateCsvProjectedBytes } from "../../../../features/csv-export/estimateCsvProjectedBytes";
import type {
  CsvChunkRequest,
  CsvEncodedChunkResponse,
  CsvStartRequest,
  CsvWorkerProjectionValue,
  CsvWorkerResponse,
} from "../csvExportProtocol";
import { CsvExportWorkerRuntime } from "../csvExportWorkerRuntime";

const DEFAULT_ENCODING: CsvEncodingOptions = {
  delimiter: ",",
  quoteMode: "minimal",
  lineEnding: "\r\n",
  utf8Bom: false,
  formulaProtection: "escape",
};

function rowEnds(values: readonly number[]): Uint32Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(values.length * Uint32Array.BYTES_PER_ELEMENT);
  const result: Uint32Array<ArrayBuffer> = new Uint32Array(buffer);
  for (let i = 0; i < values.length; i++) result[i] = values[i]!;
  return result;
}

function estimatedBytes(values: readonly CsvWorkerProjectionValue[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const cost = estimateCsvProjectedBytes(values[i]!);
    total =
      total >= Number.MAX_SAFE_INTEGER - cost
        ? Number.MAX_SAFE_INTEGER
        : total + cost;
  }
  return total;
}

function start(
  taskId: number,
  overrides: Partial<CsvStartRequest> = {},
): CsvStartRequest {
  return {
    kind: "csv:start",
    taskId,
    plannedColumnCount: 3,
    encoding: DEFAULT_ENCODING,
    ...overrides,
  };
}

function chunk(
  taskId: number,
  sequence: number,
  values: CsvWorkerProjectionValue[],
  ends: readonly number[],
  final: boolean,
): CsvChunkRequest {
  return {
    kind: "csv:chunk",
    taskId,
    sequence,
    values,
    rowEnds: rowEnds(ends),
    estimatedBytes: estimatedBytes(values),
    final,
  };
}

function runtimeHarness(): {
  runtime: CsvExportWorkerRuntime;
  responses: CsvWorkerResponse[];
} {
  const responses: CsvWorkerResponse[] = [];
  return {
    runtime: new CsvExportWorkerRuntime((response) => responses.push(response)),
    responses,
  };
}

function encodedResponses(
  responses: readonly CsvWorkerResponse[],
): CsvEncodedChunkResponse[] {
  return responses.filter(
    (response): response is CsvEncodedChunkResponse =>
      response.kind === "csv:encodedChunk",
  );
}

function lastResponse(
  responses: readonly CsvWorkerResponse[],
): CsvWorkerResponse | undefined {
  return responses[responses.length - 1];
}

function combineBytes(
  chunks: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
  const byteLength = chunks.reduce(
    (total, bytes) => total + bytes.byteLength,
    0,
  );
  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const bytes of chunks) {
    combined.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return combined;
}

function workerBytes(responses: readonly CsvWorkerResponse[]): Uint8Array<ArrayBuffer> {
  return combineBytes(encodedResponses(responses).map((response) => response.bytes));
}

function mainBytes(
  rows: readonly (readonly CsvProjectedValue[])[],
  encoding: CsvEncodingOptions,
): Uint8Array<ArrayBuffer> {
  const session = new CsvEncodingSession(encoding);
  const chunks = rows.map((row) => session.encodeRow(row));
  chunks.push(session.finish());
  return combineBytes(chunks);
}

describe("csvExportWorkerRuntime - task and sequence ownership", () => {
  it("requires sequence zero and treats duplicates, gaps, and out-of-order chunks as fatal", () => {
    const { runtime, responses } = runtimeHarness();

    runtime.handleMessage(start(1));
    runtime.handleMessage(chunk(1, 1, ["gap"], [1], true));
    expect(lastResponse(responses)).toMatchObject({
      kind: "csv:error",
      taskId: 1,
      code: "csv-worker/sequence-mismatch",
    });

    runtime.handleMessage(start(2));
    runtime.handleMessage(chunk(2, 0, ["partial"], [], false));
    runtime.handleMessage(chunk(2, 0, ["duplicate"], [], false));
    expect(lastResponse(responses)).toMatchObject({
      kind: "csv:error",
      taskId: 2,
      code: "csv-worker/sequence-mismatch",
    });

    runtime.handleMessage(start(3));
    runtime.handleMessage(chunk(3, 2, ["out-of-order"], [1], true));
    expect(lastResponse(responses)).toMatchObject({
      kind: "csv:error",
      taskId: 3,
      code: "csv-worker/sequence-mismatch",
    });
    expect(responses.some((response) => response.kind === "csv:complete")).toBe(
      false,
    );
  });

  it("keeps the active task unchanged across stale chunks and cancels", () => {
    const { runtime, responses } = runtimeHarness();
    runtime.handleMessage(start(1));
    runtime.handleMessage(chunk(2, 0, ["stale"], [1], true));
    runtime.handleMessage({ kind: "csv:cancel", taskId: 2 });
    runtime.handleMessage(chunk(1, 0, ["current"], [1], true));

    expect(responses[1]).toMatchObject({
      kind: "csv:error",
      taskId: 2,
      code: "csv-worker/task-mismatch",
    });
    expect(responses.filter((response) => response.kind === "csv:cancelled")).toEqual(
      [],
    );
    expect(lastResponse(responses)).toMatchObject({
      kind: "csv:complete",
      taskId: 1,
      rowCount: 1,
    });
  });

  it("rejects a duplicate start without replacing the active task", () => {
    const { runtime, responses } = runtimeHarness();
    runtime.handleMessage(start(1));
    runtime.handleMessage(start(2));
    runtime.handleMessage(chunk(1, 0, ["kept"], [1], true));

    expect(responses[1]).toMatchObject({
      kind: "csv:error",
      taskId: 2,
      code: "csv-worker/task-active",
    });
    expect(lastResponse(responses)).toMatchObject({
      kind: "csv:complete",
      taskId: 1,
    });
  });

  it("reports malformed messages only when they carry a valid task id", () => {
    const { runtime, responses } = runtimeHarness();
    runtime.handleMessage({ kind: "csv:chunk", taskId: 7 });
    runtime.handleMessage({ kind: "csv:chunk" });

    expect(responses).toEqual([
      {
        kind: "csv:error",
        taskId: 7,
        code: "csv-worker/invalid-message",
        message: "Invalid CSV Worker message",
      },
    ]);
  });
});

describe("csvExportWorkerRuntime - flattened row continuation", () => {
  it("continues a row across chunks and closes it at offset zero", () => {
    const { runtime, responses } = runtimeHarness();
    runtime.handleMessage(start(1, { encoding: { ...DEFAULT_ENCODING, lineEnding: "\n" } }));
    runtime.handleMessage(chunk(1, 0, ["a"], [], false));
    runtime.handleMessage(chunk(1, 1, ["b"], [0, 1], true));

    expect(new TextDecoder().decode(workerBytes(responses))).toBe("a\nb\n");
    expect(encodedResponses(responses).map((response) => response.rowCount)).toEqual([
      0,
      2,
    ]);
    expect(lastResponse(responses)).toMatchObject({
      kind: "csv:complete",
      rowCount: 2,
      byteLength: 4,
    });
  });

  it("retains values after the final row end as the next partial row", () => {
    const { runtime, responses } = runtimeHarness();
    runtime.handleMessage(
      start(1, { encoding: { ...DEFAULT_ENCODING, lineEnding: "\n" } }),
    );
    runtime.handleMessage(chunk(1, 0, ["closed", "partial"], [1], false));
    runtime.handleMessage(chunk(1, 1, ["continued"], [1], true));

    expect(new TextDecoder().decode(workerBytes(responses))).toBe(
      "closed\npartial,continued\n",
    );
    expect(
      encodedResponses(responses).map((response) => response.rowCount),
    ).toEqual([1, 1]);
  });

  it("encodes duplicate row ends as zero-field rows", () => {
    const { runtime, responses } = runtimeHarness();
    runtime.handleMessage(start(1, { encoding: { ...DEFAULT_ENCODING, lineEnding: "\n" } }));
    runtime.handleMessage(chunk(1, 0, [], [0, 0], true));

    expect(new TextDecoder().decode(workerBytes(responses))).toBe("\n\n");
    expect(encodedResponses(responses)[0]).toMatchObject({ rowCount: 2, final: true });
    expect(lastResponse(responses)).toMatchObject({
      kind: "csv:complete",
      rowCount: 2,
      byteLength: 2,
    });
  });

  it("supports empty final exports with and without a BOM", () => {
    for (const utf8Bom of [false, true]) {
      const { runtime, responses } = runtimeHarness();
      runtime.handleMessage(
        start(1, { encoding: { ...DEFAULT_ENCODING, utf8Bom } }),
      );
      runtime.handleMessage(chunk(1, 0, [], [], true));

      expect(Array.from(workerBytes(responses))).toEqual(
        utf8Bom ? [0xef, 0xbb, 0xbf] : [],
      );
      expect(lastResponse(responses)).toMatchObject({
        kind: "csv:complete",
        rowCount: 0,
        byteLength: utf8Bom ? 3 : 0,
      });
    }
  });

  it("rejects a final marker that leaves a prior partial row open", () => {
    const { runtime, responses } = runtimeHarness();
    runtime.handleMessage(start(1));
    runtime.handleMessage(chunk(1, 0, ["partial"], [], false));
    runtime.handleMessage(chunk(1, 1, [], [], true));

    expect(lastResponse(responses)).toMatchObject({
      kind: "csv:error",
      taskId: 1,
      code: "csv-worker/row-state",
    });
    expect(responses.filter((response) => response.kind === "csv:complete")).toEqual(
      [],
    );
  });
});

describe("csvExportWorkerRuntime - encoding parity and terminals", () => {
  it("preserves native negative-number versus string formula semantics", () => {
    const { runtime, responses } = runtimeHarness();
    runtime.handleMessage(start(1));
    runtime.handleMessage(chunk(1, 0, [-42, "-42"], [2], true));

    expect(workerBytes(responses)).toEqual(
      mainBytes([[-42, "-42"]], DEFAULT_ENCODING),
    );
    expect(new TextDecoder().decode(workerBytes(responses))).toBe(
      "-42,'-42\r\n",
    );
  });

  it("matches main encoding for delimiters, quoting, Unicode, BOM, and line endings", () => {
    const encoding: CsvEncodingOptions = {
      delimiter: ";",
      quoteMode: "minimal",
      lineEnding: "\n",
      utf8Bom: true,
      formulaProtection: "escape",
    };
    const rows: readonly (readonly CsvProjectedValue[])[] = [
      ["a;b", 'he said "hi"', "雪"],
      [-42, "-42", null],
    ];
    const { runtime, responses } = runtimeHarness();
    runtime.handleMessage(start(9, { plannedColumnCount: 1, encoding }));
    runtime.handleMessage(chunk(9, 0, ["a;b", 'he said "hi"'], [], false));
    runtime.handleMessage(
      chunk(9, 1, ["雪", -42, "-42", null], [1, 4], true),
    );

    expect(workerBytes(responses)).toEqual(mainBytes(rows, encoding));
    expect(encodedResponses(responses).map((response) => response.sequence)).toEqual([
      0,
      1,
    ]);
    const complete = lastResponse(responses);
    expect(complete).toMatchObject({ kind: "csv:complete", rowCount: 2 });
    if (complete?.kind !== "csv:complete") {
      throw new Error("expected csv:complete");
    }
    expect(complete.byteLength).toBe(workerBytes(responses).byteLength);
  });

  it("cancels a matching task exactly once and never completes from late chunks", () => {
    const { runtime, responses } = runtimeHarness();
    runtime.handleMessage(start(1));
    runtime.handleMessage({ kind: "csv:cancel", taskId: 1 });
    runtime.handleMessage({ kind: "csv:cancel", taskId: 1 });
    runtime.handleMessage(chunk(1, 0, ["late"], [1], true));

    expect(responses.filter((response) => response.kind === "csv:cancelled")).toEqual([
      { kind: "csv:cancelled", taskId: 1 },
    ]);
    expect(responses.filter((response) => response.kind === "csv:complete")).toEqual(
      [],
    );
  });

  it("imports only encoder and protocol-layer dependencies", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../csvExportWorkerRuntime.ts", import.meta.url),
        "utf8",
      ),
    );
    const imports = Array.from(source.matchAll(/from "([^"]+)"/g), (match) =>
      match[1],
    );
    expect(imports).toEqual([
      "../../../features/csv-export/csvUtf8Encoder",
      "./csvExportProtocol",
      "./csvExportProtocol",
      "./csvExportTaskId",
    ]);
    expect(source).toMatch(
      /active\.expectedSequence = message\.sequence \+ 1/,
    );
    expect(source).not.toMatch(/expectedSequence = saturatingAdd/);
    expect(source).toMatch(/active\.rowCount = saturatingAdd/);
    expect(source).toMatch(/active\.byteLength = saturatingAdd/);
  });
});
