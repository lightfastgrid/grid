/**
 * Worker-sort eligibility check.
 *
 * Determines whether a sort request can be executed by the sort worker.
 * This is a pure, side-effect-free helper that inspects the sort model
 * and column definitions without importing any renderer, Grid, or
 * feature code.
 *
 * Eligibility rules:
 * - Empty sort model → ineligible ("empty-sort").
 * - Columns with `valueGetter` → ineligible ("value-getter").
 * - Columns with `sortComparator` → ineligible ("custom-comparator").
 * - Unknown/missing columns are silently skipped.
 * - If no resolvable entries remain → ineligible ("no-resolvable-columns").
 * - Built-in field and dot-path sorts are eligible.
 */

import type { ColumnDef, SortModel } from "../../../types";

// ── Public types ──────────────────────────────────────────────────────

/** A single serializable sort entry safe for worker execution. */
export interface WorkerSortEntry {
  /** Column field name. */
  field: string;
  /** Sort direction as a numeric multiplier: 1 = asc, -1 = desc. */
  dir: 1 | -1;
  /**
   * Pre-split dot-path segments for nested field access, or `null` when
   * the field is a simple top-level key.
   */
  pathParts: string[] | null;
}

/** Result of a worker-sort eligibility check. */
export interface WorkerSortEligibility {
  /** Whether the sort request can be executed in a Worker. */
  eligible: boolean;
  /** Resolved serializable entries (empty when ineligible). */
  entries: WorkerSortEntry[];
  /** Human-readable reason when `eligible` is `false`. */
  reason?: string;
}

// ── Implementation ────────────────────────────────────────────────────

/**
 * Check whether the given sort request is safe to execute in a Worker.
 *
 * The check is intentionally conservative: any column that requires a
 * JS callback (`valueGetter`, `sortComparator`) makes the entire
 * request ineligible because those closures cannot be serialized across
 * the structured-clone boundary.
 */
export function resolveWorkerSortEligibility(
  sortModel: SortModel,
  columns: ColumnDef[],
): WorkerSortEligibility {
  if (sortModel.length === 0) {
    return { eligible: false, entries: [], reason: "empty-sort" };
  }

  const colByField = new Map<string, ColumnDef>();
  for (const col of columns) colByField.set(col.field, col);

  const entries: WorkerSortEntry[] = [];

  for (const item of sortModel) {
    const col = colByField.get(item.field);
    if (!col) continue; // unknown column — skip silently

    if (col.valueGetter) {
      return { eligible: false, entries: [], reason: "value-getter" };
    }

    if (col.sortComparator) {
      return { eligible: false, entries: [], reason: "custom-comparator" };
    }

    entries.push({
      field: item.field,
      dir: item.sort === "desc" ? -1 : 1,
      pathParts: item.field.includes(".") ? item.field.split(".") : null,
    });
  }

  if (entries.length === 0) {
    return { eligible: false, entries: [], reason: "no-resolvable-columns" };
  }

  return { eligible: true, entries };
}
