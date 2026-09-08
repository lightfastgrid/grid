import type { GridThemeDensity } from "@lightfastgrid/core";

export type DemoDensityOption = {
  value: GridThemeDensity;
  label: string;
  description: string;
};

/** Density radio inventory — matches the Density dropdown design. */
export const DEMO_DENSITY_OPTIONS: readonly DemoDensityOption[] = [
  {
    value: "compact",
    label: "Compact",
    description: "More rows on screen",
  },
  {
    value: "standard",
    label: "Standard",
    description: "Default row height",
  },
  {
    value: "comfortable",
    label: "Comfortable",
    description: "More spacing and padding",
  },
] as const;

export function isGridThemeDensity(value: unknown): value is GridThemeDensity {
  return (
    value === "compact" || value === "standard" || value === "comfortable"
  );
}

export function densityOptionLabel(density: GridThemeDensity): string {
  return (
    DEMO_DENSITY_OPTIONS.find((option) => option.value === density)?.label ??
    "Standard"
  );
}
