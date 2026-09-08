import { describe, expect, it } from "vitest";

import type { ColumnFilterModel, FilterModel, RowData } from "../../../types";
import { executeFilterMainThread } from "../executeFilterMainThread";
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

function run(
  rows: readonly RowData[],
  filterModel: FilterModel,
  columns: ReadonlyMap<string, NormalizedColumnFilterConfig>,
  opts?: {
    getCellValue?: (row: RowData, sourceIndex: number, field: string) => unknown;
    sourceIndexes?: readonly number[] | Uint32Array;
  },
) {
  return executeFilterMainThread({
    rows,
    filterModel,
    columnsByField: columns,
    ...opts,
  });
}

// ── no filters ───────────────────────────────────────────────

describe("no active filters", () => {
  const rows = [{ name: "a" }, { name: "b" }, { name: "c" }];
  const cols = new Map([["name", textConfig()]]);

  it("returns all indexes when filter model is empty", () => {
    const result = run(rows, {}, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 1, 2]));
  });

  it("output is Uint32Array", () => {
    const result = run(rows, {}, cols);
    expect(result.indexes).toBeInstanceOf(Uint32Array);
  });

  it("returns sourceIndexes when provided and no filters", () => {
    const result = run(rows, {}, cols, { sourceIndexes: [2, 0] });
    expect(result.indexes).toEqual(new Uint32Array([2, 0]));
  });

  it("returns copy of Uint32Array sourceIndexes when no filters", () => {
    const src = new Uint32Array([1, 2]);
    const result = run(rows, {}, cols, { sourceIndexes: src });
    expect(result.indexes).toEqual(src);
    expect(result.indexes.buffer).not.toBe(src.buffer);
  });
});

// ── sourceIndexes ────────────────────────────────────────────

describe("sourceIndexes limits scan", () => {
  const rows = [
    { name: "Alice" },
    { name: "Bob" },
    { name: "Charlie" },
    { name: "Alice" },
  ];
  const cols = new Map([["name", textConfig()]]);
  const model: FilterModel = {
    name: colModel("text", [{ operator: "contains", value: "Ali" }]),
  };

  it("scans only provided indexes", () => {
    const result = run(rows, model, cols, { sourceIndexes: [0, 1] });
    expect(result.indexes).toEqual(new Uint32Array([0]));
  });

  it("scans Uint32Array sourceIndexes", () => {
    const result = run(rows, model, cols, { sourceIndexes: new Uint32Array([0, 1, 3]) });
    expect(result.indexes).toEqual(new Uint32Array([0, 3]));
  });
});

// ── multi-column AND ─────────────────────────────────────────

describe("multiple column filters AND", () => {
  const rows = [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 },
    { name: "Alice", age: 20 },
  ];
  const cols = new Map<string, NormalizedColumnFilterConfig>([
    ["name", textConfig()],
    ["age", numberConfig()],
  ]);

  it("both column filters must pass", () => {
    const model: FilterModel = {
      name: colModel("text", [{ operator: "equals", value: "Alice" }]),
      age: colModel("number", [{ operator: "gte", value: 25 }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([0]));
  });
});

// ── same-column AND/OR ───────────────────────────────────────

describe("same-column conditions", () => {
  const rows = [
    { name: "Alice" },
    { name: "Bob" },
    { name: "Charlie" },
    { name: "Alex" },
  ];
  const cols = new Map([["name", textConfig()]]);

  it("two conditions with AND", () => {
    const model: FilterModel = {
      name: colModel("text", [
        { operator: "startsWith", value: "A" },
        { operator: "endsWith", value: "e" },
      ], "and"),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([0]));
  });

  it("two conditions with OR", () => {
    const model: FilterModel = {
      name: colModel("text", [
        { operator: "equals", value: "Alice" },
        { operator: "equals", value: "Bob" },
      ], "or"),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 1]));
  });
});

// ── same-column conditions + selection ──────────────────────

