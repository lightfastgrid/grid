import { describe, expect, it } from "vitest";

import type { NormalizedColumnFilterConfig } from "../../../../features/filters/types";
import type { FilterModel } from "../../../../types";
import { resolveWorkerFilterEligibility } from "../filterWorkerEligibility";

function textConfig(): NormalizedColumnFilterConfig {
  return { type: "text", defaultOperator: "contains", caseSensitive: false, trimInput: true };
}

function numberConfig(): NormalizedColumnFilterConfig {
  return { type: "number", defaultOperator: "equals", caseSensitive: false, trimInput: true };
}

function dateConfig(): NormalizedColumnFilterConfig {
  return { type: "date", defaultOperator: "equals", caseSensitive: false, trimInput: true };
}

describe("resolveWorkerFilterEligibility", () => {
  it("empty filter model is ineligible with reason 'empty-filter'", () => {
    const result = resolveWorkerFilterEligibility(
      {},
      new Map([["name", textConfig()]]),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("empty-filter");
    expect(result.fields).toEqual([]);
  });

  it("custom getCellValue is ineligible with reason 'custom-getCellValue'", () => {
    const model: FilterModel = {
      name: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "a" }] },
    };
    const result = resolveWorkerFilterEligibility(
      model,
      new Map([["name", textConfig()]]),
      (row, _idx, field) => row[field],
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("custom-getCellValue");
  });

  it("unknown/unconfigured fields are skipped", () => {
    const model: FilterModel = {
      name: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "a" }] },
      age: { type: "number", operator: "and", conditions: [{ operator: "gt", value: 10 }] },
    };
    const cols = new Map<string, NormalizedColumnFilterConfig>([["name", textConfig()]]);
    const result = resolveWorkerFilterEligibility(model, cols);
    expect(result.eligible).toBe(true);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]!.field).toBe("name");
  });

  it("no resolvable active fields is ineligible with reason 'no-resolvable-fields'", () => {
    const model: FilterModel = {
      unknown: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "a" }] },
    };
    const result = resolveWorkerFilterEligibility(model, new Map());
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("no-resolvable-fields");
  });

  it("valid active fields are eligible with resolved entries", () => {
    const model: FilterModel = {
      name: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "a" }] },
      age: { type: "number", operator: "and", conditions: [{ operator: "gt", value: 10 }] },
      joined: { type: "date", operator: "and", conditions: [{ operator: "before", value: "2024-06-01" }] },
    };
    const cols = new Map<string, NormalizedColumnFilterConfig>([
      ["name", textConfig()],
      ["age", numberConfig()],
      ["joined", dateConfig()],
    ]);
    const result = resolveWorkerFilterEligibility(model, cols);
    expect(result.eligible).toBe(true);
    expect(result.fields).toHaveLength(3);
    expect(result.fields.map((f) => f.field)).toEqual(["name", "age", "joined"]);
  });
});
