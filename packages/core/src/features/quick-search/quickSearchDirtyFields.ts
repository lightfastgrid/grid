/**
 * Dirty-field checks for quick-search invalidation.
 *
 * Uses searchable column fields and projection fields so update-only
 * transactions can preserve quick-search row order when unrelated cells
 * change.
 *
 * Watch-set construction delegates to quickSearchDependencyPlan helpers.
 * This module preserves the existing exports as compatibility wrappers
 * until GridState is wired to the cached dependency plan.
 */

import { didAnyDirtyFieldTouch } from "../../row-model/store/dirtyFieldUtils";
import type { RowStoreDirtyMetadata } from "../../row-model/store/RowStore.types";

import { buildExactDirtyFieldWatchSet } from "./quickSearchDependencyPlan";
import type { SearchableFieldDescriptor } from "./searchableFieldResolver";

/** Field paths that can invalidate an active quick-search result. */
export function buildQuickSearchDirtyFieldWatchSet(
  descriptors: readonly SearchableFieldDescriptor[],
): ReadonlySet<string> {
  return buildExactDirtyFieldWatchSet(descriptors);
}

export function doDirtyFieldsTouchQuickSearch(
  descriptors: readonly SearchableFieldDescriptor[],
  dirty: RowStoreDirtyMetadata,
): boolean {
  if (dirty.structural) return true;
  const watch = buildExactDirtyFieldWatchSet(descriptors);
  return didAnyDirtyFieldTouch(watch, dirty);
}
