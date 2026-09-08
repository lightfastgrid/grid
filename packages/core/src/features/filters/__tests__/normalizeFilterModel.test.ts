import { describe, expect, it } from "vitest";

import type { RawColumnFilterModel } from "../normalizeFilterModel";
import {
  normalizeColumnFilterModel,
  normalizeFilterCondition,
  normalizeFilterModel,
} from "../normalizeFilterModel";
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

// ── normalizeFilterCondition ─────────────────────────────────

describe("normalizeFilterCondition", () => {
  // ── text ──────────────────────────────────────────────────

  it("text contains with valid string", () => {
    const result = normalizeFilterCondition(
      { operator: "contains", value: "hello" },
      textConfig(),
    );
    expect(result).toEqual({ operator: "contains", value: "hello" });
  });

  it("text trims value when trimInput is true", () => {
    const result = normalizeFilterCondition(
      { operator: "contains", value: "  hello  " },
      textConfig(),
    );
    expect(result).toEqual({ operator: "contains", value: "hello" });
  });

  it("text preserves whitespace when trimInput is false", () => {
    const result = normalizeFilterCondition(
      { operator: "contains", value: "  hello  " },
      textConfig({ trimInput: false }),
    );
    expect(result).toEqual({ operator: "contains", value: "  hello  " });
  });

  it("text trim to empty string returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: "   " },
      textConfig(),
    )).toBeNull();
  });

  it("text isEmpty requires no value", () => {
    const result = normalizeFilterCondition(
      { operator: "isEmpty" },
      textConfig(),
    );
    expect(result).toEqual({ operator: "isEmpty" });
  });

  it("text isNotEmpty requires no value", () => {
    const result = normalizeFilterCondition(
      { operator: "isNotEmpty" },
      textConfig(),
    );
    expect(result).toEqual({ operator: "isNotEmpty" });
  });

  it("text non-string value returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "contains", value: 123 },
      textConfig(),
    )).toBeNull();
  });

  // ── number ────────────────────────────────────────────────

  it("number equals with finite number", () => {
    const result = normalizeFilterCondition(
      { operator: "equals", value: 42 },
      numberConfig(),
    );
    expect(result).toEqual({ operator: "equals", value: 42 });
  });

  it("number string normalizes to number", () => {
    const result = normalizeFilterCondition(
      { operator: "gt", value: "3.14" },
      numberConfig(),
    );
    expect(result).toEqual({ operator: "gt", value: 3.14 });
  });

  it("number invalid string returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: "abc" },
      numberConfig(),
    )).toBeNull();
  });

  it("number NaN returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: NaN },
      numberConfig(),
    )).toBeNull();
  });

  it("number Infinity returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: Infinity },
      numberConfig(),
    )).toBeNull();
  });

  it("number between valid range", () => {
    const result = normalizeFilterCondition(
      { operator: "between", value: 10, valueTo: 20 },
      numberConfig(),
    );
    expect(result).toEqual({ operator: "between", value: 10, valueTo: 20 });
  });

  it("number between with string values normalizes", () => {
    const result = normalizeFilterCondition(
      { operator: "between", value: "5", valueTo: "15" },
      numberConfig(),
    );
    expect(result).toEqual({ operator: "between", value: 5, valueTo: 15 });
  });

  it("number between value > valueTo returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "between", value: 20, valueTo: 10 },
      numberConfig(),
    )).toBeNull();
  });

  it("number between missing valueTo returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "between", value: 10 },
      numberConfig(),
    )).toBeNull();
  });

  it("number isNull requires no value", () => {
    expect(normalizeFilterCondition(
      { operator: "isNull" },
      numberConfig(),
    )).toEqual({ operator: "isNull" });
  });

  // ── date ──────────────────────────────────────────────────

  it("date equals with valid YYYY-MM-DD", () => {
    const result = normalizeFilterCondition(
      { operator: "equals", value: "2024-06-15" },
      dateConfig(),
    );
    expect(result).toEqual({ operator: "equals", value: "2024-06-15" });
  });

  it("date invalid format returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: "06/15/2024" },
      dateConfig(),
    )).toBeNull();
  });

  it("date invalid date returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: "2024-13-01" },
      dateConfig(),
    )).toBeNull();
  });

  it("date non-string returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: 20240615 },
      dateConfig(),
    )).toBeNull();
  });

  it("date between valid range", () => {
    const result = normalizeFilterCondition(
      { operator: "between", value: "2024-01-01", valueTo: "2024-12-31" },
      dateConfig(),
    );
    expect(result).toEqual({ operator: "between", value: "2024-01-01", valueTo: "2024-12-31" });
  });

  it("date between value > valueTo returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "between", value: "2024-12-31", valueTo: "2024-01-01" },
      dateConfig(),
    )).toBeNull();
  });

  it("date between invalid valueTo returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "between", value: "2024-01-01", valueTo: "not-a-date" },
      dateConfig(),
    )).toBeNull();
  });

  it("date isNull requires no value", () => {
    expect(normalizeFilterCondition(
      { operator: "isNull" },
      dateConfig(),
    )).toEqual({ operator: "isNull" });
  });

  // ── date strict validation ─────────────────────────────────

  it("date rejects rolled-over 2024-02-31", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: "2024-02-31" },
      dateConfig(),
    )).toBeNull();
  });

  it("date rejects rolled-over 2024-13-01", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: "2024-13-01" },
      dateConfig(),
    )).toBeNull();
  });

  it("date rejects 2023-02-29 (non-leap year)", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: "2023-02-29" },
      dateConfig(),
    )).toBeNull();
  });

  it("date rejects zero month 2024-00-10", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: "2024-00-10" },
      dateConfig(),
    )).toBeNull();
  });

  it("date rejects zero day 2024-01-00", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: "2024-01-00" },
      dateConfig(),
    )).toBeNull();
  });

  it("date accepts leap day 2024-02-29", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: "2024-02-29" },
      dateConfig(),
    )).toEqual({ operator: "equals", value: "2024-02-29" });
  });

  // ── boolean ───────────────────────────────────────────────

  it("boolean equals with boolean value", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: true },
      booleanConfig(),
    )).toEqual({ operator: "equals", value: true });
  });

  it('boolean "true" string normalizes to boolean', () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: "true" },
      booleanConfig(),
    )).toEqual({ operator: "equals", value: true });
  });

  it('boolean "false" string normalizes to boolean', () => {
    expect(normalizeFilterCondition(
      { operator: "notEquals", value: "false" },
      booleanConfig(),
    )).toEqual({ operator: "notEquals", value: false });
  });

  it("boolean invalid value returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: "yes" },
      booleanConfig(),
    )).toBeNull();
  });

  it("boolean number value returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "equals", value: 1 },
      booleanConfig(),
    )).toBeNull();
  });

  it("boolean isNull requires no value", () => {
    expect(normalizeFilterCondition(
      { operator: "isNull" },
      booleanConfig(),
    )).toEqual({ operator: "isNull" });
  });

  // ── operator aliases through condition ────────────────────

  it("alias operator resolves through condition", () => {
    const result = normalizeFilterCondition(
      { operator: "notEqual", value: "x" },
      textConfig(),
    );
    expect(result).toEqual({ operator: "notEquals", value: "x" });
  });

  it("empty operator returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "empty", value: "x" },
      textConfig(),
    )).toBeNull();
  });

  it("unknown operator returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "foobar", value: "x" },
      textConfig(),
    )).toBeNull();
  });

  it("invalid operator for type returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "gt", value: "x" },
      textConfig(),
    )).toBeNull();
  });

  it("missing operator returns null", () => {
    expect(normalizeFilterCondition(
      { value: "x" },
      textConfig(),
    )).toBeNull();
  });

  // ── in / notIn ────────────────────────────────────────────

  it("text in with valid string array", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: ["Alice", "Bob"] },
      textConfig(),
    )).toEqual({ operator: "in", value: ["Alice", "Bob"] });
  });

  it("text in trims values", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: ["  Alice  ", "Bob"] },
      textConfig(),
    )).toEqual({ operator: "in", value: ["Alice", "Bob"] });
  });

  it("text in filters out empty-after-trim values", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: ["Alice", "   "] },
      textConfig(),
    )).toEqual({ operator: "in", value: ["Alice"] });
  });

  it("text in all empty after trim returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: ["  ", ""] },
      textConfig(),
    )).toBeNull();
  });

  it("text in empty array returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: [] },
      textConfig(),
    )).toBeNull();
  });

  it("text in non-array returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: "Alice" },
      textConfig(),
    )).toBeNull();
  });

  it("text in with non-string item returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: ["Alice", 123] },
      textConfig(),
    )).toBeNull();
  });

  it("text notIn with valid array", () => {
    expect(normalizeFilterCondition(
      { operator: "notIn", value: ["Alice"] },
      textConfig(),
    )).toEqual({ operator: "notIn", value: ["Alice"] });
  });

  it("number in with valid numbers", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: [10, 20, 30] },
      numberConfig(),
    )).toEqual({ operator: "in", value: [10, 20, 30] });
  });

  it("number in normalizes string values", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: ["10", "20"] },
      numberConfig(),
    )).toEqual({ operator: "in", value: [10, 20] });
  });

  it("number in with NaN returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: [10, NaN] },
      numberConfig(),
    )).toBeNull();
  });

  it("number in empty array returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: [] },
      numberConfig(),
    )).toBeNull();
  });

  it("number notIn with valid numbers", () => {
    expect(normalizeFilterCondition(
      { operator: "notIn", value: [10] },
      numberConfig(),
    )).toEqual({ operator: "notIn", value: [10] });
  });

  it("date in with valid dates", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: ["2024-01-15", "2024-06-01"] },
      dateConfig(),
    )).toEqual({ operator: "in", value: ["2024-01-15", "2024-06-01"] });
  });

  it("date in with invalid date returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: ["2024-01-15", "not-a-date"] },
      dateConfig(),
    )).toBeNull();
  });

  it("date in empty array returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: [] },
      dateConfig(),
    )).toBeNull();
  });

  it("boolean in with valid booleans", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: [true, false] },
      booleanConfig(),
    )).toEqual({ operator: "in", value: [true, false] });
  });

  it("boolean in normalizes string booleans", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: ["true", "false"] },
      booleanConfig(),
    )).toEqual({ operator: "in", value: [true, false] });
  });

  it("boolean in with invalid value returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: [true, "yes"] },
      booleanConfig(),
    )).toBeNull();
  });

  it("boolean in empty array returns null", () => {
    expect(normalizeFilterCondition(
      { operator: "in", value: [] },
      booleanConfig(),
    )).toBeNull();
  });
});

