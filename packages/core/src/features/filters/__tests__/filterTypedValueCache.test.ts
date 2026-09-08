import { describe, expect, it, vi } from "vitest";

import type { ColumnFilterModel, FilterModel, RowData } from "../../../types";
import { executeFilterMainThread } from "../executeFilterMainThread";
import type { FieldBooleanCache,FieldDateCache, FieldNumberCache, FieldTextCache } from "../filterTypedValueCache";
import { BOOL_FALSE,BOOL_NULL_SENTINEL, BOOL_TRUE, buildFilterTypedValueCache } from "../filterTypedValueCache";
import { dateStringToEpochDay } from "../filterValueAccess";
import type { NormalizedColumnFilterConfig } from "../types";

// ── helpers ──────────────────────────────────────────────────

function textConfig(overrides?: Partial<NormalizedColumnFilterConfig>): NormalizedColumnFilterConfig {
  return { type: "text", defaultOperator: "contains", caseSensitive: false, trimInput: true, ...overrides };
}

function numberConfig(): NormalizedColumnFilterConfig {
  return { type: "number", defaultOperator: "equals", caseSensitive: false, trimInput: true };
}

function dateConfig(): NormalizedColumnFilterConfig {
  return { type: "date", defaultOperator: "equals", caseSensitive: false, trimInput: true };
}

function booleanConfig(): NormalizedColumnFilterConfig {
  return { type: "boolean", defaultOperator: "equals", caseSensitive: false, trimInput: true };
}

function colModel(
  type: "text" | "number" | "date" | "boolean",
  conditions: ColumnFilterModel["conditions"],
  operator?: "and" | "or",
): ColumnFilterModel {
  return { type, operator: operator ?? "and", conditions };
}

const defaultGet = (row: RowData, _idx: number, field: string) => row[field];

// ── text cache shape ─────────────────────────────────────────

describe("text cache shape", () => {
  it("has string[] values and Uint8Array nullFlags", () => {
    const rows = [{ name: "Alice" }, { name: null }];
    const model: FilterModel = { name: colModel("text", [{ operator: "contains", value: "a" }]) };
    const cols = new Map([["name", textConfig()]]);
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    const tc = cache.fields.get("name") as FieldTextCache;
    expect(tc.type).toBe("text");
    expect(Array.isArray(tc.values)).toBe(true);
    expect(tc.nullFlags).toBeInstanceOf(Uint8Array);
  });

  it("lowercases for case-insensitive", () => {
    const rows = [{ name: "Alice" }, { name: "BOB" }];
    const model: FilterModel = { name: colModel("text", [{ operator: "contains", value: "a" }]) };
    const cols = new Map([["name", textConfig()]]);
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    const tc = cache.fields.get("name") as FieldTextCache;
    expect(tc.values[0]).toBe("alice");
    expect(tc.values[1]).toBe("bob");
  });

  it("preserves case for case-sensitive", () => {
    const rows = [{ name: "Alice" }];
    const model: FilterModel = { name: colModel("text", [{ operator: "contains", value: "A" }]) };
    const cols = new Map([["name", textConfig({ caseSensitive: true })]]);
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    const tc = cache.fields.get("name") as FieldTextCache;
    expect(tc.values[0]).toBe("Alice");
  });

  it("marks null/undefined with nullFlags=1", () => {
    const rows: RowData[] = [{ name: null }, { name: undefined }];
    const model: FilterModel = { name: colModel("text", [{ operator: "isEmpty" }]) };
    const cols = new Map([["name", textConfig()]]);
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    const tc = cache.fields.get("name") as FieldTextCache;
    expect(tc.nullFlags[0]).toBe(1);
    expect(tc.nullFlags[1]).toBe(1);
  });
});

// ── number cache shape ───────────────────────────────────────

describe("number cache shape", () => {
  it("has Float64Array values and Uint8Array validFlags", () => {
    const rows = [{ val: 42 }];
    const model: FilterModel = { val: colModel("number", [{ operator: "equals", value: 42 }]) };
    const cols = new Map([["val", numberConfig()]]);
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    const nc = cache.fields.get("val") as FieldNumberCache;
    expect(nc.type).toBe("number");
    expect(nc.values).toBeInstanceOf(Float64Array);
    expect(nc.validFlags).toBeInstanceOf(Uint8Array);
  });

  it("valid numbers have validFlags=1", () => {
    const rows = [{ val: 42 }, { val: "3.14" }];
    const model: FilterModel = { val: colModel("number", [{ operator: "equals", value: 42 }]) };
    const cols = new Map([["val", numberConfig()]]);
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    const nc = cache.fields.get("val") as FieldNumberCache;
    expect(nc.values[0]).toBe(42);
    expect(nc.validFlags[0]).toBe(1);
    expect(nc.values[1]).toBe(3.14);
    expect(nc.validFlags[1]).toBe(1);
  });

  it("invalid numbers have validFlags=0", () => {
    const rows = [{ val: null }, { val: NaN }, { val: Infinity }, { val: "abc" }];
    const model: FilterModel = { val: colModel("number", [{ operator: "isNull" }]) };
    const cols = new Map([["val", numberConfig()]]);
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    const nc = cache.fields.get("val") as FieldNumberCache;
    expect(nc.validFlags[0]).toBe(0);
    expect(nc.validFlags[1]).toBe(0);
    expect(nc.validFlags[2]).toBe(0);
    expect(nc.validFlags[3]).toBe(0);
  });
});

