import type { GridThemeDensity } from "@lightfastgrid/core";

import type {
  DemoGridGetter,
  DemoThemePreference,
} from "./runtime/types.ts";

/** Toolbar popovers that open against the runtime handle. */
export type InteractiveDemoPanelId =
  | "columns"
  | "filters"
  | "sort"
  | "density"
  | "export"
  | "settings"
  | null;

export type DemoStatusAnnouncer = (message: string) => void;

export type InteractiveDemoToolbarProps = {
  getGrid: DemoGridGetter;
  density: GridThemeDensity;
  onDensityChange: (density: GridThemeDensity) => void;
  activeFilterCount?: number;
  activeSortCount?: number;
  floatingFiltersEnabled: boolean;
  onFloatingFiltersChange: (enabled: boolean) => void;
  groupedHeadersEnabled: boolean;
  onGroupedHeadersChange: (enabled: boolean) => void;
  paginationEnabled: boolean;
  onPaginationChange: (enabled: boolean) => void;
  themePreference: DemoThemePreference;
  onThemePreferenceChange: (preference: DemoThemePreference) => void;
  onStatus: DemoStatusAnnouncer;
};

export type {
  DemoGridGetter,
  DemoThemePreference,
  InteractiveDemoPanelProps,
} from "./runtime/types.ts";
export type { GridThemeDensity };
