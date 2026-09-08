// Focused tests for `defaultColDef` merge of tooltip inputs in
// `GridState.effectiveColumnDef()`. Per-column values override defaults;
// if the per-column value is omitted, the default flows through.

import { describe, expect, it } from "vitest";

import { GridState } from "../../../state/GridState";
import type { ColumnDef } from "../../../types";
import type { TooltipValueGetter } from "..";

const baseRows = [{ id: "r1", amount: 42 }];

function effective(state: GridState, field: string): ColumnDef {
  const snap = state.getSnapshot();
  const col = snap.columns.find((c) => c.field === field);
  if (!col) throw new Error(`column ${field} not in snapshot`);
  return col;
}

describe("GridState.effectiveColumnDef — tooltip defaultColDef merge", () => {
  // ── Defaults flow through when column omits ───────────────────────

  it("applies `defaultColDef.tooltip` when the column omits `tooltip`", () => {
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount" }],
      defaultColDef: { tooltip: true },
    });
    expect(effective(state, "amount").tooltip).toBe(true);
  });

  it("applies `defaultColDef.tooltipValueGetter` when the column omits it", () => {
    const defaultGetter: TooltipValueGetter = () => "from default";
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount" }],
      defaultColDef: { tooltipValueGetter: defaultGetter },
    });
    expect(effective(state, "amount").tooltipValueGetter).toBe(defaultGetter);
  });

  it("applies both tooltip defaults together when omitted per-column", () => {
    const defaultGetter: TooltipValueGetter = () => "default tip";
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount" }],
      defaultColDef: { tooltip: true, tooltipValueGetter: defaultGetter },
    });
    const col = effective(state, "amount");
    expect(col.tooltip).toBe(true);
    expect(col.tooltipValueGetter).toBe(defaultGetter);
  });

  // ── Per-column override beats default ─────────────────────────────

  it("column `tooltip` overrides `defaultColDef.tooltip`", () => {
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount", tooltip: false }],
      defaultColDef: { tooltip: true },
    });
    expect(effective(state, "amount").tooltip).toBe(false);
  });

  it("column `tooltipValueGetter` overrides `defaultColDef.tooltipValueGetter`", () => {
    const defaultGetter: TooltipValueGetter = () => "default";
    const colGetter: TooltipValueGetter = () => "column";
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount", tooltipValueGetter: colGetter }],
      defaultColDef: { tooltipValueGetter: defaultGetter },
    });
    expect(effective(state, "amount").tooltipValueGetter).toBe(colGetter);
  });

  // ── tooltip: false blocks default getter inheritance ────────────────

  it("column `tooltip: false` does not inherit `defaultColDef.tooltipValueGetter`", () => {
    const defaultGetter: TooltipValueGetter = () => "default";
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount", tooltip: false }],
      defaultColDef: { tooltipValueGetter: defaultGetter },
    });
    const col = effective(state, "amount");
    expect(col.tooltip).toBe(false);
    expect(col.tooltipValueGetter).toBeUndefined();
  });

  it("column `tooltip: false` with explicit column getter keeps the column getter", () => {
    const defaultGetter: TooltipValueGetter = () => "default";
    const colGetter: TooltipValueGetter = () => "column";
    const state = new GridState({
      rows: baseRows,
      columns: [
        { field: "amount", tooltip: false, tooltipValueGetter: colGetter },
      ],
      defaultColDef: { tooltipValueGetter: defaultGetter },
    });
    const col = effective(state, "amount");
    expect(col.tooltip).toBe(false);
    expect(col.tooltipValueGetter).toBe(colGetter);
  });

  // ── No defaults, no column config ─────────────────────────────────

  it("tooltip fields are undefined when neither column nor default provides them", () => {
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount" }],
    });
    const col = effective(state, "amount");
    expect(col.tooltip).toBeUndefined();
    expect(col.tooltipValueGetter).toBeUndefined();
  });
});
