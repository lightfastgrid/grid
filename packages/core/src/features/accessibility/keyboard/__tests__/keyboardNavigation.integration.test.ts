// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { Grid } from "../../../../Grid";
import type {
  LightFastGridColumnInput,
  LightFastGridProps,
  RowData,
} from "../../../../types";
import { GROUP_HEADER_SPAN_CLASS } from "../../../column-groups";

const ROWS: RowData[] = [
  { id: "r0", name: "Alice", email: "a@example.com", bank: 10, rating: 5 },
  { id: "r1", name: "Bob", email: "b@example.com", bank: 20, rating: 4 },
];

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

async function flushRendererFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function createGrid(props: Partial<LightFastGridProps> = {}) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "400px", width: "800px" });
  document.body.appendChild(container);
  const grid = new Grid({
    columns: [
      {
        headerName: "Profile",
        children: [
          { field: "name", headerName: "Name" },
          { field: "email", headerName: "Email" },
        ],
      },
      {
        headerName: "Finance",
        children: [
          { field: "bank", headerName: "Bank" },
          { field: "rating", headerName: "Rating" },
        ],
      },
    ],
    rows: ROWS,
    getRowId: (row) => String(row.id),
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    ...props,
  });
  grid.mount(container);
  await flushRenders();
  const surface = container.querySelector<HTMLElement>(".lfg-grid-surface")!;
  return { grid, container, surface };
}

function press(surface: HTMLElement, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  surface.dispatchEvent(event);
  return event.defaultPrevented;
}

function activeElement(surface: HTMLElement): HTMLElement | null {
  const id = surface.getAttribute("aria-activedescendant");
  return id === null ? null : document.getElementById(id);
}

