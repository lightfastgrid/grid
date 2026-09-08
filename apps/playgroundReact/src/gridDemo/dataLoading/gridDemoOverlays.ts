import type { ReactGridOverlaysOptions } from "@lightfastgrid/react";
import { createElement } from "react";

import { GridErrorOverlay } from "./GridErrorOverlay";
import { GridLoadingSkeleton } from "./GridLoadingSkeleton";

/**
 * gridDemo overlay options for loading remote data and customization.
 *
 * Fetch errors use the automatic `noRows` overlay (empty rows, not loading).
 */
export function createGridDemoOverlays(
  error: string | null,
): ReactGridOverlaysOptions {
  return {
    loading: {
      text: "Loading data…",
      className: "grid-demo-loading-skeleton",
      render: () => createElement(GridLoadingSkeleton),
    },
    noRows: error
      ? {
          text: error,
          className: "grid-demo-error-overlay",
          render: () => createElement(GridErrorOverlay, { message: error }),
        }
      : {
          text: "No rows to show.",
        },
  };
}
