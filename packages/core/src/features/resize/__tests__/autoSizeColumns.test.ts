// @vitest-environment jsdom
//
// Unit tests for measureColumnAutoFitWidth + autosize eligibility +
// sizing menu contribution items + Grid integration.

import { describe, expect, it, vi } from "vitest";

import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import type { ColumnDef, RowData } from "../../../types";
import { isAutoSizeEligibleColumn } from "../autoSizeColumnEligibility";
import { measureColumnAutoFitWidth } from "../measureColumnAutoFit";
import { sizingMenuContribution } from "../sizingMenuContribution";

// ── measureColumnAutoFitWidth ─────────────────────────────────

describe("measureColumnAutoFitWidth", () => {
  const data: RowData[] = [
    { id: "r1", name: "Alice", amount: 100 },
    { id: "r2", name: "Bob Anderson", amount: 9999 },
    { id: "r3", name: "C", amount: 1 },
  ];

  it("measures visible rows only, not full dataset", () => {
    const col: ColumnDef = { field: "name" };
    // visibleRowStart=0, poolRowCount=2 → only rows 0 and 1
    const width = measureColumnAutoFitWidth(col, "name", 0, 2, data);
    expect(width).toBeGreaterThan(0);

    // With all 3 rows, width should be >= the 2-row window
    const widthAll = measureColumnAutoFitWidth(col, "name", 0, 3, data);
    expect(widthAll).toBeGreaterThanOrEqual(width);
  });

  it("returns clamped width respecting minWidth", () => {
    const col: ColumnDef = { field: "name", minWidth: 200 };
    const width = measureColumnAutoFitWidth(col, "name", 0, 1, data);
    expect(width).toBeGreaterThanOrEqual(200);
  });

  it("returns clamped width respecting maxWidth", () => {
    const col: ColumnDef = { field: "name", maxWidth: 50 };
    const width = measureColumnAutoFitWidth(col, "name", 0, 3, data);
    expect(width).toBeLessThanOrEqual(50);
  });

  it("handles empty data", () => {
    const col: ColumnDef = { field: "name" };
    const width = measureColumnAutoFitWidth(col, "name", 0, 0, []);
    // Should still measure the header text
    expect(width).toBeGreaterThan(0);
  });

  it("uses header text when no data rows visible", () => {
    const col: ColumnDef = { field: "name", headerName: "Full Name Column" };
    const width = measureColumnAutoFitWidth(col, "name", 0, 0, []);
    expect(width).toBeGreaterThan(28); // at least padding
  });

  it("resizes multiple columns independently", () => {
    const colName: ColumnDef = { field: "name" };
    const colAmount: ColumnDef = { field: "amount" };
    const wName = measureColumnAutoFitWidth(colName, "name", 0, 3, data);
    const wAmount = measureColumnAutoFitWidth(colAmount, "amount", 0, 3, data);
    // "Bob Anderson" is wider than "9999" — widths should differ
    expect(wName).not.toBe(wAmount);
  });

  it("samples display-order rows via DisplayRowReader", () => {
    // Source rows: short name first, long name second.
    // Display reader presents them in reversed (sorted) order.
    const sourceRows: RowData[] = [
      { id: "r1", name: "C" },
      { id: "r2", name: "Bob Anderson" },
    ];
    const sortedRows: RowData[] = [sourceRows[1]!, sourceRows[0]!];
    const reader = createArrayDisplayRowReader(sortedRows);

    const col: ColumnDef = { field: "name" };

    // Sample only first display row (Bob Anderson — the wide one).
    const widthOne = measureColumnAutoFitWidth(col, "name", 0, 1, reader);
    // Sample only second display row (C — short).
    const widthTwo = measureColumnAutoFitWidth(col, "name", 1, 1, reader);

    // First display row should be wider because it has "Bob Anderson".
    expect(widthOne).toBeGreaterThan(widthTwo);
  });

  it("DisplayRowReader and equivalent RowData[] produce identical widths", () => {
    const rows: RowData[] = [
      { id: "r1", name: "Alice" },
      { id: "r2", name: "Bob Anderson" },
    ];
    const reader = createArrayDisplayRowReader(rows);
    const col: ColumnDef = { field: "name" };

    const widthArray = measureColumnAutoFitWidth(col, "name", 0, 2, rows);
    const widthReader = measureColumnAutoFitWidth(col, "name", 0, 2, reader);

    expect(widthReader).toBe(widthArray);
  });
});

// ── Autosize eligibility (uses exported helper) ───────────────

