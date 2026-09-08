import { describe, expect, it } from "vitest";

import { resolveColumnFilterConfig } from "../normalizeColumnFilterConfig";

describe("resolveColumnFilterConfig", () => {
  // ── filter: true ─────────────────────────────────────────────

  it("filter: true resolves to text / contains", () => {
    const result = resolveColumnFilterConfig({ columnFilter: true });
    expect(result).toEqual({
      type: "text",
      defaultOperator: "contains",
      caseSensitive: false,
      trimInput: true,
    });
  });

  // ── filter: type string shorthand ─────────────────────────────

  it('filter: "number" resolves to number / equals', () => {
    const result = resolveColumnFilterConfig({ columnFilter: "number" });
    expect(result).toEqual({
      type: "number",
      defaultOperator: "equals",
      caseSensitive: false,
      trimInput: true,
    });
  });

  it('filter: "date" resolves to date / equals', () => {
    const result = resolveColumnFilterConfig({ columnFilter: "date" });
    expect(result).toEqual({
      type: "date",
      defaultOperator: "equals",
      caseSensitive: false,
      trimInput: true,
    });
  });

  it('filter: "boolean" resolves to boolean / equals', () => {
    const result = resolveColumnFilterConfig({ columnFilter: "boolean" });
    expect(result).toEqual({
      type: "boolean",
      defaultOperator: "equals",
      caseSensitive: false,
      trimInput: true,
    });
  });

  it('filter: "text" resolves to text / contains', () => {
    const result = resolveColumnFilterConfig({ columnFilter: "text" });
    expect(result).toEqual({
      type: "text",
      defaultOperator: "contains",
      caseSensitive: false,
      trimInput: true,
    });
  });

  // ── object config ────────────────────────────────────────────

  it("object config resolves caseSensitive and trimInput defaults", () => {
    const result = resolveColumnFilterConfig({
      columnFilter: { type: "text" },
    });
    expect(result).toEqual({
      type: "text",
      defaultOperator: "contains",
      caseSensitive: false,
      trimInput: true,
    });
  });

  it("object config preserves explicit caseSensitive and trimInput", () => {
    const result = resolveColumnFilterConfig({
      columnFilter: { type: "number", caseSensitive: true, trimInput: false },
    });
    expect(result).toEqual({
      type: "number",
      defaultOperator: "equals",
      caseSensitive: true,
      trimInput: false,
    });
  });

  it("object config with valid defaultOperator uses it", () => {
    const result = resolveColumnFilterConfig({
      columnFilter: { type: "text", defaultOperator: "startsWith" },
    });
    expect(result!.defaultOperator).toBe("startsWith");
  });

  it("object config defaults type to text when omitted", () => {
    const result = resolveColumnFilterConfig({
      columnFilter: { caseSensitive: true },
    });
    expect(result!.type).toBe("text");
    expect(result!.defaultOperator).toBe("contains");
  });

  // ── defaultColDef ────────────────────────────────────────────

  it("defaultColDef filter applies when column filter is absent", () => {
    const result = resolveColumnFilterConfig({
      defaultFilter: "number",
    });
    expect(result).toEqual({
      type: "number",
      defaultOperator: "equals",
      caseSensitive: false,
      trimInput: true,
    });
  });

  it("column filter overrides defaultColDef filter", () => {
    const result = resolveColumnFilterConfig({
      columnFilter: "date",
      defaultFilter: "number",
    });
    expect(result!.type).toBe("date");
    expect(result!.defaultOperator).toBe("equals");
  });

  // ── filterable interaction ───────────────────────────────────

  it("filterable: false disables even when filter config exists", () => {
    const result = resolveColumnFilterConfig({
      columnFilterable: false,
      columnFilter: "text",
    });
    expect(result).toBeNull();
  });

  it("filterable: false disables even with defaultColDef filter", () => {
    const result = resolveColumnFilterConfig({
      columnFilterable: false,
      defaultFilter: "number",
    });
    expect(result).toBeNull();
  });

  it("filterable: true enables text when no filter config exists", () => {
    const result = resolveColumnFilterConfig({
      columnFilterable: true,
    });
    expect(result).toEqual({
      type: "text",
      defaultOperator: "contains",
      caseSensitive: false,
      trimInput: true,
    });
  });

  it("filterable: true with filter: false still enables text filter", () => {
    const result = resolveColumnFilterConfig({
      columnFilterable: true,
      columnFilter: false,
    });
    expect(result).toEqual({
      type: "text",
      defaultOperator: "contains",
      caseSensitive: false,
      trimInput: true,
    });
  });

  it("filter: false disables when no filterable override", () => {
    const result = resolveColumnFilterConfig({
      columnFilter: false,
    });
    expect(result).toBeNull();
  });

  it("no filter or filterable returns null", () => {
    const result = resolveColumnFilterConfig({});
    expect(result).toBeNull();
  });

  // ── invalid default operator fallback ────────────────────────

  it("invalid defaultOperator for text falls back to contains", () => {
    const result = resolveColumnFilterConfig({
      columnFilter: { type: "text", defaultOperator: "gt" },
    });
    expect(result!.defaultOperator).toBe("contains");
  });

  it("invalid defaultOperator for number falls back to equals", () => {
    const result = resolveColumnFilterConfig({
      columnFilter: { type: "number", defaultOperator: "contains" },
    });
    expect(result!.defaultOperator).toBe("equals");
  });

  it("invalid defaultOperator for date falls back to equals", () => {
    const result = resolveColumnFilterConfig({
      columnFilter: { type: "date", defaultOperator: "startsWith" },
    });
    expect(result!.defaultOperator).toBe("equals");
  });

  it("invalid defaultOperator for boolean falls back to equals", () => {
    const result = resolveColumnFilterConfig({
      columnFilter: { type: "boolean", defaultOperator: "contains" },
    });
    expect(result!.defaultOperator).toBe("equals");
  });

  // ── defaultColDef filterable interaction ──────────────────────

  it("defaultColDef filterable: true enables text when neither column nor default has filter config", () => {
    const result = resolveColumnFilterConfig({
      defaultFilterable: true,
    });
    expect(result).toEqual({
      type: "text",
      defaultOperator: "contains",
      caseSensitive: false,
      trimInput: true,
    });
  });

  it("columnFilterable: true with defaultFilter: 'number' resolves number/equals", () => {
    const result = resolveColumnFilterConfig({
      columnFilterable: true,
      defaultFilter: "number",
    });
    expect(result).toEqual({
      type: "number",
      defaultOperator: "equals",
      caseSensitive: false,
      trimInput: true,
    });
  });

  it("columnFilterable: true with defaultFilter object resolves date/before", () => {
    const result = resolveColumnFilterConfig({
      columnFilterable: true,
      defaultFilter: { type: "date", defaultOperator: "before" },
    });
    expect(result).toEqual({
      type: "date",
      defaultOperator: "before",
      caseSensitive: false,
      trimInput: true,
    });
  });

  it("columnFilterable: true with invalid defaultOperator in defaultFilter falls back to type default", () => {
    const result = resolveColumnFilterConfig({
      columnFilterable: true,
      defaultFilter: { type: "number", defaultOperator: "contains" },
    });
    expect(result).toEqual({
      type: "number",
      defaultOperator: "equals",
      caseSensitive: false,
      trimInput: true,
    });
  });

  it("defaultColDef filterable: false returns null when no column override", () => {
    const result = resolveColumnFilterConfig({
      defaultFilterable: false,
      defaultFilter: "number",
    });
    expect(result).toBeNull();
  });
});
