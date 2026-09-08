import { describe, expect, it } from "vitest";

import { normalizeExecutionThreshold } from "../normalizeExecutionThreshold";

describe("normalizeExecutionThreshold", () => {
  const DEFAULT = 25_000;

  it("undefined returns operation default", () => {
    expect(normalizeExecutionThreshold(undefined, DEFAULT)).toBe(DEFAULT);
  });

  it("NaN returns operation default", () => {
    expect(normalizeExecutionThreshold(NaN, DEFAULT)).toBe(DEFAULT);
  });

  it("negative returns operation default", () => {
    expect(normalizeExecutionThreshold(-1, DEFAULT)).toBe(DEFAULT);
    expect(normalizeExecutionThreshold(-100, DEFAULT)).toBe(DEFAULT);
  });

  it("Infinity returns operation default", () => {
    expect(normalizeExecutionThreshold(Infinity, DEFAULT)).toBe(DEFAULT);
    expect(normalizeExecutionThreshold(-Infinity, DEFAULT)).toBe(DEFAULT);
  });

  it("valid number returns Math.floor", () => {
    expect(normalizeExecutionThreshold(10_000, DEFAULT)).toBe(10_000);
    expect(normalizeExecutionThreshold(10_000.7, DEFAULT)).toBe(10_000);
    expect(normalizeExecutionThreshold(1.9, DEFAULT)).toBe(1);
  });

  it("zero is valid", () => {
    expect(normalizeExecutionThreshold(0, DEFAULT)).toBe(0);
  });
});
