import { describe, expect, it } from "vitest";

import { createCsvContentRowCursor } from "../csvContentRowCursor";
import { CsvExportInvalidOptionsError } from "../csvExportErrors";
import type { CsvContentRow } from "../csvExportTypes";
import type { CsvProjectedValue } from "../csvProjectedValue";

function drain(row: CsvContentRow, budget = 3): CsvProjectedValue[] {
  const cursor = createCsvContentRowCursor(row);
  const out: CsvProjectedValue[] = [];
  let guard = 0;
  while (!cursor.step(out, budget)) {
    if (++guard > 1_000_000) throw new Error("cursor did not terminate");
  }
  return out;
}

describe("createCsvContentRowCursor - expansion semantics", () => {
  it("flattens cells preserving typed values", () => {
    const row: CsvContentRow = [
      { value: "A" },
      { value: 42 },
      { value: true },
      { value: null },
    ];
    expect(drain(row)).toEqual(["A", 42, true, null]);
  });

  it("emits value plus N empty fields for mergeAcross", () => {
    const row: CsvContentRow = [{ value: "T", mergeAcross: 3 }, { value: "E" }];
    expect(drain(row)).toEqual(["T", undefined, undefined, undefined, "E"]);
  });

  it("mergeAcross 0 adds no extra fields", () => {
    expect(drain([{ value: "A", mergeAcross: 0 }])).toEqual(["A"]);
  });
});

describe("createCsvContentRowCursor - bounded work", () => {
  it("construction performs no expansion for a huge mergeAcross", () => {
    const row: CsvContentRow = [{ value: "A", mergeAcross: Number.MAX_SAFE_INTEGER }];
    const cursor = createCsvContentRowCursor(row);
    const out: CsvProjectedValue[] = [];
    // A single small step emits only a few fields; no eager materialization.
    expect(cursor.step(out, 3)).toBe(false);
    expect(out).toEqual(["A", undefined, undefined]);
  });

  it("step emits at most maxFields values", () => {
    const cursor = createCsvContentRowCursor([{ value: "A", mergeAcross: 10 }]);
    const out: CsvProjectedValue[] = [];
    cursor.step(out, 3);
    expect(out).toHaveLength(3);
  });

  it("maintains continuity across multiple steps with no gaps or dupes", () => {
    const cursor = createCsvContentRowCursor([
      { value: "A", mergeAcross: 2 },
      { value: "B", mergeAcross: 1 },
    ]);
    const out: CsvProjectedValue[] = [];
    // 5 total fields: A, empty, empty, B, empty -> chunks of 2.
    expect(cursor.step(out, 2)).toBe(false);
    expect(cursor.step(out, 2)).toBe(false);
    expect(cursor.step(out, 2)).toBe(true);
    expect(out).toEqual(["A", undefined, undefined, "B", undefined]);
  });

  it("normalizes an invalid field budget to at least one", () => {
    const cursor = createCsvContentRowCursor([{ value: "A" }, { value: "B" }]);
    const out: CsvProjectedValue[] = [];
    expect(cursor.step(out, 0)).toBe(false);
    expect(out).toEqual(["A"]);
    expect(cursor.step(out, Number.NaN)).toBe(true);
    expect(out).toEqual(["A", "B"]);
  });

  it("discarding a cursor performs no later work", () => {
    const cursor = createCsvContentRowCursor([{ value: "A", mergeAcross: 5 }]);
    const out: CsvProjectedValue[] = [];
    cursor.step(out, 2);
    // Simply dropping the reference: nothing scheduled, out stays as emitted.
    expect(out).toEqual(["A", undefined]);
  });
});

describe("createCsvContentRowCursor - validation and immutability", () => {
  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s mergeAcross at construction", (_label, mergeAcross) => {
    expect(() =>
      createCsvContentRowCursor([{ value: "A", mergeAcross }]),
    ).toThrow(CsvExportInvalidOptionsError);
  });

  it("does not mutate the content row or cells", () => {
    const row: CsvContentRow = [{ value: "A", mergeAcross: 1 }, { value: "B" }];
    Object.freeze(row);
    Object.freeze(row[0]);
    Object.freeze(row[1]);
    expect(drain(row)).toEqual(["A", undefined, "B"]);
    expect(row).toEqual([{ value: "A", mergeAcross: 1 }, { value: "B" }]);
  });
});
