import type { Grid } from "../../Grid";
import type { LightFastGridOverlayPresentationChangedEvent } from "../../types";
import type { DomGridFeature, OverlayCapability } from "../types";

import { OverlayController } from "./OverlayController";
import type { OverlayState } from "./types";

export interface OverlayFeatureOptions {
  getOverlayState: () => OverlayState;
  /** Number of display rows. Used only for empty-rows detection. */
  getDisplayRowCount: () => number;
  getGridInstance: () => Grid | null;
  onPresentationChanged?: (
    event: LightFastGridOverlayPresentationChangedEvent,
  ) => void;
}

export function overlayFeature(
  options: OverlayFeatureOptions,
): DomGridFeature & OverlayCapability {
  let controller: OverlayController | null = null;

  return {
    name: "overlays",

    attach(ctx) {
      controller = new OverlayController({
        gridRoot: ctx.root,
        getOverlayState: options.getOverlayState,
        getDisplayRowCount: options.getDisplayRowCount,
        getGridInstance: options.getGridInstance,
        onPresentationChanged: options.onPresentationChanged,
      });
      // Do NOT sync here. At attach time the renderer's snapshot and
      // display-row state are not yet assigned, so a sync would observe
      // zero rows and flash a stale noRows overlay. DomGridRenderer.render()
      // calls syncOverlays() after the current display-row reader is
      // resolved — that is the canonical sync path.
    },

    detach() {
      controller?.destroy();
      controller = null;
    },

    syncOverlays() {
      controller?.sync();
    },
  };
}
