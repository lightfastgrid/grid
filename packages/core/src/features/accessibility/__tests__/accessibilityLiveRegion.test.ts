// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CSV_EXPORT_ERROR_ANNOUNCEMENT,
  rowCountAnnouncement,
} from "../accessibilityAnnouncementMessages";
import {
  ACCESSIBILITY_ANNOUNCEMENT_DELAY_MS,
  ACCESSIBILITY_ANNOUNCEMENT_MAX_LENGTH,
  ACCESSIBILITY_LIVE_REGION_CLASS,
  AccessibilityLiveRegion,
} from "../accessibilityLiveRegion";

function attachFixture(): {
  container: HTMLDivElement;
  root: HTMLDivElement;
  liveRegion: AccessibilityLiveRegion;
  status: HTMLDivElement;
} {
  const container = document.createElement("div");
  const root = document.createElement("div");
  root.setAttribute("role", "grid");
  root.tabIndex = 0;
  container.appendChild(root);
  document.body.appendChild(container);
  const liveRegion = new AccessibilityLiveRegion();
  liveRegion.attach(root);
  const status = container.querySelector<HTMLDivElement>(
    `.${ACCESSIBILITY_LIVE_REGION_CLASS}`,
  );
  if (status === null) throw new Error("missing status fixture");
  return { container, root, liveRegion, status };
}

describe("AccessibilityLiveRegion", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("creates one empty polite atomic sibling outside the grid", () => {
    const { container, root, status } = attachFixture();
    expect(container.children).toHaveLength(2);
    expect(root.nextElementSibling).toBe(status);
    expect(root.contains(status)).toBe(false);
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toBe("");
    expect(status.tabIndex).toBe(-1);
    expect(status.hidden).toBe(false);
    expect(status.getAttribute("aria-hidden")).toBeNull();
  });

  it("coalesces ordinary requests and lets a pending error win", () => {
    vi.useFakeTimers();
    const { liveRegion, status } = attachFixture();
    liveRegion.request(rowCountAnnouncement(1)!);
    liveRegion.request(rowCountAnnouncement(2)!);
    vi.advanceTimersByTime(ACCESSIBILITY_ANNOUNCEMENT_DELAY_MS - 1);
    expect(status.textContent).toBe("");
    vi.advanceTimersByTime(1);
    expect(status.textContent).toBe("2 rows available.");

    liveRegion.request(rowCountAnnouncement(3)!);
    liveRegion.request(CSV_EXPORT_ERROR_ANNOUNCEMENT);
    liveRegion.request(rowCountAnnouncement(4)!);
    vi.advanceTimersByTime(ACCESSIBILITY_ANNOUNCEMENT_DELAY_MS);
    expect(status.textContent).toBe("CSV export failed.");
  });

  it("replaces retained text nodes for identical accepted messages", () => {
    vi.useFakeTimers();
    const { liveRegion, status } = attachFixture();
    const announcement = rowCountAnnouncement(2)!;
    liveRegion.request(announcement);
    vi.advanceTimersByTime(ACCESSIBILITY_ANNOUNCEMENT_DELAY_MS);
    const first = status.firstChild;
    expect(first?.textContent).toBe("2 rows available.");

    liveRegion.request(announcement);
    vi.advanceTimersByTime(ACCESSIBILITY_ANNOUNCEMENT_DELAY_MS);
    const second = status.firstChild;
    expect(second?.textContent).toBe("2 rows available.");
    expect(second).not.toBe(first);

    liveRegion.request(announcement);
    vi.advanceTimersByTime(ACCESSIBILITY_ANNOUNCEMENT_DELAY_MS);
    expect(status.firstChild).toBe(first);
  });

  it("bounds retained application-controlled announcement text", () => {
    vi.useFakeTimers();
    const { liveRegion, status } = attachFixture();
    liveRegion.request({
      text: `  ${"x".repeat(ACCESSIBILITY_ANNOUNCEMENT_MAX_LENGTH + 100)}  `,
      priority: "ordinary",
    });
    vi.advanceTimersByTime(ACCESSIBILITY_ANNOUNCEMENT_DELAY_MS);
    expect(status.textContent).toHaveLength(
      ACCESSIBILITY_ANNOUNCEMENT_MAX_LENGTH,
    );
  });

  it("makes stale timers inert across detach and remount", () => {
    vi.useFakeTimers();
    const { container, root, liveRegion, status } = attachFixture();
    liveRegion.request(rowCountAnnouncement(2)!);
    liveRegion.detach();
    expect(status.isConnected).toBe(false);
    expect(root.tabIndex).toBe(0);

    const nextRoot = document.createElement("div");
    nextRoot.tabIndex = 0;
    container.appendChild(nextRoot);
    liveRegion.attach(nextRoot);
    const nextStatus = nextRoot.nextElementSibling;
    vi.runAllTimers();
    expect(nextStatus?.textContent).toBe("");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("isolates timer scheduling, cancellation, and publication failures", () => {
    const callbacks: Array<() => void> = [];
    const liveRegion = new AccessibilityLiveRegion({
      schedule(callback) {
        callbacks.push(callback);
        if (callbacks.length === 1) throw new Error("schedule failed");
        return setTimeout(() => {}, 1_000);
      },
      cancel() {
        throw new Error("cancel failed");
      },
    });
    const container = document.createElement("div");
    const root = document.createElement("div");
    container.appendChild(root);
    document.body.appendChild(container);
    liveRegion.attach(root);
    expect(() => liveRegion.request(rowCountAnnouncement(1)!)).not.toThrow();
    expect(() => liveRegion.request(rowCountAnnouncement(2)!)).not.toThrow();
    const status = container.querySelector<HTMLDivElement>('[role="status"]')!;
    vi.spyOn(status, "replaceChildren").mockImplementation(() => {
      throw new Error("DOM failed");
    });
    expect(() => callbacks[callbacks.length - 1]?.()).not.toThrow();
    expect(status.textContent).toBe("");
    expect(() => liveRegion.detach()).not.toThrow();
  });
});
