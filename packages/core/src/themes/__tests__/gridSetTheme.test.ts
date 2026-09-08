// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../Grid";
import { DomGridRenderer } from "../../rendering/DomGridRenderer";

describe("Grid.setTheme (mounted)", () => {
  let container: HTMLElement;
  let grid: Grid;

  function gridRoot(): HTMLElement {
    return container.querySelector(".lfg-grid")!;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    grid.destroy();
    document.body.removeChild(container);
  });

  it("switches from object light to string dark without remounting root", () => {
    grid = new Grid({
      columns: [{ field: "a" }],
      rows: [{ a: 1 }],
      theme: { base: "light", accentColor: "#2563eb" },
    });
    grid.mount(container);

    const root = gridRoot();
    expect(root).toBeTruthy();
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.style.getPropertyValue("--lfg-color-accent")).toBe("#2563eb");
    expect(root.style.getPropertyValue("--lfg-color-bg")).toBe("#ffffff");

    const rootBefore = root;

    // Switch to string "dark"
    grid.setTheme("dark");

    expect(gridRoot()).toBe(rootBefore);
    expect(root.getAttribute("data-theme")).toBe("dark");
    // String themes have empty cssVars — managed vars are cleared
    expect(root.style.getPropertyValue("--lfg-color-accent")).toBe("");
    expect(root.style.getPropertyValue("--lfg-color-bg")).toBe("");
  });

  it("switches from string dark to object light with radius", () => {
    grid = new Grid({
      columns: [{ field: "a" }],
      rows: [],
      theme: "dark",
    });
    grid.mount(container);

    const root = gridRoot();
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.getPropertyValue("--lfg-radius-grid")).toBe("");

    grid.setTheme({ base: "light", radius: "md" });

    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.style.getPropertyValue("--lfg-color-bg")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--lfg-radius-grid")).toBe("6px");
  });

  it("setTheme(undefined) resets to default dark and clears managed vars", () => {
    grid = new Grid({
      columns: [{ field: "a" }],
      rows: [],
      theme: { base: "light", accentColor: "#ff0000", radius: "lg" },
    });
    grid.mount(container);

    const root = gridRoot();
    expect(root.style.getPropertyValue("--lfg-color-accent")).toBe("#ff0000");
    expect(root.style.getPropertyValue("--lfg-radius-grid")).toBe("10px");

    grid.setTheme(undefined);

    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.getPropertyValue("--lfg-color-accent")).toBe("");
    expect(root.style.getPropertyValue("--lfg-color-bg")).toBe("");
    expect(root.style.getPropertyValue("--lfg-radius-grid")).toBe("");
  });

  it("preserves renderer-owned layout vars across theme switches", () => {
    grid = new Grid({
      columns: [{ field: "a" }],
      rows: [],
      theme: { base: "dark" },
    });
    grid.mount(container);

    const root = gridRoot();
    const headerHeight = root.style.getPropertyValue("--lfg-header-height");
    const rowHeight = root.style.getPropertyValue("--lfg-row-height");
    expect(headerHeight).toBeTruthy();
    expect(rowHeight).toBeTruthy();

    grid.setTheme({ base: "light", accentColor: "#2563eb" });

    expect(root.style.getPropertyValue("--lfg-header-height")).toBe(headerHeight);
    expect(root.style.getPropertyValue("--lfg-row-height")).toBe(rowHeight);
  });

  it("switches to custom string theme", () => {
    grid = new Grid({
      columns: [{ field: "a" }],
      rows: [],
      theme: { base: "light" },
    });
    grid.mount(container);

    const root = gridRoot();
    grid.setTheme("my-brand");

    expect(root.getAttribute("data-theme")).toBe("my-brand");
    // All managed vars cleared since string themes have no cssVars
    expect(root.style.getPropertyValue("--lfg-color-bg")).toBe("");
  });

  it("initial compact density writes correct CSS vars", () => {
    grid = new Grid({
      columns: [{ field: "a" }],
      rows: [{ a: 1 }],
      theme: { base: "dark", density: "compact" },
    });
    grid.mount(container);

    const root = gridRoot();
    expect(root.style.getPropertyValue("--lfg-row-height")).toBe("32px");
    expect(root.style.getPropertyValue("--lfg-header-height")).toBe("36px");
  });

  it("runtime setTheme with density updates CSS vars", () => {
    grid = new Grid({
      columns: [{ field: "a" }],
      rows: [{ a: 1 }],
      theme: { base: "dark" },
    });
    grid.mount(container);

    const root = gridRoot();
    expect(root.style.getPropertyValue("--lfg-row-height")).toBe("40px");
    expect(root.style.getPropertyValue("--lfg-header-height")).toBe("40px");
    expect(root.style.getPropertyValue("--lfg-floating-filter-height")).toBe("40px");

    grid.setTheme({ base: "dark", density: "comfortable" });

    expect(root.style.getPropertyValue("--lfg-row-height")).toBe("48px");
    expect(root.style.getPropertyValue("--lfg-header-height")).toBe("44px");
    expect(root.style.getPropertyValue("--lfg-floating-filter-height")).toBe("48px");
  });

  it("switching back to string theme restores default metrics", () => {
    grid = new Grid({
      columns: [{ field: "a" }],
      rows: [{ a: 1 }],
      theme: { base: "dark", density: "compact" },
    });
    grid.mount(container);

    const root = gridRoot();
    expect(root.style.getPropertyValue("--lfg-row-height")).toBe("32px");

    grid.setTheme("dark");

    expect(root.style.getPropertyValue("--lfg-row-height")).toBe("40px");
    expect(root.style.getPropertyValue("--lfg-header-height")).toBe("40px");
  });

  describe("idempotent setTheme", () => {
    it("does not call renderer setTheme when resolved theme is unchanged", () => {
      grid = new Grid({
        columns: [{ field: "a" }],
        rows: [{ a: 1 }],
        theme: { base: "dark", density: "compact" },
      });
      grid.mount(container);

      const spy = vi.spyOn(
        DomGridRenderer.prototype,
        "setTheme",
      );

      grid.setTheme({ base: "dark", density: "compact" });
      expect(spy).not.toHaveBeenCalled();

      spy.mockRestore();
    });

    it("calls renderer setTheme when density changes", () => {
      grid = new Grid({
        columns: [{ field: "a" }],
        rows: [{ a: 1 }],
        theme: { base: "dark", density: "compact" },
      });
      grid.mount(container);

      const spy = vi.spyOn(
        DomGridRenderer.prototype,
        "setTheme",
      );

      grid.setTheme({ base: "dark", density: "comfortable" });
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockRestore();
    });

    it("calls renderer setTheme when accent changes", () => {
      grid = new Grid({
        columns: [{ field: "a" }],
        rows: [{ a: 1 }],
        theme: { base: "dark", accentColor: "#ff0000" },
      });
      grid.mount(container);

      const spy = vi.spyOn(
        DomGridRenderer.prototype,
        "setTheme",
      );

      grid.setTheme({ base: "dark", accentColor: "#00ff00" });
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockRestore();
    });

    it("calls renderer setTheme when base changes", () => {
      grid = new Grid({
        columns: [{ field: "a" }],
        rows: [{ a: 1 }],
        theme: { base: "dark" },
      });
      grid.mount(container);

      const spy = vi.spyOn(
        DomGridRenderer.prototype,
        "setTheme",
      );

      grid.setTheme({ base: "light" });
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockRestore();
    });

    it("does not call renderer setTheme for repeated string theme", () => {
      grid = new Grid({
        columns: [{ field: "a" }],
        rows: [{ a: 1 }],
        theme: "dark",
      });
      grid.mount(container);

      const spy = vi.spyOn(
        DomGridRenderer.prototype,
        "setTheme",
      );

      grid.setTheme("dark");
      expect(spy).not.toHaveBeenCalled();

      spy.mockRestore();
    });
  });

  it("setTheme(undefined) restores default metrics from compact", () => {
    grid = new Grid({
      columns: [{ field: "a" }],
      rows: [{ a: 1 }],
      theme: { density: "compact" },
    });
    grid.mount(container);

    const root = gridRoot();
    expect(root.style.getPropertyValue("--lfg-row-height")).toBe("32px");

    grid.setTheme(undefined);

    expect(root.style.getPropertyValue("--lfg-row-height")).toBe("40px");
    expect(root.style.getPropertyValue("--lfg-header-height")).toBe("40px");
  });
});
