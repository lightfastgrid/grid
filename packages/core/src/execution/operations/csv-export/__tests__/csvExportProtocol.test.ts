/**
 * CSV Export V1 - Stage 4A protocol contract tests.
 */

import { describe, expect, it } from "vitest";

import { estimateCsvProjectedBytes } from "../../../../features/csv-export/estimateCsvProjectedBytes";
import {
  type CsvCancelRequest,
  type CsvChunkRequest,
  type CsvCompleteResponse,
  type CsvEncodedChunkResponse,
  type CsvErrorResponse,
  type CsvReadyResponse,
  type CsvStartRequest,
  type CsvWorkerProjectionValue,
  type CsvWorkerRequest,
  type CsvWorkerResponse,
  getCsvChunkTransferList,
  getCsvEncodedChunkTransferList,
  isCsvWorkerRequest,
  isCsvWorkerResponse,
  isValidCsvChunkRowEnds,
} from "../csvExportProtocol";
import {
  CSV_CHUNK_MAX_COMPLETED_ROWS,
  CSV_CHUNK_MAX_ESTIMATED_BYTES,
  CSV_CHUNK_MAX_VALUES,
} from "../csvProjectionChunkLimits";

function sumTestProjectedBytes(
  values: readonly CsvWorkerProjectionValue[],
): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const cost = estimateCsvProjectedBytes(values[i]!);
    if (total >= Number.MAX_SAFE_INTEGER - cost) return Number.MAX_SAFE_INTEGER;
    total += cost;
  }
  return total;
}

function arrayBufferUint32(values: readonly number[]): Uint32Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(values.length * Uint32Array.BYTES_PER_ELEMENT);
  const view: Uint32Array<ArrayBuffer> = new Uint32Array(buffer);
  for (let i = 0; i < values.length; i++) {
    view[i] = values[i]!;
  }
  return view;
}

function arrayBufferUint8(values: readonly number[]): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(values.length);
  const view: Uint8Array<ArrayBuffer> = new Uint8Array(buffer);
  for (let i = 0; i < values.length; i++) {
    view[i] = values[i]!;
  }
  return view;
}

function startRequest(
  overrides: Partial<CsvStartRequest> = {},
): CsvStartRequest {
  const encoding = {
    delimiter: ",",
    quoteMode: "minimal" as const,
    lineEnding: "\r\n" as const,
    utf8Bom: false,
    formulaProtection: "escape" as const,
    ...overrides.encoding,
  };
  return {
    kind: "csv:start",
    taskId: 1,
    plannedColumnCount: 3,
    ...overrides,
    encoding,
  };
}

function chunkRequest(
  overrides: Partial<CsvChunkRequest> = {},
): CsvChunkRequest {
  const values: CsvWorkerProjectionValue[] = overrides.values ?? ["a", "b"];
  const rowEnds = overrides.rowEnds ?? arrayBufferUint32([values.length]);
  const estimatedBytes =
    overrides.estimatedBytes ?? sumTestProjectedBytes(values);
  return {
    kind: "csv:chunk",
    taskId: 1,
    sequence: 0,
    final: true,
    ...overrides,
    values,
    rowEnds,
    estimatedBytes,
  };
}

