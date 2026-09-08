import type { ReactCellRendererRegistry } from "@lightfastgrid/react";

import { createCustomRowDropdownRenderer } from "./createCustomRowDropdownRenderer.tsx";
import { handleGridDemoRowAction } from "./handleGridDemoRowAction.ts";
import { getGridDemoRowActionHost } from "./rowActionHost.ts";
import { createGridDemoRowActionsRenderer } from "./rowActions.ts";

/**
 * Builds the full `cellRenderers` map for gridDemo.
 *
 * Keys must match `actionsKey` values in static JSON columnDefs
 * (`rowActions`, `customRowDropdown`).
 */
export function createGridDemoCellRenderers(): ReactCellRendererRegistry {
  return {
    rowActions: createGridDemoRowActionsRenderer({
      onAction: (detail) => {
        const host = getGridDemoRowActionHost();
        if (!host) return;
        handleGridDemoRowAction({
          detail,
          grid: host.getGrid(),
          openDialog: host.openDialog,
        });
      },
    }),
    customRowDropdown: createCustomRowDropdownRenderer(),
  };
}
