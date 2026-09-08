import type { DomGridFeatureContext } from "../../internal/layoutTypes";

import { SortController } from "./SortController";
import type { SortFeature, SortFeatureOptions } from "./types";

export function sortFeature(options: SortFeatureOptions): SortFeature {
  let controller: SortController | null = null;

  return {
    name: "sort",

    attach(ctx: DomGridFeatureContext): void {
      controller?.detach();
      controller = new SortController({
        getColumns: options.getColumns,
        getColumnSelectionConfig: options.getColumnSelectionConfig,
        getSortModel: options.getSortModel,
        isSortPending: options.isSortPending,
        toggleColumnSort: options.toggleColumnSort,
        getHeaderRowEl: () => ctx.getHeaderRowEl(),
        getPinnedHeaderRowEl: () => ctx.getPinnedHeaderRowEl(),
        getPinnedRightHeaderRowEl: () => ctx.getPinnedRightHeaderRowEl(),
      });
      controller.attach(ctx.root);
    },

    syncSortState(): void {
      controller?.syncSortState();
    },

    toggleSortFromCommand(field: string, multi: boolean): boolean {
      return controller?.toggleSortFromCommand(field, multi) ?? false;
    },

    detach(): void {
      controller?.detach();
      controller = null;
    },
  };
}