describe("isAutoSizeEligibleColumn", () => {
  it("normal visible column is eligible", () => {
    expect(isAutoSizeEligibleColumn({ field: "a" })).toBe(true);
  });

  it("hidden column is not eligible", () => {
    expect(isAutoSizeEligibleColumn({ field: "a", visible: false })).toBe(false);
  });

  it("selection column is not eligible", () => {
    expect(isAutoSizeEligibleColumn({ field: "__lfg_selection__", internal: "selection" })).toBe(false);
  });

  it("row-drag column is not eligible", () => {
    expect(isAutoSizeEligibleColumn({ field: "__lfg_row_drag__", internal: "row-drag" })).toBe(false);
  });

  it("combined row-controls column is not eligible", () => {
    expect(isAutoSizeEligibleColumn({ field: "__lfg_row_controls__", internal: "row-controls" })).toBe(false);
  });

  it("action column is not eligible", () => {
    expect(isAutoSizeEligibleColumn({ field: "act", cellKind: "actions" })).toBe(false);
  });

  it("non-resizable column is not eligible", () => {
    expect(isAutoSizeEligibleColumn({ field: "a", resizable: false })).toBe(false);
  });

  it("pinned column IS eligible for autosize", () => {
    expect(isAutoSizeEligibleColumn({ field: "a", pinned: "left" })).toBe(true);
  });
});

// ── Sizing menu contribution for autosize ─────────────────────

describe("sizing menu items for autosize", () => {
  function makeCtx(field = "a") {
    return {
      field,
      column: { field } as ColumnDef,
      columns: [{ field: "a" }, { field: "b" }] as ColumnDef[],
      sortModel: [],
      selectedColumnIds: [] as string[],
      close: vi.fn(),
    };
  }

  it("auto-size this column calls autoSizeColumn with field and 'ui'", () => {
    const autoSizeColumn = vi.fn();
    const contrib = sizingMenuContribution({
      autoSizeColumn,
      getOptions: () => ({ sizing: { autoSizeColumn: true } }),
    });
    const ctx = makeCtx("name");
    const sections = contrib.getSections(ctx);
    const item = sections[0]?.items.find((i) => i.id === "auto-size-column");
    expect(item).toBeDefined();
    expect(item!.label).toBe("Auto-size this column");
    item!.action!();
    expect(autoSizeColumn).toHaveBeenCalledWith("name", "ui");
    expect(ctx.close).toHaveBeenCalled();
  });

  it("auto-size selected columns calls autoSizeSelectedColumns with 'ui'", () => {
    const autoSizeSelectedColumns = vi.fn();
    const contrib = sizingMenuContribution({
      autoSizeSelectedColumns,
      getOptions: () => ({ sizing: { autoSizeSelectedColumns: true } }),
    });
    const ctx = makeCtx();
    ctx.selectedColumnIds = ["a", "b"]; // columns are selected
    const sections = contrib.getSections(ctx);
    const item = sections[0]?.items.find((i) => i.id === "auto-size-selected-columns");
    expect(item).toBeDefined();
    item!.action!();
    expect(autoSizeSelectedColumns).toHaveBeenCalledWith("ui");
    expect(ctx.close).toHaveBeenCalled();
  });

  it("auto-size selected columns is hidden when no columns are selected", () => {
    const autoSizeSelectedColumns = vi.fn();
    const contrib = sizingMenuContribution({
      autoSizeSelectedColumns,
      getOptions: () => ({ sizing: { autoSizeSelectedColumns: true } }),
    });
    const ctx = makeCtx();
    ctx.selectedColumnIds = []; // no selection
    const sections = contrib.getSections(ctx);
    const item = sections[0]?.items.find((i) => i.id === "auto-size-selected-columns");
    expect(item).toBeUndefined();
  });

  it("reset column widths calls resetColumnWidths with 'ui'", () => {
    const resetColumnWidths = vi.fn();
    const contrib = sizingMenuContribution({
      resetColumnWidths,
      getOptions: () => ({ sizing: { resetColumnWidths: true } }),
    });
    const ctx = makeCtx();
    const sections = contrib.getSections(ctx);
    const item = sections[0]?.items.find((i) => i.id === "reset-column-widths");
    expect(item).toBeDefined();
    item!.action!();
    expect(resetColumnWidths).toHaveBeenCalledWith("ui");
    expect(ctx.close).toHaveBeenCalled();
  });

  it("omitted sizing options produce no items", () => {
    const contrib = sizingMenuContribution({
      getOptions: () => ({ enabled: true, sort: true }),
    });
    const sections = contrib.getSections(makeCtx());
    expect(sections).toHaveLength(0);
  });

  it("all five items appear when all sizing options are enabled and columns selected", () => {
    const contrib = sizingMenuContribution({
      sizeColumnsToFit: vi.fn(),
      sizeSelectedColumnsToFit: vi.fn(),
      resetColumnWidths: vi.fn(),
      autoSizeColumn: vi.fn(),
      autoSizeSelectedColumns: vi.fn(),
      getOptions: () => ({
        sizing: {
          sizeColumnsToFit: true,
          sizeSelectedColumnsToFit: true,
          resetColumnWidths: true,
          autoSizeColumn: true,
          autoSizeSelectedColumns: true,
        },
      }),
    });
    const ctx = makeCtx();
    ctx.selectedColumnIds = ["a"];
    const sections = contrib.getSections(ctx);
    // Reset is its own section so the panel renders a divider before it.
    expect(sections).toHaveLength(2);
    expect(sections[0]!.id).toBe("sizing");
    expect(sections[1]!.id).toBe("sizing-reset");
    const ids = sections.flatMap((section) => section.items.map((i) => i.id));
    expect(ids).toContain("auto-size-column");
    expect(ids).toContain("auto-size-selected-columns");
    expect(ids).toContain("size-columns-to-fit");
    expect(ids).toContain("size-selected-columns-to-fit");
    expect(ids).toContain("reset-column-widths");
  });
});

