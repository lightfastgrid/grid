import { resolveRowControlColumns } from "../../internal/rowControlColumns";
import type { RowDragNormalizedConfig, RowSelectionConfig } from "../../types";
import type {
  ColumnTransformCapability,
  DomGridFeature,
  DomGridFeatureContext,
} from "../types";

export interface RowControlsFeatureOptions {
  getRowSelectionConfig: () => RowSelectionConfig;
  getRowDragConfig: () => RowDragNormalizedConfig;
}

export interface RowControlsFeature
  extends DomGridFeature,
    ColumnTransformCapability {}

/**
 * Sole column-transform owner for internal row-control columns.
 * Selection and row-order keep interaction ownership; they do not inject columns.
 */
export function rowControlsFeature(
  options: RowControlsFeatureOptions,
): RowControlsFeature {
  return {
    name: "row-controls",

    attach(_ctx: DomGridFeatureContext): void {
      // Column transform only; pointer and keyboard stay on selection / row-order.
    },

    detach(): void {},

    transformColumns(columns) {
      return resolveRowControlColumns(
        columns,
        options.getRowSelectionConfig(),
        options.getRowDragConfig(),
      );
    },
  };
}
