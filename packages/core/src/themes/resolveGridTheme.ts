import {
  DEFAULT_GRID_LAYOUT_METRICS,
  resolveDensityCellPadding,
  resolveDensityMetrics,
} from "../layout/gridLayoutMetrics";

import {
  DEFAULT_GRID_FONT_FAMILY,
  DEFAULT_GRID_FONT_SIZE,
} from "./gridTypography";
import type {
  GridThemeInput,
  GridThemeOptions,
  GridThemeRadius,
  ResolvedGridTheme,
} from "./types";

const DARK_VARS: Record<string, string> = {
  // Brand dark palette: Deep Navy / Electric / Cobalt / Soft White / Steel Gray
  "--lfg-color-bg": "#0B1120",
  "--lfg-color-surface": "#151C2E",
  "--lfg-color-surface-muted": "#101828",
  "--lfg-color-header-bg": "#0B1120",
  "--lfg-color-border": "#1E293B",
  "--lfg-color-text": "#cccccc",
  "--lfg-color-muted": "#8B95A7",
  "--lfg-color-accent": "#2563FF",
  "--lfg-color-accent-fg": "#FFFFFF",
  "--lfg-color-selected-row": "#111B33",
  "--lfg-color-selected-column": "#111B33",
  "--lfg-color-overlay-bg": "rgba(11, 17, 32, 0.92)",
  "--lfg-color-overlay-fg": "#F8F7FA",
  "--lfg-color-tooltip-bg": "#151C2E",
  "--lfg-color-tooltip-fg": "#F8F7FA",
  "--lfg-color-invalid": "#e53e3e",
  "--lfg-badge-active-bg": "rgba(37, 99, 255, 0.14)",
  "--lfg-badge-active-fg": "#60A5FA",
  "--lfg-badge-active-dot": "#3B82F6",
  "--lfg-badge-active-border": "rgba(59, 130, 246, 0.45)",
  "--lfg-badge-pending-bg": "rgba(234, 179, 8, 0.12)",
  "--lfg-badge-pending-fg": "#F5D76E",
  "--lfg-badge-pending-dot": "#EAB308",
  "--lfg-badge-pending-border": "rgba(234, 179, 8, 0.45)",
  "--lfg-badge-inactive-bg": "rgba(139, 149, 167, 0.12)",
  "--lfg-badge-inactive-fg": "#B0B8C7",
  "--lfg-badge-inactive-dot": "#8B95A7",
  "--lfg-badge-inactive-border": "rgba(139, 149, 167, 0.4)",
  "--lfg-badge-success-bg": "rgba(34, 197, 94, 0.12)",
  "--lfg-badge-success-fg": "#6EE7A0",
  "--lfg-badge-success-dot": "#34D399",
  "--lfg-badge-success-border": "rgba(52, 211, 153, 0.45)",
  "--lfg-badge-warning-bg": "rgba(249, 115, 22, 0.12)",
  "--lfg-badge-warning-fg": "#FB923C",
  "--lfg-badge-warning-dot": "#F97316",
  "--lfg-badge-warning-border": "rgba(249, 115, 22, 0.45)",
  "--lfg-badge-danger-bg": "rgba(239, 68, 68, 0.12)",
  "--lfg-badge-danger-fg": "#F87171",
  "--lfg-badge-danger-dot": "#EF4444",
  "--lfg-badge-danger-border": "rgba(239, 68, 68, 0.45)",
  "--lfg-badge-neutral-bg": "rgba(139, 149, 167, 0.1)",
  "--lfg-badge-neutral-fg": "#8B95A7",
  "--lfg-badge-neutral-dot": "#8B95A7",
  "--lfg-badge-neutral-border": "rgba(139, 149, 167, 0.35)",
  "--lfg-font-family": DEFAULT_GRID_FONT_FAMILY,
  "--lfg-font-size": DEFAULT_GRID_FONT_SIZE,
};

