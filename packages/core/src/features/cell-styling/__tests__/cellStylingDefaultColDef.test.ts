// Focused tests for `defaultColDef` merge of cell-styling inputs in
// `GridState.effectiveColumnDef()`. Mirrors the row-styling convention: a
// per-column value overrides the default; if the per-column value is
// omitted, the default flows through.

import { describe, expect, it } from "vitest";

import { GridState } from "../../../state/GridState";
import type { ColumnDef } from "../../../types";
import type {
  CellClassParams,
  CellClassRules,
  GetCellClass,
} from "..";

const baseRows = [{ id: "r1", amount: 42 }];

function effective(state: GridState, field: string): ColumnDef {
  const snap = state.getSnapshot();
  const col = snap.columns.find((c) => c.field === field);
  if (!col) throw new Error(`column ${field} not in snapshot`);
  return col;
}

describe("GridState.effectiveColumnDef — cell styling defaultColDef merge", () => {
  // ── Defaults flow through when column omits ───────────────────────

  it("applies `defaultColDef.cellClass` when the column omits `cellClass`", () => {
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount" }],
      defaultColDef: { cellClass: "default-cell" },
    });
    expect(effective(state, "amount").cellClass).toBe("default-cell");
  });

  it("applies `defaultColDef.getCellClass` when the column omits it", () => {
    const defaultHook: GetCellClass = () => "from-default";
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount" }],
      defaultColDef: { getCellClass: defaultHook },
    });
    expect(effective(state, "amount").getCellClass).toBe(defaultHook);
  });

  it("applies `defaultColDef.cellClassRules` when the column omits it", () => {
    const defaultRules: CellClassRules = {
      "rule-default": (p: CellClassParams) => typeof p.value === "number",
    };
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount" }],
      defaultColDef: { cellClassRules: defaultRules },
    });
    expect(effective(state, "amount").cellClassRules).toBe(defaultRules);
  });

  it("applies all three defaults together when omitted per-column", () => {
    const defaultHook: GetCellClass = () => "from-default-hook";
    const defaultRules: CellClassRules = {
      "rule-default": () => false,
    };
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount" }],
      defaultColDef: {
        cellClass: "from-default",
        getCellClass: defaultHook,
        cellClassRules: defaultRules,
      },
    });
    const eff = effective(state, "amount");
    expect(eff.cellClass).toBe("from-default");
    expect(eff.getCellClass).toBe(defaultHook);
    expect(eff.cellClassRules).toBe(defaultRules);
  });

  // ── Per-column overrides win ─────────────────────────────────────

  it("column-level `cellClass` overrides `defaultColDef.cellClass`", () => {
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount", cellClass: "per-column" }],
      defaultColDef: { cellClass: "from-default" },
    });
    expect(effective(state, "amount").cellClass).toBe("per-column");
  });

  it("column-level `getCellClass` overrides `defaultColDef.getCellClass`", () => {
    const defaultHook: GetCellClass = () => "from-default-hook";
    const colHook: GetCellClass = () => "from-column-hook";
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount", getCellClass: colHook }],
      defaultColDef: { getCellClass: defaultHook },
    });
    expect(effective(state, "amount").getCellClass).toBe(colHook);
  });

  it("column-level `cellClassRules` overrides `defaultColDef.cellClassRules`", () => {
    const defaultRules: CellClassRules = { default: () => true };
    const colRules: CellClassRules = { columnRule: () => true };
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount", cellClassRules: colRules }],
      defaultColDef: { cellClassRules: defaultRules },
    });
    expect(effective(state, "amount").cellClassRules).toBe(colRules);
  });

  // ── Negative ──────────────────────────────────────────────────────

  it("leaves cell-styling fields undefined when neither column nor default provides them", () => {
    const state = new GridState({
      rows: baseRows,
      columns: [{ field: "amount" }],
    });
    const eff = effective(state, "amount");
    expect(eff.cellClass).toBeUndefined();
    expect(eff.getCellClass).toBeUndefined();
    expect(eff.cellClassRules).toBeUndefined();
  });

  it("mixes per-column override with default fall-through (only some fields default)", () => {
    const defaultRules: CellClassRules = { default: () => true };
    const state = new GridState({
      rows: baseRows,
      columns: [
        // overrides cellClass; cellClassRules falls back to default.
        { field: "amount", cellClass: "per-column" },
      ],
      defaultColDef: {
        cellClass: "from-default",
        cellClassRules: defaultRules,
      },
    });
    const eff = effective(state, "amount");
    expect(eff.cellClass).toBe("per-column");
    expect(eff.cellClassRules).toBe(defaultRules);
    expect(eff.getCellClass).toBeUndefined();
  });
});
