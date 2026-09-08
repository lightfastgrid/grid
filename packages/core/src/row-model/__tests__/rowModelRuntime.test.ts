import { describe, expect, it, vi } from "vitest";

import type { ColumnDef, RowData } from "../../types";
import { RowModelRuntime } from "../RowModelRuntime";

describe("RowModelRuntime", () => {
  it("onRowsChanged clears RowValueCache so valueGetter runs again", () => {
    const runtime = new RowModelRuntime();
    const getter = vi.fn(({ row }: { row: RowData }) => (row as { v: number }).v);
    const cols: ColumnDef[] = [
      { field: "v", sortable: true, valueGetter: getter },
    ];
    const rows: RowData[] = [{ v: 3 }, { v: 1 }, { v: 2 }];

    // First sort — valueGetter called once per row.
    runtime.computeSortedRowOrder(rows, [{ field: "v", sort: "asc" }], cols, 0);
    const callsAfterFirst = getter.mock.calls.length;
    expect(callsAfterFirst).toBe(3);

    // Same inputs — cache hit, no new calls.
    runtime.computeSortedRowOrder(rows, [{ field: "v", sort: "asc" }], cols, 0);
    expect(getter.mock.calls.length).toBe(callsAfterFirst);

    // Clear caches.
    runtime.onRowsChanged();

    // Sort again with same rows/epoch/column — valueGetter must run again.
    runtime.computeSortedRowOrder(rows, [{ field: "v", sort: "asc" }], cols, 0);
    expect(getter.mock.calls.length).toBe(callsAfterFirst + 3);
  });
});
