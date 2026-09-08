import { FloatingLayer } from "./FloatingLayer";
import { FloatingPositioner } from "./FloatingPositioner";
import type { FloatingOptions, FloatingPlacement } from "./types";

const DEFAULT_PLACEMENT: FloatingPlacement = "bottom-start";
/** Default gap when `arrow: true` and `offset` is omitted. */
export const FLOATING_ARROW_OFFSET_PX = 8;
/** Shared popover-arrow element class (caret on floating host). */
export const FLOATING_ARROW_CLASS = "lfg-floating-arrow";

function isAnchorVisible(anchorEl: HTMLElement, boundaryEl: HTMLElement): boolean {
  if (!anchorEl.isConnected || !boundaryEl.isConnected) return false;

  const a = anchorEl.getBoundingClientRect();
  if (a.width === 0 && a.height === 0) return false;

  const b = boundaryEl.getBoundingClientRect();
  return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
}

function resolveOffset(options: FloatingOptions): number {
  if (options.offset !== undefined) return Math.max(0, options.offset);
  if (options.arrow) return FLOATING_ARROW_OFFSET_PX;
  return 0;
}

/**
 * Shared anchored floating UI engine (popovers, menus, tooltips).
 * Feature-specific adapters (cell-shell overlays, column menus, cell menus)
 * own an instance and call open/close — this class handles positioning,
 * scroll/resize reposition, outside-click dismiss, and cleanup.
 */
export class FloatingController {
  private readonly gridRoot: HTMLElement;
  private readonly layer: FloatingLayer;
  private readonly positioner: FloatingPositioner;
  private readonly scrollContainer: HTMLElement | null;

  private currentOptions: FloatingOptions | null = null;
  private renderCleanup: (() => void) | null = null;
  private repositionRafId = 0;
  private postRenderRafId = 0;
  private openGeneration = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor(gridRoot: HTMLElement, scrollContainer?: HTMLElement) {
    this.gridRoot = gridRoot;
    this.layer = new FloatingLayer(gridRoot);
    this.positioner = new FloatingPositioner(gridRoot);
    this.scrollContainer = scrollContainer ?? null;
  }

  isOpen(): boolean {
    return this.currentOptions !== null;
  }

  containsTarget(node: Node): boolean {
    return this.currentOptions !== null && this.layer.getHost().contains(node);
  }

  open(options: FloatingOptions): void {
    if (this.currentOptions) {
      this.close();
    }

    this.currentOptions = options;
    const generation = ++this.openGeneration;

    const host = this.layer.getHost();
    this.layer.show();

    try {
      const cleanup = options.render(host);
      if (typeof cleanup === "function") {
        this.renderCleanup = cleanup;
      }

      const result = this.positioner.position({
        anchorEl: options.anchorEl,
        hostEl: host,
        placement: options.placement ?? DEFAULT_PLACEMENT,
        matchAnchorWidth: options.matchAnchorWidth ?? false,
        clampToViewport: options.clampToViewport ?? true,
        offset: resolveOffset(options),
      });
      this.syncHostPlacementAttrs(host, result.placement, options.arrow === true);
      this.syncArrowElement(host, options.arrow === true);

      this.postRenderRafId = requestAnimationFrame(() => {
        this.postRenderRafId = 0;
        if (this.openGeneration !== generation || !this.currentOptions) return;
        this.reposition();
      });

      this.observeHost(host);
      this.addListeners();
    } catch (error) {
      if (
        this.openGeneration === generation &&
        this.currentOptions === options
      ) {
        this.removeListeners();
        this.cancelPostRenderRaf();
        this.disconnectResizeObserver();
        try {
          this.runRenderCleanup();
        } catch {
          // Preserve the primary render/positioning error.
        }
        this.layer.clear();
        this.layer.hide();
        this.currentOptions = null;
      }
      throw error;
    }
  }

  close(): void {
    const opts = this.currentOptions;
    if (!opts) return;

    this.removeListeners();
    this.cancelPostRenderRaf();
    this.disconnectResizeObserver();
    let primaryError: unknown;
    try {
      this.runRenderCleanup();
    } catch (error) {
      primaryError = error;
    }

    if (this.currentOptions === opts) {
      const host = this.layer.getHost();
      host.removeAttribute("data-lfg-placement");
      host.removeAttribute("data-lfg-arrow");
      this.layer.clear();
      this.layer.hide();
      this.currentOptions = null;
    }

    try {
      opts.onClose?.();
    } catch (error) {
      primaryError ??= error;
    }

    if (primaryError !== undefined) {
      throw primaryError;
    }
  }

