import type { DemoGridGetter } from "../../../runtime/types.ts";

/** Runtime: `setColumnVisible` for one field. */
export function setDemoColumnVisible(
  getGrid: DemoGridGetter,
  field: string,
  visible: boolean,
): void {
  getGrid()?.setColumnVisible(field, visible, "api");
}
