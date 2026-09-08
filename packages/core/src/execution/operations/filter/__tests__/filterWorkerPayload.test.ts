import { describe, expect, it } from "vitest";

import { buildFilterTypedValueCache } from "../../../../features/filters/filterTypedValueCache";
import type { NormalizedColumnFilterConfig } from "../../../../features/filters/types";
import type { FilterModel, RowData } from "../../../../types";
import { resolveDotPath } from "../../../../utils/resolveDotPath";
import { resolveWorkerFilterEligibility } from "../filterWorkerEligibility";
import type {
  WorkerFilterBooleanFieldCache,
  WorkerFilterDateFieldCache,
  WorkerFilterFieldCache,
  WorkerFilterNumberFieldCache,
  WorkerFilterTextFieldCache,
} from "../filterWorkerPayload";
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

function buildPayload(
  rows: RowData[],
  model: FilterModel,
  cols: Map<string, NormalizedColumnFilterConfig>,
  sourceIndexes?: readonly number[] | Uint32Array,
) {
  const eligibility = resolveWorkerFilterEligibility(model, cols);
  return buildWorkerFilterPayload(rows, model, cols, eligibility, sourceIndexes);
}

function readLikeWorker(row: RowData, _rowIndex: number, field: string): unknown {
  return field.includes(".") ? resolveDotPath(row, field.split(".")) : row[field];
}

function expectWorkerCacheToEqualFeatureCache(
  workerCache: WorkerFilterFieldCache,
  featureCache: WorkerFilterFieldCache,
): void {
  expect(workerCache.type).toBe(featureCache.type);

  switch (workerCache.type) {
    case "text":
      if (featureCache.type !== "text") throw new Error("Expected text cache");
      expect(workerCache.values).toEqual(featureCache.values);
      expect(workerCache.nullFlags).toEqual(featureCache.nullFlags);
      expect(workerCache.caseSensitive).toBe(featureCache.caseSensitive);
      break;
    case "number":
      if (featureCache.type !== "number") throw new Error("Expected number cache");
      expect(workerCache.values).toEqual(featureCache.values);
      expect(workerCache.validFlags).toEqual(featureCache.validFlags);
      break;
    case "date":
      if (featureCache.type !== "date") throw new Error("Expected date cache");
      expect(workerCache.dayKeys).toEqual(featureCache.dayKeys);
      expect(workerCache.validFlags).toEqual(featureCache.validFlags);
      break;
    case "boolean":
      if (featureCache.type !== "boolean") throw new Error("Expected boolean cache");
      expect(workerCache.values).toEqual(featureCache.values);
      break;
  }
}

