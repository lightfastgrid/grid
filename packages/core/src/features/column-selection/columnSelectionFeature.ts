import { isInternalColumn } from "../../internal/internalColumns";
import { EMPTY_ID_MEMBERSHIP } from "../../internal/readSnapshots";
import { buildColumnPinningLayout } from "../column-pinning/columnPinningLayout";
import type {
  ColumnSelectionCapability,
  DomGridFeature,
} from "../types";

import { ColumnSelectionController } from "./ColumnSelectionController";
import type { ColumnSelectionFeatureOptions } from "./types";

export interface ColumnSelectionFeature
  extends DomGridFeature,
    ColumnSelectionCapability {}

export function columnSelectionFeature(
  options: ColumnSelectionFeatureOptions,
): ColumnSelectionFeature {
  let controller: ColumnSelectionController | null = null;

  return {
    name: "column-selection",

    attach(ctx) {
      controller = new ColumnSelectionController({
        getConfig: options.getColumnSelectionConfig,
        getHeaderRowEl: () => ctx.getHeaderRowEl(),
        getPinnedHeaderRowEl: () => ctx.getPinnedHeaderRowEl(),
        getPinnedRightHeaderRowEl: () => ctx.getPinnedRightHeaderRowEl(),
        getSelectableColumnIds: () => {
          const layout = buildColumnPinningLayout(ctx.getColumns());
          return layout.ordered
            .filter((c) => !isInternalColumn(c) && c.columnSelectable !== false)
            .map((c) => c.field);
        },
        onChanged: options.onColumnSelectionChanged,
        syncColumnSelectionClasses: () => ctx.syncColumnSelectionClasses?.(),
      });
      controller.attach(ctx.root);
    },

    detach() {
      controller?.detach();
      controller = null;
    },

    getSelectedColumnIds() {
      return controller?.getSelectedColumnIds() ?? [];
    },

    captureColumnSelectionSnapshot() {
      return controller?.captureColumnSelectionSnapshot() ?? EMPTY_ID_MEMBERSHIP;
    },

    setSelectedColumnIds(ids, opts) {
      return controller?.setSelectedColumnIds(ids, opts) ?? false;
    },

    clearColumnSelection(opts) {
      return controller?.clear(opts) ?? false;
    },

    isColumnSelected(field) {
      return controller?.isColumnSelected(field) ?? false;
    },

    toggleColumnSelection(field, source) {
      return controller?.toggleColumnSelection(field, source) ?? false;
    },

    syncColumnSelectionFromConfig() {
      controller?.syncDisabledFromConfig();
      controller?.pruneToSelectableColumnsSilent();
      controller?.syncInteractionListeners();
    },
  };
}
