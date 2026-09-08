import { describe, expect, it } from "vitest";

import type { NormalizedColumnFilterConfig } from "../../../../features/filters/types";
import type { FilterModel, RowData } from "../../../../types";
import { executeWorkerFilterPayload } from "../filterWorkerAlgorithm";
import { resolveWorkerFilterEligibility } from "../filterWorkerEligibility";
import type { WorkerFilterPayload } from "../filterWorkerPayload";
import { buildWorkerFilterPayload } from "../filterWorkerPayload";

function textConfig(): NormalizedColumnFilterConfig {
  return { type: "text", defaultOperator: "contains", caseSensitive: false, trimInput: true };
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

function build(
  rows: RowData[],
  model: FilterModel,
  cols: Map<string, NormalizedColumnFilterConfig>,
  sourceIndexes?: readonly number[],
): WorkerFilterPayload {
  const eligibility = resolveWorkerFilterEligibility(model, cols);
  const payload = buildWorkerFilterPayload(rows, model, cols, eligibility, sourceIndexes);
  if (!payload) throw new Error("Expected payload to be non-null");
  return payload;
}

function run(
  rows: RowData[],
  model: FilterModel,
  cols: Map<string, NormalizedColumnFilterConfig>,
  sourceIndexes?: readonly number[],
): Uint32Array {
  return executeWorkerFilterPayload(build(rows, model, cols, sourceIndexes)).indexes;
}

describe("executeWorkerFilterPayload", () => {
  it("text contains output", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }, { name: "Charlie" }];
    const model: FilterModel = {
      name: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "li" }] },
    };
    expect(run(rows, model, new Map([["name", textConfig()]]))).toEqual(
      new Uint32Array([0, 2]),
    );
  });

  it("same-column OR output", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }, { name: "Charlie" }];
    const model: FilterModel = {
      name: {
        type: "text",
        operator: "or",
        conditions: [
          { operator: "equals", value: "alice" },
          { operator: "equals", value: "bob" },
        ],
      },
    };
    expect(run(rows, model, new Map([["name", textConfig()]]))).toEqual(
      new Uint32Array([0, 1]),
    );
  });

  it("text OR conditions are intersected with the selection list", () => {
    const rows = [
      { name: "Alice" },
      { name: "Alex" },
      { name: "Bob" },
      { name: "Charlie" },
    ];
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

    expect(run(rows, model, new Map([["name", textConfig()]]))).toEqual(
      new Uint32Array([2]),
    );
  });

  it("number OR conditions are intersected with the selection list", () => {
    const rows = [{ val: 10 }, { val: 20 }, { val: 30 }, { val: 40 }];
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

    expect(run(rows, model, new Map([["val", numberConfig()]]))).toEqual(
      new Uint32Array([2]),
    );
  });

  it("number between output", () => {
    const rows = [{ val: 10 }, { val: 20 }, { val: 30 }, { val: 40 }];
    const model: FilterModel = {
      val: { type: "number", operator: "and", conditions: [{ operator: "between", value: 15, valueTo: 35 }] },
    };
    expect(run(rows, model, new Map([["val", numberConfig()]]))).toEqual(
      new Uint32Array([1, 2]),
    );
  });

  it("date before output using day keys", () => {
    const rows = [{ val: "2024-01-15" }, { val: "2024-06-01" }, { val: "2024-12-31" }];
    const model: FilterModel = {
      val: { type: "date", operator: "and", conditions: [{ operator: "before", value: "2024-06-01" }] },
    };
    expect(run(rows, model, new Map([["val", dateConfig()]]))).toEqual(
      new Uint32Array([0]),
    );
  });

  it("date between output using day keys", () => {
    const rows = [{ val: "2024-01-15" }, { val: "2024-06-01" }, { val: "2024-12-31" }];
    const model: FilterModel = {
      val: {
        type: "date",
        operator: "and",
        conditions: [{ operator: "between", value: "2024-01-01", valueTo: "2024-06-30" }],
      },
    };
    expect(run(rows, model, new Map([["val", dateConfig()]]))).toEqual(
      new Uint32Array([0, 1]),
    );
  });

  it("boolean equals output", () => {
    const rows = [{ val: true }, { val: false }, { val: "true" }, { val: null }];
    const model: FilterModel = {
      val: { type: "boolean", operator: "and", conditions: [{ operator: "equals", value: true }] },
    };
    expect(run(rows, model, new Map([["val", booleanConfig()]]))).toEqual(
      new Uint32Array([0, 2]),
    );
  });

  it("multi-column AND output", () => {
    const rows = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
      { name: "Charlie", age: 35 },
      { name: "Alex", age: 20 },
    ];
    const model: FilterModel = {
      name: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "a" }] },
      age: { type: "number", operator: "and", conditions: [{ operator: "gte", value: 30 }] },
    };
    const cols = new Map<string, NormalizedColumnFilterConfig>([
      ["name", textConfig()],
      ["age", numberConfig()],
    ]);
    expect(run(rows, model, cols)).toEqual(new Uint32Array([0, 2]));
  });

  it("sourceIndexes subset output", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }, { name: "Charlie" }, { name: "Alice" }];
    const model: FilterModel = {
      name: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "ali" }] },
    };
    expect(run(rows, model, new Map([["name", textConfig()]]), [0, 1, 3])).toEqual(
      new Uint32Array([0, 3]),
    );
  });

  it("all-failing filter returns exact empty Uint32Array", () => {
    const rows = [{ val: 10 }, { val: 20 }, { val: 30 }];
    const model: FilterModel = {
      val: { type: "number", operator: "and", conditions: [{ operator: "equals", value: 999 }] },
    };
    const result = run(rows, model, new Map([["val", numberConfig()]]));
    expect(result).toEqual(new Uint32Array([]));
    expect(result).toBeInstanceOf(Uint32Array);
    expect(result).toHaveLength(0);
    expect(result.buffer.byteLength).toBe(0);
  });

  it("all-passing filter returns exact index order", () => {
    const rows = [{ val: 10 }, { val: 20 }, { val: 30 }];
    const model: FilterModel = {
      val: { type: "number", operator: "and", conditions: [{ operator: "gt", value: 0 }] },
    };
    const result = run(rows, model, new Map([["val", numberConfig()]]));
    expect(result).toEqual(new Uint32Array([0, 1, 2]));
    expect(result).toHaveLength(3);
  });

  it("text in matches selected values", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }, { name: "Charlie" }, { name: null }];
    const model: FilterModel = {
      name: { type: "text", operator: "and", conditions: [{ operator: "in", value: ["alice", "charlie"] }] },
    };
    const result = run(rows, model, new Map([["name", textConfig()]]));
    expect(result).toEqual(new Uint32Array([0, 2]));
  });

  it("text notIn excludes selected values", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }, { name: "Charlie" }];
    const model: FilterModel = {
      name: { type: "text", operator: "and", conditions: [{ operator: "notIn", value: ["alice"] }] },
    };
    const result = run(rows, model, new Map([["name", textConfig()]]));
    expect(result).toEqual(new Uint32Array([1, 2]));
  });

  it("number in matches selected values", () => {
    const rows = [{ val: 10 }, { val: 20 }, { val: 30 }, { val: null }];
    const model: FilterModel = {
      val: { type: "number", operator: "and", conditions: [{ operator: "in", value: [10, 30] }] },
    };
    const result = run(rows, model, new Map([["val", numberConfig()]]));
    expect(result).toEqual(new Uint32Array([0, 2]));
  });

  it("date in matches selected values", () => {
    const rows = [{ val: "2024-01-15" }, { val: "2024-06-01" }, { val: "2024-12-31" }, { val: null }];
    const model: FilterModel = {
      val: { type: "date", operator: "and", conditions: [{ operator: "in", value: ["2024-01-15", "2024-12-31"] }] },
    };
    const result = run(rows, model, new Map([["val", dateConfig()]]));
    expect(result).toEqual(new Uint32Array([0, 2]));
  });

  it("boolean in matches selected values", () => {
    const rows = [{ val: true }, { val: false }, { val: null }];
    const model: FilterModel = {
      val: { type: "boolean", operator: "and", conditions: [{ operator: "in", value: [true] }] },
    };
    const result = run(rows, model, new Map([["val", booleanConfig()]]));
    expect(result).toEqual(new Uint32Array([0]));
  });
});
