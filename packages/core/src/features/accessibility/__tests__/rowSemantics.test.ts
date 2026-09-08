// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { VisualRowLayout } from "../../../internal/layoutTypes";
import type { PooledRow } from "../../../internal/poolTypes";
import type { DomGridFeatureContext } from "../../types";
import {
  resolveVisualRowIndex,
  RowSemanticsReconciler,
  syncRowSemantics,
  toAriaRowIndex,
} from "../utils/rowSemantics";

describe("resolveVisualRowIndex", () => {
  const layout: VisualRowLayout = {
    topDisplayIndexes: [2, 0],
    centerRowCount: 3,
    centerToDisplayIndex: null,
    bottomDisplayIndexes: [4],
  };

  it("returns display index when layout is null", () => {
    expect(resolveVisualRowIndex(5, null)).toBe(5);
  });

  it("maps top, center, and bottom display indexes", () => {
    expect(resolveVisualRowIndex(2, layout)).toBe(0);
    expect(resolveVisualRowIndex(0, layout)).toBe(1);
    expect(resolveVisualRowIndex(1, layout)).toBe(2);
    expect(resolveVisualRowIndex(4, layout)).toBe(5);
  });
});

describe("toAriaRowIndex", () => {
  it("is 1-based after header rows", () => {
    expect(toAriaRowIndex(2, 0)).toBe(3);
    expect(toAriaRowIndex(0, 0)).toBe(1);
  });

  it("returns null for invalid inputs instead of throwing", () => {
    expect(toAriaRowIndex(-1, 0)).toBeNull();
    expect(toAriaRowIndex(0, -1)).toBeNull();
  });
});

function makePoolRow(
  rowIndex: number,
  rowId: string | null,
): PooledRow {
  const element = document.createElement("div");
  element.className = "lfg-row";
  return {
    element,
    cells: [],
    rowIndex,
    rowVersion: 0,
    rowId,
  };
}

function makeCtx(pool: PooledRow[]): DomGridFeatureContext {
  const root = document.createElement("div");
  const header = document.createElement("div");
  header.className = "lfg-header";
  const leaf = document.createElement("div");
  leaf.className = "lfg-header-row";
  header.appendChild(leaf);
  root.appendChild(header);

  return {
    root,
    surface: root,
    viewport: document.createElement("div"),
    getPool: () => pool,
    getColumns: () => [],
    getDisplayRows: () => ({
      rowCount: pool.length,
      getRowData: () => ({}),
      getSourceIndex: () => -1,
      getRow: () => null,
    }),
    getSourceRows: () => [],
    getVisibleRowStart: () => 0,
    requestSync: () => {},
    requestColumnTransformSync: () => {},
    syncColumnSelectionClasses: () => {},
    resolveRowId: () => "id",
    getHeaderRowEl: () => leaf,
    getPinnedHeaderRowEl: () => null,
    getPinnedRightHeaderRowEl: () => null,
    getDataRevision: () => 0,
    getSelectedColumnIdsForColumnOrder: () => [],
    getSelectedRowCountForRowOrder: () => 0,
    isRowSelectedForRowOrder: (id) => id === "r1",
    getSelectedRowIdsForRowOrder: () => [],
    getSortModel: () => [],
    toggleColumnSort: () => {},
    setColumnSort: () => {},
    pinColumn: () => {},
  };
}

describe("syncRowSemantics", () => {
  it("writes role, aria-rowindex, and aria-selected on bound body rows", () => {
    const pool = [makePoolRow(0, "r1"), makePoolRow(1, "r2")];
    const ctx = makeCtx(pool);

    syncRowSemantics(ctx, {
      getRowSelectionMode: () => "single",
      isRowSelected: (id) => id === "r1",
    });

    expect(pool[0]!.element.getAttribute("role")).toBe("row");
    expect(pool[0]!.element.getAttribute("aria-rowindex")).toBe("2");
    expect(pool[0]!.element.getAttribute("aria-selected")).toBe("true");

    expect(pool[1]!.element.getAttribute("aria-rowindex")).toBe("3");
    expect(pool[1]!.element.getAttribute("aria-selected")).toBe("false");

    expect(ctx.getHeaderRowEl()!.getAttribute("role")).toBeNull();
    expect(ctx.getHeaderRowEl()!.getAttribute("aria-rowindex")).toBeNull();
  });

  it("keeps one canonical row and makes column-pinned wrappers presentational", () => {
    const poolRow = makePoolRow(0, "r1");

    const pinnedLeft = document.createElement("div");
    pinnedLeft.className = "lfg-pinned-row";
    poolRow.pinnedElement = pinnedLeft;

    const ctx = makeCtx([poolRow]);
    syncRowSemantics(ctx, {
      getRowSelectionMode: () => "none",
      isRowSelected: () => false,
    });

    expect(poolRow.element.getAttribute("role")).toBe("row");
    expect(poolRow.element.getAttribute("aria-rowindex")).toBe("2");
    expect(pinnedLeft.getAttribute("role")).toBe("presentation");
    expect(pinnedLeft.getAttribute("aria-rowindex")).toBeNull();
    expect(pinnedLeft.getAttribute("aria-selected")).toBeNull();
  });

  it("clears semantics on idle pool rows", () => {
    const pool = [makePoolRow(-1, null)];
    pool[0]!.element.setAttribute("role", "row");
    pool[0]!.element.setAttribute("aria-rowindex", "9");
    const ctx = makeCtx(pool);

    syncRowSemantics(ctx, {
      getRowSelectionMode: () => "none",
      isRowSelected: () => false,
    });

    expect(pool[0]!.element.getAttribute("role")).toBeNull();
    expect(pool[0]!.element.getAttribute("aria-rowindex")).toBeNull();
  });
});

