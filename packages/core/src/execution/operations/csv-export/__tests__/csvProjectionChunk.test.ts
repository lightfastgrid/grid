/**
 * CSV Export V1 - Stage 4A bounded projection-chunk builder tests.
 */

import { describe, expect, it } from "vitest";

import { estimateCsvProjectedBytes } from "../../../../features/csv-export/estimateCsvProjectedBytes";
import { isCsvWorkerRequest } from "../csvExportProtocol";
import {
  CSV_CHUNK_MAX_COMPLETED_ROWS,
  CSV_CHUNK_MAX_ESTIMATED_BYTES,
  CSV_CHUNK_MAX_VALUES,
  CsvProjectionChunkBuilder,
  resolveCsvProjectionChunkLimits,
} from "../csvProjectionChunk";

function drainPending(
  builder: CsvProjectionChunkBuilder,
): ReturnType<CsvProjectionChunkBuilder["takeSealed"]> {
  return builder.takeSealed();
}

describe("csvProjectionChunk - taskId and protocol emission", () => {
  it("rejects invalid constructor taskIds before retaining arrays", () => {
    for (const taskId of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => new CsvProjectionChunkBuilder(taskId)).toThrow(/taskId/);
    }
  });

  it("accepts taskId 0 and MAX_SAFE_INTEGER and emits protocol-valid messages", () => {
    for (const taskId of [0, Number.MAX_SAFE_INTEGER]) {
      const builder = new CsvProjectionChunkBuilder(taskId);
      expect(builder.append("a")).toBeNull();
      expect(builder.endRow()).toBeNull();
      const finalChunk = builder.finalize();
      expect(finalChunk.taskId).toBe(taskId);
      expect(isCsvWorkerRequest(finalChunk)).toBe(true);
    }
  });

  it("emits only protocol-valid messages from a valid builder", () => {
    const builder = new CsvProjectionChunkBuilder(42, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: 2,
      maxCompletedRows: 100,
    });
    const messages = [];
    const first = builder.append("a");
    if (first) messages.push(first);
    expect(builder.append("b")).toBeNull();
    const sealed = builder.append("c");
    if (sealed) messages.push(sealed);
    expect(builder.endRow()).toBeNull();
    messages.push(builder.finalize());
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every(isCsvWorkerRequest)).toBe(true);
  });

  it("never emits an empty non-final chunk", () => {
    const builder = new CsvProjectionChunkBuilder(7, {
      maxEstimatedBytes: 8,
      maxValues: 2,
      maxCompletedRows: 2,
    });
    const emitted: Array<
      ReturnType<CsvProjectionChunkBuilder["finalize"]>
    > = [];
    const record = (chunk: ReturnType<CsvProjectionChunkBuilder["finalize"]> | null) => {
      if (chunk === null) return;
      emitted.push(chunk);
      expect(chunk.final || chunk.values.length > 0 || chunk.rowEnds.length > 0).toBe(
        true,
      );
    };

    record(builder.append(1));
    record(builder.append(2));
    record(builder.append("x".repeat(20)));
    record(builder.takeSealed());
    record(builder.endRow());
    record(builder.endRow());
    record(builder.endRow());
    record(builder.finalize());

    expect(emitted.length).toBeGreaterThan(0);
    expect(
      emitted.every(
        (chunk) =>
          chunk.final || chunk.values.length > 0 || chunk.rowEnds.length > 0,
      ),
    ).toBe(true);
    expect(emitted.every(isCsvWorkerRequest)).toBe(true);
  });

  it("rejects non-final sequence exhaustion before releasing buffered state", () => {
    const builder = new CsvProjectionChunkBuilder(8, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: 1,
      maxCompletedRows: CSV_CHUNK_MAX_COMPLETED_ROWS,
    });
    expect(builder.append("retained")).toBeNull();
    expect(Reflect.set(builder, "nextSequence", Number.MAX_SAFE_INTEGER)).toBe(
      true,
    );

    expect(() => builder.append("not-consumed")).toThrow(/sequence exhausted/);
    expect(builder.sequence).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(builder.sequence)).toBe(true);
    expect(builder.valueCount).toBe(1);
    expect(builder.currentEstimatedBytes).toBe(
      estimateCsvProjectedBytes("retained"),
    );
    expect(builder.hasOpenRow).toBe(true);
  });

  it("allows a final MAX_SAFE_INTEGER sequence without advancing it", () => {
    const builder = new CsvProjectionChunkBuilder(9);
    expect(builder.append("final")).toBeNull();
    expect(builder.endRow()).toBeNull();
    expect(Reflect.set(builder, "nextSequence", Number.MAX_SAFE_INTEGER)).toBe(
      true,
    );

    const finalChunk = builder.finalize();
    expect(finalChunk.sequence).toBe(Number.MAX_SAFE_INTEGER);
    expect(finalChunk.final).toBe(true);
    expect(isCsvWorkerRequest(finalChunk)).toBe(true);
    expect(builder.sequence).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(builder.sequence)).toBe(true);
  });

  it("exports only canonical limit names from the builder module", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../csvProjectionChunk.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toMatch(/DEFAULT_CSV_CHUNK_MAX_/);
    expect(source).toMatch(/CSV_CHUNK_MAX_ESTIMATED_BYTES/);
    expect(source).toMatch(/CSV_CHUNK_MAX_VALUES/);
    expect(source).toMatch(/CSV_CHUNK_MAX_COMPLETED_ROWS/);
  });
});

