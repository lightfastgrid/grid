import { describe, expect, it } from "vitest";

import {
  isColumnFilterOperatorForType,
  normalizeOperator,
} from "../filterOperators";

describe("isColumnFilterOperatorForType", () => {
  it("accepts valid text operator", () => {
    expect(isColumnFilterOperatorForType("contains", "text")).toBe(true);
  });

  it("rejects invalid operator for type", () => {
    expect(isColumnFilterOperatorForType("gt", "text")).toBe(false);
    expect(isColumnFilterOperatorForType("contains", "number")).toBe(false);
  });

  it("accepts valid number operator", () => {
    expect(isColumnFilterOperatorForType("between", "number")).toBe(true);
  });

  it("accepts valid date operator", () => {
    expect(isColumnFilterOperatorForType("before", "date")).toBe(true);
  });

  it("accepts valid boolean operator", () => {
    expect(isColumnFilterOperatorForType("isNull", "boolean")).toBe(true);
  });

  it("accepts in/notIn for all types", () => {
    for (const type of ["text", "number", "date", "boolean"] as const) {
      expect(isColumnFilterOperatorForType("in", type)).toBe(true);
      expect(isColumnFilterOperatorForType("notIn", type)).toBe(true);
    }
  });
});

describe("normalizeOperator", () => {
  // ── common aliases ─────────────────────────────────────────

  it("notEqual -> notEquals for text", () => {
    expect(normalizeOperator("notEqual", "text")).toBe("notEquals");
  });

  it("greaterThan -> gt for number", () => {
    expect(normalizeOperator("greaterThan", "number")).toBe("gt");
  });

  it("greaterThanOrEqual -> gte for number", () => {
    expect(normalizeOperator("greaterThanOrEqual", "number")).toBe("gte");
  });

  it("lessThan -> lt for number", () => {
    expect(normalizeOperator("lessThan", "number")).toBe("lt");
  });

  it("lessThanOrEqual -> lte for number", () => {
    expect(normalizeOperator("lessThanOrEqual", "number")).toBe("lte");
  });

  it("inRange -> between for number", () => {
    expect(normalizeOperator("inRange", "number")).toBe("between");
  });

  it("inRange -> between for date", () => {
    expect(normalizeOperator("inRange", "date")).toBe("between");
  });

  // ── blank / notBlank ───────────────────────────────────────

  it("blank -> isEmpty for text", () => {
    expect(normalizeOperator("blank", "text")).toBe("isEmpty");
  });

  it("blank -> isNull for number", () => {
    expect(normalizeOperator("blank", "number")).toBe("isNull");
  });

  it("blank -> isNull for date", () => {
    expect(normalizeOperator("blank", "date")).toBe("isNull");
  });

  it("blank -> isNull for boolean", () => {
    expect(normalizeOperator("blank", "boolean")).toBe("isNull");
  });

  it("notBlank -> isNotEmpty for text", () => {
    expect(normalizeOperator("notBlank", "text")).toBe("isNotEmpty");
  });

  it("notBlank -> isNotNull for number", () => {
    expect(normalizeOperator("notBlank", "number")).toBe("isNotNull");
  });

  it("notBlank -> isNotNull for date", () => {
    expect(normalizeOperator("notBlank", "date")).toBe("isNotNull");
  });

  it("notBlank -> isNotNull for boolean", () => {
    expect(normalizeOperator("notBlank", "boolean")).toBe("isNotNull");
  });

  // ── empty ──────────────────────────────────────────────────

  it("empty returns null (inactive)", () => {
    expect(normalizeOperator("empty", "text")).toBeNull();
    expect(normalizeOperator("empty", "number")).toBeNull();
  });

  // ── unknown ────────────────────────────────────────────────

  it("unknown operator returns null", () => {
    expect(normalizeOperator("foobar", "text")).toBeNull();
  });

  it("alias that resolves to invalid op for type returns null", () => {
    expect(normalizeOperator("greaterThan", "text")).toBeNull();
    expect(normalizeOperator("greaterThan", "boolean")).toBeNull();
  });

  // ── canonical passthrough ──────────────────────────────────

  it("canonical operator passes through", () => {
    expect(normalizeOperator("contains", "text")).toBe("contains");
    expect(normalizeOperator("gt", "number")).toBe("gt");
    expect(normalizeOperator("before", "date")).toBe("before");
    expect(normalizeOperator("equals", "boolean")).toBe("equals");
  });
});
