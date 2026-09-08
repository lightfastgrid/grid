import { describe, expect, it } from "vitest";

import type { ColumnDef } from "../../../types";
import { resolveEditor } from "../resolveEditor";

function col(overrides: Partial<ColumnDef> = {}): ColumnDef {
  return { field: "test", ...overrides } as ColumnDef;
}

describe("resolveEditor", () => {
  describe("inference from value when no editor configured", () => {
    it("infers checkbox for boolean value", () => {
      expect(resolveEditor(col(), true).kind).toBe("checkbox");
      expect(resolveEditor(col(), false).kind).toBe("checkbox");
    });

    it("infers number for number value", () => {
      expect(resolveEditor(col(), 42).kind).toBe("number");
      expect(resolveEditor(col(), 0).kind).toBe("number");
    });

    it("infers date for YYYY-MM-DD string", () => {
      expect(resolveEditor(col(), "2024-03-15").kind).toBe("date");
    });

    it("infers text for plain string", () => {
      expect(resolveEditor(col(), "hello").kind).toBe("text");
    });

    it("infers text for null", () => {
      expect(resolveEditor(col(), null).kind).toBe("text");
    });

    it("infers text for undefined", () => {
      expect(resolveEditor(col(), undefined).kind).toBe("text");
    });

    it("does not infer date for partial date string", () => {
      expect(resolveEditor(col(), "2024-03").kind).toBe("text");
    });

    it("infers date for valid leap day", () => {
      expect(resolveEditor(col(), "2024-02-29").kind).toBe("date");
    });

    it("infers text for invalid day (Feb 31)", () => {
      expect(resolveEditor(col(), "2024-02-31").kind).toBe("text");
    });

    it("infers text for invalid month (13)", () => {
      expect(resolveEditor(col(), "2024-13-01").kind).toBe("text");
    });

    it("infers text for invalid month (00)", () => {
      expect(resolveEditor(col(), "2024-00-10").kind).toBe("text");
    });
  });

  describe("explicit editor string shorthand", () => {
    it("uses explicit text", () => {
      expect(resolveEditor(col({ editor: "text" }), 42).kind).toBe("text");
    });

    it("uses explicit number", () => {
      expect(resolveEditor(col({ editor: "number" }), "hello").kind).toBe(
        "number",
      );
    });

    it("normalizes boolean to checkbox", () => {
      expect(resolveEditor(col({ editor: "boolean" }), "x").kind).toBe(
        "checkbox",
      );
    });

    it("uses explicit checkbox", () => {
      expect(resolveEditor(col({ editor: "checkbox" }), "x").kind).toBe(
        "checkbox",
      );
    });
  });

  describe("explicit editor object config", () => {
    it("uses explicit config type", () => {
      const result = resolveEditor(
        col({ editor: { type: "select", options: ["a", "b"] } }),
        "a",
      );
      expect(result.kind).toBe("select");
      expect(result.options).toEqual([
        { value: "a", label: "a" },
        { value: "b", label: "b" },
      ]);
    });

    it("normalizes object { type: 'boolean' } to checkbox", () => {
      const result = resolveEditor(
        col({ editor: { type: "boolean" } }),
        "x",
      );
      expect(result.kind).toBe("checkbox");
    });

    it("preserves maxLength and placeholder", () => {
      const result = resolveEditor(
        col({
          editor: { type: "text", maxLength: 50, placeholder: "Enter..." },
        }),
        "",
      );
      expect(result.maxLength).toBe(50);
      expect(result.placeholder).toBe("Enter...");
    });
  });

  describe("explicit editor always wins over value inference", () => {
    it("explicit text overrides boolean value", () => {
      expect(resolveEditor(col({ editor: "text" }), true).kind).toBe("text");
    });

    it("explicit number overrides date-like string", () => {
      expect(
        resolveEditor(col({ editor: "number" }), "2024-01-01").kind,
      ).toBe("number");
    });
  });
});
