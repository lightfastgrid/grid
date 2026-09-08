import {
  applyPinnedLaneOwnership,
  clearPinnedLaneOwnership,
} from "./pinnedLaneOwnershipDom";

const COLUMN_HEADER_SEMANTIC_ATTRS = [
  "id",
  "role",
  "aria-colindex",
  "aria-sort",
  "aria-selected",
  "aria-describedby",
  "aria-label",
] as const;
const GROUP_HEADER_SEMANTIC_ATTRS = [
  "id",
  "role",
  "aria-colindex",
  "aria-colspan",
  "aria-label",
] as const;
const FLOATING_FILTER_CELL_SEMANTIC_ATTRS = [
  "id",
  "role",
  "aria-colindex",
] as const;
const HEADER_ROW_SEMANTIC_ATTRS = [
  "role",
  "aria-rowindex",
] as const;

export const COLUMN_MENU_TRIGGER_SELECTOR = "button.lfg-column-menu-trigger";
export const DEDICATED_FILTER_TRIGGER_SELECTOR = "button.lfg-filter-trigger";
export const RESIZE_HANDLE_SELECTOR = ".lfg-resize-handle";
const COLUMN_MENU_TRIGGER_ATTRS = [
  "aria-haspopup",
  "aria-expanded",
  "aria-controls",
] as const;

export interface ColumnHeaderElementSemantics {
  readonly id: string;
  readonly ariaColIndex: number;
  readonly ariaSort: "ascending" | "descending" | null;
  readonly ariaSelected: boolean | null;
  readonly ariaLabel: string | undefined;
}

export interface GroupHeaderElementSemantics {
  readonly id: string;
  readonly ariaColIndex: number;
  readonly ariaColSpan: number;
  readonly ariaLabel: string | undefined;
}

export function clearColumnMenuTriggerSemantics(
  cell: HTMLElement,
): void {
  const trigger = cell.querySelector<HTMLElement>(COLUMN_MENU_TRIGGER_SELECTOR);
  if (trigger === null) {
    return;
  }
  for (const name of COLUMN_MENU_TRIGGER_ATTRS) {
    trigger.removeAttribute(name);
  }
}

export function clearColumnMenuTriggerElementSemantics(
  trigger: HTMLElement | null,
): void {
  if (trigger === null) return;
  for (const name of COLUMN_MENU_TRIGGER_ATTRS) {
    if (trigger.hasAttribute(name)) {
      trigger.removeAttribute(name);
    }
  }
}

export function clearColumnHeaderElementSemantics(
  element: HTMLElement | null | undefined,
  ownedId?: string,
): void {
  if (element === null || element === undefined) {
    return;
  }
  for (const name of COLUMN_HEADER_SEMANTIC_ATTRS) {
    if (
      name === "id" &&
      (ownedId === undefined || element.getAttribute("id") !== ownedId)
    ) {
      continue;
    }
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
  }
}

export function clearGroupHeaderElementSemantics(
  element: HTMLElement | null | undefined,
  ownedId?: string,
): void {
  if (element === null || element === undefined) {
    return;
  }
  for (const name of GROUP_HEADER_SEMANTIC_ATTRS) {
    if (
      name === "id" &&
      (ownedId === undefined || element.getAttribute("id") !== ownedId)
    ) {
      continue;
    }
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
  }
}

function setOrRemoveAttribute(
  element: HTMLElement,
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
    return;
  }
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

export function applyPhysicalHeaderElementId(
  element: HTMLElement,
  id: string,
): void {
  setOrRemoveAttribute(element, "id", id);
}

export function applyColumnHeaderElementSemantics(
  element: HTMLElement,
  semantics: ColumnHeaderElementSemantics,
): void {
  setOrRemoveAttribute(element, "id", semantics.id);
  element.setAttribute("role", "columnheader");
  setOrRemoveAttribute(element, "aria-colindex", String(semantics.ariaColIndex));

  if (semantics.ariaSort === null) {
    setOrRemoveAttribute(element, "aria-sort", undefined);
  } else {
    setOrRemoveAttribute(element, "aria-sort", semantics.ariaSort);
  }
  setOrRemoveAttribute(
    element,
    "aria-selected",
    semantics.ariaSelected === null
      ? undefined
      : String(semantics.ariaSelected),
  );

  setOrRemoveAttribute(element, "aria-label", semantics.ariaLabel);
}

