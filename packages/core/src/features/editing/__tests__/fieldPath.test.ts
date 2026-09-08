import { describe, expect, it } from "vitest";

import {
  getEditableFieldValue,
  isFieldPathSafe,
  setEditableFieldValue,
} from "../fieldPath";

describe("isFieldPathSafe", () => {
  it("accepts plain field", () => {
    expect(isFieldPathSafe("name")).toBe(true);
  });

  it("accepts dot path", () => {
    expect(isFieldPathSafe("user.name")).toBe(true);
  });

  it.each(["__proto__x", "constructorX", "prototypeX", "a.__proto__x.b"])(
    "accepts safe segments that only contain an unsafe name: %s",
    (field) => {
      expect(isFieldPathSafe(field)).toBe(true);
    },
  );

  it("rejects empty string", () => {
    expect(isFieldPathSafe("")).toBe(false);
  });

  it("rejects __proto__", () => {
    expect(isFieldPathSafe("__proto__")).toBe(false);
  });

  it("rejects constructor", () => {
    expect(isFieldPathSafe("constructor")).toBe(false);
  });

  it("rejects prototype", () => {
    expect(isFieldPathSafe("prototype")).toBe(false);
  });

  it("rejects nested unsafe segment", () => {
    expect(isFieldPathSafe("user.__proto__")).toBe(false);
  });

  it.each([
    "__proto__.value",
    "user.constructor.value",
    "user.prototype",
  ])("rejects an exact unsafe segment anywhere: %s", (field) => {
    expect(isFieldPathSafe(field)).toBe(false);
  });

  it("rejects empty segment in dot path", () => {
    expect(isFieldPathSafe("user..name")).toBe(false);
  });

  it("rejects trailing dot", () => {
    expect(isFieldPathSafe("user.")).toBe(false);
  });

  it("rejects leading dot", () => {
    expect(isFieldPathSafe(".name")).toBe(false);
  });
});

describe("getEditableFieldValue", () => {
  it("reads plain field", () => {
    expect(getEditableFieldValue({ name: "Alice" }, "name")).toEqual({
      ok: true,
      value: "Alice",
    });
  });

  it("reads dot path", () => {
    expect(
      getEditableFieldValue({ user: { name: "Bob" } }, "user.name"),
    ).toEqual({ ok: true, value: "Bob" });
  });

  it("returns undefined for missing field", () => {
    expect(getEditableFieldValue({}, "name")).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("returns undefined for missing nested path", () => {
    expect(getEditableFieldValue({}, "user.name")).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("fails for unsafe path", () => {
    expect(getEditableFieldValue({}, "__proto__").ok).toBe(false);
  });
});

describe("setEditableFieldValue", () => {
  it("sets plain field without mutating input", () => {
    const row = { name: "Alice", age: 30 };
    const result = setEditableFieldValue(row, "name", "Bob");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.row).toEqual({ name: "Bob", age: 30 });
    expect(row.name).toBe("Alice");
    expect(result.value.row).not.toBe(row);
  });

  it("sets dot path without mutating input", () => {
    const inner = { name: "Alice" };
    const row = { user: inner, id: 1 };
    const result = setEditableFieldValue(row, "user.name", "Bob");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.row).toEqual({ user: { name: "Bob" }, id: 1 });
    expect(inner.name).toBe("Alice");
    expect(result.value.row).not.toBe(row);
    expect((result.value.row as Record<string, unknown>).user).not.toBe(inner);
  });

  it("creates missing nested objects for dot paths", () => {
    const row = { id: 1 };
    const result = setEditableFieldValue(row, "user.name", "Alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.row).toEqual({ id: 1, user: { name: "Alice" } });
  });

  it("returns original row reference when value is unchanged", () => {
    const row = { name: "Alice" };
    const result = setEditableFieldValue(row, "name", "Alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(false);
    expect(result.value.row).toBe(row);
  });

  it("returns original row for unchanged dot path value", () => {
    const row = { user: { name: "Alice" } };
    const result = setEditableFieldValue(row, "user.name", "Alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(false);
    expect(result.value.row).toBe(row);
  });

  it("treats NaN as unchanged when existing value is NaN", () => {
    const row = { val: NaN };
    const result = setEditableFieldValue(row, "val", NaN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(false);
    expect(result.value.row).toBe(row);
  });

  it("rejects unsafe paths", () => {
    expect(setEditableFieldValue({}, "__proto__", "x").ok).toBe(false);
    expect(setEditableFieldValue({}, "a.constructor", "x").ok).toBe(false);
    expect(setEditableFieldValue({}, "", "x").ok).toBe(false);
  });

  it("replaces array at intermediate segment with empty object", () => {
    const arr = [1, 2, 3];
    const row = { data: arr };
    const result = setEditableFieldValue(row, "data.name", "Alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.row).toEqual({ data: { name: "Alice" } });
    expect(arr).toEqual([1, 2, 3]);
  });

  it("replaces Date at intermediate segment with empty object", () => {
    const date = new Date("2024-01-01");
    const row = { ts: date };
    const result = setEditableFieldValue(row, "ts.nested", "val");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.row).toEqual({ ts: { nested: "val" } });
    expect(date.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("clones plain object only along the edited path", () => {
    const sibling = { x: 1 };
    const target = { y: 2 };
    const row = { a: sibling, b: target };
    const result = setEditableFieldValue(row, "b.y", 99);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect((result.value.row as Record<string, unknown>).a).toBe(sibling);
    expect((result.value.row as Record<string, unknown>).b).not.toBe(target);
    expect(result.value.row).toEqual({ a: { x: 1 }, b: { y: 99 } });
  });

  it("handles deep dot path (3 levels)", () => {
    const row = { a: { b: { c: 1 } } };
    const result = setEditableFieldValue(row, "a.b.c", 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.row).toEqual({ a: { b: { c: 2 } } });
    expect((row.a.b as Record<string, unknown>).c).toBe(1);
  });
});
