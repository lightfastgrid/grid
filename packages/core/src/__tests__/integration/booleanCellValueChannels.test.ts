import { describe, expect, it, vi } from "vitest";

import { resolveCsvCellValue } from "../../features/csv-export/resolveCsvCellValue";
import { executeFilterMainThread } from "../../features/filters/executeFilterMainThread";
import type { NormalizedColumnFilterConfig } from "../../features/filters/types";
import { defaultNormalizer } from "../../features/quick-search/normalizer";
import { buildNormalizedRowAggregateText } from "../../features/quick-search/rowAggregateText";
import { resolveTooltip } from "../../features/tooltips/tooltipResolver";
import { Grid } from "../../Grid";
import type { ColumnDef, RowData } from "../../types";
import { applySortModel } from "../../utils/sortModel";

const ASSET_URL = "https://cdn.example.test/assets/checked.svg";

function column(): ColumnDef {
  return {
    field: "active",
    headerName: "Active",
    sortable: true,
    filter: "boolean",
    tooltip: true,
    valueFormatter: ({ value }) => (value === true ? "Enabled" : "Disabled"),
    cellShell: {
      kind: "image",
      image: {
        src: {
          from: "value",
          map: { true: ASSET_URL, false: "https://cdn.example.test/off.svg" },
        },
        alt: {
          from: "value",
          map: { true: "Enabled", false: "Disabled" },
        },
      },
    },
  };
}

describe("Boolean Cell V1 value-channel isolation", () => {
  it("keeps mapped asset URLs out of CSV while preserving formatter options", () => {
    const col = column();
    const row = { id: "r1", active: true };
    const plannedColumn = { kind: "data" as const, column: col, field: "active" };
    const formatted = resolveCsvCellValue({
      plannedColumn,
      row,
      rowId: "r1",
      rowIndex: 0,
      sourceRowIndex: 0,
      useValueFormatter: true,
    });
    const raw = resolveCsvCellValue({
      plannedColumn,
      row,
      rowId: "r1",
      rowIndex: 0,
      sourceRowIndex: 0,
      useValueFormatter: false,
    });

    expect(formatted).toBe("Enabled");
    expect(raw).toBe(true);
    expect(String(formatted)).not.toContain(ASSET_URL);
    expect(String(raw)).not.toContain(ASSET_URL);
  });

  it("keeps mapped asset URLs out of quick-search aggregate text", () => {
    const text = buildNormalizedRowAggregateText(
      { active: true },
      [column()],
      defaultNormalizer,
    );
    expect(text).toBe("ENABLED");
    expect(text).not.toContain(ASSET_URL.toUpperCase());
  });

  it("keeps mapped asset URLs out of tooltip text", () => {
    const col = column();
    const text = resolveTooltip({
      tooltip: true,
      params: {
        value: true,
        formattedValue: "Enabled",
        row: { active: true },
        rowIndex: 0,
        rowId: "r1",
        field: "active",
        column: col,
        grid: new Grid({ rows: [], columns: [] }),
      },
    });
    expect(text).toBe("Enabled");
    expect(text).not.toContain(ASSET_URL);
  });

  it("filters and sorts the raw booleans without consulting shell assets", () => {
    const rows: RowData[] = [
      { id: "on", active: true },
      { id: "off", active: false },
    ];
    const getCellValue = vi.fn(
      (row: RowData, _index: number, field: string) => row[field],
    );
    const booleanConfig: NormalizedColumnFilterConfig = {
      type: "boolean",
      defaultOperator: "equals",
      caseSensitive: false,
      trimInput: true,
    };
    const filtered = executeFilterMainThread({
      rows,
      filterModel: {
        active: {
          type: "boolean",
          conditions: [{ operator: "equals", value: true }],
        },
      },
      columnsByField: new Map([["active", booleanConfig]]),
      getCellValue,
    });
    expect(Array.from(filtered.indexes)).toEqual([0]);
    expect(getCellValue.mock.results.map(({ value }) => value)).toEqual([
      true,
      false,
    ]);

    const sorted = applySortModel(
      rows,
      [{ field: "active", sort: "asc" }],
      [column()],
    );
    expect(sorted.map((row) => row.active)).toEqual([false, true]);
  });

});
