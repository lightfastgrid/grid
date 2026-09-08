import type { EditCommitChange } from "../features/editing/editingTypes";
import type { Grid } from "../Grid";
import type { RowIdentityService } from "../identity/RowIdentityService";
import { resolveGridTheme } from "../themes";
import type { GridActions, GridConfig, GridOptions, RowData } from "../types";

export interface GridContext {
  actions: GridActions;
  config: GridConfig;
  /** Shared row id resolver used by renderer, selection events, and RowAccess. */
  resolveRowId: (row: RowData, index: number) => string;
  /**
   * Live `Grid` accessor — used by features that build callback contexts
   * exposing the public Grid object (e.g. {@link RowClassParams.grid}).
   * Returns `null` before the Grid instance has finished wiring its context,
   * but in practice the renderer only invokes this after construction.
   */
  getGridInstance: () => Grid | null;
  commitCellEdit?: (change: EditCommitChange) => void;
}

export function createGridContext(
  props: GridOptions,
  actionHandlers: GridActions,
  rowIdentity: RowIdentityService,
  getGridInstance: () => Grid | null,
  commitCellEdit?: (change: EditCommitChange) => void,
): GridContext {
  // Index is intentionally optional — new user `getRowId` callbacks should
  // ignore it: `(row) => row.id`. We still forward it for back-compat with
  // any existing 2-arg signature.
  const getRowId = props.getRowId
    ? (row: RowData, index?: number) => props.getRowId!(row, index)
    : undefined;

  const resolved = resolveGridTheme(props.theme);

  return {
    actions: actionHandlers,
    commitCellEdit,
    config: {
      theme: resolved.dataTheme,
      resolvedTheme: resolved,
      layoutMetrics: resolved.layoutMetrics,
      getRowId,
      suppressRowVirtualization: props.suppressRowVirtualization === true,
      suppressColumnVirtualization: props.suppressColumnVirtualization === true,
      columnMenu: props.columnMenu,
      cellMenu: props.cellMenu,
      cellRenderers: props.cellRenderers,
      cellShellOverlays: props.cellShellOverlays,
      headerRenderers: props.headerRenderers,
    },
    resolveRowId: (row, index) =>
      rowIdentity.resolve(row, index, getRowId),
    getGridInstance,
  };
}
