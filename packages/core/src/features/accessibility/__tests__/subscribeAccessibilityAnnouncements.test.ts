import { describe, expect, it, vi } from "vitest";

import type { GridEventMap } from "../../../events/GridEventMap";
import { Grid } from "../../../Grid";
import { AccessibilityLiveRegion } from "../accessibilityLiveRegion";
import { subscribeAccessibilityAnnouncements } from "../subscribeAccessibilityAnnouncements";

describe("subscribeAccessibilityAnnouncements", () => {
  it("maps accepted domain events without lazy row access or error disclosure", () => {
    const handlers = new Map<keyof GridEventMap, (detail: never) => void>();
    const grid = Object.create(Grid.prototype);
    Reflect.set(
      grid,
      "on",
      vi.fn(
        (
          event: keyof GridEventMap,
          handler: (detail: never) => void,
        ) => {
          handlers.set(event, handler);
          return () => handlers.delete(event);
        },
      ),
    );
    const liveRegion = new AccessibilityLiveRegion();
    const request = vi.spyOn(liveRegion, "request");
    let busy = false;
    const unsubscribe = subscribeAccessibilityAnnouncements(
      grid,
      liveRegion,
      {
        isGridBusy: () => busy,
        getRowCount: () => 50,
        resolveColumnLabel: (field) =>
          field === "amount" ? "Amount" : field,
      },
    );

    const lazy = vi.fn(() => {
      throw new Error("must stay lazy");
    });
    Reflect.apply(handlers.get("selection:changed")!, undefined, [
      {
        selectionType: "explicit",
        selectedCount: 3,
        selectedRowIds: ["private"],
        changeKind: "api",
        changedRowIds: [],
        changedRows: [],
        source: "api",
        isRowSelected: () => false,
        getSelectedRowIds: lazy,
        getSelectedRows: lazy,
        forEachSelectedRow: lazy,
      },
    ]);
    expect(request).toHaveBeenLastCalledWith({
      text: "3 rows selected.",
      priority: "ordinary",
    });
    expect(lazy).not.toHaveBeenCalled();

    Reflect.apply(handlers.get("sort:changed")!, undefined, [
      {
        sortModel: [{ field: "amount", sort: "asc" }],
        source: "api",
      },
    ]);
    expect(request).toHaveBeenLastCalledWith({
      text: "Sorted by Amount, ascending.",
      priority: "ordinary",
    });

    busy = true;
    Reflect.apply(handlers.get("overlay:changed")!, undefined, [{}]);
    expect(request).toHaveBeenCalledTimes(2);
    Reflect.apply(
      handlers.get("overlay:presentation-changed")!,
      undefined,
      [{ kind: "loading", text: "Fetching employees" }],
    );
    expect(request).toHaveBeenLastCalledWith({
      text: "Fetching employees",
      priority: "ordinary",
    });
    Reflect.apply(handlers.get("overlay:changed")!, undefined, [{}]);
    expect(request).toHaveBeenCalledTimes(3);
    busy = false;
    Reflect.apply(handlers.get("overlay:changed")!, undefined, [{}]);
    expect(request).toHaveBeenLastCalledWith({
      text: "Loading complete. 50 rows.",
      priority: "ordinary",
    });
    Reflect.apply(
      handlers.get("overlay:presentation-changed")!,
      undefined,
      [{ kind: "noRows", text: "No employees" }],
    );
    expect(request).toHaveBeenLastCalledWith({
      text: "No employees",
      priority: "ordinary",
    });

    const errorPayload = { taskId: 1 } as {
      taskId: number;
      error?: unknown;
    };
    Object.defineProperty(errorPayload, "error", {
      get() {
        throw new Error("must not inspect");
      },
    });
    Reflect.apply(handlers.get("csv-export:error")!, undefined, [
      errorPayload,
    ]);
    expect(request).toHaveBeenLastCalledWith({
      text: "CSV export failed.",
      priority: "error",
    });

    expect(handlers.has("focused-cell:changed")).toBe(false);
    expect(handlers.has("column-menu:changed")).toBe(false);
    expect(handlers.has("csv-export:progress")).toBe(false);
    expect(handlers.has("quick-filter:changed")).toBe(false);
    unsubscribe();
    expect(handlers.size).toBe(0);
  });
});
