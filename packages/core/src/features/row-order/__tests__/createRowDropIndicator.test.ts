// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  createRowDropIndicator,
  syncRowDropIndicator,
} from "../createRowDropIndicator";

describe("createRowDropIndicator", () => {
  it("builds flex rail as cap → beam → cap (no badge)", () => {
    const view = createRowDropIndicator();
    expect(view.root.className).toBe("lfg-row-drop-indicator");
    expect(view.root.getAttribute("role")).toBe("status");
    expect(view.rail.className).toBe("lfg-row-drop-indicator-rail");
    expect(view.rail.children[0]).toBe(view.capStart);
    expect(view.rail.children[1]).toBe(view.beam);
    expect(view.rail.children[2]).toBe(view.capEnd);
    expect(view.root.querySelector(".lfg-row-drop-indicator-badge")).toBeNull();
    expect(view.root.style.display).toBe("none");
  });

  it("shows and positions the seam, then hides", () => {
    const view = createRowDropIndicator();

    syncRowDropIndicator(view, {
      visible: true,
      topPx: 140,
      placement: "before",
      statusText: "Insert before row",
    });

    expect(view.root.style.display).toBe("block");
    expect(view.root.style.top).toBe("140px");
    expect(view.root.dataset.placement).toBe("before");
    expect(view.root.dataset.active).toBe("true");
    expect(view.root.getAttribute("aria-label")).toBe("Insert before row");

    syncRowDropIndicator(view, {
      visible: false,
      topPx: 0,
      placement: "before",
    });

    expect(view.root.style.display).toBe("none");
    expect(view.root.dataset.active).toBeUndefined();
  });
});
