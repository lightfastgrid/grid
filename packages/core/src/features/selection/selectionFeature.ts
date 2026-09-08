import { captureEmptyRowSelection } from "../../internal/readSnapshots";
import type { SelectionChange, SelectionChangeSource } from "../../types";
import type { DomGridFeatureContext } from "../types";

import { RowSelectionController } from "./RowSelectionController";
import type { SelectionFeature, SelectionFeatureOptions } from "./types";

export function selectionFeature(
  options: SelectionFeatureOptions,
): SelectionFeature {
  let controller: RowSelectionController | null = null;

  return {
    name: "selection",

    attach(context: DomGridFeatureContext): void {
      controller = new RowSelectionController({
        getPool: () => context.getPool(),
        getConfig: options.getConfig,
        getColumns: () => context.getColumns(),
        getDisplayRows: () => context.getDisplayRows(),
        getFullDisplayRows: () =>
          (context.getFullDisplayRows ?? context.getDisplayRows)(),
        getDataRevision: () => context.getDataRevision(),
        resolveRowId: (row, i) => context.resolveRowId(row, i),
        getHeaderRowEl: () => context.getHeaderRowEl(),
        getPinnedHeaderRowEl: () => context.getPinnedHeaderRowEl(),
        onSelectionChanged: options.onSelectionChanged,
      });
      controller.attach(context.root);
    },

    detach(): void {
      controller?.detach();
      controller = null;
    },

    syncSelectionMode(): void {
      controller?.syncMode();
    },

    isRowSelected(rowId: string): boolean {
      return controller?.isSelected(rowId) ?? false;
    },

    getSelectedIds(): string[] {
      return controller?.getSelectedIds() ?? [];
    },

    getSelectedCount(totalRows: number): number {
      return controller?.getSelectedCount(totalRows) ?? 0;
    },

    captureSelectionSnapshot(universeRowCount) {
      return (
        controller?.captureSelectionSnapshot(universeRowCount) ??
        captureEmptyRowSelection(universeRowCount)
      );
    },

    clearSelection(opts?: {
      silent?: boolean;
      source?: SelectionChangeSource;
    }): SelectionChange | null {
      return controller?.clear(opts) ?? null;
    },

    setSelectedIds(
      ids: string[],
      opts?: { silent?: boolean; source?: SelectionChangeSource },
    ): SelectionChange | null {
      return controller?.setSelectedIds(ids, opts) ?? null;
    },

    toggleRowSelectionAtDisplayIndex(rowIndex, source): boolean {
      return (
        controller?.toggleRowSelectionAtDisplayIndex(rowIndex, source) ?? false
      );
    },

    selectRowAtDisplayIndex(rowIndex, source): boolean {
      return controller?.selectRowAtDisplayIndex(rowIndex, source) ?? false;
    },

    extendRowSelectionStep(previousRowIndex, nextRowIndex, source): boolean {
      return (
        controller?.extendRowSelectionStep(
          previousRowIndex,
          nextRowIndex,
          source,
        ) ?? false
      );
    },

    toggleAllRowSelection(source): boolean {
      return controller?.toggleAllRowSelection(source) ?? false;
    },

    refreshHeaderSelectionState(): void {
      controller?.refreshHeaderSelectionState();
    },
  };
}
