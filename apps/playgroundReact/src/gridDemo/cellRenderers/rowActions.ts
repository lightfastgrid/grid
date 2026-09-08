import type {
  ActionMenuCellRenderer,
  RowActionClickContext,
  RowActionItem,
} from "@lightfastgrid/core";

/**
 * Focused row-action menu for the grid demo.
 * Keeps the high-signal actions from a typical product menu (view / edit /
 * duplicate / open / delete) — enough to demo the API without noise.
 */
export const GRID_DEMO_ROW_ACTION_ITEMS: RowActionItem[] = [
  { id: "view", label: "View" },
  { id: "edit", label: "Edit" },
  { id: "duplicate", label: "Duplicate" },
  { id: "open-tab", label: "Open in a new tab" },
  { id: "delete", label: "Delete", className: "danger-item" },
];

/** Normalized detail for the clicked row-action item. */
export type GridDemoRowActionDetail = {
  actionId: string;
  label: string;
  icon?: string;
  className?: string;
  rowId: string;
  rowIndex: number;
  /** Action column field (usually `"actions"`). */
  field: string;
  row: RowActionClickContext["row"];
};

export type GridDemoRowActionHandler = (
  detail: GridDemoRowActionDetail,
) => void;

/** Build the click detail object from the grid's action context. */
export function toGridDemoRowActionDetail(
  ctx: RowActionClickContext,
): GridDemoRowActionDetail {
  return {
    actionId: ctx.actionId,
    label: ctx.action.label,
    icon: ctx.action.icon,
    className: ctx.action.className,
    rowId: ctx.rowId,
    rowIndex: ctx.rowIndex,
    field: ctx.column.field,
    row: ctx.row,
  };
}

export type CreateGridDemoRowActionsOptions = {
  onAction?: GridDemoRowActionHandler;
};

/** Built-in menu-mode renderer registered under `rowActions`. */
export function createGridDemoRowActionsRenderer(
  options: CreateGridDemoRowActionsOptions = {},
): ActionMenuCellRenderer {
  const { onAction } = options;

  return {
    kind: "actions",
    getActions: () => GRID_DEMO_ROW_ACTION_ITEMS,
    onAction: (ctx) => {
      const detail = toGridDemoRowActionDetail(ctx);
      onAction?.(detail);
      ctx.close();
    },
  };
}
