/**
 * Keep toolbar button mousedown from stealing focus from the grid.
 * Do not call preventDefault on form controls — native <select>/<input>
 * need the default mousedown to focus and open.
 * Do not call preventDefault on draggable handles — that blocks HTML5 drag.
 */
export function preventToolbarFocusSteal(event: {
  preventDefault(): void;
  target?: EventTarget | null;
}): void {
  const target = event.target;
  if (target instanceof HTMLElement) {
    const tag = target.tagName;
    if (
      tag === "INPUT" ||
      tag === "SELECT" ||
      tag === "TEXTAREA" ||
      tag === "OPTION" ||
      target.isContentEditable ||
      target.closest('[draggable="true"]')
    ) {
      return;
    }
  }
  event.preventDefault();
}
