import type { DomGridFeatureContext } from "../../internal/layoutTypes";
import type { LightFastGridRowOrderChangedEvent, RowData } from "../../types";

import { RowOrderController } from "./RowOrderController";
import { RowOrderStore } from "./RowOrderStore";
import type {
  RowOrderFeature,
  RowOrderFeatureOptions,
  RowOrderMoveRequest,
} from "./types";

export function rowOrderFeature(options: RowOrderFeatureOptions): RowOrderFeature {
  const store = new RowOrderStore();
  let controller: RowOrderController | null = null;

  function handleRowOrderChanged(e: RowOrderMoveRequest): void {
    const cfg = options.getRowDragConfig();

    if (cfg.managed !== false && options.commitRowOrder) {
      if (options.isReorderBlocked?.()) {
        console.warn(
          "[LightFastGrid] Managed row reorder blocked: sort is " +
            "active. Disable sort before reordering rows, or set " +
            "rowDrag.managed=false to handle reorder yourself.",
        );
        store.clear();
        return;
      }
      options.commitRowOrder(e.rowId, e.rowIds, e.insertionIndex, e.source);
      store.clear();
      return;
    }

    // Unmanaged: build a lightweight proposed event with lazy getters.
    const allRows = options.getRows();
    const rowMap = new Map<string, RowData>();
    allRows.forEach((r, i) => rowMap.set(options.resolveRowId(r, i), r));

    const ptrRow = rowMap.get(e.rowId);
    if (!ptrRow) return;
    const movingRows = e.rowIds.map((id) => rowMap.get(id)).filter(Boolean) as RowData[];

    const storeOrder = store.getOrder();
    const finalToIndex = storeOrder.indexOf(e.rowIds[0]!);

    const event: LightFastGridRowOrderChangedEvent = {
      rowId: e.rowId,
      rowIds: e.rowIds,
      row: ptrRow,
      rows: movingRows,
      fromIndex: e.fromIndex,
      fromIndices: e.fromIndices,
      toIndex: finalToIndex >= 0 ? finalToIndex : e.insertionIndex,
      source: e.source,
      getRowOrderIds: () => {
        const order = store.getOrder();
        if (order.length > 0) return order;
        const currentRows = options.getRows();
        return currentRows.map((r, i) => options.resolveRowId(r, i));
      },
      getRows: () => {
        const currentRows = options.getRows();
        return store.applyOrder(currentRows, (r, i) => options.resolveRowId(r, i)).slice();
      },
    };

    options.onRowOrderChanged?.(event);
  }

  return {
    name: "row-order",
    rowOrderStore: store,

    attach(ctx: DomGridFeatureContext): void {
      controller?.detach();
      controller = new RowOrderController({
        getRowDragConfig: options.getRowDragConfig,
        isReorderBlocked: options.isReorderBlocked,
        getDisplayRows: () => ctx.getDisplayRows(),
        getPool: () => ctx.getPool(),
        resolveRowId: (row, index) => ctx.resolveRowId(row, index),
        getSelectedRowCountForRowOrder: () => ctx.getSelectedRowCountForRowOrder(),
        isRowSelectedForRowOrder: (rowId) => ctx.isRowSelectedForRowOrder(rowId),
        getSelectedRowIdsForRowOrder: () => ctx.getSelectedRowIdsForRowOrder(),
        getViewport: () => ctx.viewport,
        requestSync: () => ctx.requestSync(),
        onRowOrderChanged: handleRowOrderChanged,
        store,
      });
      controller.attach(ctx.root);
    },

    syncRowDragConfig(): void {
      controller?.syncConfig();
    },

    moveRowFromCommand(displayRowIndex, adjacentDisplayRowIndex): boolean {
      return controller?.moveRowFromCommand(
        displayRowIndex,
        adjacentDisplayRowIndex,
      ) ?? false;
    },

    detach(): void {
      controller?.detach();
      controller = null;
    },
  };
}
