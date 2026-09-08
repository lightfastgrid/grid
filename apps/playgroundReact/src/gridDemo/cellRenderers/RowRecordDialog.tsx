import { useEffect, useId, useState } from "react";

import {
  GRID_DEMO_EDIT_COUNTRIES,
  GRID_DEMO_EDIT_STATUSES,
  type GridDemoRowEditFields,
  type GridDemoRowRecord,
} from "./rowActionTransactions.ts";

import "./RowRecordDialog.css";

export type RowRecordDialogMode = "view" | "edit";

export type RowRecordDialogProps = {
  mode: RowRecordDialogMode;
  record: GridDemoRowRecord;
  onClose: () => void;
  onSave?: (fields: GridDemoRowEditFields) => void;
};

/**
 * Lightweight View / Edit dialog for the row-actions transaction demo.
 * Edit Save is expected to call `applyTransaction({ update })`.
 * Remount via `key` when opening a different row/mode so fields reset.
 */
export function RowRecordDialog({
  mode,
  record,
  onClose,
  onSave,
}: RowRecordDialogProps) {
  const titleId = useId();
  const readOnly = mode === "view";
  const [fields, setFields] = useState<GridDemoRowEditFields>(() => ({
    name: record.name,
    email: record.email,
    status: record.status,
    country: record.country,
  }));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const title = readOnly ? "View row" : "Edit row";

  return (
    <div
      className="row-record-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="row-record-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="row-record-dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p className="row-record-dialog-sub">{record.rowId}</p>
          </div>
          <button
            type="button"
            className="row-record-dialog-icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form
          className="row-record-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (readOnly) {
              onClose();
              return;
            }
            onSave?.(fields);
          }}
        >
          <label className="row-record-dialog-field">
            <span>Customer</span>
            <input
              value={fields.name}
              readOnly={readOnly}
              required={!readOnly}
              onChange={(event) =>
                setFields((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </label>

          <label className="row-record-dialog-field">
            <span>Email</span>
            <input
              type="email"
              value={fields.email}
              readOnly={readOnly}
              required={!readOnly}
              onChange={(event) =>
                setFields((prev) => ({ ...prev, email: event.target.value }))
              }
            />
          </label>

          <label className="row-record-dialog-field">
            <span>Status</span>
            <select
              value={fields.status}
              disabled={readOnly}
              onChange={(event) =>
                setFields((prev) => ({ ...prev, status: event.target.value }))
              }
            >
              {GRID_DEMO_EDIT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label className="row-record-dialog-field">
            <span>Country</span>
            <select
              value={fields.country}
              disabled={readOnly}
              onChange={(event) =>
                setFields((prev) => ({ ...prev, country: event.target.value }))
              }
            >
              {GRID_DEMO_EDIT_COUNTRIES.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
          </label>

          <footer className="row-record-dialog-footer">
            <button type="button" onClick={onClose}>
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly ? (
              <button type="submit" className="row-record-dialog-primary">
                Save
              </button>
            ) : null}
          </footer>
        </form>
      </div>
    </div>
  );
}
