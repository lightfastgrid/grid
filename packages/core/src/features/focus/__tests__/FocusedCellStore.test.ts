import { describe, expect, it } from "vitest";

import type { FocusedCell } from "../../../types";
import { FocusedCellStore } from "../FocusedCellStore";

function cell(partial: Partial<FocusedCell> = {}): FocusedCell {
  return { rowId: "r1", field: "name", rowIndex: 0, sourceIndex: 0, ...partial };
}

describe("FocusedCellStore", () => {
  it("set returns the previous cell on identity change", () => {
    const store = new FocusedCellStore();

    const first = store.set(cell());
    expect(first).toEqual({ previous: null });
    expect(store.get()).toEqual(cell());

    const second = store.set(cell({ rowId: "r2", rowIndex: 1, sourceIndex: 1 }));
    expect(second).toEqual({ previous: cell() });

    const third = store.set(cell({ rowId: "r2", field: "age", rowIndex: 1 }));
    expect(third?.previous?.field).toBe("name");
  });

  it("set is a no-op change for the same rowId + field, but refreshes indexes", () => {
    const store = new FocusedCellStore();
    store.set(cell());

    const change = store.set(cell({ rowIndex: 5, sourceIndex: 7 }));
    expect(change).toBeNull(); // identity unchanged → no change result
    expect(store.get()).toEqual(cell({ rowIndex: 5, sourceIndex: 7 }));
  });

  it("clear returns the previous cell and is a no-op when empty", () => {
    const store = new FocusedCellStore();
    expect(store.clear()).toBeNull();

    store.set(cell());
    expect(store.clear()).toEqual({ previous: cell() });
    expect(store.get()).toBeNull();
    expect(store.clear()).toBeNull();
  });

  it("updatePosition silently refreshes indexes only", () => {
    const store = new FocusedCellStore();
    store.updatePosition(3, 4); // no cell → no-op
    expect(store.get()).toBeNull();

    store.set(cell());
    store.updatePosition(3, 4);
    expect(store.get()).toEqual(cell({ rowIndex: 3, sourceIndex: 4 }));
  });
});
