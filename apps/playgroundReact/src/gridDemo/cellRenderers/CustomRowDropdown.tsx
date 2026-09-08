import type { RowData } from "@lightfastgrid/core";

import "./CustomRowDropdown.css";

export type CustomRowDropdownProps = {
  row: RowData;
  rowIndex: number;
  rowId: string;
  close: () => void;
  onView: () => void;
};

function statusTone(status: string): "active" | "pending" | "danger" | "neutral" {
  const key = status.toLowerCase();
  if (key === "active") return "active";
  if (key === "pending") return "pending";
  if (key === "suspended" || key === "inactive") return "danger";
  return "neutral";
}

/** Nested React component rendered inside the per-cell dropdown. */
function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`custom-row-dropdown-chip custom-row-dropdown-chip-${statusTone(status)}`}
    >
      {status}
    </span>
  );
}

type QuickLinksProps = {
  email: string;
  name: string;
  rowId: string;
  close: () => void;
};

/** Links + link-styled actions — proves arbitrary React content in the panel. */
function RowQuickLinks({
  email,
  name,
  rowId,
  close,
}: QuickLinksProps) {
  const profileHref = `#/demo/people/${encodeURIComponent(rowId)}`;
  const hasEmail = email.includes("@");

  return (
    <section className="custom-row-dropdown-links" aria-label="Row links">
      <p className="custom-row-dropdown-section-label">Links</p>
      <ul>
        <li>
          {hasEmail ? (
            <a href={`mailto:${email}`}>
              Email {name}
            </a>
          ) : (
            <span className="custom-row-dropdown-link-disabled">No email</span>
          )}
        </li>
        <li>
          <a
            href={profileHref}
            onClick={(event) => {
              event.preventDefault();
              close();
            }}
          >
            View profile
          </a>
        </li>
        <li>
          <a
            href="https://lightfastgrid.com"
            target="_blank"
            rel="noreferrer"
          >
            Grid docs ↗
          </a>
        </li>
      </ul>
    </section>
  );
}

/**
 * Demo panel for `cellRenderers` custom mode.
 *
 * Shows that each row’s ▣ trigger can open a React panel with nested
 * components (status chip) and real links — mounted only when opened.
 */
export function CustomRowDropdown({
  row,
  rowIndex,
  rowId,
  close,
  onView,
}: CustomRowDropdownProps) {
  const name = typeof row.name === "string" ? row.name : "—";
  const status = typeof row.status === "string" ? row.status : "—";
  const email = typeof row.email === "string" ? row.email : "—";
  const country = typeof row.country === "string" ? row.country : "—";

  return (
    <div className="custom-row-dropdown">
      <header className="custom-row-dropdown-header">
        <div>
          <p className="custom-row-dropdown-kicker">Per-cell dropdown</p>
          <h3>{name}</h3>
          <div className="custom-row-dropdown-subtitle">
            <StatusChip status={status} />
            <span className="custom-row-dropdown-muted">{country}</span>
          </div>
        </div>
        <button
          type="button"
          className="custom-row-dropdown-icon-btn"
          aria-label="Close"
          onClick={close}
        >
          ×
        </button>
      </header>

      <RowQuickLinks
        email={email}
        name={name}
        rowId={rowId}
        close={close}
      />

      <dl className="custom-row-dropdown-meta">
        <div>
          <dt>Row id</dt>
          <dd>{rowId}</dd>
        </div>
        <div>
          <dt>Index</dt>
          <dd>{rowIndex}</dd>
        </div>
        <div className="custom-row-dropdown-meta-span">
          <dt>Email</dt>
          <dd>{email}</dd>
        </div>
      </dl>

      <footer className="custom-row-dropdown-footer">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(rowId);
          }}
        >
          Copy id
        </button>
        <button
          type="button"
          className="custom-row-dropdown-primary"
          onClick={() => {
            onView();
          }}
        >
          View row
        </button>
      </footer>
    </div>
  );
}
