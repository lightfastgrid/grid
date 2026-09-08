// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  applyGridRootAttributes,
  clearGridRootAttributes,
} from "../utils/attributesManager";

describe("attributesManager", () => {
  it("applies grid root structural attributes", () => {
    const root = document.createElement("div");
    root.tabIndex = 0;
    applyGridRootAttributes(root, {
      role: "grid",
      ariaRowCount: 12,
      ariaColCount: 4,
      ariaLabel: "Orders",
      ariaMultiselectable: true,
      ariaBusy: true,
    });
    expect(root.getAttribute("aria-label")).toBe("Orders");
    expect(root.getAttribute("aria-multiselectable")).toBe("true");
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(root.tabIndex).toBe(0);
    // aria-activedescendant is owned by the focus feature, not the plugin.
    expect(root.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("omits false boolean and unset naming attributes", () => {
    const root = document.createElement("div");
    applyGridRootAttributes(root, {
      role: "grid",
      ariaRowCount: 1,
      ariaColCount: 1,
      ariaMultiselectable: false,
      ariaBusy: false,
    });
    expect(root.getAttribute("aria-multiselectable")).toBeNull();
    expect(root.getAttribute("aria-busy")).toBeNull();
  });

  it("clears plugin-owned root attributes on detach", () => {
    const root = document.createElement("div");
    root.tabIndex = 0;
    applyGridRootAttributes(root, {
      role: "grid",
      ariaRowCount: 1,
      ariaColCount: 1,
      ariaMultiselectable: false,
      ariaBusy: false,
      ariaLabel: "Before",
    });
    clearGridRootAttributes(root);
    expect(root.getAttribute("role")).toBeNull();
    expect(root.getAttribute("aria-rowcount")).toBeNull();
    expect(root.getAttribute("aria-colcount")).toBeNull();
    expect(root.tabIndex).toBe(0);
  });
});
