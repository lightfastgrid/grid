import type { LightFastGridColDef, LightFastGridDefaultColDef } from "../types";

/**
 * Merged visibility: `visible === false` hides; `true` or `undefined` (after merge) shows.
 * Column wins when set; otherwise `defaultColDef.visible` applies; default is visible.
 */
export function resolveMergedColumnVisibility(
  col: LightFastGridColDef,
  defaultColDef?: LightFastGridDefaultColDef,
): boolean {
  const v =
    col.visible !== undefined ? col.visible : defaultColDef?.visible;
  return v !== false;
}
