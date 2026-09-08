export function findCellFromEvent(e: Event): { rowIndex: number; field: string } | null {
  const target = e.target as HTMLElement;
  const cell = target.closest<HTMLElement>(".lfg-cell[data-col-id]");
  if (!cell) return null;
  const field = cell.getAttribute("data-col-id");
  if (!field) return null;
  const rowEl = cell.closest<HTMLElement>(
    ".lfg-row, .lfg-pinned-row, .lfg-pinned-right-row",
  );
  if (!rowEl) return null;
  const rowIndex = Number(rowEl.getAttribute("data-row-index"));
  if (Number.isNaN(rowIndex)) return null;
  return { rowIndex, field };
}

export function isEditableKeyboardTarget(
  e: KeyboardEvent,
  editorHost: HTMLElement | null,
): boolean {
  const target = e.target as HTMLElement;
  const tag = target.tagName;
  if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") return false;
  if (editorHost?.contains(target)) return false;
  return true;
}

export function isPrintableKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1;
}
