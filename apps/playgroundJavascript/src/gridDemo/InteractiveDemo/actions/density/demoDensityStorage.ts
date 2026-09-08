import type { GridThemeDensity } from "@lightfastgrid/core";

import { isGridThemeDensity } from "./densityOptions.ts";

export const DEMO_DENSITY_STORAGE_KEY = "lightfastgrid.playground.density";

/** Read persisted density; invalid / missing → null (caller uses default). */
export function readStoredDemoDensity(
  storage: Pick<Storage, "getItem"> | null | undefined = globalThis.localStorage,
): GridThemeDensity | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DEMO_DENSITY_STORAGE_KEY);
    return isGridThemeDensity(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist density for the design footer (“saved to your browser”). */
export function writeStoredDemoDensity(
  density: GridThemeDensity,
  storage: Pick<Storage, "setItem"> | null | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  try {
    storage.setItem(DEMO_DENSITY_STORAGE_KEY, density);
  } catch {
    /* private mode / quota — ignore */
  }
}
