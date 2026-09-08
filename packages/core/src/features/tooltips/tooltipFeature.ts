import type { Grid } from "../../Grid";
import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type { ColumnDef, RowData } from "../../types";
import type { DomGridFeature, TooltipCapability } from "../types";

import { TooltipController } from "./TooltipController";

export interface TooltipFeatureOptions {
  getColumns: () => ColumnDef[];
  getDisplayRows: () => DisplayRowReader;
  resolveRowId: (row: RowData, index: number) => string;
  /** May return `null` before the Grid instance has finished wiring. */
  getGridInstance: () => Grid | null;
}

export function tooltipFeature(
  options: TooltipFeatureOptions,
): DomGridFeature & TooltipCapability {
  let controller: TooltipController | null = null;

  return {
    name: "tooltip",

    attach(ctx) {
      controller = new TooltipController({
        gridRoot: ctx.root,
        viewport: ctx.viewport,
        getColumns: options.getColumns,
        getDisplayRows: options.getDisplayRows,
        resolveRowId: options.resolveRowId,
        getGridInstance: options.getGridInstance,
      });
      controller.attach(ctx.root);
    },

    requestTooltipForKeyboardTarget(target): void {
      controller?.requestTooltipForKeyboardTarget(target);
    },

    dismissKeyboardTooltip(): boolean {
      return controller?.dismissKeyboardTooltip() ?? false;
    },

    detach() {
      controller?.detach();
      controller = null;
    },
  };
}
