// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { CSS } from "../../../rendering/const/css-classes";
import { queryCenterPoolRows } from "../../../rendering/helpers/dom/centerPoolRows";
import { ROW_HEIGHT } from "../../../rendering/helpers/gridConstants";
import type { LightFastGridProps } from "../../../types";

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

function idForField(root: HTMLElement, rowId: string, field: string): string {
  const cells = root.querySelectorAll<HTMLElement>(
    `.lfg-cell[data-row-id="${rowId}"][data-col-id="${field}"],` +
      `[data-row-id="${rowId}"] .lfg-cell[data-col-id="${field}"]`,
  );
  expect(cells.length).toBeGreaterThan(0);
  const id = Array.from(cells).find((cell) => cell.id.length > 0)?.id;
  expect(id).toBeTruthy();
  return id!;
}

describe("Accessibility V2 Section 7 mounted pinned-lane ownership", () => {
  let grid: Grid | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    grid?.destroy();
    container?.remove();
    grid = null;
    container = null;
  });

  async function mount(props: LightFastGridProps): Promise<HTMLElement> {
    container = document.createElement("div");
    Object.assign(container.style, { height: "220px", width: "420px" });
    document.body.appendChild(container);
    grid = new Grid(props);
    grid.mount(container);
    await flushRenders();
    await flushRenders();
    return container.querySelector<HTMLElement>(`.${CSS.GRID}`)!;
  }

  it("stitches normal pinned lanes into one canonical row", async () => {
    const root = await mount({
      rows: [{ id: "r0", left: "L", a: "A", b: "B", right: "R" }],
      columns: [
        { field: "a" },
        { field: "right", pinned: "right" },
        { field: "left", pinned: "left" },
        { field: "b" },
      ],
      getRowId: (row) => row.id,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    const scrollContainer = root.querySelector<HTMLElement>(
      `.${CSS.SCROLL_CONTAINER}`,
    )!;
    const owner = queryCenterPoolRows(scrollContainer).find(
      (candidate) => candidate.getAttribute("data-row-id") === "r0",
    )!;
    const leftWrapper = root.querySelector<HTMLElement>(
      `.lfg-pinned-row[data-row-id="r0"]`,
    )!;
    const rightWrapper = root.querySelector<HTMLElement>(
      `.lfg-pinned-right-row[data-row-id="r0"]`,
    )!;

    expect(owner.getAttribute("role")).toBe("row");
    expect(leftWrapper.getAttribute("role")).toBe("presentation");
    expect(rightWrapper.getAttribute("role")).toBe("presentation");
    expect(owner.getAttribute("aria-owns")?.split(" ")).toEqual([
      idForField(root, "r0", "left"),
      idForField(root, "r0", "a"),
      idForField(root, "r0", "b"),
      idForField(root, "r0", "right"),
    ]);
  });

  it("keeps the center row canonical when every visible column is pinned", async () => {
    const root = await mount({
      rows: [{ id: "r0", left: "L", right: "R" }],
      columns: [
        { field: "right", pinned: "right" },
        { field: "left", pinned: "left" },
      ],
      getRowId: (row) => row.id,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    const scrollContainer = root.querySelector<HTMLElement>(
      `.${CSS.SCROLL_CONTAINER}`,
    )!;
    const owner = queryCenterPoolRows(scrollContainer).find(
      (candidate) => candidate.getAttribute("data-row-id") === "r0",
    )!;

    expect(owner.getAttribute("role")).toBe("row");
    expect(owner.querySelectorAll('[role="gridcell"]')).toHaveLength(0);
    expect(owner.getAttribute("aria-owns")?.split(" ")).toEqual([
      idForField(root, "r0", "left"),
      idForField(root, "r0", "right"),
    ]);
  });

  it("stitches top and bottom row-pinned sub-lanes without pre-settle writes", async () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({
      id: `r${index}`,
      left: `L${index}`,
      value: `V${index}`,
      right: `R${index}`,
    }));
    const root = await mount({
      rows,
      columns: [
        { field: "left", pinned: "left" },
        { field: "value" },
        { field: "right", pinned: "right" },
      ],
      getRowId: (row) => row.id,
      rowPinning: { top: ["r0"], bottom: ["r79"] },
    });

    const topOwner = root.querySelector<HTMLElement>(
      ".lfg-row-pinned-top-layer .lfg-row[data-row-id='r0']",
    )!;
    const topLeft = root.querySelector<HTMLElement>(
      ".lfg-row-pinned-top-left-layer .lfg-row[data-row-id='r0']",
    )!;
    const topRight = root.querySelector<HTMLElement>(
      ".lfg-row-pinned-top-right-layer .lfg-row[data-row-id='r0']",
    )!;
    const bottomOwner = root.querySelector<HTMLElement>(
      ".lfg-row-pinned-bottom-layer .lfg-row[data-row-id='r79']",
    )!;

    expect(topOwner.getAttribute("role")).toBe("row");
    expect(topLeft.getAttribute("role")).toBe("presentation");
    expect(topRight.getAttribute("role")).toBe("presentation");
    expect(topOwner.getAttribute("aria-owns")?.split(" ")).toEqual([
      idForField(root, "r0", "left"),
      idForField(root, "r0", "value"),
      idForField(root, "r0", "right"),
    ]);
    expect(bottomOwner.getAttribute("aria-owns")?.split(" ")).toEqual([
      idForField(root, "r79", "left"),
      idForField(root, "r79", "value"),
      idForField(root, "r79", "right"),
    ]);

    const viewport = root.querySelector<HTMLElement>(`.${CSS.VIEWPORT}`)!;
    const setAttribute = vi.spyOn(topOwner, "setAttribute");
    const removeAttribute = vi.spyOn(topOwner, "removeAttribute");
    viewport.scrollTop = 25 * ROW_HEIGHT;
    for (let index = 0; index < 2_000; index += 1) {
      viewport.dispatchEvent(new Event("scroll"));
    }
    expect(setAttribute).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();

    await flushRenders();
    await flushRenders();
    expect(setAttribute).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();
  });

  it("keeps horizontal recycle inert until settle and publishes global order", async () => {
    const row = { id: "r0", left: "L", right: "R" } as Record<
      string,
      string
    >;
    const columns: LightFastGridProps["columns"] = [
      { field: "left", pinned: "left" },
    ];
    for (let index = 0; index < 40; index += 1) {
      const field = `c${index}`;
      row[field] = field;
      columns.push({ field, width: 120 });
    }
    columns.push({ field: "right", pinned: "right" });
    const root = await mount({
      rows: [row],
      columns,
      getRowId: (candidate) => candidate.id,
      suppressRowVirtualization: true,
    });
    const scrollContainer = root.querySelector<HTMLElement>(
      `.${CSS.SCROLL_CONTAINER}`,
    )!;
    const owner = queryCenterPoolRows(scrollContainer).find(
      (candidate) => candidate.getAttribute("data-row-id") === "r0",
    )!;
    const viewport = root.querySelector<HTMLElement>(`.${CSS.VIEWPORT}`)!;
    const before = owner.getAttribute("aria-owns");
    const setAttribute = vi.spyOn(owner, "setAttribute");

    viewport.scrollLeft = 2_400;
    viewport.dispatchEvent(new Event("scroll"));
    expect(owner.getAttribute("aria-owns")).toBe(before);
    expect(setAttribute).not.toHaveBeenCalled();

    await flushRenders();
    await flushRenders();
    const after = owner.getAttribute("aria-owns");
    const afterIds = after!.split(" ");
    const ownershipWrites = setAttribute.mock.calls.filter(
      ([attribute]) => attribute === "aria-owns",
    );
    expect(ownershipWrites).toHaveLength(after === before ? 0 : 1);
    const indexes = afterIds.map((id) =>
      Number(document.getElementById(id)!.getAttribute("aria-colindex")),
    );
    for (let index = 1; index < indexes.length; index += 1) {
      expect(indexes[index]).toBeGreaterThan(indexes[index - 1]!);
    }
  });
});
