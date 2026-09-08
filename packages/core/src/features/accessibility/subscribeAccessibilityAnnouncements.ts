import type { Grid } from "../../Grid";
import type { Unsubscribe } from "../../types";

import {
  type AccessibilityAnnouncement,
  cellUpdatedAnnouncement,
  columnMovedAnnouncement,
  columnPinAnnouncement,
  columnResizedAnnouncement,
  columnSelectionAnnouncement,
  columnVisibilityAnnouncement,
  CSV_EXPORT_CANCELLED_ANNOUNCEMENT,
  CSV_EXPORT_COMPLETED_ANNOUNCEMENT,
  CSV_EXPORT_ERROR_ANNOUNCEMENT,
  filterAnnouncement,
  loadingAnnouncement,
  overlayPresentationAnnouncement,
  paginationAnnouncement,
  quickSearchAnnouncement,
  rowCountAnnouncement,
  rowDataAnnouncement,
  rowMovedAnnouncement,
  rowPinAnnouncement,
  rowSelectionAnnouncement,
  sortAnnouncement,
} from "./accessibilityAnnouncementMessages";
import type { AccessibilityLiveRegion } from "./accessibilityLiveRegion";

export interface AccessibilityAnnouncementRead {
  isGridBusy(): boolean;
  getRowCount(): number;
  resolveColumnLabel(field: string): string;
}

function safeRead<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/**
 * Maps accepted low-frequency Grid domain events to one plugin-owned status
 * sink. Handlers use payload scalars only and never inspect rendered DOM.
 */
export function subscribeAccessibilityAnnouncements(
  grid: Grid,
  liveRegion: AccessibilityLiveRegion,
  read: AccessibilityAnnouncementRead,
): Unsubscribe {
  const unsubs: Unsubscribe[] = [];
  let gridBusy = safeRead(read.isGridBusy) ?? false;
  const publish = (
    announcement: AccessibilityAnnouncement | null,
  ): void => {
    if (announcement === null) return;
    try {
      liveRegion.request(announcement);
    } catch {
      // Status output must never replace the accepted domain action.
    }
  };
  const resolveColumnLabel = (field: string): string =>
    safeRead(() => read.resolveColumnLabel(field)) ?? field;

  unsubs.push(
    grid.on("overlay:changed", () => {
      const nextBusy = safeRead(read.isGridBusy);
      if (nextBusy === null || nextBusy === gridBusy) return;
      gridBusy = nextBusy;
      if (!nextBusy) {
        publish(
          loadingAnnouncement(
            false,
            safeRead(read.getRowCount) ?? Number.NaN,
          ),
        );
      }
    }),
    grid.on("overlay:presentation-changed", (event) =>
      publish(overlayPresentationAnnouncement(event)),
    ),
    grid.on("quick-search-pending:changed", ({ pending }) =>
      publish(quickSearchAnnouncement(pending)),
    ),
    grid.on("selection:changed", (event) =>
      publish(rowSelectionAnnouncement(event)),
    ),
    grid.on("column-selection:changed", (event) =>
      publish(columnSelectionAnnouncement(event)),
    ),
    grid.on("sort:changed", (event) =>
      publish(sortAnnouncement(event, resolveColumnLabel)),
    ),
    grid.on("filter:changed", (event) =>
      publish(filterAnnouncement(event)),
    ),
    grid.on("data:updated", ({ rowCount }) =>
      publish(rowCountAnnouncement(rowCount)),
    ),
    grid.on("row-data:updated", (event) =>
      publish(rowDataAnnouncement(event)),
    ),
    grid.on("pagination:changed", (event) =>
      publish(paginationAnnouncement(event)),
    ),
    grid.on("cell-value:changed", ({ columnId }) =>
      publish(cellUpdatedAnnouncement(columnId, resolveColumnLabel)),
    ),
    grid.on("column:resized", ({ field, width }) =>
      publish(columnResizedAnnouncement(field, width, resolveColumnLabel)),
    ),
    grid.on("column-order:changed", (event) =>
      publish(columnMovedAnnouncement(event, resolveColumnLabel)),
    ),
    grid.on("row-order:changed", (event) =>
      publish(
        rowMovedAnnouncement(
          event,
          safeRead(read.getRowCount) ?? Number.NaN,
        ),
      ),
    ),
    grid.on("column-pin:changed", (event) =>
      publish(columnPinAnnouncement(event, resolveColumnLabel)),
    ),
    grid.on("row-pin:changed", (event) =>
      publish(rowPinAnnouncement(event)),
    ),
    grid.on("column-visibility:changed", (event) =>
      publish(columnVisibilityAnnouncement(event, resolveColumnLabel)),
    ),
    grid.on("csv-export:completed", () =>
      publish(CSV_EXPORT_COMPLETED_ANNOUNCEMENT),
    ),
    grid.on("csv-export:cancelled", () =>
      publish(CSV_EXPORT_CANCELLED_ANNOUNCEMENT),
    ),
    grid.on("csv-export:error", () =>
      publish(CSV_EXPORT_ERROR_ANNOUNCEMENT),
    ),
  );

  return () => {
    for (const unsubscribe of unsubs) {
      try {
        unsubscribe();
      } catch {
        // Continue releasing every retained event subscription.
      }
    }
  };
}
