// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { ACCESSIBILITY_LIVE_REGION_CLASS } from "../accessibilityLiveRegion";

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

describe("Accessibility V2 live-region integration", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("keeps mount, focus, menu state, and continuous scroll silent", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { width: "600px", height: "300px" });
    document.body.appendChild(container);
    const grid = new Grid({
      rows: [{ id: "a", amount: 2 }, { id: "b", amount: 1 }],
      columns: [{ field: "amount", headerName: "Amount", sortable: true }],
      getRowId: (row) => String(row.id),
    });
    grid.mount(container);

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const surface = container.querySelector<HTMLElement>(".lfg-grid-surface")!;
    const status = container.querySelector<HTMLElement>(
      `.${ACCESSIBILITY_LIVE_REGION_CLASS}`,
    )!;
    // Status node is a sibling of the outer root, outside the composite grid.
    expect(status).toBe(root.nextElementSibling);
    expect(root.contains(status)).toBe(false);
    for (let index = 0; index < 1_000; index += 1) {
      root.querySelector<HTMLElement>(".lfg-viewport")?.dispatchEvent(
        new Event("scroll"),
      );
    }
    grid.setFocusedCell({ rowIndex: 0, field: "amount" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(status.textContent).toBe("");

    grid.setLoading(true);
    await expectStatus(status, "Loading...");
    grid.setLoading(false);
    await expectStatus(status, "Loading complete. 2 rows.");

    grid.setSortModel([{ field: "amount", sort: "asc" }]);
    await expectStatus(status, "Sorted by Amount, ascending.");

    grid.destroy();
    expect(status.isConnected).toBe(false);
    // Base focusability lives on the surface and survives plugin detach.
    expect(surface.tabIndex).toBe(0);
  });
});