describe("csvProjectionChunk - limits and sealing", () => {
  it("fits exact limits before sealing on the next unit", () => {
    const bytes = new CsvProjectionChunkBuilder(1, {
      maxEstimatedBytes: 16,
      maxValues: 100,
      maxCompletedRows: 100,
    });
    expect(bytes.append(1)).toBeNull();
    expect(bytes.append(2)).toBeNull();
    expect(bytes.currentEstimatedBytes).toBe(16);
    const sealedBytes = bytes.append(3);
    expect(sealedBytes).not.toBeNull();
    expect(sealedBytes!.values).toEqual([1, 2]);
    expect(sealedBytes!.estimatedBytes).toBe(16);
    expect(bytes.valueCount).toBe(1);
    expect(bytes.currentEstimatedBytes).toBe(8);

    const values = new CsvProjectionChunkBuilder(2, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: 2,
      maxCompletedRows: 100,
    });
    expect(values.append("a")).toBeNull();
    expect(values.append("b")).toBeNull();
    const sealedValues = values.append("c");
    expect(sealedValues!.values).toEqual(["a", "b"]);
    expect(values.valueCount).toBe(1);

    const rows = new CsvProjectionChunkBuilder(3, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: 100,
      maxCompletedRows: 2,
    });
    expect(rows.endRow()).toBeNull();
    expect(rows.endRow()).toBeNull();
    const sealedRows = rows.endRow();
    expect(sealedRows!.rowEnds).toEqual(Uint32Array.of(0, 0));
    expect(rows.completedRowCount).toBe(1);
  });

  it("crosses each independent limit and yields", () => {
    const byBytes = new CsvProjectionChunkBuilder(1, {
      maxEstimatedBytes: 8,
      maxValues: 100,
      maxCompletedRows: 100,
    });
    expect(byBytes.append(1)).toBeNull();
    expect(byBytes.append(2)?.estimatedBytes).toBe(8);

    const byValues = new CsvProjectionChunkBuilder(1, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: 1,
      maxCompletedRows: 100,
    });
    expect(byValues.append(null)).toBeNull();
    expect(byValues.append(undefined)?.values).toEqual([null]);

    const byRows = new CsvProjectionChunkBuilder(1, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: 100,
      maxCompletedRows: 1,
    });
    expect(byRows.append("x")).toBeNull();
    expect(byRows.endRow()).toBeNull();
    expect(byRows.endRow()?.rowEnds).toEqual(Uint32Array.of(1));
    expect(byRows.completedRowCount).toBe(1);
  });

  it("accepts one oversized value into an empty chunk then seals", () => {
    const huge = "x".repeat(100);
    expect(estimateCsvProjectedBytes(huge)).toBeGreaterThan(8);
    const builder = new CsvProjectionChunkBuilder(9, {
      maxEstimatedBytes: 8,
      maxValues: 100,
      maxCompletedRows: 100,
    });
    const sealed = builder.append(huge);
    expect(sealed).not.toBeNull();
    expect(sealed!.values).toEqual([huge]);
    expect(sealed!.final).toBe(false);
    expect(builder.isEmpty).toBe(true);
    expect(builder.hasOpenRow).toBe(true);
  });

  it("keeps thousands of null/undefined values value-count bounded", () => {
    const builder = new CsvProjectionChunkBuilder(1, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: 8,
      maxCompletedRows: CSV_CHUNK_MAX_COMPLETED_ROWS,
    });
    let sealedCount = 0;
    for (let i = 0; i < 40; i++) {
      const sealed = builder.append(i % 2 === 0 ? null : undefined);
      if (sealed) {
        sealedCount++;
        expect(sealed.values.length).toBe(8);
        expect(sealed.estimatedBytes).toBe(0);
        expect(drainPending(builder)).toBeNull();
      }
    }
    expect(sealedCount).toBe(4);
    expect(builder.valueCount).toBe(8);
  });

  it("keeps thousands of zero-field rows row-count bounded", () => {
    const builder = new CsvProjectionChunkBuilder(1, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: CSV_CHUNK_MAX_VALUES,
      maxCompletedRows: 8,
    });
    let sealedCount = 0;
    for (let i = 0; i < 40; i++) {
      const sealed = builder.endRow();
      if (sealed) {
        sealedCount++;
        expect(sealed.rowEnds.length).toBe(8);
        expect(Array.from(sealed.rowEnds)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(builder.completedRowCount).toBe(1);
      }
    }
    expect(sealedCount).toBe(4);
    expect(builder.completedRowCount).toBe(8);
  });

  it("sanitizes invalid limits and clamps overrides above wire maxima", () => {
    const builder = new CsvProjectionChunkBuilder(1, {
      maxEstimatedBytes: Number.NaN,
      maxValues: 0,
      maxCompletedRows: -3,
    });
    for (let i = 0; i < CSV_CHUNK_MAX_VALUES; i++) {
      expect(builder.append(null)).toBeNull();
    }
    const sealed = builder.append(null);
    expect(sealed).not.toBeNull();
    expect(sealed!.values).toHaveLength(CSV_CHUNK_MAX_VALUES);
    expect(CSV_CHUNK_MAX_ESTIMATED_BYTES).toBe(64 * 1024);
    expect(CSV_CHUNK_MAX_COMPLETED_ROWS).toBe(256);

    expect(
      resolveCsvProjectionChunkLimits({
        maxEstimatedBytes: 10_000_000,
        maxValues: 99_000,
        maxCompletedRows: 9_000,
      }),
    ).toEqual({
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: CSV_CHUNK_MAX_VALUES,
      maxCompletedRows: CSV_CHUNK_MAX_COMPLETED_ROWS,
    });
  });
});

