import type { GridEventMap } from "../../events/GridEventMap";
import type { Grid } from "../../Grid";
import type { Unsubscribe } from "../../types";

import {
  ACCESSIBILITY_DIRTY_ACTIVE_DESCENDANT,
  ACCESSIBILITY_DIRTY_ALL,
  ACCESSIBILITY_DIRTY_HEADER_MENU,
  ACCESSIBILITY_DIRTY_HEADER_SELECTION,
  ACCESSIBILITY_DIRTY_HEADER_SORT,
  ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY,
  ACCESSIBILITY_DIRTY_ROOT,
  ACCESSIBILITY_DIRTY_ROW_POSITION,
  ACCESSIBILITY_DIRTY_ROW_STRUCTURE,
  type AccessibilityDirtyScope,
} from "./AccessibilityController";

const ROW_STRUCTURE_EVENTS = [
  "data:updated",
  "pagination:changed",
  "row-data:updated",
  "row-order:changed",
  "filter:changed",
  "quick-filter:changed",
  "row-pin:changed",
  "async-transactions:flushed",
] as const satisfies readonly (keyof GridEventMap)[];

const COLUMN_TOPOLOGY_EVENTS = [
  "columns:updated",
  "column-order:changed",
  "column-pin:changed",
  "column-visibility:changed",
] as const satisfies readonly (keyof GridEventMap)[];

export type AccessibilityUpdateRequest = (
  scopes: AccessibilityDirtyScope,
  immediate?: boolean,
) => void;

/**
 * Low-frequency domain-event subscriptions. Viewport scrolling is deliberately
 * absent: the accessibility controller observes its viewport directly.
 */
export function subscribeAccessibilityUpdates(
  grid: Grid,
  request: AccessibilityUpdateRequest,
  onFocusedCellChanged?: (
    focusedCell: GridEventMap["focused-cell:changed"]["focusedCell"],
  ) => void,
): Unsubscribe {
  const unsubs: Unsubscribe[] = [];
  const requestRows = (): void =>
    request(ACCESSIBILITY_DIRTY_ROOT | ACCESSIBILITY_DIRTY_ROW_STRUCTURE);
  const requestColumns = (): void =>
    request(
      ACCESSIBILITY_DIRTY_ROOT |
        ACCESSIBILITY_DIRTY_ROW_STRUCTURE |
        ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY,
    );

  unsubs.push(grid.on("grid:mounted", () => request(ACCESSIBILITY_DIRTY_ALL)));
  for (const event of ROW_STRUCTURE_EVENTS) {
    unsubs.push(grid.on(event, requestRows));
  }
  for (const event of COLUMN_TOPOLOGY_EVENTS) {
    unsubs.push(grid.on(event, requestColumns));
  }
  unsubs.push(
    grid.on("grid:configuration-changed", ({ property }) => {
      if (property === "accessibility") {
        request(ACCESSIBILITY_DIRTY_ROOT);
        return;
      }
      if (property === "defaultColDef") {
        request(
          ACCESSIBILITY_DIRTY_ROOT |
            ACCESSIBILITY_DIRTY_ROW_STRUCTURE |
            ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY,
        );
        return;
      }
      if (
        property === "floatingFilters" ||
        property === "columnGroupHeaders"
      ) {
        request(
          ACCESSIBILITY_DIRTY_ROOT |
            ACCESSIBILITY_DIRTY_ROW_STRUCTURE |
            ACCESSIBILITY_DIRTY_HEADER_TOPOLOGY,
        );
        return;
      }
      request(
        property === "rowSelection"
          ? ACCESSIBILITY_DIRTY_ROOT | ACCESSIBILITY_DIRTY_ROW_POSITION
          : ACCESSIBILITY_DIRTY_ROOT |
              ACCESSIBILITY_DIRTY_ROW_POSITION |
              ACCESSIBILITY_DIRTY_HEADER_SELECTION,
      );
    }),
    grid.on("overlay:changed", () =>
      request(ACCESSIBILITY_DIRTY_ROOT, true),
    ),
    grid.on("selection:changed", () =>
      request(ACCESSIBILITY_DIRTY_ROW_POSITION),
    ),
    grid.on("column-selection:changed", () =>
      request(
        ACCESSIBILITY_DIRTY_ROW_POSITION |
          ACCESSIBILITY_DIRTY_HEADER_SELECTION,
      ),
    ),
    grid.on("focused-cell:changed", ({ focusedCell }) => {
      onFocusedCellChanged?.(focusedCell);
      request(ACCESSIBILITY_DIRTY_ACTIVE_DESCENDANT);
    }),
    grid.on("sort:changed", () =>
      request(
        ACCESSIBILITY_DIRTY_ROW_POSITION | ACCESSIBILITY_DIRTY_HEADER_SORT,
      ),
    ),
    grid.on("column-menu:changed", () =>
      request(ACCESSIBILITY_DIRTY_HEADER_MENU, true),
    ),
  );

  return () => {
    for (const unsubscribe of unsubs) {
      unsubscribe();
    }
  };
}
