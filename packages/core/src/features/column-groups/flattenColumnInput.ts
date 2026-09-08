/**
 * Flatten a (possibly nested) column input array into a flat list of leaf
 * column defs plus derived group path metadata per leaf.
 *
 * Pre-order traversal preserves the visual order of leaves. Group metadata
 * is stored separately — leaf `LightFastGridColDef` objects are never
 * mutated with group fields.
 *
 * See COLUMN_GROUP_HEADERS_V1_ARCHITECTURE.md §2 for the flattening contract.
 */

import type {
  ColumnGroupPathMeta,
  ColumnGroupPathSegment,
  LightFastGridColDef,
  LightFastGridColumnGroupDef,
  LightFastGridColumnInput,
} from '../../types';

import { deriveSegmentId } from './deriveGroupPathIds';

/** Result of flattening nested column input. */
export interface FlattenedColumnResult {
  /** Leaf column defs in pre-order traversal order. */
  leafColumns: LightFastGridColDef[];
  /**
   * Group path metadata keyed by leaf field for ALL leaves (including hidden).
   * Only populated when groups exist; empty record for flat input.
   */
  groupMetaByField: Record<string, ColumnGroupPathMeta>;
  /** Maximum group nesting depth (0 for flat input). */
  depth: number;
}

/** Type guard: true when the input node is a group (has `children`). */
export function isColumnGroupDef(
  input: LightFastGridColumnInput,
): input is LightFastGridColumnGroupDef {
  return 'children' in input && Array.isArray(
    (input as LightFastGridColumnGroupDef).children,
  );
}

/**
 * Flatten nested column input into leaf columns + group metadata.
 *
 * @param input - Public column input (may contain groups or be flat).
 * @returns Flattened result with leaf columns, group metadata, and depth.
 */
export function flattenColumnInput(
  input: LightFastGridColumnInput[],
): FlattenedColumnResult {
  const leafColumns: LightFastGridColDef[] = [];
  const groupMetaByField: Record<string, ColumnGroupPathMeta> = {};
  let maxDepth = 0;

  function walk(
    nodes: LightFastGridColumnInput[],
    parentPath: ColumnGroupPathSegment[],
    parentScopedId: string,
    level: number,
  ): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (isColumnGroupDef(node)) {
        const segmentId = deriveSegmentId(parentScopedId, node.groupId, i);
        const segment: ColumnGroupPathSegment = {
          id: segmentId,
          headerName: node.headerName,
          level,
        };
        const childPath = [...parentPath, segment];
        walk(node.children, childPath, segmentId, level + 1);
      } else {
        // Skip field-less synthetics (e.g. AG sparkline cols) so they do not
        // enter the leaf list or corrupt groupMetaByField under `undefined`.
        if (typeof node.field !== 'string' || node.field.length === 0) {
          continue;
        }
        leafColumns.push(node);
        if (parentPath.length > 0) {
          groupMetaByField[node.field] = { path: parentPath };
          if (parentPath.length > maxDepth) {
            maxDepth = parentPath.length;
          }
        }
      }
    }
  }

  walk(input, [], '', 0);

  return { leafColumns, groupMetaByField, depth: maxDepth };
}