describe("csvExportProtocol - message shapes", () => {
  it("accepts every request discriminant and shape", () => {
    const start = startRequest();
    const chunk = chunkRequest();
    const cancel: CsvCancelRequest = { kind: "csv:cancel", taskId: 7 };
    const requests: CsvWorkerRequest[] = [start, chunk, cancel];
    expect(requests.map((message) => message.kind)).toEqual([
      "csv:start",
      "csv:chunk",
      "csv:cancel",
    ]);
    expect(requests.every(isCsvWorkerRequest)).toBe(true);
  });

  it("accepts every response discriminant and shape", () => {
    const ready: CsvReadyResponse = { kind: "csv:ready", taskId: 1 };
    const encoded: CsvEncodedChunkResponse = {
      kind: "csv:encodedChunk",
      taskId: 1,
      sequence: 0,
      bytes: arrayBufferUint8([1, 2, 3]),
      rowCount: 1,
      final: false,
    };
    const complete: CsvCompleteResponse = {
      kind: "csv:complete",
      taskId: 1,
      rowCount: 2,
      byteLength: 9,
    };
    const error: CsvErrorResponse = {
      kind: "csv:error",
      taskId: 1,
      code: "csv-worker/encoding-failed",
      message: "failed",
    };
    const cancelled = { kind: "csv:cancelled", taskId: 1 } as const;
    const responses: CsvWorkerResponse[] = [
      ready,
      encoded,
      complete,
      error,
      cancelled,
    ];
    expect(responses.map((message) => message.kind)).toEqual([
      "csv:ready",
      "csv:encodedChunk",
      "csv:complete",
      "csv:error",
      "csv:cancelled",
    ]);
    expect(responses.every(isCsvWorkerResponse)).toBe(true);
  });

  it("preserves bigint and undefined through structuredClone", () => {
    const values: CsvWorkerProjectionValue[] = [
      1n,
      undefined,
      "x",
      -42,
      true,
      null,
    ];
    const cloned = structuredClone(values);
    expect(cloned[0]).toBe(1n);
    expect(cloned[1]).toBe(undefined);
    expect(cloned).toEqual(values);

    const message = chunkRequest({
      values,
      rowEnds: arrayBufferUint32([6]),
      final: true,
    });
    const clonedMessage: unknown = structuredClone(message);
    expect(isCsvWorkerRequest(clonedMessage)).toBe(true);
    if (!isCsvWorkerRequest(clonedMessage) || clonedMessage.kind !== "csv:chunk") {
      throw new Error("expected chunk");
    }
    expect(clonedMessage.values[0]).toBe(1n);
    expect(clonedMessage.values[1]).toBe(undefined);
  });
});

