import { describe, expect, it } from "vitest";

import {
  columnOrderConfigsEqual,
  normalizeColumnOrder,
} from "../../../utils/columnOrderConfig";

describe("normalizeColumnOrder", () => {
  it("undefined and false mean disabled", () => {
    expect(normalizeColumnOrder(undefined)).toEqual({ enabled: false });
    expect(normalizeColumnOrder(false)).toEqual({ enabled: false });
  });

  it("true means enabled", () => {
    expect(normalizeColumnOrder(true)).toEqual({ enabled: true });
  });

  it("empty object merges with default enabled: true", () => {
    expect(normalizeColumnOrder({})).toEqual({ enabled: true });
  });

  it("object can set enabled explicitly", () => {
    expect(normalizeColumnOrder({ enabled: true })).toEqual({ enabled: true });
    expect(normalizeColumnOrder({ enabled: false })).toEqual({ enabled: false });
  });
});

describe("columnOrderConfigsEqual", () => {
  it("compares enabled flag", () => {
    expect(
      columnOrderConfigsEqual({ enabled: true }, { enabled: true }),
    ).toBe(true);
    expect(
      columnOrderConfigsEqual({ enabled: false }, { enabled: true }),
    ).toBe(false);
  });
});
