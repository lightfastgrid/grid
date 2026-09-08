import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type {
  CellRendererRegistry,
  ColumnDef,
  RowActionGridApi,
  RowData,
} from "../../types";
import type { DomGridFeature, RowActionCapability } from "../types";

import { RowActionController } from "./RowActionController";

export interface RowActionFeatureOptions {
  getColumns: () => ColumnDef[];
  getDisplayRows: () => DisplayRowReader;
  resolveRowId: (row: RowData, index: number) => string;
  getCellRenderers: () => CellRendererRegistry | undefined;
  getRowActionGridApi: () => RowActionGridApi;
}

export function rowActionFeature(
  options: RowActionFeatureOptions,
): DomGridFeature & RowActionCapability {
  let controller: RowActionController | null = null;

  return {
    name: "row-actions",

    attach(ctx) {
      controller = new RowActionController({
        gridRoot: ctx.root,
        viewport: ctx.viewport,
        getColumns: options.getColumns,
        getDisplayRows: options.getDisplayRows,
        resolveRowId: options.resolveRowId,
        getCellRenderers: options.getCellRenderers,
        getRowActionGridApi: options.getRowActionGridApi,
      });
      controller.attach(ctx.root);
    },

    requestOpenRowAction(displayRowIndex, field, trigger, invoker): boolean {
      return controller?.requestOpenAtDisplayIndex(
        displayRowIndex,
        field,
        trigger,
        invoker,
      ) ?? false;
    },

    closeRowActionFromCommand(): boolean {
      return controller?.closeFromCommand() ?? false;
    },

    isRowActionOpen(): boolean {
      return controller?.isOpen() ?? false;
    },

    detach() {
      controller?.detach();
      controller = null;
    },
  };
}
