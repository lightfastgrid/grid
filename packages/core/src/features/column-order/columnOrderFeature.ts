import type { DomGridFeatureContext } from "../../internal/layoutTypes";
import type { ColumnDef } from "../../types";

import { ColumnOrderController } from "./ColumnOrderController";
import { ColumnOrderStore } from "./ColumnOrderStore";
import type { ColumnOrderFeature, ColumnOrderFeatureOptions } from "./types";

export function columnOrderFeature(
  options: ColumnOrderFeatureOptions,
): ColumnOrderFeature {
  const store = new ColumnOrderStore();
  let controller: ColumnOrderController | null = null;

  return {
    name: "column-order",
    columnOrderStore: store,

    attach(ctx: DomGridFeatureContext): void {
      controller?.detach();
      controller = new ColumnOrderController({
        getColumnOrderConfig: options.getColumnOrderConfig,
        getColumns: () => ctx.getColumns(),
        getHeaderRowEl: () => ctx.getHeaderRowEl(),
        getViewport: () => ctx.viewport,
        getSelectedColumnIdsForColumnOrder: () =>
          ctx.getSelectedColumnIdsForColumnOrder(),
        requestColumnTransformSync: () => ctx.requestColumnTransformSync(),
        onColumnOrderChanged: options.onColumnOrderChanged,
        store,
      });
      controller.attach(ctx.root);
      controller.syncCommandColumns(ctx.getColumns());
    },

    syncColumnOrderConfig(): void {
      controller?.syncConfig();
    },

    detach(): void {
      controller?.detach();
      controller = null;
    },

    transformColumns(columns: ColumnDef[]): ColumnDef[] {
      const cfg = options.getColumnOrderConfig();
      if (!cfg.enabled) {
        return columns;
      }
      store.syncColumns(columns, { preserveMissing: true });
      const transformed = store.applyOrder(columns, { preserveMissing: true });
      controller?.syncCommandColumns(transformed);
      return transformed;
    },

    moveColumnFromCommand(field, visualDelta): boolean {
      return controller?.moveColumnFromCommand(field, visualDelta) ?? false;
    },
  };
}