// ── normalizeColumnFilterModel ───────────────────────────────

describe("normalizeColumnFilterModel", () => {
  it("normalizes valid conditions", () => {
    const result = normalizeColumnFilterModel(
      { conditions: [{ operator: "contains", value: "test" }] },
      textConfig(),
    );
    expect(result).toEqual({
      type: "text",
      operator: "and",
      conditions: [{ operator: "contains", value: "test" }],
    });
  });

  it("removes invalid conditions", () => {
    const result = normalizeColumnFilterModel(
      {
        conditions: [
          { operator: "foobar", value: "x" },
          { operator: "contains", value: "ok" },
        ],
      },
      textConfig(),
    );
    expect(result).toEqual({
      type: "text",
      operator: "and",
      conditions: [{ operator: "contains", value: "ok" }],
    });
  });

  it("returns null when no valid conditions", () => {
    expect(normalizeColumnFilterModel(
      { conditions: [{ operator: "foobar", value: "x" }] },
      textConfig(),
    )).toBeNull();
  });

  it("returns null for empty conditions", () => {
    expect(normalizeColumnFilterModel(
      { conditions: [] },
      textConfig(),
    )).toBeNull();
  });

  it("returns null for missing conditions", () => {
    const raw: RawColumnFilterModel = {};
    expect(normalizeColumnFilterModel(raw, textConfig())).toBeNull();
  });

  it("keeps max 2 conditions", () => {
    const result = normalizeColumnFilterModel(
      {
        conditions: [
          { operator: "contains", value: "a" },
          { operator: "startsWith", value: "b" },
          { operator: "endsWith", value: "c" },
        ],
      },
      textConfig(),
    );
    expect(result!.conditions).toHaveLength(2);
    expect(result!.conditions[0]!.operator).toBe("contains");
    expect(result!.conditions[1]!.operator).toBe("startsWith");
  });

  it("sets operator to 'and' consistently", () => {
    const single = normalizeColumnFilterModel(
      { conditions: [{ operator: "equals", value: "x" }] },
      textConfig(),
    );
    expect(single!.operator).toBe("and");

    const double = normalizeColumnFilterModel(
      {
        conditions: [
          { operator: "contains", value: "a" },
          { operator: "startsWith", value: "b" },
        ],
      },
      textConfig(),
    );
    expect(double!.operator).toBe("and");
  });

  it("preserves operator: 'or' with two valid conditions", () => {
    const result = normalizeColumnFilterModel(
      {
        operator: "or",
        conditions: [
          { operator: "contains", value: "a" },
          { operator: "startsWith", value: "b" },
        ],
      },
      textConfig(),
    );
    expect(result!.operator).toBe("or");
  });

  it("preserves operator: 'and' with two valid conditions", () => {
    const result = normalizeColumnFilterModel(
      {
        operator: "and",
        conditions: [
          { operator: "contains", value: "a" },
          { operator: "startsWith", value: "b" },
        ],
      },
      textConfig(),
    );
    expect(result!.operator).toBe("and");
  });

  it("invalid operator defaults to 'and'", () => {
    const result = normalizeColumnFilterModel(
      {
        operator: "xor",
        conditions: [
          { operator: "contains", value: "a" },
          { operator: "startsWith", value: "b" },
        ],
      },
      textConfig(),
    );
    expect(result!.operator).toBe("and");
  });

  it("missing operator defaults to 'and'", () => {
    const result = normalizeColumnFilterModel(
      {
        conditions: [
          { operator: "contains", value: "a" },
          { operator: "startsWith", value: "b" },
        ],
      },
      textConfig(),
    );
    expect(result!.operator).toBe("and");
  });

  it("uses config type, not raw type", () => {
    const result = normalizeColumnFilterModel(
      { type: "date", conditions: [{ operator: "equals", value: 42 }] },
      numberConfig(),
    );
    expect(result!.type).toBe("number");
  });
});

