// @vitest-environment jsdom
//
// Unit tests for the managed cell-class application inside `populateRow`.
// These tests construct PooledRow objects directly — no Grid mount required.

import { describe, expect, it, vi } from "vitest";

import { SELECTION_COLUMN_FIELD } from "../../../internal/selectionColumn";
import type { ColumnDef, PooledCell, PooledRow, RowData } from "../../../types";
import { CSS } from "../../const/css-classes";
import {
  type ColumnWindow,
  populateRow,
  type PopulateRowOptions,
  type ResolveCellClassesFn,
} from "../populateRow";

function makeCells(cellCount: number): PooledCell[] {
  const cells: PooledCell[] = [];
  for (let i = 0; i < cellCount; i++) {
    const el = document.createElement("div");
    el.className = CSS.CELL;
    cells.push({ element: el, value: "" });
  }
  return cells;
}

function makePoolRow(cellCount: number): PooledRow {
  const element = document.createElement("div");
  element.className = CSS.ROW;
  const cells = makeCells(cellCount);
  for (const c of cells) element.appendChild(c.element);
  return {
    element,
    cells,
    rowIndex: -1,
    rowVersion: 0,
    rowId: null,
  };
}

function window(slotCount: number): ColumnWindow {
  return { startIndex: 0, slotCount, toPhysicalCol: (v) => v };
}

function options(overrides: Partial<PopulateRowOptions>): PopulateRowOptions {
  return {
    dataRevision: 1,
    columnVersion: 1,
    getRowId: (row) => (row as { id: string }).id,
    ...overrides,
  };
}

const rowAlice: RowData = { id: "r1", name: "Alice", amount: 42 };
const rowBob: RowData = { id: "r2", name: "Bob", amount: -7 };

