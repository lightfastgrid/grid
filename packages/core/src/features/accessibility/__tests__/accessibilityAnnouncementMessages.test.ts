import { describe, expect, it, vi } from "vitest";

import type {
  LightFastGridFilterChangedEvent,
  LightFastGridPaginationChangedEvent,
  LightFastGridRowDataUpdatedEvent,
  LightFastGridSelectionChangedEvent,
  LightFastGridSortChangedEvent,
} from "../../../types";
import {
  cellUpdatedAnnouncement,
  columnMovedAnnouncement,
  columnSelectionAnnouncement,
  columnVisibilityAnnouncement,
  filterAnnouncement,
  loadingAnnouncement,
  overlayPresentationAnnouncement,
  paginationAnnouncement,
  rowCountAnnouncement,
  rowDataAnnouncement,
  rowMovedAnnouncement,
  rowPinAnnouncement,
  rowSelectionAnnouncement,
  sortAnnouncement,
} from "../accessibilityAnnouncementMessages";

function selectionEvent(
  selectedCount: number,
): LightFastGridSelectionChangedEvent {
  return {
    selectionType: "explicit",
    selectedCount,
    selectedRowIds: [],
    changeKind: "api",
    changedRowIds: [],
    changedRows: [],
    source: "api",
    isRowSelected: () => false,
    getSelectedRowIds: vi.fn(() => {
      throw new Error("must stay lazy");
    }),
    getSelectedRows: vi.fn(() => {
      throw new Error("must stay lazy");
    }),
    forEachSelectedRow: vi.fn(() => {
      throw new Error("must stay lazy");
    }),
  };
}

describe("accessibility announcement messages", () => {
  it("formats loading, selection, sort, filter, and row-count statuses", () => {
    expect(loadingAnnouncement(true, 12)?.text).toBe("Loading.");
    expect(loadingAnnouncement(false, 12)?.text).toBe(
      "Loading complete. 12 rows.",
    );
    expect(rowSelectionAnnouncement(selectionEvent(0))?.text).toBe(
      "No rows selected.",
    );
    const selected = selectionEvent(2);
    expect(rowSelectionAnnouncement(selected)?.text).toBe(
      "2 rows selected.",
    );
    expect(selected.getSelectedRowIds).not.toHaveBeenCalled();
    expect(selected.getSelectedRows).not.toHaveBeenCalled();
    expect(selected.forEachSelectedRow).not.toHaveBeenCalled();

    expect(
      columnSelectionAnnouncement({
        selectedColumnIds: ["a"],
        changedColumnIds: ["a"],
        source: "keyboard",
      })?.text,
    ).toBe("1 column selected.");

    const sort: LightFastGridSortChangedEvent = {
      sortModel: [
        { field: "amount", sort: "desc" },
        { field: "name", sort: "asc" },
      ],
      source: "api",
    };
    expect(sortAnnouncement(sort, () => "Amount")?.text).toBe(
      "Sorted by 2 columns. Primary sort: Amount, descending.",
    );
    expect(
      sortAnnouncement(
        { sortModel: [], source: "api" },
        () => "unused",
      )?.text,
    ).toBe("Sorting cleared.");

    const filter: LightFastGridFilterChangedEvent = {
      filterModel: {},
      source: "api",
      activeFilterCount: 2,
      totalRows: 100,
      filteredRows: 7,
    };
    expect(filterAnnouncement(filter)?.text).toBe(
      "7 matching rows of 100. 2 filters active.",
    );
    expect(
      filterAnnouncement({ ...filter, activeFilterCount: 0 })?.text,
    ).toBe("Filters cleared. 7 rows available.");
    expect(rowCountAnnouncement(1)?.text).toBe("1 row available.");
    expect(
      overlayPresentationAnnouncement({
        kind: "noRows",
        text: "No employees",
      })?.text,
    ).toBe("No employees");
    expect(
      overlayPresentationAnnouncement({ kind: null, text: null }),
    ).toBeNull();
  });

  it("formats completed transactions, pagination, and bounded actions", () => {
    const update: LightFastGridRowDataUpdatedEvent = {
      source: "transaction",
      addCount: 2,
      updateCount: 1,
      removeCount: 3,
      skippedCount: 4,
      rowCount: 10,
    };
    expect(rowDataAnnouncement(update)?.text).toBe(
      "Row update completed. 2 added, 1 updated, 3 removed, 4 skipped. " +
        "10 rows available.",
    );

    const page: LightFastGridPaginationChangedEvent = {
      pageIndex: 1,
      pageSize: 10,
      pageCount: 5,
      totalRows: 42,
      startRow: 11,
      endRow: 20,
      source: "api",
    };
    expect(paginationAnnouncement(page)?.text).toBe(
      "Page 2 of 5. Rows 11 to 20 of 42.",
    );
    expect(
      paginationAnnouncement({
        ...page,
        pageIndex: 0,
        pageCount: 0,
        totalRows: 0,
        startRow: 0,
        endRow: 0,
      })?.text,
    ).toBe("No pages. No rows available.");

    expect(cellUpdatedAnnouncement("amount", () => "Amount").text).toBe(
      "Amount updated.",
    );
    expect(
      columnMovedAnnouncement(
        {
          columnOrder: ["name", "amount"],
          movedColumnId: "amount",
          fromIndex: 0,
          toIndex: 1,
          source: "drag",
        },
        () => "Amount",
      )?.text,
    ).toBe("Moved Amount to column 2 of 2.");
    expect(
      rowMovedAnnouncement(
        {
          rowId: "private-row-id",
          rowIds: ["private-row-id"],
          row: {},
          rows: [{}],
          fromIndex: 0,
          fromIndices: [0],
          toIndex: 2,
          source: "drag",
          getRowOrderIds: vi.fn(() => {
            throw new Error("must not scan");
          }),
          getRows: vi.fn(() => {
            throw new Error("must not scan");
          }),
        },
        10,
      )?.text,
    ).toBe("Row moved to position 3 of 10.");
    expect(
      rowPinAnnouncement({
        source: "api",
        rowPinState: [],
        changedRows: [
          {
            rowId: "private-row-id",
            pinned: "top",
            previousPinned: false,
          },
        ],
      })?.text,
    ).toBe("Row pinned to top.");
    expect(
      columnVisibilityAnnouncement(
        {
          source: "api",
          columnVisibilityState: [],
          changedColumns: [
            { field: "secret-field", visible: false, previousVisible: true },
          ],
        },
        () => "Status",
      )?.text,
    ).toBe("Status hidden.");
  });

  it("fails closed for malformed scalar counts", () => {
    expect(rowCountAnnouncement(Number.NaN)).toBeNull();
    expect(rowSelectionAnnouncement(selectionEvent(-1))).toBeNull();
    expect(
      paginationAnnouncement({
        pageIndex: 5,
        pageSize: 10,
        pageCount: 2,
        totalRows: 20,
        startRow: 1,
        endRow: 10,
        source: "api",
      }),
    ).toBeNull();
    expect(
      filterAnnouncement({
        filterModel: {},
        source: "api",
        activeFilterCount: 1,
        totalRows: Number.POSITIVE_INFINITY,
        filteredRows: 1,
      }),
    ).toBeNull();
  });
});
