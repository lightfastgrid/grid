import { describe, expect, it } from "vitest";

import {
  normalizeRowDrag,
  rowDragConfigsEqual,
} from "../../../utils/rowDragConfig";

describe("normalizeRowDrag", () => {
  it("returns disabled config for undefined", () => {
    expect(normalizeRowDrag(undefined)).toEqual({ enabled: false, managed: false, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 });
  });

  it("returns disabled config for false", () => {
    expect(normalizeRowDrag(false)).toEqual({ enabled: false, managed: false, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 });
  });

  it("returns enabled+managed for true", () => {
    expect(normalizeRowDrag(true)).toEqual({ enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 });
  });

  it("uses defaults for empty object", () => {
    expect(normalizeRowDrag({})).toEqual({ enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 });
  });

  it("respects explicit enabled:false", () => {
    expect(normalizeRowDrag({ enabled: false })).toEqual({ enabled: false, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 });
  });

  it("respects explicit managed:false", () => {
    expect(normalizeRowDrag({ managed: false })).toEqual({ enabled: true, managed: false, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 });
  });

  it("respects both fields set explicitly", () => {
    expect(normalizeRowDrag({ enabled: true, managed: false })).toEqual({
      enabled: true,
      managed: false,
      maxMultiRowDragCount: 1000,
      maxMultiRowDragRatio: 0.5,
    });
  });

  it("respects explicit maxMultiRowDragCount", () => {
    expect(normalizeRowDrag({ enabled: true, maxMultiRowDragCount: 50 })).toEqual({
      enabled: true,
      managed: true,
      maxMultiRowDragCount: 50,
      maxMultiRowDragRatio: 0.5,
    });
  });

  it("respects explicit maxMultiRowDragRatio", () => {
    expect(normalizeRowDrag({ enabled: true, maxMultiRowDragRatio: 0.1 })).toEqual({
      enabled: true,
      managed: true,
      maxMultiRowDragCount: 1000,
      maxMultiRowDragRatio: 0.1,
    });
  });

  it.each([0, -1, NaN, Infinity])(
    "falls back to default maxMultiRowDragCount for invalid value: %s",
    (v) => {
      const result = normalizeRowDrag({ maxMultiRowDragCount: v });
      expect(result.maxMultiRowDragCount).toBe(1000);
    },
  );

  it.each([
    [2.7, 2],
    [50.9, 50],
  ])("floors decimal maxMultiRowDragCount %s to %i", (input, expected) => {
    expect(normalizeRowDrag({ maxMultiRowDragCount: input }).maxMultiRowDragCount).toBe(expected);
  });

  it.each([0, -1, 2, NaN, Infinity])(
    "falls back to default maxMultiRowDragRatio for invalid value: %s",
    (v) => {
      const result = normalizeRowDrag({ maxMultiRowDragRatio: v });
      expect(result.maxMultiRowDragRatio).toBe(0.5);
    },
  );

  it("accepts maxMultiRowDragRatio of exactly 1", () => {
    expect(normalizeRowDrag({ maxMultiRowDragRatio: 1 }).maxMultiRowDragRatio).toBe(1);
  });
});

describe("rowDragConfigsEqual", () => {
  it("returns true for identical configs", () => {
    expect(
      rowDragConfigsEqual(
        { enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 },
        { enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 },
      ),
    ).toBe(true);
  });

  it("returns false when enabled differs", () => {
    expect(
      rowDragConfigsEqual(
        { enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 },
        { enabled: false, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 },
      ),
    ).toBe(false);
  });

  it("returns false when managed differs", () => {
    expect(
      rowDragConfigsEqual(
        { enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 },
        { enabled: true, managed: false, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 },
      ),
    ).toBe(false);
  });

  it("returns false when maxMultiRowDragCount differs", () => {
    expect(
      rowDragConfigsEqual(
        { enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 },
        { enabled: true, managed: true, maxMultiRowDragCount: 50, maxMultiRowDragRatio: 0.5 },
      ),
    ).toBe(false);
  });

  it("returns false when maxMultiRowDragRatio differs", () => {
    expect(
      rowDragConfigsEqual(
        { enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.5 },
        { enabled: true, managed: true, maxMultiRowDragCount: 1000, maxMultiRowDragRatio: 0.1 },
      ),
    ).toBe(false);
  });
});
