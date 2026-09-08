import type { RowSelectionMode } from "../../../types";

const ROW_SEMANTIC_ATTRS = ["role", "aria-rowindex", "aria-selected"] as const;

export function clearRowElementSemantics(element: HTMLElement | null | undefined): void {
  if (element === null || element === undefined) {
    return;
  }
  for (const name of ROW_SEMANTIC_ATTRS) {
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
  }
}

export function applyRowElementSemantics(
  element: HTMLElement,
  ariaRowIndex: number,
  selectionMode: RowSelectionMode,
  selected: boolean,
): void {
  if (element.getAttribute("role") !== "row") {
    element.setAttribute("role", "row");
  }
  const nextIndex = String(ariaRowIndex);
  if (element.getAttribute("aria-rowindex") !== nextIndex) {
    element.setAttribute("aria-rowindex", nextIndex);
  }

  if (selectionMode === "none") {
    if (element.hasAttribute("aria-selected")) {
      element.removeAttribute("aria-selected");
    }
    return;
  }

  const nextSelected = selected ? "true" : "false";
  if (element.getAttribute("aria-selected") !== nextSelected) {
    element.setAttribute("aria-selected", nextSelected);
  }
}

/** Keep a layout-only pinned-lane wrapper out of the logical row hierarchy. */
export function applyPresentationRowElementSemantics(
  element: HTMLElement,
): void {
  if (element.getAttribute("role") !== "presentation") {
    element.setAttribute("role", "presentation");
  }
  if (element.hasAttribute("aria-rowindex")) {
    element.removeAttribute("aria-rowindex");
  }
  if (element.hasAttribute("aria-selected")) {
    element.removeAttribute("aria-selected");
  }
}