describe("buildWorkerFilterPayload", () => {
  it("text payload has string[] values + Uint8Array nullFlags", () => {
    const rows = [{ name: "Alice" }, { name: null }];
    const model: FilterModel = {
      name: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "a" }] },
    };
    const payload = buildPayload(rows, model, new Map([["name", textConfig()]]));
    expect(payload).not.toBeNull();
    const tc = payload!.fields[0]!.cache as WorkerFilterTextFieldCache;
    expect(tc.type).toBe("text");
    expect(Array.isArray(tc.values)).toBe(true);
    expect(tc.nullFlags).toBeInstanceOf(Uint8Array);
    expect(tc.values[0]).toBe("alice");
    expect(tc.nullFlags[0]).toBe(0);
    expect(tc.nullFlags[1]).toBe(1);
  });

  it("number payload has Float64Array values + Uint8Array validFlags", () => {
    const rows = [{ val: 42 }, { val: null }, { val: "3.14" }];
    const model: FilterModel = {
      val: { type: "number", operator: "and", conditions: [{ operator: "equals", value: 42 }] },
    };
    const payload = buildPayload(rows, model, new Map([["val", numberConfig()]]));
    expect(payload).not.toBeNull();
    const nc = payload!.fields[0]!.cache as WorkerFilterNumberFieldCache;
    expect(nc.type).toBe("number");
    expect(nc.values).toBeInstanceOf(Float64Array);
    expect(nc.validFlags).toBeInstanceOf(Uint8Array);
    expect(nc.values[0]).toBe(42);
    expect(nc.validFlags[0]).toBe(1);
    expect(nc.validFlags[1]).toBe(0);
    expect(nc.values[2]).toBeCloseTo(3.14);
    expect(nc.validFlags[2]).toBe(1);
  });

  it("date payload has Int32Array dayKeys + Uint8Array validFlags", () => {
    const rows = [{ val: "2024-06-01" }, { val: null }, { val: "not-a-date" }];
    const model: FilterModel = {
      val: { type: "date", operator: "and", conditions: [{ operator: "equals", value: "2024-06-01" }] },
    };
    const payload = buildPayload(rows, model, new Map([["val", dateConfig()]]));
    expect(payload).not.toBeNull();
    const dc = payload!.fields[0]!.cache as WorkerFilterDateFieldCache;
    expect(dc.type).toBe("date");
    expect(dc.dayKeys).toBeInstanceOf(Int32Array);
    expect(dc.validFlags).toBeInstanceOf(Uint8Array);
    expect(dc.validFlags[0]).toBe(1);
    expect(dc.validFlags[1]).toBe(0);
    expect(dc.validFlags[2]).toBe(0);
  });

  it("boolean payload has Uint8Array values with 0=false, 1=true, 2=null", () => {
    const rows = [{ val: true }, { val: false }, { val: null }, { val: "true" }];
    const model: FilterModel = {
      val: { type: "boolean", operator: "and", conditions: [{ operator: "equals", value: true }] },
    };
    const payload = buildPayload(rows, model, new Map([["val", booleanConfig()]]));
    expect(payload).not.toBeNull();
    const bc = payload!.fields[0]!.cache as WorkerFilterBooleanFieldCache;
    expect(bc.type).toBe("boolean");
    expect(bc.values).toBeInstanceOf(Uint8Array);
    expect(bc.values[0]).toBe(1);
    expect(bc.values[1]).toBe(0);
    expect(bc.values[2]).toBe(2);
    expect(bc.values[3]).toBe(1);
  });

  it("sourceIndexes is converted/preserved as Uint32Array", () => {
    const rows = [{ val: 10 }, { val: 20 }, { val: 30 }];
    const model: FilterModel = {
      val: { type: "number", operator: "and", conditions: [{ operator: "gt", value: 5 }] },
    };

    const fromArray = buildPayload(rows, model, new Map([["val", numberConfig()]]), [0, 2]);
    expect(fromArray).not.toBeNull();
    expect(fromArray!.sourceIndexes).toBeInstanceOf(Uint32Array);
    expect(fromArray!.sourceIndexes).toEqual(new Uint32Array([0, 2]));

    const fromTyped = buildPayload(rows, model, new Map([["val", numberConfig()]]), new Uint32Array([1]));
    expect(fromTyped!.sourceIndexes).toBeInstanceOf(Uint32Array);
    expect(fromTyped!.sourceIndexes).toEqual(new Uint32Array([1]));
  });

  it("payload returns null when eligibility is ineligible", () => {
    const rows = [{ val: 10 }];
    const model: FilterModel = {};
    const cols = new Map([["val", numberConfig()]]);
    const eligibility = resolveWorkerFilterEligibility(model, cols);
    const payload = buildWorkerFilterPayload(rows, model, cols, eligibility);
    expect(payload).toBeNull();
  });

  it("resolves dot-path boolean field", () => {
    const rows: RowData[] = [
      { game: { bought: true } },
      { game: { bought: false } },
      { game: null },
    ];
    const model: FilterModel = {
      "game.bought": { type: "boolean", operator: "and", conditions: [{ operator: "equals", value: true }] },
    };
    const payload = buildPayload(rows, model, new Map([["game.bought", booleanConfig()]]));
    expect(payload).not.toBeNull();
    const bc = payload!.fields[0]!.cache as WorkerFilterBooleanFieldCache;
    expect(bc.type).toBe("boolean");
    expect(bc.values[0]).toBe(1);
    expect(bc.values[1]).toBe(0);
    expect(bc.values[2]).toBe(2);
  });

  it("resolves dot-path text field", () => {
    const rows: RowData[] = [
      { game: { name: "Chess" } },
      { game: { name: "Go" } },
    ];
    const model: FilterModel = {
      "game.name": { type: "text", operator: "and", conditions: [{ operator: "contains", value: "ch" }] },
    };
    const payload = buildPayload(rows, model, new Map([["game.name", textConfig()]]));
    expect(payload).not.toBeNull();
    const tc = payload!.fields[0]!.cache as WorkerFilterTextFieldCache;
    expect(tc.values[0]).toBe("chess");
    expect(tc.values[1]).toBe("go");
  });

  it("payload includes only active/resolvable fields", () => {
    const rows = [{ name: "Alice", age: 30 }];
    const model: FilterModel = {
      name: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "a" }] },
      unknown: { type: "text", operator: "and", conditions: [{ operator: "equals", value: "x" }] },
    };
    const cols = new Map<string, NormalizedColumnFilterConfig>([
      ["name", textConfig()],
      ["age", numberConfig()],
    ]);
    const payload = buildPayload(rows, model, cols);
    expect(payload).not.toBeNull();
    expect(payload!.fields).toHaveLength(1);
    expect(payload!.fields[0]!.field).toBe("name");
  });

  it("builds caches equivalent to the shared feature cache builder", () => {
    const rows: RowData[] = [
      { name: "Alice", age: "42", joined: "2024-06-01", active: true },
      { name: null, age: "nope", joined: "not-a-date", active: null },
      { name: "BOB", age: 7, joined: new Date(Date.UTC(2024, 0, 15)), active: "true" },
    ];
    const model: FilterModel = {
      name: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "a" }] },
      age: { type: "number", operator: "and", conditions: [{ operator: "gt", value: 5 }] },
      joined: { type: "date", operator: "and", conditions: [{ operator: "before", value: "2024-12-31" }] },
      active: { type: "boolean", operator: "and", conditions: [{ operator: "equals", value: true }] },
    };
    const cols = new Map<string, NormalizedColumnFilterConfig>([
      ["name", textConfig()],
      ["age", numberConfig()],
      ["joined", dateConfig()],
      ["active", booleanConfig()],
    ]);
    const sourceIndexes = new Uint32Array([0, 2]);

    const payload = buildPayload(rows, model, cols, sourceIndexes);
    const featureCache = buildFilterTypedValueCache({
      rows,
      filterModel: model,
      columnsByField: cols,
      getCellValue: readLikeWorker,
      sourceIndexes,
    });

    expect(payload).not.toBeNull();
    for (const entry of payload!.fields) {
      const expected = featureCache.fields.get(entry.field);
      expect(expected).toBeDefined();
      expectWorkerCacheToEqualFeatureCache(entry.cache, expected!);
    }
  });
});
