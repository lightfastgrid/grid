/**
 * Full-grid state overlays (loading, noRows, noMatchingRows).
 * These are _not_ anchored floating popovers — see `features/floating` for
 * the shared floating UI engine and `features/cell-shells` for the cell-shell
 * overlay adapter that opens floating popovers from shell triggers.
 *
 * Resolution priority:
 *   1. manualOverlay (if not null)
 *   2. loading
 *   3. empty rows → "noRows"
 *   4. nothing → hide
 *
 * Custom render contract: returns void or a cleanup function. The cleanup
 * runs whenever the active overlay changes/hides/destroys.
 */

import type { Grid } from "../../Grid";
import type {
  GridOverlayKind,
  GridOverlayOptions,
  GridOverlaysOptions,
  LightFastGridOverlayPresentationChangedEvent,
} from "../../types";

import { OverlayLayer } from "./OverlayLayer";
import { resolveOverlayPresentation } from "./overlayPresentation";
import { DEFAULT_OVERLAY_TEXT, type OverlayState } from "./types";

export interface OverlayControllerOptions {
  gridRoot: HTMLElement;
  getOverlayState: () => OverlayState;
  /** Number of display rows. Used only for empty-rows detection. */
  getDisplayRowCount: () => number;
  getGridInstance: () => Grid | null;
  onPresentationChanged?: (
    event: LightFastGridOverlayPresentationChangedEvent,
  ) => void;
}

export class OverlayController {
  private readonly layer: OverlayLayer;
  private readonly options: OverlayControllerOptions;

  /** Cached "what's currently rendered" so sync is a cheap no-op when stable. */
  private activeKind: GridOverlayKind | null = null;
  private activeOptions: GridOverlayOptions | undefined;
  private publishedKind: GridOverlayKind | null = null;
  private publishedText: string | null = null;
  private renderCleanup: (() => void) | null = null;

  constructor(options: OverlayControllerOptions) {
    this.options = options;
    this.layer = new OverlayLayer(options.gridRoot);
  }

  /**
   * Resolve and apply the active overlay. Cheap when nothing changed:
   * compares `kind` and the `options` reference and bails early.
   */
  sync(): void {
    const state = this.options.getOverlayState();
    const kind = this.resolveActiveKind(state);

    if (kind === null) {
      const hadPresentation = this.publishedKind !== null;
      this.clearActive();
      this.layer.hide();
      if (hadPresentation) {
        this.publishPresentation({ kind: null, text: null });
      }
      return;
    }

    const variantOptions = this.resolveVariantOptions(kind, state);
    if (kind === this.activeKind && variantOptions === this.activeOptions) {
      return; // No-op.
    }
    const presentation = resolveOverlayPresentation(kind, variantOptions);

    // Tear down the previous overlay (custom cleanup + clear host).
    this.runCleanup();
    this.layer.clear();

    // Show layer with kind + custom class.
    this.layer.show(kind, variantOptions?.className);

    const host = this.layer.getHost();
    if (variantOptions?.render) {
      const grid = this.options.getGridInstance();
      const result = variantOptions.render({ host, kind, grid });
      if (typeof result === "function") {
        this.renderCleanup = result;
      }
    } else {
      host.textContent = variantOptions?.text ?? DEFAULT_OVERLAY_TEXT[kind];
    }

    this.activeKind = kind;
    this.activeOptions = variantOptions;
    this.publishPresentation(presentation);
  }

  /** Tear down everything: cleanup, layer, references. */
  destroy(): void {
    this.runCleanup();
    this.activeKind = null;
    this.activeOptions = undefined;
    this.publishedKind = null;
    this.publishedText = null;
    this.layer.destroy();
  }

  // ── Internals ────────────────────────────────────────────────

  private resolveActiveKind(state: OverlayState): GridOverlayKind | null {
    if (state.manualOverlay !== null) return state.manualOverlay;
    if (state.loading) return "loading";
    if (this.options.getDisplayRowCount() === 0) return "noRows";
    return null;
  }

  private resolveVariantOptions(
    kind: GridOverlayKind,
    state: OverlayState,
  ): GridOverlayOptions | undefined {
    const overlays: GridOverlaysOptions | undefined = state.overlays;
    return overlays?.[kind];
  }

  private clearActive(): void {
    this.runCleanup();
    this.layer.clear();
    this.activeKind = null;
    this.activeOptions = undefined;
  }

  private runCleanup(): void {
    const cleanup = this.renderCleanup;
    if (cleanup) {
      this.renderCleanup = null;
      cleanup();
    }
  }

  private publishPresentation(
    presentation: LightFastGridOverlayPresentationChangedEvent,
  ): void {
    if (
      presentation.kind === this.publishedKind &&
      presentation.text === this.publishedText
    ) {
      return;
    }
    this.publishedKind = presentation.kind;
    this.publishedText = presentation.text;
    try {
      this.options.onPresentationChanged?.(presentation);
    } catch {
      // Neutral observers cannot replace an accepted overlay presentation.
    }
  }
}
