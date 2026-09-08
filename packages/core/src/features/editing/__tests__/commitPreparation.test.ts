import { describe, expect, it } from "vitest";

import { prepareCommit } from "../commitPreparation";
import type { NormalizedCellEditorConfig } from "../editingTypes";

const textConfig: NormalizedCellEditorConfig = { kind: "text", options: [] };
const numberConfig: NormalizedCellEditorConfig = { kind: "number", options: [] };
const selectConfig: NormalizedCellEditorConfig = {
  kind: "select",
  options: [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ],
};

describe("prepareCommit", () => {
  it("returns changed row for valid text edit", () => {
    const row = { name: "Alice" };
    const result = prepareCommit(row, "name", textConfig, "Bob");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.row).toEqual({ name: "Bob" });
    expect(result.topLevelField).toBe("name");
    expect(result.row).not.toBe(row);
  });

  it("returns unchanged when value is the same", () => {
    const row = { name: "Alice" };
    const result = prepareCommit(row, "name", textConfig, "Alice");
    expect(result).toEqual({ ok: true, changed: false });
  });

  it("returns parse failure for invalid number", () => {
    const row = { score: 10 };
    const result = prepareCommit(row, "score", numberConfig, "abc");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("Invalid number");
  });

  it("returns parse failure for unknown select option", () => {
    const row = { status: "a" };
    const result = prepareCommit(row, "status", selectConfig, "unknown");
    expect(result.ok).toBe(false);
  });

  it("handles dot path field with top-level field in result", () => {
    const row = { user: { name: "Alice" } };
    const result = prepareCommit(row, "user.name", textConfig, "Bob");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.topLevelField).toBe("user");
    expect(result.row).toEqual({ user: { name: "Bob" } });
  });

  it("does not mutate input row", () => {
    const row = { name: "Alice" };
    prepareCommit(row, "name", textConfig, "Bob");
    expect(row.name).toBe("Alice");
  });

  it("returns failure for unsafe field path", () => {
    const result = prepareCommit({}, "__proto__", textConfig, "x");
    expect(result.ok).toBe(false);
  });

  it("parses number and commits changed value", () => {
    const row = { score: 10 };
    const result = prepareCommit(row, "score", numberConfig, "42");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.row).toEqual({ score: 42 });
  });

  it("empty number string commits null", () => {
    const row = { score: 10 };
    const result = prepareCommit(row, "score", numberConfig, "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.row).toEqual({ score: null });
  });

  it.each([
    {
      label: "whitespace text",
      row: { value: "old" },
      config: { kind: "text", options: [], required: true } as const,
      raw: "   ",
    },
    {
      label: "empty number",
      row: { value: 1 },
      config: { kind: "number", options: [], required: true } as const,
      raw: "",
    },
    {
      label: "empty date",
      row: { value: "2024-01-01" },
      config: { kind: "date", options: [], required: true } as const,
      raw: "",
    },
    {
      label: "unchecked checkbox",
      row: { value: true },
      config: { kind: "checkbox", options: [], required: true } as const,
      raw: "false",
    },
    {
      label: "empty select option",
      row: { value: "a" },
      config: {
        kind: "select",
        options: [{ value: "", label: "Choose" }],
        required: true,
      } as const,
      raw: "",
    },
    {
      label: "null select option",
      row: { value: "a" },
      config: {
        kind: "select",
        options: [{ value: null, label: "None" }],
        required: true,
      } as const,
      raw: "null",
    },
  ])("rejects required $label", ({ row, config, raw }) => {
    expect(prepareCommit(row, "value", config, raw)).toEqual({
      ok: false,
      reason: "Value is required",
    });
  });

  it("accepts valid required values including numeric zero and select false", () => {
    expect(
      prepareCommit(
        { value: 1 },
        "value",
        { kind: "number", options: [], required: true },
        "0",
      ),
    ).toMatchObject({ ok: true, changed: true });
    expect(
      prepareCommit(
        { value: true },
        "value",
        {
          kind: "select",
          options: [{ value: false, label: "No" }],
          required: true,
        },
        "false",
      ),
    ).toMatchObject({ ok: true, changed: true });
  });
});
