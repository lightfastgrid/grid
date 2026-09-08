// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createMenuPanel } from "../createMenuPanel";
import {
  applyPopupElementSemantics,
  clearPopupTriggerSemantics,
  connectPopupTrigger,
  createPopupIdAllocator,
  disconnectPopupTrigger,
  initializePopupTrigger,
  syncPopupTriggerRole,
} from "../popupSemantics";

const MENU_CONFIG = {
  panelClass: "panel",
  itemClass: "item",
  iconClass: "icon",
  separatorClass: "separator",
} as const;

function press(
  target: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("popup semantics", () => {
  it("allocates canonical collision-free ids without application strings", () => {
    const allocator = createPopupIdAllocator(7);

    expect(allocator.allocate("column-menu")).toBe(
      "lfg-popup-column-menu-7",
    );
    expect(allocator.allocate("cell-menu")).toBe("lfg-popup-cell-menu-8");
    expect(allocator.allocate("dedicated-filter")).toBe(
      "lfg-popup-dedicated-filter-9",
    );
    expect(allocator.allocate("row-action")).toBe(
      "lfg-popup-row-action-10",
    );
  });

  it("fails closed on invalid starts and after safe-integer exhaustion", () => {
    for (const value of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => createPopupIdAllocator(value)).toThrow(
        "initialNextId must be a positive safe integer",
      );
    }

    const allocator = createPopupIdAllocator(Number.MAX_SAFE_INTEGER);
    expect(allocator.allocate("cell-menu")).toBe(
      `lfg-popup-cell-menu-${Number.MAX_SAFE_INTEGER}`,
    );
    expect(() => allocator.allocate("cell-menu")).toThrow(
      "Popup id allocator exhausted",
    );
  });

  it("fails closed when JavaScript supplies an unsupported owner kind", () => {
    const allocator = createPopupIdAllocator();

    expect(() =>
      Reflect.apply(allocator.allocate, allocator, ["unsupported"]),
    ).toThrow("Invalid popup owner kind");
    expect(allocator.allocate("cell-menu")).toBe("lfg-popup-cell-menu-1");
  });

  it("publishes truthful menu and non-modal dialog roots", () => {
    const menu = document.createElement("div");
    applyPopupElementSemantics(menu, {
      id: "lfg-popup-column-menu-1",
      role: "menu",
      ariaLabel: "Column menu for Price",
    });
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-label")).toBe("Column menu for Price");
    expect(menu.hasAttribute("aria-modal")).toBe(false);

    const dialog = document.createElement("div");
    applyPopupElementSemantics(dialog, {
      id: "lfg-popup-row-action-2",
      role: "dialog",
      ariaLabel: "Row actions",
    });
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("false");
  });

  it("rejects malformed popup ids, roles, and empty names before writing", () => {
    const popup = document.createElement("div");
    const setAttribute = vi.spyOn(popup, "setAttribute");

    expect(() =>
      applyPopupElementSemantics(popup, {
        id: " ",
        role: "menu",
        ariaLabel: "Menu",
      }),
    ).toThrow("Invalid popup id");
    expect(() =>
      Reflect.apply(applyPopupElementSemantics, undefined, [
        popup,
        {
          id: "lfg-popup-cell-menu-1",
          role: "alert",
          ariaLabel: "Menu",
        },
      ]),
    ).toThrow("Invalid popup role");
    expect(() =>
      applyPopupElementSemantics(popup, {
        id: "lfg-popup-cell-menu-1",
        role: "menu",
        ariaLabel: " ",
      }),
    ).toThrow("Popup aria-label must be non-empty");
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it("connects and disconnects only the exact owned relationship", () => {
    const trigger = document.createElement("button");
    initializePopupTrigger(trigger, "menu");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);

    connectPopupTrigger(trigger, "menu", "lfg-popup-cell-menu-1");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(
      "lfg-popup-cell-menu-1",
    );

    connectPopupTrigger(trigger, "dialog", "lfg-popup-row-action-2");
    expect(disconnectPopupTrigger(trigger, "lfg-popup-cell-menu-1")).toBe(
      false,
    );
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(
      "lfg-popup-row-action-2",
    );

    expect(disconnectPopupTrigger(trigger, "lfg-popup-row-action-2")).toBe(
      true,
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);

    clearPopupTriggerSemantics(trigger);
    expect(trigger.hasAttribute("aria-haspopup")).toBe(false);
    expect(trigger.hasAttribute("aria-expanded")).toBe(false);
    expect(trigger.hasAttribute("aria-controls")).toBe(false);
  });

  it("cleans earlier custom sections when a later render fails", () => {
    const error = new Error("section failed");
    const cleanup = vi.fn();

    expect(() =>
      createMenuPanel(
        [
          {
            id: "first",
            items: [],
            render: () => cleanup,
          },
          {
            id: "second",
            items: [],
            render: () => {
              throw error;
            },
          },
        ],
        MENU_CONFIG,
        {
          id: "lfg-popup-column-menu-1",
          ariaLabel: "Column menu",
          role: "dialog",
        },
      ),
    ).toThrow(error);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("runs every custom cleanup once and preserves the first failure", () => {
    const firstCleanup = vi.fn(() => {
      throw new Error("last cleanup failed");
    });
    const secondCleanup = vi.fn(() => {
      throw new Error("first cleanup failed");
    });
    const { element, cleanup } = createMenuPanel(
      [
        { id: "first", items: [], render: () => firstCleanup },
        { id: "second", items: [], render: () => secondCleanup },
      ],
      MENU_CONFIG,
      {
        id: "lfg-popup-column-menu-1",
        ariaLabel: "Column menu",
        role: "dialog",
      },
    );
    document.body.appendChild(element);

    expect(() => cleanup()).toThrow("first cleanup failed");
    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(secondCleanup).toHaveBeenCalledOnce();
    expect(element.isConnected).toBe(false);
    expect(() => cleanup()).not.toThrow();
    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(secondCleanup).toHaveBeenCalledOnce();
  });

  it("173-175: menu navigation, activation, close, and boundary Tab stay owner-local", () => {
    const activateAlpha = vi.fn();
    const activateCharlie = vi.fn();
    const onRequestClose = vi.fn();
    const { element, cleanup, focusFirst } = createMenuPanel(
      [
        {
          id: "actions",
          items: [
            { id: "alpha", label: "Alpha", action: activateAlpha },
            { id: "bravo", label: "Bravo", disabled: true },
            { id: "charlie", label: "Charlie", action: activateCharlie },
          ],
        },
      ],
      { ...MENU_CONFIG, onRequestClose },
      {
        id: "lfg-popup-column-menu-11",
        ariaLabel: "Column menu",
        role: "menu",
      },
    );
    document.body.appendChild(element);
    const items = Array.from(
      element.querySelectorAll<HTMLButtonElement>("[role='menuitem']"),
    );

    expect(focusFirst()).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    expect(press(items[0]!, "ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[2]);
    expect(press(items[2]!, "ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    expect(press(items[0]!, "End").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[2]);
    expect(press(items[2]!, "Home").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    expect(press(items[0]!, "c").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[2]);
    expect(press(items[2]!, "Enter").defaultPrevented).toBe(true);
    expect(activateCharlie).toHaveBeenCalledOnce();
    expect(activateAlpha).not.toHaveBeenCalled();

    expect(press(items[2]!, "Escape").defaultPrevented).toBe(true);
    expect(onRequestClose).toHaveBeenCalledWith("escape");
    const tab = press(items[2]!, "Tab");
    expect(tab.defaultPrevented).toBe(false);
    expect(onRequestClose).toHaveBeenLastCalledWith("tab");
    cleanup();
  });

  it("176: dialog-native form keys pass through while boundary Tab requests close", () => {
    const onRequestClose = vi.fn();
    let input: HTMLInputElement | null = null;
    let select: HTMLSelectElement | null = null;
    const { element, cleanup, focusFirst } = createMenuPanel(
      [
        {
          id: "filter",
          items: [],
          render: (host) => {
            input = document.createElement("input");
            select = document.createElement("select");
            host.append(input, select);
          },
        },
      ],
      { ...MENU_CONFIG, onRequestClose },
      {
        id: "lfg-popup-dedicated-filter-12",
        ariaLabel: "Filter",
        role: "dialog",
      },
    );
    document.body.appendChild(element);

    expect(focusFirst()).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(press(input!, "ArrowDown").defaultPrevented).toBe(false);
    expect(press(select!, "Home").defaultPrevented).toBe(false);
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(press(select!, "Tab").defaultPrevented).toBe(false);
    expect(onRequestClose).toHaveBeenCalledWith("tab");
    cleanup();
  });

  it("syncPopupTriggerRole updates aria-haspopup without disturbing open trigger state", () => {
    const trigger = document.createElement("button");
    initializePopupTrigger(trigger, "menu");
    connectPopupTrigger(trigger, "menu", "lfg-popup-cell-menu-1");

    syncPopupTriggerRole(trigger, "dialog");

    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe("lfg-popup-cell-menu-1");
  });

  it("ArrowDown moves focus in a menu but not in a dialog with descriptor buttons", () => {
    const activateAlpha = vi.fn();
    const activateBravo = vi.fn();
    const menuPanel = createMenuPanel(
      [
        {
          id: "actions",
          items: [
            { id: "alpha", label: "Alpha", action: activateAlpha },
            { id: "bravo", label: "Bravo", action: activateBravo },
          ],
        },
      ],
      MENU_CONFIG,
      {
        id: "lfg-popup-column-menu-20",
        ariaLabel: "Column menu",
        role: "menu",
      },
    );
    document.body.appendChild(menuPanel.element);
    const menuItems = Array.from(
      menuPanel.element.querySelectorAll<HTMLButtonElement>("[role='menuitem']"),
    );
    menuPanel.focusFirst();
    expect(press(menuItems[0]!, "ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(menuItems[1]);
    menuPanel.cleanup();

    const dialogPanel = createMenuPanel(
      [
        {
          id: "actions",
          items: [
            { id: "alpha", label: "Alpha", action: activateAlpha },
            { id: "bravo", label: "Bravo", action: activateBravo },
          ],
        },
      ],
      MENU_CONFIG,
      {
        id: "lfg-popup-cell-menu-21",
        ariaLabel: "Cell menu",
        role: "dialog",
      },
    );
    document.body.appendChild(dialogPanel.element);
    const dialogButtons = Array.from(
      dialogPanel.element.querySelectorAll<HTMLButtonElement>(".item"),
    );
    dialogPanel.focusFirst();
    expect(document.activeElement).toBe(dialogButtons[0]);
    expect(press(dialogButtons[0]!, "ArrowDown").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(dialogButtons[0]);
    dialogPanel.cleanup();
  });

  it("Enter on a dialog descriptor button is not synthesized by menu keyboard handling", () => {
    const activate = vi.fn();
    const { element, cleanup, focusFirst } = createMenuPanel(
      [
        {
          id: "actions",
          items: [{ id: "save", label: "Save", action: activate }],
        },
      ],
      MENU_CONFIG,
      {
        id: "lfg-popup-cell-menu-22",
        ariaLabel: "Cell menu",
        role: "dialog",
      },
    );
    document.body.appendChild(element);
    const button = element.querySelector<HTMLButtonElement>(".item")!;
    const clickSpy = vi.spyOn(button, "click");
    focusFirst();
    expect(document.activeElement).toBe(button);

    const event = press(button, "Enter");
    expect(event.defaultPrevented).toBe(false);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();

    button.click();
    expect(activate).toHaveBeenCalledOnce();
    cleanup();
  });

  it("Escape and boundary Tab still close a dialog with descriptor buttons", () => {
    const onRequestClose = vi.fn();
    const { element, cleanup, focusFirst } = createMenuPanel(
      [
        {
          id: "actions",
          items: [{ id: "save", label: "Save", action: vi.fn() }],
        },
      ],
      { ...MENU_CONFIG, onRequestClose },
      {
        id: "lfg-popup-cell-menu-23",
        ariaLabel: "Cell menu",
        role: "dialog",
      },
    );
    document.body.appendChild(element);
    const button = element.querySelector<HTMLButtonElement>(".item")!;
    focusFirst();

    expect(press(button, "Escape").defaultPrevented).toBe(true);
    expect(onRequestClose).toHaveBeenCalledWith("escape");

    focusFirst();
    const tab = press(button, "Tab");
    expect(tab.defaultPrevented).toBe(false);
    expect(onRequestClose).toHaveBeenLastCalledWith("tab");
    cleanup();
  });

  it("dialog custom controls are not intercepted by menu navigation", () => {
    let input: HTMLInputElement | null = null;
    const onRequestClose = vi.fn();
    const { element, cleanup, focusFirst } = createMenuPanel(
      [
        {
          id: "actions",
          items: [{ id: "save", label: "Save", action: vi.fn() }],
        },
        {
          id: "custom",
          items: [],
          render: (host) => {
            input = document.createElement("input");
            host.appendChild(input);
          },
        },
      ],
      { ...MENU_CONFIG, onRequestClose },
      {
        id: "lfg-popup-cell-menu-24",
        ariaLabel: "Cell menu",
        role: "dialog",
      },
    );
    document.body.appendChild(element);
    focusFirst();
    input!.focus();
    expect(press(input!, "ArrowDown").defaultPrevented).toBe(false);
    expect(onRequestClose).not.toHaveBeenCalled();
    cleanup();
  });
});