// ── date cache shape ─────────────────────────────────────────

describe("date cache shape", () => {
  it("has Int32Array dayKeys and Uint8Array validFlags", () => {
    const rows = [{ val: "2024-06-01" }];
    const model: FilterModel = { val: colModel("date", [{ operator: "equals", value: "2024-06-01" }]) };
    const cols = new Map([["val", dateConfig()]]);
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    const dc = cache.fields.get("val") as FieldDateCache;
    expect(dc.type).toBe("date");
    expect(dc.dayKeys).toBeInstanceOf(Int32Array);
    expect(dc.validFlags).toBeInstanceOf(Uint8Array);
  });

  it("stores epoch-day integers for valid dates", () => {
    const rows = [{ val: "2024-06-01" }, { val: new Date(Date.UTC(2024, 0, 15)) }];
    const model: FilterModel = { val: colModel("date", [{ operator: "equals", value: "2024-06-01" }]) };
    const cols = new Map([["val", dateConfig()]]);
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    const dc = cache.fields.get("val") as FieldDateCache;
    expect(dc.dayKeys[0]).toBe(dateStringToEpochDay("2024-06-01"));
    expect(dc.validFlags[0]).toBe(1);
    expect(dc.dayKeys[1]).toBe(dateStringToEpochDay("2024-01-15"));
    expect(dc.validFlags[1]).toBe(1);
  });

  it("invalid dates have validFlags=0", () => {
    const rows = [{ val: null }, { val: "not-a-date" }, { val: new Date(NaN) }];
    const model: FilterModel = { val: colModel("date", [{ operator: "isNull" }]) };
    const cols = new Map([["val", dateConfig()]]);
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    const dc = cache.fields.get("val") as FieldDateCache;
    expect(dc.validFlags[0]).toBe(0);
    expect(dc.validFlags[1]).toBe(0);
    expect(dc.validFlags[2]).toBe(0);
  });

  it("rolled-over invalid dates have validFlags=0", () => {
    const rows = [{ val: "2024-02-31" }, { val: "2023-02-29" }, { val: "2024-13-01" }];
    const model: FilterModel = { val: colModel("date", [{ operator: "isNull" }]) };
    const cols = new Map([["val", dateConfig()]]);
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    const dc = cache.fields.get("val") as FieldDateCache;
    expect(dc.validFlags[0]).toBe(0);
    expect(dc.validFlags[1]).toBe(0);
    expect(dc.validFlags[2]).toBe(0);
  });

  it("dates compare as integer day keys in predicates", () => {
    const rows = [
      { val: "2024-01-15" },
      { val: "2024-06-01" },
      { val: "2024-12-31" },
    ];
    const cols = new Map([["val", dateConfig()]]);
    const result = executeFilterMainThread({
      rows,
      filterModel: { val: colModel("date", [{ operator: "before", value: "2024-06-01" }]) },
      columnsByField: cols,
    });
    expect(result.indexes).toEqual(new Uint32Array([0]));
  });
});

// ── boolean cache shape ──────────────────────────────────────

describe("boolean cache shape", () => {
  it("has Uint8Array values with 0/1/2 encoding", () => {
    const rows = [{ val: true }, { val: false }, { val: "true" }, { val: null }, { val: 1 }];
    const model: FilterModel = { val: colModel("boolean", [{ operator: "equals", value: true }]) };
    const cols = new Map([["val", booleanConfig()]]);
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    const bc = cache.fields.get("val") as FieldBooleanCache;
    expect(bc.type).toBe("boolean");
    expect(bc.values).toBeInstanceOf(Uint8Array);
    expect(bc.values[0]).toBe(BOOL_TRUE);
    expect(bc.values[1]).toBe(BOOL_FALSE);
    expect(bc.values[2]).toBe(BOOL_TRUE);
    expect(bc.values[3]).toBe(BOOL_NULL_SENTINEL);
    expect(bc.values[4]).toBe(BOOL_NULL_SENTINEL);
  });
});

// ── sourceIndexes scoping ────────────────────────────────────

describe("sourceIndexes scoping", () => {
  it("only populates scanned indexes", () => {
    const rows = [{ val: 10 }, { val: 20 }, { val: 30 }, { val: 40 }];
    const model: FilterModel = { val: colModel("number", [{ operator: "equals", value: 10 }]) };
    const cols = new Map([["val", numberConfig()]]);
    const cache = buildFilterTypedValueCache({
      rows, filterModel: model, columnsByField: cols,
      getCellValue: defaultGet, sourceIndexes: [0, 2],
    });
    const nc = cache.fields.get("val") as FieldNumberCache;
    expect(nc.values[0]).toBe(10);
    expect(nc.validFlags[0]).toBe(1);
    expect(nc.values[2]).toBe(30);
    expect(nc.validFlags[2]).toBe(1);
    expect(nc.validFlags[1]).toBe(0);
    expect(nc.validFlags[3]).toBe(0);
  });

  it("skips fields not in columnsByField", () => {
    const rows = [{ val: 10 }];
    const model: FilterModel = { val: colModel("number", [{ operator: "equals", value: 10 }]) };
    const cols = new Map<string, NormalizedColumnFilterConfig>();
    const cache = buildFilterTypedValueCache({ rows, filterModel: model, columnsByField: cols, getCellValue: defaultGet });
    expect(cache.fields.size).toBe(0);
  });
});

