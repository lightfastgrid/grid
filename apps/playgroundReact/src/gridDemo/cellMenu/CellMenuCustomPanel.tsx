import type { CellMenuPanelRenderContext } from "@lightfastgrid/core";

import "./CellMenuCustomPanel.css";

function statusTone(
  status: string,
): "active" | "pending" | "danger" | "neutral" {
  const key = status.toLowerCase();
  if (key === "active") return "active";
  if (key === "pending") return "pending";
  if (key === "suspended" || key === "inactive") return "danger";
  return "neutral";
}

function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function MailIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Zm.5 1.2 5.1 3.4a.8.8 0 0 0 .9 0L13.5 4.7V4.5h-10.5v.2Zm10.5 1.5-4.6 3a2.2 2.2 0 0 1-2.4 0l-4.6-3V11.5h11.6V6.2Z"
      />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1.5c-2.7 0-5 1.5-5 3.3 0 .7.6 1.2 1.3 1.2h7.4c.7 0 1.3-.5 1.3-1.2 0-1.8-2.3-3.3-5-3.3Z"
      />
    </svg>
  );
}

function DocsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4.5 1.5h5.2L13.5 5.3V13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3.5 13V3A1.5 1.5 0 0 1 4.5 1.5Zm4.8 1.2v2.8h2.8L9.3 2.7ZM5 6.5h6v1.2H5V6.5Zm0 2.5h6v1.2H5V9Zm0 2.5h4v1.2H5V11.5Z"
      />
    </svg>
  );
}

/**
 * React card mounted in `cellMenu.renderPanel` — matches the product mock:
 * avatar + name + status, large cell value, then icon links.
 */
export function CellMenuCustomPanel({
  row,
  rowId,
  field,
  value,
  close,
}: CellMenuPanelRenderContext) {
  const name = typeof row.name === "string" ? row.name : "—";
  const status = typeof row.status === "string" ? row.status : "—";
  const email = typeof row.email === "string" ? row.email : "";
  const avatar = typeof row.avatar === "string" ? row.avatar : "";
  const profileHref = `#/demo/people/${encodeURIComponent(rowId)}`;
  const valueText = value === null || value === undefined || value === "" ? "—" : String(value);
  const initials = initialsFromName(name === "—" ? rowId : name);

  return (
    <div className="cell-menu-custom-panel">
      <p className="cell-menu-custom-panel-kicker">
        Cell links <span aria-hidden="true">·</span> {field}
      </p>

      <div className="cell-menu-custom-card">
        <div className="cell-menu-custom-card-header">
          <div className="cell-menu-custom-identity">
            {avatar ? (
              <img
                className="cell-menu-custom-avatar"
                src={avatar}
                alt=""
                width={28}
                height={28}
              />
            ) : (
              <span className="cell-menu-custom-avatar cell-menu-custom-avatar-fallback">
                {initials}
              </span>
            )}
            <span className="cell-menu-custom-name">{name}</span>
          </div>
          <span
            className={`cell-menu-custom-chip cell-menu-custom-chip-${statusTone(status)}`}
          >
            {status}
          </span>
        </div>

        <p className="cell-menu-custom-value" title={valueText}>
          {valueText}
        </p>

        <div className="cell-menu-custom-divider" role="separator" />

        <ul className="cell-menu-custom-links">
          {email.includes("@") ? (
            <li>
              <a href={`mailto:${email}`}>
                <span className="cell-menu-custom-link-icon">
                  <MailIcon />
                </span>
                <span>Email {name}</span>
              </a>
            </li>
          ) : null}
          <li>
            <a
              href={profileHref}
              onClick={(event) => {
                event.preventDefault();
                close();
              }}
            >
              <span className="cell-menu-custom-link-icon">
                <UserIcon />
              </span>
              <span>Open profile</span>
            </a>
          </li>
          <li>
            <a
              href="https://lightfastgrid.com"
              target="_blank"
              rel="noreferrer"
            >
              <span className="cell-menu-custom-link-icon">
                <DocsIcon />
              </span>
              <span>Grid docs</span>
              <span className="cell-menu-custom-external" aria-hidden="true">
                ↗
              </span>
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
