/**
 * Column group header display config.
 * Default (undefined / true): show group header rows when group metadata exists.
 */

import type { ColumnGroupHeadersOptions } from "../../types";

/**
 * Whether group header rows should be shown.
 * - `undefined` / `true` / `{ enabled: true }` → enabled
 * - `false` / `{ enabled: false }` → disabled
 */
export function isColumnGroupHeadersEnabled(
  config: boolean | ColumnGroupHeadersOptions | undefined,
): boolean {
  if (config === false) return false;
  if (typeof config === "object" && config.enabled === false) return false;
  return true;
}
