import type { ColumnDef, RowData } from "../../types";

/**
 * Invalidation stamp for a single cached column value array. The cache
 * checks each field against its stamp on access and rebuilds lazily when
 * any input has changed.
 */
export interface CacheStamp {
  rowsRef: RowData[];
  rowEpoch: number;
  field: string;
  valueGetterRef: ColumnDef["valueGetter"] | undefined;
}

/**
 * A lazily-built array of extracted values for one column, indexed by
 * source row index. Null flags are co-located so sort/filter consumers
 * can branch on nullability without re-checking the value.
 */
export interface SortValueCacheEntry {
  stamp: CacheStamp;
  values: readonly unknown[];
  nullFlags: Uint8Array;
}
