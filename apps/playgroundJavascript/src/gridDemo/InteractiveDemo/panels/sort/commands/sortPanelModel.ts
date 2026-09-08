import type { SortDirection, SortModel } from "@lightfastgrid/core";

export type DemoSortableColumn = {
  field: string;
  label: string;
};

export type DemoSortRow = {
  field: string;
  label: string;
  sort: SortDirection;
};

export function buildDemoSortRows(input: {
  sortModel: SortModel;
  columns: readonly {
    field: string;
    headerName?: string;
    internal?: string;
  }[];
}): DemoSortRow[] {
  const labelByField = new Map(
    input.columns
      .filter((column) => !column.internal)
      .map((column) => [
        column.field,
        column.headerName?.trim() || column.field,
      ]),
  );

  return input.sortModel.map((entry) => ({
    field: entry.field,
    label: labelByField.get(entry.field) ?? entry.field,
    sort: entry.sort,
  }));
}

export function nextAvailableSortColumn(
  columns: DemoSortableColumn[],
  usedFields: ReadonlySet<string>,
): DemoSortableColumn | null {
  return columns.find((column) => !usedFields.has(column.field)) ?? null;
}

/**
 * Prefer low-cardinality columns first so multi-sort ties are visible.
 * Unknown fields keep their relative input order after preferred ones.
 */
export function orderDemoSortColumns(
  columns: DemoSortableColumn[],
  preferredFields: readonly string[],
): DemoSortableColumn[] {
  const preferredIndex = new Map(
    preferredFields.map((field, index) => [field, index]),
  );
  return columns.slice().sort((left, right) => {
    const leftRank =
      preferredIndex.get(left.field) ?? preferredFields.length;
    const rightRank =
      preferredIndex.get(right.field) ?? preferredFields.length;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return 0;
  });
}

/**
 * Next column for + Add sort.
 * - First entry: prefer group/low-cardinality fields (visible ties).
 * - Later entries: prefer numeric/high-variance tie-breakers.
 * Unique-heavy fields stay selectable in the dropdown but are never auto-picked.
 */
export function suggestNextDemoSortColumn(input: {
  columns: DemoSortableColumn[];
  usedFields: ReadonlySet<string>;
  groupFields: readonly string[];
  tieBreakFields: readonly string[];
  skipAutoFields: ReadonlySet<string>;
}): DemoSortableColumn | null {
  const available = input.columns.filter(
    (column) =>
      !input.usedFields.has(column.field) &&
      !input.skipAutoFields.has(column.field),
  );
  if (available.length === 0) {
    return nextAvailableSortColumn(input.columns, input.usedFields);
  }

  const prefer =
    input.usedFields.size === 0 ? input.groupFields : input.tieBreakFields;
  const preferred = prefer
    .map((field) => available.find((column) => column.field === field))
    .find((column): column is DemoSortableColumn => column !== undefined);
  if (preferred) return preferred;

  const fallbackPrefer =
    input.usedFields.size === 0 ? input.tieBreakFields : input.groupFields;
  const fallback = fallbackPrefer
    .map((field) => available.find((column) => column.field === field))
    .find((column): column is DemoSortableColumn => column !== undefined);
  return fallback ?? available[0] ?? null;
}

/** Pure: reorder one sort entry (priority = array order). */
export function moveSortModelEntry(
  model: SortModel,
  fromIndex: number,
  toIndex: number,
): SortModel {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= model.length ||
    toIndex >= model.length ||
    fromIndex === toIndex
  ) {
    return model;
  }
  const next = model.slice();
  const [entry] = next.splice(fromIndex, 1);
  if (!entry) return model;
  next.splice(toIndex, 0, entry);
  return next;
}

export function withSortFieldAt(
  model: SortModel,
  index: number,
  field: string,
): SortModel {
  const current = model[index];
  if (!current) return model;
  return model.map((entry, entryIndex) =>
    entryIndex === index ? { field, sort: entry.sort } : entry,
  );
}

export function withSortDirectionAt(
  model: SortModel,
  index: number,
  sort: SortDirection,
): SortModel {
  const current = model[index];
  if (!current) return model;
  return model.map((entry, entryIndex) =>
    entryIndex === index ? { field: entry.field, sort } : entry,
  );
}

export function withoutSortAt(model: SortModel, index: number): SortModel {
  return model.filter((_, entryIndex) => entryIndex !== index);
}

export function withAddedSort(
  model: SortModel,
  field: string,
  sort: SortDirection = "asc",
): SortModel {
  if (model.some((entry) => entry.field === field)) return model;
  return [...model, { field, sort }];
}
