/**
 * gridDemo cell renderers (React / runtime only)
 * ---------------------------------------------------------------------------
 *
 * WHAT LIVES IN STATIC JSON (repo-root `schemas/lightfastgrid-customer-operations-1k.json` -> `columnDefs`)
 * ---------------------------------------------------------------------------
 * JSON-safe column wiring, e.g. `cellKind: "actions"`, `actionsKey: "rowActions"`
 * / `"customRowDropdown"`.
 * Regenerate: pnpm transform:grid-demo-dataset:smoke
 *
 * WHAT LIVES HERE
 * ---------------
 * `createGridDemoCellRenderers()` — registry for LightFastGrid.
 * - `rowActions` — built-in menu mode + transactions
 * - `customRowDropdown` — `mode: "custom"` React panel
 */

export { createCustomRowDropdownRenderer } from "./createCustomRowDropdownRenderer.tsx";
export { createGridDemoCellRenderers } from "./createGridDemoCellRenderers.ts";
export type { CustomRowDropdownProps } from "./CustomRowDropdown.tsx";
export { CustomRowDropdown } from "./CustomRowDropdown.tsx";
export type { GridDemoRowDialogState } from "./handleGridDemoRowAction.ts";
export {
  handleGridDemoRowAction,
  saveGridDemoRowEdit,
} from "./handleGridDemoRowAction.ts";
export type { GridDemoRowActionHost } from "./rowActionHost.ts";
export {
  getGridDemoRowActionHost,
  setGridDemoRowActionHost,
} from "./rowActionHost.ts";
export type {
  GridDemoRowActionDetail,
  GridDemoRowActionHandler,
} from "./rowActions.ts";
export {
  createGridDemoRowActionsRenderer,
  GRID_DEMO_ROW_ACTION_ITEMS,
  toGridDemoRowActionDetail,
} from "./rowActions.ts";
export type {
  GridDemoRowEditFields,
  GridDemoRowRecord,
} from "./rowActionTransactions.ts";
export {
  buildDuplicateRow,
  buildUpdatedRow,
  GRID_DEMO_EDIT_COUNTRIES,
  GRID_DEMO_EDIT_STATUSES,
  toGridDemoRowRecord,
} from "./rowActionTransactions.ts";
export type { RowRecordDialogMode, RowRecordDialogProps } from "./RowRecordDialog.tsx";
export { RowRecordDialog } from "./RowRecordDialog.tsx";
