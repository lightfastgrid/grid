import { createDemoRow } from "../../../../createDemoRow.ts";
import type { DemoGridGetter } from "../../../runtime/types.ts";

/** Runtime: `applyTransaction({ add })` only. */
export function addDemoRows(getGrid: DemoGridGetter, count: number): void {
  const grid = getGrid();
  if (!grid || count <= 0) return;
  const seed = Date.now();
  const rows = Array.from({ length: count }, (_, index) =>
    createDemoRow(seed + index),
  );
  grid.applyTransaction({ add: rows, addIndex: 0 });
}
