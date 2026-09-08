// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { RowAccess } from "../../../internal/rowAccess";
import type { RowData, SelectionChange } from "../../../types";
import {
  createSelectionChangedEvent,
  EAGER_CHANGED_ROW_CAP,
  INLINE_SELECTED_ID_CAP,
} from "../createSelectionChangedEvent";

function makeRowAccess(
  getRows: () => RowData[],
  resolveRowId: (row: RowData, index: number) => string,
): RowAccess {
  return { getRows, resolveRowId };
}

describe("createSelectionChangedEvent", () => {
  it("inlines selectedRowIds for small explicit selection", () => {
    const row = { id: "a", n: 0 } as RowData;
    const rowAccess = makeRowAccess(
      () => [row],
      (r) => (r as { id: string }).id,
    );
    const sel: SelectionChange = {
      kind: "toggle",
      changedIds: ["a"],
      selection: {
        type: "explicit",
        ids: ["a"],
        selectedCount: 1,
      },
    };
    const e = createSelectionChangedEvent({
      change: sel,
      source: "click",
      rowAccess,
    });
    expect(e.selectedRowIds).toEqual(["a"]);
    expect(e.getSelectedRowIds()).toEqual(["a"]);
  });

  it("omits selectedRowIds for explicit selection larger than inline cap", () => {
    const ids = Array.from({ length: INLINE_SELECTED_ID_CAP + 1 }, (_, i) => `id_${i}`);
    const rows = ids.map((id) => ({ id })) as RowData[];
    const rowAccess = makeRowAccess(
      () => rows,
      (r) => (r as { id: string }).id,
    );
    const sel: SelectionChange = {
      kind: "selectAll",
      changedIds: [],
      selection: {
        type: "explicit",
        ids,
        selectedCount: ids.length,
      },
    };
    const e = createSelectionChangedEvent({
      change: sel,
      source: "api",
      rowAccess,
    });
    expect(e.selectedRowIds).toBeUndefined();
    expect(e.getSelectedRowIds()).toEqual(ids);
  });

  it("never inlines selectedRowIds for all mode", () => {
    const rowAccess = makeRowAccess(
      () => [{ id: "a" }, { id: "b" }] as RowData[],
      (r) => (r as { id: string }).id,
    );
    const sel: SelectionChange = {
      kind: "selectAll",
      changedIds: [],
      selection: {
        type: "all",
        excludedIds: [],
        selectedCount: 100_000,
      },
    };
    const e = createSelectionChangedEvent({
      change: sel,
      source: "click",
      rowAccess,
    });
    expect(e.selectedRowIds).toBeUndefined();
    expect(e.selectionType).toBe("all");
  });

  it("isRowSelected reflects snapshot, not later grid data", () => {
    const a = { id: "a", n: 1 } as RowData;
    let rows: RowData[] = [a];
    const rowAccess = makeRowAccess(
      () => rows,
      (r) => (r as { id: string }).id,
    );
    const sel: SelectionChange = {
      kind: "toggle",
      changedIds: ["a"],
      selection: {
        type: "explicit",
        ids: ["a"],
        selectedCount: 1,
      },
    };
    const e = createSelectionChangedEvent({
      change: sel,
      source: "click",
      rowAccess,
    });
    expect(e.isRowSelected("a")).toBe(true);
    expect(e.isRowSelected("b")).toBe(false);

    rows = [{ id: "b", n: 2 }] as RowData[];
    expect(e.isRowSelected("a")).toBe(true);
    expect(e.getSelectedRowIds()).toEqual(["a"]);
  });

  it("isRowSelected for all mode with exclusions", () => {
    const rowAccess = makeRowAccess(
      () => [{ id: "a" }, { id: "b" }] as RowData[],
      (r) => (r as { id: string }).id,
    );
    const sel: SelectionChange = {
      kind: "toggle",
      changedIds: ["b"],
      selection: {
        type: "all",
        excludedIds: ["b"],
        selectedCount: 1,
      },
    };
    const e = createSelectionChangedEvent({
      change: sel,
      source: "click",
      rowAccess,
    });
    expect(e.isRowSelected("a")).toBe(true);
    expect(e.isRowSelected("b")).toBe(false);
  });

  it("memoizes getSelectedRowIds (scan once in all mode)", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
    })) as RowData[];
    let resolveCalls = 0;
    const rowAccess = makeRowAccess(
      () => rows,
      (row, _idx) => {
        resolveCalls++;
        return (row as { id: string }).id;
      },
    );

    const sel: SelectionChange = {
      kind: "selectAll",
      changedIds: [],
      selection: {
        type: "all",
        excludedIds: [],
        selectedCount: 30,
      },
    };
    const e = createSelectionChangedEvent({
      change: sel,
      source: "click",
      rowAccess,
    });
    resolveCalls = 0;
    e.getSelectedRowIds();
    const afterFirst = resolveCalls;
    e.getSelectedRowIds();
    expect(resolveCalls).toBe(afterFirst);
  });

  it("resolves changedRows only for small non-bulk changes", () => {
    const r0 = { id: "a" } as RowData;
    const rowAccess = makeRowAccess(
      () => [r0],
      (r) => (r as { id: string }).id,
    );

    const toggle: SelectionChange = {
      kind: "toggle",
      changedIds: ["a"],
      selection: { type: "explicit", ids: ["a"], selectedCount: 1 },
    };
    const et = createSelectionChangedEvent({
      change: toggle,
      source: "click",
      rowAccess,
    });
    expect(et.changedRows).toEqual([r0]);

    const bulk: SelectionChange = {
      kind: "selectAll",
      changedIds: [],
      selection: { type: "all", excludedIds: [], selectedCount: 1 },
    };
    const eb = createSelectionChangedEvent({
      change: bulk,
      source: "click",
      rowAccess: makeRowAccess(() => [r0], (r) => (r as { id: string }).id),
    });
    expect(eb.changedRows).toEqual([]);
    expect(eb.changedRowIds).toEqual([]);

    const clr: SelectionChange = {
      kind: "clear",
      changedIds: [],
      selection: { type: "explicit", ids: [], selectedCount: 0 },
    };
    const ec = createSelectionChangedEvent({
      change: clr,
      source: "api",
      rowAccess: makeRowAccess(() => [r0], (r) => (r as { id: string }).id),
    });
    expect(ec.changedRows).toEqual([]);
    expect(ec.selectedCount).toBe(0);
  });

  it("skips eager changedRows when changedIds exceed cap", () => {
    const ids = Array.from({ length: EAGER_CHANGED_ROW_CAP + 1 }, (_, i) => `x${i}`);
    const rowAccess = makeRowAccess(() => [], () => "noop");
    const sel: SelectionChange = {
      kind: "toggle",
      changedIds: ids,
      selection: { type: "explicit", ids: [], selectedCount: 0 },
    };
    const e = createSelectionChangedEvent({
      change: sel,
      source: "click",
      rowAccess,
    });
    expect(e.changedRows).toEqual([]);
  });
});
