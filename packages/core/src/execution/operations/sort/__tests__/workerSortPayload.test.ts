import { describe, expect, it } from "vitest";

import type { RowData } from "../../../../types";
import type { WorkerSortEligibility } from "../sortWorkerEligibility";
import {
  buildWorkerSortPayload,
  isWorkerSortRowValue,
} from "../sortWorkerPayload";

// ── Helpers ───────────────────────────────────────────────────────────

function eligible(
  entries: WorkerSortEligibility["entries"],
): WorkerSortEligibility {
  return { eligible: true, entries };
}

function ineligible(reason: string): WorkerSortEligibility {
  return { eligible: false, entries: [], reason };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("buildWorkerSortPayload", () => {
  // ── Ineligible guard ────────────────────────────────────────────────

  it("returns null when eligibility is false", () => {
    const rows: RowData[] = [{ score: 1 }];
    expect(buildWorkerSortPayload(rows, ineligible("value-getter"))).toBeNull();
  });

  it("returns null for empty-sort reason", () => {
    expect(buildWorkerSortPayload([], ineligible("empty-sort"))).toBeNull();
  });

  // ── Single field (columnar) ─────────────────────────────────────────

  it("single field produces one value column in source order", () => {
    const rows: RowData[] = [
      { score: 10, name: "alice", age: 30 },
      { score: 20, name: "bob", age: 25 },
    ];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "score", dir: 1, pathParts: null },
    ]));
    expect(result).not.toBeNull();
    expect(result!.rowCount).toBe(2);
    expect(result!.valuesByEntry.length).toBe(1);
    expect(result!.valuesByEntry[0]).toEqual([10, 20]);
  });

  // ── Multi-column (columnar) ─────────────────────────────────────────

  it("multi-column payload produces one value column per entry", () => {
    const rows: RowData[] = [
      { score: 10, name: "alice", age: 30, extra: "ignored" },
      { score: 20, name: "bob", age: 25, extra: "ignored" },
    ];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "score", dir: -1, pathParts: null },
      { field: "name", dir: 1, pathParts: null },
    ]));
    expect(result).not.toBeNull();
    expect(result!.valuesByEntry.length).toBe(2);
    expect(result!.valuesByEntry[0]).toEqual([10, 20]);
    expect(result!.valuesByEntry[1]).toEqual(["alice", "bob"]);
  });

  it("unused fields are not included in any value column", () => {
    const rows: RowData[] = [
      { a: 1, b: 2, c: 3, d: 4 },
    ];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "b", dir: 1, pathParts: null },
    ]));
    expect(result).not.toBeNull();
    expect(result!.valuesByEntry.length).toBe(1);
    expect(result!.valuesByEntry[0]).toEqual([2]);
  });

  // ── Dot-path resolution ─────────────────────────────────────────────

  it("dot-path resolves nested values into value column", () => {
    const rows: RowData[] = [
      { address: { city: "NYC" } },
      { address: { city: "LA" } },
    ];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "address.city", dir: 1, pathParts: ["address", "city"] },
    ]));
    expect(result).not.toBeNull();
    expect(result!.valuesByEntry[0]).toEqual(["NYC", "LA"]);
  });

  it("missing dot-path value becomes undefined", () => {
    const rows: RowData[] = [
      { address: { city: "NYC" } },
      { address: {} },
      { other: 1 },
    ];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "address.city", dir: 1, pathParts: ["address", "city"] },
    ]));
    expect(result).not.toBeNull();
    expect(result!.valuesByEntry[0]![0]).toBe("NYC");
    expect(result!.valuesByEntry[0]![1]).toBeUndefined();
    expect(result!.valuesByEntry[0]![2]).toBeUndefined();
  });

  it("deeply nested dot-path resolves correctly", () => {
    const rows: RowData[] = [
      { a: { b: { c: { d: 42 } } } },
    ];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "a.b.c.d", dir: 1, pathParts: ["a", "b", "c", "d"] },
    ]));
    expect(result).not.toBeNull();
    expect(result!.valuesByEntry[0]![0]).toBe(42);
  });

  // ── Source order preservation ────────────────────────────────────────

  it("preserves source row order in value column", () => {
    const rows: RowData[] = [
      { score: 30 },
      { score: 10 },
      { score: 20 },
    ];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "score", dir: 1, pathParts: null },
    ]));
    expect(result).not.toBeNull();
    expect(result!.valuesByEntry[0]).toEqual([30, 10, 20]);
  });

  // ── Immutability ────────────────────────────────────────────────────

  it("does not mutate source rows", () => {
    const rows: RowData[] = [
      { score: 5, name: "x", extra: "keep" },
    ];
    const before = JSON.stringify(rows);
    buildWorkerSortPayload(rows, eligible([
      { field: "score", dir: 1, pathParts: null },
    ]));
    expect(JSON.stringify(rows)).toBe(before);
  });

  // ── Primitive value coverage ────────────────────────────────────────

  it("handles null values", () => {
    const rows: RowData[] = [{ score: null }];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "score", dir: 1, pathParts: null },
    ]));
    expect(result).not.toBeNull();
    expect(result!.valuesByEntry[0]![0]).toBeNull();
  });

  it("handles undefined values", () => {
    const rows: RowData[] = [{ score: undefined }];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "score", dir: 1, pathParts: null },
    ]));
    expect(result).not.toBeNull();
    expect(result!.valuesByEntry[0]![0]).toBeUndefined();
  });

  it("handles string values", () => {
    const rows: RowData[] = [{ name: "alice" }];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "name", dir: 1, pathParts: null },
    ]));
    expect(result).not.toBeNull();
    expect(result!.valuesByEntry[0]![0]).toBe("alice");
  });

  it("handles number values", () => {
    const rows: RowData[] = [{ score: 42 }];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "score", dir: 1, pathParts: null },
    ]));
    expect(result).not.toBeNull();
    expect(result!.valuesByEntry[0]![0]).toBe(42);
  });

  it("handles boolean values", () => {
    const rows: RowData[] = [{ active: true }, { active: false }];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "active", dir: 1, pathParts: null },
    ]));
    expect(result).not.toBeNull();
    expect(result!.valuesByEntry[0]).toEqual([true, false]);
  });

  it("handles missing field (not on row) as undefined", () => {
    const rows: RowData[] = [{ other: 1 }];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "score", dir: 1, pathParts: null },
    ]));
    expect(result).not.toBeNull();
    expect(result!.valuesByEntry[0]![0]).toBeUndefined();
  });

  // ── Unsupported value types ─────────────────────────────────────────

  it("object value returns null (fallback to main thread)", () => {
    const rows: RowData[] = [{ data: { nested: 1 } }];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "data", dir: 1, pathParts: null },
    ]));
    expect(result).toBeNull();
  });

  it("function value returns null (fallback to main thread)", () => {
    const rows: RowData[] = [{ data: () => 42 }];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "data", dir: 1, pathParts: null },
    ]));
    expect(result).toBeNull();
  });

  it("symbol value returns null (fallback to main thread)", () => {
    const rows: RowData[] = [{ data: Symbol("test") }];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "data", dir: 1, pathParts: null },
    ]));
    expect(result).toBeNull();
  });

  it("bigint value returns null (fallback to main thread)", () => {
    const rows: RowData[] = [{ data: BigInt(42) }];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "data", dir: 1, pathParts: null },
    ]));
    expect(result).toBeNull();
  });

  it("unsupported value in second row returns null", () => {
    const rows: RowData[] = [
      { score: 1 },
      { score: { complex: true } },
    ];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "score", dir: 1, pathParts: null },
    ]));
    expect(result).toBeNull();
  });

  it("unsupported value in second entry returns null", () => {
    const rows: RowData[] = [
      { score: 1, data: [1, 2] },
    ];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "score", dir: 1, pathParts: null },
      { field: "data", dir: 1, pathParts: null },
    ]));
    expect(result).toBeNull();
  });

  // ── Entries pass-through ────────────────────────────────────────────

  it("entries in payload match eligibility entries", () => {
    const entries = [
      { field: "score", dir: -1 as const, pathParts: null },
      { field: "name", dir: 1 as const, pathParts: null },
    ];
    const result = buildWorkerSortPayload(
      [{ score: 1, name: "a" }],
      eligible(entries),
    );
    expect(result).not.toBeNull();
    expect(result!.entries).toBe(entries);
  });

  // ── rowCount ────────────────────────────────────────────────────────

  it("rowCount matches number of rows", () => {
    const rows: RowData[] = [{ v: 1 }, { v: 2 }, { v: 3 }];
    const result = buildWorkerSortPayload(rows, eligible([
      { field: "v", dir: 1, pathParts: null },
    ]));
    expect(result).not.toBeNull();
    expect(result!.rowCount).toBe(3);
    expect(result!.rowCount).toBe(result!.valuesByEntry[0]!.length);
  });

  it("empty rows array gives rowCount 0", () => {
    const result = buildWorkerSortPayload([], eligible([
      { field: "v", dir: 1, pathParts: null },
    ]));
    expect(result).not.toBeNull();
    expect(result!.rowCount).toBe(0);
    expect(result!.valuesByEntry[0]).toEqual([]);
  });
});

// ── isWorkerSortRowValue ──────────────────────────────────────────────

describe("isWorkerSortRowValue", () => {
  it("accepts string", () => expect(isWorkerSortRowValue("hello")).toBe(true));
  it("accepts number", () => expect(isWorkerSortRowValue(42)).toBe(true));
  it("accepts boolean", () => expect(isWorkerSortRowValue(true)).toBe(true));
  it("accepts null", () => expect(isWorkerSortRowValue(null)).toBe(true));
  it("accepts undefined", () => expect(isWorkerSortRowValue(undefined)).toBe(true));

  it("rejects object", () => expect(isWorkerSortRowValue({ a: 1 })).toBe(false));
  it("rejects array", () => expect(isWorkerSortRowValue([1, 2])).toBe(false));
  it("rejects function", () => expect(isWorkerSortRowValue(() => 1)).toBe(false));
  it("rejects symbol", () => expect(isWorkerSortRowValue(Symbol("x"))).toBe(false));
  it("rejects bigint", () => expect(isWorkerSortRowValue(BigInt(1))).toBe(false));
});
