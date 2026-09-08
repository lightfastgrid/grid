/**
 * Run a DOM rebuild while keeping focus/caret inside `root` when possible.
 * Vanilla panels remount rows; without this, selects/inputs lose focus mid-edit.
 */
export function preservePanelFocus(root: HTMLElement, run: () => void): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) {
    run();
    return;
  }

  const tag = active.tagName.toLowerCase();
  const ariaLabel = active.getAttribute("aria-label") ?? "";
  const selectionStart =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? active.selectionStart
      : null;
  const selectionEnd =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? active.selectionEnd
      : null;

  run();

  if (!ariaLabel) return;
  const next = root.querySelector<HTMLElement>(
    `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`,
  );
  if (!next) return;
  next.focus({ preventScroll: true });
  if (
    (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) &&
    selectionStart !== null &&
    selectionEnd !== null
  ) {
    try {
      next.setSelectionRange(selectionStart, selectionEnd);
    } catch {
      // Some input types reject setSelectionRange.
    }
  }
}
