import type {
  AccessibilityAnnouncement,
  AccessibilityAnnouncementPriority,
} from "./accessibilityAnnouncementMessages";

export const ACCESSIBILITY_ANNOUNCEMENT_DELAY_MS = 100;
export const ACCESSIBILITY_ANNOUNCEMENT_MAX_LENGTH = 512;
export const ACCESSIBILITY_LIVE_REGION_CLASS = "lfg-a11y-status";
const WHITESPACE_CHARACTER = /\s/u;

interface AccessibilityAnnouncementTimer {
  schedule(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  cancel(handle: ReturnType<typeof setTimeout>): void;
}

const DEFAULT_TIMER: AccessibilityAnnouncementTimer = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle),
};

interface PendingAnnouncement {
  readonly owner: object;
  readonly text: string;
  readonly priority: AccessibilityAnnouncementPriority;
}

function normalizedText(value: string): string | null {
  const leadingScanLimit = Math.min(
    value.length,
    ACCESSIBILITY_ANNOUNCEMENT_MAX_LENGTH,
  );
  let start = 0;
  while (
    start < leadingScanLimit &&
    WHITESPACE_CHARACTER.test(value.charAt(start))
  ) {
    start += 1;
  }
  if (start === leadingScanLimit) return null;
  const prefix =
    value.length - start <= ACCESSIBILITY_ANNOUNCEMENT_MAX_LENGTH
      ? value.slice(start)
      : value.slice(
          start,
          start + ACCESSIBILITY_ANNOUNCEMENT_MAX_LENGTH,
        );
  const text = prefix.trimEnd();
  if (text.length === 0) return null;
  return text;
}

/**
 * Owns one retained live status sibling. Requests are low-frequency Grid
 * domain events; renderer scrolling and semantic reconciliation never call it.
 */
export class AccessibilityLiveRegion {
  private region: HTMLDivElement | null = null;
  private textNodes: readonly [Text, Text] | null = null;
  private activeTextNodeIndex = 1;
  private pending: PendingAnnouncement | null = null;
  private timerHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly timer: AccessibilityAnnouncementTimer = DEFAULT_TIMER,
  ) {}

  attach(gridRoot: HTMLElement): void {
    this.detach();
    const parent = gridRoot.parentNode;
    if (parent === null) return;

    try {
      const ownerDocument = gridRoot.ownerDocument;
      const region = ownerDocument.createElement("div");
      region.className = ACCESSIBILITY_LIVE_REGION_CLASS;
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "true");
      const textNodes = [
        ownerDocument.createTextNode(""),
        ownerDocument.createTextNode(""),
      ] as const;
      parent.insertBefore(region, gridRoot.nextSibling);
      this.region = region;
      this.textNodes = textNodes;
      this.activeTextNodeIndex = 1;
    } catch {
      this.region = null;
      this.textNodes = null;
    }
  }

  detach(): void {
    this.cancelPending();
    const region = this.region;
    this.region = null;
    this.textNodes = null;
    this.activeTextNodeIndex = 1;
    if (region !== null) {
      try {
        region.remove();
      } catch {
        // Accessibility cleanup must not break Grid teardown.
      }
    }
  }

  request(announcement: AccessibilityAnnouncement): void {
    const region = this.region;
    const textNodes = this.textNodes;
    const text = normalizedText(announcement.text);
    if (
      region === null ||
      textNodes === null ||
      !region.isConnected ||
      text === null
    ) {
      return;
    }
    if (
      this.pending?.priority === "error" &&
      announcement.priority === "ordinary"
    ) {
      return;
    }

    const pending: PendingAnnouncement = {
      owner: Object.freeze({}),
      text,
      priority: announcement.priority,
    };
    this.cancelTimer();
    this.pending = pending;
    try {
      this.timerHandle = this.timer.schedule(
        () => this.publish(pending.owner),
        ACCESSIBILITY_ANNOUNCEMENT_DELAY_MS,
      );
    } catch {
      if (this.pending === pending) this.pending = null;
      this.timerHandle = null;
    }
  }

  private publish(owner: object): void {
    const pending = this.pending;
    const region = this.region;
    const textNodes = this.textNodes;
    this.timerHandle = null;
    if (
      pending === null ||
      pending.owner !== owner ||
      region === null ||
      textNodes === null ||
      !region.isConnected
    ) {
      return;
    }

    const nextIndex = this.activeTextNodeIndex === 0 ? 1 : 0;
    const textNode = textNodes[nextIndex];
    try {
      textNode.data = pending.text;
      region.replaceChildren(textNode);
      this.activeTextNodeIndex = nextIndex;
    } catch {
      // Live output is secondary and cannot replace the accepted Grid action.
    }
    if (this.pending?.owner === owner) {
      this.pending = null;
    }
  }

  private cancelPending(): void {
    this.cancelTimer();
    this.pending = null;
  }

  private cancelTimer(): void {
    const handle = this.timerHandle;
    this.timerHandle = null;
    if (handle === null) return;
    try {
      this.timer.cancel(handle);
    } catch {
      // Timer cleanup is best-effort and stale owners remain inert.
    }
  }
}