// ── Grid integration ──────────────────────────────────────────

import { Grid } from "../../../Grid";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

describe("Grid autosize integration", () => {
  function mountGrid(columns: ColumnDef[], data: RowData[]) {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "300px", width: "600px" });
    document.body.appendChild(container);

    const onResized = vi.fn();
    const grid = new Grid({
      rows: data,
      columns: columns.map((c) => ({ ...c })), // shallow copy to avoid mutation
      getRowId: (row) => String((row as Record<string, unknown>).id),
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      columnSelection: { mode: "multiple" },
    });
    grid.on("column:resized", onResized);
    grid.mount(container);

    return { grid, container, onResized };
  }

  it("autoSizeColumn changes only the specified column", async () => {
    const data: RowData[] = [
      { id: "1", name: "Alice", country: "United States of America" },
    ];
    const { grid, container, onResized } = mountGrid(
      [
        { field: "name", width: 300 },
        { field: "country", width: 300 },
      ],
      data,
    );
    await flushRenders();

    grid.autoSizeColumn("name", "api");
    await flushRenders();

    const resizedFields = onResized.mock.calls.map(
      ([e]: [{ field: string }]) => e.field,
    );
    expect(resizedFields).toContain("name");
    expect(resizedFields).not.toContain("country");

    grid.destroy();
    container.remove();
  });

  it("autoSizeColumns changes multiple columns independently", async () => {
    const data: RowData[] = [
      { id: "1", name: "Alice", country: "UK", amount: 42 },
    ];
    const { grid, container, onResized } = mountGrid(
      [
        { field: "name", width: 500 },
        { field: "country", width: 500 },
        { field: "amount", width: 500 },
      ],
      data,
    );
    await flushRenders();

    grid.autoSizeColumns(["name", "country"], "api");
    await flushRenders();

    const resizedFields = onResized.mock.calls.map(
      ([e]: [{ field: string }]) => e.field,
    );
    expect(resizedFields).toContain("name");
    expect(resizedFields).toContain("country");
    expect(resizedFields).not.toContain("amount");

    grid.destroy();
    container.remove();
  });

  it("autoSizeSelectedColumns only changes selected columns", async () => {
    const data: RowData[] = [
      { id: "1", name: "Alice", country: "Germany" },
    ];
    const { grid, container, onResized } = mountGrid(
      [
        { field: "name", width: 500 },
        { field: "country", width: 500 },
      ],
      data,
    );
    await flushRenders();

    grid.setSelectedColumnIds(["name"]);
    await flushRenders();
    onResized.mockClear();

    grid.autoSizeSelectedColumns("api");
    await flushRenders();

    const resizedFields = onResized.mock.calls.map(
      ([e]: [{ field: string }]) => e.field,
    );
    expect(resizedFields).toContain("name");
    expect(resizedFields).not.toContain("country");

    grid.destroy();
    container.remove();
  });

  it("skips hidden, action, internal selection, and non-resizable columns", async () => {
    const data: RowData[] = [
      { id: "1", name: "Alice", locked: "X", secret: "Y" },
    ];
    const { grid, container, onResized } = mountGrid(
      [
        { field: "__lfg_selection__", internal: "selection", width: 44 },
        { field: "name", width: 500 },
        { field: "locked", width: 500, resizable: false },
        { field: "secret", width: 500, visible: false },
        { field: "actions", width: 44, cellKind: "actions", actionsKey: "rowActions" },
      ],
      data,
    );
    await flushRenders();

    // Request autosize for all fields including ineligible ones.
    grid.autoSizeColumns(
      ["__lfg_selection__", "name", "locked", "secret", "actions"],
      "api",
    );
    await flushRenders();

    const resizedFields = onResized.mock.calls.map(
      ([e]: [{ field: string }]) => e.field,
    );
    // Only "name" is eligible — visible, resizable, not action/internal.
    expect(resizedFields).toContain("name");
    expect(resizedFields).not.toContain("__lfg_selection__");
    expect(resizedFields).not.toContain("locked");
    expect(resizedFields).not.toContain("secret");
    expect(resizedFields).not.toContain("actions");

    grid.destroy();
    container.remove();
  });
});
