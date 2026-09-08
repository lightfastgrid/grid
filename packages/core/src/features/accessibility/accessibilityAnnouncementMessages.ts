import type {
  LightFastGridColumnOrderChangedEvent,
  LightFastGridColumnPinChangedEvent,
  LightFastGridColumnSelectionChangedEvent,
  LightFastGridColumnVisibilityChangedEvent,
  LightFastGridFilterChangedEvent,
  LightFastGridOverlayPresentationChangedEvent,
  LightFastGridPaginationChangedEvent,
  LightFastGridRowDataUpdatedEvent,
  LightFastGridRowOrderChangedEvent,
  LightFastGridRowPinChangedEvent,
  LightFastGridSelectionChangedEvent,
  LightFastGridSortChangedEvent,
} from "../../types";

export type AccessibilityAnnouncementPriority = "ordinary" | "error";

export interface AccessibilityAnnouncement {
  readonly text: string;
  readonly priority: AccessibilityAnnouncementPriority;
}

const ORDINARY = "ordinary" as const;
const ERROR = "error" as const;
const MAX_ANNOUNCED_COLUMN_LABEL_LENGTH = 120;

function safeCount(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function normalizeFieldLabel(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return "Column";
  return trimmed.length <= MAX_ANNOUNCED_COLUMN_LABEL_LENGTH
    ? trimmed
    : trimmed.slice(0, MAX_ANNOUNCED_COLUMN_LABEL_LENGTH);
}

function ordinary(text: string): AccessibilityAnnouncement {
  return { text, priority: ORDINARY };
}

export function overlayPresentationAnnouncement(
  event: LightFastGridOverlayPresentationChangedEvent,
): AccessibilityAnnouncement | null {
  if (event.kind === null || typeof event.text !== "string") return null;
  return ordinary(event.text);
}

export function loadingAnnouncement(
  loading: boolean,
  rowCount: number,
): AccessibilityAnnouncement | null {
  if (loading) return ordinary("Loading.");
  const count = safeCount(rowCount);
  return count === null
    ? ordinary("Loading complete.")
    : ordinary(`Loading complete. ${countLabel(count, "row", "rows")}.`);
}

export function quickSearchAnnouncement(
  pending: boolean,
): AccessibilityAnnouncement {
  return ordinary(pending ? "Searching." : "Search completed.");
}

export function rowSelectionAnnouncement(
  event: LightFastGridSelectionChangedEvent,
): AccessibilityAnnouncement | null {
  const count = safeCount(event.selectedCount);
  if (count === null) return null;
  return ordinary(
    count === 0
      ? "No rows selected."
      : `${countLabel(count, "row", "rows")} selected.`,
  );
}

export function columnSelectionAnnouncement(
  event: LightFastGridColumnSelectionChangedEvent,
): AccessibilityAnnouncement | null {
  const count = safeCount(event.selectedColumnIds.length);
  if (count === null) return null;
  return ordinary(
    count === 0
      ? "No columns selected."
      : `${countLabel(count, "column", "columns")} selected.`,
  );
}

export function sortAnnouncement(
  event: LightFastGridSortChangedEvent,
  resolveColumnLabel: (field: string) => string,
): AccessibilityAnnouncement | null {
  const count = safeCount(event.sortModel.length);
  if (count === null) return null;
  if (count === 0) return ordinary("Sorting cleared.");
  const primary = event.sortModel[0];
  if (primary === undefined) return null;
  const label = normalizeFieldLabel(resolveColumnLabel(primary.field));
  const direction =
    primary.sort === "asc" ? "ascending" : "descending";
  return ordinary(
    count === 1
      ? `Sorted by ${label}, ${direction}.`
      : `Sorted by ${count} columns. Primary sort: ${label}, ${direction}.`,
  );
}

export function filterAnnouncement(
  event: LightFastGridFilterChangedEvent,
): AccessibilityAnnouncement | null {
  const active = safeCount(event.activeFilterCount);
  const total = safeCount(event.totalRows);
  const filtered = safeCount(event.filteredRows);
  if (active === null || total === null || filtered === null) return null;
  if (active === 0) {
    return ordinary(
      `Filters cleared. ${countLabel(filtered, "row", "rows")} available.`,
    );
  }
  return ordinary(
    `${countLabel(filtered, "matching row", "matching rows")} of ${total}. ` +
      `${countLabel(active, "filter", "filters")} active.`,
  );
}

export function rowCountAnnouncement(
  rowCount: number,
): AccessibilityAnnouncement | null {
  const count = safeCount(rowCount);
  return count === null
    ? null
    : ordinary(`${countLabel(count, "row", "rows")} available.`);
}

export function rowDataAnnouncement(
  event: LightFastGridRowDataUpdatedEvent,
): AccessibilityAnnouncement | null {
  const added = safeCount(event.addCount);
  const updated = safeCount(event.updateCount);
  const removed = safeCount(event.removeCount);
  const skipped = safeCount(event.skippedCount);
  const rows = safeCount(event.rowCount);
  if (
    added === null ||
    updated === null ||
    removed === null ||
    skipped === null ||
    rows === null
  ) {
    return null;
  }
  return ordinary(
    `Row update completed. ${added} added, ${updated} updated, ` +
      `${removed} removed, ${skipped} skipped. ` +
      `${countLabel(rows, "row", "rows")} available.`,
  );
}

export function paginationAnnouncement(
  event: LightFastGridPaginationChangedEvent,
): AccessibilityAnnouncement | null {
  const pageIndex = safeCount(event.pageIndex);
  const pageCount = safeCount(event.pageCount);
  const totalRows = safeCount(event.totalRows);
  const startRow = safeCount(event.startRow);
  const endRow = safeCount(event.endRow);
  if (
    pageIndex === null ||
    pageCount === null ||
    totalRows === null ||
    startRow === null ||
    endRow === null
  ) {
    return null;
  }
  if (pageCount === 0) return ordinary("No pages. No rows available.");
  if (pageIndex >= pageCount || startRow > endRow || endRow > totalRows) {
    return null;
  }
  return ordinary(
    `Page ${pageIndex + 1} of ${pageCount}. ` +
      `Rows ${startRow} to ${endRow} of ${totalRows}.`,
  );
}

export function cellUpdatedAnnouncement(
  field: string | undefined,
  resolveColumnLabel: (field: string) => string,
): AccessibilityAnnouncement {
  return field === undefined || field.trim().length === 0
    ? ordinary("Cell updated.")
    : ordinary(`${normalizeFieldLabel(resolveColumnLabel(field))} updated.`);
}

export function columnResizedAnnouncement(
  field: string,
  width: number,
  resolveColumnLabel: (field: string) => string,
): AccessibilityAnnouncement | null {
  if (!Number.isFinite(width) || width < 0) return null;
  return ordinary(
    `Resized ${normalizeFieldLabel(resolveColumnLabel(field))} to ${width} pixels.`,
  );
}

export function columnMovedAnnouncement(
  event: LightFastGridColumnOrderChangedEvent,
  resolveColumnLabel: (field: string) => string,
): AccessibilityAnnouncement | null {
  const position = safeCount(event.toIndex);
  const total = safeCount(event.columnOrder.length);
  if (position === null || total === null || position >= total) return null;
  return ordinary(
    `Moved ${normalizeFieldLabel(resolveColumnLabel(event.movedColumnId))} ` +
      `to column ${position + 1} of ${total}.`,
  );
}

export function rowMovedAnnouncement(
  event: LightFastGridRowOrderChangedEvent,
  totalRows: number,
): AccessibilityAnnouncement | null {
  const position = safeCount(event.toIndex);
  const total = safeCount(totalRows);
  if (position === null || total === null || position >= total) return null;
  return ordinary(`Row moved to position ${position + 1} of ${total}.`);
}

export function columnPinAnnouncement(
  event: LightFastGridColumnPinChangedEvent,
  resolveColumnLabel: (field: string) => string,
): AccessibilityAnnouncement | null {
  const changes = event.changedColumns;
  if (changes !== undefined && changes.length > 1) {
    return ordinary(
      `Column pinning updated for ${countLabel(changes.length, "column", "columns")}.`,
    );
  }
  const label = normalizeFieldLabel(resolveColumnLabel(event.field));
  return ordinary(
    event.pinned === false
      ? `Unpinned ${label}.`
      : `Pinned ${label} ${event.pinned}.`,
  );
}

export function rowPinAnnouncement(
  event: LightFastGridRowPinChangedEvent,
): AccessibilityAnnouncement | null {
  const count = safeCount(event.changedRows.length);
  if (count === null || count === 0) return null;
  if (count > 1) {
    return ordinary(
      `Row pinning updated for ${countLabel(count, "row", "rows")}.`,
    );
  }
  const change = event.changedRows[0];
  if (change === undefined) return null;
  return ordinary(
    change.pinned === false
      ? "Row unpinned."
      : `Row pinned to ${change.pinned}.`,
  );
}

export function columnVisibilityAnnouncement(
  event: LightFastGridColumnVisibilityChangedEvent,
  resolveColumnLabel: (field: string) => string,
): AccessibilityAnnouncement | null {
  const count = safeCount(event.changedColumns.length);
  if (count === null || count === 0) return null;
  if (count > 1) {
    return ordinary(
      `Column visibility updated for ${countLabel(count, "column", "columns")}.`,
    );
  }
  const change = event.changedColumns[0];
  if (change === undefined) return null;
  return ordinary(
    `${normalizeFieldLabel(resolveColumnLabel(change.field))} ` +
      `${change.visible ? "shown" : "hidden"}.`,
  );
}

export const CSV_EXPORT_COMPLETED_ANNOUNCEMENT: AccessibilityAnnouncement =
  Object.freeze({
    text: "CSV export completed.",
    priority: ORDINARY,
  });

export const CSV_EXPORT_CANCELLED_ANNOUNCEMENT: AccessibilityAnnouncement =
  Object.freeze({
    text: "CSV export cancelled.",
    priority: ORDINARY,
  });

export const CSV_EXPORT_ERROR_ANNOUNCEMENT: AccessibilityAnnouncement =
  Object.freeze({
    text: "CSV export failed.",
    priority: ERROR,
  });
