// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import type { RowData } from "../../../types";

/**
 * Stage F16A — neutral semantic surface. Required tests 113–116.
 *
 * The base skeleton owns a viewport-only `.lfg-grid-surface`. The outer
 * `.lfg-grid` root remains the layout/delegated-listener host and exposes no
 * composite-grid role, tabindex, or `aria-activedescendant`. Auxiliary layers
 * (pagination, overlay, floating popups, status region) stay outside the
 * surface. These are integration tests over a mounted grid.
 */

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

function pointerDown(el: Element): void {
  el.dispatchEvent(
    new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
  );
}

const containers: HTMLDivElement[] = [];
const grids: Grid[] = [];

function mountGrid(props: ConstructorParameters<typeof Grid>[0]): {
  container: HTMLDivElement;
  grid: Grid;
} {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "260px", width: "480px" });
  document.body.appendChild(container);
  const grid = new Grid(props);
  grid.mount(container);
  containers.push(container);
  grids.push(grid);
  return { container, grid };
}

const ROWS: RowData[] = Array.from({ length: 6 }, (_, index) => ({
  id: `r${index}`,
  a: `A${index}`,
  b: `B${index}`,
}));

describe("Accessibility V2 Stage F16A — neutral semantic surface", () => {
  afterEach(() => {
    while (grids.length > 0) grids.pop()?.destroy();
    while (containers.length > 0) containers.pop()?.remove();
  });

  it("113: exactly one surface wraps the viewport; only the surface owns role=grid and tabindex=0", async () => {
    const { container } = mountGrid({
      rows: ROWS,
      columns: [{ field: "a" }, { field: "b" }],
      getRowId: (row) => String(row.id),
    });
    await flushRenders();

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const surfaces = root.querySelectorAll(".lfg-grid-surface");
    expect(surfaces.length).toBe(1);
    const surface = surfaces[0] as HTMLElement;
    const viewport = root.querySelector<HTMLElement>(".lfg-viewport")!;

    // Surface directly wraps the viewport, and sits directly under the root.
    expect(viewport.parentElement).toBe(surface);
    expect(surface.parentElement).toBe(root);

    // Composite grid role + base focusability live only on the surface.
    expect(surface.getAttribute("role")).toBe("grid");
    expect(surface.tabIndex).toBe(0);

    // The outer root exposes neither.
    expect(root.getAttribute("role")).toBeNull();
    expect(root.hasAttribute("tabindex")).toBe(false);
    expect(root.hasAttribute("aria-rowcount")).toBe(false);
  });

  it("114: auxiliary layers and owner controls stay outside the surface; header/body rows stay inside", async () => {
    const { container, grid } = mountGrid({
      rows: ROWS,
      columns: [{ field: "a", sortable: true }, { field: "b" }],
      getRowId: (row) => String(row.id),
      pagination: true,
    });
    await flushRenders();

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const surface = container.querySelector<HTMLElement>(".lfg-grid-surface")!;

    // Header and body rows are composite descendants inside the surface.
    const header = surface.querySelector(".lfg-header");
    const bodyRow = surface.querySelector(".lfg-row");
    expect(header).not.toBeNull();
    expect(bodyRow).not.toBeNull();

    // Pagination is a root child, outside the surface.
    const pagination = root.querySelector(".lfg-pagination");
    expect(pagination).not.toBeNull();
    expect(surface.contains(pagination)).toBe(false);
    const paginationControls = pagination!.querySelectorAll("button, select");
    expect(paginationControls.length).toBeGreaterThan(0);
    for (let index = 0; index < paginationControls.length; index += 1) {
      expect(surface.contains(paginationControls[index]!)).toBe(false);
    }

    // The status region is a sibling of the outer root, outside both.
    const status = container.querySelector(".lfg-a11y-status");
    expect(status).not.toBeNull();
    expect(root.contains(status)).toBe(false);
    expect(surface.contains(status)).toBe(false);

    // The overlay layer is a root child, outside the surface.
    grid.setLoading(true);
    await flushRenders();
    const overlay = root.querySelector(".lfg-overlay-layer");
    expect(overlay).not.toBeNull();
    expect(surface.contains(overlay)).toBe(false);

    // A real owner-local popup is appended to the outer root, never the
    // composite surface.
    const menuTrigger = surface.querySelector<HTMLElement>(
      ".lfg-column-menu-trigger[data-col-id='a']",
    )!;
    menuTrigger.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    const floatingLayer = root.querySelector(".lfg-floating-layer");
    expect(floatingLayer).not.toBeNull();
    expect(floatingLayer!.parentElement).toBe(root);
    expect(surface.contains(floatingLayer)).toBe(false);
  });

  it("115: listeners stay delegated on the root while pointer focus and aria-activedescendant target the surface", async () => {
    const { container, grid } = mountGrid({
      rows: ROWS,
      columns: [{ field: "a" }, { field: "b" }],
      getRowId: (row) => String(row.id),
      rowSelection: "single",
    });
    await flushRenders();

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const surface = container.querySelector<HTMLElement>(".lfg-grid-surface")!;
    const cell = root.querySelector<HTMLElement>(
      ".lfg-row .lfg-cell[data-col-id='a']",
    )!;

    // Pointer interaction (delegated pointerdown on root) focuses the surface.
    pointerDown(cell);
    expect(document.activeElement).toBe(surface);

    // aria-activedescendant is owned by the surface, never the outer root.
    grid.setFocusedCell({ rowIndex: 0, field: "a" });
    await flushRenders();
    const activeId = surface.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(activeId).toBe(cell.id);
    expect(root.hasAttribute("aria-activedescendant")).toBe(false);

    // Focus-visual class is unchanged (owned by the focus feature on the cell).
    expect(cell.classList.contains("lfg-cell-focused")).toBe(true);

    // Keyboard intent stays delegated on the root: Escape (bubbling from the
    // surface) clears selection.
    grid.setSelectedRowIds(["r0"]);
    expect(grid.getSelectedRowIds()).toEqual(["r0"]);
    surface.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(grid.getSelectedRowIds()).toEqual([]);
  });

  it("116: detach clears only plugin-owned surface attributes, preserves base focusability, suppresses stale work, and remount re-applies", async () => {
    const { container, grid } = mountGrid({
      rows: ROWS,
      columns: [{ field: "a" }, { field: "b" }],
      getRowId: (row) => String(row.id),
    });
    await flushRenders();

    const surface = container.querySelector<HTMLElement>(".lfg-grid-surface")!;
    const viewport = container.querySelector<HTMLElement>(".lfg-viewport")!;
    expect(surface.getAttribute("role")).toBe("grid");
    expect(surface.hasAttribute("aria-rowcount")).toBe(true);
    expect(surface.tabIndex).toBe(0);

    grid.destroy();
    grids.pop(); // already destroyed

    // Plugin-owned composite attributes are cleared on detach…
    expect(surface.getAttribute("role")).toBeNull();
    expect(surface.hasAttribute("aria-rowcount")).toBe(false);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    // …while base focusability (skeleton-owned tabindex) and the surface/viewport
    // hierarchy are preserved.
    expect(surface.tabIndex).toBe(0);
    expect(viewport.parentElement).toBe(surface);
    expect(surface.className).toBe("lfg-grid-surface");
    expect(viewport.className).toBe("lfg-viewport");

    // Stale scheduled work is inert: a post-detach scroll neither throws nor
    // re-applies composite attributes.
    expect(() => {
      viewport.dispatchEvent(new Event("scroll"));
    }).not.toThrow();
    await flushRenders();
    expect(surface.getAttribute("role")).toBeNull();

    // Remounting a fresh grid re-establishes the surface ownership.
    const remounted = mountGrid({
      rows: ROWS,
      columns: [{ field: "a" }, { field: "b" }],
      getRowId: (row) => String(row.id),
    });
    await flushRenders();
    const surface2 = remounted.container.querySelector<HTMLElement>(
      ".lfg-grid-surface",
    )!;
    expect(surface2.getAttribute("role")).toBe("grid");
    expect(surface2.tabIndex).toBe(0);
  });
});
