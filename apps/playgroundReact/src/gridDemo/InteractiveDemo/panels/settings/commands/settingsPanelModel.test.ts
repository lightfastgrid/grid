import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDefaultDemoSettings,
  DEFAULT_DEMO_SETTINGS,
  resolveDemoThemeBase,
} from "./settingsPanelModel.ts";

describe("settingsPanelModel", () => {
  it("exposes stable defaults", () => {
    assert.deepEqual(DEFAULT_DEMO_SETTINGS, {
      groupedHeadersEnabled: false,
      floatingFiltersEnabled: true,
      paginationEnabled: true,
      themePreference: "dark",
    });
  });

  it("createDefaultDemoSettings returns a fresh copy", () => {
    const a = createDefaultDemoSettings();
    const b = createDefaultDemoSettings();
    assert.deepEqual(a, DEFAULT_DEMO_SETTINGS);
    assert.notEqual(a, b);
  });

  it("resolves System from prefers-color-scheme", () => {
    assert.equal(resolveDemoThemeBase("system", true), "dark");
    assert.equal(resolveDemoThemeBase("system", false), "light");
    assert.equal(resolveDemoThemeBase("light", true), "light");
    assert.equal(resolveDemoThemeBase("dark", false), "dark");
  });
});