  reposition(): void {
    const opts = this.currentOptions;
    if (!opts) return;

    const host = this.layer.getHost();
    const result = this.positioner.position({
      anchorEl: opts.anchorEl,
      hostEl: host,
      placement: opts.placement ?? DEFAULT_PLACEMENT,
      matchAnchorWidth: opts.matchAnchorWidth ?? false,
      clampToViewport: opts.clampToViewport ?? true,
      offset: resolveOffset(opts),
    });
    this.syncHostPlacementAttrs(host, result.placement, opts.arrow === true);
    this.syncArrowElement(host, opts.arrow === true);
  }

  destroy(): void {
    let primaryError: unknown;
    try {
      this.close();
    } catch (error) {
      primaryError = error;
    }
    try {
      this.layer.destroy();
    } catch (error) {
      primaryError ??= error;
    }
    if (primaryError !== undefined) {
      throw primaryError;
    }
  }

  private syncHostPlacementAttrs(
    host: HTMLElement,
    placement: FloatingPlacement,
    arrow: boolean,
  ): void {
    host.setAttribute("data-lfg-placement", placement);
    if (arrow) {
      host.setAttribute("data-lfg-arrow", "");
    } else {
      host.removeAttribute("data-lfg-arrow");
    }
  }

  /**
   * Host-owned caret element so arrows work for every panel kind (including
   * filter panels with `overflow-y: auto`, which would clip panel ::before arrows).
   */
  private syncArrowElement(host: HTMLElement, arrow: boolean): void {
    let el = host.querySelector(
      `:scope > .${FLOATING_ARROW_CLASS}`,
    ) as HTMLElement | null;
    if (!arrow) {
      el?.remove();
      return;
    }
    if (el) return;
    el = document.createElement("div");
    el.className = FLOATING_ARROW_CLASS;
    el.setAttribute("aria-hidden", "true");
    host.insertBefore(el, host.firstChild);
  }

  private get visibilityBoundary(): HTMLElement {
    return this.scrollContainer ?? this.gridRoot;
  }

  private repositionOrCloseIfHidden(): void {
    if (!this.currentOptions) return;

    if (!isAnchorVisible(this.currentOptions.anchorEl, this.visibilityBoundary)) {
      this.close();
      return;
    }

    this.reposition();
  }

  private runRenderCleanup(): void {
    if (this.renderCleanup) {
      const fn = this.renderCleanup;
      this.renderCleanup = null;
      fn();
    }
  }

  private cancelPostRenderRaf(): void {
    if (this.postRenderRafId) {
      cancelAnimationFrame(this.postRenderRafId);
      this.postRenderRafId = 0;
    }
  }

  private observeHost(host: HTMLElement): void {
    this.disconnectResizeObserver();
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.currentOptions) this.reposition();
    });
    this.resizeObserver.observe(host);
  }

  private disconnectResizeObserver(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  private addListeners(): void {
    const opts = this.currentOptions!;

    if (opts.closeOnOutsideClick ?? true) {
      document.addEventListener("pointerdown", this.onPointerDown, true);
    }
    if (opts.closeOnEscape ?? true) {
      document.addEventListener("keydown", this.onKeyDown, true);
    }

    if (this.scrollContainer) {
      this.scrollContainer.addEventListener("scroll", this.onScroll, { passive: true });
    }

    window.addEventListener("resize", this.onResize, { passive: true });
  }

  private removeListeners(): void {
    if (this.repositionRafId) {
      cancelAnimationFrame(this.repositionRafId);
      this.repositionRafId = 0;
    }

    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("keydown", this.onKeyDown, true);

    if (this.scrollContainer) {
      this.scrollContainer.removeEventListener("scroll", this.onScroll);
    }

    window.removeEventListener("resize", this.onResize);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (!target) return;

    const host = this.layer.getHost();
    if (host.contains(target)) return;
    if (this.currentOptions?.anchorEl.contains(target)) return;

    this.close();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      const options = this.currentOptions;
      options?.onEscape?.();
      if (this.currentOptions === options) this.close();
    }
  };

  private readonly onScroll = (): void => {
    if (!this.currentOptions) return;

    if (this.currentOptions.closeOnScroll ?? true) {
      this.close();
      return;
    }

    if (!this.repositionRafId) {
      this.repositionRafId = requestAnimationFrame(() => {
        this.repositionRafId = 0;
        this.repositionOrCloseIfHidden();
      });
    }
  };

  private readonly onResize = (): void => {
    if (!this.currentOptions) return;

    if (!this.repositionRafId) {
      this.repositionRafId = requestAnimationFrame(() => {
        this.repositionRafId = 0;
        this.repositionOrCloseIfHidden();
      });
    }
  };
}
