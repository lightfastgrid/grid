import { describe, expect, it } from "vitest";

import type { ColumnMenuOptions } from "../../../types";
import {
  hasDedicatedMenu,
  hasMainMenu,
  resolveFilterMenuOptions,
} from "../resolveFilterMenuOptions";

describe("resolveFilterMenuOptions", () => {
  it("defaults to mainMenu when menuOptions is undefined", () => {
    const r = resolveFilterMenuOptions(undefined);
    expect(r.conditionMainMenu).toBe(true);
    expect(r.conditionDedicatedMenu).toBe(false);
    expect(r.selectionMainMenu).toBe(true);
    expect(r.selectionDedicatedMenu).toBe(false);
  });

  it("returns NONE when enabled is false", () => {
    const r = resolveFilterMenuOptions({ enabled: false, filter: true });
    expect(hasMainMenu(r)).toBe(false);
    expect(hasDedicatedMenu(r)).toBe(false);
  });

  it("returns NONE when menuOptions is not an object", () => {
    const r = resolveFilterMenuOptions(false as unknown as ColumnMenuOptions);
    expect(hasMainMenu(r)).toBe(false);
    expect(hasDedicatedMenu(r)).toBe(false);
  });

  it("returns NONE when filter is false", () => {
    const r = resolveFilterMenuOptions({ filter: false });
    expect(hasMainMenu(r)).toBe(false);
    expect(hasDedicatedMenu(r)).toBe(false);
  });

  it("returns NONE when filter is omitted but other built-in keys present", () => {
    const r = resolveFilterMenuOptions({ sort: true });
    expect(hasMainMenu(r)).toBe(false);
    expect(hasDedicatedMenu(r)).toBe(false);
  });

  it("returns NONE when filter.enabled is false", () => {
    const r = resolveFilterMenuOptions({ filter: { enabled: false } });
    expect(hasMainMenu(r)).toBe(false);
    expect(hasDedicatedMenu(r)).toBe(false);
  });

  it("filter: true defaults to mainMenu placement", () => {
    const r = resolveFilterMenuOptions({ filter: true });
    expect(r.conditionMainMenu).toBe(true);
    expect(r.conditionDedicatedMenu).toBe(false);
    expect(r.selectionMainMenu).toBe(true);
    expect(r.selectionDedicatedMenu).toBe(false);
  });

  it("filter.placement: both with all defaults", () => {
    const r = resolveFilterMenuOptions({ filter: { placement: "both" } });
    expect(r.conditionMainMenu).toBe(true);
    expect(r.conditionDedicatedMenu).toBe(true);
    expect(r.selectionMainMenu).toBe(true);
    expect(r.selectionDedicatedMenu).toBe(true);
  });

  it("filter.placement: dedicatedMenu", () => {
    const r = resolveFilterMenuOptions({ filter: { placement: "dedicatedMenu" } });
    expect(r.conditionMainMenu).toBe(false);
    expect(r.conditionDedicatedMenu).toBe(true);
    expect(r.selectionMainMenu).toBe(false);
    expect(r.selectionDedicatedMenu).toBe(true);
  });

  it("filter.placement: mainMenu (explicit)", () => {
    const r = resolveFilterMenuOptions({ filter: { placement: "mainMenu" } });
    expect(r.conditionMainMenu).toBe(true);
    expect(r.conditionDedicatedMenu).toBe(false);
    expect(r.selectionMainMenu).toBe(true);
    expect(r.selectionDedicatedMenu).toBe(false);
  });

  describe("selectionList placement inherits filter placement", () => {
    it("inherits mainMenu", () => {
      const r = resolveFilterMenuOptions({
        filter: { placement: "mainMenu", selectionList: { enabled: true } },
      });
      expect(r.selectionMainMenu).toBe(true);
      expect(r.selectionDedicatedMenu).toBe(false);
    });

    it("inherits dedicatedMenu", () => {
      const r = resolveFilterMenuOptions({
        filter: { placement: "dedicatedMenu", selectionList: { enabled: true } },
      });
      expect(r.selectionMainMenu).toBe(false);
      expect(r.selectionDedicatedMenu).toBe(true);
    });

    it("inherits both", () => {
      const r = resolveFilterMenuOptions({
        filter: { placement: "both", selectionList: { enabled: true } },
      });
      expect(r.selectionMainMenu).toBe(true);
      expect(r.selectionDedicatedMenu).toBe(true);
    });
  });

  describe("selectionList disabled", () => {
    it("selectionList: false (shorthand)", () => {
      const r = resolveFilterMenuOptions({
        filter: { placement: "both", selectionList: false },
      });
      expect(r.conditionMainMenu).toBe(true);
      expect(r.conditionDedicatedMenu).toBe(true);
      expect(r.selectionMainMenu).toBe(false);
      expect(r.selectionDedicatedMenu).toBe(false);
    });

    it("selectionList.enabled: false", () => {
      const r = resolveFilterMenuOptions({
        filter: { placement: "both", selectionList: { enabled: false } },
      });
      expect(r.selectionMainMenu).toBe(false);
      expect(r.selectionDedicatedMenu).toBe(false);
    });

    it("selectionList.enabled: false ignores placement", () => {
      const r = resolveFilterMenuOptions({
        filter: { placement: "both", selectionList: { enabled: false, placement: "both" } },
      });
      expect(r.selectionMainMenu).toBe(false);
      expect(r.selectionDedicatedMenu).toBe(false);
    });
  });

  describe("selectionList placement differs from condition placement", () => {
    it("selectionList.placement: dedicatedMenu only", () => {
      const r = resolveFilterMenuOptions({
        filter: { placement: "both", selectionList: { enabled: true, placement: "dedicatedMenu" } },
      });
      expect(r.selectionMainMenu).toBe(false);
      expect(r.selectionDedicatedMenu).toBe(true);
      expect(r.conditionMainMenu).toBe(true);
      expect(r.conditionDedicatedMenu).toBe(true);
    });

    it("selectionList.placement: mainMenu only", () => {
      const r = resolveFilterMenuOptions({
        filter: { placement: "both", selectionList: { enabled: true, placement: "mainMenu" } },
      });
      expect(r.selectionMainMenu).toBe(true);
      expect(r.selectionDedicatedMenu).toBe(false);
    });

    it("conditions in mainMenu, selectionList in dedicatedMenu", () => {
      const r = resolveFilterMenuOptions({
        filter: {
          placement: "mainMenu",
          selectionList: { enabled: true, placement: "dedicatedMenu" },
        },
      });
      expect(r.conditionMainMenu).toBe(true);
      expect(r.conditionDedicatedMenu).toBe(false);
      expect(r.selectionMainMenu).toBe(false);
      expect(r.selectionDedicatedMenu).toBe(true);
    });

    it("conditions in dedicatedMenu, selectionList in both", () => {
      const r = resolveFilterMenuOptions({
        filter: {
          placement: "dedicatedMenu",
          selectionList: { enabled: true, placement: "both" },
        },
      });
      expect(r.conditionMainMenu).toBe(false);
      expect(r.conditionDedicatedMenu).toBe(true);
      expect(r.selectionMainMenu).toBe(true);
      expect(r.selectionDedicatedMenu).toBe(true);
    });
  });

  describe("selectionList: true shorthand inherits filter placement", () => {
    it("inherits both", () => {
      const r = resolveFilterMenuOptions({
        filter: { placement: "both", selectionList: true },
      });
      expect(r.selectionMainMenu).toBe(true);
      expect(r.selectionDedicatedMenu).toBe(true);
    });
  });

  describe("hasMainMenu / hasDedicatedMenu helpers", () => {
    it("hasMainMenu true when only selection in mainMenu", () => {
      const r = resolveFilterMenuOptions({
        filter: {
          placement: "dedicatedMenu",
          selectionList: { enabled: true, placement: "mainMenu" },
        },
      });
      expect(hasMainMenu(r)).toBe(true);
    });

    it("hasDedicatedMenu true when only selection in dedicatedMenu", () => {
      const r = resolveFilterMenuOptions({
        filter: {
          placement: "mainMenu",
          selectionList: { enabled: true, placement: "dedicatedMenu" },
        },
      });
      expect(hasDedicatedMenu(r)).toBe(true);
    });

    it("hasDedicatedMenu false when everything is mainMenu", () => {
      const r = resolveFilterMenuOptions({
        filter: { placement: "mainMenu" },
      });
      expect(hasDedicatedMenu(r)).toBe(false);
    });
  });

  describe("legacy filterPlacement compat", () => {
    it("filterPlacement: dedicatedMenu", () => {
      const r = resolveFilterMenuOptions({ filter: true, filterPlacement: "dedicatedMenu" });
      expect(r.conditionMainMenu).toBe(false);
      expect(r.conditionDedicatedMenu).toBe(true);
      expect(r.selectionMainMenu).toBe(false);
      expect(r.selectionDedicatedMenu).toBe(true);
    });

    it("filterPlacement: both", () => {
      const r = resolveFilterMenuOptions({ filter: true, filterPlacement: "both" });
      expect(r.conditionMainMenu).toBe(true);
      expect(r.conditionDedicatedMenu).toBe(true);
      expect(r.selectionMainMenu).toBe(true);
      expect(r.selectionDedicatedMenu).toBe(true);
    });

    it("filter.placement overrides legacy filterPlacement", () => {
      const r = resolveFilterMenuOptions({
        filter: { placement: "dedicatedMenu" },
        filterPlacement: "mainMenu",
      });
      expect(r.conditionMainMenu).toBe(false);
      expect(r.conditionDedicatedMenu).toBe(true);
    });

    it("filter as object without placement falls back to filterPlacement", () => {
      const r = resolveFilterMenuOptions({ filter: { clear: true }, filterPlacement: "dedicatedMenu" });
      expect(r.conditionMainMenu).toBe(false);
      expect(r.conditionDedicatedMenu).toBe(true);
    });

    it("disabled filter disables both placements even with filterPlacement set", () => {
      const r = resolveFilterMenuOptions({ filter: false, filterPlacement: "both" });
      expect(hasMainMenu(r)).toBe(false);
      expect(hasDedicatedMenu(r)).toBe(false);
    });

    it("enabled: false disables both placements", () => {
      const r = resolveFilterMenuOptions({ enabled: false, filter: true, filterPlacement: "both" });
      expect(hasMainMenu(r)).toBe(false);
      expect(hasDedicatedMenu(r)).toBe(false);
    });
  });
});
