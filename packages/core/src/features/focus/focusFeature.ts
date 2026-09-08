import type {
  FocusChangeSource,
  FocusMoveDirection,
  LightFastGridFocusedCellChangedEvent,
} from "../../types";
import type {
  DomGridFeature,
  DomGridFeatureContext,
  FocusCapability,
} from "../types";

import { FocusController } from "./FocusController";

export interface FocusFeatureOptions {
  onFocusedCellChanged?: (e: LightFastGridFocusedCellChangedEvent) => void;
}

export type FocusFeature = DomGridFeature & FocusCapability;

/**
 * Focused cell + keyboard navigation. Independent from row/column
 * selection — it only shares the grid root's delegated listeners and
 * the pooled-row DOM contract.
 */
export function focusFeature(options: FocusFeatureOptions): FocusFeature {
  let controller: FocusController | null = null;

  return {
    name: "focus",

    attach(context: DomGridFeatureContext): void {
      controller = new FocusController({
        getPool: () => context.getPool(),
        getColumns: () => context.getColumns(),
        getDisplayRows: () => context.getDisplayRows(),
        resolveRowId: (row, i) => context.resolveRowId(row, i),
        getViewport: () => context.viewport,
        layoutMetrics: context.layoutMetrics,
        ensureFieldVisible: context.ensureFieldVisible
          ? (field) => context.ensureFieldVisible!(field)
          : undefined,
        getVisualRowLayout: context.getVisualRowLayout
          ? () => context.getVisualRowLayout!()
          : undefined,
        forEachRowPinnedLanePoolRow: context.forEachRowPinnedLanePoolRow
          ? (cb) => context.forEachRowPinnedLanePoolRow!(cb)
          : undefined,
        onFocusedCellChanged: options.onFocusedCellChanged,
      });
      controller.attach(context.root);
    },

    detach(): void {
      controller?.detach();
      controller = null;
    },

    getFocusedCell() {
      return controller?.getFocusedCell() ?? null;
    },

    setFocusedCell(
      target: { rowId?: string; rowIndex?: number; field: string },
      source?: FocusChangeSource,
    ): void {
      controller?.setFocusedCell(target, source);
    },

    clearFocusedCell(source?: FocusChangeSource): void {
      controller?.clearFocusedCell(source);
    },

    moveFocusedCell(
      direction: FocusMoveDirection,
      source?: FocusChangeSource,
    ): boolean {
      return controller?.moveFocusedCell(direction, source) ?? false;
    },

    setFocusedCellAtDisplayIndex(
      rowIndex: number,
      field: string,
      source?: FocusChangeSource,
    ): boolean {
      return (
        controller?.setFocusedCellAtDisplayIndex(rowIndex, field, source) ??
        false
      );
    },

    syncFocusState(): void {
      controller?.syncAfterRender();
    },
  };
}
