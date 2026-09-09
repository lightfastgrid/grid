import { describe, expect, it } from "vitest";

import type { RowData } from "../../types";
import { GridState } from "../GridState";

function resolveId(row: RowData): string | null {
  const id = row.id;
  return id == null || id === "" ? null : String(id);
}

describe("GridState cell-change flash accumulator", () => {
  it("does not accumulate when cellChangeFlash is unset", () => {
    const state = new GridState({
      columns: [{ field: "v" }],
      rows: [{ id: "a", v: 1 }],
      getRowId: (row) => String(row.id),
    });
    state.applyStoreTransaction({ update: [{ id: "a", v: 2 }] }, resolveId);
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();
  });

  it("accumulates successful update fields and consumes once", () => {
    const state = new GridState({
      columns: [{ field: "v", cellChangeFlash: true }],
      rows: [{ id: "a", v: 1 }],
      getRowId: (row) => String(row.id),
    });
    state.applyStoreTransaction({ update: [{ id: "a", v: 2 }] }, resolveId);
    const flash = state.consumeCellChangeFlashForRender();
    expect(flash?.get("a")).toEqual(new Set(["v"]));
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();
  });

  it("unions fields across transactions before consume", () => {
    const state = new GridState({
      columns: [
        { field: "name", cellChangeFlash: true },
        { field: "score", cellChangeFlash: true },
      ],
      rows: [{ id: "a", name: "Alice", score: 1 }],
      getRowId: (row) => String(row.id),
    });
    state.applyStoreTransaction(
      { update: [{ id: "a", name: "Alicia", score: 1 }] },
      resolveId,
    );
    state.applyStoreTransaction(
      { update: [{ id: "a", name: "Alicia", score: 9 }] },
      resolveId,
    );
    const flash = state.consumeCellChangeFlashForRender();
    expect(flash?.get("a")).toEqual(new Set(["name", "score"]));
  });

  it("does not accumulate no-op updates, adds, or skipped ids", () => {
    const state = new GridState({
      columns: [{ field: "v", cellChangeFlash: true }],
      rows: [{ id: "a", v: 1 }],
      getRowId: (row) => String(row.id),
    });
    state.applyStoreTransaction({ update: [{ id: "a", v: 1 }] }, resolveId);
    state.applyStoreTransaction({ add: [{ id: "b", v: 2 }] }, resolveId);
    state.applyStoreTransaction({ update: [{ id: "missing", v: 3 }] }, resolveId);
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();
  });

  it("does not accumulate cell-edit replaceRowAtSourceIndex", () => {
    const state = new GridState({
      columns: [{ field: "v", cellChangeFlash: true }],
      rows: [{ id: "a", v: 1 }],
      getRowId: (row) => String(row.id),
    });
    state.replaceRowAtSourceIndex(0, { id: "a", v: 99 }, resolveId);
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();
  });

  it("clears pending flash on setRows", () => {
    const state = new GridState({
      columns: [{ field: "v", cellChangeFlash: true }],
      rows: [{ id: "a", v: 1 }],
      getRowId: (row) => String(row.id),
    });
    state.applyStoreTransaction({ update: [{ id: "a", v: 2 }] }, resolveId);
    state.setRows([{ id: "a", v: 2 }], resolveId);
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();
  });

  it("preserves pending flash when setRows echoes the same row sequence", () => {
    const state = new GridState({
      columns: [{ field: "v", cellChangeFlash: true }],
      rows: [{ id: "a", v: 1 }],
      getRowId: (row) => String(row.id),
    });
    const outcome = state.applyStoreTransaction(
      { update: [{ id: "a", v: 2 }] },
      resolveId,
    );
    const beforeGeneration = state.getSnapshot().rowView.generation;
    state.setRows(outcome.result.rows, resolveId);
    const echoedSlice = outcome.result.rows.slice();
    state.setRows(echoedSlice, resolveId);
    expect(state.getSnapshot().data).toBe(echoedSlice);
    expect(state.getSnapshot().rowView.generation).toBeGreaterThan(
      beforeGeneration,
    );
    expect(state.consumeCellChangeFlashForRender()?.get("a")).toEqual(new Set(["v"]));
  });

  it("keeps flash metadata when sort invalidation drops the dirty-patch set", () => {
    const state = new GridState({
      columns: [{ field: "v", sortable: true, cellChangeFlash: true }],
      rows: [
        { id: "a", v: 1 },
        { id: "b", v: 2 },
      ],
      getRowId: (row) => String(row.id),
      initialSortModel: [{ field: "v", sort: "asc" }],
    });
    state.applyStoreTransaction({ update: [{ id: "a", v: 10 }] }, resolveId);
    expect(state.consumeRenderChangeSetForRender()).toBeUndefined();
    expect(state.consumeCellChangeFlashForRender()?.get("a")).toEqual(new Set(["v"]));
  });

  it("batch transactions accumulate once for the merged dirty set", () => {
    const state = new GridState({
      columns: [{ field: "v", cellChangeFlash: true }],
      rows: [
        { id: "a", v: 1 },
        { id: "b", v: 2 },
      ],
      getRowId: (row) => String(row.id),
    });
    state.applyStoreTransactionBatch(
      [{ update: [{ id: "a", v: 3 }] }, { update: [{ id: "a", v: 4 }] }],
      resolveId,
    );
    const flash = state.consumeCellChangeFlashForRender();
    expect(flash?.get("a")).toEqual(new Set(["v"]));
  });

  it("does not consume flash while sort, filter, or Quick Search is pending", () => {
    const state = new GridState({
      columns: [{ field: "v", sortable: true, cellChangeFlash: true }],
      rows: [{ id: "a", v: 1 }],
      getRowId: (row) => String(row.id),
    });
    state.applyStoreTransaction({ update: [{ id: "a", v: 2 }] }, resolveId);

    state.markSortPending();
    expect(state.isRowModelExecutionPending()).toBe(true);
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();

    state.clearSortPending();
    state.markFilterPending();
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();

    state.clearFilterPending();
    state.markQuickSearchPending();
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();

    state.clearQuickSearchPending();
    expect(state.consumeCellChangeFlashForRender()?.get("a")).toEqual(new Set(["v"]));
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();
  });

  it("unions updates while execution is pending and consumes after settlement", () => {
    const state = new GridState({
      columns: [
        { field: "name", cellChangeFlash: true },
        { field: "score", cellChangeFlash: true },
      ],
      rows: [{ id: "a", name: "Alice", score: 1 }],
      getRowId: (row) => String(row.id),
    });
    state.markSortPending();
    state.applyStoreTransaction(
      { update: [{ id: "a", name: "Alicia", score: 1 }] },
      resolveId,
    );
    state.applyStoreTransaction(
      { update: [{ id: "a", name: "Alicia", score: 9 }] },
      resolveId,
    );
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();
    state.clearSortPending();
    expect(state.consumeCellChangeFlashForRender()?.get("a")).toEqual(
      new Set(["name", "score"]),
    );
  });

  it("drops pending flash on setRows even while execution is pending", () => {
    const state = new GridState({
      columns: [{ field: "v", cellChangeFlash: true }],
      rows: [{ id: "a", v: 1 }],
      getRowId: (row) => String(row.id),
    });
    state.applyStoreTransaction({ update: [{ id: "a", v: 2 }] }, resolveId);
    state.markSortPending();
    state.setRows([{ id: "a", v: 3 }], resolveId);
    state.clearSortPending();
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();
  });

  it("does not let a superseded pending consume replay another operation's flash", () => {
    const state = new GridState({
      columns: [
        { field: "name", cellChangeFlash: true },
        { field: "score", cellChangeFlash: true },
      ],
      rows: [{ id: "a", name: "Alice", score: 1 }],
      getRowId: (row) => String(row.id),
    });
    state.applyStoreTransaction(
      { update: [{ id: "a", name: "Alicia", score: 1 }] },
      resolveId,
    );
    state.markSortPending();
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();

    state.setRows([{ id: "a", name: "Alicia", score: 1 }], resolveId);
    state.clearSortPending();
    expect(state.consumeCellChangeFlashForRender()).toBeUndefined();

    state.applyStoreTransaction(
      { update: [{ id: "a", name: "Alicia", score: 9 }] },
      resolveId,
    );
    expect(state.consumeCellChangeFlashForRender()?.get("a")).toEqual(new Set(["score"]));
  });
});
