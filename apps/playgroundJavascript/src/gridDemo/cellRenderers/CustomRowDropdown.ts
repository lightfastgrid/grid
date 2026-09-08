import type { RowData } from "@lightfastgrid/core";

import "./CustomRowDropdown.css";

export type CustomRowDropdownProps = {
  host: HTMLElement;
  row: RowData;
  rowIndex: number;
  rowId: string;
  close: () => void;
  onView: () => void;
};

type StatusTone = "active" | "pending" | "danger" | "neutral";

function statusTone(status: string): StatusTone {
  const key = status.toLowerCase();
  if (key === "active") return "active";
  if (key === "pending") return "pending";
  if (key === "suspended" || key === "inactive") return "danger";
  return "neutral";
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

/**
 * Mount the custom row-action panel into `host`.
 * Returns cleanup that removes listeners and children.
 */
export function mountCustomRowDropdown(
  props: CustomRowDropdownProps,
): () => void {
  const { host, row, rowIndex, rowId, close, onView } = props;
  const name = typeof row.name === "string" ? row.name : "—";
  const status = typeof row.status === "string" ? row.status : "—";
  const email = typeof row.email === "string" ? row.email : "—";
  const country = typeof row.country === "string" ? row.country : "—";
  const cleanups: Array<() => void> = [];

  const root = el("div", "custom-row-dropdown");

  const header = el("header", "custom-row-dropdown-header");
  const headerText = el("div");
  headerText.append(
    el("p", "custom-row-dropdown-kicker", "Per-cell dropdown"),
    el("h3", undefined, name),
  );
  const subtitle = el("div", "custom-row-dropdown-subtitle");
  subtitle.append(
    el(
      "span",
      `custom-row-dropdown-chip custom-row-dropdown-chip-${statusTone(status)}`,
      status,
    ),
    el("span", "custom-row-dropdown-muted", country),
  );
  headerText.append(subtitle);

  const closeBtn = el("button", "custom-row-dropdown-icon-btn", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  const onCloseClick = () => close();
  closeBtn.addEventListener("click", onCloseClick);
  cleanups.push(() => closeBtn.removeEventListener("click", onCloseClick));
  header.append(headerText, closeBtn);
  root.append(header);

  const links = el("section", "custom-row-dropdown-links");
  links.setAttribute("aria-label", "Row links");
  links.append(el("p", "custom-row-dropdown-section-label", "Links"));
  const list = el("ul");
  const profileHref = `#/demo/people/${encodeURIComponent(rowId)}`;
  const hasEmail = email.includes("@");

  if (hasEmail) {
    const mailItem = el("li");
    const mailLink = el("a", undefined, `Email ${name}`);
    mailLink.href = `mailto:${email}`;
    mailItem.append(mailLink);
    list.append(mailItem);
  } else {
    const disabled = el("li");
    disabled.append(el("span", "custom-row-dropdown-link-disabled", "No email"));
    list.append(disabled);
  }

  const profileItem = el("li");
  const profileLink = el("a", undefined, "View profile");
  profileLink.href = profileHref;
  const onProfile = (event: MouseEvent) => {
    event.preventDefault();
    close();
  };
  profileLink.addEventListener("click", onProfile);
  cleanups.push(() => profileLink.removeEventListener("click", onProfile));
  profileItem.append(profileLink);
  list.append(profileItem);

  const docsItem = el("li");
  const docsLink = el("a", undefined, "Grid docs ↗");
  docsLink.href = "https://lightfastgrid.com";
  docsLink.target = "_blank";
  docsLink.rel = "noreferrer";
  docsItem.append(docsLink);
  list.append(docsItem);
  links.append(list);
  root.append(links);

  const meta = el("dl", "custom-row-dropdown-meta");
  const addMeta = (label: string, value: string, span = false) => {
    const wrap = el("div", span ? "custom-row-dropdown-meta-span" : undefined);
    wrap.append(el("dt", undefined, label), el("dd", undefined, value));
    meta.append(wrap);
  };
  addMeta("Row id", rowId);
  addMeta("Index", String(rowIndex));
  addMeta("Email", email, true);
  root.append(meta);

  const footer = el("footer", "custom-row-dropdown-footer");
  const copyBtn = el("button", undefined, "Copy id");
  copyBtn.type = "button";
  const onCopy = () => {
    void navigator.clipboard.writeText(rowId);
  };
  copyBtn.addEventListener("click", onCopy);
  cleanups.push(() => copyBtn.removeEventListener("click", onCopy));

  const viewBtn = el("button", "custom-row-dropdown-primary", "View row");
  viewBtn.type = "button";
  const onViewClick = () => {
    onView();
  };
  viewBtn.addEventListener("click", onViewClick);
  cleanups.push(() => viewBtn.removeEventListener("click", onViewClick));

  footer.append(copyBtn, viewBtn);
  root.append(footer);
  host.append(root);

  return () => {
    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      cleanups[index]?.();
    }
    root.remove();
  };
}
