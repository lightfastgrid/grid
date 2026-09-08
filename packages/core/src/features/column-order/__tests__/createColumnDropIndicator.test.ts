// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  createColumnDropIndicator,
  syncColumnDropIndicator,
} from "../createColumnDropIndicator";

describe("createColumnDropIndicator", () => {
  it("builds flex rail as cap → beam → cap (no absolute overlap)", () => {
    const view = createColumnDropIndicator();
    expect(view.root.className).toBe("lfg-column-drop-indicator");
    expect(view.root.getAttribute("role")).toBe("status");
    expect(view.rail.className).toBe("lfg-column-drop-indicator-rail");
    expect(view.rail.children[0]).toBe(view.capStart);
    expect(view.rail.children[1]).toBe(view.beam);
    expect(view.rail.children[2]).toBe(view.capEnd);
    expect(view.beam.className).toBe("lfg-column-drop-indicator-beam");
    expect(view.root.querySelector(".lfg-column-drop-indicator-badge")).toBeTruthy();
    expect(view.root.style.display).toBe("none");
  });

  it("positions badge top edge in the header band — never at 0", () => {
    const view = createColumnDropIndicator();
    const rail = view.rail;

    syncColumnDropIndicator(view, {
      visible: true,
      leftPx: 120,
      badgeTopPx: 22,
      placement: "before",
      title: "Insert",
      detail: "Balance",
      statusText: "Insert column before Balance",
    });

    expect(view.root.style.display).toBe("block");
    expect(view.root.style.left).toBe("120px");
    expect(view.root.style.getPropertyValue("--lfg-column-drop-badge-y")).toBe(
      "22px",
    );
    expect(view.badge.style.top).toBe("22px");
    expect(view.badge.style.top).not.toBe("0px");
    expect(view.badgeTitle.textContent).toBe("Insert");
    expect(view.badgeDetail.textContent).toBe("Balance");
    expect(view.root.getAttribute("aria-label")).toBe(
      "Insert column before Balance",
    );
    expect(view.root.querySelector(".lfg-column-drop-indicator-rail")).toBe(rail);

    syncColumnDropIndicator(view, {
      visible: true,
      leftPx: 200,
      badgeTopPx: 28,
      placement: "after",
      title: "Insert",
      detail: "Country",
    });
    expect(view.root.dataset.placement).toBe("after");
    expect(view.badge.style.top).toBe("28px");
    expect(view.badgeDetail.textContent).toBe("Country");

    // Floor: even if caller passes 0, stay off the top edge.
    syncColumnDropIndicator(view, {
      visible: true,
      leftPx: 10,
      badgeTopPx: 0,
      placement: "before",
    });
    expect(view.badge.style.top).toBe("12px");

    syncColumnDropIndicator(view, {
      visible: false,
      leftPx: 0,
      badgeTopPx: 0,
      placement: "before",
    });
    expect(view.root.style.display).toBe("none");
    expect(view.root.dataset.active).toBeUndefined();
  });
});
