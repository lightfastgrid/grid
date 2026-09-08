import type { GridThemeBase } from "@lightfastgrid/core";

/** User-facing theme preference in Settings (System follows OS). */
export type DemoThemePreference = "light" | "dark" | "system";

export type DemoSettingsSnapshot = {
  groupedHeadersEnabled: boolean;
  floatingFiltersEnabled: boolean;
  paginationEnabled: boolean;
  themePreference: DemoThemePreference;
};

export const DEFAULT_DEMO_SETTINGS: DemoSettingsSnapshot = {
  groupedHeadersEnabled: false,
  floatingFiltersEnabled: true,
  paginationEnabled: true,
  themePreference: "dark",
};

export const DEMO_THEME_OPTIONS = [
  { value: "light" as const, label: "Light" },
  { value: "dark" as const, label: "Dark" },
  { value: "system" as const, label: "System" },
] as const;

/** Resolve Light/Dark/System → concrete grid `theme.base`. */
export function resolveDemoThemeBase(
  preference: DemoThemePreference,
  prefersDark: boolean,
): GridThemeBase {
  if (preference === "system") {
    return prefersDark ? "dark" : "light";
  }
  return preference;
}

export function createDefaultDemoSettings(): DemoSettingsSnapshot {
  return { ...DEFAULT_DEMO_SETTINGS };
}