describe("Accessibility V2 keyboard navigation takeover", () => {
  it("222: rebuilds keyboard topology when columns arrive after an empty mount", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);
    const grid = new Grid({
      columns: [],
      rows: [],
      loading: true,
      getRowId: (row) => String(row.id),
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    grid.setColumns([
      { field: "id", pinned: "left" },
      { field: "name", pinned: "left" },
      { field: "status" },
      { field: "country" },
    ]);
    grid.setRows([{ id: "r0", name: "Alice", status: "Active", country: "US" }]);
    grid.setLoading(false);
    await flushRenders();

    const surface = container.querySelector<HTMLElement>(".lfg-grid-surface")!;
    const nameCell = container.querySelector<HTMLElement>(
      '[data-row-id="r0"] .lfg-cell[data-col-id="name"]',
    )!;
    nameCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(grid.getFocusedCell()).toMatchObject({ field: "name", rowIndex: 0 });
    expect(press(surface, "ArrowRight")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ field: "status", rowIndex: 0 });

    grid.destroy();
    container.remove();
  });

  it("210-211: first Tab-stop focus initializes the body target and boundary arrows never scroll", async () => {
    const { grid, container, surface } = await createGrid({
      columns: [
        { field: "name", headerName: "Name" },
        { field: "email", headerName: "Email" },
      ],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
      },
    });

    expect(surface.getAttribute("aria-activedescendant")).toBeNull();
    surface.focus();
    expect(document.activeElement).toBe(surface);
    expect(activeElement(surface)).toMatchObject({
      dataset: expect.objectContaining({ colId: "name" }),
    });
    expect(grid.getFocusedCell()).toMatchObject({
      rowId: "r0",
      field: "name",
      rowIndex: 0,
    });

    expect(press(surface, "ArrowLeft")).toBe(true);
    expect(activeElement(surface)?.getAttribute("data-col-id")).toBe("name");
    expect(press(surface, "ArrowRight")).toBe(true);
    expect(activeElement(surface)?.getAttribute("data-col-id")).toBe("email");
    expect(press(surface, "ArrowDown")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({
      rowId: "r1",
      field: "email",
      rowIndex: 1,
    });
    expect(press(surface, "ArrowDown")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({
      rowId: "r1",
      field: "email",
      rowIndex: 1,
    });
    expect(press(surface, "Tab")).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("152-153: traverses retained group, leaf, and body targets with one surface owner", async () => {
    const { grid, container, surface } = await createGrid();
    const groups = Array.from(
      container.querySelectorAll<HTMLElement>(`.${GROUP_HEADER_SPAN_CLASS}`),
    );
    const profile = groups.find((element) => element.textContent.trim() === "Profile")!;
    profile.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(activeElement(surface)).toBe(profile);
    expect(profile.classList.contains("lfg-a11y-active-target")).toBe(true);

    expect(press(surface, "ArrowRight")).toBe(true);
    expect(activeElement(surface)?.textContent.trim()).toBe("Finance");
    expect(profile.classList.contains("lfg-a11y-active-target")).toBe(false);
    expect(
      activeElement(surface)?.classList.contains("lfg-a11y-active-target"),
    ).toBe(true);

    expect(press(surface, "ArrowDown")).toBe(true);
    expect(
      activeElement(surface)?.querySelector(".lfg-header-label")?.textContent.trim(),
    ).toBe("Bank");

    expect(press(surface, "ArrowDown")).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({
      rowId: "r0",
      field: "bank",
      rowIndex: 0,
    });
    expect(activeElement(surface)?.getAttribute("role")).toBe("gridcell");
    expect(
      activeElement(surface)?.classList.contains("lfg-a11y-active-target"),
    ).toBe(true);
    await flushRenders();
    const focusedBodyCell = activeElement(surface)!;
    expect(focusedBodyCell.classList.contains("lfg-cell-focused")).toBe(true);

    expect(press(surface, "ArrowUp")).toBe(true);
    expect(activeElement(surface)?.getAttribute("role")).toBe("columnheader");
    expect(focusedBodyCell.classList.contains("lfg-cell-focused")).toBe(true);
    expect(
      container.querySelectorAll(".lfg-a11y-active-target"),
    ).toHaveLength(1);

    grid.destroy();
    expect(
      container.querySelector(".lfg-a11y-active-target"),
    ).toBeNull();
    container.remove();
  });

  it("154: publishes a horizontally resolved leaf target without a DOM query on keydown", async () => {
    const { grid, container, surface } = await createGrid();
    const bank = Array.from(
      container.querySelectorAll<HTMLElement>(".lfg-header-cell"),
    ).find((element) => element.getAttribute("data-col-id") === "bank")!;
    bank.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(activeElement(surface)).toBe(bank);
    expect(press(surface, "ArrowLeft")).toBe(true);
    expect(activeElement(surface)?.getAttribute("data-col-id")).toBe("email");

    grid.destroy();
    container.remove();
  });

  it("184: pointer body and floating-filter hits synchronize the retained target", async () => {
    const { grid, container, surface } = await createGrid({
      columns: [
        { field: "name", filterable: true },
        { field: "email", filterable: true },
      ],
      floatingFilters: true,
    });
    const focusSpy = vi.spyOn(surface, "focus");
    const body = container.querySelector<HTMLElement>(
      '.lfg-cell[data-col-id="name"]',
    )!;
    const bodyPointerDown = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    body.dispatchEvent(bodyPointerDown);
    expect(bodyPointerDown.defaultPrevented).toBe(true);
    expect(focusSpy).toHaveBeenCalledWith(
      expect.objectContaining({ preventScroll: true, focusVisible: false }),
    );
    body.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(document.activeElement).toBe(surface);
    expect(activeElement(surface)).toBe(body);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r0", field: "name" });

    expect(press(surface, "ArrowRight")).toBe(true);
    await Promise.resolve();
    const email = container.querySelector<HTMLElement>(
      '[data-row-id="r0"] .lfg-cell[data-col-id="email"]',
    )!;
    expect(activeElement(surface)).toBe(email);
    expect(email.classList.contains("lfg-cell-focused")).toBe(true);
    expect(email.classList.contains("lfg-a11y-active-target")).toBe(true);
    expect(container.querySelectorAll(".lfg-cell-focused")).toHaveLength(1);
    expect(container.querySelectorAll(".lfg-a11y-active-target")).toHaveLength(1);
    expect(focusSpy).toHaveBeenCalledWith(
      expect.objectContaining({ preventScroll: true, focusVisible: true }),
    );

    const filter = container.querySelector<HTMLElement>(
      '.lfg-floating-filter-cell[data-col-id="email"]',
    )!;
    filter.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(activeElement(surface)).toBe(filter);
    expect(activeElement(surface)?.getAttribute("role")).toBe("gridcell");

    grid.destroy();
    container.remove();
  });

  it("pointer header hits retain the target without forcing a keyboard ring", async () => {
    const { grid, container, surface } = await createGrid({
      columns: [
        { field: "name", headerName: "Name" },
        { field: "email", headerName: "Email" },
      ],
    });
    const header = container.querySelector<HTMLElement>(
      '.lfg-header-cell[data-col-id="name"]',
    )!;
    const focusSpy = vi.spyOn(surface, "focus");
    const pointerDown = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    header.dispatchEvent(pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(surface);
    expect(activeElement(surface)).toBe(header);
    expect(header.classList.contains("lfg-a11y-active-target")).toBe(true);
    expect(surface.classList.contains("lfg-keyboard-focus")).toBe(false);
    expect(focusSpy).toHaveBeenCalledWith(
      expect.objectContaining({ preventScroll: true, focusVisible: false }),
    );

    expect(press(surface, "ArrowRight")).toBe(true);
    expect(activeElement(surface)?.getAttribute("data-col-id")).toBe("email");
    expect(surface.classList.contains("lfg-keyboard-focus")).toBe(true);
    expect(focusSpy).toHaveBeenCalledWith(
      expect.objectContaining({ preventScroll: true, focusVisible: true }),
    );

    grid.destroy();
    container.remove();
  });

  it("pointer body then ArrowUp moves the visible target into the header", async () => {
    const { grid, container, surface } = await createGrid({
      columns: [
        { field: "name", headerName: "Name" },
        { field: "email", headerName: "Email" },
      ],
    });
    const body = container.querySelector<HTMLElement>(
      '[data-row-id="r0"] .lfg-cell[data-col-id="name"]',
    )!;
    body.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
    body.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(document.activeElement).toBe(surface);
    expect(activeElement(surface)).toBe(body);
    expect(surface.classList.contains("lfg-keyboard-focus")).toBe(false);

    expect(press(surface, "ArrowUp")).toBe(true);
    const header = activeElement(surface)!;
    expect(header.getAttribute("role")).toBe("columnheader");
    expect(header.getAttribute("data-col-id")).toBe("name");
    expect(header.classList.contains("lfg-a11y-active-target")).toBe(true);
    expect(surface.classList.contains("lfg-keyboard-focus")).toBe(true);
    expect(body.classList.contains("lfg-a11y-active-target")).toBe(false);
    expect(body.classList.contains("lfg-cell-focused")).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("215-216: vertical recycling hides an off-screen target and restores its exact row", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `r${index}`,
      name: `Row ${index}`,
    }));
    const focusEvents: unknown[] = [];
    const container = document.createElement("div");
    Object.assign(container.style, { height: "160px", width: "320px" });
    document.body.appendChild(container);
    const grid = new Grid({
      columns: [{ field: "name" }],
      rows,
      getRowId: (row) => String(row.id),
      onFocusedCellChanged: (event) => focusEvents.push(event),
    });
    grid.mount(container);
    const viewport = container.querySelector<HTMLElement>(".lfg-viewport")!;
    Object.defineProperty(viewport, "clientWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 160,
    });
    grid.setRows([...rows]);
    await flushRenders();
    const surface = container.querySelector<HTMLElement>(".lfg-grid-surface")!;

    surface.focus();
    await Promise.resolve();
    const original = activeElement(surface)!;
    expect(original.closest("[data-row-index]")?.getAttribute("data-row-index")).toBe(
      "0",
    );
    expect(original.classList.contains("lfg-cell-focused")).toBe(true);
    expect(focusEvents).toHaveLength(1);

    viewport.scrollTop = 1_600;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRendererFrame();

    expect(grid.getFocusedCell()).toMatchObject({
      rowId: "r0",
      rowIndex: 0,
      field: "name",
    });
    expect(focusEvents).toHaveLength(1);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(container.querySelectorAll(".lfg-a11y-active-target")).toHaveLength(0);
    expect(container.querySelectorAll(".lfg-cell-focused")).toHaveLength(0);

    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    const restored = activeElement(surface)!;
    expect(restored.getAttribute("data-col-id")).toBe("name");
    expect(restored.closest("[data-row-index]")?.getAttribute("data-row-index")).toBe(
      "0",
    );
    expect(restored.classList.contains("lfg-a11y-active-target")).toBe(true);
    expect(restored.classList.contains("lfg-cell-focused")).toBe(true);
    expect(focusEvents).toHaveLength(1);

    grid.destroy();
    container.remove();
  });

  it("216: retained body focus follows its stable row identity after sorting", async () => {
    const focusEvents: unknown[] = [];
    const { grid, container, surface } = await createGrid({
      columns: [{ field: "name", sortable: true }],
      rows: [
        { id: "r0", name: "Zulu" },
        { id: "r1", name: "Alpha" },
      ],
      onFocusedCellChanged: (event) => focusEvents.push(event),
    });

    surface.focus();
    await Promise.resolve();
    expect(grid.getFocusedCell()).toMatchObject({
      rowId: "r0",
      rowIndex: 0,
      field: "name",
    });
    expect(focusEvents).toHaveLength(1);

    grid.setSortModel([{ field: "name", sort: "asc" }]);
    await flushRenders();

    expect(grid.getFocusedCell()).toMatchObject({
      rowId: "r0",
      rowIndex: 1,
      field: "name",
    });
    expect(activeElement(surface)?.closest("[data-row-id]")?.getAttribute(
      "data-row-id",
    )).toBe("r0");
    expect(activeElement(surface)?.closest("[data-row-index]")?.getAttribute(
      "data-row-index",
    )).toBe("1");
    expect(focusEvents).toHaveLength(1);

    grid.destroy();
    container.remove();
  });

  it("216: an off-screen body target follows its stable row identity after sorting", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `r${index}`,
      score: 100 - index,
    }));
    const focusEvents: unknown[] = [];
    const container = document.createElement("div");
    Object.assign(container.style, { height: "160px", width: "320px" });
    document.body.appendChild(container);
    const grid = new Grid({
      columns: [{ field: "score", sortable: true }],
      rows,
      getRowId: (row) => String(row.id),
      onFocusedCellChanged: (event) => focusEvents.push(event),
    });
    grid.mount(container);
    const viewport = container.querySelector<HTMLElement>(".lfg-viewport")!;
    Object.defineProperty(viewport, "clientWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 160,
    });
    grid.setRows([...rows]);
    await flushRenders();
    const surface = container.querySelector<HTMLElement>(".lfg-grid-surface")!;
    surface.focus();
    await Promise.resolve();

    viewport.scrollTop = 1_600;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRendererFrame();
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);

    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();
    expect(grid.getFocusedCell()).toMatchObject({
      rowId: "r0",
      rowIndex: 99,
      field: "score",
    });
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(focusEvents).toHaveLength(1);

    viewport.scrollTop = 3_960;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    expect(activeElement(surface)?.closest("[data-row-id]")?.getAttribute(
      "data-row-id",
    )).toBe("r0");
    expect(activeElement(surface)?.closest("[data-row-index]")?.getAttribute(
      "data-row-index",
    )).toBe("99");
    expect(focusEvents).toHaveLength(1);

    grid.destroy();
    container.remove();
  });

  it("217: horizontal recycling never transfers body or header targets to edge columns", async () => {
    const columns: LightFastGridColumnInput[] = Array.from(
      { length: 4 },
      (_, groupIndex) => ({
        headerName: `Group ${groupIndex}`,
        children: Array.from({ length: 3 }, (_, childIndex) => {
          const index = groupIndex * 3 + childIndex;
          return {
            field: `c${index}`,
            headerName: `Column ${index}`,
            width: 150,
            filterable: true,
          };
        }),
      }),
    );
    const container = document.createElement("div");
    Object.assign(container.style, { height: "300px", width: "320px" });
    document.body.appendChild(container);
    const grid = new Grid({
      columns,
      rows: [{ id: "r0", c0: "zero" }],
      getRowId: (row) => String(row.id),
      floatingFilters: true,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    const viewport = container.querySelector<HTMLElement>(".lfg-viewport")!;
    Object.defineProperty(viewport, "clientWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 300,
    });
    grid.setColumns([...columns]);
    await flushRenders();
    const surface = container.querySelector<HTMLElement>(".lfg-grid-surface")!;
    const initialBodyCellCount = container.querySelectorAll(".lfg-cell").length;
    const initialHeaderCellCount =
      container.querySelectorAll(".lfg-header-cell").length;

    const cases: Array<{
      name: string;
      retainedOffscreen?: boolean;
      target: () => HTMLElement;
      restored: () => HTMLElement;
    }> = [
      {
        name: "body",
        target: () =>
          container.querySelector<HTMLElement>(
            '[data-row-id="r0"] .lfg-cell[data-col-id="c0"]',
          )!,
        restored: () =>
          container.querySelector<HTMLElement>(
            '[data-row-id="r0"] .lfg-cell[data-col-id="c0"]',
          )!,
      },
      {
        name: "leaf header",
        target: () =>
          container.querySelector<HTMLElement>(
            '.lfg-header-cell[data-col-id="c0"]',
          )!,
        restored: () =>
          container.querySelector<HTMLElement>(
            '.lfg-header-cell[data-col-id="c0"]',
          )!,
      },
      {
        name: "floating filter",
        retainedOffscreen: true,
        target: () =>
          container.querySelector<HTMLElement>(
            '.lfg-floating-filter-cell[data-col-id="c0"]',
          )!,
        restored: () =>
          container.querySelector<HTMLElement>(
            '.lfg-floating-filter-cell[data-col-id="c0"]',
          )!,
      },
      {
        name: "group header",
        target: () =>
          Array.from(
            container.querySelectorAll<HTMLElement>(
              `.${GROUP_HEADER_SPAN_CLASS}`,
            ),
          ).find((element) => element.textContent.trim() === "Group 0")!,
        restored: () =>
          Array.from(
            container.querySelectorAll<HTMLElement>(
              `.${GROUP_HEADER_SPAN_CLASS}`,
            ),
          ).find((element) => element.textContent.trim() === "Group 0")!,
      },
    ];

    for (const testCase of cases) {
      const target = testCase.target();
      target.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      expect(activeElement(surface)).toBe(target);

      viewport.scrollLeft = 1_200;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRendererFrame();

      if (testCase.retainedOffscreen) {
        expect(activeElement(surface), testCase.name).toBe(target);
        expect(
          container.querySelectorAll(".lfg-a11y-active-target"),
        ).toHaveLength(1);
      } else {
        expect(
          surface.hasAttribute("aria-activedescendant"),
          testCase.name,
        ).toBe(false);
        expect(
          container.querySelectorAll(".lfg-a11y-active-target"),
        ).toHaveLength(0);
      }

      viewport.scrollLeft = 0;
      viewport.dispatchEvent(new Event("scroll"));
      await flushRenders();

      expect(activeElement(surface)).toBe(testCase.restored());
      expect(container.querySelectorAll(".lfg-a11y-active-target")).toHaveLength(
        1,
      );
    }

    expect(container.querySelectorAll(".lfg-cell")).toHaveLength(
      initialBodyCellCount,
    );
    expect(container.querySelectorAll(".lfg-header-cell")).toHaveLength(
      initialHeaderCellCount,
    );

    grid.destroy();
    container.remove();
  });
});
