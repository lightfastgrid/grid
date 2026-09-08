// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import { CSS } from "../../../rendering/const/css-classes";
import { queryCenterPoolRows } from "../../../rendering/helpers/dom/centerPoolRows";
import { ROW_HEIGHT } from "../../../rendering/helpers/gridConstants";
import type { RowData } from "../../../types";

async function flushRenders(): Promise<void> {
  // End-of-scroll arming is scrollend-driven; dispatch then drain quiet frames.
  for (const viewport of document.querySelectorAll(".lfg-viewport")) {
    viewport.dispatchEvent(new Event("scrollend"));
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("aria-rowindex after scroll", () => {
  let container: HTMLDivElement;
  let grid: Grid;

  afterEach(() => {
    grid.destroy();
    container.remove();
  });

  it("matches header offset + bound display index after vertical scroll", async () => {
    const rows: RowData[] = Array.from({ length: 80 }, (_, i) => ({
      id: `r${i}`,
      n: i,
    }));

    container = document.createElement("div");
    Object.assign(container.style, { height: "200px", width: "400px" });
    document.body.appendChild(container);

    grid = new Grid({
      rows,
      columns: [{ field: "n" }],
      getRowId: (r) => (r as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();
    await flushRenders();

    const root = container.querySelector(`.${CSS.GRID}`) as HTMLElement;
    const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    const scrollContainer = root.querySelector(
      `.${CSS.SCROLL_CONTAINER}`,
    ) as HTMLElement;

    const firstRow = () => {
      const visible = queryCenterPoolRows(scrollContainer).filter(
        (r) => r.getAttribute("data-row-id") !== null,
      );
      return visible[0] ?? null;
    };

    const expectRowIndexMatchesDom = (row: HTMLElement): void => {
      const displayIndex = Number(row.getAttribute("data-row-index"));
      const ariaAttr = row.getAttribute("aria-rowindex");
      expect(ariaAttr, "aria-rowindex should be set").not.toBeNull();
      expect(Number(ariaAttr)).toBe(1 + displayIndex + 1);
    };

    const row0 = firstRow();
    expect(row0).toBeTruthy();
    expectRowIndexMatchesDom(row0!);

    viewport.scrollTop = 25 * ROW_HEIGHT;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    await flushRenders();
    await flushRenders();

    const rowAfterScroll = firstRow();
    expect(rowAfterScroll).toBeTruthy();
    const displayAfter = Number(rowAfterScroll!.getAttribute("data-row-index"));
    expect(displayAfter).toBeGreaterThan(20);
    expectRowIndexMatchesDom(rowAfterScroll!);
  });
});
