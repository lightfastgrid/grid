import type {
  ColumnDef,
  HeaderActionGridApi,
  HeaderActionRendererRegistry,
} from "../../types";
import type { DomGridFeature } from "../types";

import { HeaderActionController } from "./HeaderActionController";

export interface HeaderActionFeatureOptions {
  getColumns: () => ColumnDef[];
  getHeaderRenderers: () => HeaderActionRendererRegistry | undefined;
  getSelectedColumnIds: () => string[];
  getHeaderActionGridApi: () => HeaderActionGridApi;
}

export function headerActionFeature(
  options: HeaderActionFeatureOptions,
): DomGridFeature {
  let controller: HeaderActionController | null = null;

  return {
    name: "header-actions",

    attach(ctx) {
      controller = new HeaderActionController({
        gridRoot: ctx.root,
        viewport: ctx.viewport,
        getColumns: options.getColumns,
        getHeaderRenderers: options.getHeaderRenderers,
        getSelectedColumnIds: options.getSelectedColumnIds,
        getHeaderActionGridApi: options.getHeaderActionGridApi,
      });
      controller.attach(ctx.root);
    },

    detach() {
      controller?.detach();
      controller = null;
    },
  };
}
