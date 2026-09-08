import type { NormalizedCellEditorConfig, SelectOption } from "./editingTypes";

export interface EditorInstance {
  readonly element: HTMLElement;
  readonly kind: NormalizedCellEditorConfig["kind"];
  setValue(value: unknown): void;
  getValue(): unknown;
  focus(): void;
  reset(): void;
  refreshConfig(config: NormalizedCellEditorConfig): void;
}

function createTextInput(placeholder?: string, maxLength?: number): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "lfg-editor lfg-editor-text";
  if (placeholder) input.placeholder = placeholder;
  if (maxLength !== undefined) input.maxLength = maxLength;
  return input;
}

function createNumberInput(placeholder?: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "lfg-editor lfg-editor-number";
  if (placeholder) input.placeholder = placeholder;
  return input;
}

function createDateInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "date";
  input.className = "lfg-editor lfg-editor-date";
  return input;
}

function createCheckboxInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "lfg-editor lfg-editor-checkbox";
  return input;
}

function createSelectInput(): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "lfg-editor lfg-editor-select";
  return select;
}

function populateSelectOptions(el: HTMLSelectElement, opts: readonly SelectOption[]): void {
  el.innerHTML = "";
  for (const opt of opts) {
    const optEl = document.createElement("option");
    optEl.value = String(opt.value);
    optEl.textContent = opt.label;
    el.appendChild(optEl);
  }
}

function syncRequired(
  element: HTMLElement,
  config: NormalizedCellEditorConfig,
): void {
  if (config.required === true) {
    if (element.getAttribute("aria-required") !== "true") {
      element.setAttribute("aria-required", "true");
    }
    return;
  }
  if (element.hasAttribute("aria-required")) {
    element.removeAttribute("aria-required");
  }
}

function makeEditorInstance(config: NormalizedCellEditorConfig): EditorInstance {
  switch (config.kind) {
    case "text": {
      const el = createTextInput(config.placeholder, config.maxLength);
      return {
        element: el,
        kind: "text",
        setValue: (v) => { el.value = v === null || v === undefined ? "" : String(v); },
        getValue: () => el.value,
        focus: () => { el.focus(); el.select(); },
        reset: () => { el.value = ""; },
        refreshConfig: (c) => {
          el.placeholder = c.placeholder ?? "";
          if (c.maxLength !== undefined) {
            el.maxLength = c.maxLength;
          } else {
            el.removeAttribute("maxLength");
          }
        },
      };
    }
    case "number": {
      const el = createNumberInput(config.placeholder);
      return {
        element: el,
        kind: "number",
        setValue: (v) => { el.value = v === null || v === undefined ? "" : String(v); },
        getValue: () => el.value,
        focus: () => { el.focus(); el.select(); },
        reset: () => { el.value = ""; },
        refreshConfig: (c) => {
          el.placeholder = c.placeholder ?? "";
        },
      };
    }
    case "date": {
      const el = createDateInput();
      return {
        element: el,
        kind: "date",
        setValue: (v) => { el.value = v === null || v === undefined ? "" : String(v); },
        getValue: () => el.value,
        focus: () => {
          el.focus();
          try { el.showPicker(); } catch { /* not supported or not user-activated */ }
        },
        reset: () => { el.value = ""; },
        refreshConfig: () => {},
      };
    }
    case "checkbox": {
      const el = createCheckboxInput();
      return {
        element: el,
        kind: "checkbox",
        setValue: (v) => { el.checked = v === true || v === "true" || v === 1; },
        getValue: () => el.checked,
        focus: () => el.focus(),
        reset: () => { el.checked = false; },
        refreshConfig: () => {},
      };
    }
    case "select": {
      const el = createSelectInput();
      populateSelectOptions(el, config.options);
      return {
        element: el,
        kind: "select",
        setValue: (v) => { el.value = String(v ?? ""); },
        getValue: () => el.value,
        focus: () => el.focus(),
        reset: () => { el.selectedIndex = 0; },
        refreshConfig: (c) => { populateSelectOptions(el, c.options); },
      };
    }
  }
}

export class EditorPool {
  private readonly pool = new Map<string, EditorInstance>();

  get(config: NormalizedCellEditorConfig): EditorInstance {
    const key = config.kind;
    const existing = this.pool.get(key);
    if (existing) {
      existing.refreshConfig(config);
      syncRequired(existing.element, config);
      return existing;
    }
    const instance = makeEditorInstance(config);
    syncRequired(instance.element, config);
    this.pool.set(key, instance);
    return instance;
  }

  destroy(): void {
    for (const inst of this.pool.values()) {
      inst.element.remove();
    }
    this.pool.clear();
  }
}