describe("csvProjectionChunk - logical row and terminal lifecycle", () => {
  it("rejects finalize after oversized-alone seal before endRow", () => {
    const huge = "x".repeat(100);
    const builder = new CsvProjectionChunkBuilder(1, {
      maxEstimatedBytes: 8,
      maxValues: 100,
      maxCompletedRows: 100,
    });
    expect(builder.append(huge)).not.toBeNull();
    expect(builder.hasOpenRow).toBe(true);
    expect(() => builder.finalize()).toThrow(/open/);
  });

  it("rejects finalize after oversized pending takeSealed before endRow", () => {
    const huge = "z".repeat(20);
    const builder = new CsvProjectionChunkBuilder(2, {
      maxEstimatedBytes: 8,
      maxValues: 100,
      maxCompletedRows: 100,
    });
    expect(builder.append(1)).toBeNull();
    expect(builder.append(huge)).not.toBeNull();
    expect(drainPending(builder)).not.toBeNull();
    expect(builder.hasOpenRow).toBe(true);
    expect(() => builder.finalize()).toThrow(/open/);
  });

  it("allows endRow after oversized seal then a values-empty final close", () => {
    const huge = "x".repeat(100);
    const builder = new CsvProjectionChunkBuilder(3, {
      maxEstimatedBytes: 8,
      maxValues: 100,
      maxCompletedRows: 100,
    });
    expect(builder.append(huge)).not.toBeNull();
    expect(builder.endRow()).toBeNull();
    expect(builder.hasOpenRow).toBe(false);
    const finalChunk = builder.finalize();
    expect(finalChunk.values).toEqual([]);
    expect(Array.from(finalChunk.rowEnds)).toEqual([0]);
    expect(finalChunk.final).toBe(true);
    expect(isCsvWorkerRequest(finalChunk)).toBe(true);
  });

  it("keeps a wide row logically open across ordinary chunk boundaries", () => {
    const builder = new CsvProjectionChunkBuilder(4, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: 2,
      maxCompletedRows: 100,
    });
    expect(builder.append("a")).toBeNull();
    expect(builder.append("b")).toBeNull();
    const sealed = builder.append("c");
    expect(sealed!.rowEnds.length).toBe(0);
    expect(builder.hasOpenRow).toBe(true);
    expect(builder.valueCount).toBe(1);
    expect(() => builder.finalize()).toThrow(/open/);
    expect(builder.endRow()).toBeNull();
    expect(builder.hasOpenRow).toBe(false);
    expect(builder.finalize().final).toBe(true);
  });

  it("makes finalization terminal and blocks later sequences", () => {
    const builder = new CsvProjectionChunkBuilder(5);
    expect(builder.append("a")).toBeNull();
    expect(builder.endRow()).toBeNull();
    const finalChunk = builder.finalize();
    expect(finalChunk.sequence).toBe(0);
    expect(finalChunk.final).toBe(true);
    expect(builder.isFinalized).toBe(true);
    expect(() => builder.append("b")).toThrow(/finalized/);
    expect(() => builder.endRow()).toThrow(/finalized/);
    expect(() => builder.finalize()).toThrow(/finalized/);
    expect(builder.takeSealed()).toBeNull();
    expect(builder.sequence).toBe(0);

    builder.discard();
    expect(builder.isDiscarded).toBe(true);
    builder.discard();
    expect(builder.takeSealed()).toBeNull();
  });
});

