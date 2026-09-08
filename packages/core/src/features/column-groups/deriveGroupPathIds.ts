/**
 * Parent-scoped identity derivation for column group path segments.
 *
 * Every segment id is formed as `parentScopedId + "/" + localPart` where
 * localPart is either `encodeURIComponent(groupId)` (when provided) or the
 * zero-based sibling ordinal in the original input children array.
 *
 * See COLUMN_GROUP_HEADERS_V1_ARCHITECTURE.md §2a for derivation rules.
 */

/**
 * Derive a fully scoped segment id for a group node.
 *
 * @param parentScopedId - The parent group's segment.id (empty string for root-level groups).
 * @param groupId - User-provided local identity hint (optional).
 * @param siblingOrdinal - Zero-based position among siblings in the original input.
 */
export function deriveSegmentId(
  parentScopedId: string,
  groupId: string | undefined,
  siblingOrdinal: number,
): string {
  const localPart =
    groupId !== undefined ? encodeURIComponent(groupId) : String(siblingOrdinal);
  return parentScopedId + '/' + localPart;
}