// ── normalizeFilterModel ─────────────────────────────────────

describe("normalizeFilterModel", () => {
  it("normalizes multiple fields", () => {
    const ctx = {
      columnsByField: new Map<string, NormalizedColumnFilterConfig>([
        ["name", textConfig()],
        ["age", numberConfig()],
      ]),
    };
    const result = normalizeFilterModel(
      {
        name: { conditions: [{ operator: "contains", value: "Jo" }] },
        age: { conditions: [{ operator: "gt", value: 18 }] },
      },
      ctx,
    );
    expect(Object.keys(result)).toEqual(["name", "age"]);
    expect(result["name"]!.conditions[0]).toEqual({ operator: "contains", value: "Jo" });
    expect(result["age"]!.conditions[0]).toEqual({ operator: "gt", value: 18 });
  });

  it("removes unknown fields", () => {
    const ctx = {
      columnsByField: new Map<string, NormalizedColumnFilterConfig>([
        ["name", textConfig()],
      ]),
    };
    const result = normalizeFilterModel(
      {
        name: { conditions: [{ operator: "contains", value: "Jo" }] },
        unknown: { conditions: [{ operator: "equals", value: "x" }] },
      },
      ctx,
    );
    expect(Object.keys(result)).toEqual(["name"]);
  });

  it("removes fields with no valid conditions", () => {
    const ctx = {
      columnsByField: new Map<string, NormalizedColumnFilterConfig>([
        ["name", textConfig()],
        ["age", numberConfig()],
      ]),
    };
    const result = normalizeFilterModel(
      {
        name: { conditions: [{ operator: "foobar", value: "x" }] },
        age: { conditions: [{ operator: "equals", value: 42 }] },
      },
      ctx,
    );
    expect(Object.keys(result)).toEqual(["age"]);
  });

  it("returns empty object when all fields invalid", () => {
    const ctx = {
      columnsByField: new Map<string, NormalizedColumnFilterConfig>([
        ["name", textConfig()],
      ]),
    };
    const result = normalizeFilterModel(
      { name: { conditions: [{ operator: "foobar", value: "x" }] } },
      ctx,
    );
    expect(result).toEqual({});
  });

  it("skips non-object field values", () => {
    const ctx = {
      columnsByField: new Map<string, NormalizedColumnFilterConfig>([
        ["name", textConfig()],
      ]),
    };
    const raw: Record<string, unknown> = { name: "not an object" };
    const result = normalizeFilterModel(
      raw,
      ctx,
    );
    expect(result).toEqual({});
  });
});
