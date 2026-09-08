import type { FilterModel } from "@lightfastgrid/core";

/** Count columns that currently have a filter model entry. */
export function countActiveFilters(model: FilterModel | undefined): number {
  if (!model) return 0;
  return Object.keys(model).length;
}
