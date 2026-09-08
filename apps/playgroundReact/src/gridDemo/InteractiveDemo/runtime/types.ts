import type { GridThemeDensity } from "@lightfastgrid/core";
import type { ReactLightFastGridHandle } from "@lightfastgrid/react";

import type { DemoThemePreference } from "../panels/settings/commands/settingsPanelModel.ts";

/**
 * Sole grid communication channel for InteractiveDemo chrome.
 * Always call at action time — never cache the handle across renders.
 */
export type DemoGridGetter = () => ReactLightFastGridHandle | null;

export type { DemoThemePreference };

/** Shared contract for every toolbar dropdown panel. */
export type InteractiveDemoPanelProps = {
  getGrid: DemoGridGetter;
  onClose: () => void;
  /**
   * Filters + Settings — shell passes these through; other panels ignore them.
   * Kept optional on the shared contract so the registry stays one component type.
   */
  floatingFiltersEnabled?: boolean;
  onFloatingFiltersChange?: (enabled: boolean) => void;
  /** Density panel only — controlled theme density from parent. */
  density?: GridThemeDensity;
  onDensityChange?: (density: GridThemeDensity) => void;
  /** Settings panel — controlled demo chrome from parent. */
  groupedHeadersEnabled?: boolean;
  onGroupedHeadersChange?: (enabled: boolean) => void;
  paginationEnabled?: boolean;
  onPaginationChange?: (enabled: boolean) => void;
  themePreference?: DemoThemePreference;
  onThemePreferenceChange?: (preference: DemoThemePreference) => void;
  onStatus?: (message: string) => void;
};
