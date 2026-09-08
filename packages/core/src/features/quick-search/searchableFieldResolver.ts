/**
 * Resolves which columns participate in quick-search and how their
 * values are extracted for the worker snapshot.
 *
 * Searchability precedence (per column):
 * 1. `searchable: false` → excluded.
 * 2. `quickFilterTextField` → worker-safe projection field (always wins).
 * 3. `getQuickFilterText` → searchable, but worker-ineligible.
 * 4. `valueGetter` / `valueFormatter` → searchable (main-thread
 *    fallback runs the value pipeline), but worker-ineligible.
 * 5. Otherwise → default raw field value (worker-safe).
 *
 * `valueGetter` and `valueFormatter` are display pipeline functions.
 * The worker never calls them; it reads only projection fields or raw
 * row data. To make display values searchable in the worker, configure
 * `quickFilterTextField` with pre-computed projection text.
 *
 * Internal system columns are always excluded.
 */

import type { SearchProjectionField } from "../../execution/operations/quick-search/quickSearchProtocol";
import { isInternalColumn } from "../../internal/internalColumns";
import type { ColumnDef, QuickFilterOptions } from "../../types";

import { isQuickFilterEnabled } from "./quickFilterConfig";

export interface SearchableFieldDescriptor {
  field: string;
  projectionField: string | undefined;
  workerEligible: boolean;
}

export interface SearchableFieldResolution {
  descriptors: SearchableFieldDescriptor[];
  fields: SearchProjectionField[];
  allWorkerEligible: boolean;
  signature: string;
}

export function resolveSearchableFields(
  columns: readonly ColumnDef[],
  options?: { includeHiddenColumns?: boolean },
): SearchableFieldResolution {
  const includeHidden = options?.includeHiddenColumns ?? false;
  const descriptors: SearchableFieldDescriptor[] = [];

  for (const col of columns) {
    if (isInternalColumn(col)) continue;
    if (col.searchable === false) continue;
    if (!includeHidden && col.visible === false) continue;

    const hasCustomExtractor = typeof col.getQuickFilterText === "function";
    const hasValuePipeline =
      typeof col.valueGetter === "function" ||
      typeof col.valueFormatter === "function";
    const projectionField = col.quickFilterTextField ?? undefined;
    // A projection field keeps the column worker-safe regardless of
    // getQuickFilterText / valueGetter / valueFormatter — the worker
    // snapshot reads the projection field only.
    const workerEligible =
      projectionField !== undefined || (!hasCustomExtractor && !hasValuePipeline);

    descriptors.push({
      field: col.field,
      projectionField,
      workerEligible,
    });
  }

  const fields: SearchProjectionField[] = descriptors.map((d) => ({
    field: d.field,
    ...(d.projectionField !== undefined ? { projectionField: d.projectionField } : {}),
  }));

  const allWorkerEligible = descriptors.length > 0 &&
    descriptors.every((d) => d.workerEligible);

  const signature = buildFieldsSignature(descriptors, includeHidden);

  return { descriptors, fields, allWorkerEligible, signature };
}

function buildFieldsSignature(
  descriptors: SearchableFieldDescriptor[],
  includeHidden: boolean,
): string {
  const parts = descriptors.map((d) => {
    let key = d.field;
    if (d.projectionField) key += `:${d.projectionField}`;
    if (!d.workerEligible) key += ":fn";
    return key;
  });
  return `sf|${includeHidden ? "h" : "v"}|${parts.join(",")}`;
}

export function resolveSearchableFieldsFromConfig(
  columns: readonly ColumnDef[],
  quickFilter?: boolean | QuickFilterOptions,
): SearchableFieldResolution {
  if (!isQuickFilterEnabled(quickFilter)) {
    return { descriptors: [], fields: [], allWorkerEligible: false, signature: "sf|disabled" };
  }
  const opts = typeof quickFilter === "object" ? quickFilter : undefined;
  return resolveSearchableFields(columns, {
    includeHiddenColumns: opts?.includeHiddenColumns,
  });
}
