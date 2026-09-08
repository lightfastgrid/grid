/**
 * Single overlay DOM container that sits OUTSIDE the virtualized scroll
 * container, row pool, and cell DOM.
 *
 * One `.lfg-overlay-layer` is created and reused across all overlay
 * transitions. The inner `.lfg-overlay` host is the element the controller
 * fills with default text or a custom renderer's output.
 *
 * No layout reads. No row/cell DOM access. Pointer events are disabled on
 * the layer by default so the overlay never blocks scroll/pointer events
 * on the body unless the host (`.lfg-overlay`) opts back in via CSS.
 */

const LAYER_CLASS = "lfg-overlay-layer";
const HOST_CLASS = "lfg-overlay";

/** Split a class string into individual non-empty tokens. */
function splitClassTokens(value: string | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const t of value.split(/\s+/)) {
    if (t.length > 0) out.push(t);
  }
  return out;
}

export class OverlayLayer {
  private layer: HTMLDivElement | null = null;
  private host: HTMLDivElement | null = null;
  /** Tokens of the currently applied custom className (split by whitespace). */
  private appliedCustomClasses: string[] = [];

  constructor(private readonly gridRoot: HTMLElement) {}

  /** Lazily create or reuse the single layer + host. */
  private ensure(): { layer: HTMLDivElement; host: HTMLDivElement } {
    if (this.layer && this.host) {
      return { layer: this.layer, host: this.host };
    }
    // Reuse any existing layer DOM (e.g. left behind by an earlier mount).
    let layer = this.gridRoot.querySelector<HTMLDivElement>(`.${LAYER_CLASS}`);
    if (!layer) {
      layer = document.createElement("div");
      layer.className = LAYER_CLASS;
      this.gridRoot.appendChild(layer);
    }
    let host = layer.querySelector<HTMLDivElement>(`.${HOST_CLASS}`);
    if (!host) {
      host = document.createElement("div");
      host.className = HOST_CLASS;
      layer.appendChild(host);
    }
    this.layer = layer;
    this.host = host;
    return { layer, host };
  }

  /** The current host element, creating it if needed. */
  getHost(): HTMLDivElement {
    return this.ensure().host;
  }

  /** Make the layer visible and tag the host with the overlay kind + class(es). */
  show(kind: string, className?: string): void {
    const { layer, host } = this.ensure();
    layer.setAttribute("data-visible", "true");
    host.setAttribute("data-overlay-kind", kind);
    // Swap custom classes cleanly: remove every previously applied token, then
    // add every token from the new className.
    const nextTokens = splitClassTokens(className);
    for (const t of this.appliedCustomClasses) {
      if (!nextTokens.includes(t)) host.classList.remove(t);
    }
    for (const t of nextTokens) {
      if (!this.appliedCustomClasses.includes(t)) host.classList.add(t);
    }
    this.appliedCustomClasses = nextTokens;
  }

  /** Hide the layer without destroying it. */
  hide(): void {
    if (!this.layer) return;
    this.layer.removeAttribute("data-visible");
    if (this.host) this.host.removeAttribute("data-overlay-kind");
  }

  /** Remove overlay content from the host (preserves the host itself). */
  clear(): void {
    if (this.host) {
      // Custom React renderers unmount via cleanup before clear runs.
      // replaceChildren() while a React root is still mounted causes removeChild errors.
      if (this.host.childNodes.length > 0) {
        this.host.replaceChildren();
      }
      for (const t of this.appliedCustomClasses) this.host.classList.remove(t);
    }
    this.appliedCustomClasses = [];
  }

  /** Tear down DOM. After this the layer/host references are gone. */
  destroy(): void {
    if (this.layer) {
      this.layer.remove();
      this.layer = null;
      this.host = null;
      this.appliedCustomClasses = [];
    }
  }
}
