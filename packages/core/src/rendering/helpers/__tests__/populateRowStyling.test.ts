// @vitest-environment jsdom
//
// Unit tests for the managed row-class application inside `populateRow`.
// These tests construct PooledRow objects directly — no Grid mount required.

import { describe, expect, it } from "vitest";

import type { ColumnDef, PooledCell, PooledRow, RowData } from "../../../types";
import { CSS } from "../../const/css-classes";
import {
  type ColumnWindow,
  populateRow,
  type PopulateRowOptions,
  type ResolveRowClassesFn,
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

/** Build a PooledRow with an optional pinned-left / pinned-right twin. */
function makePoolRow(opts?: {
  pinnedLeft?: boolean;
  pinnedRight?: boolean;
}): PooledRow {
  const cellCount = 2;
  const element = document.createElement("div");
  element.className = CSS.ROW;
  const cells = makeCells(cellCount);
  for (const c of cells) element.appendChild(c.element);

  const poolRow: PooledRow = {
    element,
    cells,
    rowIndex: -1,
    rowVersion: 0,
    rowId: null,
  };

  if (opts?.pinnedLeft) {
    const pinned = document.createElement("div");
    pinned.className = "lfg-pinned-row";
    poolRow.pinnedElement = pinned;
    poolRow.pinnedCells = makeCells(1);
  }
  if (opts?.pinnedRight) {
    const pinned = document.createElement("div");
    pinned.className = "lfg-pinned-right-row";
    poolRow.rightPinnedElement = pinned;
    poolRow.rightPinnedCells = makeCells(1);
  }
  return poolRow;
}

const columns: ColumnDef[] = [
  { field: "id" },
  { field: "name" },
];

const window: ColumnWindow = {
  startIndex: 0,
  slotCount: 2,
  toPhysicalCol: (v) => v,
};

function options(overrides: Partial<PopulateRowOptions>): PopulateRowOptions {
  return {
    dataRevision: 1,
    columnVersion: 1,
    getRowId: (row) => (row as { id: string }).id,
    ...overrides,
  };
}

const rowAlice: RowData = { id: "r1", name: "Alice" };
const rowBob: RowData = { id: "r2", name: "Bob" };

describe("populateRow → managed row classes", () => {
  // ── 1. Recycled row drops old managed class, gains new one ────────

  it("removes the old user class and applies the new class on recycle", () => {
    const poolRow = makePoolRow();

    // First bind — row r1 gets `highlight`.
    let resolver: ResolveRowClassesFn = () => ["highlight"];
    populateRow(poolRow, rowAlice, columns, 0, window, options({ resolveRowClasses: resolver }));
    expect(poolRow.element.classList.contains("highlight")).toBe(true);
    expect(poolRow.managedRowClasses).toEqual(["highlight"]);

    // Pool slot recycles to row r2 — resolver returns a different class.
    resolver = () => ["warning"];
    populateRow(poolRow, rowBob, columns, 1, window, options({ resolveRowClasses: resolver }));
    expect(poolRow.element.classList.contains("highlight")).toBe(false);
    expect(poolRow.element.classList.contains("warning")).toBe(true);
    expect(poolRow.managedRowClasses).toEqual(["warning"]);
  });

  // ── 2. Static classes ────────────────────────────────────────────

  it("applies static classes from the resolver", () => {
    const poolRow = makePoolRow();
    populateRow(
      poolRow, rowAlice, columns, 0, window,
      options({ resolveRowClasses: () => ["row-base", "row-zebra"] }),
    );
    expect(poolRow.element.classList.contains("row-base")).toBe(true);
    expect(poolRow.element.classList.contains("row-zebra")).toBe(true);
  });

  // ── 3. Functional getRowClass-style result ───────────────────────

  it("applies dynamic classes derived from the row", () => {
    const poolRow = makePoolRow();
    const resolver: ResolveRowClassesFn = (row) =>
      (row as { name: string }).name === "Alice" ? ["row-alice"] : ["row-other"];
    populateRow(poolRow, rowAlice, columns, 0, window, options({ resolveRowClasses: resolver }));
    expect(poolRow.element.classList.contains("row-alice")).toBe(true);
    expect(poolRow.element.classList.contains("row-other")).toBe(false);

    populateRow(poolRow, rowBob, columns, 1, window, options({ resolveRowClasses: resolver }));
    expect(poolRow.element.classList.contains("row-alice")).toBe(false);
    expect(poolRow.element.classList.contains("row-other")).toBe(true);
  });

  // ── 4. Rules-style false removes the class ───────────────────────

  it("a rule that becomes false removes its previously applied class", () => {
    const poolRow = makePoolRow();
    // First pass: rule "alert" applies.
    populateRow(
      poolRow, rowAlice, columns, 0, window,
      options({ resolveRowClasses: () => ["alert"], rowClassVersion: 1 }),
    );
    expect(poolRow.element.classList.contains("alert")).toBe(true);

    // Second pass: bump styling version, rule predicate now returns false →
    // resolver returns no classes. Old "alert" class must be removed.
    populateRow(
      poolRow, rowAlice, columns, 0, window,
      options({ resolveRowClasses: () => [], rowClassVersion: 2 }),
    );
    expect(poolRow.element.classList.contains("alert")).toBe(false);
    expect(poolRow.managedRowClasses).toBeUndefined();
  });

  // ── 5. Selection class survives managed cleanup ──────────────────

  it("does NOT remove `lfg-row-selected` when managed classes change", () => {
    const poolRow = makePoolRow();
    // Apply selection state via the selection callback.
    populateRow(
      poolRow, rowAlice, columns, 0, window,
      options({
        isRowSelected: () => true,
        resolveRowClasses: () => ["highlight"],
      }),
    );
    expect(poolRow.element.classList.contains("lfg-row-selected")).toBe(true);
    expect(poolRow.element.classList.contains("highlight")).toBe(true);

    // Recycle to another row + styling change. Selection still applied; the
    // managed-class cleanup must leave `lfg-row-selected` alone.
    populateRow(
      poolRow, rowBob, columns, 1, window,
      options({
        isRowSelected: () => true,
        resolveRowClasses: () => ["danger"],
      }),
    );
    expect(poolRow.element.classList.contains("highlight")).toBe(false);
    expect(poolRow.element.classList.contains("danger")).toBe(true);
    expect(poolRow.element.classList.contains("lfg-row-selected")).toBe(true);
  });

  // ── 6. Row-drag / drop indicator classes survive cleanup ─────────

  it("does NOT remove externally-added classes like row-drag indicators", () => {
    const poolRow = makePoolRow();
    poolRow.element.classList.add("lfg-row-drag-source");
    poolRow.element.classList.add("lfg-row-drop-target-above");

    populateRow(
      poolRow, rowAlice, columns, 0, window,
      options({ resolveRowClasses: () => ["my-class"] }),
    );

    // External classes preserved; managed class added.
    expect(poolRow.element.classList.contains("lfg-row-drag-source")).toBe(true);
    expect(poolRow.element.classList.contains("lfg-row-drop-target-above")).toBe(true);
    expect(poolRow.element.classList.contains("my-class")).toBe(true);

    // Recycle with a different managed class — external still preserved.
    populateRow(
      poolRow, rowBob, columns, 1, window,
      options({ resolveRowClasses: () => ["another"] }),
    );
    expect(poolRow.element.classList.contains("lfg-row-drag-source")).toBe(true);
    expect(poolRow.element.classList.contains("lfg-row-drop-target-above")).toBe(true);
    expect(poolRow.element.classList.contains("my-class")).toBe(false);
    expect(poolRow.element.classList.contains("another")).toBe(true);
  });

  // ── 7. Pinned-left / pinned-right twin row elements receive the same set ─

  it("applies + cleans up managed classes on pinned-left and pinned-right row elements", () => {
    const poolRow = makePoolRow({ pinnedLeft: true, pinnedRight: true });

    populateRow(
      poolRow, rowAlice, columns, 0, window,
      options({ resolveRowClasses: () => ["pin-managed"] }),
    );
    expect(poolRow.element.classList.contains("pin-managed")).toBe(true);
    expect(poolRow.pinnedElement!.classList.contains("pin-managed")).toBe(true);
    expect(poolRow.rightPinnedElement!.classList.contains("pin-managed")).toBe(true);
    // Core classes preserved on twins.
    expect(poolRow.pinnedElement!.classList.contains("lfg-pinned-row")).toBe(true);
    expect(poolRow.rightPinnedElement!.classList.contains("lfg-pinned-right-row")).toBe(true);

    // Recycle to a new row — old managed class removed from ALL twins.
    populateRow(
      poolRow, rowBob, columns, 1, window,
      options({ resolveRowClasses: () => ["other-managed"] }),
    );
    expect(poolRow.element.classList.contains("pin-managed")).toBe(false);
    expect(poolRow.pinnedElement!.classList.contains("pin-managed")).toBe(false);
    expect(poolRow.rightPinnedElement!.classList.contains("pin-managed")).toBe(false);
    expect(poolRow.element.classList.contains("other-managed")).toBe(true);
    expect(poolRow.pinnedElement!.classList.contains("other-managed")).toBe(true);
    expect(poolRow.rightPinnedElement!.classList.contains("other-managed")).toBe(true);
    // Core classes still preserved.
    expect(poolRow.pinnedElement!.classList.contains("lfg-pinned-row")).toBe(true);
    expect(poolRow.rightPinnedElement!.classList.contains("lfg-pinned-right-row")).toBe(true);
  });

  // ── Skip-rebind correctness ──────────────────────────────────────

  it("does not call the resolver when rowId / rowVersion / rowClassVersion are unchanged", () => {
    const poolRow = makePoolRow();
    let calls = 0;
    const resolver: ResolveRowClassesFn = () => {
      calls++;
      return ["ok"];
    };

    populateRow(poolRow, rowAlice, columns, 0, window, options({ resolveRowClasses: resolver, rowClassVersion: 1 }));
    expect(calls).toBe(1);
    expect(poolRow.element.classList.contains("ok")).toBe(true);

    // Repeated call with all identity inputs unchanged — resolver MUST NOT run.
    populateRow(poolRow, rowAlice, columns, 0, window, options({ resolveRowClasses: resolver, rowClassVersion: 1 }));
    expect(calls).toBe(1);
  });

  it("runs the resolver when rowClassVersion bumps even if data/rowId are unchanged", () => {
    const poolRow = makePoolRow();
    let calls = 0;
    const resolver: ResolveRowClassesFn = () => {
      calls++;
      return ["v"];
    };

    populateRow(poolRow, rowAlice, columns, 0, window, options({ resolveRowClasses: resolver, rowClassVersion: 1 }));
    expect(calls).toBe(1);

    populateRow(poolRow, rowAlice, columns, 0, window, options({ resolveRowClasses: resolver, rowClassVersion: 2 }));
    expect(calls).toBe(2);
  });

  // ── 8. Resolver removed between renders ─────────────────────────

  it("removes managed classes when resolveRowClasses goes away on the next bind", () => {
    const poolRow = makePoolRow({ pinnedLeft: true, pinnedRight: true });

    // First bind — styling active, applies "managed-a" to all three twins.
    populateRow(
      poolRow, rowAlice, columns, 0, window,
      options({ resolveRowClasses: () => ["managed-a"], rowClassVersion: 1 }),
    );
    expect(poolRow.element.classList.contains("managed-a")).toBe(true);
    expect(poolRow.pinnedElement!.classList.contains("managed-a")).toBe(true);
    expect(poolRow.rightPinnedElement!.classList.contains("managed-a")).toBe(true);
    expect(poolRow.managedRowClasses).toEqual(["managed-a"]);
    expect(poolRow.lastRowClassVersion).toBe(1);

    // Second bind — caller dropped `resolveRowClasses` entirely. Managed
    // classes from the previous bind must be cleaned off, core classes
    // preserved, and the styling skip cache reset.
    populateRow(
      poolRow, rowAlice, columns, 0, window,
      options({ /* resolveRowClasses: undefined */ }),
    );
    expect(poolRow.element.classList.contains("managed-a")).toBe(false);
    expect(poolRow.pinnedElement!.classList.contains("managed-a")).toBe(false);
    expect(poolRow.rightPinnedElement!.classList.contains("managed-a")).toBe(false);

    // Core classes preserved on all twins.
    expect(poolRow.element.classList.contains(CSS.ROW)).toBe(true);
    expect(poolRow.pinnedElement!.classList.contains("lfg-pinned-row")).toBe(true);
    expect(poolRow.rightPinnedElement!.classList.contains("lfg-pinned-right-row")).toBe(true);

    // Cache state reset so a future `resolveRowClasses` re-run is not skipped.
    expect(poolRow.managedRowClasses).toBeUndefined();
    expect(poolRow.lastRowClassVersion).toBeUndefined();
  });

  it("does not run the resolver under layoutOnly", () => {
    const poolRow = makePoolRow();
    let calls = 0;
    const resolver: ResolveRowClassesFn = () => {
      calls++;
      return ["x"];
    };
    populateRow(
      poolRow, rowAlice, columns, 0, window,
      options({ resolveRowClasses: resolver, layoutOnly: true }),
    );
    expect(calls).toBe(0);
  });
});
