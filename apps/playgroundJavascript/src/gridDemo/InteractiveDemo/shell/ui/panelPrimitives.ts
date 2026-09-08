import { el } from "../dom.ts";
import { bindFocusStealGuard } from "../ToolbarIcons.ts";

export type PanelHeaderHandle = {
  root: HTMLElement;
  destroy: () => void;
};

export function mountPanelHeader(
  parent: HTMLElement,
  options: { title: string; onClose: () => void },
): PanelHeaderHandle {
  const root = el("div", "interactive-demo-panel-heading");
  root.append(el("strong", "interactive-demo-panel-heading-title", options.title));
  const closeBtn = el("button", "interactive-demo-panel-heading-close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  const unguard = bindFocusStealGuard(closeBtn);
  const onClick = () => options.onClose();
  closeBtn.addEventListener("click", onClick);
  root.append(closeBtn);
  parent.append(root);
  return {
    root,
    destroy() {
      unguard();
      closeBtn.removeEventListener("click", onClick);
      root.remove();
    },
  };
}

export function mountPanelDivider(parent: HTMLElement): HTMLElement {
  const node = el("div", "interactive-demo-panel-divider");
  node.setAttribute("role", "separator");
  parent.append(node);
  return node;
}

export function mountPanelInfoFooter(
  parent: HTMLElement,
  text: string,
): HTMLElement {
  const footer = el("p", "interactive-demo-panel-info", text);
  parent.append(footer);
  return footer;
}

export type PanelActionRowOptions = {
  icon: Node;
  title: string;
  description?: string;
  disabled?: boolean;
  trailing?: Node;
  onClick: () => void;
};

export function mountPanelActionRow(
  parent: HTMLElement,
  options: PanelActionRowOptions,
): () => void {
  const button = el("button", "interactive-demo-panel-action");
  button.type = "button";
  button.disabled = Boolean(options.disabled);
  const icon = el("span", "interactive-demo-panel-action-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.append(options.icon);
  const text = el("span", "interactive-demo-panel-action-text");
  text.append(el("span", "interactive-demo-panel-action-title", options.title));
  if (options.description) {
    text.append(
      el("span", "interactive-demo-panel-action-desc", options.description),
    );
  }
  button.append(icon, text);
  if (options.trailing) {
    const trailing = el("span", "interactive-demo-panel-action-trailing");
    trailing.setAttribute("aria-hidden", "true");
    trailing.append(options.trailing);
    button.append(trailing);
  }
  const unguard = bindFocusStealGuard(button);
  const onClick = () => options.onClick();
  button.addEventListener("click", onClick);
  parent.append(button);
  return () => {
    unguard();
    button.removeEventListener("click", onClick);
    button.remove();
  };
}

export type PanelToggleRowOptions = {
  label: string;
  description?: string;
  icon?: Node;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function mountPanelToggleRow(
  parent: HTMLElement,
  options: PanelToggleRowOptions,
): () => void {
  const row = el("div", "interactive-demo-panel-toggle");
  if (options.icon) {
    const icon = el("span", "interactive-demo-panel-toggle-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.append(options.icon);
    row.append(icon);
  }
  const copy = el("span", "interactive-demo-panel-toggle-copy");
  copy.append(el("span", "interactive-demo-panel-toggle-label", options.label));
  if (options.description) {
    copy.append(
      el("span", "interactive-demo-panel-toggle-desc", options.description),
    );
  }
  row.append(copy);

  const button = el("button", "interactive-demo-switch") as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("role", "switch");
  button.setAttribute("aria-checked", String(options.checked));
  button.setAttribute("aria-label", options.label);
  if (options.checked) button.classList.add("is-on");
  button.append(el("span", "interactive-demo-switch-thumb"));

  let checked = options.checked;
  const unguard = bindFocusStealGuard(button);
  const onClick = () => {
    checked = !checked;
    button.classList.toggle("is-on", checked);
    button.setAttribute("aria-checked", String(checked));
    options.onChange(checked);
  };
  button.addEventListener("click", onClick);
  row.append(button);
  parent.append(row);
  return () => {
    unguard();
    button.removeEventListener("click", onClick);
    row.remove();
  };
}

export type PanelRadioRowOptions = {
  name: string;
  value: string;
  label: string;
  description?: string;
  checked: boolean;
  onSelect: (value: string) => void;
};

export function mountPanelRadioRow(
  parent: HTMLElement,
  options: PanelRadioRowOptions,
): () => void {
  const row = el("label", "interactive-demo-panel-radio");
  const input = el("input");
  input.type = "radio";
  input.name = options.name;
  input.value = options.value;
  input.checked = options.checked;
  const unguard = bindFocusStealGuard(input);
  const onChange = () => {
    if (input.checked) options.onSelect(options.value);
  };
  input.addEventListener("change", onChange);
  const text = el("span", "interactive-demo-panel-radio-text");
  text.append(el("span", "interactive-demo-panel-radio-label", options.label));
  if (options.description) {
    text.append(
      el("span", "interactive-demo-panel-radio-desc", options.description),
    );
  }
  row.append(input, text);
  parent.append(row);
  return () => {
    unguard();
    input.removeEventListener("change", onChange);
    row.remove();
  };
}

export type PanelMenuItemOptions = {
  label: string;
  icon?: Node;
  hint?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export function mountPanelMenuItem(
  parent: HTMLElement,
  options: PanelMenuItemOptions,
): () => void {
  const button = el("button", "interactive-demo-panel-menu-item");
  button.type = "button";
  button.disabled = Boolean(options.disabled);
  if (options.selected) button.classList.add("is-selected");
  button.setAttribute("aria-pressed", String(Boolean(options.selected)));
  if (options.icon) {
    const icon = el("span", "interactive-demo-panel-menu-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.append(options.icon);
    button.append(icon);
  }
  button.append(el("span", "interactive-demo-panel-menu-title", options.label));
  if (options.hint) {
    button.append(el("span", "interactive-demo-panel-menu-hint", options.hint));
  }
  const unguard = bindFocusStealGuard(button);
  const onClick = () => options.onClick();
  button.addEventListener("click", onClick);
  parent.append(button);
  return () => {
    unguard();
    button.removeEventListener("click", onClick);
    button.remove();
  };
}

export type PanelSearchFieldOptions = {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  onChange: (value: string) => void;
};

export function mountPanelSearchField(
  parent: HTMLElement,
  options: PanelSearchFieldOptions,
): { root: HTMLElement; setValue: (value: string) => void; destroy: () => void } {
  const wrap = el("div", "interactive-demo-panel-search");
  const input = el("input");
  input.type = "search";
  input.value = options.value;
  input.placeholder = options.placeholder ?? "Search…";
  input.setAttribute("aria-label", options.ariaLabel);
  const unguard = bindFocusStealGuard(input);
  const onInput = () => options.onChange(input.value);
  input.addEventListener("input", onInput);
  wrap.append(input);
  parent.append(wrap);
  return {
    root: wrap,
    setValue(value: string) {
      input.value = value;
    },
    destroy() {
      unguard();
      input.removeEventListener("input", onInput);
      wrap.remove();
    },
  };
}
