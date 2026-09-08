const HOST_CLASS = "lfg-cell-editor-host";
const EDITING_CLASS = "lfg-cell-editing";
const INVALID_CLASS = "lfg-cell-editor-invalid";

export function ensureEditorHost(cell: HTMLElement): HTMLElement {
  let host = cell.querySelector<HTMLElement>(`.${HOST_CLASS}`);
  if (!host) {
    host = document.createElement("div");
    host.className = HOST_CLASS;
    host.hidden = true;
    cell.appendChild(host);
  }
  return host;
}

export function mountEditor(host: HTMLElement, editorElement: HTMLElement): void {
  host.innerHTML = "";
  host.appendChild(editorElement);
  host.hidden = false;
}

export function unmountEditor(host: HTMLElement): void {
  host.innerHTML = "";
  host.hidden = true;
}

export function addEditingClass(cell: HTMLElement): void {
  cell.classList.add(EDITING_CLASS);
}

export function removeEditingClass(cell: HTMLElement): void {
  cell.classList.remove(EDITING_CLASS);
}

export function markInvalid(cell: HTMLElement): void {
  cell.classList.add(INVALID_CLASS);
}

export function clearInvalid(cell: HTMLElement): void {
  cell.classList.remove(INVALID_CLASS);
}
