import { el } from "./dom.ts";
import { bindFocusStealGuard } from "./ToolbarIcons.ts";
import { iconChevronDown } from "./ToolbarIcons.ts";

export type ToolbarNavButtonOptions = {
  label: string;
  icon: Node;
  active?: boolean;
  primary?: boolean;
  chevron?: boolean;
  menu?: boolean;
  badge?: number;
  title?: string;
  ariaLabel?: string;
  onClick: () => void;
};

export type ToolbarNavButtonHandle = {
  button: HTMLButtonElement;
  setActive: (active: boolean) => void;
  setBadge: (badge: number) => void;
  destroy: () => void;
};

export function mountToolbarNavButton(
  parent: HTMLElement,
  options: ToolbarNavButtonOptions,
): ToolbarNavButtonHandle {
  const button = el("button", "interactive-demo-btn") as HTMLButtonElement;
  button.type = "button";
  if (options.primary) button.classList.add("interactive-demo-btn-primary");
  if (options.active) button.classList.add("is-active");
  if (options.title) button.title = options.title;
  if (options.ariaLabel) button.setAttribute("aria-label", options.ariaLabel);
  const isMenu = Boolean(options.menu || options.chevron);
  if (isMenu) {
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", String(Boolean(options.active)));
  }

  const icon = el("span", "interactive-demo-btn-icon");
  icon.append(options.icon);
  button.append(icon, el("span", "interactive-demo-btn-label", options.label));

  let badgeEl: HTMLSpanElement | null = null;
  const setBadge = (badge: number) => {
    if (badge > 0) {
      if (!badgeEl) {
        badgeEl = el("span", "interactive-demo-badge", String(badge));
        button.insertBefore(
          badgeEl,
          options.chevron
            ? button.querySelector(".interactive-demo-btn-chevron")
            : null,
        );
      } else {
        badgeEl.textContent = String(badge);
      }
    } else if (badgeEl) {
      badgeEl.remove();
      badgeEl = null;
    }
  };
  if (typeof options.badge === "number") setBadge(options.badge);

  if (options.chevron) {
    const chevron = el("span", "interactive-demo-btn-chevron");
    chevron.append(iconChevronDown());
    button.append(chevron);
  }

  const unguard = bindFocusStealGuard(button);
  const onClick = () => options.onClick();
  button.addEventListener("click", onClick);
  parent.append(button);

  return {
    button,
    setActive(active: boolean) {
      button.classList.toggle("is-active", active);
      if (isMenu) {
        button.setAttribute("aria-expanded", String(active));
      }
    },
    setBadge,
    destroy() {
      unguard();
      button.removeEventListener("click", onClick);
      button.remove();
    },
  };
}

export type ToolbarPanelAlign = "start" | "end";

export function mountToolbarPanelHost(
  parent: HTMLElement,
  options: { ariaLabel: string; align?: ToolbarPanelAlign },
): { host: HTMLElement; destroy: () => void } {
  const host = el("div", "interactive-demo-panel");
  host.dataset.align = options.align ?? "start";
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-modal", "false");
  host.setAttribute("aria-label", options.ariaLabel);
  const unguard = bindFocusStealGuard(host);
  parent.append(host);
  return {
    host,
    destroy() {
      unguard();
      host.remove();
    },
  };
}
