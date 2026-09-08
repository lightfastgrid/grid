import { applyPopupElementSemantics } from "./popupSemantics";
import type {
  MenuPanelConfig,
  MenuPanelResult,
  MenuPanelSemantics,
  MenuSection,
} from "./types";

/**
 * Creates a generic menu panel with delegated click handling.
 *
 * The panel renders sections separated by dividers, each containing
 * menu item buttons. Click handling is delegated to a single listener
 * on the panel root — no per-item listeners are attached.
 *
 * Column-specific concerns (field, data attributes beyond the action id)
 * are NOT handled here; callers add those to the returned element.
 */
export function createMenuPanel(
  sections: MenuSection[],
  config: MenuPanelConfig,
  semantics: MenuPanelSemantics,
): MenuPanelResult {
  const panel = document.createElement("div");
  panel.className = config.panelClass;
  applyPopupElementSemantics(panel, {
    id: semantics.id,
    role: semantics.role,
    ariaLabel: semantics.ariaLabel,
  });

  const renderCleanups: (() => void)[] = [];
  const itemElements: HTMLButtonElement[] = [];
  const itemActions: (() => void)[] = [];
  let activeItemIndex = -1;
  let typeahead = "";
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    let first = true;
    for (const section of sections) {
      const hasRender = typeof section.render === "function";
      const visibleItems = section.items.filter((item) => !item.hidden);
      if (visibleItems.length === 0 && !hasRender) continue;

      if (!first) {
        const sep = document.createElement("div");
        sep.className = config.separatorClass;
        sep.setAttribute("role", "separator");
        panel.appendChild(sep);
      }
      first = false;

      for (const item of visibleItems) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = item.className
          ? `${config.itemClass} ${item.className}`
          : config.itemClass;
        if (semantics.role === "menu") {
          btn.setAttribute("role", "menuitem");
        }
        btn.tabIndex = -1;
        btn.setAttribute("data-menu-action", item.id);

        if (item.icon) {
          const iconSpan = document.createElement("span");
          iconSpan.className = config.iconClass;
          iconSpan.setAttribute("aria-hidden", "true");
          iconSpan.textContent = item.icon;
          btn.appendChild(iconSpan);
        }

        const labelSpan = document.createElement("span");
        if (config.labelClass) labelSpan.className = config.labelClass;
        labelSpan.textContent = item.label;
        btn.appendChild(labelSpan);

        if (item.disabled) {
          btn.setAttribute("disabled", "");
          btn.setAttribute("aria-disabled", "true");
        }

        const actionIndex = itemActions.length;
        itemActions.push(item.action ?? (() => {}));
        btn.setAttribute("data-menu-item-index", String(actionIndex));

        panel.appendChild(btn);
        itemElements.push(btn);
      }

      if (hasRender) {
        const host = document.createElement("div");
        panel.appendChild(host);
        const renderCleanup = section.render!(host);
        if (typeof renderCleanup === "function") {
          renderCleanups.push(renderCleanup);
        }
      }
    }
  } catch (error) {
    for (let i = renderCleanups.length - 1; i >= 0; i--) {
      try {
        renderCleanups[i]!();
      } catch {
        // Preserve the render failure.
      }
    }
    panel.remove();
    throw error;
  }

  const onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest(`.${config.itemClass}`) as HTMLButtonElement | null;
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    if (btn.hasAttribute("disabled")) return;

    const actionIndexAttr = btn.getAttribute("data-menu-item-index");
    if (actionIndexAttr === null) return;

    const actionIndex = Number(actionIndexAttr);
    if (!Number.isInteger(actionIndex) || actionIndex < 0) return;

    itemActions[actionIndex]?.();
  };

  panel.addEventListener("click", onClick);

  const isEnabled = (index: number): boolean => {
    const item = itemElements[index];
    return item !== undefined && !item.disabled;
  };

  const focusItem = (index: number): boolean => {
    if (!isEnabled(index)) return false;
    for (let i = 0; i < itemElements.length; i += 1) {
      itemElements[i]!.tabIndex = i === index ? 0 : -1;
    }
    activeItemIndex = index;
    itemElements[index]!.focus({ preventScroll: true });
    return true;
  };

  const findEnabled = (start: number, step: -1 | 1): number => {
    for (let offset = 1; offset <= itemElements.length; offset += 1) {
      const index =
        (start + step * offset + itemElements.length) % itemElements.length;
      if (isEnabled(index)) return index;
    }
    return -1;
  };

  const focusFirst = (): boolean => {
    for (let i = 0; i < itemElements.length; i += 1) {
      if (isEnabled(i)) return focusItem(i);
    }
    const control = panel.querySelector<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [contenteditable='true'], [tabindex]:not([tabindex='-1'])",
    );
    control?.focus({ preventScroll: true });
    return control !== null;
  };

  const focusLast = (): boolean => {
    for (let i = itemElements.length - 1; i >= 0; i -= 1) {
      if (isEnabled(i)) return focusItem(i);
    }
    return false;
  };

  const isBoundaryTab = (event: KeyboardEvent): boolean => {
    const controls = panel.querySelectorAll<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [contenteditable='true'], [tabindex]:not([tabindex='-1'])",
    );
    if (controls.length === 0) return true;
    return event.shiftKey
      ? event.target === controls[0]
      : event.target === controls[controls.length - 1];
  };

  const popupRole = semantics.role;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      config.onRequestClose?.("escape");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Tab") {
      if (isBoundaryTab(event)) config.onRequestClose?.("tab");
      return;
    }

    if (popupRole !== "menu") {
      return;
    }

    const current = itemElements.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    activeItemIndex = current;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const next = findEnabled(
        activeItemIndex,
        event.key === "ArrowDown" ? 1 : -1,
      );
      if (next >= 0) focusItem(next);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      if (event.key === "Home") focusFirst();
      else focusLast();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      itemElements[current]!.click();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      event.key.length !== 1 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }
    if (typeaheadTimer !== null) clearTimeout(typeaheadTimer);
    typeahead += event.key.toLocaleLowerCase();
    typeaheadTimer = setTimeout(() => {
      typeahead = "";
      typeaheadTimer = null;
    }, 500);
    const start = current + 1;
    for (let offset = 0; offset < itemElements.length; offset += 1) {
      const index = (start + offset) % itemElements.length;
      if (
        isEnabled(index) &&
        itemElements[index]!.textContent
          .trim()
          .toLocaleLowerCase()
          .startsWith(typeahead)
      ) {
        focusItem(index);
        event.preventDefault();
        event.stopPropagation();
        break;
      }
    }
  };

  panel.addEventListener("keydown", onKeyDown);

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    if (typeaheadTimer !== null) clearTimeout(typeaheadTimer);
    panel.removeEventListener("click", onClick);
    panel.removeEventListener("keydown", onKeyDown);
    let primaryError: unknown;
    for (let i = renderCleanups.length - 1; i >= 0; i--) {
      try {
        renderCleanups[i]!();
      } catch (error) {
        primaryError ??= error;
      }
    }
    panel.remove();
    if (primaryError !== undefined) {
      throw primaryError;
    }
  };

  return { element: panel, cleanup, focusFirst };
}
