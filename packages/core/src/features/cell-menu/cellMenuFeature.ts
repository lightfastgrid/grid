import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type {
  CellMenuGridApi,
  CellMenuOptions,
  ColumnDef,
  RowData,
} from "../../types";
import type { CellMenuCapability, DomGridFeature } from "../types";

import { CellMenuController } from "./CellMenuController";

export interface CellMenuFeatureOptions {
  getColumns: () => ColumnDef[];
  getDisplayRows: () => DisplayRowReader;
  resolveRowId: (row: RowData, index: number) => string;
  getCellMenuOptions: () => CellMenuOptions | undefined;
  getCellMenuGridApi: () => CellMenuGridApi;
}

export function cellMenuFeature(
  options: CellMenuFeatureOptions,
): DomGridFeature & CellMenuCapability {
  let controller: CellMenuController | null = null;

  return {
    name: "cell-menu",

    attach(ctx) {
      controller = new CellMenuController({
        gridRoot: ctx.root,
        viewport: ctx.viewport,
        getColumns: options.getColumns,
        getDisplayRows: options.getDisplayRows,
        resolveRowId: options.resolveRowId,
        getCellMenuOptions: options.getCellMenuOptions,
        getCellMenuGridApi: options.getCellMenuGridApi,
      });
      controller.attach(ctx.root);
    },

    requestOpenCellMenu(displayRowIndex, field, cell, invoker): boolean {
      return controller?.requestOpenAtDisplayIndex(
        displayRowIndex,
        field,
        cell,
        invoker,
      ) ?? false;
    },

    resolveVisibleCellMenuTrigger(displayRowIndex, field, cell) {
      return controller?.resolveVisibleTrigger(
        displayRowIndex,
        field,
        cell,
      ) ?? null;
    },

    closeCellMenuFromCommand(): boolean {
      return controller?.closeFromCommand() ?? false;
    },

    isCellMenuOpen(): boolean {
      return controller?.isOpen() ?? false;
    },

    detach() {
      controller?.detach();
      controller = null;
    },
  };
}
