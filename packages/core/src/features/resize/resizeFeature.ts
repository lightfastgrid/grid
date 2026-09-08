import type { ColumnWidthOverride } from "../../internal/layoutTypes";
import type { ColumnDef } from "../../types";
import type {
  ColumnTransformCapability,
  DomGridFeature,
  DomGridFeatureContext,
  ResizeCapability,
} from "../types";

import { ColumnResizeController } from "./ColumnResizeController";

export interface ResizeFeature
  extends DomGridFeature,
    ResizeCapability,
    ColumnTransformCapability {}

export function resizeFeature(options: {
  commitResize: (field: string, width: number) => void;
}): ResizeFeature {
  let context: DomGridFeatureContext | null = null;
  let controller: ColumnResizeController | null = null;

  return {
    name: "resize",

    attach(ctx: DomGridFeatureContext): void {
      context = ctx;
      if (!controller) {
        controller = new ColumnResizeController({
          getColumns: () => context!.getColumns(),
          getDisplayRows: () => context!.getDisplayRows(),
          getVisibleRowStart: () => context!.getVisibleRowStart(),
          getPoolSize: () => context!.getPool().length,
          requestSync: () => context!.requestSync(),
          commitResize: options.commitResize,
        });
      }
      controller.attach(ctx.root);
      controller.syncCommandColumns(ctx.getColumns());
    },

    detach(): void {
      controller?.detach();
      controller = null;
      context = null;
    },

    getResizeOverride(): ColumnWidthOverride | null {
      return controller?.getLiveOverride() ?? null;
    },

    resizeColumnFromCommand(field, deltaPx): boolean {
      return controller?.resizeColumnFromCommand(field, deltaPx) ?? false;
    },

    transformColumns(columns: ColumnDef[]): ColumnDef[] {
      controller?.syncCommandColumns(columns);
      return columns;
    },

    isLayoutOnly(key: string): boolean {
      return controller?.isLayoutOnly(key) ?? false;
    },

    updateLayoutKey(key: string): void {
      controller?.updateLayoutKey(key);
    },

    resetLayoutKey(): void {
      controller?.resetLayoutKey();
    },
  };
}
