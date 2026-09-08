/**
 * Shared internal types for the row-model cache boundary between
 * `GridState` and `RowModelRuntime`.
 *
 * - `SortCache` — owned by `GridState` as its primary sort-result slot.
 *   Keyed by raw rows reference + sort model + column snapshot so
 *   unrelated state changes do not invalidate the order. The renderer
 *   resolves display rows through `RowView` / `DisplayRowReader`;
 *   `snapshot.data` is the raw source-rows reference (no materialization).
 *
 * - `CachedSortResolution` — returned by
 *   `RowModelRuntime.tryResolveCachedSortOrder()` so `GridState` can
 *   rebuild its `SortCache` from a pair-cache hit.
 *
 * These types are internal — not exported from the public package surface.
 * The renderer must not import them.
 */

import type { RowData, SortModel } from "../types";
import type { SortColumnSnapshot } from "../utils/sortModel";

import type { RowOrder } from "./rowOrder";

/**
 * Primary sort cache slot. **Owned by `GridState`**.
 *
 * Keyed by raw rows reference + sort model + column snapshot so unrelated
 * state changes (selection, drag, widths) do not invalidate the order.
 */
export interface SortCache {
  rawRows: RowData[];
  sortModel: SortModel;
  columnSnapshot: SortColumnSnapshot[];
  rowOrder: RowOrder;
}

/**
 * Result of {@link import("./RowModelRuntime").RowModelRuntime.tryResolveCachedSortOrder | tryResolveCachedSortOrder}.
 * On cache hit, `rowOrder` is the stable cached reference.
 */
export interface CachedSortResolution {
  rowOrder: RowOrder;
}
