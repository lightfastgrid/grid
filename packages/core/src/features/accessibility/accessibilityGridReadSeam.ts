import type { Grid } from "../../Grid";
import type {
  GridAccessibilityOptions,
  RowSelectionConfig,
  RowSelectionMode,
} from "../../types";

/** Factory inputs for building a live grid read seam (kept out of registry imports). */
export interface AccessibilityGridReadSeamContext {
  getRowSelectionConfig(): RowSelectionConfig;
  getGridInstance?: () => Grid | null;
}

/** Live grid reads for accessibility reconcile (no DOM). */
export interface AccessibilityGridReadSeam {
  getAccessibilityOptions(): GridAccessibilityOptions | undefined;
  getRowSelectionMode(): RowSelectionMode;
  isGridBusy(): boolean;
}

export function createAccessibilityGridReadSeam(
  ctx: AccessibilityGridReadSeamContext,
): AccessibilityGridReadSeam {
  const grid = (): Grid | null => ctx.getGridInstance?.() ?? null;

  return {
    getAccessibilityOptions: () => grid()?.getAccessibilityOptions(),
    getRowSelectionMode: () => ctx.getRowSelectionConfig().mode,
    isGridBusy: () => {
      const overlay = grid()?.getOverlayState();
      if (overlay === undefined) return false;
      return overlay.manualOverlay === null
        ? overlay.loading
        : overlay.manualOverlay === "loading";
    },
  };
}
