// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorValidationSemantics } from "../editorValidationSemantics";

function createPresentation() {
  const cell = document.createElement("div");
  const host = document.createElement("div");
  const editor = document.createElement("input");
  cell.appendChild(host);
  host.appendChild(editor);
  document.body.appendChild(cell);
  return { cell, host, editor };
}

describe("EditorValidationSemantics", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("publishes a canonical pertinent error and clears it completely", () => {
    const semantics = new EditorValidationSemantics();
    const presentation = createPresentation();

    semantics.expose({ ...presentation, message: "Invalid number" });

    expect(presentation.cell.classList).toContain("lfg-cell-editor-invalid");
    expect(presentation.editor.getAttribute("aria-invalid")).toBe("true");
    const errorId = presentation.editor.getAttribute("aria-errormessage");
    expect(errorId).toMatch(/^lfg-editor-error-[1-9]\d*$/);
    const error = document.getElementById(errorId!);
    expect(error?.textContent).toBe("Invalid number");
    expect(error?.className).toBe("lfg-editor-error");
    expect(error?.hidden).toBe(false);
    expect(error?.hasAttribute("aria-hidden")).toBe(false);

    semantics.clear(presentation.cell, presentation.editor);

    expect(presentation.editor.hasAttribute("aria-invalid")).toBe(false);
    expect(presentation.editor.hasAttribute("aria-errormessage")).toBe(false);
    expect(presentation.cell.classList).not.toContain(
      "lfg-cell-editor-invalid",
    );
    expect(document.getElementById(errorId!)).toBeNull();

    semantics.expose({ ...presentation, message: "Value is required" });
    expect(document.getElementById(errorId!)).toBe(error);
    expect(error?.textContent).toBe("Value is required");
    semantics.destroy();
  });

  it("reuses one error node and performs zero writes for unchanged exposure", async () => {
    const semantics = new EditorValidationSemantics();
    const presentation = createPresentation();
    semantics.expose({ ...presentation, message: "Invalid number" });
    const error = presentation.host.querySelector(".lfg-editor-error")!;
    const editorSet = vi.spyOn(presentation.editor, "setAttribute");
    const append = vi.spyOn(presentation.host, "appendChild");
    const textMutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      textMutations.push(...records);
    });
    observer.observe(error, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    semantics.expose({ ...presentation, message: "Invalid number" });
    await Promise.resolve();

    expect(editorSet).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(textMutations).toHaveLength(0);
    expect(presentation.host.querySelectorAll(".lfg-editor-error")).toHaveLength(
      1,
    );
    observer.disconnect();
    semantics.destroy();
  });

  it("moves the same error identity with an invalid pooled editor", () => {
    const semantics = new EditorValidationSemantics();
    const first = createPresentation();
    semantics.expose({ ...first, message: "Value is required" });
    const error = first.host.querySelector<HTMLElement>(".lfg-editor-error")!;
    const errorId = error.id;

    const nextCell = document.createElement("div");
    const nextHost = document.createElement("div");
    nextCell.appendChild(nextHost);
    document.body.appendChild(nextCell);
    semantics.move(first.cell, nextCell, nextHost);

    expect(nextHost.querySelector(".lfg-editor-error")).toBe(error);
    expect(error.id).toBe(errorId);
    expect(error.textContent).toBe("Value is required");
    expect(first.cell.classList).not.toContain("lfg-cell-editor-invalid");
    expect(nextCell.classList).toContain("lfg-cell-editor-invalid");
    semantics.destroy();
  });

  it("allocates unique controller-scoped IDs without user fragments", () => {
    const firstSemantics = new EditorValidationSemantics();
    const secondSemantics = new EditorValidationSemantics();
    const first = createPresentation();
    const second = createPresentation();

    firstSemantics.expose({ ...first, message: "<unsafe row id>" });
    secondSemantics.expose({ ...second, message: "field.name" });

    const firstId = first.editor.getAttribute("aria-errormessage")!;
    const secondId = second.editor.getAttribute("aria-errormessage")!;
    expect(firstId).not.toBe(secondId);
    expect(firstId).toMatch(/^lfg-editor-error-[1-9]\d*$/);
    expect(secondId).toMatch(/^lfg-editor-error-[1-9]\d*$/);
    expect(firstId).not.toContain("unsafe");
    expect(secondId).not.toContain("field");
    firstSemantics.destroy();
    secondSemantics.destroy();
  });
});
