export type PopupRole = "dialog" | "menu";
export type PopupOwnerKind =
  | "cell-menu"
  | "column-menu"
  | "dedicated-filter"
  | "row-action";

/** Owner-local open marker so header triggers stay visible while the popup is open. */
export const POPUP_TRIGGER_OPEN_CLASS = "lfg-popup-trigger-open";

export interface PopupIdAllocator {
  allocate(owner: PopupOwnerKind): string;
}

const POPUP_ID_PREFIX = "lfg-popup";
const POPUP_ID_PATTERN =
  /^lfg-popup-(cell-menu|column-menu|dedicated-filter|row-action)-([1-9]\d*)$/;

function assertPopupOwnerKind(
  value: unknown,
): asserts value is PopupOwnerKind {
  if (
    value !== "cell-menu" &&
    value !== "column-menu" &&
    value !== "dedicated-filter" &&
    value !== "row-action"
  ) {
    throw new Error("Invalid popup owner kind");
  }
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

export function createPopupIdAllocator(initialNextId = 1): PopupIdAllocator {
  assertPositiveSafeInteger(initialNextId, "initialNextId");
  let nextId = initialNextId;
  let exhausted = false;

  return {
    allocate(owner): string {
      assertPopupOwnerKind(owner);
      if (exhausted) {
        throw new Error("Popup id allocator exhausted");
      }
      const id = `${POPUP_ID_PREFIX}-${owner}-${nextId}`;
      if (nextId === Number.MAX_SAFE_INTEGER) {
        exhausted = true;
      } else {
        nextId += 1;
      }
      return id;
    },
  };
}

const productionPopupIdAllocator = createPopupIdAllocator();

export function allocatePopupId(owner: PopupOwnerKind): string {
  return productionPopupIdAllocator.allocate(owner);
}

function assertPopupRole(value: unknown): asserts value is PopupRole {
  if (value !== "dialog" && value !== "menu") {
    throw new Error("Invalid popup role");
  }
}

function assertPopupId(value: string): string {
  const id = value.trim();
  const match = POPUP_ID_PATTERN.exec(id);
  if (match === null || !Number.isSafeInteger(Number(match[2]))) {
    throw new Error("Invalid popup id");
  }
  return id;
}

function setAttributeIfChanged(
  element: HTMLElement,
  name: string,
  value: string,
): void {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function removeAttributeIfPresent(element: HTMLElement, name: string): void {
  if (element.hasAttribute(name)) {
    element.removeAttribute(name);
  }
}

export function applyPopupElementSemantics(
  element: HTMLElement,
  input: {
    readonly id: string;
    readonly role: PopupRole;
    readonly ariaLabel: string;
  },
): void {
  assertPopupRole(input.role);
  const id = assertPopupId(input.id);
  const ariaLabel = input.ariaLabel.trim();
  if (ariaLabel === "") {
    throw new Error("Popup aria-label must be non-empty");
  }

  setAttributeIfChanged(element, "id", id);
  setAttributeIfChanged(element, "role", input.role);
  setAttributeIfChanged(element, "aria-label", ariaLabel);
  if (input.role === "dialog") {
    setAttributeIfChanged(element, "aria-modal", "false");
  } else {
    removeAttributeIfPresent(element, "aria-modal");
  }
}

export function initializePopupTrigger(
  trigger: HTMLElement,
  popupRole: PopupRole,
): void {
  assertPopupRole(popupRole);
  setAttributeIfChanged(trigger, "aria-haspopup", popupRole);
  setAttributeIfChanged(trigger, "aria-expanded", "false");
  removeAttributeIfPresent(trigger, "aria-controls");
}

/** Update advertised popup role without disturbing an open trigger relationship. */
export function syncPopupTriggerRole(
  trigger: HTMLElement,
  popupRole: PopupRole,
): void {
  assertPopupRole(popupRole);
  setAttributeIfChanged(trigger, "aria-haspopup", popupRole);
}

export function clearPopupTriggerSemantics(trigger: HTMLElement): void {
  removeAttributeIfPresent(trigger, "aria-haspopup");
  removeAttributeIfPresent(trigger, "aria-expanded");
  removeAttributeIfPresent(trigger, "aria-controls");
}

export function connectPopupTrigger(
  trigger: HTMLElement,
  popupRole: PopupRole,
  popupId: string,
): void {
  assertPopupRole(popupRole);
  const id = assertPopupId(popupId);
  setAttributeIfChanged(trigger, "aria-haspopup", popupRole);
  setAttributeIfChanged(trigger, "aria-expanded", "true");
  setAttributeIfChanged(trigger, "aria-controls", id);
}

/**
 * Clear only the relationship this close owns. A stale close must not collapse
 * a newer popup relation installed on the same recycled trigger.
 */
export function disconnectPopupTrigger(
  trigger: HTMLElement,
  popupId: string,
): boolean {
  if (trigger.getAttribute("aria-controls") !== popupId) {
    return false;
  }
  removeAttributeIfPresent(trigger, "aria-controls");
  setAttributeIfChanged(trigger, "aria-expanded", "false");
  return true;
}
