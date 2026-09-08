// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import type { LightFastGridOverlayPresentationChangedEvent } from "../../../types";
import { ACCESSIBILITY_LIVE_REGION_CLASS } from "../accessibilityLiveRegion";
import {
  ACCESSIBILITY_OVERLAY_DESCRIPTION_CLASS,
} from "../accessibilityPersistentDescription";

async function expectStatus(
  status: HTMLElement,
  text: string,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(status.textContent).toBe(text);
    },
    {
      timeout: 1_000,
    },
  );
}

describe("Accessibility V2 overlay semantics", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("announces accepted overlay text and tracks effective busy state", async () => {
    const render = vi.fn(({ host }: { host: HTMLElement }) => {
      host.textContent = "Visual empty state";
    });
    const container = document.createElement("div");
    Object.assign(container.style, { width: "600px", height: "300px" });
    document.body.appendChild(container);
    const grid = new Grid({
      rows: [],
      columns: [{ field: "name" }],
      overlays: {
        loading: { text: "Fetching employees" },
        noRows: { text: "No employees", render },
        noMatchingRows: { text: "No matching employees" },
      },
    });
    const presentations: LightFastGridOverlayPresentationChangedEvent[] = [];
    grid.on("overlay:presentation-changed", (event) => {
      presentations.push(event);
    });
    grid.mount(container);

    const surface = container.querySelector<HTMLElement>(".lfg-grid-surface")!;
    const status = container.querySelector<HTMLElement>(
      `.${ACCESSIBILITY_LIVE_REGION_CLASS}`,
    )!;
    await vi.waitFor(() => {
      expect(presentations[presentations.length - 1]).toEqual({
        kind: "noRows",
        text: "No employees",
      });
    });
    await expectStatus(status, "No employees");
    expect(surface.getAttribute("aria-busy")).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);

    grid.setLoading(true);
    await vi.waitFor(() => {
      expect(presentations[presentations.length - 1]).toEqual({
        kind: "loading",
        text: "Fetching employees",
      });
    });
    await expectStatus(status, "Fetching employees");
    expect(surface.getAttribute("aria-busy")).toBe("true");

    grid.showNoMatchingRowsOverlay();
    await expectStatus(status, "No matching employees");
    expect(surface.getAttribute("aria-busy")).toBeNull();

    grid.hideOverlay();
    await expectStatus(status, "Fetching employees");
    expect(surface.getAttribute("aria-busy")).toBe("true");

    grid.setLoading(false);
    await expectStatus(status, "No employees");
    expect(surface.getAttribute("aria-busy")).toBeNull();

    grid.destroy();
  });

  it("128 persistently describes only the accepted active overlay", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { width: "600px", height: "300px" });
    document.body.appendChild(container);
    const grid = new Grid({
      rows: [{ name: "Ada" }],
      columns: [{ field: "name" }],
      accessibility: { ariaDescribedBy: "application-help" },
      overlays: {
        loading: { text: "Fetching employees" },
        noMatchingRows: { text: "No matching employees" },
      },
    });
    grid.mount(container);

    const surface = container.querySelector<HTMLElement>(".lfg-grid-surface")!;
    const description = container.querySelector<HTMLElement>(
      `.${ACCESSIBILITY_OVERLAY_DESCRIPTION_CLASS}`,
    )!;
    const status = container.querySelector<HTMLElement>(
      `.${ACCESSIBILITY_LIVE_REGION_CLASS}`,
    )!;
    expect(description).not.toBe(status);
    expect(description.parentElement).toBe(
      container.querySelector(".lfg-grid"),
    );
    expect(surface.contains(description)).toBe(false);
    expect(description.textContent).toBe("");
    expect(surface.getAttribute("aria-describedby")).toBe(
      "application-help",
    );

    grid.showLoadingOverlay();
    await vi.waitFor(() => {
      expect(description.textContent).toBe("Fetching employees");
      expect(surface.getAttribute("aria-describedby")).toBe(
        `application-help ${description.id}`,
      );
    });

    const retainedNode = description;
    grid.showNoMatchingRowsOverlay();
    await vi.waitFor(() => {
      expect(description.textContent).toBe("No matching employees");
      expect(
        container.querySelector(
          `.${ACCESSIBILITY_OVERLAY_DESCRIPTION_CLASS}`,
        ),
      ).toBe(retainedNode);
      expect(
        surface.getAttribute("aria-describedby")?.split(" "),
      ).toEqual(["application-help", description.id]);
    });

    grid.hideOverlay();
    await vi.waitFor(() => {
      expect(description.textContent).toBe("");
      expect(surface.getAttribute("aria-describedby")).toBe(
        "application-help",
      );
    });

    grid.destroy();
    expect(description.isConnected).toBe(false);
  });
});
