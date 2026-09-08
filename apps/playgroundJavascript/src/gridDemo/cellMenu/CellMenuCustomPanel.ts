import type { CellMenuPanelRenderContext } from "@lightfastgrid/core";

import "./CellMenuCustomPanel.css";

type StatusTone = "active" | "pending" | "danger" | "neutral";

function statusTone(status: string): StatusTone {
  const key = status.toLowerCase();
  if (key === "active") return "active";
  if (key === "pending") return "pending";
  if (key === "suspended" || key === "inactive") return "danger";
  return "neutral";
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgIcon(pathD: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", pathD);
  svg.append(path);
  return svg;
}

const MAIL_PATH =
  "M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Zm.5 1.2 5.1 3.4a.8.8 0 0 0 .9 0L13.5 4.7V4.5h-10.5v.2Zm10.5 1.5-4.6 3a2.2 2.2 0 0 1-2.4 0l-4.6-3V11.5h11.6V6.2Z";
const USER_PATH =
  "M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1.5c-2.7 0-5 1.5-5 3.3 0 .7.6 1.2 1.3 1.2h7.4c.7 0 1.3-.5 1.3-1.2 0-1.8-2.3-3.3-5-3.3Z";
const DOCS_PATH =
  "M4.5 1.5h5.2L13.5 5.3V13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3.5 13V3A1.5 1.5 0 0 1 4.5 1.5Zm4.8 1.2v2.8h2.8L9.3 2.7ZM5 6.5h6v1.2H5V6.5Zm0 2.5h6v1.2H5V9Zm0 2.5h4v1.2H5V11.5Z";

/**
 * DOM card mounted in `cellMenu.renderPanel` — matches the React product mock.
 */
export function mountCellMenuCustomPanel(
  host: HTMLElement,
  ctx: CellMenuPanelRenderContext,
): () => void {
  const { row, rowId, field, value, close } = ctx;
  const name = typeof row.name === "string" ? row.name : "—";
  const status = typeof row.status === "string" ? row.status : "—";
  const email = typeof row.email === "string" ? row.email : "";
  const avatar = typeof row.avatar === "string" ? row.avatar : "";
  const profileHref = `#/demo/people/${encodeURIComponent(rowId)}`;
  const valueText =
    value === null || value === undefined || value === "" ? "—" : String(value);
  const initials = initialsFromName(name === "—" ? rowId : name);
  const cleanups: Array<() => void> = [];

  const root = el("div", "cell-menu-custom-panel");
  const kicker = el("p", "cell-menu-custom-panel-kicker");
  kicker.append(
    document.createTextNode("Cell links "),
    el("span", undefined, "·"),
    document.createTextNode(` ${field}`),
  );
  kicker.querySelector("span")?.setAttribute("aria-hidden", "true");
  root.append(kicker);

  const card = el("div", "cell-menu-custom-card");
  const cardHeader = el("div", "cell-menu-custom-card-header");
  const identity = el("div", "cell-menu-custom-identity");
  if (avatar) {
    const img = el("img", "cell-menu-custom-avatar");
    img.src = avatar;
    img.alt = "";
    img.width = 28;
    img.height = 28;
    identity.append(img);
  } else {
    identity.append(
      el(
        "span",
        "cell-menu-custom-avatar cell-menu-custom-avatar-fallback",
        initials,
      ),
    );
  }
  identity.append(el("span", "cell-menu-custom-name", name));
  cardHeader.append(
    identity,
    el(
      "span",
      `cell-menu-custom-chip cell-menu-custom-chip-${statusTone(status)}`,
      status,
    ),
  );
  card.append(cardHeader);

  const valueEl = el("p", "cell-menu-custom-value", valueText);
  valueEl.title = valueText;
  card.append(valueEl);

  const divider = el("div", "cell-menu-custom-divider");
  divider.setAttribute("role", "separator");
  card.append(divider);

  const links = el("ul", "cell-menu-custom-links");

  const appendLink = (
    label: string,
    href: string,
    iconPath: string,
    onClick?: (event: MouseEvent) => void,
    external = false,
  ) => {
    const item = el("li");
    const anchor = el("a");
    anchor.href = href;
    if (external) {
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
    }
    const iconWrap = el("span", "cell-menu-custom-link-icon");
    iconWrap.append(svgIcon(iconPath));
    anchor.append(iconWrap, el("span", undefined, label));
    if (external) {
      const ext = el("span", "cell-menu-custom-external", "↗");
      ext.setAttribute("aria-hidden", "true");
      anchor.append(ext);
    }
    if (onClick) {
      anchor.addEventListener("click", onClick);
      cleanups.push(() => anchor.removeEventListener("click", onClick));
    }
    item.append(anchor);
    links.append(item);
  };

  if (email.includes("@")) {
    appendLink(`Email ${name}`, `mailto:${email}`, MAIL_PATH);
  }

  appendLink("Open profile", profileHref, USER_PATH, (event) => {
    event.preventDefault();
    close();
  });

  appendLink(
    "Grid docs",
    "https://lightfastgrid.com",
    DOCS_PATH,
    undefined,
    true,
  );

  card.append(links);
  root.append(card);
  host.append(root);

  return () => {
    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      cleanups[index]?.();
    }
    root.remove();
  };
}