export function applyGroupHeaderElementSemantics(
  element: HTMLElement,
  semantics: GroupHeaderElementSemantics,
): void {
  setOrRemoveAttribute(element, "id", semantics.id);
  setOrRemoveAttribute(element, "role", "columnheader");
  setOrRemoveAttribute(element, "aria-colindex", String(semantics.ariaColIndex));
  setOrRemoveAttribute(element, "aria-colspan", String(semantics.ariaColSpan));
  setOrRemoveAttribute(element, "aria-label", semantics.ariaLabel);
}

export function applyFloatingFilterCellElementSemantics(
  element: HTMLElement,
  id: string,
  ariaColIndex: number,
): void {
  setOrRemoveAttribute(element, "id", id);
  setOrRemoveAttribute(element, "role", "gridcell");
  setOrRemoveAttribute(element, "aria-colindex", String(ariaColIndex));
}

export function clearFloatingFilterCellElementSemantics(
  element: HTMLElement | null | undefined,
  ownedId?: string,
): void {
  if (element === null || element === undefined) return;
  for (const name of FLOATING_FILTER_CELL_SEMANTIC_ATTRS) {
    if (
      name === "id" &&
      (ownedId === undefined || element.getAttribute("id") !== ownedId)
    ) {
      continue;
    }
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
  }
}

export function applyLogicalHeaderRowElementSemantics(
  element: HTMLElement,
  ariaRowIndex: number,
  ariaOwns: string | undefined,
): void {
  setOrRemoveAttribute(element, "role", "row");
  setOrRemoveAttribute(element, "aria-rowindex", String(ariaRowIndex));
  if (ariaOwns === undefined) {
    clearPinnedLaneOwnership(element);
  } else {
    applyPinnedLaneOwnership(element, ariaOwns);
  }
}

export function applyPresentationHeaderRowElementSemantics(
  element: HTMLElement,
): void {
  setOrRemoveAttribute(element, "role", "presentation");
  setOrRemoveAttribute(element, "aria-rowindex", undefined);
  clearPinnedLaneOwnership(element);
}

export function clearHeaderRowElementSemantics(
  element: HTMLElement | null | undefined,
): void {
  if (element === null || element === undefined) return;
  for (const name of HEADER_ROW_SEMANTIC_ATTRS) {
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
  }
  clearPinnedLaneOwnership(element);
}

export function applyColumnHeaderSortSemantics(
  element: HTMLElement,
  ariaSort: ColumnHeaderElementSemantics["ariaSort"],
): void {
  if (ariaSort === null) {
    setOrRemoveAttribute(element, "aria-sort", undefined);
    return;
  }
  setOrRemoveAttribute(element, "aria-sort", ariaSort);
}

export function applyColumnHeaderSelectionSemantics(
  element: HTMLElement,
  selected: boolean | null,
): void {
  setOrRemoveAttribute(
    element,
    "aria-selected",
    selected === null ? undefined : String(selected),
  );
}

export function applyColumnHeaderSortDescriptionSemantics(
  element: HTMLElement,
  descriptionId: string | undefined,
): void {
  setOrRemoveAttribute(element, "aria-describedby", descriptionId);
}

export function syncColumnMenuTriggerSemantics(
  cell: HTMLElement,
  field: string,
  openColumnMenuField: string | null,
  openColumnMenuPopupId: string | null,
): void {
  const trigger = cell.querySelector<HTMLElement>(COLUMN_MENU_TRIGGER_SELECTOR);
  if (trigger === null) {
    return;
  }

  syncColumnMenuTriggerElementSemantics(
    trigger,
    openColumnMenuField === field,
    openColumnMenuPopupId,
  );
}

export function syncColumnMenuTriggerElementSemantics(
  trigger: HTMLElement | null,
  expanded: boolean,
  popupId: string | null = null,
): void {
  if (trigger === null) return;
  setOrRemoveAttribute(trigger, "aria-haspopup", "dialog");
  const connected = expanded && popupId !== null && popupId.trim() !== "";
  setOrRemoveAttribute(trigger, "aria-expanded", connected ? "true" : "false");
  setOrRemoveAttribute(
    trigger,
    "aria-controls",
    connected ? popupId : undefined,
  );
}
