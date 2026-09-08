import type { SortModel } from "@lightfastgrid/core";

import type { DemoGridGetter } from "../../../runtime/types.ts";

import {
  buildDemoSortRows,
  type DemoSortableColumn,
  type DemoSortRow,
  orderDemoSortColumns,
  suggestNextDemoSortColumn,
} from "./sortPanelModel.ts";

/** Synthetic / unique-heavy fields that hide secondary sort effects. */
const EXCLUDED_SORT_FIELDS = new Set(["__rowNumber"]);

/** Never auto-picked by + Add sort (still selectable in the dropdown). */
const SKIP_AUTO_SORT_FIELDS = new Set(["__rowNumber", "name", "email"]);

/** First-sort candidates: many rows share the same value. */
const GROUP_SORT_FIELDS = [
  "status",
  "country",
  "department",
  "tier",
  "language",
  "region",
  "rating",
  "game.bought",
] as const;

/** Follow-on candidates: break ties inside a group. */
const TIEBREAK_SORT_FIELDS = [
  "bankBalance",
  "createdAt",
  "progressPct",
  "rating",
  "age",
] as const;

/** Dropdown order: groups, then tie-breakers, then everything else. */
const PREFERRED_SORT_FIELDS = [
  ...GROUP_SORT_FIELDS,
  ...TIEBREAK_SORT_FIELDS,
] as const;

/** Guaranteed-visible multi-sort for the empty-state demo action. */
export const DEMO_MULTI_SORT_EXAMPLE: SortModel = [
  { field: "status", sort: "asc" },
  { field: "bankBalance", sort: "desc" },
];

export function readDemoSortRows(getGrid: DemoGridGetter): DemoSortRow[] {
  const grid = getGrid();
  if (!grid) return [];
  return buildDemoSortRows({
    sortModel: grid.getSortModel(),
    columns: grid.getColumns(),
  });
}

/**
 * Columns the Sort panel may add. Matches grid normalize rules: visible +
 * sortable only. Ordered so the dropdown lists tie-friendly columns first.
 */
export function listSortableColumns(
  getGrid: DemoGridGetter,
): DemoSortableColumn[] {
  const grid = getGrid();
  if (!grid) return [];
  const columns: DemoSortableColumn[] = [];
  for (const column of grid.getColumns()) {
    if (column.internal) continue;
    if (column.visible === false) continue;
    if (column.sortable === false) continue;
    if (EXCLUDED_SORT_FIELDS.has(column.field)) continue;
    columns.push({
      field: column.field,
      label: column.headerName?.trim() || column.field,
    });
  }
  return orderDemoSortColumns(columns, PREFERRED_SORT_FIELDS);
}

/** Next field for + Add sort (skips unique-heavy auto picks). */
export function suggestNextSortColumn(
  getGrid: DemoGridGetter,
  usedFields: ReadonlySet<string>,
): DemoSortableColumn | null {
  return suggestNextDemoSortColumn({
    columns: listSortableColumns(getGrid),
    usedFields,
    groupFields: GROUP_SORT_FIELDS,
    tieBreakFields: TIEBREAK_SORT_FIELDS,
    skipAutoFields: SKIP_AUTO_SORT_FIELDS,
  });
}

export function writeDemoSortModel(
  getGrid: DemoGridGetter,
  model: SortModel,
): void {
  const grid = getGrid();
  if (!grid) return;
  grid.setSortModel(
    model.map((entry) => ({ field: entry.field, sort: entry.sort })),
    "api",
  );
}

export function applyDemoMultiSortExample(getGrid: DemoGridGetter): void {
  writeDemoSortModel(getGrid, DEMO_MULTI_SORT_EXAMPLE);
}

export function clearDemoSort(getGrid: DemoGridGetter): void {
  getGrid()?.clearSort("api");
}
