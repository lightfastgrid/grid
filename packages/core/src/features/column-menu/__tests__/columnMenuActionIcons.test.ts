// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  applyColumnMenuActionIcons,
  createColumnMenuActionIcon,
} from "../columnMenuActionIcons";

describe("columnMenuActionIcons", () => {
  it("builds Lucide stroke SVGs for built-in actions", () => {
    const svg = createColumnMenuActionIcon("sort-asc");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg!.getAttribute("stroke")).toBe("currentColor");
    expect(svg!.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("returns null for unknown / custom actions", () => {
    expect(createColumnMenuActionIcon("log-column")).toBeNull();
  });

  it("replaces glyph icons on a panel", () => {
    const panel = document.createElement("div");
    const btn = document.createElement("button");
    btn.setAttribute("data-menu-action", "hide-column");
    const icon = document.createElement("span");
    icon.className = "lfg-column-menu-icon";
    icon.textContent = "⊘";
    btn.appendChild(icon);
    panel.appendChild(btn);

    applyColumnMenuActionIcons(panel);
    expect(icon.textContent).toBe("");
    expect(icon.querySelector("svg.lfg-column-menu-icon-svg")).not.toBeNull();
  });
});
