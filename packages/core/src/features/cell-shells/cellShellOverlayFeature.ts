import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type {
  CellShellOverlayRenderer,
  ColumnDef,
  RowData,
} from "../../types";
import type { DomGridFeature } from "../types";

import { CellShellOverlayController } from "./CellShellOverlayController";

export interface CellShellOverlayFeatureOptions {
  getColumns: () => ColumnDef[];
  getDisplayRows: () => DisplayRowReader;
  resolveRowId: (row: RowData, index: number) => string;
  getCellShellOverlays: () => Record<string, CellShellOverlayRenderer> | undefined;
}

/** DomGridFeature adapter that wires CellShellOverlayController to the grid lifecycle. */
export function cellShellOverlayFeature(
  options: CellShellOverlayFeatureOptions,
): DomGridFeature {
  let controller: CellShellOverlayController | null = null;

  return {
    name: "cell-shell-overlays",

    attach(ctx) {
      controller = new CellShellOverlayController({
        getColumns: options.getColumns,
        getDisplayRows: options.getDisplayRows,
        resolveRowId: options.resolveRowId,
        getCellShellOverlays: options.getCellShellOverlays,
      });
      controller.attach(ctx.root, ctx.viewport);
    },

    detach() {
      controller?.detach();
      controller = null;
    },
  };
}
