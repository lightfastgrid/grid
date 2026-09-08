/**
 * Internal overlay types. The public API (`GridOverlayKind`,
 * `GridOverlayOptions`, etc.) lives in `../../types`; this file holds the
 * controller-side state aggregation type.
 */

import type { GridOverlayKind, GridOverlaysOptions } from "../../types";

export interface OverlayState {
  loading: boolean;
  manualOverlay: GridOverlayKind | null;
  overlays?: GridOverlaysOptions;
}

/** Default text for each overlay variant when no `text` override is provided. */
export const DEFAULT_OVERLAY_TEXT: Record<GridOverlayKind, string> = {
  loading: "Loading...",
  noRows: "No rows",
  noMatchingRows: "No matching rows",
};
