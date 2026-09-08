import { clearInvalid, markInvalid } from "./editingDom";

let nextEditorValidationOwnerId = 1;

function allocateEditorValidationErrorId(): string {
  if (!Number.isSafeInteger(nextEditorValidationOwnerId)) {
    throw new Error("Editor validation error id space exhausted");
  }
  const id = `lfg-editor-error-${nextEditorValidationOwnerId}`;
  if (nextEditorValidationOwnerId === Number.MAX_SAFE_INTEGER) {
    nextEditorValidationOwnerId = Number.POSITIVE_INFINITY;
  } else {
    nextEditorValidationOwnerId += 1;
  }
  return id;
}

export interface EditorValidationPresentation {
  readonly cell: HTMLElement;
  readonly host: HTMLElement;
  readonly editor: HTMLElement;
  readonly message: string;
}

/**
 * Owner-local validation presentation for the one active pooled editor.
 * The error node is allocated lazily once and moves with the editor.
 */
export class EditorValidationSemantics {
  private readonly errorId = allocateEditorValidationErrorId();
  private errorElement: HTMLDivElement | null = null;
  private invalid = false;

  expose(input: EditorValidationPresentation): void {
    const message =
      input.message.trim().length > 0 ? input.message : "Invalid value";
    const error = this.ensureErrorElement(input.host.ownerDocument);

    if (error.parentElement !== input.host) {
      input.host.appendChild(error);
    }
    if (error.textContent !== message) {
      error.textContent = message;
    }
    if (!input.cell.classList.contains("lfg-cell-editor-invalid")) {
      markInvalid(input.cell);
    }
    if (input.editor.getAttribute("aria-invalid") !== "true") {
      input.editor.setAttribute("aria-invalid", "true");
    }
    if (input.editor.getAttribute("aria-errormessage") !== this.errorId) {
      input.editor.setAttribute("aria-errormessage", this.errorId);
    }
    this.invalid = true;
  }

  move(
    previousCell: HTMLElement,
    nextCell: HTMLElement,
    nextHost: HTMLElement,
  ): void {
    if (!this.invalid) return;
    if (previousCell !== nextCell) {
      clearInvalid(previousCell);
    }
    if (!nextCell.classList.contains("lfg-cell-editor-invalid")) {
      markInvalid(nextCell);
    }
    if (
      this.errorElement !== null &&
      this.errorElement.parentElement !== nextHost
    ) {
      nextHost.appendChild(this.errorElement);
    }
  }

  clear(cell: HTMLElement | null, editor: HTMLElement | null): void {
    if (cell !== null && cell.classList.contains("lfg-cell-editor-invalid")) {
      clearInvalid(cell);
    }
    if (editor !== null) {
      if (editor.hasAttribute("aria-invalid")) {
        editor.removeAttribute("aria-invalid");
      }
      if (editor.hasAttribute("aria-errormessage")) {
        editor.removeAttribute("aria-errormessage");
      }
    }
    if (this.errorElement !== null) {
      if (this.errorElement.textContent !== "") {
        this.errorElement.textContent = "";
      }
      this.errorElement.remove();
    }
    this.invalid = false;
  }

  destroy(): void {
    if (this.errorElement !== null) {
      this.errorElement.textContent = "";
      this.errorElement.remove();
      this.errorElement = null;
    }
    this.invalid = false;
  }

  private ensureErrorElement(ownerDocument: Document): HTMLDivElement {
    if (this.errorElement === null) {
      const error = ownerDocument.createElement("div");
      error.id = this.errorId;
      error.className = "lfg-editor-error";
      this.errorElement = error;
    }
    return this.errorElement;
  }
}
