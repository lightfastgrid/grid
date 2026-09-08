import { describe, expect, it } from "vitest";

import {
  parseCheckbox,
  parseDate,
  parseEditorValue,
  parseNumber,
  parseSelect,
  parseText,
} from "../parsers";

describe("parseText", () => {
  it("returns the raw string", () => {
    expect(parseText("hello")).toEqual({ ok: true, value: "hello" });
  });

  it("returns empty string as-is", () => {
    expect(parseText("")).toEqual({ ok: true, value: "" });
  });
});

describe("parseNumber", () => {
  it("parses a valid integer", () => {
    expect(parseNumber("42")).toEqual({ ok: true, value: 42 });
  });

  it("parses a valid decimal", () => {
    expect(parseNumber("3.14")).toEqual({ ok: true, value: 3.14 });
  });

  it("parses negative numbers", () => {
    expect(parseNumber("-7")).toEqual({ ok: true, value: -7 });
  });

  it("returns null for empty string", () => {
    expect(parseNumber("")).toEqual({ ok: true, value: null });
  });

  it("returns null for whitespace-only string", () => {
    expect(parseNumber("   ")).toEqual({ ok: true, value: null });
  });

  it("fails for non-numeric string", () => {
    const result = parseNumber("abc");
    expect(result.ok).toBe(false);
  });

  it("fails for Infinity", () => {
    const result = parseNumber("Infinity");
    expect(result.ok).toBe(false);
  });

  it("fails for NaN literal", () => {
    const result = parseNumber("NaN");
    expect(result.ok).toBe(false);
  });
});

describe("parseDate", () => {
  it("parses a valid YYYY-MM-DD date", () => {
    expect(parseDate("2024-03-15")).toEqual({ ok: true, value: "2024-03-15" });
  });

  it("returns null for empty string", () => {
    expect(parseDate("")).toEqual({ ok: true, value: null });
  });

  it("returns null for whitespace-only string", () => {
    expect(parseDate("  ")).toEqual({ ok: true, value: null });
  });

  it("fails for DD/MM/YYYY format", () => {
    const result = parseDate("15/03/2024");
    expect(result.ok).toBe(false);
  });

  it("fails for arbitrary text", () => {
    const result = parseDate("not-a-date");
    expect(result.ok).toBe(false);
  });

  it("fails for partial date", () => {
    const result = parseDate("2024-03");
    expect(result.ok).toBe(false);
  });

  it("fails for Feb 31 (invalid calendar day)", () => {
    expect(parseDate("2024-02-31").ok).toBe(false);
  });

  it("fails for month 13 (out of range)", () => {
    expect(parseDate("2024-13-01").ok).toBe(false);
  });

  it("fails for month 00 (out of range)", () => {
    expect(parseDate("2024-00-10").ok).toBe(false);
  });

  it("fails for day 00 (out of range)", () => {
    expect(parseDate("2024-01-00").ok).toBe(false);
  });

  it("accepts Feb 29 in a leap year", () => {
    expect(parseDate("2024-02-29")).toEqual({ ok: true, value: "2024-02-29" });
  });

  it("fails for Feb 29 in a non-leap year", () => {
    expect(parseDate("2023-02-29").ok).toBe(false);
  });
});

describe("parseCheckbox", () => {
  it("returns true for true", () => {
    expect(parseCheckbox(true)).toEqual({ ok: true, value: true });
  });

  it("returns false for false", () => {
    expect(parseCheckbox(false)).toEqual({ ok: true, value: false });
  });
});

describe("parseSelect", () => {
  const options = [
    { value: "us", label: "United States" },
    { value: "uk", label: "United Kingdom" },
    { value: 42, label: "The Answer" },
  ];

  it("matches by stringified value", () => {
    expect(parseSelect("us", options)).toEqual({ ok: true, value: "us" });
  });

  it("matches numeric value via string", () => {
    expect(parseSelect("42", options)).toEqual({ ok: true, value: 42 });
  });

  it("label-only match fails", () => {
    expect(parseSelect("United States", options).ok).toBe(false);
  });

  it("ambiguous label/value resolves by value only", () => {
    const opts = [
      { value: "alpha", label: "beta" },
      { value: "beta", label: "alpha" },
    ];
    const result = parseSelect("beta", opts);
    expect(result).toEqual({ ok: true, value: "beta" });
  });

  it("fails for unknown option", () => {
    const result = parseSelect("fr", options);
    expect(result.ok).toBe(false);
  });

  it("fails with empty options", () => {
    const result = parseSelect("anything", []);
    expect(result.ok).toBe(false);
  });

  it("matches boolean true option via string", () => {
    const opts = [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ];
    expect(parseSelect("true", opts)).toEqual({ ok: true, value: true });
  });

  it("matches boolean false option via string", () => {
    const opts = [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ];
    expect(parseSelect("false", opts)).toEqual({ ok: true, value: false });
  });

  it("matches null option via string", () => {
    const opts = [
      { value: null, label: "None" },
      { value: "a", label: "A" },
    ];
    expect(parseSelect("null", opts)).toEqual({ ok: true, value: null });
  });
});

describe("parseEditorValue", () => {
  it("dispatches to text parser", () => {
    const result = parseEditorValue("hi", { kind: "text", options: [] });
    expect(result).toEqual({ ok: true, value: "hi" });
  });

  it("dispatches to number parser", () => {
    const result = parseEditorValue("99", { kind: "number", options: [] });
    expect(result).toEqual({ ok: true, value: 99 });
  });

  it("dispatches to date parser", () => {
    const result = parseEditorValue("2024-01-01", {
      kind: "date",
      options: [],
    });
    expect(result).toEqual({ ok: true, value: "2024-01-01" });
  });

  it("dispatches to checkbox parser", () => {
    const result = parseEditorValue("true", {
      kind: "checkbox",
      options: [],
    });
    expect(result).toEqual({ ok: true, value: true });
  });

  it("dispatches to select parser", () => {
    const result = parseEditorValue("a", {
      kind: "select",
      options: [{ value: "a", label: "A" }],
    });
    expect(result).toEqual({ ok: true, value: "a" });
  });
});
