/**
 * Feature-neutral structural metadata for renderer-owned header addon rows.
 *
 * These markers identify existing DOM during low-frequency topology capture.
 * They do not carry accessibility state and must not be read from scroll paths.
 */
export const HEADER_ADDON_ROW_KIND_ATTRIBUTE =
  "data-lfg-header-addon-row";
export const HEADER_ADDON_CELL_ATTRIBUTE =
  "data-lfg-header-addon-cell";

export const FLOATING_FILTER_HEADER_ADDON_KIND = "floating-filter";

export const FLOATING_FILTER_HEADER_ROW_SELECTOR =
  `[${HEADER_ADDON_ROW_KIND_ATTRIBUTE}="${FLOATING_FILTER_HEADER_ADDON_KIND}"]`;
export const HEADER_ADDON_CELL_SELECTOR =
  `[${HEADER_ADDON_CELL_ATTRIBUTE}]`;
