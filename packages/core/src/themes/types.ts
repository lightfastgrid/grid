import type { GridLayoutMetrics } from "../layout/gridLayoutMetrics";

export type GridThemeBase = "light" | "dark";

export type GridThemeDensity = "compact" | "standard" | "comfortable";

export type GridThemeRadius = "none" | "sm" | "md" | "lg";

export interface GridThemeOptions {
  base?: GridThemeBase;
  accentColor?: string;
  radius?: GridThemeRadius;
  density?: GridThemeDensity;
}

export type GridThemeInput = GridThemeBase | string | GridThemeOptions;

export interface ResolvedGridTheme {
  dataTheme: string;
  cssVars: Record<string, string>;
  layoutMetrics: GridLayoutMetrics;
}
