import type { GridThemeDensity } from "@lightfastgrid/core";

import { densityOptionLabel } from "./actions/density/densityOptions.ts";

const DENSITY_ORDER: readonly GridThemeDensity[] = [
  "compact",
  "standard",
  "comfortable",
];

/** Cycle compact → standard → comfortable → compact. */
export function cycleDensity(current: GridThemeDensity): GridThemeDensity {
  const index = DENSITY_ORDER.indexOf(current);
  const next = index < 0 ? 0 : (index + 1) % DENSITY_ORDER.length;
  return DENSITY_ORDER[next]!;
}

export const densityLabel = densityOptionLabel;