const LIGHT_VARS: Record<string, string> = {
  // Professional light: soft canvas, quiet borders, restrained selection.
  "--lfg-color-bg": "#ffffff",
  "--lfg-color-surface": "#f7f8fa",
  "--lfg-color-surface-muted": "#eef0f3",
  "--lfg-color-header-bg": "#f7f8fa",
  "--lfg-color-border": "#e6e8ec",
  "--lfg-color-text": "#1c1f26",
  "--lfg-color-muted": "#6b7280",
  "--lfg-color-accent": "#2563FF",
  "--lfg-color-accent-fg": "#ffffff",
  "--lfg-color-selected-row": "#eef3ff",
  "--lfg-color-selected-column": "#eef3ff",
  "--lfg-color-overlay-bg": "rgba(255, 255, 255, 0.96)",
  "--lfg-color-overlay-fg": "#1c1f26",
  "--lfg-color-tooltip-bg": "#1c1f26",
  "--lfg-color-tooltip-fg": "#f8fafc",
  "--lfg-color-invalid": "#dc2626",
  "--lfg-badge-active-bg": "rgba(37, 99, 255, 0.08)",
  "--lfg-badge-active-fg": "#1d4ed8",
  "--lfg-badge-active-dot": "#2563FF",
  "--lfg-badge-active-border": "rgba(37, 99, 255, 0.35)",
  "--lfg-badge-pending-bg": "rgba(202, 138, 4, 0.10)",
  "--lfg-badge-pending-fg": "#a16207",
  "--lfg-badge-pending-dot": "#ca8a04",
  "--lfg-badge-pending-border": "rgba(202, 138, 4, 0.4)",
  "--lfg-badge-inactive-bg": "rgba(107, 114, 128, 0.08)",
  "--lfg-badge-inactive-fg": "#4b5563",
  "--lfg-badge-inactive-dot": "#6b7280",
  "--lfg-badge-inactive-border": "rgba(107, 114, 128, 0.35)",
  "--lfg-badge-success-bg": "rgba(22, 163, 74, 0.10)",
  "--lfg-badge-success-fg": "#15803d",
  "--lfg-badge-success-dot": "#16a34a",
  "--lfg-badge-success-border": "rgba(22, 163, 74, 0.4)",
  "--lfg-badge-warning-bg": "rgba(234, 88, 12, 0.10)",
  "--lfg-badge-warning-fg": "#c2410c",
  "--lfg-badge-warning-dot": "#ea580c",
  "--lfg-badge-warning-border": "rgba(234, 88, 12, 0.4)",
  "--lfg-badge-danger-bg": "rgba(220, 38, 38, 0.10)",
  "--lfg-badge-danger-fg": "#b91c1c",
  "--lfg-badge-danger-dot": "#dc2626",
  "--lfg-badge-danger-border": "rgba(220, 38, 38, 0.4)",
  "--lfg-badge-neutral-bg": "rgba(107, 114, 128, 0.07)",
  "--lfg-badge-neutral-fg": "#4b5563",
  "--lfg-badge-neutral-dot": "#6b7280",
  "--lfg-badge-neutral-border": "rgba(107, 114, 128, 0.32)",
  "--lfg-font-family": DEFAULT_GRID_FONT_FAMILY,
  "--lfg-font-size": DEFAULT_GRID_FONT_SIZE,
};

const RADIUS_MAP: Record<GridThemeRadius, Record<string, string>> = {
  none: {
    "--lfg-radius-grid": "0",
    "--lfg-radius-control": "0",
    "--lfg-radius-menu": "0",
    "--lfg-radius-tooltip": "0",
  },
  sm: {
    "--lfg-radius-grid": "2px",
    "--lfg-radius-control": "2px",
    "--lfg-radius-menu": "3px",
    "--lfg-radius-tooltip": "3px",
  },
  md: {
    "--lfg-radius-grid": "6px",
    "--lfg-radius-control": "4px",
    "--lfg-radius-menu": "6px",
    "--lfg-radius-tooltip": "6px",
  },
  lg: {
    "--lfg-radius-grid": "10px",
    "--lfg-radius-control": "6px",
    "--lfg-radius-menu": "10px",
    "--lfg-radius-tooltip": "8px",
  },
};

