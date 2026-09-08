// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_GRID_LAYOUT_METRICS } from "../../layout/gridLayoutMetrics";
import { applyGridTheme, SEMANTIC_THEME_VARS } from "../applyGridTheme";
import type { ResolvedGridTheme } from "../types";

function resolved(
  dataTheme: string,
  cssVars: Record<string, string> = {},
): ResolvedGridTheme {
  return { dataTheme, cssVars, layoutMetrics: DEFAULT_GRID_LAYOUT_METRICS };
}

describe("applyGridTheme", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
  });

  it("sets data-theme attribute", () => {
    applyGridTheme(root, resolved("dark"));
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("applies known semantic cssVars as inline style properties", () => {
    applyGridTheme(
      root,
      resolved("light", {
        "--lfg-color-bg": "#fff",
        "--lfg-color-accent": "#2563eb",
        "--lfg-color-accent-fg": "#ffffff",
      }),
    );
    expect(root.style.getPropertyValue("--lfg-color-bg")).toBe("#fff");
    expect(root.style.getPropertyValue("--lfg-color-accent")).toBe("#2563eb");
    expect(root.style.getPropertyValue("--lfg-color-accent-fg")).toBe(
      "#ffffff",
    );
  });

  it("removes known semantic vars and replaces with new ones", () => {
    root.style.setProperty("--lfg-color-bg", "#old");
    root.style.setProperty("--lfg-color-accent", "#old-accent");
    root.style.setProperty("--lfg-color-accent-fg", "#old-accent-fg");
    root.style.setProperty("--lfg-font-size", "12px");
    root.style.setProperty("--lfg-radius-grid", "4px");

    applyGridTheme(root, resolved("dark", { "--lfg-color-bg": "#new" }));

    expect(root.style.getPropertyValue("--lfg-color-bg")).toBe("#new");
    expect(root.style.getPropertyValue("--lfg-color-accent")).toBe("");
    expect(root.style.getPropertyValue("--lfg-color-accent-fg")).toBe("");
    expect(root.style.getPropertyValue("--lfg-font-size")).toBe("");
    expect(root.style.getPropertyValue("--lfg-radius-grid")).toBe("");
  });

  it("preserves unknown existing vars with theme-like prefixes", () => {
    root.style.setProperty("--lfg-color-bogus-custom", "#abc");
    root.style.setProperty("--lfg-font-weight", "bold");
    root.style.setProperty("--lfg-radius-unknown", "99px");

    applyGridTheme(root, resolved("dark", { "--lfg-color-bg": "#111" }));

    expect(root.style.getPropertyValue("--lfg-color-bogus-custom")).toBe("#abc");
    expect(root.style.getPropertyValue("--lfg-font-weight")).toBe("bold");
    expect(root.style.getPropertyValue("--lfg-radius-unknown")).toBe("99px");
    expect(root.style.getPropertyValue("--lfg-color-bg")).toBe("#111");
  });

  it("preserves renderer-owned layout vars", () => {
    root.style.setProperty("--lfg-row-height", "32px");
    root.style.setProperty("--lfg-header-height", "36px");
    root.style.setProperty("--lfg-viewport-height", "500px");
    root.style.setProperty("--lfg-total-width", "1000px");

    applyGridTheme(root, resolved("dark"));

    expect(root.style.getPropertyValue("--lfg-row-height")).toBe("32px");
    expect(root.style.getPropertyValue("--lfg-header-height")).toBe("36px");
    expect(root.style.getPropertyValue("--lfg-viewport-height")).toBe("500px");
    expect(root.style.getPropertyValue("--lfg-total-width")).toBe("1000px");
  });

  it("ignores unknown incoming vars", () => {
    applyGridTheme(root, resolved("dark", {
      "--lfg-color-bg": "#111",
      "--lfg-color-bogus-custom": "#red",
      "--lfg-font-weight": "bold",
      "--lfg-radius-unknown": "99px",
      "--totally-custom": "#abc",
    }));

    expect(root.style.getPropertyValue("--lfg-color-bg")).toBe("#111");
    expect(root.style.getPropertyValue("--lfg-color-bogus-custom")).toBe("");
    expect(root.style.getPropertyValue("--lfg-font-weight")).toBe("");
    expect(root.style.getPropertyValue("--lfg-radius-unknown")).toBe("");
    expect(root.style.getPropertyValue("--totally-custom")).toBe("");
  });

  it("never applies renderer-owned layout vars from theme input", () => {
    applyGridTheme(root, resolved("dark", {
      "--lfg-row-height": "32px",
      "--lfg-header-height": "36px",
      "--lfg-viewport-height": "500px",
      "--lfg-row-pinned-top-height": "40px",
      "--lfg-row-pinned-bottom-height": "40px",
      "--lfg-total-width": "1000px",
      "--lfg-left-pinned-width": "200px",
      "--lfg-right-pinned-width": "200px",
      "--lfg-color-accent": "#2563eb",
    }));

    expect(root.style.getPropertyValue("--lfg-row-height")).toBe("");
    expect(root.style.getPropertyValue("--lfg-header-height")).toBe("");
    expect(root.style.getPropertyValue("--lfg-viewport-height")).toBe("");
    expect(root.style.getPropertyValue("--lfg-total-width")).toBe("");
    expect(root.style.getPropertyValue("--lfg-color-accent")).toBe("#2563eb");
  });

  it("switches data-theme when called again", () => {
    applyGridTheme(root, resolved("dark"));
    expect(root.getAttribute("data-theme")).toBe("dark");

    applyGridTheme(root, resolved("light"));
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("SEMANTIC_THEME_VARS includes the core color / font / radius tokens", () => {
    const required = [
      "--lfg-color-bg",
      "--lfg-color-accent",
      "--lfg-color-accent-fg",
      "--lfg-font-family",
      "--lfg-radius-grid",
      "--lfg-cell-padding-x",
      "--lfg-cell-padding-y",
      "--lfg-radius-tooltip",
    ];
    for (const token of required) {
      expect(SEMANTIC_THEME_VARS.has(token)).toBe(true);
    }
  });

  it("SEMANTIC_THEME_VARS includes bg/fg/dot for every badge tone", () => {
    const tones = [
      "active",
      "pending",
      "inactive",
      "success",
      "warning",
      "danger",
      "neutral",
    ];
    for (const tone of tones) {
      for (const part of ["bg", "fg", "dot"]) {
        expect(SEMANTIC_THEME_VARS.has(`--lfg-badge-${tone}-${part}`)).toBe(true);
      }
    }
  });

  it("applies badge tone vars as known semantic vars", () => {
    applyGridTheme(
      root,
      resolved("dark", {
        "--lfg-badge-success-bg": "rgba(34, 197, 94, 0.16)",
        "--lfg-badge-success-fg": "#4ade80",
        "--lfg-badge-success-dot": "#22c55e",
        "--lfg-badge-danger-fg": "#f87171",
      }),
    );

    expect(root.style.getPropertyValue("--lfg-badge-success-bg")).toBe(
      "rgba(34, 197, 94, 0.16)",
    );
    expect(root.style.getPropertyValue("--lfg-badge-success-fg")).toBe("#4ade80");
    expect(root.style.getPropertyValue("--lfg-badge-success-dot")).toBe("#22c55e");
    expect(root.style.getPropertyValue("--lfg-badge-danger-fg")).toBe("#f87171");
  });

  it("removes old badge tone vars on theme switch", () => {
    applyGridTheme(
      root,
      resolved("dark", {
        "--lfg-badge-active-fg": "#7ab8ff",
        "--lfg-badge-success-fg": "#4ade80",
      }),
    );
    expect(root.style.getPropertyValue("--lfg-badge-active-fg")).toBe("#7ab8ff");

    // Switch to a theme that only supplies one badge token — the others must
    // be cleared rather than lingering from the previous palette.
    applyGridTheme(
      root,
      resolved("light", { "--lfg-badge-active-fg": "#2563eb" }),
    );

    expect(root.style.getPropertyValue("--lfg-badge-active-fg")).toBe("#2563eb");
    expect(root.style.getPropertyValue("--lfg-badge-success-fg")).toBe("");
  });
});
