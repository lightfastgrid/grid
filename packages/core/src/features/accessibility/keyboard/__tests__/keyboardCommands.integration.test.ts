// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { Grid } from "../../../../Grid";
import type { LightFastGridProps, RowData } from "../../../../types";

const ROWS: RowData[] = [
  { id: "r0", name: "Alice", age: 30, active: true },
  { id: "r1", name: "Bob", age: 20, active: false },
  { id: "r2", name: "Cara", age: 40, active: true },
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
  Object.assign(container.style, { width: "700px", height: "400px" });
  document.body.appendChild(container);
  const grid = new Grid({
    columns: [
      { field: "name", sortable: true, editable: true },
      { field: "age", sortable: true, editable: true },
      {
        field: "active",
        editable: true,
        editor: "checkbox",
        cellShell: "checkbox",
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
  return {
    grid,
    container,
    surface: container.querySelector<HTMLElement>(".lfg-grid-surface")!,
  };
}

function press(
  target: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function pointerDown(target: HTMLElement): void {
  target.dispatchEvent(new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
  }));
}

function pointerMove(target: HTMLElement): void {
  target.dispatchEvent(new PointerEvent("pointermove", {
    bubbles: true,
    cancelable: true,
  }));
}

describe("Accessibility V2 K5 grid integration", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("158-161: real row and column owners apply deferred scalar commands", async () => {
    const { grid, surface } = await createGrid({
      rowSelection: { mode: "multiple" },
      columnSelection: true,
    });
    grid.setFocusedCell({ rowIndex: 0, field: "name" }, "keyboard");

    expect(press(surface, " ").defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(grid.getSelectedRowIds()).toEqual(["r0"]);

    expect(press(surface, " ", { ctrlKey: true }).defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(grid.getSelectedColumnIds()).toEqual(["name"]);

    expect(press(surface, "Home", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press(surface, " ", { ctrlKey: true }).defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(grid.getSelectedColumnIds()).toEqual([]);

    expect(press(surface, "ArrowDown").defaultPrevented).toBe(true);

    expect(press(surface, " ", { shiftKey: true }).defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(grid.getSelectedRowIds()).toEqual(["r0"]);
    expect(press(surface, "ArrowDown", { shiftKey: true }).defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(grid.getSelectedRowIds()).toEqual(["r0", "r1"]);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r1", field: "name" });

    expect(press(surface, "a", { metaKey: true }).defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(grid.getSelectedRowIds()).toEqual(["r0", "r1", "r2"]);
    grid.destroy();
  });

  it("161 regression: arrow navigation advances a clicked selected header before additive selection", async () => {
    const { grid, container, surface } = await createGrid({
      columnSelection: { mode: "multiple" },
    });
    const nameHeader = container.querySelector<HTMLElement>(
      '.lfg-header-cell[data-col-id="name"]',
    )!;

    pointerDown(nameHeader);
    nameHeader.click();
    await flushRenders();

    expect(document.activeElement).toBe(surface);
    expect(grid.getSelectedColumnIds()).toEqual(["name"]);
    expect(
      document
        .getElementById(surface.getAttribute("aria-activedescendant") ?? "")
        ?.getAttribute("data-col-id"),
    ).toBe("name");

    expect(
      press(surface, "ArrowRight", { metaKey: true }).defaultPrevented,
    ).toBe(false);
    expect(
      document
        .getElementById(surface.getAttribute("aria-activedescendant") ?? "")
        ?.getAttribute("data-col-id"),
    ).toBe("name");

    expect(press(surface, "ArrowRight").defaultPrevented).toBe(true);
    expect(
      document
        .getElementById(surface.getAttribute("aria-activedescendant") ?? "")
        ?.getAttribute("data-col-id"),
    ).toBe("age");
    expect(grid.getSelectedColumnIds()).toEqual(["name"]);

    expect(press(surface, " ", { metaKey: true }).defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(grid.getSelectedColumnIds()).toEqual(["name", "age"]);
    grid.destroy();
  });

  it("163-166: real editor validation and Tab restore the retained grid target", async () => {
    const { grid, container, surface } = await createGrid({
      columns: [
        {
          field: "name",
          editable: true,
          editor: { type: "text", required: true },
        },
        { field: "age", editable: true },
      ],
    });
    grid.setFocusedCell({ rowIndex: 0, field: "name" }, "keyboard");

    expect(press(surface, "Enter").defaultPrevented).toBe(true);
    const editor = container.querySelector<HTMLInputElement>(
      ".lfg-cell-editor-host input",
    )!;
    expect(document.activeElement).toBe(editor);
    editor.value = "";
    expect(press(editor, "Enter").defaultPrevented).toBe(true);
    expect(editor.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(editor);

    editor.value = "Alicia";
    expect(press(editor, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(surface);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r0", field: "age" });
    const activeId = surface.getAttribute("aria-activedescendant");
    expect(document.getElementById(activeId ?? "")?.getAttribute("data-col-id")).toBe(
      "age",
    );
    grid.destroy();
  });

  it("167-170: checkbox widget entry uses the retained native control", async () => {
    const { grid, container, surface } = await createGrid();
    grid.setFocusedCell({ rowIndex: 0, field: "active" }, "keyboard");

    expect(press(surface, "Enter").defaultPrevented).toBe(true);
    const checkbox = container.querySelector<HTMLInputElement>(
      '[data-row-id="r0"] [data-col-id="active"] .lfg-cell-shell-checkbox-input',
    )!;
    expect(document.activeElement).toBe(checkbox);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);

    expect(press(checkbox, "Escape").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(surface);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(true);
    grid.destroy();
  });

  it("212: directly focused body widgets adopt Widget mode and restore arrow navigation", async () => {
    const { grid, container, surface } = await createGrid();
    const checkbox = container.querySelector<HTMLInputElement>(
      '[data-row-id="r0"] [data-col-id="active"] .lfg-cell-shell-checkbox-input',
    )!;

    checkbox.focus();
    expect(document.activeElement).toBe(checkbox);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r0", field: "active" });

    expect(press(checkbox, "Escape").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(surface);
    expect(
      document
        .getElementById(surface.getAttribute("aria-activedescendant") ?? "")
        ?.getAttribute("data-col-id"),
    ).toBe("active");

    expect(press(surface, "ArrowLeft").defaultPrevented).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r0", field: "age" });
    grid.destroy();
  });

  it("213: row/header selection checkboxes stay outside Tab and restore data/header navigation", async () => {
    const { grid, container, surface } = await createGrid({
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
      },
    });
    const rowCheckbox = container.querySelector<HTMLInputElement>(
      ".lfg-row-selection-checkbox",
    )!;
    const headerCheckbox = container.querySelector<HTMLInputElement>(
      ".lfg-header-selection-checkbox",
    )!;
    expect(rowCheckbox.tabIndex).toBe(-1);
    expect(headerCheckbox.tabIndex).toBe(-1);

    rowCheckbox.focus();
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r0", field: "name" });
    expect(press(rowCheckbox, "Escape").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(surface);
    expect(press(surface, "ArrowRight").defaultPrevented).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r0", field: "age" });

    headerCheckbox.focus();
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(press(headerCheckbox, "Escape").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(surface);
    expect(press(surface, "ArrowRight").defaultPrevented).toBe(true);
    expect(
      document
        .getElementById(surface.getAttribute("aria-activedescendant") ?? "")
        ?.getAttribute("data-col-id"),
    ).toBe("name");
    grid.destroy();
  });

  it("214: directly focused floating filters exit to their logical target despite owner Escape handling", async () => {
    const { grid, container, surface } = await createGrid({
      floatingFilters: true,
      columns: [
        { field: "name", filterable: true },
        { field: "age", filterable: true },
      ],
    });
    const input = container.querySelector<HTMLInputElement>(
      '.lfg-floating-filter-cell[data-col-id="name"] .lfg-floating-filter-input',
    )!;
    expect(input.tabIndex).toBe(-1);

    input.focus();
    expect(document.activeElement).toBe(input);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(press(input, "Escape").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(surface);
    expect(
      document
        .getElementById(surface.getAttribute("aria-activedescendant") ?? "")
        ?.closest(".lfg-floating-filter-cell")
        ?.getAttribute("data-col-id"),
    ).toBe("name");

    expect(press(surface, "ArrowDown").defaultPrevented).toBe(true);
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r0", field: "name" });
    grid.destroy();
  });

  it("218-219: recycling a directly focused row checkbox exits Widget mode without an edge highlight", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `r${index}`,
      name: `Row ${index}`,
      age: index,
      active: index % 2 === 0,
    }));
    const { grid, container, surface } = await createGrid({
      rows,
      suppressRowVirtualization: false,
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
      },
    });
    const viewport = container.querySelector<HTMLElement>(".lfg-viewport")!;
    Object.defineProperty(viewport, "clientWidth", {
      configurable: true,
      value: 700,
    });
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 160,
    });
    grid.setRows([...rows]);
    await flushRenders();
    const checkbox = container.querySelector<HTMLInputElement>(
      '[data-row-id="r0"] .lfg-row-selection-checkbox',
    )!;

    checkbox.focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(checkbox);
    expect(grid.getFocusedCell()).toMatchObject({
      rowId: "r0",
      rowIndex: 0,
      field: "name",
    });
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(container.querySelectorAll(".lfg-a11y-active-target")).toHaveLength(0);

    viewport.scrollTop = 1_600;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRendererFrame();

    expect(document.activeElement).toBe(surface);
    expect(checkbox.tabIndex).toBe(-1);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(container.querySelectorAll(".lfg-a11y-active-target")).toHaveLength(0);
    expect(container.querySelectorAll(".lfg-cell-focused")).toHaveLength(0);
    expect(grid.getFocusedCell()).toMatchObject({
      rowId: "r0",
      rowIndex: 0,
      field: "name",
    });
    expect(press(checkbox, "Escape").defaultPrevented).toBe(false);

    grid.destroy();
  });

  it("218: horizontal header-slot recycling exits its focused widget", async () => {
    const columns = Array.from({ length: 12 }, (_, index) => ({
      field: `c${index}`,
      width: 150,
      resizable: true,
    }));
    const { grid, container, surface } = await createGrid({
      columns,
      rows: [{ id: "r0", c0: "zero" }],
      suppressColumnVirtualization: false,
    });
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

    surface.focus();
    expect(press(surface, "Home", { ctrlKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(press(surface, "F2").defaultPrevented).toBe(true);
    const widget = document.activeElement as HTMLElement;
    expect(widget).not.toBe(surface);
    expect(widget.tabIndex).toBe(0);
    expect(
      widget
        .closest(".lfg-header-cell")
        ?.getAttribute("data-col-id"),
    ).toBe("c0");
    await Promise.resolve();

    viewport.scrollLeft = 1_200;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRendererFrame();

    expect(document.activeElement).toBe(surface);
    expect(widget.tabIndex).toBe(-1);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);
    expect(container.querySelectorAll(".lfg-a11y-active-target")).toHaveLength(0);
    expect(
      container.querySelectorAll('.lfg-header-cell [tabindex="0"]'),
    ).toHaveLength(0);

    grid.destroy();
  });

  it("169: plain Space toggles a toggle-mode checkbox after row selection declines it", async () => {
    const { grid, container, surface } = await createGrid();
    grid.setFocusedCell({ rowIndex: 0, field: "active" }, "keyboard");
    const changes: unknown[] = [];
    grid.on("cell-value:changed", (event) => changes.push(event));

    expect(press(surface, " ").defaultPrevented).toBe(true);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      columnId: "active",
      oldValue: true,
      newValue: false,
    });
    expect(container.querySelector(".lfg-cell-editor-host")).toBeNull();
    grid.destroy();
  });

  it("169: boolean Space preserves row-selection precedence and never seeds edit mode", async () => {
    const selected = await createGrid({ rowSelection: { mode: "multiple" } });
    selected.grid.setFocusedCell({ rowIndex: 0, field: "active" }, "keyboard");
    const selectedChanges: unknown[] = [];
    selected.grid.on("cell-value:changed", (event) => selectedChanges.push(event));

    expect(press(selected.surface, " ").defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(selected.grid.getSelectedRowIds()).toEqual(["r0"]);
    expect(selectedChanges).toHaveLength(0);
    selected.grid.destroy();

    const edited = await createGrid({
      columns: [
        {
          field: "active",
          editable: true,
          editor: { type: "checkbox", activation: "edit" },
          cellShell: "checkbox",
        },
      ],
    });
    edited.grid.setFocusedCell({ rowIndex: 0, field: "active" }, "keyboard");
    const editedChanges: unknown[] = [];
    edited.grid.on("cell-value:changed", (event) => editedChanges.push(event));

    expect(press(edited.surface, " ").defaultPrevented).toBe(true);
    expect(editedChanges).toHaveLength(0);
    expect(edited.container.querySelector(".lfg-cell-editor-host")).toBeNull();
    edited.grid.destroy();
  });

  it("144/152: focusing the surface initializes and restores the logical target", async () => {
    const { grid, surface } = await createGrid();
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    outside.focus();
    surface.focus();
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r0", field: "name" });
    expect(
      document
        .getElementById(surface.getAttribute("aria-activedescendant") ?? "")
        ?.getAttribute("data-col-id"),
    ).toBe("name");

    grid.setFocusedCell({ rowIndex: 1, field: "age" }, "keyboard");
    outside.focus();
    surface.focus();
    expect(grid.getFocusedCell()).toMatchObject({ rowId: "r1", field: "age" });
    expect(
      document
        .getElementById(surface.getAttribute("aria-activedescendant") ?? "")
        ?.getAttribute("data-col-id"),
    ).toBe("age");
    grid.destroy();
  });

  it("183: native pagination controls remain reachable and bypass the coordinator", async () => {
    const { grid, container, surface } = await createGrid({
      pagination: true,
      paginationPageSize: 1,
    });
    grid.setFocusedCell({ rowIndex: 0, field: "name" }, "keyboard");
    const activeDescendant = surface.getAttribute("aria-activedescendant");
    const next = container.querySelector<HTMLButtonElement>(
      '.lfg-pagination-button[aria-label="Next page"]',
    )!;
    next.focus();

    expect(press(next, "ArrowRight").defaultPrevented).toBe(false);
    expect(press(next, "Enter").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(next);
    expect(surface.getAttribute("aria-activedescendant")).toBe(activeDescendant);
    expect(grid.getPaginationState().pageIndex).toBe(0);
    grid.destroy();
  });

  it("199: leaf-header F2 reaches custom actions, the column menu, and resize", async () => {
    const { grid, container, surface } = await createGrid({
      columns: [
        {
          field: "name",
          headerName: "Name",
          headerActions: [
            {
              id: "inspect",
              rendererKey: "inspectPanel",
              ariaLabel: "Inspect name",
            },
          ],
          headerControls: { order: ["headerActions", "columnMenu"] },
        },
      ],
      headerRenderers: {
        inspectPanel: {
          kind: "header-action",
          mode: "custom",
          render: ({ host }) => {
            const button = document.createElement("button");
            button.textContent = "Close inspect";
            host.appendChild(button);
          },
        },
      },
    });
    surface.focus();
    expect(press(surface, "Home", { ctrlKey: true }).defaultPrevented).toBe(true);

    const action = container.querySelector<HTMLButtonElement>(
      '.lfg-header-action-trigger[data-col-id="name"]',
    )!;
    const menu = container.querySelector<HTMLButtonElement>(
      '.lfg-column-menu-trigger[data-col-id="name"]',
    )!;
    const resize = container.querySelector<HTMLElement>(
      '.lfg-header-cell[data-col-id="name"] .lfg-resize-handle',
    )!;

    expect(press(surface, "F2").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(action);
    expect(press(action, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(menu);
    expect(press(menu, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(resize);
    expect(press(resize, "Escape").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(surface);
    grid.destroy();
  });

  it("200: floating-filter F2 traverses native controls in every pin lane", async () => {
    const fields = ["left", "center", "right"] as const;
    const { grid, container, surface } = await createGrid({
      columns: [
        { field: "left", pinned: "left", filterable: true },
        { field: "center", filterable: true },
        { field: "right", pinned: "right", filterable: true },
      ],
      rows: [{ id: "r0", left: "L", center: "C", right: "R" }],
      floatingFilters: true,
    });
    surface.focus();
    expect(press(surface, "Home", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press(surface, "ArrowDown").defaultPrevented).toBe(true);

    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index]!;
      const input = container.querySelector<HTMLInputElement>(
        `.lfg-floating-filter-cell[data-col-id="${field}"] .lfg-floating-filter-input`,
      )!;
      const menu = container.querySelector<HTMLButtonElement>(
        `.lfg-floating-filter-cell[data-col-id="${field}"] .lfg-column-filter-trigger`,
      )!;
      expect(press(surface, "F2").defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(input);
      expect(press(input, "Tab").defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(menu);
      expect(press(menu, "Escape").defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(surface);
      if (index < fields.length - 1) {
        expect(press(surface, "ArrowRight").defaultPrevented).toBe(true);
      }
    }
    grid.destroy();
  });

  it("201-204: row-action cells support direct popup commands and Widget-mode activation", async () => {
    const { grid, container, surface } = await createGrid({
      columns: [
        {
          field: "actions",
          cellKind: "actions",
          actionsKey: "rowActions",
          editable: false,
        },
        {
          field: "custom",
          cellKind: "actions",
          actionsKey: "customActions",
          editable: false,
        },
      ],
      rows: [{ id: "r0", actions: "", custom: "" }],
      cellRenderers: {
        rowActions: {
          kind: "actions",
          getActions: () => [{ id: "inspect", label: "Inspect" }],
          onAction: () => {},
        },
        customActions: {
          kind: "actions",
          mode: "custom",
          render: ({ host }) => {
            const button = document.createElement("button");
            button.textContent = "Custom command";
            host.appendChild(button);
          },
        },
      },
    });

    grid.setFocusedCell({ rowIndex: 0, field: "actions" }, "keyboard");
    surface.focus();
    expect(press(surface, "ArrowDown", { altKey: true }).defaultPrevented).toBe(
      true,
    );
    const menuItem = container.querySelector<HTMLButtonElement>(
      ".lfg-action-menu-item",
    )!;
    expect(document.activeElement).toBe(menuItem);
    expect(press(menuItem, "Escape").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(surface);

    grid.setFocusedCell({ rowIndex: 0, field: "custom" }, "keyboard");
    surface.focus();
    const customTrigger = container.querySelector<HTMLButtonElement>(
      '.lfg-action-trigger[data-row-index="0"][data-col-id="custom"]',
    )!;
    expect(press(surface, "F2").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(customTrigger);
    customTrigger.click();
    const customCommand = container.querySelector<HTMLButtonElement>(
      ".lfg-action-custom-panel button",
    )!;
    expect(document.activeElement).toBe(customCommand);
    expect(press(customCommand, "Escape").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(customTrigger);
    expect(press(customTrigger, "Escape").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(surface);

    expect(press(surface, "ArrowDown", { altKey: true }).defaultPrevented).toBe(
      true,
    );
    const directCustomCommand = container.querySelector<HTMLButtonElement>(
      ".lfg-action-custom-panel button",
    )!;
    expect(document.activeElement).toBe(directCustomCommand);
    expect(press(directCustomCommand, "Escape").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(surface);

    grid.destroy();
  });

  it("205-207: F2 focuses the exact visible cell-menu dots and restores them after Escape", async () => {
    const { grid, container, surface } = await createGrid({
      cellMenu: {
        enabled: true,
        trigger: "contextmenu-and-button",
        getActions: () => [{ id: "inspect", label: "Inspect" }],
        onAction: () => {},
      },
    });
    const cell = container.querySelector<HTMLElement>(
      '[data-row-id="r0"] [data-col-id="name"]',
    )!;
    pointerMove(cell);
    await flushRenders();
    const trigger = container.querySelector<HTMLButtonElement>(
      ".lfg-cell-menu-trigger",
    )!;
    expect(trigger.classList.contains("lfg-cell-menu-trigger-visible")).toBe(
      true,
    );

    grid.setFocusedCell({ rowIndex: 0, field: "name" }, "keyboard");
    surface.focus();
    expect(press(surface, "F2").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.tabIndex).toBe(0);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(false);

    trigger.click();
    const menuItem = container.querySelector<HTMLButtonElement>(
      ".lfg-cell-menu-item",
    )!;
    expect(document.activeElement).toBe(menuItem);
    expect(press(menuItem, "Escape").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.classList.contains("lfg-cell-menu-trigger-visible")).toBe(
      true,
    );

    expect(press(trigger, "Escape").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(surface);
    expect(trigger.tabIndex).toBe(-1);
    expect(surface.hasAttribute("aria-activedescendant")).toBe(true);
    grid.destroy();
  });

  it("208: F2 never focuses a visible cell-menu trigger owned by another cell", async () => {
    const { grid, container, surface } = await createGrid({
      columns: [
        { field: "name", editable: false },
        { field: "age", editable: false },
      ],
      cellMenu: {
        enabled: true,
        trigger: "button",
        getActions: () => [{ id: "inspect", label: "Inspect" }],
        onAction: () => {},
      },
    });
    const ageCell = container.querySelector<HTMLElement>(
      '[data-row-id="r0"] [data-col-id="age"]',
    )!;
    pointerMove(ageCell);
    await flushRenders();
    const trigger = container.querySelector<HTMLButtonElement>(
      ".lfg-cell-menu-trigger",
    )!;

    grid.setFocusedCell({ rowIndex: 0, field: "name" }, "keyboard");
    surface.focus();
    expect(press(surface, "F2").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(surface);
    expect(trigger.tabIndex).toBe(-1);
    grid.destroy();
  });

  it("209: real cell-menu popup shortcuts open from navigation and widget mode", async () => {
    const { grid, container, surface } = await createGrid({
      columns: [{ field: "name", editable: false }],
      cellMenu: {
        enabled: true,
        trigger: "contextmenu-and-button",
        getActions: () => [{ id: "inspect", label: "Inspect" }],
        onAction: () => {},
      },
    });
    const cell = container.querySelector<HTMLElement>(
      '[data-row-id="r0"] [data-col-id="name"]',
    )!;

    grid.setFocusedCell({ rowIndex: 0, field: "name" }, "keyboard");
    surface.focus();
    expect(press(surface, "F10", { shiftKey: true }).defaultPrevented).toBe(
      true,
    );
    await flushRenders();
    let menuItem = container.querySelector<HTMLButtonElement>(
      ".lfg-cell-menu-item",
    )!;
    expect(document.activeElement).toBe(menuItem);
    press(menuItem, "Escape");
    expect(document.activeElement).toBe(surface);

    expect(press(surface, "ArrowDown", { altKey: true }).defaultPrevented).toBe(
      true,
    );
    await flushRenders();
    menuItem = container.querySelector<HTMLButtonElement>(
      ".lfg-cell-menu-item",
    )!;
    expect(document.activeElement).toBe(menuItem);
    press(menuItem, "Escape");
    expect(document.activeElement).toBe(surface);

    pointerMove(cell);
    await flushRenders();
    const trigger = container.querySelector<HTMLButtonElement>(
      ".lfg-cell-menu-trigger",
    )!;
    expect(press(surface, "F2").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(press(trigger, "F10", { shiftKey: true }).defaultPrevented).toBe(
      true,
    );
    await flushRenders();
    menuItem = container.querySelector<HTMLButtonElement>(
      ".lfg-cell-menu-item",
    )!;
    expect(document.activeElement).toBe(menuItem);
    press(menuItem, "Escape");
    expect(document.activeElement).toBe(trigger);

    expect(press(trigger, "ArrowDown", { altKey: true }).defaultPrevented).toBe(
      true,
    );
    await flushRenders();
    menuItem = container.querySelector<HTMLButtonElement>(
      ".lfg-cell-menu-item",
    )!;
    expect(document.activeElement).toBe(menuItem);
    press(menuItem, "Escape");
    expect(document.activeElement).toBe(trigger);

    trigger.removeAttribute("aria-haspopup");
    expect(press(trigger, "F10", { shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(container.querySelector(".lfg-cell-menu-item")).toBeNull();

    grid.destroy();
  });
});
