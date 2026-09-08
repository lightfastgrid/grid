import { describe, expect, it } from "vitest";

import type { ColumnDef, RowData, SortModel } from "../../../../types";
import { applySortModelToRowOrder } from "../../../../utils/sortModel";
import { executeWorkerSortPayload } from "../sortWorkerAlgorithm";
import type { WorkerSortEntry } from "../sortWorkerEligibility";
import type { WorkerSortPayload, WorkerSortRowValue } from "../sortWorkerPayload";

// ── Helpers ───────────────────────────────────────────────────────────

function payload(
  entries: WorkerSortEntry[],
  valuesByEntry: WorkerSortRowValue[][],
): WorkerSortPayload {
  const rowCount = valuesByEntry.length > 0 ? valuesByEntry[0]!.length : 0;
  return { entries, valuesByEntry, rowCount };
}

function entry(field: string, dir: 1 | -1): WorkerSortEntry {
  return { field, dir, pathParts: null };
}

/** Map sorted indexes back to source values for easy assertion. */
function mapValues(
  indexes: Uint32Array,
  values: WorkerSortRowValue[],
): WorkerSortRowValue[] {
  return Array.from(indexes, (i) => values[i]);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("executeWorkerSortPayload", () => {
  // ── Number sort ─────────────────────────────────────────────────────

  it("ascending number sort", () => {
    const values = [30, 10, 20];
    const result = executeWorkerSortPayload(
      payload([entry("score", 1)], [values]),
    );
    expect(mapValues(result.indexes, values)).toEqual([10, 20, 30]);
  });

  it("descending number sort", () => {
    const values = [30, 10, 20];
    const result = executeWorkerSortPayload(
      payload([entry("score", -1)], [values]),
    );
    expect(mapValues(result.indexes, values)).toEqual([30, 20, 10]);
  });

  // ── String sort ─────────────────────────────────────────────────────

  it("ascending string sort", () => {
    const values = ["charlie", "alice", "bob"];
    const result = executeWorkerSortPayload(
      payload([entry("name", 1)], [values]),
    );
    expect(mapValues(result.indexes, values)).toEqual(["alice", "bob", "charlie"]);
  });

  it("descending string sort", () => {
    const values = ["charlie", "alice", "bob"];
    const result = executeWorkerSortPayload(
      payload([entry("name", -1)], [values]),
    );
    expect(mapValues(result.indexes, values)).toEqual(["charlie", "bob", "alice"]);
  });

  // ── Boolean sort ────────────────────────────────────────────────────

  it("boolean sort: false < true", () => {
    const values: WorkerSortRowValue[] = [true, false, true, false];
    const result = executeWorkerSortPayload(
      payload([entry("active", 1)], [values]),
    );
    const sorted = mapValues(result.indexes, values);
    expect(sorted).toEqual([false, false, true, true]);
  });

  it("boolean sort desc: true < false", () => {
    const values: WorkerSortRowValue[] = [true, false, true, false];
    const result = executeWorkerSortPayload(
      payload([entry("active", -1)], [values]),
    );
    const sorted = mapValues(result.indexes, values);
    expect(sorted).toEqual([true, true, false, false]);
  });

  // ── Null/undefined last ─────────────────────────────────────────────

  it("null/undefined sort last in ascending", () => {
    const values: WorkerSortRowValue[] = [null, 2, undefined, 1, null];
    const result = executeWorkerSortPayload(
      payload([entry("v", 1)], [values]),
    );
    const sorted = mapValues(result.indexes, values);
    expect(sorted.slice(0, 2)).toEqual([1, 2]);
    // Last three are null/undefined
    for (const v of sorted.slice(2)) {
      expect(v === null || v === undefined).toBe(true);
    }
  });

  it("null/undefined sort last in descending", () => {
    const values: WorkerSortRowValue[] = [null, 2, undefined, 1, null];
    const result = executeWorkerSortPayload(
      payload([entry("v", -1)], [values]),
    );
    const sorted = mapValues(result.indexes, values);
    expect(sorted.slice(0, 2)).toEqual([2, 1]);
    for (const v of sorted.slice(2)) {
      expect(v === null || v === undefined).toBe(true);
    }
  });

  it("all-null rows preserve source order via tie-break", () => {
    const values: WorkerSortRowValue[] = [null, null, null];
    const result = executeWorkerSortPayload(
      payload([entry("v", 1)], [values]),
    );
    expect(Array.from(result.indexes)).toEqual([0, 1, 2]);
  });

  // ── NaN behavior ────────────────────────────────────────────────────

  it("NaN sorts after real numbers in ascending", () => {
    const values: WorkerSortRowValue[] = [NaN, 2, 1, NaN];
    const result = executeWorkerSortPayload(
      payload([entry("v", 1)], [values]),
    );
    const sorted = mapValues(result.indexes, values);
    expect(sorted[0]).toBe(1);
    expect(sorted[1]).toBe(2);
    // NaN positions — both should be NaN
    expect(Number.isNaN(sorted[2])).toBe(true);
    expect(Number.isNaN(sorted[3])).toBe(true);
  });

  it("NaN sorts before real numbers in descending (matches defaultCompare * dir)", () => {
    // defaultCompare: NaN > real → cmp=1. In desc (dir=-1): 1*-1=-1,
    // so NaN sorts before real numbers. This matches main-thread behavior.
    const values: WorkerSortRowValue[] = [NaN, 2, 1, NaN];
    const result = executeWorkerSortPayload(
      payload([entry("v", -1)], [values]),
    );
    const sorted = mapValues(result.indexes, values);
    expect(Number.isNaN(sorted[0])).toBe(true);
    expect(Number.isNaN(sorted[1])).toBe(true);
    expect(sorted[2]).toBe(2);
    expect(sorted[3]).toBe(1);
  });

  it("NaN == NaN: equal NaN values preserve source order", () => {
    const values: WorkerSortRowValue[] = [NaN, NaN, NaN];
    const result = executeWorkerSortPayload(
      payload([entry("v", 1)], [values]),
    );
    // Stable tie-break: source order preserved
    expect(Array.from(result.indexes)).toEqual([0, 1, 2]);
  });

  // ── Mixed type comparison via String fallback ───────────────────────

  it("mixed types compare via String().localeCompare()", () => {
    // defaultCompare: non-matching types fall to String(a).localeCompare(String(b))
    const values: WorkerSortRowValue[] = ["10", 2, true];
    const result = executeWorkerSortPayload(
      payload([entry("v", 1)], [values]),
    );
    // String coercion: "10", "2", "true" → localeCompare order
    const sorted = mapValues(result.indexes, values);
    const asStrings = sorted.map((v) => String(v));
    // Verify they're sorted by locale
    for (let i = 1; i < asStrings.length; i++) {
      expect(asStrings[i - 1]!.localeCompare(asStrings[i]!)).toBeLessThanOrEqual(0);
    }
  });

  // ── Multi-column sort ───────────────────────────────────────────────

  it("multi-column sort with mixed asc/desc", () => {
    // name asc, score desc
    const names: WorkerSortRowValue[] = ["alice", "bob", "alice", "bob"];
    const scores: WorkerSortRowValue[] = [3, 1, 2, 2];
    const result = executeWorkerSortPayload(
      payload(
        [entry("name", 1), entry("score", -1)],
        [names, scores],
      ),
    );
    // Expected order: alice(3), alice(2), bob(2), bob(1)
    const sortedNames = mapValues(result.indexes, names);
    const sortedScores = mapValues(result.indexes, scores);
    expect(sortedNames).toEqual(["alice", "alice", "bob", "bob"]);
    expect(sortedScores).toEqual([3, 2, 2, 1]);
  });

  it("secondary column breaks ties from primary", () => {
    const primary: WorkerSortRowValue[] = [1, 1, 1];
    const secondary: WorkerSortRowValue[] = ["c", "a", "b"];
    const result = executeWorkerSortPayload(
      payload(
        [entry("p", 1), entry("s", 1)],
        [primary, secondary],
      ),
    );
    expect(mapValues(result.indexes, secondary)).toEqual(["a", "b", "c"]);
  });

  // ── Stable tie-break ────────────────────────────────────────────────

  it("stable tie-break by original source index", () => {
    // All values equal — must preserve source order
    const values: WorkerSortRowValue[] = [5, 5, 5, 5];
    const result = executeWorkerSortPayload(
      payload([entry("v", 1)], [values]),
    );
    expect(Array.from(result.indexes)).toEqual([0, 1, 2, 3]);
  });

  it("stable tie-break in desc with equal values", () => {
    const values: WorkerSortRowValue[] = [5, 5, 5];
    const result = executeWorkerSortPayload(
      payload([entry("v", -1)], [values]),
    );
    expect(Array.from(result.indexes)).toEqual([0, 1, 2]);
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  it("empty payload returns empty Uint32Array", () => {
    const result = executeWorkerSortPayload(
      payload([entry("v", 1)], [[]]),
    );
    expect(result.indexes.length).toBe(0);
    expect(result.indexes).toBeInstanceOf(Uint32Array);
  });

  it("one-row payload returns [0]", () => {
    const result = executeWorkerSortPayload(
      payload([entry("v", 1)], [[42]]),
    );
    expect(Array.from(result.indexes)).toEqual([0]);
  });

  // ── Immutability ────────────────────────────────────────────────────

  it("does not mutate payload.valuesByEntry", () => {
    const values = [30, 10, 20];
    const valuesCopy = [...values];
    executeWorkerSortPayload(payload([entry("v", 1)], [values]));
    expect(values).toEqual(valuesCopy);
  });

  it("does not mutate payload.entries", () => {
    const entries = [entry("v", 1)];
    const entriesCopy = JSON.stringify(entries);
    executeWorkerSortPayload(payload(entries, [[3, 1, 2]]));
    expect(JSON.stringify(entries)).toBe(entriesCopy);
  });

  // ── Result mapping ──────────────────────────────────────────────────

  it("result indexes can map source rows in expected order", () => {
    const sourceRows = [
      { id: "r0", score: 30 },
      { id: "r1", score: 10 },
      { id: "r2", score: 20 },
    ];
    const values = sourceRows.map((r) => r.score);
    const result = executeWorkerSortPayload(
      payload([entry("score", 1)], [values]),
    );
    const displayRows = Array.from(result.indexes, (i) => sourceRows[i]!);
    expect(displayRows.map((r) => r.id)).toEqual(["r1", "r2", "r0"]);
    expect(displayRows.map((r) => r.score)).toEqual([10, 20, 30]);
  });

  // ── Parity with main-thread sort ────────────────────────────────────

  it("matches applySortModelToRowOrder for built-in sortable dataset", () => {
    const rows: RowData[] = [
      { id: "r0", score: 3, name: "alice" },
      { id: "r1", score: 1, name: "bob" },
      { id: "r2", score: 2, name: "alice" },
      { id: "r3", score: 2, name: "bob" },
    ];
    const columns: ColumnDef[] = [
      { field: "score", sortable: true } as ColumnDef,
      { field: "name", sortable: true } as ColumnDef,
    ];
    const sortModel: SortModel = [
      { field: "name", sort: "asc" },
      { field: "score", sort: "desc" },
    ];

    // Main-thread sort
    const mainOrder = applySortModelToRowOrder(rows, sortModel, columns);
    expect(mainOrder.kind).toBe("indexed");
    const mainIndexes = mainOrder.kind === "indexed" ? mainOrder.indexes : new Uint32Array(0);

    // Worker algorithm: build columnar payload manually
    const nameValues = rows.map((r) => r.name as string);
    const scoreValues = rows.map((r) => r.score as number);
    const workerResult = executeWorkerSortPayload(
      payload(
        [
          { field: "name", dir: 1, pathParts: null },
          { field: "score", dir: -1, pathParts: null },
        ],
        [nameValues, scoreValues],
      ),
    );

    // Both must produce the same index order
    expect(Array.from(workerResult.indexes)).toEqual(Array.from(mainIndexes));
  });

  it("matches applySortModelToRowOrder for single-column with nulls", () => {
    const rows: RowData[] = [
      { score: null },
      { score: 2 },
      { score: undefined },
      { score: 1 },
    ];
    const columns: ColumnDef[] = [
      { field: "score", sortable: true } as ColumnDef,
    ];
    const sortModel: SortModel = [{ field: "score", sort: "asc" }];

    // Main-thread sort
    const mainOrder = applySortModelToRowOrder(rows, sortModel, columns);
    const mainIndexes = mainOrder.kind === "indexed" ? mainOrder.indexes : new Uint32Array(0);

    // Worker algorithm
    const values: WorkerSortRowValue[] = rows.map((r) => r.score as WorkerSortRowValue);
    const workerResult = executeWorkerSortPayload(
      payload([entry("score", 1)], [values]),
    );

    expect(Array.from(workerResult.indexes)).toEqual(Array.from(mainIndexes));
  });

  it("matches applySortModelToRowOrder for desc with NaN", () => {
    const rows: RowData[] = [
      { score: NaN },
      { score: 5 },
      { score: 1 },
      { score: NaN },
      { score: 3 },
    ];
    const columns: ColumnDef[] = [
      { field: "score", sortable: true } as ColumnDef,
    ];
    const sortModel: SortModel = [{ field: "score", sort: "desc" }];

    const mainOrder = applySortModelToRowOrder(rows, sortModel, columns);
    const mainIndexes = mainOrder.kind === "indexed" ? mainOrder.indexes : new Uint32Array(0);

    const values: WorkerSortRowValue[] = rows.map((r) => r.score as WorkerSortRowValue);
    const workerResult = executeWorkerSortPayload(
      payload([entry("score", -1)], [values]),
    );

    expect(Array.from(workerResult.indexes)).toEqual(Array.from(mainIndexes));
  });
});
