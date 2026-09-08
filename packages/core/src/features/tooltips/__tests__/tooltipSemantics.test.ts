// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createTooltipElement } from "../tooltipDom";
import {
  connectTooltipTarget,
  createTooltipIdAllocator,
  disconnectTooltipTarget,
} from "../tooltipSemantics";

describe("tooltip semantics", () => {
  it("creates canonical collision-free IDs and fails closed at exhaustion", () => {
    const allocator = createTooltipIdAllocator(
      Number.MAX_SAFE_INTEGER - 1,
    );

    expect(allocator.allocate()).toBe(
      `lfg-tooltip-${Number.MAX_SAFE_INTEGER - 1}`,
    );
    expect(allocator.allocate()).toBe(
      `lfg-tooltip-${Number.MAX_SAFE_INTEGER}`,
    );
    expect(() => allocator.allocate()).toThrow(
      "Tooltip id allocator exhausted",
    );
    expect(() => createTooltipIdAllocator(0)).toThrow();
  });

  it("creates a plain-text non-focusable tooltip in the supplied realm", () => {
    const element = createTooltipElement(
      document,
      "<strong>Plain</strong>",
      "lfg-tooltip-1",
    );

    expect(element.ownerDocument).toBe(document);
    expect(element.id).toBe("lfg-tooltip-1");
    expect(element.getAttribute("role")).toBe("tooltip");
    expect(element.hasAttribute("tabindex")).toBe(false);
    expect(element.textContent).toBe("<strong>Plain</strong>");
    expect(element.querySelector("strong")).toBeNull();
  });

  it("owns and removes its canonical relationship token only", () => {
    const target = document.createElement("div");
    target.setAttribute(
      "aria-describedby",
      "application-help",
    );

    connectTooltipTarget(target, "lfg-tooltip-2");
    disconnectTooltipTarget(target, "lfg-tooltip-2");

    expect(target.getAttribute("aria-describedby")).toBe(
      "application-help",
    );
  });

  it("fails before creating a duplicate connected tooltip id", () => {
    const existing = document.createElement("div");
    existing.id = "lfg-tooltip-3";
    document.body.appendChild(existing);

    expect(() =>
      createTooltipElement(document, "Tip", "lfg-tooltip-3"),
    ).toThrow("Tooltip id is already connected");

    existing.remove();
  });
});