describe("populateRow → managed cell classes", () => {
  // ── 1. Static cellClass ───────────────────────────────────────────

  it("applies a static `cellClass`-derived class to a normal data cell", () => {
    const poolRow = makePoolRow(2);
    const cols: ColumnDef[] = [
      { field: "id" },
      { field: "amount", cellClass: "money" },
    ];
    const resolver: ResolveCellClassesFn = (_r, _i, _id, col) =>
      col.field === "amount" ? ["money"] : [];

    populateRow(poolRow, rowAlice, cols, 0, window(2), options({ resolveCellClasses: resolver }));

    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(false);
    expect(poolRow.cells[1]!.element.classList.contains("money")).toBe(true);
    expect(poolRow.cells[1]!.managedCellClasses).toEqual(["money"]);
  });

  // ── 2. Functional getCellClass ────────────────────────────────────

  it("applies a class derived from the row + value (getCellClass-style)", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];
    const resolver: ResolveCellClassesFn = (_r, _i, _id, _col, value) =>
      typeof value === "number" && value < 0 ? ["neg"] : ["pos"];

    populateRow(poolRow, rowAlice, cols, 0, window(1), options({ resolveCellClasses: resolver }));
    expect(poolRow.cells[0]!.element.classList.contains("pos")).toBe(true);
    expect(poolRow.cells[0]!.element.classList.contains("neg")).toBe(false);

    populateRow(poolRow, rowBob, cols, 1, window(1), options({ resolveCellClasses: resolver }));
    expect(poolRow.cells[0]!.element.classList.contains("pos")).toBe(false);
    expect(poolRow.cells[0]!.element.classList.contains("neg")).toBe(true);
  });

  // ── 3. cellClassRules-style truthy branch ─────────────────────────

  it("applies classes when a rule-style predicate returns true (and removes when false)", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];
    const resolver: ResolveCellClassesFn = (_r, _i, _id, _col, value) => {
      const out: string[] = [];
      if (typeof value === "number" && value > 10) out.push("big");
      if (typeof value === "number" && value < 0) out.push("neg");
      return out;
    };
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({ resolveCellClasses: resolver }));
    expect(poolRow.cells[0]!.element.classList.contains("big")).toBe(true);

    populateRow(poolRow, rowBob, cols, 1, window(1), options({ resolveCellClasses: resolver }));
    expect(poolRow.cells[0]!.element.classList.contains("big")).toBe(false);
    expect(poolRow.cells[0]!.element.classList.contains("neg")).toBe(true);
  });

  // ── 4. Raw (pre-format) value is passed ───────────────────────────

  it("passes the RAW resolved value (before valueFormatter) to the resolver", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [
      {
        field: "amount",
        valueFormatter: ({ value }) => `$${String(value)}`,
      },
    ];
    const seen: unknown[] = [];
    const resolver: ResolveCellClassesFn = (_r, _i, _id, _col, value) => {
      seen.push(value);
      return [];
    };
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({ resolveCellClasses: resolver }));

    // Resolver saw the number (raw); the cell text used the formatted string.
    expect(seen).toEqual([42]);
    expect(poolRow.cells[0]!.element.textContent).toBe("$42");
  });

  // ── 5. Stale-class cleanup on column recycle ──────────────────────

  it("removes stale managed classes when a cell recycles from a styled column to an unstyled one", () => {
    const poolRow = makePoolRow(1);
    const colsA: ColumnDef[] = [{ field: "amount" }];
    const colsB: ColumnDef[] = [{ field: "id" }];
    const resolver: ResolveCellClassesFn = (_r, _i, _id, col) =>
      col.field === "amount" ? ["money"] : [];

    // Bind 1: styled column → "money" applied.
    populateRow(poolRow, rowAlice, colsA, 0, window(1), options({ resolveCellClasses: resolver, columnVersion: 1 }));
    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(true);

    // Bind 2: same physical cell now binds an unstyled column. The resolver
    // returns `[]` → diff helper removes "money".
    populateRow(poolRow, rowAlice, colsB, 0, window(1), options({ resolveCellClasses: resolver, columnVersion: 2 }));
    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(false);
    expect(poolRow.cells[0]!.managedCellClasses).toBeUndefined();
  });

  // ── 6. Core class preservation ────────────────────────────────────

  it("does NOT remove core `lfg-cell` or `lfg-column-selected` when managed classes change", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];
    const resolver: ResolveCellClassesFn = () => ["money"];

    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver,
      isColumnSelected: (f) => f === "amount",
    }));
    const cellEl = poolRow.cells[0]!.element;
    expect(cellEl.classList.contains(CSS.CELL)).toBe(true);
    expect(cellEl.classList.contains("lfg-column-selected")).toBe(true);
    expect(cellEl.classList.contains("money")).toBe(true);

    // Recycle to a row with a class swap — core + column-selected remain.
    populateRow(poolRow, rowBob, cols, 1, window(1), options({
      resolveCellClasses: () => ["other"],
      isColumnSelected: (f) => f === "amount",
    }));
    expect(cellEl.classList.contains(CSS.CELL)).toBe(true);
    expect(cellEl.classList.contains("lfg-column-selected")).toBe(true);
    expect(cellEl.classList.contains("money")).toBe(false);
    expect(cellEl.classList.contains("other")).toBe(true);
  });

  // ── 7. Selection / action / internal column exclusion ─────────────

  it("does NOT apply v1 cell styling to selection columns", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [
      {
        field: SELECTION_COLUMN_FIELD,
        internal: "selection",
      },
    ];
    const resolver: ResolveCellClassesFn = () => ["should-not-apply"];

    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("should-not-apply")).toBe(false);
    expect(poolRow.cells[0]!.managedCellClasses).toBeUndefined();
  });

  it("does NOT apply v1 cell styling to action columns", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [
      {
        field: "actions",
        cellKind: "actions",
        actionsKey: "rowActions",
      },
    ];
    const resolver: ResolveCellClassesFn = () => ["should-not-apply"];

    populateRow(poolRow, rowAlice, cols, 0, window(1), options({ resolveCellClasses: resolver }));
    expect(poolRow.cells[0]!.element.classList.contains("should-not-apply")).toBe(false);
    expect(poolRow.cells[0]!.managedCellClasses).toBeUndefined();
  });

  // ── 8. Drain on recycle from normal styled → selection / action ───

  it("clears stale managed classes when a normal-styled cell recycles to the selection column", () => {
    const poolRow = makePoolRow(1);
    const styledCols: ColumnDef[] = [{ field: "amount" }];
    const selCols: ColumnDef[] = [
      { field: SELECTION_COLUMN_FIELD, internal: "selection" },
    ];
    const resolver: ResolveCellClassesFn = (_r, _i, _id, col) =>
      col.field === "amount" ? ["money"] : [];

    populateRow(poolRow, rowAlice, styledCols, 0, window(1), options({
      resolveCellClasses: resolver, columnVersion: 1,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(true);

    populateRow(poolRow, rowAlice, selCols, 0, window(1), options({
      resolveCellClasses: resolver, columnVersion: 2,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(false);
    expect(poolRow.cells[0]!.managedCellClasses).toBeUndefined();
  });

  it("clears stale managed classes when a normal-styled cell recycles to an action column", () => {
    const poolRow = makePoolRow(1);
    const styledCols: ColumnDef[] = [{ field: "amount" }];
    const actionCols: ColumnDef[] = [
      { field: "actions", cellKind: "actions", actionsKey: "rowActions" },
    ];
    const resolver: ResolveCellClassesFn = (_r, _i, _id, col) =>
      col.field === "amount" ? ["money"] : [];

    populateRow(poolRow, rowAlice, styledCols, 0, window(1), options({
      resolveCellClasses: resolver, columnVersion: 1,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(true);

    populateRow(poolRow, rowAlice, actionCols, 0, window(1), options({
      resolveCellClasses: resolver, columnVersion: 2,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(false);
    expect(poolRow.cells[0]!.managedCellClasses).toBeUndefined();
  });

  // ── 9. layoutOnly bypass ──────────────────────────────────────────

  it("does NOT run the cell-class resolver in `layoutOnly` mode (live column resize)", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];

    // First bind with no resolver.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({}));

    // Now switch to a path with layoutOnly + a resolver — must not be called.
    const spy = vi.fn(() => ["new"]);
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      layoutOnly: true,
      resolveCellClasses: spy,
      columnVersion: 1,
    }));
    expect(spy).not.toHaveBeenCalled();
    expect(poolRow.cells[0]!.element.classList.contains("new")).toBe(false);
  });

  // ── 10. cellClassVersion bump triggers re-run on next cell-loop pass ─

  it("records `lastCellClassVersion` so future styling-only paths can skip", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];
    const resolver: ResolveCellClassesFn = () => ["money"];

    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver, cellClassVersion: 7,
    }));
    expect(poolRow.cells[0]!.lastCellClassVersion).toBe(7);
  });

  it("re-runs the resolver when the cell binding changes — the dirty-skip is outside, the per-cell apply is unconditional", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];
    let calls = 0;
    const resolver: ResolveCellClassesFn = () => {
      calls++;
      return ["x"];
    };

    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver, dataRevision: 1,
    }));
    expect(calls).toBe(1);

    // Same row + same dataRevision → outer populateRow dirty-skip fires
    // (rowId, rowVersion, columnVersion all match) → cell loop does NOT run
    // → resolver NOT called again.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver, dataRevision: 1,
    }));
    expect(calls).toBe(1);

    // Bump dataRevision → outer dirty-skip fails → cell loop runs → resolver
    // called again.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver, dataRevision: 2,
    }));
    expect(calls).toBe(2);
  });

  // ── 11. Value-pipeline call counts unchanged ──────────────────────

  it("does NOT duplicate `valueGetter` / `valueFormatter` calls when a resolver is provided", () => {
    const poolRow = makePoolRow(1);
    const getter = vi.fn(({ row }: { row: RowData }) => (row as { amount: number }).amount);
    const formatter = vi.fn(({ value }: { value: unknown }) => `$${String(value)}`);
    const cols: ColumnDef[] = [
      { field: "amount", valueGetter: getter, valueFormatter: formatter },
    ];
    const resolver: ResolveCellClassesFn = () => ["money"];

    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver,
    }));

    // Exactly one call each — the resolver shares the raw value with the
    // formatter (raw = getter result, used for both text + resolver input).
    expect(getter).toHaveBeenCalledTimes(1);
    expect(formatter).toHaveBeenCalledTimes(1);
  });

  // ── 12. Resolver removed between binds drains cell-managed classes ─

  // ── 13. cellClassVersion gates the styling-only fast pass ────────

  it("same rowId/dataRevision/columnVersion + BUMPED cellClassVersion reruns the resolver and updates classes", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];

    let resolverReturn: string[] = ["old"];
    const resolver = vi.fn((): string[] => resolverReturn);

    // Bind 1 — establish baseline.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver,
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 1,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("old")).toBe(true);
    const callsAfterBind1 = resolver.mock.calls.length;

    // Bind 2 — everything identical EXCEPT cellClassVersion. The outer
    // dirty-skip would normally fire (row + columns + data unchanged), but
    // the styling-only fast pass detects the version bump and re-runs the
    // resolver. New class swaps in; old class drops via the diff helper.
    resolverReturn = ["new"];
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver,
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 2,
    }));

    expect(resolver.mock.calls.length).toBe(callsAfterBind1 + 1);
    expect(poolRow.cells[0]!.element.classList.contains("old")).toBe(false);
    expect(poolRow.cells[0]!.element.classList.contains("new")).toBe(true);
    expect(poolRow.cells[0]!.lastCellClassVersion).toBe(2);
    expect(poolRow.lastCellClassVersion).toBe(2);
  });

  it("styling-only fast pass does NOT rebind cell text/value", () => {
    const poolRow = makePoolRow(1);

    const getter = vi.fn(({ row }: { row: RowData }) => (row as { amount: number }).amount);
    const formatter = vi.fn(({ value }: { value: unknown }) => `$${String(value)}`);
    const styled: ColumnDef[] = [
      { field: "amount", valueGetter: getter, valueFormatter: formatter },
    ];

    populateRow(poolRow, rowAlice, styled, 0, window(1), options({
      resolveCellClasses: () => ["x"],
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 1,
    }));
    const getterAfterBind1 = getter.mock.calls.length;
    const formatterAfterBind1 = formatter.mock.calls.length;
    const textAfterBind1 = poolRow.cells[0]!.element.textContent;

    // Bump only cellClassVersion. Fast pass runs the getter to feed the
    // resolver the raw value (one extra getter call). It does NOT run the
    // formatter — text content is untouched.
    populateRow(poolRow, rowAlice, styled, 0, window(1), options({
      resolveCellClasses: () => ["y"],
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 2,
    }));

    expect(formatter.mock.calls.length).toBe(formatterAfterBind1);
    expect(poolRow.cells[0]!.element.textContent).toBe(textAfterBind1);
    expect(getter.mock.calls.length).toBe(getterAfterBind1 + 1);
    expect(poolRow.cells[0]!.element.classList.contains("x")).toBe(false);
    expect(poolRow.cells[0]!.element.classList.contains("y")).toBe(true);
  });

  it("same rowId/dataRevision/columnVersion + SAME cellClassVersion does NOT re-run the resolver", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];
    const resolver = vi.fn((): string[] => ["stable"]);

    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver,
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 5,
    }));
    const baseline = resolver.mock.calls.length;
    expect(baseline).toBeGreaterThan(0);

    // Identical inputs (including cellClassVersion). Outer dirty-skip fires
    // and the fast pass sees `lastCellClassVersion === cellClassVersion` →
    // no resolver invocation.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver,
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 5,
    }));
    expect(resolver.mock.calls.length).toBe(baseline);
  });

  // ── 14. Internal / synthetic columns are not eligible ─────────────

  it("internal (synthetic) columns do not receive cell classes AND drain stale managed classes", () => {
    const poolRow = makePoolRow(1);

    // First bind to a normal styled column.
    const normal: ColumnDef[] = [{ field: "amount" }];
    populateRow(poolRow, rowAlice, normal, 0, window(1), options({
      resolveCellClasses: () => ["money"],
      columnVersion: 1,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(true);

    // Second bind: the physical cell now binds an `internal: "selection"`
    // synthetic column. (Same field shape used by `createSelectionColumnDef`
    // — using `internal` directly proves the eligibility helper handles any
    // internal-marked column, not just the selection-field special case.)
    const synthetic: ColumnDef[] = [
      { field: "__lfg_synthetic__", internal: "selection" },
    ];
    populateRow(poolRow, rowAlice, synthetic, 0, window(1), options({
      resolveCellClasses: () => ["should-not-apply"],
      columnVersion: 2,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(false);
    expect(poolRow.cells[0]!.element.classList.contains("should-not-apply")).toBe(false);
    expect(poolRow.cells[0]!.managedCellClasses).toBeUndefined();
  });

  // ── 15. Resolver presence transitions while row inputs are unchanged ──
  //
  // Regression coverage for the prior bug where the outer dirty-skip would
  // fire for unchanged row/data/columns and miss a resolver-presence flip.
  // The fix tracks `lastCellClassResolverActive` alongside `lastCellClassVersion`
  // so presence changes (undefined ↔ resolver, even with the same default
  // `cellClassVersion` of 0) drive the styling-only fast pass.

  it("same row/data/columns, resolver REMOVED across binds: stale managed class is drained", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];

    // Bind 1: resolver active, class applied.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: () => ["money"],
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 0,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(true);
    expect(poolRow.lastCellClassResolverActive).toBe(true);

    // Bind 2: SAME rowId/dataRevision/columnVersion (so outer dirty-skip
    // would fire) and SAME cellClassVersion. Only difference is that the
    // resolver is gone. The fast pass MUST detect the presence flip and
    // drain the stale class.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      // resolveCellClasses: undefined,
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 0,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(false);
    expect(poolRow.cells[0]!.managedCellClasses).toBeUndefined();
    expect(poolRow.lastCellClassResolverActive).toBe(false);
    expect(poolRow.lastCellClassVersion).toBeUndefined();
  });

  it("same row/data/columns, resolver ADDED across binds with default cellClassVersion: class is applied", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];

    // Bind 1: no resolver — cell remains unstyled.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 0,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("late")).toBe(false);
    expect(poolRow.lastCellClassResolverActive).toBe(false);

    // Bind 2: SAME row/data/columns AND default `cellClassVersion: 0`. The
    // resolver is newly supplied. Without the presence-aware fast-pass
    // entry, `lastCellClassVersion (undefined) === 0`? No — undefined !== 0
    // would already trigger. The real risk was relying solely on numeric
    // version equality after a resolver was previously active and dropped
    // (lastCellClassVersion = undefined gets re-set to 0 on first activation).
    // The presence flag catches the activation regardless.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: () => ["late"],
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 0,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("late")).toBe(true);
    expect(poolRow.cells[0]!.managedCellClasses).toEqual(["late"]);
    expect(poolRow.lastCellClassResolverActive).toBe(true);
    expect(poolRow.lastCellClassVersion).toBe(0);
  });

  it("same row/data/columns, resolver dropped THEN re-added at default version: re-applies cleanly", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];

    // Bind 1: resolver active.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: () => ["a"],
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 0,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("a")).toBe(true);

    // Bind 2: drop resolver — class drained, row tagged inactive.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 0,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("a")).toBe(false);

    // Bind 3: re-add resolver at SAME default version. The presence flag
    // (false → true) triggers the fast pass regardless of numeric version
    // equality — old worry was that the version would match and skip.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: () => ["b"],
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 0,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("b")).toBe(true);
    expect(poolRow.cells[0]!.managedCellClasses).toEqual(["b"]);
    expect(poolRow.lastCellClassResolverActive).toBe(true);
  });

  it("same row/data/columns, resolver active and SAME cellClassVersion: resolver does NOT rerun", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];
    const resolver = vi.fn((): string[] => ["x"]);

    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver,
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 3,
    }));
    const baseline = resolver.mock.calls.length;
    expect(baseline).toBeGreaterThan(0);

    // Identical inputs including presence flag (true → true) AND version
    // (3 === 3) → outer dirty-skip fires, fast-pass entry condition is
    // false (no presence change, no version stale), resolver NOT called.
    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: resolver,
      dataRevision: 1,
      columnVersion: 1,
      cellClassVersion: 3,
    }));
    expect(resolver.mock.calls.length).toBe(baseline);
  });

  it("drains managed cell classes when `resolveCellClasses` is dropped on the next bind", () => {
    const poolRow = makePoolRow(1);
    const cols: ColumnDef[] = [{ field: "amount" }];

    populateRow(poolRow, rowAlice, cols, 0, window(1), options({
      resolveCellClasses: () => ["money"], columnVersion: 1,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(true);
    expect(poolRow.cells[0]!.managedCellClasses).toEqual(["money"]);

    // Second bind — same column, but caller no longer supplies a resolver.
    populateRow(poolRow, rowBob, cols, 1, window(1), options({
      columnVersion: 2,
    }));
    expect(poolRow.cells[0]!.element.classList.contains("money")).toBe(false);
    expect(poolRow.cells[0]!.managedCellClasses).toBeUndefined();
    expect(poolRow.cells[0]!.lastCellClassVersion).toBeUndefined();
  });
});
