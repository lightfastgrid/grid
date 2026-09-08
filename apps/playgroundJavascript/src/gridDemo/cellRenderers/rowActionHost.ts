import type { Grid } from "@lightfastgrid/core";

import type { GridDemoRowDialogState } from "./handleGridDemoRowAction.ts";

export type GridDemoRowActionHost = {
  getGrid: () => Grid | null;
  openDialog: (state: GridDemoRowDialogState) => void;
};

let host: GridDemoRowActionHost | null = null;

export function setGridDemoRowActionHost(
  next: GridDemoRowActionHost | null,
): void {
  host = next;
}

export function getGridDemoRowActionHost(): GridDemoRowActionHost | null {
  return host;
}
