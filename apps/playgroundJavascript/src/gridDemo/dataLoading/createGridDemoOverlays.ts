import type { GridOverlaysOptions } from "@lightfastgrid/core";

import { mountGridErrorOverlay } from "./mountGridErrorOverlay.ts";
import { mountGridLoadingSkeleton } from "./mountGridLoadingSkeleton.ts";

/**
 * gridDemo overlay options for loading remote data and customization.
 *
 * Fetch errors use the automatic `noRows` overlay (empty rows, not loading).
 * Skeleton CSS uses `--lfg-*` theme tokens so light/dark stay consistent.
 */
export function createGridDemoOverlays(
  error: string | null,
): GridOverlaysOptions {
  return {
    loading: {
      text: "Loading data…",
      className: "grid-demo-loading-skeleton",
      render: ({ host }) => mountGridLoadingSkeleton(host),
    },
    noRows: error
      ? {
          text: error,
          className: "grid-demo-error-overlay",
          render: ({ host }) => mountGridErrorOverlay(host, error),
        }
      : {
          text: "No rows to show.",
        },
  };
}
