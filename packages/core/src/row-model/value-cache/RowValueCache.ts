import type { ColumnDef, RowData } from "../../types";
import { resolveDotPath } from "../../utils/resolveDotPath";

import type { CacheStamp, SortValueCacheEntry } from "./types";

const NULL_SENTINEL = 1;
const NON_NULL = 0;

function stampMatches(
  stamp: CacheStamp,
  rows: RowData[],
  rowEpoch: number,
  field: string,
  valueGetterRef: ColumnDef["valueGetter"] | undefined,
): boolean {
  return (
    stamp.rowsRef === rows &&
    stamp.rowEpoch === rowEpoch &&
    stamp.field === field &&
    stamp.valueGetterRef === valueGetterRef
  );
}

/**
 * Shared internal value cache keyed by column field. Sorting, and later
 * filtering/formulas/search, request per-column value arrays through this
 * layer so value extraction happens at most once per (rows, epoch, field,
 * valueGetter) combination.
 *
 * The cache is lazy: entries are built on first access and reused until
 * invalidated by a rows/epoch/column change. No all-column cache is built
 * during ingestion.
 *
 * The renderer must not import or use this cache — it consumes `RowView`.
 */
export class RowValueCache {
  private entries = new Map<string, SortValueCacheEntry>();
  private currentRowsRef: RowData[] | undefined;
  private currentRowEpoch = -1;

  /**
   * Update the cache's row context. When the rows reference or epoch
   * changes, all cached entries are cleared immediately so stale value
   * arrays (which retain references to the old rows) are not kept in
   * memory. Entries rebuild lazily on next access.
   */
  setRowContext(rows: RowData[], rowEpoch: number): void {
    if (this.currentRowsRef !== rows || this.currentRowEpoch !== rowEpoch) {
      this.entries.clear();
      this.currentRowsRef = rows;
      this.currentRowEpoch = rowEpoch;
    }
  }

  /**
   * Get or build sort values for a column. Returns a cached entry when the
   * stamp matches; otherwise extracts values from every source row and
   * caches the result.
   */
  getSortValues(
    rows: RowData[],
    rowEpoch: number,
    field: string,
    column: ColumnDef,
  ): SortValueCacheEntry {
    const valueGetterRef = column.valueGetter;
    const existing = this.entries.get(field);
    if (
      existing &&
      stampMatches(existing.stamp, rows, rowEpoch, field, valueGetterRef)
    ) {
      return existing;
    }

    const len = rows.length;
    const values = new Array<unknown>(len);
    const nullFlags = new Uint8Array(len);
    const pathParts = field.includes(".") ? field.split(".") : null;

    for (let i = 0; i < len; i++) {
      const row = rows[i]!;
      let v: unknown;
      if (valueGetterRef) {
        v = valueGetterRef({ row, rowIndex: i, field, column });
      } else if (pathParts) {
        v = resolveDotPath(row, pathParts);
      } else {
        v = row[field];
      }
      values[i] = v;
      nullFlags[i] = v === null || v === undefined ? NULL_SENTINEL : NON_NULL;
    }

    const stamp: CacheStamp = { rowsRef: rows, rowEpoch, field, valueGetterRef };
    const entry: SortValueCacheEntry = { stamp, values, nullFlags };
    this.entries.set(field, entry);
    return entry;
  }

  /**
   * Invalidate cached entries for specific fields only. Entries for
   * other fields survive. Use when update-only transactions changed
   * known fields and the rest can be reused.
   *
   * Also invalidates entries whose column uses a `valueGetter`, since
   * we cannot statically determine what fields the getter reads.
   */
  invalidateFields(dirtyFields: ReadonlySet<string>): void {
    if (this.entries.size === 0) return;
    const toDelete: string[] = [];
    for (const [field, entry] of this.entries) {
      if (dirtyFields.has(field)) {
        toDelete.push(field);
        continue;
      }
      // Dot-path: if dirty field is "user" and cache key is "user.name".
      if (field.includes(".")) {
        const prefix = field.split(".")[0]!;
        if (dirtyFields.has(prefix)) {
          toDelete.push(field);
          continue;
        }
      }
      // valueGetter entries depend on arbitrary fields — conservative clear.
      if (entry.stamp.valueGetterRef) {
        toDelete.push(field);
      }
    }
    for (const key of toDelete) this.entries.delete(key);
  }

  /**
   * Update the rows reference on the context and all surviving stamps
   * without clearing entries. Safe after an update-only COW where the
   * array reference changed but row order/length did not, and dirty
   * entries were already invalidated via `invalidateFields`.
   */
  rebaseRowsRef(rows: RowData[]): void {
    this.currentRowsRef = rows;
    for (const [, entry] of this.entries) {
      entry.stamp.rowsRef = rows;
    }
  }

  clear(): void {
    this.entries.clear();
    this.currentRowsRef = undefined;
    this.currentRowEpoch = -1;
  }
}
