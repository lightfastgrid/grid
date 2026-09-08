import type { RowStoreDirtyMetadata } from "./RowStore.types";

/**
 * Check whether any field in `fields` was touched by the dirty metadata.
 *
 * Matching rules:
 * - Direct match: dirty field "name" matches query field "name".
 * - Dot-path prefix: dirty field "user" matches query field "user.name"
 *   (top-level key changed, so any nested path under it is dirty).
 * - Dot-path exact: dirty field "user.name" matches query field "user.name".
 *
 * Conservative: returns `true` when dirty metadata exists but
 * `dirtyFieldsByRowId` is empty (row was updated but fields unknown).
 */
export function didAnyDirtyFieldTouch(
  fields: ReadonlySet<string> | Iterable<string>,
  dirty: RowStoreDirtyMetadata,
): boolean {
  if (dirty.structural) return true;
  if (dirty.updatedRowIds.size === 0) return false;

  const allDirtyFields = collectAllDirtyFields(dirty);

  // Conservative: rows were updated but no field-level info available.
  if (allDirtyFields.size === 0 && dirty.updatedRowIds.size > 0) return true;

  for (const queryField of fields) {
    if (allDirtyFields.has(queryField)) return true;

    // Check dot-path prefix: if queryField is "user.name" and dirty
    // field is "user", the top-level key changed so the path is dirty.
    if (queryField.includes(".")) {
      const prefix = queryField.split(".")[0]!;
      if (allDirtyFields.has(prefix)) return true;
    }

    // Check if a dirty field is a sub-path of the query field:
    // dirty "user.name" matches query "user.name" (already handled above
    // by direct match), but also dirty "user.name" matches query "user"
    // is NOT a match — changing a nested path doesn't dirty the parent
    // object reference at top level. So we only need prefix matching.
  }

  return false;
}

function collectAllDirtyFields(dirty: RowStoreDirtyMetadata): ReadonlySet<string> {
  if (dirty.dirtyFieldsByRowId.size === 0) return new Set();
  if (dirty.dirtyFieldsByRowId.size === 1) {
    const [, fields] = dirty.dirtyFieldsByRowId.entries().next().value as [string, ReadonlySet<string>];
    return fields;
  }
  const all = new Set<string>();
  for (const [, fields] of dirty.dirtyFieldsByRowId) {
    for (const f of fields) all.add(f);
  }
  return all;
}
