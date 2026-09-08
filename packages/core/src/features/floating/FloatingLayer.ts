const LAYER_CLASS = "lfg-floating-layer";
const HOST_CLASS = "lfg-floating";

export class FloatingLayer {
  private layer: HTMLDivElement | null = null;
  private host: HTMLDivElement | null = null;

  constructor(private readonly gridRoot: HTMLElement) {}

  getHost(): HTMLDivElement {
    this.ensureLayer();
    return this.host!;
  }

  show(): void {
    this.ensureLayer();
    this.layer!.style.display = "";
    this.host!.style.display = "";
  }

  hide(): void {
    if (this.layer) this.layer.style.display = "none";
    if (this.host) this.host.style.display = "none";
  }

  clear(): void {
    if (this.host) this.host.textContent = "";
  }

  destroy(): void {
    if (this.layer) {
      this.layer.remove();
      this.layer = null;
      this.host = null;
    }
  }

  private ensureLayer(): void {
    if (this.layer) return;

    this.layer = document.createElement("div");
    this.layer.className = LAYER_CLASS;
    this.layer.style.display = "none";

    this.host = document.createElement("div");
    this.host.className = HOST_CLASS;
    this.host.style.display = "none";

    this.layer.appendChild(this.host);
    this.gridRoot.appendChild(this.layer);
  }
}
