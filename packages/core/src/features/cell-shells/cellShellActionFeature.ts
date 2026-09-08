import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type {
  ColumnDef,
  LightFastGridCellShellActionEvent,
  RowData,
} from "../../types";
import type { DomGridFeature } from "../types";

import { CellShellActionController } from "./CellShellActionController";

export interface CellShellActionFeatureOptions {
  getColumns: () => ColumnDef[];
  getDisplayRows: () => DisplayRowReader;
  resolveRowId: (row: RowData, index: number) => string;
  onCellShellAction?: (e: LightFastGridCellShellActionEvent) => void;
}

export function cellShellActionFeature(
  options: CellShellActionFeatureOptions,
): DomGridFeature {
  let controller: CellShellActionController | null = null;

  return {
    name: "cell-shell-actions",

    attach(ctx) {
      const handler = options.onCellShellAction;
      // No handler wired → don't attach a listener at all.
      if (!handler) return;
      controller = new CellShellActionController({
        getColumns: options.getColumns,
        getDisplayRows: options.getDisplayRows,
        resolveRowId: options.resolveRowId,
        onCellShellAction: handler,
      });
      controller.attach(ctx.root);
    },

    detach() {
      controller?.detach();
      controller = null;
    },
  };
}
