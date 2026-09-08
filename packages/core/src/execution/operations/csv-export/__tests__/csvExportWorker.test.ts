/** CSV Export V1 - Stage 4B Worker entry tests. */

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CsvChunkRequest,
  CsvStartRequest,
  CsvWorkerResponse,
} from "../csvExportProtocol";

interface PostedResponse {
  message: CsvWorkerResponse;
  transfer: Transferable[] | undefined;
}

interface WorkerEntryScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: CsvWorkerResponse, transfer?: Transferable[]): void;
}

class TestWorkerEntryScope implements WorkerEntryScope {
  readonly posted: PostedResponse[] = [];
  private listener: ((event: MessageEvent<unknown>) => void) | null = null;

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    this.listener = listener;
  }

  postMessage(
    message: CsvWorkerResponse,
    transfer?: Transferable[],
  ): void {
    this.posted.push({ message, transfer });
  }

  dispatch(data: unknown): void {
    const listener = this.listener;
    if (listener === null) {
      throw new Error("Worker message listener not installed");
    }
    listener(new MessageEvent("message", { data }));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("csvExportWorker entry", () => {
  it("routes messages and transfers only encoded byte buffers", async () => {
    const scope = new TestWorkerEntryScope();
    vi.stubGlobal("self", scope);
    await import("../csvExportWorker");

    const start: CsvStartRequest = {
      kind: "csv:start",
      taskId: 1,
      plannedColumnCount: 0,
      encoding: {
        delimiter: ",",
        quoteMode: "minimal",
        lineEnding: "\n",
        utf8Bom: true,
        formulaProtection: "escape",
      },
    };
    const finalChunk: CsvChunkRequest = {
      kind: "csv:chunk",
      taskId: 1,
      sequence: 0,
      values: [],
      rowEnds: new Uint32Array(new ArrayBuffer(0)),
      estimatedBytes: 0,
      final: true,
    };

    scope.dispatch(start);
    scope.dispatch(finalChunk);

    expect(scope.posted.map(({ message }) => message.kind)).toEqual([
      "csv:ready",
      "csv:encodedChunk",
      "csv:complete",
    ]);
    expect(scope.posted[0]!.transfer).toBeUndefined();
    const encoded = scope.posted[1]!;
    expect(encoded.message.kind).toBe("csv:encodedChunk");
    if (encoded.message.kind !== "csv:encodedChunk") {
      throw new Error("expected csv:encodedChunk");
    }
    expect(encoded.transfer).toEqual([encoded.message.bytes.buffer]);
    expect(encoded.transfer?.[0]).toBe(encoded.message.bytes.buffer);
    expect(encoded.message.bytes.buffer).toBeInstanceOf(ArrayBuffer);
    expect(scope.posted[2]!.transfer).toBeUndefined();
  });

  it("contains no client, Grid, renderer, sink, or feature imports", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../csvExportWorker.ts", import.meta.url), "utf8"),
    );
    const imports = Array.from(source.matchAll(/from "([^"]+)"/g), (match) =>
      match[1],
    );
    expect(imports).toEqual([
      "./csvExportProtocol",
      "./csvExportProtocol",
      "./csvExportWorkerRuntime",
    ]);
  });
});
