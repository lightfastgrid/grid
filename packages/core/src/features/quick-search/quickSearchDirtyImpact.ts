import type { RowStoreDirtyMetadata } from "../../row-model/store/RowStore.types";

import {
  dirtyFieldSetTouchesPlan,
  type QuickSearchDependencyPlan,
} from "./quickSearchDependencyPlan";

const EMPTY_INDEXES: ReadonlySet<number> = new Set();

/**
 * Single-pass searchable dirty impact for an update-only (or structural)
 * dirty metadata payload. Retains only source indexes whose field diffs
 * match the plan's dependency rules.
 */
export interface QuickSearchDirtyImpact {
  readonly touched: boolean;
  readonly sourceIndexes: ReadonlySet<number>;
  readonly sourceIndexCoverageComplete: boolean;
}

/**
 * Analyze dirty metadata against a cached dependency plan.
 *
 * - Iterates `updatedSourceIndexes` + `dirtyFieldsBySourceIndex` only.
 * - When `plan.dependsOnAllRowFields`, every index with a non-empty field set
 *   is retained (arbitrary row-reading pipelines without projection).
 * - Otherwise retains indexes whose fields match exact/prefix watch sets.
 * - Missing field metadata for a reported index is treated conservatively.
 * - Empty field sets mean RowStore proved no top-level value change.
 * - Changed rows without source-index coverage mark incomplete + touched.
 * - No descriptor resolution, row-ID lookup, or rows scan.
 * Cost remains O(updated source indexes × dirty fields).
 */
export function analyzeQuickSearchDirtyImpact(
  plan: QuickSearchDependencyPlan,
  dirty: RowStoreDirtyMetadata,
): QuickSearchDirtyImpact {
  if (dirty.structural) {
    return {
      touched: true,
      sourceIndexes: EMPTY_INDEXES,
      sourceIndexCoverageComplete: false,
    };
  }

  if (dirty.updatedRowIds.size === 0 && dirty.updatedSourceIndexes.size === 0) {
    return {
      touched: false,
      sourceIndexes: EMPTY_INDEXES,
      sourceIndexCoverageComplete: true,
    };
  }

  const retained = new Set<number>();
  let touched = false;
  let sourceIndexCoverageComplete = true;

  if (dirty.updatedRowIds.size > dirty.updatedSourceIndexes.size) {
    sourceIndexCoverageComplete = false;
    touched = true;
  }

  for (const index of dirty.updatedSourceIndexes) {
    const fields = dirty.dirtyFieldsBySourceIndex.get(index);
    if (!dirtyFieldSetTouchesPlan(plan, fields)) {
      continue;
    }
    retained.add(index);
    touched = true;
  }

  return {
    touched,
    sourceIndexes: retained,
    sourceIndexCoverageComplete,
  };
}
