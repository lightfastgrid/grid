import { describe, expect, it } from "vitest";

import type { CellEditorConfig } from "../../../types";
import { normalizeCellEditor } from "../normalizeCellEditor";

describe("normalizeCellEditor", () => {
  it("defaults undefined to text kind", () => {
    const result = normalizeCellEditor(undefined);
    expect(result.kind).toBe("text");
    expect(result.options).toEqual([]);
  });

  it("normalizes string 'text' to text kind", () => {
    expect(normalizeCellEditor("text").kind).toBe("text");
  });

  it("normalizes string 'number' to number kind", () => {
    expect(normalizeCellEditor("number").kind).toBe("number");
  });

  it("normalizes string 'date' to date kind", () => {
    expect(normalizeCellEditor("date").kind).toBe("date");
  });

  it("normalizes string 'checkbox' to checkbox kind", () => {
    expect(normalizeCellEditor("checkbox").kind).toBe("checkbox");
  });

  it("normalizes string 'boolean' to checkbox kind", () => {
    expect(normalizeCellEditor("boolean").kind).toBe("checkbox");
  });

  it("normalizes object { type: 'boolean' } to checkbox kind", () => {
    const result = normalizeCellEditor({ type: "boolean" });
    expect(result.kind).toBe("checkbox");
  });

  it("normalizes object { type: 'text' } and preserves maxLength/placeholder", () => {
    const result = normalizeCellEditor({
      type: "text",
      maxLength: 100,
      placeholder: "Enter…",
    });
    expect(result.kind).toBe("text");
    expect(result.maxLength).toBe(100);
    expect(result.placeholder).toBe("Enter…");
  });

  it("preserves only strict required true on object-form editors", () => {
    expect(
      normalizeCellEditor({ type: "text", required: true }).required,
    ).toBe(true);
    expect(
      normalizeCellEditor({ type: "number", required: false }).required,
    ).toBeUndefined();
    expect(normalizeCellEditor("date").required).toBeUndefined();

    const malformed: CellEditorConfig = { type: "text" };
    Reflect.set(malformed, "required", "yes");
    expect(normalizeCellEditor(malformed).required).toBeUndefined();
  });

  it("normalizes string select options to { value, label } objects", () => {
    const result = normalizeCellEditor({
      type: "select",
      options: ["a", "b", "c"],
    });
    expect(result.kind).toBe("select");
    expect(result.options).toEqual([
      { value: "a", label: "a" },
      { value: "b", label: "b" },
      { value: "c", label: "c" },
    ]);
  });

  it("normalizes object select options preserving value and label", () => {
    const result = normalizeCellEditor({
      type: "select",
      options: [
        { value: 1, label: "One" },
        { value: 2, label: "Two" },
      ],
    });
    expect(result.options).toEqual([
      { value: 1, label: "One" },
      { value: 2, label: "Two" },
    ]);
  });

  it("normalizes mixed string and object select options", () => {
    const result = normalizeCellEditor({
      type: "select",
      options: ["plain", { value: 42, label: "Forty-two" }],
    });
    expect(result.options).toEqual([
      { value: "plain", label: "plain" },
      { value: 42, label: "Forty-two" },
    ]);
  });

  it("normalizes undefined/empty select options to empty array", () => {
    expect(normalizeCellEditor({ type: "select" }).options).toEqual([]);
    expect(
      normalizeCellEditor({ type: "select", options: [] }).options,
    ).toEqual([]);
  });

  it("normalizes string 'select' to select kind with empty options", () => {
    const result = normalizeCellEditor("select");
    expect(result.kind).toBe("select");
    expect(result.options).toEqual([]);
  });

  it("preserves boolean option values", () => {
    const result = normalizeCellEditor({
      type: "select",
      options: [
        { value: true, label: "Yes" },
        { value: false, label: "No" },
      ],
    });
    expect(result.options).toEqual([
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ]);
  });

  it("preserves null option value", () => {
    const result = normalizeCellEditor({
      type: "select",
      options: [
        { value: null, label: "None" },
        { value: "a", label: "A" },
      ],
    });
    expect(result.options[0]).toEqual({ value: null, label: "None" });
  });

  it("filters out object option values", () => {
    const result = normalizeCellEditor({
      type: "select",
      options: [
        { value: { id: 1 } as unknown as string, label: "Object" },
        { value: "safe", label: "Safe" },
      ],
    });
    expect(result.options).toEqual([{ value: "safe", label: "Safe" }]);
  });

  it("filters out function option values", () => {
    const result = normalizeCellEditor({
      type: "select",
      options: [
        { value: (() => {}) as unknown as string, label: "Fn" },
        { value: "ok", label: "OK" },
      ],
    });
    expect(result.options).toEqual([{ value: "ok", label: "OK" }]);
  });

  it("filters out symbol option values", () => {
    const result = normalizeCellEditor({
      type: "select",
      options: [
        { value: Symbol("x") as unknown as string, label: "Sym" },
        { value: "kept", label: "Kept" },
      ],
    });
    expect(result.options).toEqual([{ value: "kept", label: "Kept" }]);
  });

  it("deduplicates options with same stringified value (first wins)", () => {
    const result = normalizeCellEditor({
      type: "select",
      options: [
        { value: 1, label: "Number One" },
        { value: "1", label: "String One" },
      ],
    });
    expect(result.options).toEqual([{ value: 1, label: "Number One" }]);
  });

  it("deduplicates duplicate string options", () => {
    const result = normalizeCellEditor({
      type: "select",
      options: ["a", "b", "a"],
    });
    expect(result.options).toEqual([
      { value: "a", label: "a" },
      { value: "b", label: "b" },
    ]);
  });
});
