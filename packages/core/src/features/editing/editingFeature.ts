import type {
  DomGridFeature,
  DomGridFeatureContext,
  EditingCapability,
} from "../types";

import { EditingController } from "./EditingController";
import type { EditCommitChange } from "./editingTypes";

export interface EditingFeatureOptions {
  getFocusedCell(): { rowIndex: number; field: string } | null;
  setFocusedCell(target: { rowIndex: number; field: string }, source: string): void;
  commitCellEdit(change: EditCommitChange): void;
}

export type EditingFeature = DomGridFeature & EditingCapability;

export function editingFeature(options: EditingFeatureOptions): EditingFeature {
  let controller: EditingController | null = null;

  return {
    name: "editing",

    attach(ctx: DomGridFeatureContext): void {
      controller = new EditingController({
        getColumns: () => ctx.getColumns(),
        getDisplayRows: () => ctx.getDisplayRows(),
        resolveRowId: (row, index) => ctx.resolveRowId(row, index),
        getFocusedCell: () => options.getFocusedCell(),
        setFocusedCell: (target, source) => options.setFocusedCell(target, source),
        findCellElement: (rowId, field) => {
          const cellSelector = `.lfg-cell[data-col-id="${escapeAttr(field)}"]`;
          const pool = ctx.getPool();
          for (const poolRow of pool) {
            if (poolRow.rowId !== rowId) continue;
            for (const lane of [
              poolRow.element,
              poolRow.pinnedElement,
              poolRow.rightPinnedElement,
            ]) {
              if (!lane) continue;
              const el = lane.querySelector<HTMLElement>(cellSelector);
              if (el) return el;
            }
          }
          let found: HTMLElement | null = null;
          ctx.forEachRowPinnedLanePoolRow?.((poolRow) => {
            if (found || poolRow.rowId !== rowId) return;
            for (const lane of [
              poolRow.element,
              poolRow.pinnedElement,
              poolRow.rightPinnedElement,
            ]) {
              if (!lane) continue;
              const el = lane.querySelector<HTMLElement>(cellSelector);
              if (el) { found = el; return; }
            }
          });
          return found;
        },
        commitEdit: (change) => {
          options.commitCellEdit(change);
        },
        keyboardNavigation: false,
      });
      controller.attach(ctx.root, ctx.viewport);
    },

    detach(): void {
      controller?.destroy();
      controller = null;
    },

    getEditingCell() {
      return controller?.getEditingCell() ?? null;
    },

    isEditing() {
      return controller?.isEditing() ?? false;
    },

    startEdit(target) {
      return controller?.startEdit(target) ?? false;
    },

    startEditAtDisplayIndex(rowIndex, field, cellElement, charSeed) {
      return (
        controller?.startEditAtDisplayIndex(
          rowIndex,
          field,
          cellElement,
          charSeed,
        ) ?? false
      );
    },

    stopEdit(opts) {
      return controller?.stopEdit(opts) ?? true;
    },

    stopEditFromCommand(commit) {
      return controller?.stopEditFromCommand(commit) ?? true;
    },

    toggleBooleanCell(target) {
      return controller?.toggleBooleanCell(target) ?? false;
    },

    toggleBooleanCellAtDisplayIndex(rowIndex, field) {
      return controller?.toggleBooleanCellAtDisplayIndex(rowIndex, field) ?? false;
    },

    getBooleanCellKeyboardMode(target) {
      return controller?.getBooleanCellKeyboardMode(target) ?? null;
    },

    getBooleanCellKeyboardModeAtDisplayIndex(rowIndex, field) {
      return (
        controller?.getBooleanCellKeyboardModeAtDisplayIndex(rowIndex, field) ??
        null
      );
    },

    syncEditingState(): void {
      controller?.syncAfterRender();
    },
  };
}

function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