describe("csvExportProtocol - runtime validation", () => {
  it("rejects malformed requests without copying payloads", () => {
    expect(isCsvWorkerRequest(null)).toBe(false);
    expect(isCsvWorkerRequest({ kind: "csv:nope", taskId: 1 })).toBe(false);
    expect(isCsvWorkerRequest(startRequest({ taskId: -1 }))).toBe(false);
    expect(isCsvWorkerRequest(startRequest({ taskId: 1.5 }))).toBe(false);
    expect(
      isCsvWorkerRequest(
        startRequest({
          encoding: {
            delimiter: ",,",
            quoteMode: "minimal",
            lineEnding: "\r\n",
            utf8Bom: false,
            formulaProtection: "escape",
          },
        }),
      ),
    ).toBe(false);

    const badEncoding: unknown = {
      kind: "csv:start",
      taskId: 1,
      plannedColumnCount: 3,
      encoding: {
        delimiter: ",",
        quoteMode: "sometimes",
        lineEnding: "\r\n",
        utf8Bom: false,
        formulaProtection: "escape",
      },
    };
    expect(isCsvWorkerRequest(badEncoding)).toBe(false);

    const values: CsvWorkerProjectionValue[] = ["a"];
    expect(
      isCsvWorkerRequest(
        chunkRequest({
          sequence: -1,
          values,
          rowEnds: arrayBufferUint32([1]),
        }),
      ),
    ).toBe(false);
    expect(
      isCsvWorkerRequest(
        chunkRequest({
          estimatedBytes: Number.NaN,
          values,
          rowEnds: arrayBufferUint32([1]),
        }),
      ),
    ).toBe(false);

    const objectValueChunk: unknown = {
      kind: "csv:chunk",
      taskId: 1,
      sequence: 0,
      values: ["a", { nope: true }],
      rowEnds: arrayBufferUint32([2]),
      estimatedBytes: 2,
      final: true,
    };
    expect(isCsvWorkerRequest(objectValueChunk)).toBe(false);

    expect(
      isCsvWorkerRequest(
        chunkRequest({
          values: ["a", "b"],
          rowEnds: arrayBufferUint32([3]),
          final: true,
        }),
      ),
    ).toBe(false);
    expect(
      isCsvWorkerRequest(
        chunkRequest({
          values: ["a", "b"],
          rowEnds: arrayBufferUint32([1]),
          final: true,
        }),
      ),
    ).toBe(false);
    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: ["a"],
        rowEnds: [1],
        estimatedBytes: 2,
        final: true,
      }),
    ).toBe(false);
  });

  it("rejects forged estimatedBytes and over-limit counts", () => {
    const values: CsvWorkerProjectionValue[] = ["a", "b"];
    const exact = sumTestProjectedBytes(values);
    expect(
      isCsvWorkerRequest(
        chunkRequest({
          values,
          rowEnds: arrayBufferUint32([2]),
          estimatedBytes: exact,
          final: true,
        }),
      ),
    ).toBe(true);
    expect(
      isCsvWorkerRequest(
        chunkRequest({
          values,
          rowEnds: arrayBufferUint32([2]),
          estimatedBytes: exact + 1,
          final: true,
        }),
      ),
    ).toBe(false);
    expect(
      isCsvWorkerRequest(
        chunkRequest({
          values,
          rowEnds: arrayBufferUint32([2]),
          estimatedBytes: exact - 1,
          final: true,
        }),
      ),
    ).toBe(false);
    expect(
      isCsvWorkerRequest(
        chunkRequest({
          values,
          rowEnds: arrayBufferUint32([2]),
          estimatedBytes: exact + 0.5,
          final: true,
        }),
      ),
    ).toBe(false);

    const tooManyValues = Array.from(
      { length: CSV_CHUNK_MAX_VALUES + 1 },
      () => null,
    );
    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: tooManyValues,
        rowEnds: arrayBufferUint32([tooManyValues.length]),
        estimatedBytes: 0,
        final: true,
      }),
    ).toBe(false);

    const exactValues = Array.from({ length: CSV_CHUNK_MAX_VALUES }, () => null);
    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: exactValues,
        rowEnds: arrayBufferUint32([exactValues.length]),
        estimatedBytes: 0,
        final: true,
      }),
    ).toBe(true);

    const tooManyRows = arrayBufferUint32(
      Array.from({ length: CSV_CHUNK_MAX_COMPLETED_ROWS + 1 }, () => 0),
    );
    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: [],
        rowEnds: tooManyRows,
        estimatedBytes: 0,
        final: true,
      }),
    ).toBe(false);

    const exactRows = arrayBufferUint32(
      Array.from({ length: CSV_CHUNK_MAX_COMPLETED_ROWS }, () => 0),
    );
    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: [],
        rowEnds: exactRows,
        estimatedBytes: 0,
        final: true,
      }),
    ).toBe(true);
  });

  it("reserves MAX_SAFE_INTEGER sequence for final chunks", () => {
    expect(
      isCsvWorkerRequest(
        chunkRequest({
          sequence: Number.MAX_SAFE_INTEGER,
          values: ["partial"],
          rowEnds: arrayBufferUint32([]),
          final: false,
        }),
      ),
    ).toBe(false);

    expect(
      isCsvWorkerRequest(
        chunkRequest({
          sequence: Number.MAX_SAFE_INTEGER,
          values: ["final"],
          rowEnds: arrayBufferUint32([1]),
          final: true,
        }),
      ),
    ).toBe(true);
  });

  it("accepts only the oversized single-value exception shape", () => {
    const huge = "x".repeat(CSV_CHUNK_MAX_ESTIMATED_BYTES);
    const estimatedBytes = sumTestProjectedBytes([huge]);
    expect(estimatedBytes).toBeGreaterThan(CSV_CHUNK_MAX_ESTIMATED_BYTES);

    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: [huge],
        rowEnds: arrayBufferUint32([]),
        estimatedBytes,
        final: false,
      }),
    ).toBe(true);

    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: [huge],
        rowEnds: arrayBufferUint32([]),
        estimatedBytes,
        final: true,
      }),
    ).toBe(false);

    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: [huge],
        rowEnds: arrayBufferUint32([1]),
        estimatedBytes,
        final: false,
      }),
    ).toBe(false);

    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: [huge, "y"],
        rowEnds: arrayBufferUint32([]),
        estimatedBytes: sumTestProjectedBytes([huge, "y"]),
        final: false,
      }),
    ).toBe(false);
  });

  it("rejects zero-progress non-final empty chunks while preserving valid empties", () => {
    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: [],
        rowEnds: arrayBufferUint32([]),
        estimatedBytes: 0,
        final: false,
      }),
    ).toBe(false);

    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: [],
        rowEnds: arrayBufferUint32([]),
        estimatedBytes: 0,
        final: true,
      }),
    ).toBe(true);

    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: [],
        rowEnds: arrayBufferUint32([0, 0]),
        estimatedBytes: 0,
        final: false,
      }),
    ).toBe(true);

    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: ["a", "b"],
        rowEnds: arrayBufferUint32([]),
        estimatedBytes: sumTestProjectedBytes(["a", "b"]),
        final: false,
      }),
    ).toBe(true);
  });

  it("rejects SharedArrayBuffer-backed typed arrays", () => {
    if (typeof SharedArrayBuffer === "undefined") {
      expect(typeof SharedArrayBuffer).toBe("undefined");
      return;
    }

    const sharedEnds = new Uint32Array(new SharedArrayBuffer(4));
    sharedEnds[0] = 1;
    expect(
      isCsvWorkerRequest({
        kind: "csv:chunk",
        taskId: 1,
        sequence: 0,
        values: ["a"],
        rowEnds: sharedEnds,
        estimatedBytes: 2,
        final: true,
      }),
    ).toBe(false);

    const sharedBytes = new Uint8Array(new SharedArrayBuffer(2));
    expect(
      isCsvWorkerResponse({
        kind: "csv:encodedChunk",
        taskId: 1,
        sequence: 0,
        bytes: sharedBytes,
        rowCount: 1,
        final: false,
      }),
    ).toBe(false);
  });

  it("rejects malformed responses", () => {
    expect(isCsvWorkerResponse({ kind: "csv:ready" })).toBe(false);
    expect(
      isCsvWorkerResponse({
        kind: "csv:error",
        taskId: 1,
        code: "csv-worker/not-stable",
        message: "x",
      }),
    ).toBe(false);
    expect(
      isCsvWorkerResponse({
        kind: "csv:encodedChunk",
        taskId: 1,
        sequence: 0,
        bytes: [1, 2],
        rowCount: 1,
        final: false,
      }),
    ).toBe(false);
    expect(
      isCsvWorkerResponse({
        kind: "csv:complete",
        taskId: 1,
        rowCount: -1,
        byteLength: 0,
      }),
    ).toBe(false);
  });

  it("validates rowEnds cumulatively without copying values", () => {
    const values = ["a", "b", "c", "d"];
    expect(isValidCsvChunkRowEnds(arrayBufferUint32([2, 4]), values.length)).toBe(
      true,
    );
    expect(
      isValidCsvChunkRowEnds(arrayBufferUint32([0, 0, 4]), values.length),
    ).toBe(true);
    expect(isValidCsvChunkRowEnds(arrayBufferUint32([3, 2]), values.length)).toBe(
      false,
    );
    expect(isValidCsvChunkRowEnds(arrayBufferUint32([5]), values.length)).toBe(
      false,
    );
  });
});

