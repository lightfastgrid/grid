import { describe, expect, it, vi } from "vitest";

import type { GridEventMap } from "../../../events/GridEventMap";
import { Grid } from "../../../Grid";
import {
  ACCESSIBILITY_DIRTY_ACTIVE_DESCENDANT,
  ACCESSIBILITY_DIRTY_HEADER_MENU,
  ACCESSIBILITY_DIRTY_HEADER_SELECTION,
  ACCESSIBILITY_DIRTY_HEADER_SORT,
  ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY,
  ACCESSIBILITY_DIRTY_ROOT,
  ACCESSIBILITY_DIRTY_ROW_POSITION,
  ACCESSIBILITY_DIRTY_ROW_STRUCTURE,
} from "../AccessibilityController";
import { subscribeAccessibilityUpdates } from "../subscribeAccessibilityUpdates";

describe("subscribeAccessibilityUpdates", () => {
  it("routes low-frequency domain events to precise dirty scopes", () => {
    const handlers = new Map<string, (detail: never) => void>();
    const grid = Object.create(Grid.prototype);
    Reflect.set(
      grid,
      "on",
      vi.fn((event: keyof GridEventMap, handler: (detail: never) => void) => {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      }),
    );
    const request = vi.fn();
    const onFocusedCellChanged = vi.fn();
    const unsubscribe = subscribeAccessibilityUpdates(
      grid,
      request,
      onFocusedCellChanged,
    );

    handlers.get("selection:changed")?.(undefined as never);
    expect(request).toHaveBeenLastCalledWith(
      ACCESSIBILITY_DIRTY_ROW_POSITION,
    );

    handlers.get("column-selection:changed")?.(undefined as never);
    expect(request).toHaveBeenLastCalledWith(
      ACCESSIBILITY_DIRTY_ROW_POSITION |
        ACCESSIBILITY_DIRTY_HEADER_SELECTION,
    );

    Reflect.apply(
      handlers.get("focused-cell:changed")!,
      undefined,
      [{ focusedCell: null }],
    );
    expect(onFocusedCellChanged).toHaveBeenCalledWith(null);
    expect(request).toHaveBeenLastCalledWith(
      ACCESSIBILITY_DIRTY_ACTIVE_DESCENDANT,
    );

    Reflect.apply(
      handlers.get("grid:configuration-changed")!,
      undefined,
      [{ property: "defaultColDef" }],
    );
    expect(request).toHaveBeenLastCalledWith(
      ACCESSIBILITY_DIRTY_ROOT |
        ACCESSIBILITY_DIRTY_ROW_STRUCTURE |
        ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY,
    );

    Reflect.apply(
      handlers.get("grid:configuration-changed")!,
      undefined,
      [{ property: "floatingFilters" }],
    );
    expect(request).toHaveBeenLastCalledWith(
      ACCESSIBILITY_DIRTY_ROOT |
        ACCESSIBILITY_DIRTY_ROW_STRUCTURE |
        ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY,
    );

    Reflect.apply(
      handlers.get("grid:configuration-changed")!,
      undefined,
      [{ property: "columnGroupHeaders" }],
    );
    expect(request).toHaveBeenLastCalledWith(
      ACCESSIBILITY_DIRTY_ROOT |
        ACCESSIBILITY_DIRTY_ROW_STRUCTURE |
        ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY,
    );

    Reflect.apply(
      handlers.get("grid:configuration-changed")!,
      undefined,
      [{ property: "columnSelection" }],
    );
    expect(request).toHaveBeenLastCalledWith(
      ACCESSIBILITY_DIRTY_ROOT |
        ACCESSIBILITY_DIRTY_ROW_POSITION |
        ACCESSIBILITY_DIRTY_HEADER_SELECTION,
    );

    handlers.get("sort:changed")?.(undefined as never);
    expect(request).toHaveBeenLastCalledWith(
      ACCESSIBILITY_DIRTY_ROW_POSITION | ACCESSIBILITY_DIRTY_HEADER_SORT,
    );

    handlers.get("columns:updated")?.(undefined as never);
    expect(request).toHaveBeenLastCalledWith(
      ACCESSIBILITY_DIRTY_ROOT |
        ACCESSIBILITY_DIRTY_ROW_STRUCTURE |
        ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY,
    );

    handlers.get("column-menu:changed")?.(undefined as never);
    expect(request).toHaveBeenLastCalledWith(
      ACCESSIBILITY_DIRTY_HEADER_MENU,
      true,
    );

    handlers.get("overlay:changed")?.(undefined as never);
    expect(request).toHaveBeenLastCalledWith(
      ACCESSIBILITY_DIRTY_ROOT,
      true,
    );

    expect(handlers.has("surface:changed")).toBe(false);
    unsubscribe();
    expect(handlers.size).toBe(0);
  });
});