describe("csvProjectionChunk - rowEnds and continuity", () => {
  it("flattens multiple rows with cumulative rowEnds", () => {
    const builder = new CsvProjectionChunkBuilder(4);
    expect(builder.append("a")).toBeNull();
    expect(builder.append("b")).toBeNull();
    expect(builder.endRow()).toBeNull();
    expect(builder.append(1)).toBeNull();
    expect(builder.endRow()).toBeNull();
    expect(builder.endRow()).toBeNull(); // zero-field
    const finalChunk = builder.finalize();
    expect(isCsvWorkerRequest(finalChunk)).toBe(true);
    expect(finalChunk.values).toEqual(["a", "b", 1]);
    expect(Array.from(finalChunk.rowEnds)).toEqual([2, 3, 3]);
    expect(finalChunk.final).toBe(true);
    expect(finalChunk.sequence).toBe(0);
  });

  it("continues a very wide row across chunks", () => {
    const builder = new CsvProjectionChunkBuilder(5, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: 3,
      maxCompletedRows: 100,
    });
    expect(builder.append("a")).toBeNull();
    expect(builder.append("b")).toBeNull();
    expect(builder.append("c")).toBeNull();
    const first = builder.append("d");
    expect(first).not.toBeNull();
    expect(first!.values).toEqual(["a", "b", "c"]);
    expect(first!.rowEnds.length).toBe(0);
    expect(first!.final).toBe(false);
    expect(builder.valueCount).toBe(1);
    expect(builder.hasOpenRow).toBe(true);

    expect(builder.append("e")).toBeNull();
    expect(builder.append("f")).toBeNull();
    const second = builder.append("g");
    expect(second!.values).toEqual(["d", "e", "f"]);
    expect(builder.valueCount).toBe(1);
    expect(builder.endRow()).toBeNull();
    const finalChunk = builder.finalize();
    expect(finalChunk.values).toEqual(["g"]);
    expect(Array.from(finalChunk.rowEnds)).toEqual([1]);
    expect(finalChunk.sequence).toBe(2);
  });

  it("keeps variable-width structured rows valid", () => {
    const builder = new CsvProjectionChunkBuilder(6, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: 100,
      maxCompletedRows: 100,
    });
    expect(builder.append("title")).toBeNull();
    expect(builder.endRow()).toBeNull();
    expect(builder.append("a")).toBeNull();
    expect(builder.append("b")).toBeNull();
    expect(builder.append("c")).toBeNull();
    expect(builder.endRow()).toBeNull();
    expect(builder.endRow()).toBeNull();
    const chunk = builder.finalize();
    expect(Array.from(chunk.rowEnds)).toEqual([1, 4, 4]);
    expect(chunk.values).toEqual(["title", "a", "b", "c"]);
  });

  it("rejects finalization of an open row", () => {
    const builder = new CsvProjectionChunkBuilder(7);
    expect(builder.append("open")).toBeNull();
    expect(() => builder.finalize()).toThrow(/open/);
  });

  it("allows an empty final marker when no row is open", () => {
    const empty = new CsvProjectionChunkBuilder(8).finalize();
    expect(empty.values).toEqual([]);
    expect(empty.rowEnds.length).toBe(0);
    expect(empty.final).toBe(true);
    expect(empty.estimatedBytes).toBe(0);

    const builder = new CsvProjectionChunkBuilder(8, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: 1,
      maxCompletedRows: 100,
    });
    expect(builder.append("a")).toBeNull();
    expect(builder.endRow()).toBeNull();
    const sealed = builder.append("b");
    expect(sealed).not.toBeNull();
    expect(sealed!.final).toBe(false);
    expect(Array.from(sealed!.rowEnds)).toEqual([1]);
    expect(builder.endRow()).toBeNull();
    const finalChunk = builder.finalize();
    expect(finalChunk.values).toEqual(["b"]);
    expect(finalChunk.final).toBe(true);
  });

  it("assigns strictly monotonic sequences", () => {
    const builder = new CsvProjectionChunkBuilder(9, {
      maxEstimatedBytes: CSV_CHUNK_MAX_ESTIMATED_BYTES,
      maxValues: 1,
      maxCompletedRows: 100,
    });
    const sequences: number[] = [];
    for (const value of ["a", "b", "c"]) {
      const sealed = builder.append(value);
      if (sealed) sequences.push(sealed.sequence);
      expect(builder.endRow()).toBeNull();
    }
    sequences.push(builder.finalize().sequence);
    expect(sequences).toEqual([0, 1, 2]);
  });

  it("discard releases partial ownership and blocks further use", () => {
    const builder = new CsvProjectionChunkBuilder(10);
    expect(builder.append("x")).toBeNull();
    expect(builder.append(1n)).toBeNull();
    builder.discard();
    expect(builder.isEmpty).toBe(true);
    expect(builder.valueCount).toBe(0);
    expect(builder.hasOpenRow).toBe(false);
    expect(() => builder.append("y")).toThrow(/discarded/);
    expect(() => builder.endRow()).toThrow(/discarded/);
    expect(() => builder.finalize()).toThrow(/discarded/);
  });

  it("parks an oversized follow-up seal after yielding a full chunk", () => {
    const huge = "z".repeat(20);
    const builder = new CsvProjectionChunkBuilder(11, {
      maxEstimatedBytes: 8,
      maxValues: 100,
      maxCompletedRows: 100,
    });
    expect(builder.append(1)).toBeNull();
    const prior = builder.append(huge);
    expect(prior!.values).toEqual([1]);
    const followUp = drainPending(builder);
    expect(followUp).not.toBeNull();
    expect(followUp!.values).toEqual([huge]);
    expect(builder.isEmpty).toBe(true);
    expect(builder.hasOpenRow).toBe(true);
    expect(builder.takeSealed()).toBeNull();
  });
});
