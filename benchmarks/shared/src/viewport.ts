export const VIEWPORT_WIDTH_PX = 1280;
export const VIEWPORT_HEIGHT_PX = 720;
export const ROW_HEIGHT_PX = 40;
export const HEADER_HEIGHT_PX = 40;
export const COLUMN_WIDTH_PX = 150;
/** Matches LightFastGrid `POOL_SIDE_BUFFER_ROWS` (not a public Core option). */
export const OVERSCAN_ROWS_PER_SIDE = 5;

export const GRID_HOST_STYLE = {
  width: VIEWPORT_WIDTH_PX,
  height: VIEWPORT_HEIGHT_PX,
} as const;

/**
 * AG Grid 36 Theming API scrolling container (`overflow: auto`).
 * Legacy `.ag-body-viewport` / `.ag-center-cols-viewport` are not emitted.
 */
export const AG_GRID_VIEWPORT_SELECTOR = ".ag-grid-viewport";
