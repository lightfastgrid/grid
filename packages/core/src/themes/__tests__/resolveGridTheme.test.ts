import { describe, expect, it } from "vitest";

import { resolveGridTheme } from "../resolveGridTheme";

describe("resolveGridTheme", () => {
  it("returns dark with no cssVars when theme is undefined", () => {
    const result = resolveGridTheme(undefined);
    expect(result.dataTheme).toBe("dark");
    expect(result.cssVars).toEqual({});
  });

  it('returns dark with no cssVars for string "dark"', () => {
    const result = resolveGridTheme("dark");
    expect(result.dataTheme).toBe("dark");
    expect(result.cssVars).toEqual({});
  });

  it('returns light with no cssVars for string "light"', () => {
    const result = resolveGridTheme("light");
    expect(result.dataTheme).toBe("light");
    expect(result.cssVars).toEqual({});
  });

  it("passes custom string themes through as dataTheme", () => {
    const result = resolveGridTheme("my-brand");
    expect(result.dataTheme).toBe("my-brand");
    expect(result.cssVars).toEqual({});
  });

  it("resolves object theme with dark base palette", () => {
    const result = resolveGridTheme({ base: "dark" });
    expect(result.dataTheme).toBe("dark");
    expect(result.cssVars["--lfg-color-bg"]).toBe("#0B1120");
    expect(result.cssVars["--lfg-color-accent"]).toBe("#2563FF");
    expect(result.cssVars["--lfg-color-accent-fg"]).toBe("#FFFFFF");
    expect(result.cssVars["--lfg-color-text"]).toBe("#cccccc");
    expect(result.cssVars["--lfg-color-selected-row"]).toBe("#111B33");
    expect(result.cssVars["--lfg-color-selected-column"]).toBe("#111B33");
    expect(result.cssVars["--lfg-font-family"]).toBe(
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    );
    expect(result.cssVars["--lfg-font-size"]).toBe("14px");
  });

  it("resolves object theme with light base palette", () => {
    const result = resolveGridTheme({ base: "light" });
    expect(result.dataTheme).toBe("light");
    expect(result.cssVars["--lfg-color-bg"]).toBe("#ffffff");
    expect(result.cssVars["--lfg-color-accent"]).toBe("#2563FF");
    expect(result.cssVars["--lfg-color-accent-fg"]).toBe("#ffffff");
    expect(result.cssVars["--lfg-color-text"]).toBe("#1c1f26");
    expect(result.cssVars["--lfg-color-border"]).toBe("#e6e8ec");
    expect(result.cssVars["--lfg-color-selected-row"]).toBe("#eef3ff");
    expect(result.cssVars["--lfg-color-selected-column"]).toBe("#eef3ff");
  });

  it("defaults base to dark when omitted in object theme", () => {
    const result = resolveGridTheme({});
    expect(result.dataTheme).toBe("dark");
    expect(result.cssVars["--lfg-color-bg"]).toBe("#0B1120");
  });

  it("overrides accent color and derives active badge tones", () => {
    const result = resolveGridTheme({
      base: "light",
      accentColor: "#ff0000",
    });
    expect(result.cssVars["--lfg-color-accent"]).toBe("#ff0000");
    expect(result.cssVars["--lfg-color-accent-fg"]).toBe("#ffffff");
    expect(result.cssVars["--lfg-color-selected-column"]).toBe("#eef3ff");
    expect(result.cssVars["--lfg-color-selected-row"]).toBe("#eef3ff");
    expect(result.cssVars["--lfg-badge-active-fg"]).toBe("#ff0000");
    expect(result.cssVars["--lfg-badge-active-dot"]).toBe("#ff0000");
    expect(result.cssVars["--lfg-badge-active-bg"]).toBe(
      "color-mix(in srgb, #ff0000 14%, transparent)",
    );
  });

  it("derives a dark accent foreground for bright accent colors", () => {
    const result = resolveGridTheme({
      base: "dark",
      accentColor: "#f59e0b",
    });
    expect(result.cssVars["--lfg-color-accent"]).toBe("#f59e0b");
    expect(result.cssVars["--lfg-color-accent-fg"]).toBe("#0f172a");
  });

  it("keeps the base accent foreground for non-hex accent colors", () => {
    const result = resolveGridTheme({
      base: "light",
      accentColor: "var(--brand-accent)",
    });
    expect(result.cssVars["--lfg-color-accent"]).toBe("var(--brand-accent)");
    expect(result.cssVars["--lfg-color-accent-fg"]).toBe("#ffffff");
  });

  it("applies radius preset", () => {
    const result = resolveGridTheme({ radius: "md" });
    expect(result.cssVars["--lfg-radius-grid"]).toBe("6px");
    expect(result.cssVars["--lfg-radius-control"]).toBe("4px");
    expect(result.cssVars["--lfg-radius-menu"]).toBe("6px");
    expect(result.cssVars["--lfg-radius-tooltip"]).toBe("6px");
  });

  it("applies none radius preset", () => {
    const result = resolveGridTheme({ radius: "none" });
    expect(result.cssVars["--lfg-radius-grid"]).toBe("0");
    expect(result.cssVars["--lfg-radius-control"]).toBe("0");
  });

  it("applies lg radius preset", () => {
    const result = resolveGridTheme({ radius: "lg" });
    expect(result.cssVars["--lfg-radius-grid"]).toBe("10px");
    expect(result.cssVars["--lfg-radius-tooltip"]).toBe("8px");
  });

  it("combines accent and radius in one object theme", () => {
    const result = resolveGridTheme({
      base: "light",
      accentColor: "#2563eb",
      radius: "sm",
    });
    expect(result.cssVars["--lfg-color-accent"]).toBe("#2563eb");
    expect(result.cssVars["--lfg-radius-grid"]).toBe("2px");
    expect(result.cssVars["--lfg-color-bg"]).toBe("#ffffff");
  });

  describe("badge tone tokens", () => {
    const TONES = ["active", "pending", "inactive", "success", "warning", "danger", "neutral"] as const;

    it("dark palette includes all badge tone tokens", () => {
      const result = resolveGridTheme({ base: "dark" });
      for (const tone of TONES) {
        expect(result.cssVars[`--lfg-badge-${tone}-bg`]).toBeDefined();
        expect(result.cssVars[`--lfg-badge-${tone}-fg`]).toBeDefined();
        expect(result.cssVars[`--lfg-badge-${tone}-dot`]).toBeDefined();
      }
    });

    it("light palette includes all badge tone tokens", () => {
      const result = resolveGridTheme({ base: "light" });
      for (const tone of TONES) {
        expect(result.cssVars[`--lfg-badge-${tone}-bg`]).toBeDefined();
        expect(result.cssVars[`--lfg-badge-${tone}-fg`]).toBeDefined();
        expect(result.cssVars[`--lfg-badge-${tone}-dot`]).toBeDefined();
      }
    });

    it("dark and light palettes have different badge-active-fg values", () => {
      const dark = resolveGridTheme({ base: "dark" });
      const light = resolveGridTheme({ base: "light" });
      expect(dark.cssVars["--lfg-badge-active-fg"]).not.toBe(
        light.cssVars["--lfg-badge-active-fg"],
      );
    });
  });

  describe("density → layoutMetrics", () => {
    it("compact maps to rowHeight 32, headerHeight 36", () => {
      const result = resolveGridTheme({ density: "compact" });
      expect(result.layoutMetrics).toEqual({
        rowHeight: 32,
        headerHeight: 36,
      });
    });

    it("standard maps to rowHeight 40, headerHeight 40", () => {
      const result = resolveGridTheme({ density: "standard" });
      expect(result.layoutMetrics).toEqual({
        rowHeight: 40,
        headerHeight: 40,
      });
    });

    it("comfortable maps to rowHeight 48, headerHeight 44", () => {
      const result = resolveGridTheme({ density: "comfortable" });
      expect(result.layoutMetrics).toEqual({
        rowHeight: 48,
        headerHeight: 44,
      });
    });

    it("omitted density defaults to standard metrics", () => {
      const result = resolveGridTheme({ base: "light" });
      expect(result.layoutMetrics).toEqual({
        rowHeight: 40,
        headerHeight: 40,
      });
    });

    it("undefined theme uses default metrics", () => {
      const result = resolveGridTheme(undefined);
      expect(result.layoutMetrics).toEqual({
        rowHeight: 40,
        headerHeight: 40,
      });
    });

    it("string theme uses default metrics", () => {
      const result = resolveGridTheme("dark");
      expect(result.layoutMetrics).toEqual({
        rowHeight: 40,
        headerHeight: 40,
      });
    });

    it("custom string theme uses default metrics", () => {
      const result = resolveGridTheme("my-brand");
      expect(result.layoutMetrics).toEqual({
        rowHeight: 40,
        headerHeight: 40,
      });
    });

    it("combines density with accent and radius", () => {
      const result = resolveGridTheme({
        base: "light",
        accentColor: "#2563eb",
        radius: "md",
        density: "compact",
      });
      expect(result.layoutMetrics).toEqual({
        rowHeight: 32,
        headerHeight: 36,
      });
      expect(result.cssVars["--lfg-color-accent"]).toBe("#2563eb");
      expect(result.cssVars["--lfg-radius-grid"]).toBe("6px");
      expect(result.cssVars["--lfg-cell-padding-x"]).toBe("10px");
      expect(result.cssVars["--lfg-cell-padding-y"]).toBe("6px");
    });

    it("maps density to cell padding tokens", () => {
      expect(resolveGridTheme({ density: "compact" }).cssVars).toMatchObject({
        "--lfg-cell-padding-x": "10px",
        "--lfg-cell-padding-y": "6px",
      });
      expect(resolveGridTheme({ density: "standard" }).cssVars).toMatchObject({
        "--lfg-cell-padding-x": "12px",
        "--lfg-cell-padding-y": "8px",
      });
      expect(resolveGridTheme({ density: "comfortable" }).cssVars).toMatchObject({
        "--lfg-cell-padding-x": "14px",
        "--lfg-cell-padding-y": "10px",
      });
    });

    it("omitted density uses standard cell padding in object themes", () => {
      const result = resolveGridTheme({ base: "light" });
      expect(result.cssVars["--lfg-cell-padding-x"]).toBe("12px");
      expect(result.cssVars["--lfg-cell-padding-y"]).toBe("8px");
    });
  });
});
