// Pure-resolver unit tests. No DOM access, no Grid mount required.

import { describe, expect, it, vi } from "vitest";

import type { Grid } from "../../../Grid";
import type { ColumnDef, RowData } from "../../../types";
import type { TooltipValueGetterParams } from "..";
import { resolveTooltip } from "..";

/**
 * Build a minimal `TooltipValueGetterParams` for tests. `grid` is typed as
 * `Grid` but the resolver never reads it — a sentinel object suffices.
 */
function makeParams(
  overrides?: Partial<TooltipValueGetterParams>,
): TooltipValueGetterParams {
  const column: ColumnDef = { field: "amount" };
  return {
    row: { id: "r1", amount: 42 } as RowData,
    rowIndex: 0,
    rowId: "r1",
    column,
    field: column.field,
    value: 42,
    formattedValue: "$42",
    grid: {} as Grid,
    ...overrides,
  };
}

describe("resolveTooltip", () => {
  // ── No tooltip config ───────────────────────────────────────────────

  it("returns null when no tooltip config is provided", () => {
    expect(resolveTooltip({ params: makeParams() })).toBeNull();
  });

  it("returns null when tooltip is false", () => {
    expect(resolveTooltip({ tooltip: false, params: makeParams() })).toBeNull();
  });

  it("returns null when tooltip is undefined", () => {
    expect(
      resolveTooltip({ tooltip: undefined, params: makeParams() }),
    ).toBeNull();
  });

  // ── tooltip: true ───────────────────────────────────────────────────

  it("returns formattedValue when tooltip is true", () => {
    const params = makeParams({ formattedValue: "$42" });
    expect(resolveTooltip({ tooltip: true, params })).toBe("$42");
  });

  it("returns null when tooltip is true but formattedValue is empty", () => {
    const params = makeParams({ formattedValue: "" });
    expect(resolveTooltip({ tooltip: true, params })).toBeNull();
  });

  it("returns null when tooltip is true but formattedValue is whitespace-only", () => {
    const params = makeParams({ formattedValue: "   " });
    expect(resolveTooltip({ tooltip: true, params })).toBeNull();
  });

  // ── tooltipValueGetter ──────────────────────────────────────────────

  it("uses tooltipValueGetter when provided", () => {
    const getter = vi.fn(() => "custom tip");
    const params = makeParams();
    expect(resolveTooltip({ tooltipValueGetter: getter, params })).toBe(
      "custom tip",
    );
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it("tooltipValueGetter overrides tooltip boolean", () => {
    const getter = vi.fn(() => "from getter");
    const params = makeParams({ formattedValue: "formatted" });
    expect(
      resolveTooltip({ tooltip: true, tooltipValueGetter: getter, params }),
    ).toBe("from getter");
  });

  it("explicit getter still runs when tooltip is false (column-level override)", () => {
    // GridState blocks *inherited* getters when tooltip: false, but a column
    // that explicitly sets both keeps its getter. The resolver honours it.
    const getter = vi.fn(() => "explicit column tip");
    const params = makeParams({ formattedValue: "formatted" });
    expect(
      resolveTooltip({ tooltip: false, tooltipValueGetter: getter, params }),
    ).toBe("explicit column tip");
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it("tooltipValueGetter receives full params including raw value and formattedValue", () => {
    const getter = vi.fn(
      (p: TooltipValueGetterParams) =>
        `${p.field}: ${String(p.value)} (${p.formattedValue})`,
    );
    const params = makeParams({
      value: -50,
      formattedValue: "$-50",
    });
    expect(resolveTooltip({ tooltipValueGetter: getter, params })).toBe(
      "amount: -50 ($-50)",
    );
    expect(getter).toHaveBeenCalledWith(params);
  });

  it("returns null when tooltipValueGetter returns null", () => {
    expect(
      resolveTooltip({
        tooltipValueGetter: () => null,
        params: makeParams(),
      }),
    ).toBeNull();
  });

  it("returns null when tooltipValueGetter returns undefined", () => {
    expect(
      resolveTooltip({
        tooltipValueGetter: () => undefined,
        params: makeParams(),
      }),
    ).toBeNull();
  });

  it("returns null when tooltipValueGetter returns empty string", () => {
    expect(
      resolveTooltip({
        tooltipValueGetter: () => "",
        params: makeParams(),
      }),
    ).toBeNull();
  });

  it("returns null when tooltipValueGetter returns whitespace-only string", () => {
    expect(
      resolveTooltip({
        tooltipValueGetter: () => "  \t  ",
        params: makeParams(),
      }),
    ).toBeNull();
  });

  // ── Error propagation ──────────────────────────────────────────────

  it("propagates errors from tooltipValueGetter", () => {
    const getter = () => {
      throw new Error("getter broke");
    };
    expect(() =>
      resolveTooltip({ tooltipValueGetter: getter, params: makeParams() }),
    ).toThrow("getter broke");
  });
});
