import type { Grid, GridThemeDensity } from "@lightfastgrid/core";

import type { DemoThemePreference } from "../panels/settings/commands/settingsPanelModel.ts";

/**
 * Sole grid communication channel for InteractiveDemo chrome.
 * Always call at action time — never cache the handle across renders.
 */
export type DemoGridGetter = () => Grid | null;

export type { DemoThemePreference, GridThemeDensity };

/** Shared contract for every toolbar dropdown panel. */
export type InteractiveDemoPanelProps = {
  getGrid: DemoGridGetter;
  onClose: () => void;
  floatingFiltersEnabled?: boolean;
  onFloatingFiltersChange?: (enabled: boolean) => void;
  density?: GridThemeDensity;
  onDensityChange?: (density: GridThemeDensity) => void;
  groupedHeadersEnabled?: boolean;
  onGroupedHeadersChange?: (enabled: boolean) => void;
  paginationEnabled?: boolean;
  onPaginationChange?: (enabled: boolean) => void;
  themePreference?: DemoThemePreference;
  onThemePreferenceChange?: (preference: DemoThemePreference) => void;
  onStatus?: (message: string) => void;
};
