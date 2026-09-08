import type { ResolvedGridTheme } from "./types";

export const SEMANTIC_THEME_VARS = new Set([
  "--lfg-color-bg",
  "--lfg-color-surface",
  "--lfg-color-surface-muted",
  "--lfg-color-header-bg",
  "--lfg-color-border",
  "--lfg-color-text",
  "--lfg-color-muted",
  "--lfg-color-accent",
  "--lfg-color-accent-fg",
  "--lfg-color-selected-row",
  "--lfg-color-selected-column",
  "--lfg-color-overlay-bg",
  "--lfg-color-overlay-fg",
  "--lfg-color-tooltip-bg",
  "--lfg-color-tooltip-fg",
  "--lfg-font-family",
  "--lfg-font-size",
  "--lfg-cell-padding-x",
  "--lfg-cell-padding-y",
  "--lfg-radius-grid",
  "--lfg-radius-control",
  "--lfg-radius-menu",
  "--lfg-radius-tooltip",
  "--lfg-badge-active-bg",
  "--lfg-badge-active-fg",
  "--lfg-badge-active-dot",
  "--lfg-badge-pending-bg",
  "--lfg-badge-pending-fg",
  "--lfg-badge-pending-dot",
  "--lfg-badge-inactive-bg",
  "--lfg-badge-inactive-fg",
  "--lfg-badge-inactive-dot",
  "--lfg-badge-success-bg",
  "--lfg-badge-success-fg",
  "--lfg-badge-success-dot",
  "--lfg-badge-warning-bg",
  "--lfg-badge-warning-fg",
  "--lfg-badge-warning-dot",
  "--lfg-badge-danger-bg",
  "--lfg-badge-danger-fg",
  "--lfg-badge-danger-dot",
  "--lfg-badge-neutral-bg",
  "--lfg-badge-neutral-fg",
  "--lfg-badge-neutral-dot",
]);

export function applyGridTheme(
  root: HTMLElement,
  resolved: ResolvedGridTheme,
): void {
  root.setAttribute("data-theme", resolved.dataTheme);

  const style = root.style;

  // Remove only known semantic theme vars
  for (const varName of SEMANTIC_THEME_VARS) {
    style.removeProperty(varName);
  }

  // Apply new theme vars — only known semantic vars are allowed
  for (const [key, value] of Object.entries(resolved.cssVars)) {
    if (SEMANTIC_THEME_VARS.has(key)) {
      style.setProperty(key, value);
    }
  }
}
