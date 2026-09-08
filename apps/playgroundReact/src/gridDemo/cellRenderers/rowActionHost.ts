import type { ReactLightFastGridHandle } from "@lightfastgrid/react";

import type { GridDemoRowDialogState } from "./handleGridDemoRowAction.ts";

/** Latest grid + dialog accessors for row-action clicks. */
export type GridDemoRowActionHost = {
  getGrid: () => ReactLightFastGridHandle | null;
  openDialog: (state: GridDemoRowDialogState) => void;
};

let rowActionHost: GridDemoRowActionHost | null = null;

/** Called from GridDemo mount/unmount — keeps click handlers free of render-time refs. */
export function setGridDemoRowActionHost(
  host: GridDemoRowActionHost | null,
): void {
  rowActionHost = host;
}

export function getGridDemoRowActionHost(): GridDemoRowActionHost | null {
  return rowActionHost;
}
