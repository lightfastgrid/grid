import type { RowStoreDirtyMetadata } from "../../row-model/store/RowStore.types";
import type { ColumnDef, QuickFilterOptions } from "../../types";

import type { QuickSearchNormalizer } from "./normalizer";
import { defaultNormalizer, getNormalizerSignature } from "./normalizer";
import { isQuickFilterEnabled } from "./quickFilterConfig";
import type { SearchableFieldDescriptor } from "./searchableFieldResolver";
import { resolveSearchableFieldsFromConfig } from "./searchableFieldResolver";

export interface QuickSearchDependencyPlan {
  readonly descriptors: readonly SearchableFieldDescriptor[];
  readonly exactDirtyFieldWatchSet: ReadonlySet<string>;
  readonly dirtyFieldRootWatchSet: ReadonlySet<string>;
  readonly fieldsSignature: string;
  readonly normalizerSignature: string;
  readonly workerSafe: boolean;
  /**
   * True when any included searchable descriptor uses a custom row-reading
   * pipeline (`getQuickFilterText` / `valueGetter` / `valueFormatter`) without
   * `quickFilterTextField`. Those callbacks may read arbitrary row fields, so
   * dirty impact conservatively treats every non-empty field change as
   * searchable. Prefer `quickFilterTextField` for exact, worker-safe
   * projection dependencies.
   */
  readonly dependsOnAllRowFields: boolean;
}

const EMPTY_WATCH_SET: ReadonlySet<string> = new Set();
const EMPTY_DESCRIPTORS: readonly SearchableFieldDescriptor[] = [];

export function buildExactDirtyFieldWatchSet(
  descriptors: readonly SearchableFieldDescriptor[],
): ReadonlySet<string> {
  const fields = new Set<string>();
  for (const d of descriptors) {
    fields.add(d.field);
    if (d.projectionField !== undefined) {
      fields.add(d.projectionField);
    }
  }
  return fields;
}

export function buildDirtyFieldRootWatchSet(
  descriptors: readonly SearchableFieldDescriptor[],
): ReadonlySet<string> {
  const roots = new Set<string>();
  for (const d of descriptors) {
    addPrefixes(d.field, roots);
    if (d.projectionField !== undefined) {
      addPrefixes(d.projectionField, roots);
    }
  }
  return roots;
}

function addPrefixes(path: string, out: Set<string>): void {
  let dot = path.indexOf(".");
  while (dot !== -1) {
    out.add(path.slice(0, dot));
    dot = path.indexOf(".", dot + 1);
  }
}

function hasCustomParserOrMatcher(
  quickFilter: boolean | QuickFilterOptions | undefined,
): boolean {
  if (typeof quickFilter !== "object") return false;
  return (
    typeof quickFilter.parser === "function" ||
    typeof quickFilter.matcher === "function"
  );
}

function hasArbitraryRowReadingPipeline(
  descriptors: readonly SearchableFieldDescriptor[],
): boolean {
  // workerEligible is false only for custom extractors without projection;
  // quickFilterTextField keeps workerEligible true (field-selective).
  for (const d of descriptors) {
    if (!d.workerEligible) return true;
  }
  return false;
}

/**
 * Whether a dirty field set for one updated row/index touches the plan.
 * - `undefined` metadata → conservative touch
 * - empty set → proved no top-level change (skip)
 * - `dependsOnAllRowFields` → any non-empty set touches
 * - otherwise exact/root watch-set matching
 */
export function dirtyFieldSetTouchesPlan(
  plan: QuickSearchDependencyPlan,
  fields: ReadonlySet<string> | undefined,
): boolean {
  if (fields === undefined) return true;
  if (fields.size === 0) return false;
  if (plan.dependsOnAllRowFields) return true;
  for (const field of fields) {
    if (
      plan.exactDirtyFieldWatchSet.has(field) ||
      plan.dirtyFieldRootWatchSet.has(field)
    ) {
      return true;
    }
  }
  return false;
}

export function buildQuickSearchDependencyPlan(
  columns: readonly ColumnDef[],
  quickFilter: boolean | QuickFilterOptions | undefined,
  normalizer?: QuickSearchNormalizer,
): QuickSearchDependencyPlan {
  const norm = normalizer ?? defaultNormalizer;

  if (!isQuickFilterEnabled(quickFilter)) {
    return {
      descriptors: EMPTY_DESCRIPTORS,
      exactDirtyFieldWatchSet: EMPTY_WATCH_SET,
      dirtyFieldRootWatchSet: EMPTY_WATCH_SET,
      fieldsSignature: "sf|disabled",
      normalizerSignature: getNormalizerSignature(norm),
      workerSafe: false,
      dependsOnAllRowFields: false,
    };
  }

  const resolution = resolveSearchableFieldsFromConfig(columns, quickFilter);
  const dependsOnAllRowFields = hasArbitraryRowReadingPipeline(
    resolution.descriptors,
  );

  const workerSafe =
    resolution.descriptors.length > 0 &&
    resolution.allWorkerEligible &&
    !hasCustomParserOrMatcher(quickFilter);

  return {
    descriptors: resolution.descriptors,
    exactDirtyFieldWatchSet: buildExactDirtyFieldWatchSet(resolution.descriptors),
    dirtyFieldRootWatchSet: buildDirtyFieldRootWatchSet(resolution.descriptors),
    fieldsSignature: resolution.signature,
    normalizerSignature: getNormalizerSignature(norm),
    workerSafe,
    dependsOnAllRowFields,
  };
}

export function doDirtyFieldsTouchQuickSearchPlan(
  plan: QuickSearchDependencyPlan,
  dirty: RowStoreDirtyMetadata,
): boolean {
  if (dirty.structural) return true;
  if (dirty.updatedRowIds.size === 0 && dirty.updatedSourceIndexes.size === 0) {
    return false;
  }

  // Prefer the source-index path used by analyzeQuickSearchDirtyImpact.
  if (dirty.updatedSourceIndexes.size > 0) {
    if (dirty.updatedRowIds.size > dirty.updatedSourceIndexes.size) {
      return true;
    }
    for (const index of dirty.updatedSourceIndexes) {
      if (
        dirtyFieldSetTouchesPlan(
          plan,
          dirty.dirtyFieldsBySourceIndex.get(index),
        )
      ) {
        return true;
      }
    }
    return false;
  }

  // Row-ID-only compatibility path (no source indexes reported).
  for (const rowId of dirty.updatedRowIds) {
    if (dirtyFieldSetTouchesPlan(plan, dirty.dirtyFieldsByRowId.get(rowId))) {
      return true;
    }
  }
  return false;
}