describe("same-column OR conditions with selection", () => {
  it("text OR conditions are intersected with the selection list", () => {
    const rows = [
      { name: "Alice" },
      { name: "Alex" },
      { name: "Bob" },
      { name: "Charlie" },
    ];
    const cols = new Map([["name", textConfig()]]);
    const model: FilterModel = {
      name: {
        type: "text",
        operator: "or",
        conditions: [
          { operator: "equals", value: "alice" },
          { operator: "equals", value: "bob" },
        ],
        selection: { operator: "in", values: ["bob"] },
      },
    };

    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([2]));
  });

  it("number OR conditions are intersected with the selection list", () => {
    const rows = [{ val: 10 }, { val: 20 }, { val: 30 }, { val: 40 }];
    const cols = new Map([["val", numberConfig()]]);
    const model: FilterModel = {
      val: {
        type: "number",
        operator: "or",
        conditions: [
          { operator: "equals", value: 10 },
          { operator: "equals", value: 30 },
        ],
        selection: { operator: "in", values: [30, 40] },
      },
    };

    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([2]));
  });
});

// ── text operators ───────────────────────────────────────────

describe("text operators", () => {
  const rows = [
    { val: "Hello World" },
    { val: "hello" },
    { val: "WORLD" },
    { val: "" },
    { val: null },
    { val: undefined },
  ];
  const cols = new Map([["val", textConfig()]]);
  const colsCS = new Map([["val", textConfig({ caseSensitive: true })]]);

  it("contains case-insensitive", () => {
    const model: FilterModel = {
      val: colModel("text", [{ operator: "contains", value: "hello" }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 1]));
  });

  it("contains case-sensitive", () => {
    const model: FilterModel = {
      val: colModel("text", [{ operator: "contains", value: "Hello" }]),
    };
    const result = run(rows, model, colsCS);
    expect(result.indexes).toEqual(new Uint32Array([0]));
  });

  it("notContains", () => {
    const model: FilterModel = {
      val: colModel("text", [{ operator: "notContains", value: "world" }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([1, 3]));
  });

  it("equals case-insensitive", () => {
    const model: FilterModel = {
      val: colModel("text", [{ operator: "equals", value: "hello" }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([1]));
  });

  it("equals case-sensitive", () => {
    const model: FilterModel = {
      val: colModel("text", [{ operator: "equals", value: "hello" }]),
    };
    const result = run(rows, model, colsCS);
    expect(result.indexes).toEqual(new Uint32Array([1]));
  });

  it("notEquals", () => {
    const model: FilterModel = {
      val: colModel("text", [{ operator: "notEquals", value: "hello" }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 2, 3]));
  });

  it("startsWith", () => {
    const model: FilterModel = {
      val: colModel("text", [{ operator: "startsWith", value: "hel" }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 1]));
  });

  it("endsWith", () => {
    const model: FilterModel = {
      val: colModel("text", [{ operator: "endsWith", value: "world" }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 2]));
  });

  it("isEmpty with null/undefined/empty string", () => {
    const model: FilterModel = {
      val: colModel("text", [{ operator: "isEmpty" }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([3, 4, 5]));
  });

  it("isNotEmpty", () => {
    const model: FilterModel = {
      val: colModel("text", [{ operator: "isNotEmpty" }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 1, 2]));
  });

  it("in matches selected values case-insensitive", () => {
    const result = run(rows, { val: colModel("text", [{ operator: "in", value: ["hello", "world"] }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([1, 2]));
  });

  it("notIn excludes selected values", () => {
    const result = run(rows, { val: colModel("text", [{ operator: "notIn", value: ["hello"] }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 2, 3]));
  });

  it("in excludes null values", () => {
    const result = run(
      [{ val: "Alice" }, { val: null }, { val: "Bob" }],
      { val: colModel("text", [{ operator: "in", value: ["alice", "bob"] }]) },
      cols,
    );
    expect(result.indexes).toEqual(new Uint32Array([0, 2]));
  });
});

// ── number operators ─────────────────────────────────────────

describe("number operators", () => {
  const rows = [
    { val: 10 },
    { val: 20 },
    { val: 30 },
    { val: "15" },
    { val: null },
    { val: NaN },
    { val: Infinity },
  ];
  const cols = new Map([["val", numberConfig()]]);

  it("equals", () => {
    const result = run(rows, { val: colModel("number", [{ operator: "equals", value: 20 }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([1]));
  });

  it("notEquals", () => {
    const result = run(rows, { val: colModel("number", [{ operator: "notEquals", value: 20 }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 2, 3]));
  });

  it("gt", () => {
    const result = run(rows, { val: colModel("number", [{ operator: "gt", value: 15 }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([1, 2]));
  });

  it("gte", () => {
    const result = run(rows, { val: colModel("number", [{ operator: "gte", value: 15 }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([1, 2, 3]));
  });

  it("lt", () => {
    const result = run(rows, { val: colModel("number", [{ operator: "lt", value: 15 }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0]));
  });

  it("lte", () => {
    const result = run(rows, { val: colModel("number", [{ operator: "lte", value: 15 }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 3]));
  });

  it("between", () => {
    const result = run(rows, { val: colModel("number", [{ operator: "between", value: 10, valueTo: 20 }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 1, 3]));
  });

  it("numeric strings work", () => {
    const result = run(rows, { val: colModel("number", [{ operator: "equals", value: 15 }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([3]));
  });

  it("isNull matches null/NaN/Infinity/non-number", () => {
    const result = run(rows, { val: colModel("number", [{ operator: "isNull" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([4, 5, 6]));
  });

  it("isNotNull", () => {
    const result = run(rows, { val: colModel("number", [{ operator: "isNotNull" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 1, 2, 3]));
  });

  it("in matches selected numbers", () => {
    const result = run(rows, { val: colModel("number", [{ operator: "in", value: [10, 30] }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 2]));
  });

  it("notIn excludes selected numbers", () => {
    const result = run(rows, { val: colModel("number", [{ operator: "notIn", value: [10] }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([1, 2, 3]));
  });
});

// ── date operators ───────────────────────────────────────────

describe("date operators", () => {
  const rows = [
    { val: "2024-01-15" },
    { val: "2024-06-01" },
    { val: "2024-12-31" },
    { val: new Date(Date.UTC(2024, 5, 1)) },
    { val: null },
    { val: "not-a-date" },
    { val: new Date(NaN) },
  ];
  const cols = new Map([["val", dateConfig()]]);

  it("equals string", () => {
    const result = run(rows, { val: colModel("date", [{ operator: "equals", value: "2024-06-01" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([1, 3]));
  });

  it("notEquals", () => {
    const result = run(rows, { val: colModel("date", [{ operator: "notEquals", value: "2024-06-01" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 2]));
  });

  it("before", () => {
    const result = run(rows, { val: colModel("date", [{ operator: "before", value: "2024-06-01" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0]));
  });

  it("after", () => {
    const result = run(rows, { val: colModel("date", [{ operator: "after", value: "2024-06-01" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([2]));
  });

  it("between", () => {
    const result = run(rows, { val: colModel("date", [{ operator: "between", value: "2024-01-01", valueTo: "2024-06-30" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 1, 3]));
  });

  it("Date instance normalizes to YYYY-MM-DD via UTC", () => {
    const result = run(rows, { val: colModel("date", [{ operator: "equals", value: "2024-06-01" }]) }, cols);
    expect(Array.from(result.indexes)).toContain(3);
  });

  it("invalid date treated as null", () => {
    const result = run(rows, { val: colModel("date", [{ operator: "isNull" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([4, 5, 6]));
  });

  it("isNotNull", () => {
    const result = run(rows, { val: colModel("date", [{ operator: "isNotNull" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 1, 2, 3]));
  });

  it("rolled-over invalid date row values treated as null", () => {
    const invalidRows = [
      { val: "2024-02-31" },
      { val: "2023-02-29" },
      { val: "2024-13-01" },
      { val: "2024-01-15" },
    ];
    const result = run(invalidRows, { val: colModel("date", [{ operator: "isNull" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 1, 2]));
  });

  it("valid leap day row value accepted", () => {
    const leapRows = [{ val: "2024-02-29" }, { val: "2024-03-01" }];
    const result = run(leapRows, { val: colModel("date", [{ operator: "equals", value: "2024-02-29" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0]));
  });

  it("in matches selected dates", () => {
    const result = run(rows, { val: colModel("date", [{ operator: "in", value: ["2024-01-15", "2024-12-31"] }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 2]));
  });

  it("notIn excludes selected dates", () => {
    const result = run(rows, { val: colModel("date", [{ operator: "notIn", value: ["2024-01-15"] }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([1, 2, 3]));
  });
});

// ── boolean operators ────────────────────────────────────────

describe("boolean operators", () => {
  const rows = [
    { val: true },
    { val: false },
    { val: "true" },
    { val: "false" },
    { val: null },
    { val: "yes" },
    { val: 1 },
  ];
  const cols = new Map([["val", booleanConfig()]]);

  it("equals true matches boolean and string", () => {
    const result = run(rows, { val: colModel("boolean", [{ operator: "equals", value: true }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 2]));
  });

  it("equals false", () => {
    const result = run(rows, { val: colModel("boolean", [{ operator: "equals", value: false }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([1, 3]));
  });

  it("notEquals true", () => {
    const result = run(rows, { val: colModel("boolean", [{ operator: "notEquals", value: true }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([1, 3]));
  });

  it("isNull matches null and invalid boolean values", () => {
    const result = run(rows, { val: colModel("boolean", [{ operator: "isNull" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([4, 5, 6]));
  });

  it("isNotNull", () => {
    const result = run(rows, { val: colModel("boolean", [{ operator: "isNotNull" }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 1, 2, 3]));
  });

  it("in [true] matches true values", () => {
    const result = run(rows, { val: colModel("boolean", [{ operator: "in", value: [true] }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 2]));
  });

  it("in [true, false] matches all non-null", () => {
    const result = run(rows, { val: colModel("boolean", [{ operator: "in", value: [true, false] }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 1, 2, 3]));
  });

  it("notIn [true] matches false values", () => {
    const result = run(rows, { val: colModel("boolean", [{ operator: "notIn", value: [true] }]) }, cols);
    expect(result.indexes).toEqual(new Uint32Array([1, 3]));
  });
});

// ── getCellValue override ────────────────────────────────────

describe("getCellValue override", () => {
  it("uses custom getCellValue", () => {
    const rows = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const cols = new Map([["computed", numberConfig()]]);
    const model: FilterModel = {
      computed: colModel("number", [{ operator: "gt", value: 4 }]),
    };
    const result = run(rows, model, cols, {
      getCellValue: (row, _idx, _field) => (row["x"] as number) * 2,
    });
    expect(result.indexes).toEqual(new Uint32Array([2]));
  });
});

// ── no row cloning ───────────────────────────────────────────

describe("no row cloning", () => {
  it("original rows are same references after filtering", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    const refs = [rows[0], rows[1]];
    const cols = new Map([["name", textConfig()]]);
    run(rows, { name: colModel("text", [{ operator: "contains", value: "A" }]) }, cols);
    expect(rows[0]).toBe(refs[0]);
    expect(rows[1]).toBe(refs[1]);
  });
});

// ── unknown column in model skipped ──────────────────────────

describe("unknown column", () => {
  it("skips column not in columnsByField", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    const cols = new Map([["name", textConfig()]]);
    const model: FilterModel = {
      name: colModel("text", [{ operator: "contains", value: "Ali" }]),
      unknown: colModel("text", [{ operator: "equals", value: "x" }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([0]));
  });
});

// ── dot-path field access ───────────────────────────────────

describe("dot-path field access", () => {
  const rows: RowData[] = [
    { game: { name: "Chess", bought: true } },
    { game: { name: "Go", bought: false } },
    { game: { name: "Checkers", bought: true } },
    { game: null },
  ];

  it("resolves nested boolean via dot path", () => {
    const cols = new Map([["game.bought", booleanConfig()]]);
    const model: FilterModel = {
      "game.bought": colModel("boolean", [{ operator: "equals", value: true }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 2]));
  });

  it("resolves nested text via dot path", () => {
    const cols = new Map([["game.name", textConfig()]]);
    const model: FilterModel = {
      "game.name": colModel("text", [{ operator: "contains", value: "che" }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([0, 2]));
  });

  it("null parent treated as null value", () => {
    const cols = new Map([["game.bought", booleanConfig()]]);
    const model: FilterModel = {
      "game.bought": colModel("boolean", [{ operator: "isNull" }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toEqual(new Uint32Array([3]));
  });
});

// ── output buffer size ───────────────────────────────────────

describe("output buffer size", () => {
  it("filtered output has exact byte length when fewer rows match", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ val: i }));
    const cols = new Map([["val", numberConfig()]]);
    const model: FilterModel = {
      val: colModel("number", [{ operator: "lt", value: 3 }]),
    };
    const result = run(rows, model, cols);
    expect(result.indexes).toHaveLength(3);
    expect(result.indexes.byteLength).toBe(3 * 4);
    expect(result.indexes.buffer.byteLength).toBe(3 * 4);
  });
});
