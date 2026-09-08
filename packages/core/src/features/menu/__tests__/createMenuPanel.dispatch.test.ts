// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createMenuPanel } from "../createMenuPanel";

const MENU_CONFIG = {
  panelClass: "panel",
  itemClass: "item",
  iconClass: "icon",
  separatorClass: "separator",
} as const;

describe("createMenuPanel exact-action dispatch", () => {
  it("invokes the bound action for each rendered item with duplicate textual ids", () => {
    const firstAction = vi.fn();
    const secondAction = vi.fn();
    const { element, cleanup } = createMenuPanel(
      [
        {
          id: "section-a",
          items: [{ id: "copy", label: "Copy A", action: firstAction }],
        },
        {
          id: "section-b",
          items: [{ id: "copy", label: "Copy B", action: secondAction }],
        },
      ],
      MENU_CONFIG,
      {
        id: "lfg-popup-column-menu-1",
        ariaLabel: "Actions",
        role: "menu",
      },
    );
    document.body.appendChild(element);

    const buttons = Array.from(
      element.querySelectorAll<HTMLButtonElement>(".item"),
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute("data-menu-action")).toBe("copy");
    expect(buttons[1]!.getAttribute("data-menu-action")).toBe("copy");
    expect(buttons[0]!.getAttribute("data-menu-item-index")).toBe("0");
    expect(buttons[1]!.getAttribute("data-menu-item-index")).toBe("1");

    buttons[0]!.click();
    buttons[1]!.click();

    expect(firstAction).toHaveBeenCalledOnce();
    expect(secondAction).toHaveBeenCalledOnce();
    cleanup();
  });

  it("does not invoke another action when an item has no action handler", () => {
    const boundAction = vi.fn();
    const { element, cleanup } = createMenuPanel(
      [
        {
          id: "actions",
          items: [
            { id: "shared", label: "Bound", action: boundAction },
            { id: "shared", label: "Inert" },
          ],
        },
      ],
      MENU_CONFIG,
      {
        id: "lfg-popup-row-action-1",
        ariaLabel: "Row actions",
        role: "menu",
      },
    );
    document.body.appendChild(element);

    const buttons = Array.from(
      element.querySelectorAll<HTMLButtonElement>(".item"),
    );
    buttons[1]!.click();

    expect(boundAction).not.toHaveBeenCalled();
    cleanup();
  });

  it("ignores invalid or tampered data-menu-item-index values safely", () => {
    const action = vi.fn();
    const { element, cleanup } = createMenuPanel(
      [
        {
          id: "actions",
          items: [{ id: "copy", label: "Copy", action }],
        },
      ],
      MENU_CONFIG,
      {
        id: "lfg-popup-column-menu-2",
        ariaLabel: "Actions",
        role: "menu",
      },
    );
    document.body.appendChild(element);

    const button = element.querySelector<HTMLButtonElement>(".item")!;
    button.setAttribute("data-menu-item-index", "999");
    button.click();
    button.setAttribute("data-menu-item-index", "not-a-number");
    button.click();
    button.removeAttribute("data-menu-item-index");
    button.click();

    expect(action).not.toHaveBeenCalled();
    cleanup();
  });
});