// ── cached execution parity ──────────────────────────────────

describe("cached execution parity", () => {
  const rows: RowData[] = [
    { name: "Alice", age: 30, joined: "2024-01-15", active: true },
    { name: "Bob", age: 25, joined: "2024-06-01", active: false },
    { name: "Charlie", age: 35, joined: "2024-12-31", active: true },
    { name: "Diana", age: 28, joined: "not-a-date", active: "true" },
    { name: null, age: null, joined: null, active: null },
  ];
  const cols = new Map<string, NormalizedColumnFilterConfig>([
    ["name", textConfig()],
    ["age", numberConfig()],
    ["joined", dateConfig()],
    ["active", booleanConfig()],
  ]);

  function run(model: FilterModel) {
    return executeFilterMainThread({ rows, filterModel: model, columnsByField: cols });
  }

  it("text contains via cache", () => {
    const result = run({ name: colModel("text", [{ operator: "contains", value: "ali" }]) });
    expect(result.indexes).toEqual(new Uint32Array([0]));
  });

  it("text isEmpty via cache", () => {
    const result = run({ name: colModel("text", [{ operator: "isEmpty" }]) });
    expect(result.indexes).toEqual(new Uint32Array([4]));
  });

  it("number gt via cache", () => {
    const result = run({ age: colModel("number", [{ operator: "gt", value: 28 }]) });
    expect(result.indexes).toEqual(new Uint32Array([0, 2]));
  });

  it("number isNull via cache", () => {
    const result = run({ age: colModel("number", [{ operator: "isNull" }]) });
    expect(result.indexes).toEqual(new Uint32Array([4]));
  });

  it("number between via cache", () => {
    const result = run({ age: colModel("number", [{ operator: "between", value: 25, valueTo: 30 }]) });
    expect(result.indexes).toEqual(new Uint32Array([0, 1, 3]));
  });

  it("date before via cache", () => {
    const result = run({ joined: colModel("date", [{ operator: "before", value: "2024-06-01" }]) });
    expect(result.indexes).toEqual(new Uint32Array([0]));
  });

  it("date isNull via cache", () => {
    const result = run({ joined: colModel("date", [{ operator: "isNull" }]) });
    expect(result.indexes).toEqual(new Uint32Array([3, 4]));
  });

  it("boolean equals via cache", () => {
    const result = run({ active: colModel("boolean", [{ operator: "equals", value: true }]) });
    expect(result.indexes).toEqual(new Uint32Array([0, 2, 3]));
  });

  it("boolean isNull via cache", () => {
    const result = run({ active: colModel("boolean", [{ operator: "isNull" }]) });
    expect(result.indexes).toEqual(new Uint32Array([4]));
  });

  it("multi-column AND via cache", () => {
    const result = run({
      name: colModel("text", [{ operator: "contains", value: "a" }]),
      age: colModel("number", [{ operator: "gte", value: 30 }]),
    });
    expect(result.indexes).toEqual(new Uint32Array([0, 2]));
  });

  it("same-column OR via cache", () => {
    const result = run({
      name: colModel("text", [
        { operator: "equals", value: "alice" },
        { operator: "equals", value: "bob" },
      ], "or"),
    });
    expect(result.indexes).toEqual(new Uint32Array([0, 1]));
  });

  it("getCellValue called once per field per scanned row", () => {
    const spy = vi.fn<[RowData, number, string], unknown>(
      (row, _idx, field) => row[field],
    );
    const model: FilterModel = {
      name: colModel("text", [
        { operator: "contains", value: "a" },
        { operator: "startsWith", value: "a" },
      ], "and"),
    };
    executeFilterMainThread({
      rows, filterModel: model, columnsByField: cols,
      getCellValue: spy,
    });
    expect(spy).toHaveBeenCalledTimes(rows.length);
  });

  it("getCellValue override works with cache", () => {
    const customRows = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const customCols = new Map([["computed", numberConfig()]]);
    const result = executeFilterMainThread({
      rows: customRows,
      filterModel: { computed: colModel("number", [{ operator: "gt", value: 4 }]) },
      columnsByField: customCols,
      getCellValue: (row) => (row["x"] as number) * 2,
    });
    expect(result.indexes).toEqual(new Uint32Array([2]));
  });

  it("sourceIndexes work with cache", () => {
    const result = executeFilterMainThread({
      rows, filterModel: { name: colModel("text", [{ operator: "contains", value: "ali" }]) },
      columnsByField: cols,
      sourceIndexes: [0, 1],
    });
    expect(result.indexes).toEqual(new Uint32Array([0]));
  });
});
