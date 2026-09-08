// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { NormalizedCellEditorConfig } from "../editingTypes";
import { EditorPool } from "../EditorPool";

function config(
  kind: NormalizedCellEditorConfig["kind"],
  extra: Partial<NormalizedCellEditorConfig> = {},
): NormalizedCellEditorConfig {
  return { kind, options: [], ...extra };
}

describe("EditorPool", () => {
  it("creates a text editor with an input element", () => {
    const pool = new EditorPool();
    const editor = pool.get(config("text"));
    expect(editor.kind).toBe("text");
    expect(editor.element).toBeInstanceOf(HTMLInputElement);
    expect((editor.element as HTMLInputElement).type).toBe("text");
    pool.destroy();
  });

  it("creates a number editor with an input element", () => {
    const pool = new EditorPool();
    const editor = pool.get(config("number"));
    expect(editor.kind).toBe("number");
    expect((editor.element as HTMLInputElement).type).toBe("number");
    pool.destroy();
  });

  it("creates a date editor with an input element", () => {
    const pool = new EditorPool();
    const editor = pool.get(config("date"));
    expect(editor.kind).toBe("date");
    expect((editor.element as HTMLInputElement).type).toBe("date");
    pool.destroy();
  });

  it("creates a checkbox editor with an input element", () => {
    const pool = new EditorPool();
    const editor = pool.get(config("checkbox"));
    expect(editor.kind).toBe("checkbox");
    expect((editor.element as HTMLInputElement).type).toBe("checkbox");
    pool.destroy();
  });

  it("creates a select editor with a select element", () => {
    const pool = new EditorPool();
    const editor = pool.get(
      config("select", {
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ],
      }),
    );
    expect(editor.kind).toBe("select");
    expect(editor.element).toBeInstanceOf(HTMLSelectElement);
    expect((editor.element as HTMLSelectElement).options).toHaveLength(2);
    pool.destroy();
  });

  it("reuses the same instance for the same kind", () => {
    const pool = new EditorPool();
    const first = pool.get(config("text"));
    const second = pool.get(config("text"));
    expect(first).toBe(second);
    expect(first.element).toBe(second.element);
    pool.destroy();
  });

  it("reuses checkbox instance for boolean alias (via normalized kind)", () => {
    const pool = new EditorPool();
    const checkbox = pool.get(config("checkbox"));
    const again = pool.get(config("checkbox"));
    expect(checkbox).toBe(again);
    pool.destroy();
  });

  it("returns different instances for different kinds", () => {
    const pool = new EditorPool();
    const text = pool.get(config("text"));
    const number = pool.get(config("number"));
    expect(text).not.toBe(number);
    expect(text.element).not.toBe(number.element);
    pool.destroy();
  });

  it("does not create new DOM elements on repeated get calls", () => {
    const pool = new EditorPool();
    const first = pool.get(config("date"));
    const el = first.element;
    pool.get(config("date"));
    pool.get(config("date"));
    expect(pool.get(config("date")).element).toBe(el);
    pool.destroy();
  });

  it("setValue and getValue round-trip for text", () => {
    const pool = new EditorPool();
    const editor = pool.get(config("text"));
    editor.setValue("hello");
    expect(editor.getValue()).toBe("hello");
    pool.destroy();
  });

  it("setValue and getValue round-trip for number", () => {
    const pool = new EditorPool();
    const editor = pool.get(config("number"));
    editor.setValue(42);
    expect(editor.getValue()).toBe("42");
    pool.destroy();
  });

  it("setValue and getValue round-trip for checkbox", () => {
    const pool = new EditorPool();
    const editor = pool.get(config("checkbox"));
    editor.setValue(true);
    expect(editor.getValue()).toBe(true);
    editor.setValue(false);
    expect(editor.getValue()).toBe(false);
    editor.setValue("true");
    expect(editor.getValue()).toBe(true);
    editor.setValue(1);
    expect(editor.getValue()).toBe(true);
    editor.setValue("false");
    expect(editor.getValue()).toBe(false);
    editor.setValue(0);
    expect(editor.getValue()).toBe(false);
    editor.setValue("yes");
    expect(editor.getValue()).toBe(false);
    pool.destroy();
  });

  it("reset clears the editor value", () => {
    const pool = new EditorPool();
    const editor = pool.get(config("text"));
    editor.setValue("something");
    editor.reset();
    expect(editor.getValue()).toBe("");
    pool.destroy();
  });

  it("select refreshConfig replaces options on the pooled element", () => {
    const pool = new EditorPool();
    const editor = pool.get(
      config("select", {
        options: [{ value: "a", label: "Alpha" }],
      }),
    );
    const sel = editor.element as HTMLSelectElement;
    expect(sel.options).toHaveLength(1);
    expect(sel.options[0]!.value).toBe("a");

    editor.refreshConfig({
      kind: "select",
      options: [
        { value: "x", label: "X-ray" },
        { value: "y", label: "Yankee" },
        { value: "z", label: "Zulu" },
      ],
    });
    expect(sel.options).toHaveLength(3);
    expect(sel.options[0]!.value).toBe("x");
    expect(sel.options[2]!.textContent).toBe("Zulu");

    pool.destroy();
  });

  it("refreshes select options on repeated get with different config", () => {
    const pool = new EditorPool();
    const configA: NormalizedCellEditorConfig = {
      kind: "select",
      options: [{ value: "a", label: "Alpha" }],
    };
    const configB: NormalizedCellEditorConfig = {
      kind: "select",
      options: [
        { value: "x", label: "X-ray" },
        { value: "y", label: "Yankee" },
      ],
    };
    const first = pool.get(configA);
    const second = pool.get(configB);
    expect(second).toBe(first);
    const sel = second.element as HTMLSelectElement;
    expect(sel.options).toHaveLength(2);
    expect(sel.options[0]!.value).toBe("x");
    expect(sel.options[1]!.value).toBe("y");
    pool.destroy();
  });

  it("refreshes text placeholder and maxLength on repeated get", () => {
    const pool = new EditorPool();
    pool.get(config("text", { placeholder: "first", maxLength: 10 }));
    const editor = pool.get(config("text", { placeholder: "second", maxLength: 50 }));
    const el = editor.element as HTMLInputElement;
    expect(el.placeholder).toBe("second");
    expect(el.maxLength).toBe(50);
    pool.destroy();
  });

  it("clears text maxLength when new config omits it", () => {
    const pool = new EditorPool();
    pool.get(config("text", { maxLength: 10 }));
    const editor = pool.get(config("text"));
    const el = editor.element as HTMLInputElement;
    expect(el.hasAttribute("maxLength")).toBe(false);
    pool.destroy();
  });

  it("refreshes number placeholder on repeated get", () => {
    const pool = new EditorPool();
    pool.get(config("number", { placeholder: "old" }));
    const editor = pool.get(config("number", { placeholder: "new" }));
    const el = editor.element as HTMLInputElement;
    expect(el.placeholder).toBe("new");
    pool.destroy();
  });

  it("date editor focus() calls showPicker when available", () => {
    const pool = new EditorPool();
    const editor = pool.get(config("date"));
    const el = editor.element as HTMLInputElement;
    document.body.appendChild(el);
    const spy = vi.fn();
    el.showPicker = spy;
    editor.focus();
    expect(spy).toHaveBeenCalledOnce();
    pool.destroy();
  });

  it("date editor focus() does not throw when showPicker throws", () => {
    const pool = new EditorPool();
    const editor = pool.get(config("date"));
    const el = editor.element as HTMLInputElement;
    document.body.appendChild(el);
    el.showPicker = () => { throw new Error("not user-activated"); };
    expect(() => editor.focus()).not.toThrow();
    pool.destroy();
  });

  it("date and checkbox refreshConfig are no-ops and do not throw", () => {
    const pool = new EditorPool();
    const date = pool.get(config("date"));
    const cb = pool.get(config("checkbox"));
    expect(() => date.refreshConfig(config("date"))).not.toThrow();
    expect(() => cb.refreshConfig(config("checkbox"))).not.toThrow();
    pool.destroy();
  });

  it("applies and clears required semantics on every pooled editor kind", () => {
    const pool = new EditorPool();
    for (const kind of [
      "text",
      "number",
      "date",
      "checkbox",
      "select",
    ] as const) {
      const required = pool.get(config(kind, { required: true }));
      expect(required.element.getAttribute("aria-required")).toBe("true");

      const reused = pool.get(config(kind));
      expect(reused).toBe(required);
      expect(reused.element.hasAttribute("aria-required")).toBe(false);
    }
    pool.destroy();
  });

  it("performs zero required-attribute writes for an unchanged config", () => {
    const pool = new EditorPool();
    const editor = pool.get(config("text", { required: true }));
    const setAttribute = vi.spyOn(editor.element, "setAttribute");
    const removeAttribute = vi.spyOn(editor.element, "removeAttribute");

    pool.get(config("text", { required: true }));

    expect(
      setAttribute.mock.calls.filter(([name]) => name === "aria-required"),
    ).toHaveLength(0);
    expect(
      removeAttribute.mock.calls.filter(([name]) => name === "aria-required"),
    ).toHaveLength(0);
    pool.destroy();
  });

  it("destroy removes elements and clears pool", () => {
    const pool = new EditorPool();
    const editor = pool.get(config("text"));
    document.body.appendChild(editor.element);
    expect(document.body.contains(editor.element)).toBe(true);
    pool.destroy();
    expect(document.body.contains(editor.element)).toBe(false);
  });
});
