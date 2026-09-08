// Pure-resolver unit tests. No DOM access, no Grid mount required.

import { describe, expect, it, vi } from "vitest";

import type { Grid } from "../../../Grid";
import type { RowData } from "../../../types";
import {
  resolveRowClasses,
  type RowClassParams,
  type RowClassRules,
} from "..";

/**
 * Build a minimal `RowClassParams` for tests. `grid` is typed as `Grid` but
 * the resolver never reads it — a sentinel object suffices.
 */
function makeParams(overrides?: Partial<RowClassParams>): RowClassParams {
  return {
    row: { id: "r1", name: "Alice" } as RowData,
    rowIndex: 0,
    rowId: "r1",
    grid: {} as Grid,
    ...overrides,
  };
}

describe("resolveRowClasses", () => {
  it("returns an empty list when nothing is provided", () => {
    expect(resolveRowClasses({ params: makeParams() })).toEqual([]);
  });

  // ── Static rowClass ────────────────────────────────────────────────

  it("accepts a single static rowClass string", () => {
    expect(
      resolveRowClasses({ rowClass: "highlight", params: makeParams() }),
    ).toEqual(["highlight"]);
  });

  it("splits whitespace inside a static rowClass string", () => {
    expect(
      resolveRowClasses({
        rowClass: "  highlight   warning  ",
        params: makeParams(),
      }),
    ).toEqual(["highlight", "warning"]);
  });

  it("accepts a static rowClass string array", () => {
    expect(
      resolveRowClasses({
        rowClass: ["a", "b c", "d"],
        params: makeParams(),
      }),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("drops empty / whitespace-only tokens from rowClass", () => {
    expect(
      resolveRowClasses({
        rowClass: ["", "   ", "real"],
        params: makeParams(),
      }),
    ).toEqual(["real"]);
  });

  // ── Functional getRowClass ─────────────────────────────────────────

  it("uses getRowClass that returns a string", () => {
    expect(
      resolveRowClasses({
        getRowClass: () => "dynamic",
        params: makeParams(),
      }),
    ).toEqual(["dynamic"]);
  });

  it("uses getRowClass that returns an array", () => {
    expect(
      resolveRowClasses({
        getRowClass: () => ["x", "y z"],
        params: makeParams(),
      }),
    ).toEqual(["x", "y", "z"]);
  });

  it("ignores getRowClass when it returns null", () => {
    expect(
      resolveRowClasses({
        getRowClass: () => null,
        params: makeParams(),
      }),
    ).toEqual([]);
  });

  it("ignores getRowClass when it returns undefined", () => {
    expect(
      resolveRowClasses({
        getRowClass: () => undefined,
        params: makeParams(),
      }),
    ).toEqual([]);
  });

  it("ignores getRowClass when it returns false", () => {
    expect(
      resolveRowClasses({
        getRowClass: () => false,
        params: makeParams(),
      }),
    ).toEqual([]);
  });

  it("passes a `RowClassParams` to getRowClass", () => {
    const spy = vi.fn((p: RowClassParams) => `idx-${p.rowIndex}`);
    const params = makeParams({ rowIndex: 7, rowId: "r-7" });
    resolveRowClasses({ getRowClass: spy, params });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(params);
  });

  // ── rowClassRules ─────────────────────────────────────────────────

  it("adds class names from rules whose predicate returns true", () => {
    const rules: RowClassRules = {
      selected: () => true,
      pinned: () => false,
      warning: () => true,
    };
    expect(
      resolveRowClasses({ rowClassRules: rules, params: makeParams() }),
    ).toEqual(["selected", "warning"]);
  });

  it("passes a `RowClassParams` to each rule predicate", () => {
    const a = vi.fn(() => true);
    const b = vi.fn(() => false);
    const params = makeParams({ rowIndex: 3 });
    resolveRowClasses({
      rowClassRules: { a, b },
      params,
    });
    expect(a).toHaveBeenCalledWith(params);
    expect(b).toHaveBeenCalledWith(params);
  });

  it("splits whitespace inside a rule key (treats multi-class keys as separate classes)", () => {
    expect(
      resolveRowClasses({
        rowClassRules: { "a b": () => true, c: () => true },
        params: makeParams(),
      }),
    ).toEqual(["a", "b", "c"]);
  });

  it("lets predicate errors propagate (does NOT swallow)", () => {
    const boom: RowClassRules = {
      ok: () => true,
      explode: () => {
        throw new Error("rule blew up");
      },
    };
    expect(() =>
      resolveRowClasses({ rowClassRules: boom, params: makeParams() }),
    ).toThrow(/rule blew up/);
  });

  it("lets getRowClass errors propagate (does NOT swallow)", () => {
    expect(() =>
      resolveRowClasses({
        getRowClass: () => {
          throw new Error("hook blew up");
        },
        params: makeParams(),
      }),
    ).toThrow(/hook blew up/);
  });

  // ── Composition order: rowClass → getRowClass → rowClassRules ─────

  it("merges all three sources in the documented order", () => {
    expect(
      resolveRowClasses({
        rowClass: "static",
        getRowClass: () => "dynamic",
        rowClassRules: { ruled: () => true },
        params: makeParams(),
      }),
    ).toEqual(["static", "dynamic", "ruled"]);
  });

  // ── Dedupe & ordering ─────────────────────────────────────────────

  it("dedupes while preserving first-seen order across all sources", () => {
    expect(
      resolveRowClasses({
        rowClass: ["a", "b"],
        getRowClass: () => ["b", "c"], // 'b' already seen → skipped
        rowClassRules: {
          c: () => true, // 'c' already seen → skipped
          d: () => true,
        },
        params: makeParams(),
      }),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("dedupes whitespace-split tokens from a single string", () => {
    expect(
      resolveRowClasses({
        rowClass: "a b a c b",
        params: makeParams(),
      }),
    ).toEqual(["a", "b", "c"]);
  });

  it("dedupes across rowClass string and array entries", () => {
    expect(
      resolveRowClasses({
        rowClass: ["a b", "b c"],
        params: makeParams(),
      }),
    ).toEqual(["a", "b", "c"]);
  });

  // ── Robustness ────────────────────────────────────────────────────

  it("does NOT touch the DOM or mutate the params object", () => {
    const params = makeParams();
    const snapshot = JSON.parse(JSON.stringify({ ...params, grid: undefined }));
    resolveRowClasses({
      rowClass: "a",
      getRowClass: () => "b",
      rowClassRules: { c: () => true },
      params,
    });
    // Params untouched.
    expect({ ...params, grid: undefined }).toEqual(snapshot);
  });
});