describe("csvExportProtocol - transfer ownership", () => {
  it("transfers ArrayBuffer-backed rowEnds by identity", () => {
    const rowEnds = arrayBufferUint32([2, 4]);
    const message = chunkRequest({
      values: ["a", "b", "c", "d"],
      rowEnds,
      final: true,
    });
    expect(isCsvWorkerRequest(message)).toBe(true);
    const list = getCsvChunkTransferList(message);
    expect(list).toHaveLength(1);
    expect(list[0]).toBe(rowEnds.buffer);
    expect(list).not.toBe(getCsvChunkTransferList(message));
  });

  it("transfers ArrayBuffer-backed encoded bytes by identity", () => {
    const bytes = arrayBufferUint8([9, 8, 7]);
    const message: CsvEncodedChunkResponse = {
      kind: "csv:encodedChunk",
      taskId: 3,
      sequence: 2,
      bytes,
      rowCount: 1,
      final: true,
    };
    expect(isCsvWorkerResponse(message)).toBe(true);
    const list = getCsvEncodedChunkTransferList(message);
    expect(list).toEqual([bytes.buffer]);
    expect(list[0]).toBe(bytes.buffer);
  });

  it("does not put values on a transfer list or copy them to validate", () => {
    const values: CsvWorkerProjectionValue[] = ["keep", 1n, undefined];
    const message = chunkRequest({
      values,
      rowEnds: arrayBufferUint32([3]),
      final: true,
    });
    expect(isCsvWorkerRequest(message)).toBe(true);
    expect(getCsvChunkTransferList(message)).toEqual([message.rowEnds.buffer]);
    expect(message.values).toBe(values);
    expect(message.values[1]).toBe(1n);
  });
});

describe("csvExportProtocol - surface isolation", () => {
  it("protocol module types do not reference row/DOM/Grid/sink surfaces", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../csvExportProtocol.ts", import.meta.url),
        "utf8",
      ),
    );
    expect(source).not.toMatch(
      /\b(RowData|ColumnDef|GridState|HTMLElement|Document|CsvOutputSink|processCell|shouldExportRow)\b/,
    );
  });
});