function parseHexColor(
  value: string,
): { r: number; g: number; b: number } | null {
  const trimmed = value.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (!match) return null;

  const hex = match[1]!;
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : hex;

  return {
    r: Number.parseInt(expanded!.slice(0, 2), 16),
    g: Number.parseInt(expanded!.slice(2, 4), 16),
    b: Number.parseInt(expanded!.slice(4, 6), 16),
  };
}

function channelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function getRelativeLuminance({
  r,
  g,
  b,
}: {
  r: number;
  g: number;
  b: number;
}): number {
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

function resolveAccentForeground(accentColor: string, fallback: string): string {
  const rgb = parseHexColor(accentColor);
  if (!rgb) return fallback;

  const luminance = getRelativeLuminance(rgb);
  // Threshold 0.36 matches common UI convention: saturated colors like
  // red (#ff0000, L≈0.21) get white text, while bright colors like
  // amber (#f59e0b, L≈0.42) get dark text.
  return luminance > 0.36 ? "#0f172a" : "#ffffff";
}

function isThemeOptions(theme: GridThemeInput): theme is GridThemeOptions {
  return typeof theme === "object";
}

function accentColorMix(accent: string, percent: number): string {
  return `color-mix(in srgb, ${accent} ${percent}%, transparent)`;
}

function resolveObjectTheme(opts: GridThemeOptions): ResolvedGridTheme {
  const base = opts.base ?? "dark";
  const baseVars = base === "light" ? { ...LIGHT_VARS } : { ...DARK_VARS };
  const cssVars: Record<string, string> = { ...baseVars };

  if (opts.accentColor) {
    cssVars["--lfg-color-accent"] = opts.accentColor;
    cssVars["--lfg-color-accent-fg"] = resolveAccentForeground(
      opts.accentColor,
      baseVars["--lfg-color-accent-fg"]!,
    );
    cssVars["--lfg-badge-active-fg"] = opts.accentColor;
    cssVars["--lfg-badge-active-dot"] = opts.accentColor;
    cssVars["--lfg-badge-active-bg"] = accentColorMix(opts.accentColor, 14);
    cssVars["--lfg-badge-active-border"] = accentColorMix(opts.accentColor, 45);
  }

  if (opts.radius) {
    Object.assign(cssVars, RADIUS_MAP[opts.radius]);
  }

  const cellPadding = resolveDensityCellPadding(opts.density);
  cssVars["--lfg-cell-padding-x"] = cellPadding.x;
  cssVars["--lfg-cell-padding-y"] = cellPadding.y;

  return {
    dataTheme: base,
    cssVars,
    layoutMetrics: resolveDensityMetrics(opts.density),
  };
}

export function resolvedThemeEqual(
  a: ResolvedGridTheme,
  b: ResolvedGridTheme,
): boolean {
  if (a.dataTheme !== b.dataTheme) return false;
  if (
    a.layoutMetrics.rowHeight !== b.layoutMetrics.rowHeight ||
    a.layoutMetrics.headerHeight !== b.layoutMetrics.headerHeight
  ) return false;
  const aKeys = Object.keys(a.cssVars);
  const bKeys = Object.keys(b.cssVars);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a.cssVars[key] !== b.cssVars[key]) return false;
  }
  return true;
}

export function resolveGridTheme(
  theme: GridThemeInput | undefined,
): ResolvedGridTheme {
  if (theme === undefined) {
    return {
      dataTheme: "dark",
      cssVars: {},
      layoutMetrics: DEFAULT_GRID_LAYOUT_METRICS,
    };
  }

  if (isThemeOptions(theme)) {
    return resolveObjectTheme(theme);
  }

  // String theme — "dark", "light", or custom
  return {
    dataTheme: theme,
    cssVars: {},
    layoutMetrics: DEFAULT_GRID_LAYOUT_METRICS,
  };
}
