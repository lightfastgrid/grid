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
 * Lightweight View / Edit dialog for the row-actions transaction demo.
 * Returns a dispose function that removes the dialog from the document.
 */
export function openRowRecordDialog(props: RowRecordDialogProps): () => void {
  const { mode, record, onClose, onSave } = props;
  const readOnly = mode === "view";
  const fields: GridDemoRowEditFields = {
    name: record.name,
    email: record.email,
    status: record.status,
    country: record.country,
  };

  const backdrop = el("div", "row-record-dialog-backdrop");
  backdrop.setAttribute("role", "presentation");

  const dialog = el("div", "row-record-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const titleId = `row-record-dialog-title-${record.rowId}`;
  dialog.setAttribute("aria-labelledby", titleId);

  const header = el("header", "row-record-dialog-header");
  const titles = el("div");
  const title = el("h2", undefined, readOnly ? "View row" : "Edit row");
  title.id = titleId;
  titles.append(title, el("p", "row-record-dialog-sub", record.rowId));
  const closeBtn = el("button", "row-record-dialog-icon-btn", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  header.append(titles, closeBtn);
  dialog.append(header);

  const form = el("form", "row-record-dialog-form");

  const nameLabel = el("label", "row-record-dialog-field");
  nameLabel.append(el("span", undefined, "Customer"));
  const nameInput = el("input");
  nameInput.value = fields.name;
  nameInput.readOnly = readOnly;
  nameInput.required = !readOnly;
  nameLabel.append(nameInput);
  form.append(nameLabel);

  const emailLabel = el("label", "row-record-dialog-field");
  emailLabel.append(el("span", undefined, "Email"));
  const emailInput = el("input");
  emailInput.type = "email";
  emailInput.value = fields.email;
  emailInput.readOnly = readOnly;
  emailInput.required = !readOnly;
  emailLabel.append(emailInput);
  form.append(emailLabel);

  const statusLabel = el("label", "row-record-dialog-field");
  statusLabel.append(el("span", undefined, "Status"));
  const statusSelect = el("select");
  statusSelect.disabled = readOnly;
  for (const status of GRID_DEMO_EDIT_STATUSES) {
    const option = el("option", undefined, status);
    option.value = status;
    if (status === fields.status) option.selected = true;
    statusSelect.append(option);
  }
  statusLabel.append(statusSelect);
  form.append(statusLabel);

  const countryLabel = el("label", "row-record-dialog-field");
  countryLabel.append(el("span", undefined, "Country"));
  const countrySelect = el("select");
  countrySelect.disabled = readOnly;
  for (const country of GRID_DEMO_EDIT_COUNTRIES) {
    const option = el("option", undefined, country);
    option.value = country;
    if (country === fields.country) option.selected = true;
    countrySelect.append(option);
  }
  countryLabel.append(countrySelect);
  form.append(countryLabel);

  const footer = el("footer", "row-record-dialog-footer");
  const cancelBtn = el("button", undefined, readOnly ? "Close" : "Cancel");
  cancelBtn.type = "button";
  footer.append(cancelBtn);
  if (!readOnly) {
    const saveBtn = el("button", "row-record-dialog-primary", "Save");
    saveBtn.type = "submit";
    footer.append(saveBtn);
  }
  form.append(footer);
  dialog.append(form);
  backdrop.append(dialog);
  document.body.append(backdrop);

  const dispose = () => {
    window.removeEventListener("keydown", onKeyDown);
    backdrop.removeEventListener("mousedown", onBackdropMouseDown);
    closeBtn.removeEventListener("click", onCloseClick);
    cancelBtn.removeEventListener("click", onCloseClick);
    form.removeEventListener("submit", onSubmit);
    backdrop.remove();
  };

  const close = () => {
    dispose();
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  const onBackdropMouseDown = (event: MouseEvent) => {
    if (event.target === backdrop) close();
  };
  const onCloseClick = () => close();
  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (readOnly) {
      close();
      return;
    }
    onSave?.({
      name: nameInput.value,
      email: emailInput.value,
      status: statusSelect.value,
      country: countrySelect.value,
    });
    close();
  };

  window.addEventListener("keydown", onKeyDown);
  backdrop.addEventListener("mousedown", onBackdropMouseDown);
  closeBtn.addEventListener("click", onCloseClick);
  cancelBtn.addEventListener("click", onCloseClick);
  form.addEventListener("submit", onSubmit);

  return dispose;
}
