import type { Grid } from "@lightfastgrid/core";

import type { GridDemoRowActionDetail } from "./rowActions.ts";
import {
  buildDuplicateRow,
  buildUpdatedRow,
  type GridDemoRowEditFields,
  type GridDemoRowRecord,
  toGridDemoRowRecord,
} from "./rowActionTransactions.ts";
import type { RowRecordDialogMode } from "./rowRecordDialog.ts";

export type GridDemoRowDialogState = {
  mode: RowRecordDialogMode;
  record: GridDemoRowRecord;
  row: GridDemoRowActionDetail["row"];
};

export type HandleGridDemoRowActionOptions = {
  detail: GridDemoRowActionDetail;
  grid: Grid | null;
  openDialog: (state: GridDemoRowDialogState) => void;
};

/** Apply duplicate / delete transactions, or open View / Edit dialogs. */
export function handleGridDemoRowAction(
  options: HandleGridDemoRowActionOptions,
): void {
  const { detail, grid, openDialog } = options;

  switch (detail.actionId) {
    case "view":
      openDialog({
        mode: "view",
        record: toGridDemoRowRecord(detail.row, detail.rowId),
        row: detail.row,
      });
      return;

    case "edit":
      openDialog({
        mode: "edit",
        record: toGridDemoRowRecord(detail.row, detail.rowId),
        row: detail.row,
      });
      return;

    case "duplicate": {
      if (!grid) return;
      grid.applyTransaction({
        add: [buildDuplicateRow(detail.row, detail.rowId)],
        addAfterId: detail.rowId,
      });
      return;
    }

    case "delete": {
      if (!grid) return;
      const customer =
        typeof detail.row.name === "string" ? detail.row.name : detail.rowId;
      const confirmed = window.confirm(`Delete row “${customer}”?`);
      if (!confirmed) return;
      grid.applyTransaction({
        removeIds: [detail.rowId],
      });
      return;
    }

    case "open-tab": {
      const url = new URL(window.location.href);
      url.hash = `row=${encodeURIComponent(detail.rowId)}`;
      window.open(url.toString(), "_blank", "noopener,noreferrer");
      break;
    }
  }
}

/** Commit Edit dialog fields via `applyTransaction({ update })`. */
export function saveGridDemoRowEdit(options: {
  grid: Grid | null;
  row: GridDemoRowActionDetail["row"];
  fields: GridDemoRowEditFields;
}): void {
  const { grid, row, fields } = options;
  if (!grid) return;
  grid.applyTransaction({
    update: [buildUpdatedRow(row, fields)],
  });
}
