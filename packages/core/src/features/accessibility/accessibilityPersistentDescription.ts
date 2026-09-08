import type {
  LightFastGridOverlayPresentationChangedEvent,
} from "../../types";

export const ACCESSIBILITY_DESCRIPTION_CLASS = "lfg-a11y-description";
export const ACCESSIBILITY_OVERLAY_DESCRIPTION_CLASS =
  "lfg-a11y-overlay-description";

let nextDescriptionInstanceId = 1;

function allocateDescriptionInstanceId(): number {
  const id = nextDescriptionInstanceId;
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error("Accessibility description instance id exhausted");
  }
  nextDescriptionInstanceId =
    id === Number.MAX_SAFE_INTEGER ? Number.NaN : id + 1;
  return id;
}

/**
 * Retains the currently accepted overlay description outside the composite
 * grid. This is persistent state, not a second live-announcement channel.
 */
export class AccessibilityPersistentDescription {
  private readonly instanceId = allocateDescriptionInstanceId();
  private root: HTMLElement | null = null;
  private node: HTMLDivElement | null = null;
  private active = false;
  private text = "";

  attach(root: HTMLElement): void {
    if (this.root === root && this.node?.parentElement === root) return;
    this.detach();
    const node = root.ownerDocument.createElement("div");
    node.className =
      `${ACCESSIBILITY_DESCRIPTION_CLASS} ${ACCESSIBILITY_OVERLAY_DESCRIPTION_CLASS}`;
    node.id =
      `lfg-a11y-${this.instanceId}-overlay-description`;
    root.appendChild(node);
    this.root = root;
    this.node = node;
  }

  update(event: LightFastGridOverlayPresentationChangedEvent): boolean {
    const node = this.node;
    if (node === null) return false;
    const nextActive = event.kind !== null && event.text !== null;
    const nextText =
      event.kind !== null && event.text !== null ? event.text : "";
    const changed = this.active !== nextActive || this.text !== nextText;
    if (!changed) return false;
    node.textContent = nextText;
    this.active = nextActive;
    this.text = nextText;
    return true;
  }

  getActiveId(): string | undefined {
    return this.active && this.node?.isConnected === true
      ? this.node.id
      : undefined;
  }

  detach(): void {
    this.node?.remove();
    this.node = null;
    this.root = null;
    this.active = false;
    this.text = "";
  }
}
