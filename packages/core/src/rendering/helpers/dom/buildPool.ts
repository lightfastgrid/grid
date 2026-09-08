// ─── dom/buildPool.ts — clone row templates into attached pool rows ───

import type { PooledCell, PooledRow } from "../../types/types";

/**
 * Clones the row template `poolSize` times and mounts all clones
 * into the scroll container in a SINGLE DOM operation.
 */
export function buildPool(
  template: HTMLDivElement,
  poolSize: number,
  columnSlotCount: number,
  scrollContainer: HTMLDivElement,
): PooledRow[] {
  const pool: PooledRow[] = [];

  const fragment = document.createDocumentFragment();

  for (let i = 0; i < poolSize; i++) {
    const rowEl = template.cloneNode(true) as HTMLDivElement;

    const cells: PooledCell[] = [];
    for (let c = 0; c < columnSlotCount; c++) {
      cells.push({
        element: rowEl.children[c] as HTMLDivElement,
        value: "",
      });
    }

    pool.push({
      element: rowEl,
      cells,
      rowIndex: -1,
      rowVersion: -1,
      rowId: null,
    });

    fragment.appendChild(rowEl);
  }

  scrollContainer.appendChild(fragment);

  return pool;
}