describe("RowSemanticsReconciler retained writes", () => {
  const read = {
    getRowSelectionMode: () => "none" as const,
    isRowSelected: () => false,
  };

  it("performs zero attribute writes for unchanged warmed bindings", () => {
    const pool = [
      makePoolRow(0, "r0"),
      makePoolRow(1, "r1"),
      makePoolRow(2, "r2"),
    ];
    const ctx = makeCtx(pool);
    const reconciler = new RowSemanticsReconciler();
    reconciler.syncStructure(ctx, read);

    const setSpies = pool.map((row) =>
      vi.spyOn(row.element, "setAttribute"),
    );
    const removeSpies = pool.map((row) =>
      vi.spyOn(row.element, "removeAttribute"),
    );

    expect(reconciler.syncPosition(ctx, read)).toBe(true);
    for (const spy of [...setSpies, ...removeSpies]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("updates only changed physical rows and their existing lane roots", () => {
    const pool = [
      makePoolRow(0, "r0"),
      makePoolRow(1, "r1"),
      makePoolRow(2, "r2"),
      makePoolRow(3, "r3"),
    ];
    pool[0]!.pinnedElement = document.createElement("div");
    const ctx = makeCtx(pool);
    const reconciler = new RowSemanticsReconciler();
    reconciler.syncStructure(ctx, read);

    const rowWrites = pool.map((row) =>
      vi.spyOn(row.element, "setAttribute"),
    );
    const pinnedWrite = vi.spyOn(
      pool[0]!.pinnedElement!,
      "setAttribute",
    );

    pool[0]!.rowIndex = 1;
    pool[0]!.rowId = "r1";
    pool[1]!.rowIndex = 0;
    pool[1]!.rowId = "r0";

    expect(reconciler.syncPosition(ctx, read)).toBe(true);
    expect(rowWrites[0]).toHaveBeenCalled();
    expect(rowWrites[1]).toHaveBeenCalled();
    expect(rowWrites[2]).not.toHaveBeenCalled();
    expect(rowWrites[3]).not.toHaveBeenCalled();
    expect(pinnedWrite).not.toHaveBeenCalled();
    expect(pool[0]!.pinnedElement!.getAttribute("role")).toBe("presentation");
  });

  it("keeps structured row-pinned satellites presentational across selection updates", () => {
    const center = makePoolRow(0, "r0");
    const left = makePoolRow(0, "r0");
    const right = makePoolRow(0, "r0");
    const ctx = makeCtx([makePoolRow(-1, null)]);
    ctx.forEachRowPinnedLogicalPoolRow = (visit) =>
      visit(center, left, right);
    let selected = false;
    const selectionRead = {
      getRowSelectionMode: () => "multiple" as const,
      isRowSelected: () => selected,
    };
    const reconciler = new RowSemanticsReconciler();
    reconciler.syncStructure(ctx, selectionRead);
    const leftSet = vi.spyOn(left.element, "setAttribute");
    const rightSet = vi.spyOn(right.element, "setAttribute");

    selected = true;
    expect(reconciler.syncPosition(ctx, selectionRead)).toBe(true);

    expect(center.element.getAttribute("aria-selected")).toBe("true");
    expect(left.element.getAttribute("role")).toBe("presentation");
    expect(right.element.getAttribute("role")).toBe("presentation");
    expect(leftSet).not.toHaveBeenCalled();
    expect(rightSet).not.toHaveBeenCalled();
  });

  it("requests structural warm-up instead of allocating from positional work", () => {
    const pool = [makePoolRow(0, "r0")];
    const ctx = makeCtx(pool);
    const reconciler = new RowSemanticsReconciler();
    reconciler.syncStructure(ctx, read);

    pool.push(makePoolRow(1, "r1"));
    expect(reconciler.syncPosition(ctx, read)).toBe(false);
    expect(pool[1]!.element.getAttribute("role")).toBeNull();

    reconciler.syncStructure(ctx, read);
    expect(pool[1]!.element.getAttribute("role")).toBe("row");
  });
});
