/**
 * Pure column-state helper functions.
 *
 * Extracted from GridState so the facade delegates column math here.
 * Every function operates on explicit inputs and returns explicit results.
 * None of these know about GridState or its revision counter.
 */

import {
  clampColumnWidth,
  isColumnResizable,
} from '../internal/columnSizing';
import { isInternalColumn } from '../internal/internalColumns';
import type {
  ColumnDef,
  ColumnPinChange,
  ColumnPinState,
  ColumnVisibilityChange,
  ColumnVisibilityState,
  LightFastGridColDef,
  LightFastGridDefaultColDef,
} from '../types';
import { resolveMergedColumnVisibility } from '../utils/columnVisibility';

// Callback GridState passes so helpers can resolve merged defaults
// without knowing about the class.
type ResolveEffective = (col: LightFastGridColDef) => ColumnDef;

// ── Column Sizing ───────────────────────────────────────────────────

export function buildBaselineWidths(
  columns: LightFastGridColDef[] | undefined,
): Map<string, number | undefined> {
  const map = new Map<string, number | undefined>();
  if (!columns) return map;
  for (const col of columns) {
    map.set(col.field, col.width);
  }
  return map;
}

/**
 * Batch-set column widths in a single pass (O(columns)).
 * Mutates `col.width` in place. Returns the list of fields that changed.
 */
export function batchSetColumnWidths(
  cols: LightFastGridColDef[],
  widths: Record<string, number>,
  resolveEffective: ResolveEffective,
): string[] {
  const changed: string[] = [];
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]!;
    if (isInternalColumn(col)) continue;
    const target = widths[col.field];
    if (target === undefined) continue;
    const eff = resolveEffective(col);
    if (!isColumnResizable(eff)) continue;
    const next = clampColumnWidth(eff, target);
    if (col.width !== next) {
      col.width = next;
      changed.push(col.field);
    }
  }
  return changed;
}

/**
 * Reset visible column widths to their baseline (original schema) values.
 * Hidden columns are skipped. Mutates `col.width` in place.
 */
export function resetColumnWidthsToBaseline(
  cols: LightFastGridColDef[],
  baselineWidths: Map<string, number | undefined>,
  resolveEffective: ResolveEffective,
): string[] {
  const changed: string[] = [];
  for (const col of cols) {
    const eff = resolveEffective(col);
    if (eff.visible === false) continue;
    const baseline = baselineWidths.get(col.field);
    if (col.width !== baseline) {
      col.width = baseline;
      changed.push(col.field);
    }
  }
  return changed;
}

// ── Column Visibility ───────────────────────────────────────────────

/**
 * Remove runtime visibility overrides for columns that no longer exist
 * in the schema. Called after `setColumns` to avoid stale entries.
 */
export function pruneRuntimeVisibility(
  runtimeVisibility: Map<string, boolean>,
  columns: LightFastGridColDef[],
): void {
  if (runtimeVisibility.size === 0) return;
  const fields = new Set(columns.map((col) => col.field));
  for (const field of runtimeVisibility.keys()) {
    if (!fields.has(field)) {
      runtimeVisibility.delete(field);
    }
  }
}

/**
 * Resolve whether a column is currently visible, considering runtime
 * overrides, column-level `visible`, and `defaultColDef.visible`.
 */
export function isColumnEffectivelyVisible(
  col: LightFastGridColDef,
  runtimeVisibility: Map<string, boolean>,
  defaultColDef: LightFastGridDefaultColDef | undefined,
): boolean {
  if (runtimeVisibility.has(col.field)) {
    return runtimeVisibility.get(col.field) !== false;
  }
  return resolveMergedColumnVisibility(col, defaultColDef) !== false;
}

/**
 * Apply a batch visibility state update. Mutates `col.visible` and
 * `runtimeVisibility` in place. Returns only the columns whose
 * effective visibility actually changed.
 */
export function computeVisibilityChanges(
  cols: LightFastGridColDef[],
  state: ColumnVisibilityState[],
  runtimeVisibility: Map<string, boolean>,
  defaultColDef: LightFastGridDefaultColDef | undefined,
): ColumnVisibilityChange[] {
  const nextByField = new Map<string, boolean>();
  for (const item of state) {
    nextByField.set(item.field, item.visible);
  }

  const changes: ColumnVisibilityChange[] = [];
  for (const col of cols) {
    if (isInternalColumn(col)) continue;
    const prev = isColumnEffectivelyVisible(col, runtimeVisibility, defaultColDef);
    const next = nextByField.get(col.field) ?? true;
    runtimeVisibility.set(col.field, next);
    col.visible = next ? true : false;
    if (prev === next) continue;
    changes.push({ field: col.field, visible: next, previousVisible: prev });
  }
  return changes;
}

// ── Column Pinning ──────────────────────────────────────────────────

/**
 * Apply a batch pin state update. Mutates `col.pinned` in place.
 * Returns only the columns whose pin state actually changed.
 */
export function computePinStateChanges(
  cols: LightFastGridColDef[],
  state: ColumnPinState[],
  resolveEffective: ResolveEffective,
): ColumnPinChange[] {
  const nextByField = new Map<string, "left" | "right" | false>();
  for (const item of state) {
    nextByField.set(item.field, item.pinned || false);
  }

  const changes: ColumnPinChange[] = [];
  for (const col of cols) {
    if (isInternalColumn(col)) continue;
    const eff = resolveEffective(col);
    if (eff.internal || eff.pinnable === false) continue;

    const prev = col.pinned || false;
    const next = nextByField.get(col.field) ?? false;
    const normalizedNext = next || undefined;
    if (col.pinned === normalizedNext) continue;

    col.pinned = normalizedNext;
    changes.push({ field: col.field, pinned: next, previousPinned: prev });
  }
  return changes;
}
