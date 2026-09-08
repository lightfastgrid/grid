import { describe, expect, it, vi } from "vitest";

import type { ColumnDef } from "../../../types";
import { ColumnOrderController } from "../ColumnOrderController";
import { ColumnOrderStore } from "../ColumnOrderStore";

describe("ColumnOrderController keyboard command", () => {
  it("179: accepts one same-lane visual step and defers store/event work", async () => {
    const columns: ColumnDef[] = [
      { field: "left", pinned: "left" },
      { field: "a", pinned: false },
      { field: "b" },
      { field: "right", pinned: "right" },
    ];
    const store = new ColumnOrderStore();
    store.syncColumns(columns);
    const requestColumnTransformSync = vi.fn();
    const onColumnOrderChanged = vi.fn();
    const controller = new ColumnOrderController({
      getColumnOrderConfig: () => ({ enabled: true }),
      getColumns: () => columns,
      getHeaderRowEl: () => null,
      getSelectedColumnIdsForColumnOrder: () => [],
      requestColumnTransformSync,
      onColumnOrderChanged,
      store,
    });
    controller.syncCommandColumns(columns);

    expect(controller.moveColumnFromCommand("a", 1)).toBe(true);
    expect(controller.moveColumnFromCommand("left", 1)).toBe(false);
    expect(controller.moveColumnFromCommand("right", -1)).toBe(false);
    expect(requestColumnTransformSync).not.toHaveBeenCalled();
    expect(onColumnOrderChanged).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(store.applyOrder(columns).map((column) => column.field)).toEqual([
      "left",
      "b",
      "a",
      "right",
    ]);
    expect(requestColumnTransformSync).toHaveBeenCalledOnce();
    expect(onColumnOrderChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        movedColumnId: "a",
        source: "keyboard",
      }),
    );
  });
});
