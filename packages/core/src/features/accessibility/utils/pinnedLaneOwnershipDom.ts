export function applyPinnedLaneOwnership(
  element: HTMLElement,
  ownedIds: string,
): void {
  if (element.getAttribute("aria-owns") !== ownedIds) {
    element.setAttribute("aria-owns", ownedIds);
  }
}

export function clearPinnedLaneOwnership(
  element: HTMLElement | null | undefined,
): void {
  if (element?.hasAttribute("aria-owns")) {
    element.removeAttribute("aria-owns");
  }
}
