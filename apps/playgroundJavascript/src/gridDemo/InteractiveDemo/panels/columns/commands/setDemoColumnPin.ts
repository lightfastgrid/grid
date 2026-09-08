import type { DemoGridGetter } from "../../../runtime/types.ts";

import type { DemoColumnPin } from "./listDemoColumns.ts";

/** Runtime: `pinColumn` for one field. */
export function setDemoColumnPin(
  getGrid: DemoGridGetter,
  field: string,
  pinned: DemoColumnPin,
): void {
  getGrid()?.pinColumn(field, pinned, "api");
}
